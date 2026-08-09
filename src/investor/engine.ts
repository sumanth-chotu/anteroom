/**
 * The question engine. (PLAN.md §3.2)
 *
 * Layered selection — higher layers pre-empt lower ones. Phase 0 implements the
 * three layers that need no deck and no category brief:
 *
 *   1. contradiction  — the ledger caught something. Ask now.
 *   2. follow_up      — the last answer did not land. Ask again, narrower.
 *   3. spine          — deterministic seed coverage checklist.
 *
 * Layers 2 (planned probes, from the pre-read), 4 (community objections) and 5
 * (slide-derived probes) arrive with Phases 1 and 4.
 *
 * Selection is deterministic. Only the *phrasing* costs a model call, which
 * keeps the reasoning auditable and the behaviour testable.
 */

import { chat } from '../xai/client.ts';
import type { Finding, Ledger } from '../ledger/types.ts';
import { findingKey, unraisedFindings } from '../ledger/checks.ts';
import { SEED_SPINE, topicById, type SpineTopic, type SpineTopicId } from './spine.ts';
import { buildSystemPrompt, type InvestorProfile } from './profiles.ts';
import type { SatisfactionVerdict } from './satisfaction.ts';
import { POSTURE_EFFECT, type PreReadMemo } from '../preread/types.ts';
import type { CategoryBrief } from '../category/types.ts';
import {
  STRONG_CONVICTION_HITS,
  relevantConvictions,
  scoredConvictions,
  type Conviction,
  type CorpusPersona,
} from '../corpus/types.ts';
import type { Enrichment } from './briefing.ts';
import {
  convictionDirective,
  detectTells,
  shouldRegenerate,
  tellComplaint,
  tellScore,
} from './voiceprint.ts';

export type QuestionLayer =
  | 'contradiction'
  | 'derail'
  | 'follow_up'
  | 'conviction'
  | 'planned_probe'
  | 'community_objection'
  | 'spine'
  | 'wrap_up';

export interface NextMove {
  layer: QuestionLayer;
  /** Instruction handed to the persona describing what to press on. */
  directive: string;
  topicId?: SpineTopicId;
  finding?: Finding;
  probeId?: string;
  objectionTheme?: string;
  /** Set on the `conviction` layer — which belief the founder tripped. */
  conviction?: Conviction;
}

export interface EngineState {
  /** Spine topics that have been *asked about*. */
  asked: Set<SpineTopicId>;
  /** Topics where the founder actually gave a satisfying answer. */
  satisfied: Set<SpineTopicId>;
  /** Topics abandoned after exhausting the follow-up budget. */
  dodged: Set<SpineTopicId>;
  /** Findings already raised, so a contradiction is not re-asked every turn. */
  raisedFindings: Set<string>;
  /** Topic currently being pursued. */
  currentTopic?: SpineTopicId;
  /** Consecutive follow-ups on the current topic. */
  followUpCount: number;
  /** Moves issued so far. Seeds the derail roll, keeping sessions reproducible. */
  moveCount: number;
  /** True when the previous move was a derail — prevents two in a row. */
  justDerailed: boolean;
  /** Derails issued, for the room-control metric. */
  derailCount: number;
  /** Pre-read probes already asked, so each fires once. */
  askedProbes: Set<string>;
  /** Category objections already raised. */
  askedObjections: Set<string>;
  /** Convictions already pressed, so a belief fires once rather than every turn. */
  pressedConvictions: Set<string>;
}

export function initialState(): EngineState {
  return {
    asked: new Set(),
    satisfied: new Set(),
    dodged: new Set(),
    raisedFindings: new Set(),
    followUpCount: 0,
    moveCount: 0,
    justDerailed: false,
    derailCount: 0,
    askedProbes: new Set(),
    askedObjections: new Set(),
    pressedConvictions: new Set(),
  };
}

/**
 * Deterministic 0–1 roll from a seed.
 *
 * Not Math.random(): the eval suite replays sessions and needs identical
 * behaviour every run, so derailment has to be reproducible rather than merely
 * random-looking.
 */
