/**
 * The seed question spine. (PLAN.md §3.5)
 *
 * A deterministic coverage checklist. The conversation can drift wherever it
 * likes, but the spine guarantees no whole topic gets skipped — which is what
 * makes coverage *testable* rather than a matter of vibes.
 *
 * Explicitly NOT the Series A list. No NRR, no payback period, no magic number.
 */

export type SpineTopicId =
  | 'why_you'
  | 'why_now'
  | 'insight'
  | 'wedge'
  | 'pull'
  | 'competition'
  | 'feature_or_company'
  | 'the_ask';

export interface SpineTopic {
  id: SpineTopicId;
  label: string;
  /** What the investor is actually trying to learn. Goes into the prompt. */
  intent: string;
  /** What a satisfying answer contains. Used by the satisfaction gate. */
  satisfiedWhen: string;
  /** Fallback phrasing if nothing more specific is available. */
  defaultQuestion: string;
}

export const SEED_SPINE: readonly SpineTopic[] = [
  {
    id: 'why_you',
    label: 'Why you',
    intent:
      'Whether this team has an unfair advantage in this specific market, or is simply available.',
    satisfiedWhen:
      'They name specific, verifiable experience or access that bears directly on this problem — not generic credentials.',
    defaultQuestion: 'Why are you the right people to build this?',
  },
  {
    id: 'why_now',
    label: 'Why now',
    intent:
      'Whether something concrete changed — technology, regulation, cost curve, behaviour — or this was always possible and nobody wanted it.',
    satisfiedWhen:
      'They identify a specific recent change and explain why it makes this viable now when it was not before.',
    defaultQuestion: 'Why is this possible now and not three years ago?',
  },
  {
    id: 'insight',
    label: 'The insight',
    intent:
      'Whether they hold a non-obvious belief about this market that most people would disagree with.',
    satisfiedWhen:
      'They state something contrarian and specific that a knowledgeable person could actually dispute.',
    defaultQuestion: 'What do you believe about this market that most people building here would disagree with?',
  },
  {
    id: 'wedge',
    label: 'The wedge',
    intent: 'Whether they can name exactly what they sell first, and to exactly whom.',
    satisfiedWhen:
      'They name a specific first buyer and a specific first product — not a platform vision or a list of segments.',
    defaultQuestion: 'What exactly do you sell, and who writes the first cheque?',
  },
  {
    id: 'pull',
    label: 'Evidence of pull',
    intent:
      'Whether anyone actually wants this. At seed that is usage and repeat behaviour, not necessarily revenue.',
    satisfiedWhen:
      'They give concrete usage numbers, named users, retention or repeat behaviour — not signups, waitlists or downloads.',
    defaultQuestion: 'Who is using this today, and how do you know they will come back?',
  },
  {
    id: 'competition',
    label: 'Competition',
    intent:
      'Whether they know the field. Claiming no competitors nearly always means they have not looked.',
    satisfiedWhen:
      'They name real alternatives — including the status quo — and articulate a specific, defensible difference.',
    defaultQuestion: 'Who else is solving this, and why do you win?',
  },
  {
    id: 'feature_or_company',
    label: 'Feature or company',
    intent: 'Whether an incumbent could ship this in a quarter and end the story.',
    satisfiedWhen:
      'They give a structural reason an incumbent would not or could not do this — incentives, data, distribution — not just that they are faster.',
    defaultQuestion: 'Why does the obvious incumbent not just build this themselves?',
  },
  {
    id: 'the_ask',
    label: 'The ask',
    intent: 'Whether they know what the money buys and what it proves.',
    satisfiedWhen:
      'They state an amount, a runway, and a specific milestone that money is meant to reach.',
    defaultQuestion: 'How much are you raising, and what does it buy you?',
  },
] as const;

export function topicById(id: SpineTopicId): SpineTopic {
  const topic = SEED_SPINE.find((t) => t.id === id);
  if (!topic) throw new Error(`Unknown spine topic: ${id}`);
  return topic;
}
