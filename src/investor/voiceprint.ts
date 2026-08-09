/**
 * Making the investor stop sounding like a language model.
 *
 * Two halves, and the second is the one that actually works.
 *
 *   PROMPT     `HUMAN_SPEECH` bans the specific constructions that read as
 *              synthetic, and `speechDirective()` renders a researched dossier
 *              into imitable instructions.
 *   MEASURE    `detectTells()` is a deterministic scan for those same
 *              constructions in the model's OUTPUT, so a turn that slipped can
 *              be regenerated instead of shipped.
 *
 * The prompt half alone does not hold. "Be terse, sound human" produces two good
 * turns and then drifts back to "That's a great question — help me understand
 * how you're thinking about the market." Drift is invisible without a check, and
 * a check made of regexes is cheap, instant, unit-testable and cannot
 * hallucinate — the same reasoning the ledger's contradiction checks are built
 * on (CLAUDE.md: deterministic before model).
 *
 * ── PRECISION OVER RECALL ───────────────────────────────────────────────────
 *
 * Every pattern here has to survive a real investor saying it. Humans do say
 * "however". They do not say "I appreciate you sharing that." So patterns are
 * scored, not merely matched, and the ones that overlap with legitimate speech
 * carry low weight. A false tell costs a pointless regeneration and, worse,
 * teaches us to distrust the detector — the same trade the repo already made for
 * contradiction findings.
 *
 * Nothing in here rewrites text. A regex that edits a sentence produces a
 * mangled sentence, which sounds *more* synthetic, not less. The only remedy is
 * to ask again.
 */

import type { Conviction, CorpusPersona } from '../corpus/types.ts';
import type { Enrichment } from './briefing.ts';
import type { Dossier, SpeechProfile } from './dossier.ts';
import type { InvestorProfile } from './profiles.ts';

// ─────────────────────────────────────────────────────────────────────────────
// The tells
// ─────────────────────────────────────────────────────────────────────────────

export type TellKind =
  | 'preamble'
  | 'mirroring'
  | 'hedge_balance'
  | 'signposting'
  | 'assistant_vocab'
  | 'coaching'
  | 'politeness'
  | 'triad'
  | 'antithesis';

export interface Tell {
  kind: TellKind;
  /** What matched, verbatim — so a report can show the offending words. */
  match: string;
  /** 1 mild, 2 clear, 3 unmistakable. */
  weight: 1 | 2 | 3;
  why: string;
}

interface Pattern {
  kind: TellKind;
  weight: 1 | 2 | 3;
  re: RegExp;
  why: string;
}

/**
 * Ordered roughly by how damning each is.
 *
 * The weight-3 group is the set no investor has ever said across a table. The
 * weight-1 group is ordinary English that becomes a tell only by density, which
 * is why `tellScore` sums rather than trips on a single hit.
 */
