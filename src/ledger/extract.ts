/**
 * Claim extraction. (PLAN.md §7)
 *
 * Pulls every number a founder states out of a single answer and normalizes it
 * onto the canonical metric vocabulary, so the deterministic checks can
 * cross-reference claims made twenty minutes apart.
 *
 * Normalization at extraction time is the whole trick: "a dozen logos",
 * "twelve customers" and "12 paying accounts" must collide, or nothing catches.
 *
 * SECURITY: the founder's answer is untrusted input (CLAUDE.md). It is passed
 * as a user message inside explicit delimiters, never concatenated into the
 * system prompt.
 */

import { z } from 'zod';
import { chatStructured } from '../xai/client.ts';
import { METRIC_KEYS, type Claim, type MetricKey } from './types.ts';

const ExtractedClaim = z.object({
  metric: z.enum(METRIC_KEYS),
  value: z.number().nullable(),
  valueRaw: z.string(),
  unit: z.string(),
  period: z.string(),
  verbatim: z.string(),
  confidence: z.number().min(0).max(1),
});

const ExtractionResult = z.object({
  claims: z.array(ExtractedClaim),
});

const extractionJsonSchema = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: [...METRIC_KEYS] },
          value: {
            type: ['number', 'null'],
            description: 'Numeric value, normalized. Percentages as the number (40 for 40%). Null if not quantitative.',
          },
          valueRaw: { type: 'string', description: 'Value exactly as stated, e.g. "about a dozen".' },
          unit: { type: 'string', description: 'Unit if any: USD, %, months, people. Empty string if none.' },
          period: {
            type: 'string',
            description: 'Period as stated: "last 30 days", "Jan 2026", "TTM". Empty string if unspecified.',
          },
          verbatim: {
            type: 'string',
            description: 'The exact words from the answer containing this claim. Never paraphrase.',
          },
          confidence: {
            type: 'number',
            description: '0-1. Below 0.6 for anything inferred rather than stated.',
          },
        },
        required: ['metric', 'value', 'valueRaw', 'unit', 'period', 'verbatim', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['claims'],
  additionalProperties: false,
};

const EXTRACTION_SYSTEM = `
You extract quantitative claims from a startup founder's spoken answer.

Return every number, count, rate, date or money figure the founder states. If
they state no numbers, return an empty list. Do not invent or infer figures that
were not said.

METRIC SELECTION IS THE IMPORTANT PART. These are deliberately distinct and must
never be collapsed:

- design_partners   — companies trialling, typically unpaid
- pilots            — time-boxed paid or unpaid trials
- lois              — letters of intent; not contracts, not revenue
- customers_total   — all customers, paying or not
- customers_paying  — customers who actually transfer money
- signups / waitlist / downloads — soft interest, not customers

Pick the rung the founder's own words support, NOT the most flattering one. If
they say "we have 12 design partners" the metric is design_partners even if they
later call them customers. If they say "customers" with no indication of payment,
use customers_total, not customers_paying. Only use customers_paying when payment
is explicit.

"users" or "people using it" → active_users.
Growth stated as a percentage → growth_rate_wow or growth_rate_mom by the period
given; value is the number (40 for "40%").
Money → normalize to a plain number (2000000 for "$2M").

verbatim must be the founder's exact words. It is quoted back to them in the
report, so a paraphrase there is a bug.

Set confidence below 0.6 when you are inferring rather than reading.
`.trim();

export interface ExtractOptions {
  sessionId: string;
  turnId: string;
  source?: 'deck' | 'spoken';
  slideNumber?: number;
}

let claimSeq = 0;

/** Extract claims from one founder answer. Returns [] when nothing quantitative was said. */
export async function extractClaims(answer: string, options: ExtractOptions): Promise<Claim[]> {
  if (answer.trim().length < 3) return [];

  const { data } = await chatStructured(
    [
      { role: 'system', content: EXTRACTION_SYSTEM },
      {
        role: 'user',
        content:
          'Extract claims from the founder answer between the markers.\n\n' +
          `<founder_answer>\n${answer}\n</founder_answer>`,
      },
    ],
    ExtractionResult,
    extractionJsonSchema,
    {
      schemaName: 'claim_extraction',
      tag: 'ledger:extract',
      reasoningEffort: 'low',
      maxTokens: 4096,
    },
  );

  const now = Date.now();
  return data.claims.map((raw): Claim => {
    claimSeq += 1;
    const claim: Claim = {
      id: `${options.sessionId}-c${claimSeq}`,
      sessionId: options.sessionId,
      source: options.source ?? 'spoken',
      metric: raw.metric as MetricKey,
      value: raw.value,
      valueRaw: raw.valueRaw,
      verbatim: raw.verbatim,
      confidence: raw.confidence,
      createdAt: now,
    };
    if (options.source === 'deck' && options.slideNumber !== undefined) {
      claim.slideNumber = options.slideNumber;
    } else {
      claim.turnId = options.turnId;
    }
    if (raw.unit) claim.unit = raw.unit;
    if (raw.period) claim.period = raw.period;
    return claim;
  });
}
