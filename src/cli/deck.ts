/**
 * Deck analysis CLI.
 *
 *   npm run deck -- fixtures/decks/planted-flaws/deck.pdf
 *   npm run deck -- <path> --json
 */

import { resolve } from 'node:path';
import { ingestDeck, MissingToolError } from '../deck/ingest.ts';
import { critiqueDeck } from '../deck/vision.ts';
import { analyseDeck } from '../deck/analyse.ts';
import { usageSummary } from '../xai/client.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const path = args.find((a) => !a.startsWith('--'));

if (!path) {
  console.error('usage: npm run deck -- <deck.pdf|pptx|png> [--json]');
  process.exit(1);
}

const t0 = Date.now();

let ingested;
try {
  ingested = await ingestDeck(resolve(path));
} catch (error) {
  if (error instanceof MissingToolError) {
    console.error(`\n${C.red('✗')} ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

if (!asJson) {
  console.log(
    `\n${C.bold('Deck')} ${C.dim(path)} — ${ingested.slides.length} slides (${ingested.sourceFormat})`,
  );
  console.log(C.dim('  reading slides…'));
}

const critiques = await critiqueDeck(ingested.slides);
const analysis = await analyseDeck(ingested.slides, critiques);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

if (asJson) {
  console.log(JSON.stringify({ ...analysis, slides: undefined }, null, 2));
  process.exit(0);
}

// ── one-liner test ───────────────────────────────────────────────────────────
console.log(`\n${C.bold('  The one-liner test')}`);
console.log(`    ${C.dim('from slide 1:')}  ${analysis.oneLinerFromSlide1}`);
console.log(`    ${C.dim('from the deck:')} ${analysis.oneLinerFromFullDeck}`);

// ── slides ───────────────────────────────────────────────────────────────────
console.log(`\n${C.bold('  Slides')}`);
const VERDICT: Record<string, string> = {
  strong: C.green('strong  '),
  adequate: C.dim('adequate'),
  weak: C.amber('weak    '),
  harmful: C.red('harmful '),
};
for (const c of analysis.critiques) {
  console.log(
    `    ${String(c.slideNumber).padStart(2)}. ${VERDICT[c.verdict]} ${C.dim(c.detectedSection.padEnd(14))} ${c.landsAs}`,
  );
  if (c.issues.length) console.log(`        ${C.red(c.issues.join(', '))}`);
}

// ── coverage ─────────────────────────────────────────────────────────────────
console.log(`\n${C.bold('  Sections')}`);
console.log(`    present: ${analysis.sectionsPresent.join(', ')}`);
if (analysis.sectionsMissing.length) {
  console.log(`    ${C.red(`missing: ${analysis.sectionsMissing.join(', ')}`)}`);
}

// ── findings ─────────────────────────────────────────────────────────────────
console.log(`\n${C.bold('  What an investor would catch')}`);
if (analysis.findings.length === 0) {
  console.log(C.green('    Nothing.'));
} else {
  for (const f of analysis.findings) {
    const tag = f.severity === 'high' ? C.red('HIGH') : f.severity === 'medium' ? C.amber('MED ') : C.grey('LOW ');
    const where = f.slideNumbers.length ? C.dim(` [slide ${f.slideNumbers.join(', ')}]`) : '';
    console.log(`    ${tag} ${f.summary}${where}`);
    console.log(C.grey(`         → "${f.probe}"`));
  }
}

// ── score ────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold('  Deck score')} ${C.dim('(1–5)')}`);
for (const [k, v] of Object.entries(analysis.score)) {
  const colour = v >= 4 ? C.green : v >= 3 ? C.dim : v >= 2 ? C.amber : C.red;
  const label = k.replace(/([A-Z])/g, ' $1').toLowerCase();
  console.log(`    ${label.padEnd(22)} ${colour(String(v))}`);
}

const usage = usageSummary();
console.log(
  C.dim(
    `\n  ${elapsed}s · ${usage.calls} calls · ${usage.totalPromptTokens.toLocaleString()} in ` +
      `(${usage.totalCachedTokens.toLocaleString()} cached) · ${usage.totalCompletionTokens.toLocaleString()} out\n`,
  ),
);
