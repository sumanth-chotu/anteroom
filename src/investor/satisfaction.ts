/**
 * The satisfaction gate. (PLAN.md §3.4)
 *
 * The single biggest gap between a naive build and a real one. Default LLM
 * behaviour is to accept any answer and move to the next question. Investors do
 * not — they ask the same thing three ways before giving up.
 *
 * Every founder answer passes through here before the engine picks what to ask
 * next. Runs at low reasoning effort because it must stay fast enough to sit
 * inside a voice turn later (~200ms budget, PLAN.md §3.4).
 *
 * SECURITY: the answer is untrusted input. Delimited, never in the system prompt.
 */

import { z } from 'zod';
import { chatStructured } from '../xai/client.ts';
import type { SpineTopic } from './spine.ts';

export type Answered = 'answered' | 'partial' | 'dodged' | 'non_answer';
export type Specificity = 'concrete' | 'qualitative' | 'hand_wave';

const Verdict = z.object({
  answered: z.enum(['answered', 'partial', 'dodged', 'non_answer']),
  specificity: z.enum(['concrete', 'qualitative', 'hand_wave']),
  missing: z.string(),
  reasoning: z.string(),
});

export type SatisfactionVerdict = z.infer<typeof Verdict> & {
  /** True when the engine should move on. */
  satisfied: boolean;
};

const verdictJsonSchema = {
  type: 'object',
  properties: {
    answered: {
      type: 'string',
      enum: ['answered', 'partial', 'dodged', 'non_answer'],
      description:
        'answered = addressed the question asked. partial = addressed some of it. ' +
        'dodged = answered an adjacent question instead. non_answer = said nothing substantive.',
    },
    specificity: {
      type: 'string',
      enum: ['concrete', 'qualitative', 'hand_wave'],
      description:
        'concrete = named numbers, people, dates. qualitative = descriptive but unquantified. ' +
        'hand_wave = adjectives and intentions only.',
    },
    missing: {
      type: 'string',
      description:
        'The single most important thing still absent. One short phrase. Empty string if nothing.',
    },
    reasoning: { type: 'string', description: 'One sentence.' },
  },
  required: ['answered', 'specificity', 'missing', 'reasoning'],
  additionalProperties: false,
};

const SYSTEM = `
You judge whether a startup founder actually answered the question they were
asked. You are strict. Founders routinely answer an adjacent question they would
rather answer, and a generous reading of that is what makes pitch practice
useless.

Judge only what is present in the answer. Do not credit the founder for context
you assume they have, and do not penalise them for anything outside the scope of
the question asked.

Rules of thumb:
- A quantitative question needs a quantity. "A lot", "several", "loads of
  inbound" is a hand_wave, not an answer.
- Answering a narrower or easier version of the question is dodged, not partial.
- Enthusiasm is not specificity.
- Naming real people, companies, dates or numbers is concrete. Describing them
  in general terms is qualitative.
- If they explicitly say they do not know or do not have the number, that is
  answered + qualitative, not dodged. Admitting a gap is an answer.
`.trim();

/**
 * Judge one answer.
 *
 * `satisfied` requires both a real answer AND a concrete one — that conjunction
 * is what forces the follow-up loop that makes this feel like an investor.
 */
export async function judgeAnswer(
  question: string,
  answer: string,
  topic?: SpineTopic,
): Promise<SatisfactionVerdict> {
  const expectation = topic
    ? `\n\nWhat the investor was trying to learn: ${topic.intent}\n` +
      `A satisfying answer: ${topic.satisfiedWhen}`
    : '';

  const { data } = await chatStructured(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `<question>\n${question}\n</question>\n\n` +
          `<founder_answer>\n${answer}\n</founder_answer>` +
          expectation,
      },
    ],
    Verdict,
    verdictJsonSchema,
    {
      schemaName: 'satisfaction_verdict',
      tag: 'investor:satisfaction',
      reasoningEffort: 'low',
      maxTokens: 2048,
    },
  );

  return {
    ...data,
    satisfied: data.answered === 'answered' && data.specificity === 'concrete',
  };
}