function roll(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Stable identity for a conviction, so each fires at most once per session. */
export function convictionKey(conviction: Conviction): string {
  return conviction.belief.slice(0, 80).toLowerCase();
}

/**
 * Choose the next move. Pure and deterministic — no model call, so question
 * selection can be unit-tested independently of phrasing.
 */
export function selectMove(
  state: EngineState,
  ledger: Ledger,
  profile: InvestorProfile,
  lastVerdict?: SatisfactionVerdict,
  memo?: PreReadMemo,
  brief?: CategoryBrief,
  /** The founder's most recent answer, matched against conviction triggers. */
  lastFounderText?: string,
  corpus?: CorpusPersona | null,
): NextMove {
  // Layer 1 — a contradiction outranks everything else.
  const findings = unraisedFindings(ledger, state.raisedFindings);
  const finding = findings[0];
  if (finding) {
    return {
      layer: 'contradiction',
      finding,
      directive:
        `The founder has contradicted themselves. ${finding.summary}\n\n` +
        `Press on this now, in your own words. A question of this shape works: ` +
        `"${finding.probe}"\n\n` +
        `Do not soften it and do not explain how you noticed.`,
    };
  }

  // Layer 1b — the founder leaned hard on something this investor has argued
  // against in print.
  //
  // Ranked directly under a contradiction, and deliberately ABOVE follow_up. The
  // first version placed it below, and it never fired once: a founder who is
  // dodging keeps the follow-up layer alive indefinitely, so the layer meant to
  // produce the sharpest questions was starved by the layer producing the most
  // generic ones. Measured on a scripted pitch that tripped six triggers —
  // conviction turns: 0.
  //
  // Gated at STRONG_CONVICTION_HITS so it interrupts only when the founder
  // actually leaned on the idea. A single passing mention waits its turn below,
  // because an investor who abandons every thread at the first keyword reads as
  // having no attention span rather than strong opinions.
  const strong = scoredConvictions(corpus, lastFounderText ?? '').find(
    (scored) =>
      scored.hits >= STRONG_CONVICTION_HITS &&
      !state.pressedConvictions.has(convictionKey(scored.conviction)),
  );
  if (strong) {
    return {
      layer: 'conviction',
      conviction: strong.conviction,
      directive: convictionDirective([strong.conviction]),
    };
  }

  // Layer 2 — derailment.
  //
  // Chaotic profiles hijack the meeting. This is not a gag: it trains the one
  // skill the serious profiles cannot test — whether the founder can take back a
  // room that has been taken from them. Plenty of real meetings go this way, and
  // a founder who folds every time an investor starts talking about themselves
  // will lose thirty minutes they never get back.
  //
  // A contradiction still outranks it: even a blowhard notices a number moving.
  const canDerail = profile.derailment > 0 && !state.justDerailed && state.moveCount > 0;
  if (canDerail && roll(`${profile.id}:${state.moveCount}`) < profile.derailment) {
    return {
      layer: 'derail',
      directive:
        `Hijack the conversation. Do not ask about their company this turn.\n\n` +
        `Go off on something adjacent — a story about yourself, an opinion you want to air, ` +
        `a tangent their last answer reminded you of. ` +
        (profile.selfRegard > 0.7
          ? `Make it mostly about you.\n\n`
          : `Keep it brief and come back toward the topic at the end.\n\n`) +
        `Two or three sentences at most. Do not ask a question about their business. ` +
        `You may end on a rhetorical question or trail off — the founder should have to ` +
        `decide whether to follow you or pull the meeting back.`,
    };
  }

  // Layer 3 — the last answer did not land, and we have budget to push.
  if (
    lastVerdict &&
    !lastVerdict.satisfied &&
    state.currentTopic &&
    state.followUpCount < profile.followUpDepth
  ) {
    const topic = topicById(state.currentTopic);
    const dodged = lastVerdict.answered === 'dodged' || lastVerdict.answered === 'non_answer';
    return {
      layer: 'follow_up',
      topicId: state.currentTopic,
      directive:
        `That answer did not land. ${lastVerdict.reasoning}` +
        (lastVerdict.missing ? ` Still missing: ${lastVerdict.missing}.` : '') +
        `\n\nAsk again, narrower and harder to escape. You are still on: ${topic.label}.` +
        (dodged && state.followUpCount >= 1
          ? `\n\nThey have now dodged this twice. Say so plainly before asking again.`
          : ''),
    };
  }

  // Layer 3b — a weaker conviction hit: mentioned once, not leaned on.
  //
  // The strong version already ran above the follow-up layer. This one waits
  // until the current thread is finished, which is the right order for a passing
  // mention — but it still outranks the planned probes and the spine, because
  // something the founder said ten seconds ago beats something decided before the
  // meeting, and beats a checklist outright.
  const tripped = relevantConvictions(corpus, lastFounderText ?? '').find(
    (c) => !state.pressedConvictions.has(convictionKey(c)),
  );
  if (tripped) {
    return {
      layer: 'conviction',
      conviction: tripped,
      directive: convictionDirective([tripped]),
    };
  }

  // Layer 4 — a probe the investor walked in intending to ask.
  //
  // Placed after follow-up deliberately: finish the thread you are on before
  // opening a new one. But ahead of the spine, because what the deck made you
  // want to ask beats a generic checklist item every time.
  const probe = memo?.plannedProbes.find((p) => !state.askedProbes.has(p.id));
  if (probe) {
    return {
      layer: 'planned_probe',
      probeId: probe.id,
      directive:
        `Before this meeting you read their deck and wrote down that you wanted to ask about ` +
        `${probe.topic}` +
        (probe.slideRef ? ` (slide ${probe.slideRef})` : '') +
        `.\n\nAsk it now, in your own voice. Your note to yourself read: "${probe.question}"\n\n` +
        `You already know what the deck says — do not ask them to repeat it back to you.`,
    };
  }

  // Layer 5 — an objection the category itself keeps raising.
  //
  // Only for profiles that use the brief. The question is pre-compiled by the
  // brief pipeline and asked as the investor's own — never attributed to X,
  // because real investors absorb sentiment rather than cite it.
  //
  // Gated on having heard something first. Without the guard this fires as the
  // OPENING question — the investor raising a category-wide criticism before
  // the founder has said what they do, which no real investor does. You earn
  // the right to that question by listening for a few turns.
  const heardEnough = state.moveCount >= 3 && state.asked.size >= 1;
  if (profile.useCategoryBrief && brief && heardEnough) {
    const objection = brief.objectionThemes.find((o) => !state.askedObjections.has(o.theme));
    if (objection) {
      return {
        layer: 'community_objection',
        objectionTheme: objection.theme,
        directive:
          `You have watched this category closely, and one criticism comes up every time a ` +
          `company here launches: "${objection.theme}".\n\n` +
          `Put that to them now, in your own words. This shape works: ` +
          `"${objection.investorQuestion}"\n\n` +
          `Do NOT mention X, posts, tweets or "people online" — this is your own read of the ` +
          `market, not a citation.`,
      };
    }
  }

  // Layer 6 — next unasked spine topic.
  //
  // Reached either because the last answer satisfied, or because the follow-up
  // budget is spent. In the second case the investor says so before moving on:
  // dropping a dodged topic silently reads as having accepted the answer, and
  // burning an entire session on one topic leaves the founder with no coverage.
  const abandoning =
    lastVerdict && !lastVerdict.satisfied && state.currentTopic
      ? topicById(state.currentTopic)
      : undefined;

  const next = SEED_SPINE.find((t) => !state.asked.has(t.id));
  if (next) {
    return {
      layer: 'spine',
      topicId: next.id,
      directive:
        (abandoning
          ? `You have pushed on ${abandoning.label} as far as it is worth pushing and did not ` +
            `get an answer. Note that briefly — one clause, not a lecture — then move on.\n\n`
          : '') +
        `Next topic: ${next.label}.\n` +
        `What you are trying to learn: ${next.intent}\n` +
        `Ask about this in your own voice. A baseline version: "${next.defaultQuestion}"`,
    };
  }

  return {
    layer: 'wrap_up',
    directive:
      `You have covered everything you needed. Close the meeting the way an investor does: ` +
      `briefly, without promising anything, and without giving feedback.`,
  };
}

/** Advance state after a move is issued and answered. */
export function applyMove(
  state: EngineState,
  move: NextMove,
  verdict?: SatisfactionVerdict,
): EngineState {
  const asked = new Set(state.asked);
  const satisfied = new Set(state.satisfied);
  const dodged = new Set(state.dodged);
  const raisedFindings = new Set(state.raisedFindings);
  const askedProbes = new Set(state.askedProbes);
  const askedObjections = new Set(state.askedObjections);
  const pressedConvictions = new Set(state.pressedConvictions);
  let currentTopic = state.currentTopic;
  let followUpCount = state.followUpCount;

  let derailCount = state.derailCount;

  if (move.layer === 'contradiction' && move.finding) {
    raisedFindings.add(findingKey(move.finding));
    // A contradiction interrupts without consuming the topic's follow-up budget.
  } else if (move.layer === 'planned_probe' && move.probeId) {
    askedProbes.add(move.probeId);
  } else if (move.layer === 'community_objection' && move.objectionTheme) {
    askedObjections.add(move.objectionTheme);
  } else if (move.layer === 'conviction' && move.conviction) {
    // Like a contradiction, a conviction interrupts without consuming the
    // current topic's follow-up budget — the investor is reacting to what they
    // just heard, not abandoning the thread.
    pressedConvictions.add(convictionKey(move.conviction));
  } else if (move.layer === 'derail') {
    derailCount += 1;
    // A derail costs the founder a turn but does not advance or close a topic.
  } else if (move.layer === 'spine' && move.topicId) {
    // Moving on from an unanswered topic records it as dodged, not covered.
    if (currentTopic && !satisfied.has(currentTopic)) dodged.add(currentTopic);
    currentTopic = move.topicId;
    followUpCount = 0;
    asked.add(move.topicId);
  } else if (move.layer === 'follow_up') {
    followUpCount += 1;
  }

  // A satisfying answer closes the current topic.
  if (verdict?.satisfied && currentTopic) {
    satisfied.add(currentTopic);
    dodged.delete(currentTopic);
    followUpCount = 0;
  }

  const next: EngineState = {
    asked,
    satisfied,
    dodged,
    raisedFindings,
    followUpCount,
    moveCount: state.moveCount + 1,
    justDerailed: move.layer === 'derail',
    derailCount,
    askedProbes,
    askedObjections,
    pressedConvictions,
  };
  if (currentTopic) next.currentTopic = currentTopic;
  return next;
}

export interface Turn {
  role: 'investor' | 'founder';
  text: string;
}

/**
 * Generate the investor's actual utterance for a chosen move.
 *
 * The directive is delivered as a system-role message *after* the history, so
 * it carries operator authority and cannot be confused with founder speech.
 */
const POSTURE_NOTE: Record<string, string> = {
  leaning_in: 'You liked the deck. You want to be convinced, and it shows.',
  neutral: 'The deck was fine. You have no strong prior either way.',
  skeptical: 'Several things in the deck bothered you. You are harder to please than usual today.',
  looking_for_the_no:
    'The deck did not land. You expect to pass and are looking for the reason — you are short, ' +
    'unhurried in the wrong way, and not inclined to help them out.',
};

export interface SpeakResult {
  text: string;
  /** Summed AI-tell weight of what shipped. 0 is clean. */
  tellScore: number;
  /** True when the first attempt tripped the detector and was thrown away. */
  regenerated: boolean;
}

export async function speak(
  profile: InvestorProfile,
  history: Turn[],
  move: NextMove,
  opening = false,
  memo?: PreReadMemo,
  enrichment?: Enrichment,
): Promise<string> {
  return (await speakChecked(profile, history, move, opening, memo, enrichment)).text;
}

/**
 * `speak`, plus what the AI-tell detector saw.
 *
 * Separate function rather than a changed return type so every existing caller
 * keeps working. The session layer uses this one, because "how synthetic did
 * that turn sound, and did we have to retry" is a metric worth reporting.
 */
export async function speakChecked(
  profile: InvestorProfile,
  history: Turn[],
  move: NextMove,
  opening = false,
  memo?: PreReadMemo,
  enrichment?: Enrichment,
): Promise<SpeakResult> {
  const first = await generate(profile, history, move, opening, memo, enrichment);

  if (!shouldRegenerate(first)) {
    return { text: first, tellScore: tellScore(first), regenerated: false };
  }

  // One retry, never two.
  //
  // The complaint names the exact offending words, which is far more effective
  // than repeating the rule — the rule was already in the system prompt and got
  // ignored. A second retry is not worth the latency: measured, the first one
  // fixes it or the phrasing is genuinely load-bearing for the point.
  const complaint = tellComplaint(detectTells(first));
  const second = await generate(profile, history, move, opening, memo, enrichment, complaint);

  // Keep whichever is cleaner. A retry can come back worse, and shipping a
  // worse turn to honour the retry would make the detector actively harmful.
  const best = tellScore(second) <= tellScore(first) ? second : first;
  return { text: best, tellScore: tellScore(best), regenerated: best === second };
}

async function generate(
  profile: InvestorProfile,
  history: Turn[],
  move: NextMove,
  opening: boolean,
  memo?: PreReadMemo,
  enrichment?: Enrichment,
  complaint?: string,
): Promise<string> {
  const messages = [
    {
      role: 'system' as const,
      content: buildSystemPrompt(profile, enrichment, { opening }),
    },
    ...history.map((turn) => ({
      role: turn.role === 'investor' ? ('assistant' as const) : ('user' as const),
      content: turn.text,
    })),
  ];

  // Posture arrives as an operator instruction after the history, so a weak
  // deck produces a visibly impatient investor rather than a neutral one.
  if (memo) {
    messages.push({
      role: 'system' as const,
      content:
        `You read their deck before this meeting.\n` +
        `What it says they do: ${memo.oneLinerFromFullDeck}\n` +
        (memo.redFlags.length
          ? `What bothered you most: ${memo.redFlags[0]?.summary}\n`
          : '') +
        `\nHow you feel walking in: ${POSTURE_NOTE[memo.initialPosture] ?? ''}\n` +
        `Never mention that you have notes, a memo, or a pre-read. You just read the deck.`,
    });
  }

  if (opening) {
    messages.push({
      role: 'user' as const,
      content: '[The founder has just sat down. Open the meeting.]',
    });
  }

  messages.push({
    role: 'system' as const,
    content:
      `${move.directive}\n\n` +
      `Respond with only what you say out loud. No stage directions, no labels, ` +
      `no quotation marks around the whole thing. One question.` +
      (complaint ? `\n\n${complaint}` : ''),
  });

  const result = await chat(messages, {
    tag: `investor:speak:${move.layer}${complaint ? ':retry' : ''}`,
    reasoningEffort: 'low',
    maxTokens: 2048,
  });

  return asUtterance(result.text);
}

/**
 * Flatten a completion into one spoken line.
 *
 * The model sometimes returns a turn across two lines — "Why you?\nWhy are you
 * the right people to build this?" — which the UI rendered as "Why you?Why are
 * you..." with the newline swallowed. Speech has no line breaks, so collapsing
 * them is the correct representation rather than a patch over a rendering bug,
 * and the same string is what the voice path would have to say out loud.
 *
 * Also strips wrapping quotes: asked for "only what you say out loud" the model
 * occasionally quotes the whole utterance.
 */
export function asUtterance(text: string): string {
  const flat = text.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const quoted = /^"([\s\S]+)"$/.exec(flat) ?? /^'([\s\S]+)'$/.exec(flat);
  return (quoted?.[1] ?? flat).trim();
}

/** Profile dials adjusted by pre-read posture (PLAN.md §6.5). */
export function adjustedDials(profile: InvestorProfile, memo?: PreReadMemo) {
  const effect = memo ? POSTURE_EFFECT[memo.initialPosture] : { warmth: 1, patience: 1 };
  return {
    warmth: Math.max(0, Math.min(1, profile.warmth * effect.warmth)),
    interruptThresholdMs: Math.round(profile.interruptThresholdMs * effect.patience),
    followUpDepth: profile.followUpDepth,
  };
}

export interface CoverageReport {
  /** Asked and answered well. */
  satisfied: SpineTopic[];
  /** Asked, but never actually answered. */
  dodged: SpineTopic[];
  /** Never reached. */
  unasked: SpineTopic[];
}

/**
 * Asked, answered and dodged are deliberately distinct.
 *
 * Reporting an unanswered topic as "covered" tells the founder they handled
 * something they in fact escaped — the exact miscalibration this product exists
 * to prevent.
 */
export function coverageReport(state: EngineState): CoverageReport {
  return {
    satisfied: SEED_SPINE.filter((t) => state.satisfied.has(t.id)),
    dodged: SEED_SPINE.filter((t) => state.dodged.has(t.id) && !state.satisfied.has(t.id)),
    unasked: SEED_SPINE.filter((t) => !state.asked.has(t.id)),
  };
}