const PATTERNS: Pattern[] = [
  // ── unmistakable ──────────────────────────────────────────────────────────
  {
    kind: 'preamble',
    weight: 3,
    re: /\b(great|good|interesting|fair|excellent)\s+(question|point)\b/i,
    why: 'complimenting the question is pure chatbot',
  },
  {
    kind: 'preamble',
    weight: 3,
    re: /\b(thanks|thank you)\s+for\s+(sharing|that|walking|explaining|clarifying)\b/i,
    why: 'investors do not thank you mid-meeting',
  },
  {
    kind: 'politeness',
    weight: 3,
    re: /\bI\s+(appreciate|love)\s+(that|you|the)\b/i,
    why: 'assistant warmth, not investor warmth',
  },
  {
    kind: 'mirroring',
    weight: 3,
    re: /\b(so\s+)?if\s+I\s+(understand|hear|follow)\s+(you\s+)?(correctly|right)\b/i,
    why: 'summarising the founder back to themselves',
  },
  {
    kind: 'mirroring',
    weight: 3,
    re: /\bit\s+sounds\s+like\s+(you|what|your)\b/i,
    why: 'reflective-listening tic; reads as therapy, not diligence',
  },
  {
    kind: 'coaching',
    weight: 3,
    re: /\b(does\s+that\s+make\s+sense|hope\s+that\s+helps|happy\s+to\s+(help|dig))\b/i,
    why: 'offering service — the investor is not here to help',
  },
  {
    kind: 'assistant_vocab',
    weight: 3,
    re: /\b(delve|underscore[sd]?|testament|tapestry|multifaceted|holistic|myriad)\b/i,
    why: 'vocabulary almost exclusive to generated prose',
  },

  // ── clear ─────────────────────────────────────────────────────────────────
  {
    kind: 'signposting',
    weight: 2,
    re: /\b(let\s+me\s+(ask|push|understand)|I'?d\s+like\s+to\s+understand|help\s+me\s+understand)\b/i,
    why: 'announcing the question instead of asking it',
  },
  {
    kind: 'hedge_balance',
    weight: 2,
    re: /\b(that\s+(said|being\s+said)|having\s+said\s+that|with\s+that\s+in\s+mind)\b/i,
    why: 'both-sides connective; softens a question that should land hard',
  },
  {
    kind: 'hedge_balance',
    weight: 2,
    re: /\bit'?s\s+worth\s+(noting|mentioning|considering)\b/i,
    why: 'essay register, not speech',
  },
  {
    kind: 'antithesis',
    weight: 2,
    re: /\bit'?s\s+not\s+(just\s+)?(about\s+)?\w[\w\s]{0,24}?\s*[—-]\s*it'?s\b/i,
    why: 'the "not X — it\'s Y" cadence is a signature of generated text',
  },
  {
    kind: 'assistant_vocab',
    weight: 2,
    re: /\b(landscape|ecosystem|leverage|robust|crucial|pivotal|realm|nuanced|streamline)\b/i,
    why: 'consultant-deck vocabulary; a real investor says the plain word',
  },
  {
    kind: 'coaching',
    weight: 2,
    re: /\b(you\s+(might|may|could)\s+want\s+to|I'?d\s+(suggest|recommend)|consider\s+(adding|reframing))\b/i,
    why: 'coaching mid-meeting, which BASE_PERSONA already forbids',
  },

  // ── mild: ordinary English that becomes a tell by density ──────────────────
  {
    kind: 'hedge_balance',
    weight: 1,
    re: /\b(however|furthermore|moreover|additionally|nevertheless)\b/i,
    why: 'written connective; rare in speech',
  },
  {
    kind: 'signposting',
    weight: 1,
    re: /\b(walk\s+me\s+through|talk\s+me\s+through)\b/i,
    why: 'real but wildly overused — fine occasionally, a tell every turn',
  },
  {
    kind: 'politeness',
    weight: 1,
    re: /\b(certainly|absolutely|of\s+course)\b/i,
    why: 'assistant affirmation',
  },
];

/**
 * Three or more comma-separated parallel items before a clause end.
 *
 * The rule of three is the single most reliable generated-text signature, and it
 * survives every instruction to be terse. Kept separate from PATTERNS because it
 * is structural rather than lexical.
 */
function triads(text: string): Tell[] {
  const found: Tell[] = [];
  // "a, b, and c" / "a, b, or c" — require the items to be short, so genuine
  // enumeration of long clauses is not caught.
  const re = /\b([\w'-]+(?:\s[\w'-]+){0,3}),\s([\w'-]+(?:\s[\w'-]+){0,3}),\s(?:and|or)\s([\w'-]+(?:\s[\w'-]+){0,3})\b/gi;
  for (const match of text.matchAll(re)) {
    found.push({
      kind: 'triad',
      match: match[0],
      weight: 2,
      why: 'three parallel items — the rule of three is a generated-text signature',
    });
  }
  return found;
}

/**
 * Scan one utterance for AI tells.
 *
 * Pure and synchronous. Give it exactly what the investor says out loud — not
 * the prompt, not the reasoning trace.
 */
export function detectTells(text: string): Tell[] {
  const found: Tell[] = [];
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(text);
    if (match) {
      found.push({ kind: pattern.kind, match: match[0], weight: pattern.weight, why: pattern.why });
    }
  }
  return [...found, ...triads(text)];
}

/** Summed weight. 0 is clean; 3+ is worth spending a retry on. */
export function tellScore(text: string): number {
  return detectTells(text).reduce((sum, tell) => sum + tell.weight, 0);
}

