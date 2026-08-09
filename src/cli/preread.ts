/**
 * Generate and display the pre-read memo.
 *
 *   npm run preread -- fixtures/decks/planted-flaws/deck.pdf
 *   npm run preread -- <deck> --save    # cache it for `npm run pitch -- --deck`
 *   npm run preread -- <deck> --json
 *
 * This is the artifact founders have never seen: what the investor thought
 * before you opened your mouth.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { generatePreRead } from '../preread/preread.ts';
import { POSTURE_LABEL } from '../preread/types.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function wrap(text: string, indent = '    ', width = 74): string {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) {
      out.push(indent + line.trim());
      line = word;
    } else line += ' ' + word;
  }
  if (line.trim()) out.push(indent + line.trim());
  return out.join('\n');
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const save = args.includes('--save');
const deckPath = args.find((a) => !a.startsWith('--'));

if (!deckPath) {
  console.error('usage: npm run preread -- <deck.pdf> [--save] [--json]');
  process.exit(1);
}

if (!asJson) console.log(C.dim(`\n  reading ${basename(deckPath)}…`));

const { memo } = await generatePreRead(deckPath);

if (save) {
  const dir = resolve('.tmp/prereads');
  await mkdir(dir, { recursive: true });
  const out = resolve(dir, `${basename(deckPath).replace(/\.\w+$/, '')}.json`);
  await writeFile(out, JSON.stringify(memo, null, 2));
  if (!asJson) console.log(C.dim(`  saved → ${out}`));
}

if (asJson) {
  console.log(JSON.stringify(memo, null, 2));
  process.exit(0);
}

const POSTURE_COLOUR = {
  leaning_in: C.green,
  neutral: C.dim,
  skeptical: C.amber,
  looking_for_the_no: C.red,
} as const;

console.log(`\n${C.bold('━━━ PRE-READ MEMO ━━━')}`);
console.log(C.grey(`  ${memo.slideCount} slides · generated in ${memo.cost.seconds.toFixed(1)}s`));
console.log(C.grey(`  What the investor thought before you said a word.\n`));

// ── posture ──────────────────────────────────────────────────────────────────
const colour = POSTURE_COLOUR[memo.initialPosture];
console.log(`  ${C.bold('Walking in:')} ${colour(POSTURE_LABEL[memo.initialPosture].toUpperCase())}`);
console.log(wrap(memo.postureReason, '  '));

// ── one-liner test ───────────────────────────────────────────────────────────
console.log(`\n  ${C.bold('What you do, as far as I can tell')}`);
console.log(`    ${C.dim('from slide 1:')}`);
console.log(wrap(`"${memo.oneLinerFromSlide1}"`, '      '));
console.log(`    ${C.dim('after the whole deck:')}`);
console.log(wrap(`"${memo.oneLinerFromFullDeck}"`, '      '));

// ── understood / confused ────────────────────────────────────────────────────
console.log(`\n  ${C.bold('Came across')}`);
for (const item of memo.understood) console.log(`    ${C.green('+')} ${item}`);
console.log(`\n  ${C.bold("Didn't")}`);
for (const item of memo.confused) console.log(`    ${C.red('?')} ${item}`);

// ── red flags ────────────────────────────────────────────────────────────────
console.log(`\n  ${C.bold('What bothers me')}`);
for (const flag of memo.redFlags) {
  const where = flag.slideNumbers.length ? C.dim(` [slide ${flag.slideNumbers.join(', ')}]`) : '';
  console.log(`    ${C.red(String(flag.rank))}. ${flag.summary}${where}`);
  console.log(C.grey(wrap(flag.whyItMatters, '       ')));
}

// ── the case for no ──────────────────────────────────────────────────────────
console.log(`\n  ${C.bold('The case for passing')} ${C.dim('— written before anything else')}`);
console.log(C.amber(wrap(memo.caseForNo, '    ')));

// ── planned probes ───────────────────────────────────────────────────────────
console.log(`\n  ${C.bold("What I'm going to ask you")}`);
for (const probe of memo.plannedProbes) {
  const ref = probe.slideRef ? C.dim(` [slide ${probe.slideRef}]`) : '';
  console.log(`    ${C.cyan(String(probe.priority))}. ${C.bold(probe.topic)}${ref} ${C.grey(`(${probe.origin})`)}`);
  console.log(wrap(`"${probe.question}"`, '       '));
}

// ── deck score ───────────────────────────────────────────────────────────────
console.log(`\n  ${C.bold('Deck score')} ${C.dim('(1–5)')}`);
for (const [key, value] of Object.entries(memo.deckScore)) {
  const c = value >= 4 ? C.green : value >= 3 ? C.dim : value >= 2 ? C.amber : C.red;
  console.log(`    ${key.replace(/([A-Z])/g, ' $1').toLowerCase().padEnd(22)} ${c(String(value))}`);
}

console.log(
  C.dim(
    `\n  ${memo.cost.calls} calls · ${memo.cost.promptTokens.toLocaleString()} in · ` +
      `${memo.cost.completionTokens.toLocaleString()} out · ` +
      `~$${((memo.cost.promptTokens / 1e6) * 2 + (memo.cost.completionTokens / 1e6) * 6).toFixed(3)}\n`,
  ),
);
