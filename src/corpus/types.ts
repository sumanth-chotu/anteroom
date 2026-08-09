/**
 * The persona shape, and the one function that reads it at conversation time.
 *
 * Split from `persona.ts` so that nothing on the runtime path imports the
 * synthesis pipeline. `persona.ts` pulls in the xAI client, which reads
 * `XAI_API_KEY` at module load — so importing it from the engine, the relay or a
 * unit test made all three depend on a configured API key to look at a struct.
 * Same reasoning as `corpus/store.ts` and `investor/dossier-store.ts`.
 *
 * Everything here is pure: types, and substring matching over them.
 */

import type { SpeechProfile } from '../investor/dossier.ts';

export interface Conviction {
  belief: string;
  /** The reasoning they actually deploy, not a restatement of the belief. */
  argument: string;
  /** Lowercased phrases in a founder's pitch that should activate this. */
  triggersOn: string[];
  /** How they put it to someone, in their own phrasing. */
  question: string;
  quote: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface Diagnostic {
  /** The move, as an instruction. */
  move: string;
  /** What in a founder's answer triggers it. */
  when: string;
  /** How it sounds when they do it. */
  example: string;
}

export interface Opening {
  /** How they begin a first meeting, as an instruction. */
  style: string;
  /** Two or three openers in their voice. Rotated, never read verbatim. */
  examples: string[];
}

export interface CorpusPersona {
  profileId: string;
  person: string;
  builtAt: string;
  corpus: {
    label: string;
    documents: number;
    chars: number;
    /** Titles actually fed to the model — the provenance of the persona. */
    titles: string[];
  };
  convictions: Conviction[];
  diagnostics: Diagnostic[];
  canon: string[];
  dismissals: string[];
  opening: Opening;
  voice: SpeechProfile;
  cost: { seconds: number; promptTokens: number; completionTokens: number };
}

/**
 * Shortest trigger that is allowed to match.
 *
 * Below this, a trigger fires on everything: a two-letter "ai" matches "said",
 * "chain" and "detail", and the investor presses a conviction the founder never
 * touched. A wrong conviction is worse than a missed one — it makes the persona
 * look like it is not listening, which is the exact opposite of the goal.
 */
const MIN_TRIGGER_LENGTH = 4;

/**
 * Which convictions the founder just walked into.
 *
 * Substring matching. No embeddings, no vector store, no model call — this runs
 * on the conversation's latency path, where a second round trip is felt. Crude,
 * and crude is the right trade: `triggersOn` was written at build time by a model
 * that had read the person's entire body of work, so the matching does not need
 * to be clever to land on the right belief.
 *
 * Scored by distinct triggers hit, so a founder who says three things that all
 * point at one conviction gets pressed hard on that one rather than lightly on
 * three.
 */
export function relevantConvictions(
  persona: CorpusPersona | null | undefined,
  founderText: string,
  limit = 3,
): Conviction[] {
  return scoredConvictions(persona, founderText, limit).map((scored) => scored.conviction);
}

export interface ScoredConviction {
  conviction: Conviction;
  /** Distinct triggers hit. 2+ means the founder leaned on the idea, not brushed it. */
  hits: number;
  /**
   * The exact trigger phrases found in the founder's words.
   *
   * Kept so the UI can highlight them in the transcript. The mechanism is the
   * most convincing thing about this feature and it is invisible otherwise — a
   * conviction that fires looks like luck until you can see the words that fired
   * it sitting in your own sentence.
   */
  matched: string[];
}

/**
 * How many triggers a belief needs before it may interrupt an in-progress thread.
 *
 * One hit is a passing mention — a founder who says "platform" once has not
 * necessarily made a claim about focus, and dropping the current question to
 * pounce would read as an investor with no attention span. Two or more distinct
 * triggers means they actually leaned on the idea, and pursuing it is what a
 * person with a real conviction does.
 */
export const STRONG_CONVICTION_HITS = 2;

export function scoredConvictions(
  persona: CorpusPersona | null | undefined,
  founderText: string,
  limit = 3,
): ScoredConviction[] {
  if (!persona) return [];
  const haystack = founderText.toLowerCase();
  if (haystack.trim().length === 0) return [];

  return persona.convictions
    .map((conviction) => {
      const matched = [
        ...new Set(
          conviction.triggersOn
            .map((trigger) => trigger.toLowerCase().trim())
            .filter((trigger) => trigger.length >= MIN_TRIGGER_LENGTH && haystack.includes(trigger)),
        ),
      ];
      return { conviction, hits: matched.length, matched };
    })
    .filter((scored) => scored.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
}