/**
 * The threshold for regenerating a turn.
 *
 * Set at 3 so a single weight-3 tell ("Great question") or two clear ones is
 * enough, while one stray "however" is not. Deliberately not 1: a detector that
 * fires constantly costs a model call every turn and doubles latency for no
 * audible gain.
 */
export const REGENERATE_ABOVE = 2;

export function shouldRegenerate(text: string): boolean {
  return tellScore(text) > REGENERATE_ABOVE;
}

/** Feedback for the retry. Naming the exact words beats repeating the rule. */
export function tellComplaint(tells: Tell[]): string {
  const worst = [...tells].sort((a, b) => b.weight - a.weight).slice(0, 4);
  return (
    `That came out sounding like an AI assistant, not a person in a meeting. ` +
    `Specifically:\n` +
    worst.map((t) => `- "${t.match}" — ${t.why}`).join('\n') +
    `\n\nSay the same thing again, shorter, with none of that. Start with the ` +
    `substance. No preamble, no connective tissue, no summarising them back.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The prompt half
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a real person sounds like, as instructions a model can execute.
 *
 * Written as prohibitions plus positive mechanics. Prohibitions alone produce
 * stilted output — the model avoids the banned phrases and still builds even,
 * balanced, obviously-written sentences. The mechanics section is what makes it
 * sound spoken: fragments, front-loaded points, unfinished thoughts.
 */
export const HUMAN_SPEECH = `
HOW YOU TALK

You are a person speaking out loud in a room, not writing. Everything below is
about the SHAPE of what you say, not the content.

Never say any of these, in any form:
- "Great question", "good point", "fair question", "interesting"
- "Thanks for sharing", "I appreciate that", "I love that"
- "So if I understand correctly", "it sounds like you're saying"
- "Let me ask you this", "help me understand", "I'd like to understand"
- "That said", "that being said", "it's worth noting", "however", "furthermore"
- "Does that make sense?", "hope that helps", "happy to help"
- "landscape", "ecosystem", "leverage", "robust", "crucial", "delve", "nuanced"

Never restate what the founder just told you before responding to it. They said
it ten seconds ago.

Never build a sentence as "it's not just X — it's Y". Never list three parallel
things. Both are unmistakably written rather than spoken.

MECHANICS OF SPEECH

- Fragments are correct. "Since when?" is a complete turn. So is "How many?"
- Front-load the point. The first four words should carry it.
- One thought per turn. Do not add a second sentence that qualifies the first.
- Vary the length hard. A three-word turn after a long one is what real
  conversation sounds like; a paragraph every turn is what a chatbot sounds like.
- You may interrupt yourself, trail off, or leave a question half-built if the
  meaning is already there.
- Repeat their number back flatly instead of arguing with it. "Forty percent."
- Silence and a flat "Okay." are legitimate turns when an answer was thin.
- Contract everything. "Don't", "isn't", "you're", "that's".

You are allowed to be blunt, unimpressed, and visibly bored. You are not allowed
to be pleasant on autopilot.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Dossier → instructions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the researched speech profile into the prompt.
 *
 * Only the validated structured fields of the dossier are used, never the raw
 * search text — harvested material is untrusted input (CLAUDE.md §14) and this
 * is a system prompt.
 *
 * Gated on `publicFootprint`. A thin dossier means the search did not find
 * enough real first-person material, and following a speech profile that was
 * confidently invented from three quotes produces a caricature of someone real.
 * In that case the generic `HUMAN_SPEECH` rules carry the turn on their own,
 * which is the behaviour the app had before dossiers existed.
 */
export function speechDirective(source: Enrichment | null | undefined): string {
  const speech = speechProfile(source);
  if (!speech) return '';

  const parts: string[] = [`YOUR OWN SPEECH PATTERN — observed from your own words.`];

  if (speech.rhythm) parts.push(speech.rhythm);
  if (speech.register) parts.push(`Register: ${speech.register}`);
  if (speech.humour) parts.push(`Humour: ${speech.humour}`);

  if (speech.tics.length) {
    parts.push(`Habits, which you should actually perform rather than describe:`);
    parts.push(speech.tics.map((t) => `- ${t}`).join('\n'));
  }

  // Capped: handed twenty phrases, the model works every one into every turn
  // and the result is a parody. Four leaves room for them to recur naturally.
  if (speech.signaturePhrases.length) {
    parts.push(
      `Phrases you actually use — sparingly, no more than one in a turn, and only ` +
        `where it fits: ${speech.signaturePhrases.slice(0, 4).map((p) => `"${p}"`).join(', ')}`,
    );
  }

  if (speech.neverSays.length) {
    parts.push(`You never say: ${speech.neverSays.slice(0, 8).map((p) => `"${p}"`).join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Corpus voice beats dossier voice.
 *
 * The corpus profile was written by a model that read the person's complete body
 * of work; the dossier profile was written from three search results. When both
 * exist they broadly agree, and where they disagree the corpus is better
 * evidence.
 *
 * A `thin` dossier is discarded entirely — see `speechDirective`. Following a
 * speech pattern confidently invented from almost no material produces a
 * caricature of a real person, which is the one failure mode worth refusing.
 */
function speechProfile(source: Enrichment | null | undefined): SpeechProfile | undefined {
  if (source?.corpus) return source.corpus.voice;
  if (source?.dossier && source.dossier.publicFootprint !== 'thin') return source.dossier.speech;
  return undefined;
}

/**
 * The convictions block — what turns a checklist into an interrogation.
 *
 * The `argument` is included, not just the belief. Given a belief alone the model
 * asserts it once and moves on; given the reasoning behind it, the model can
 * keep pushing when a founder pushes back, which is what a real conviction looks
 * like from the other side of the table.
 *
 * Deliberately NOT the whole set. Handed fourteen convictions the model tries to
 * work through them like an agenda, and an investor marching through fourteen
 * positions is a survey, not a meeting. Six sit in the system prompt as
 * disposition; the rest arrive per-turn when the founder actually trips one
 * (`convictionDirective`).
 */
export function beliefsDirective(persona: CorpusPersona | null | undefined): string {
  if (!persona) return '';

  const parts: string[] = [];

  if (persona.convictions.length) {
    parts.push(
      `WHAT YOU BELIEVE, AND WHY. These are your own positions, argued at length in ` +
        `your own writing. You are not reciting them — you hold them, so you push on ` +
        `whichever one the conversation actually touches.`,
    );
    parts.push(
      persona.convictions
        .slice(0, 6)
        .map((c) => `- ${c.belief}\n    because: ${c.argument}`)
        .join('\n'),
    );
  }

  if (persona.diagnostics.length) {
    parts.push(
      `\nHOW YOU TAKE A CLAIM APART. Do these, do not describe them:\n` +
        persona.diagnostics
          .slice(0, 6)
          .map((d) => `- ${d.move} (when ${d.when})`)
          .join('\n'),
    );
  }

  if (persona.canon.length) {
    parts.push(
      `\nTERMS THAT ARE YOURS, and that you use naturally rather than explaining: ` +
        persona.canon.slice(0, 10).join(', ') + '.',
    );
  }

  if (persona.dismissals.length) {
    parts.push(
      `\nWHAT YOU HAVE NO PATIENCE FOR. Be visibly uninterested when it comes up:\n` +
        persona.dismissals.slice(0, 6).map((d) => `- ${d}`).join('\n'),
    );
  }

  return parts.join('\n');
}

/**
 * A per-turn directive for convictions the founder just walked into.
 *
 * This is the retrieval half of the corpus feature and the reason questions stop
 * being generic: the founder says "we're growing 40% month over month", that
 * phrase matches a trigger, and the investor arrives with the specific argument
 * they have made in print about growth rates — rather than the median follow-up
 * question about growth rates.
 */
export function convictionDirective(convictions: Conviction[]): string {
  if (convictions.length === 0) return '';

  const first = convictions[0];
  if (!first) return '';

  return (
    `They have just walked into something you have a real position on.\n\n` +
    `Your view: ${first.belief}\n` +
    `Your reasoning: ${first.argument}\n\n` +
    `Press on it now, in your own words. You have put it this way before: ` +
    `"${first.question}"\n\n` +
    `Do not quote yourself, cite an essay, or mention having written anything. ` +
    `You are not making a reference — this is simply what you think.`
  );
}

/**
 * How to open the meeting.
 *
 * The cold-open problem in one function. Without this the model is asked to
 * "open the meeting" with nothing but a temperament, and produces the safest
 * possible greeting — which is what makes the first ten seconds feel synthetic
 * and sets the tone for everything after.
 *
 * The examples are explicitly models rather than lines, because handed an
 * example a model will otherwise recite it verbatim, and every session opens
 * identically.
 */
export function openingDirective(persona: CorpusPersona | null | undefined): string {
  if (!persona?.opening.style) return '';

  const examples = persona.opening.examples.length
    ? `\n\nOpenings in your voice, as models for TONE only — do not reuse the wording:\n` +
      persona.opening.examples.map((e) => `- "${e}"`).join('\n')
    : '';

  return `HOW YOU OPEN A FIRST MEETING\n\n${persona.opening.style}${examples}`;
}

/**
 * What this investor is known to press on, as prompt text.
 *
 * The `why` is included on purpose. Given only a question to ask, the model asks
 * it once and moves on; given the reason the investor cares, it pursues the
 * thread the way someone with a real conviction does.
 */
export function knowledgeDirective(dossier: Dossier | null | undefined): string {
  if (!dossier) return '';

  const parts: string[] = [];

  if (dossier.pressurePoints.length) {
    parts.push(
      `WHAT YOU ALWAYS PUSH ON. These are your actual, publicly stated concerns — ` +
        `not a checklist. Pursue whichever the conversation opens up.`,
    );
    parts.push(
      dossier.pressurePoints
        .slice(0, 6)
        .map((p) => `- ${p.topic}: ${p.why}\n    you have put it as: "${p.question}"`)
        .join('\n'),
    );
  }

  if (dossier.dealbreakers.length) {
    parts.push(
      `\nWHAT MAKES YOU PASS:\n` +
        dossier.dealbreakers.slice(0, 5).map((d) => `- ${d.text}`).join('\n'),
    );
  }

  if (dossier.positions.length) {
    parts.push(
      `\nVIEWS YOU HOLD, and will argue for if the founder touches them:\n` +
        dossier.positions.slice(0, 6).map((p) => `- ${p.topic}: ${p.stance}`).join('\n'),
    );
  }

  // Named investments are the single most effective realism cue available: an
  // investor who references something from their own portfolio is instantly
  // more credible than one who speaks only in generalities. Capped at three and
  // fenced with an accuracy rule, because this is the exact place where the
  // model would otherwise start inventing deals.
  if (dossier.notableInvestments.length) {
    parts.push(
      `\nCOMPANIES YOU ACTUALLY BACKED: ` +
        dossier.notableInvestments.slice(0, 3).map((i) => i.company).join(', ') +
        `.\nYou may mention one if it is genuinely relevant. Say nothing about it beyond ` +
        `the fact that you backed it — do not invent numbers, outcomes or anecdotes.`,
    );
  }

  return parts.join('\n');
}

/**
 * The full personality block: generic speech rules, then this person's own.
 *
 * Order matters. The generic prohibitions come first so the specific pattern can
 * override them — a real investor who genuinely says "look, however" should say
 * it, and the researched profile is better evidence than our blanket ban.
 */
export function personalityBlock(
  profile: InvestorProfile,
  enrichment?: Enrichment | null,
): string {
  const parts = [HUMAN_SPEECH];

  const speech = speechDirective(enrichment);
  if (speech) parts.push(`\n${speech}`);

  // Dossier knowledge only. Corpus convictions are a much stronger signal and
  // are injected separately by `beliefsDirective`; stacking both would hand the
  // model two overlapping agendas and it would try to work through each.
  const knowledge = enrichment?.corpus ? '' : knowledgeDirective(enrichment?.dossier);
  if (knowledge) parts.push(`\n${knowledge}`);

  // The blowhard is the one profile where length is the joke, so the "one
  // thought per turn" rule would flatten exactly what makes it work.
  if (profile.derailment >= 0.7) {
    parts.push(
      `\nYou are an exception to the one-thought rule: you run on. Keep it to three ` +
        `sentences, but let them sprawl and change direction mid-way.`,
    );
  }

  return parts.join('\n');
}
