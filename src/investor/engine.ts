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
import { buildSystemPrompt, type Archetype } from './archetypes.ts';
import type { SatisfactionVerdict } from './satisfaction.ts';

export type QuestionLayer = 'contradiction' | 'follow_up' | 'spine' | 'wrap_up';

export interface NextMove {
  layer: QuestionLayer;
  /** Instruction handed to the persona describing what to press on. */
  directive: string;
  topicId?: SpineTopicId;
  finding?: Finding;
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
}

export function initialState(): EngineState {
  return {
    asked: new Set(),
    satisfied: new Set(),
    dodged: new Set(),
    raisedFindings: new Set(),
    followUpCount: 0,
  };
}

/**
 * Choose the next move. Pure and deterministic — no model call, so question
 * selection can be unit-tested independently of phrasing.
 */
export function selectMove(
  state: EngineState,
  ledger: Ledger,
  archetype: Archetype,
  lastVerdict?: SatisfactionVerdict,
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

  // Layer 3 — the last answer did not land, and we have budget to push.
  if (
    lastVerdict &&
    !lastVerdict.satisfied &&
    state.currentTopic &&
    state.followUpCount < archetype.followUpDepth
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
  let currentTopic = state.currentTopic;
  let followUpCount = state.followUpCount;

  if (move.layer === 'contradiction' && move.finding) {
    raisedFindings.add(findingKey(move.finding));
    // A contradiction interrupts without consuming the topic's follow-up budget.
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

  const next: EngineState = { asked, satisfied, dodged, raisedFindings, followUpCount };
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
export async function speak(
  archetype: Archetype,
  history: Turn[],
  move: NextMove,
  opening = false,
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: buildSystemPrompt(archetype) },
    ...history.map((turn) => ({
      role: turn.role === 'investor' ? ('assistant' as const) : ('user' as const),
      content: turn.text,
    })),
  ];

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
      `no quotation marks around the whole thing. One question.`,
  });

  const result = await chat(messages, {
    tag: `investor:speak:${move.layer}`,
    reasoningEffort: 'low',
    maxTokens: 2048,
  });

  return result.text.trim();
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
