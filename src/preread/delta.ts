/**
 * The posture delta. (PLAN.md §6.6)
 *
 * The most novel artifact in the product: re-run the investor's assessment
 * after the meeting and diff it against the pre-read.
 *
 *   Going in, I thought your weak point was distribution.
 *   Coming out, distribution is fine — you answered that at 08:12.
 *   But I'm more worried about retention than when I started.
 *
 * That maps onto the only two things a founder needs to know: what you fixed in
 * the room, and what you made worse. No founder has ever been told either.
 *
 * ISOLATION: like the grader (PLAN.md §9.1), this call never sees the persona
 * prompt or any instruction about being encouraging. It sees the memo and the
 * transcript, and nothing about how the investor was told to behave.
 */

import { z } from 'zod';
import { chatStructured } from '../xai/client.ts';
import type { PreReadMemo, Posture } from './types.ts';

export type Standing = 'concern' | 'neutral' | 'strength';

const Delta = z.object({
  dimensions: z.array(
    z.object({
      dimension: z.string(),
      preRead: z.enum(['concern', 'neutral', 'strength']),
      postMeeting: z.enum(['concern', 'neutral', 'strength']),
      whatChanged: z.string(),
    }),
  ),
  finalPosture: z.enum(['leaning_in', 'neutral', 'skeptical', 'looking_for_the_no']),
  finalPostureReason: z.string(),
  fixedInTheRoom: z.array(z.string()),
  madeWorse: z.array(z.string()),
});

export interface PostureDeltaResult extends z.infer<typeof Delta> {
  initialPosture: Posture;
  /** -1 worse, 0 unchanged, +1 better. */
  direction: -1 | 0 | 1;
}

const POSTURE_RANK: Record<Posture, number> = {
  looking_for_the_no: 0,
  skeptical: 1,
  neutral: 2,
  leaning_in: 3,
};

const deltaJsonSchema = {
  type: 'object',
  properties: {
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dimension: {
            type: 'string',
            description: 'Short label for the thing being judged: "retention", "competition", "team".',
          },
          preRead: { type: 'string', enum: ['concern', 'neutral', 'strength'] },
          postMeeting: { type: 'string', enum: ['concern', 'neutral', 'strength'] },
          whatChanged: {
            type: 'string',
            description:
              'The specific thing said that moved it, quoted or closely paraphrased. If nothing ' +
              'moved it, say that plainly — "never came up" is a valid and useful answer.',
          },
        },
        required: ['dimension', 'preRead', 'postMeeting', 'whatChanged'],
        additionalProperties: false,
      },
    },
    finalPosture: {
      type: 'string',
      enum: ['leaning_in', 'neutral', 'skeptical', 'looking_for_the_no'],
      description: 'Where you land AFTER the conversation.',
    },
    finalPostureReason: { type: 'string', description: 'One sentence.' },
    fixedInTheRoom: {
      type: 'array', items: { type: 'string' },
      description: 'Concerns the conversation genuinely resolved. Empty if none — do not invent any.',
    },
    madeWorse: {
      type: 'array', items: { type: 'string' },
      description: 'Things you are MORE worried about than before the meeting.',
    },
  },
  required: ['dimensions', 'finalPosture', 'finalPostureReason', 'fixedInTheRoom', 'madeWorse'],
  additionalProperties: false,
};

const SYSTEM = `
You read a startup's deck before a meeting and wrote private notes. The meeting
has now happened. Re-assess.

Your job is the DIFF, not a fresh review. For each thing you flagged going in,
did the conversation move it — and did anything new start bothering you?

Be strict in both directions:

- A concern is only resolved if the founder gave something concrete that
  resolves it. Reassurance is not resolution. "We're very focused on retention"
  does not move retention.
- Be equally willing to record that something got WORSE. A founder who dodged a
  question three times has made you more worried, not less, and saying so is the
  single most useful thing in this report.
- If a concern simply never came up, say so. That is not a resolution — it is a
  missed opportunity, and the founder should know they never addressed it.
- Do not invent resolutions to be encouraging. An empty fixedInTheRoom list is a
  perfectly valid outcome and is better than a fabricated one.

Judge only what is in the transcript.
`.trim();

export interface TranscriptTurn {
  role: 'investor' | 'founder';
  text: string;
  /** Elapsed-time label for citation, e.g. "04:12". */
  stamp?: string;
}

export async function computePostureDelta(
  memo: PreReadMemo,
  transcript: TranscriptTurn[],
): Promise<PostureDeltaResult> {
  const rendered = transcript
    .map((t) => `${t.stamp ? `[${t.stamp}] ` : ''}${t.role === 'investor' ? 'INVESTOR' : 'FOUNDER'}: ${t.text}`)
    .join('\n\n');

  const priorFlags = memo.redFlags
    .map((f) => `${f.rank}. ${f.summary} — ${f.whyItMatters}`)
    .join('\n');

  const { data } = await chatStructured(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `<your_notes_before_the_meeting>\n` +
          `Posture: ${memo.initialPosture} (${memo.postureReason})\n\n` +
          `What bothered you:\n${priorFlags}\n\n` +
          `Your case for passing:\n${memo.caseForNo}\n` +
          `</your_notes_before_the_meeting>\n\n` +
          `<transcript>\n${rendered}\n</transcript>`,
      },
    ],
    Delta,
    deltaJsonSchema,
    { schemaName: 'posture_delta', tag: 'preread:delta', reasoningEffort: 'high', maxTokens: 8192 },
  );

  const before = POSTURE_RANK[memo.initialPosture];
  const after = POSTURE_RANK[data.finalPosture as Posture];

  return {
    ...data,
    initialPosture: memo.initialPosture,
    direction: after > before ? 1 : after < before ? -1 : 0,
  };
}
