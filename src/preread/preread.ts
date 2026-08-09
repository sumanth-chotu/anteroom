/**
 * The five-pass pre-read. (PLAN.md §6.2)
 *
 *   1. Per-slide vision      → deck/vision.ts
 *   2. Cross-slide + checks  → deck/analyse.ts
 *   3. Category priors       → Phase 4; empty for now
 *   4. Adversarial partner   → the case for NO
 *   5. Synthesis             → the memo
 *
 * Pass 4 runs BEFORE pass 5 and its output is fed in verbatim. That ordering is
 * the whole anti-sycophancy design at this stage: forcing an explicit
 * best-case-for-declining before synthesis is what stops the memo reading like
 * a pitch summary written by someone who wants to like it (PLAN.md §9.2).
 *
 * SECURITY: deck content is untrusted (CLAUDE.md). Slide critiques and
 * transcribed text are passed as user content inside delimiters, never
 * concatenated into a system prompt.
 */

import { z } from 'zod';
import { resolve } from 'node:path';

import { ingestDeck } from '../deck/ingest.ts';
import { critiqueDeck } from '../deck/vision.ts';
import { analyseDeck } from '../deck/analyse.ts';
import { extractClaims } from '../ledger/extract.ts';
import { chat, chatStructured, usageSummary } from '../xai/client.ts';
import type { Claim } from '../ledger/types.ts';
import type { DeckAnalysis } from '../deck/types.ts';
import type { PreReadMemo, Posture, PlannedProbe } from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Pass 4 — the adversarial partner
// ─────────────────────────────────────────────────────────────────────────────

const CASE_FOR_NO_SYSTEM = `
You are the most skeptical partner at a seed fund. A colleague is about to take
this meeting and has asked for your read on the deck first.

You have four minutes and you are inclined to pass. Make the case for declining.

Be specific and grounded in what is actually in the deck — cite slides and the
figures printed on them. Do not invent weaknesses that are not evidenced; a
partner who cries wolf gets ignored. If the deck is genuinely strong, say so and
make the strongest case you honestly can, however short.

Three or four sentences. Write it as a note to a colleague, not a report.
`.trim();

async function caseForNo(analysis: DeckAnalysis): Promise<string> {
  const digest = analysis.critiques
    .map(
      (c) =>
        `Slide ${c.slideNumber} (${c.detectedSection}) — reads as: ${c.landsAs}` +
        (c.issues.length ? `\n  issues: ${c.issues.join(', ')}` : '') +
        `\n  text: ${c.visibleText.slice(0, 400)}`,
    )
    .join('\n\n');

  const result = await chat(
    [
      { role: 'system', content: CASE_FOR_NO_SYSTEM },
      {
        role: 'user',
        content:
          `<deck_summary>\n${digest}\n</deck_summary>\n\n` +
          `<what_the_deck_says_they_do>${analysis.oneLinerFromFullDeck}</what_the_deck_says_they_do>\n` +
          `<missing_sections>${analysis.sectionsMissing.join(', ') || 'none'}</missing_sections>`,
      },
    ],
    { tag: 'preread:case-for-no', reasoningEffort: 'high', maxTokens: 4096 },
  );
  return result.text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 5 — synthesis
// ─────────────────────────────────────────────────────────────────────────────

const Synthesis = z.object({
  understood: z.array(z.string()),
  confused: z.array(z.string()),
  redFlags: z.array(
    z.object({
      rank: z.number(),
      summary: z.string(),
      slideNumbers: z.array(z.number()),
      whyItMatters: z.string(),
    }),
  ),
  plannedProbes: z.array(
    z.object({
      topic: z.string(),
      question: z.string(),
      origin: z.enum(['slide', 'contradiction', 'missing', 'category_prior']),
      slideRef: z.number(),
      priority: z.number(),
    }),
  ),
  initialPosture: z.enum(['leaning_in', 'neutral', 'skeptical', 'looking_for_the_no']),
  postureReason: z.string(),
});

const synthesisJsonSchema = {
  type: 'object',
  properties: {
    understood: {
      type: 'array', items: { type: 'string' },
      description: 'What came across clearly. 2-4 short phrases. Be honest — if little did, list little.',
    },
    confused: {
      type: 'array', items: { type: 'string' },
      description: 'What you still do not understand after reading the whole deck. 2-4 short phrases.',
    },
    redFlags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'number', description: '1 is what bothers you most.' },
          summary: { type: 'string' },
          slideNumbers: { type: 'array', items: { type: 'number' } },
          whyItMatters: { type: 'string', description: 'Why this specifically matters at seed stage.' },
        },
        required: ['rank', 'summary', 'slideNumbers', 'whyItMatters'],
        additionalProperties: false,
      },
    },
    plannedProbes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Short label, e.g. "paying customers".' },
          question: {
            type: 'string',
            description:
              'The actual question, phrased as you would ask it out loud. Must be answerable ' +
              'and specific to THIS deck — not a question you could ask any company.',
          },
          origin: { type: 'string', enum: ['slide', 'contradiction', 'missing', 'category_prior'] },
          slideRef: { type: 'number', description: 'Slide it came from; 0 if none.' },
          priority: { type: 'number', description: '1 = ask first.' },
        },
        required: ['topic', 'question', 'origin', 'slideRef', 'priority'],
        additionalProperties: false,
      },
    },
    initialPosture: {
      type: 'string',
      enum: ['leaning_in', 'neutral', 'skeptical', 'looking_for_the_no'],
      description: 'How you walk into the room having read this.',
    },
    postureReason: { type: 'string', description: 'One sentence.' },
  },
  required: ['understood', 'confused', 'redFlags', 'plannedProbes', 'initialPosture', 'postureReason'],
  additionalProperties: false,
};

const SYNTHESIS_SYSTEM = `
You are a seed investor who has just read a deck ahead of a first meeting.
Produce your private pre-read notes.

These are notes to yourself, not feedback for the founder. Be blunt. Nobody else
reads this.

On planned probes — this is the important part. List the 4 to 6 things you
intend to dig into, ranked. Each must be:
- Specific to THIS deck. "What's your CAC?" could be asked of anyone and is
  worthless here. "Slide 4 shows 12 design partners and slide 8 shows 8 paying
  customers — what happened to the other four?" is a real question.
- Answerable in a meeting.
- Phrased the way you would actually say it out loud.

On posture — be honest about how you walk in:
- leaning_in: genuinely interested, want to be convinced
- neutral: open, no strong prior
- skeptical: several things bother you, need convincing
- looking_for_the_no: you expect to pass and are looking for the reason

A colleague has already written the case for declining. Take it seriously — it
is deliberately one-sided, but it was written from the same deck you just read.
`.trim();

async function synthesise(analysis: DeckAnalysis, noCase: string) {
  const digest = analysis.critiques
    .map(
      (c) =>
        `Slide ${c.slideNumber} (${c.detectedSection}) [${c.verdict}] — ${c.landsAs}` +
        (c.issues.length ? `\n  issues: ${c.issues.join(', ')}` : '') +
        `\n  evidence: ${c.evidence}`,
    )
    .join('\n\n');

  const findings = analysis.findings
    .map((f) => `[${f.severity}] ${f.summary}${f.slideNumbers.length ? ` (slide ${f.slideNumbers.join(', ')})` : ''}`)
    .join('\n');

  const { data } = await chatStructured(
    [
      { role: 'system', content: SYNTHESIS_SYSTEM },
      {
        role: 'user',
        content:
          `<slides>\n${digest}\n</slides>\n\n` +
          `<automated_findings>\n${findings}\n</automated_findings>\n\n` +
          `<one_liner_slide1>${analysis.oneLinerFromSlide1}</one_liner_slide1>\n` +
          `<one_liner_full_deck>${analysis.oneLinerFromFullDeck}</one_liner_full_deck>\n` +
          `<missing_sections>${analysis.sectionsMissing.join(', ') || 'none'}</missing_sections>\n\n` +
          `<colleagues_case_for_declining>\n${noCase}\n</colleagues_case_for_declining>`,
      },
    ],
    Synthesis,
    synthesisJsonSchema,
    { schemaName: 'preread_synthesis', tag: 'preread:synthesis', reasoningEffort: 'high', maxTokens: 8192 },
  );
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface PreReadResult {
  memo: PreReadMemo;
  analysis: DeckAnalysis;
}

/** Run the full pre-read. Nothing here is latency-bound — it happens before the founder joins. */
export async function generatePreRead(deckPath: string): Promise<PreReadResult> {
  const t0 = Date.now();
  const before = usageSummary();

  // Passes 1–2
  const { slides } = await ingestDeck(resolve(deckPath));
  const critiques = await critiqueDeck(slides);
  const analysis = await analyseDeck(slides, critiques);

  // Deck claims — seeded into the session ledger so the very first spoken
  // number can already contradict the deck.
  const claimBatches = await Promise.all(
    critiques
      .filter((c) => c.numbers.length > 0)
      .map((c) =>
        extractClaims(`${c.numbers.map((n) => `${n.label}: ${n.value}`).join('\n')}\n\n${c.visibleText}`, {
          sessionId: 'preread',
          turnId: `slide-${c.slideNumber}`,
          source: 'deck',
          slideNumber: c.slideNumber,
        }),
      ),
  );
  const claims: Claim[] = claimBatches.flat();

  // Pass 4, then pass 5 — strictly ordered. The case for no is an input to
  // synthesis, not a sibling of it.
  const noCase = await caseForNo(analysis);
  const synth = await synthesise(analysis, noCase);

  const after = usageSummary();

  const plannedProbes: PlannedProbe[] = synth.plannedProbes
    .sort((a, b) => a.priority - b.priority)
    .map((p, i) => {
      const probe: PlannedProbe = {
        id: `probe-${i + 1}`,
        topic: p.topic,
        question: p.question,
        origin: p.origin,
        priority: p.priority,
        resolved: 'unasked',
      };
      if (p.slideRef > 0) probe.slideRef = p.slideRef;
      return probe;
    });

  const memo: PreReadMemo = {
    generatedAt: new Date().toISOString(),
    deckPath,
    slideCount: slides.length,
    oneLinerFromSlide1: analysis.oneLinerFromSlide1,
    oneLinerFromFullDeck: analysis.oneLinerFromFullDeck,
    understood: synth.understood,
    confused: synth.confused,
    missingSections: analysis.sectionsMissing,
    claims,
    slideCritiques: critiques,
    redFlags: synth.redFlags.sort((a, b) => a.rank - b.rank),
    priors: [],
    caseForNo: noCase,
    plannedProbes,
    initialPosture: synth.initialPosture as Posture,
    postureReason: synth.postureReason,
    deckScore: analysis.score,
    cost: {
      seconds: (Date.now() - t0) / 1000,
      calls: after.calls - before.calls,
      promptTokens: after.totalPromptTokens - before.totalPromptTokens,
      completionTokens: after.totalCompletionTokens - before.totalCompletionTokens,
    },
  };

  return { memo, analysis };
}
