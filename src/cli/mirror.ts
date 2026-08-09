/**
 * Show what the investor actually pictured when they read a deck.
 *
 *   npm run mirror                                  # the bundled fixture pre-read
 *   npm run mirror -- --memo .tmp/prereads/x.json
 *   npm run mirror -- --deck path/to/deck.pdf       # runs the pre-read first (~80s)
 *   npm run mirror -- --save
 *
 * Reads an existing pre-read by default. The memo already contains the model's
 * read of the deck, so the mirror is one structured call plus one image — a few
 * seconds — where regenerating the pre-read is a minute and a half.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildMirror, mirrorDir, type Mirror } from '../mirror/mirror.ts';
import { generatePreRead } from '../preread/preread.ts';
import type { PreReadMemo } from '../preread/types.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const args = process.argv.slice(2);
const save = args.includes('--save');
const deckFlag = flag('deck');
const memoFlag = flag('memo');

function wrap(text: string, indent: string, width = 76): string {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) { out.push(indent + line.trim()); line = word; }
    else line += ' ' + word;
  }
  if (line.trim()) out.push(indent + line.trim());
  return out.join('\n');
}

// ── get a memo ───────────────────────────────────────────────────────────────
let memo: PreReadMemo;

if (deckFlag) {
  console.log(`\n${C.bold('PRE-READ')} ${C.dim(deckFlag)} ${C.grey('(~80s)')}`);
  ({ memo } = await generatePreRead(deckFlag));
} else {
  const path = memoFlag ?? 'fixtures/prereads/planted-flaws.json';
  try {
    memo = JSON.parse(await readFile(resolve(path), 'utf8')) as PreReadMemo;
  } catch {
    console.error(
      `\n  ${C.red('no pre-read at')} ${path}\n` +
        `  ${C.grey('Build one:  npm run preread -- <deck> --save')}\n` +
        `  ${C.grey('Or point at a deck:  npm run mirror -- --deck <deck>')}\n`,
    );
    process.exit(1);
  }
}

console.log(`\n${C.bold('THE MIRROR')} ${C.dim(`${memo.slideCount} slides`)}\n`);

const mirror: Mirror = await buildMirror({
  memo,
  slug: 'planted-flaws',
  onProgress: (message) => console.log(C.dim(`  ${message}`)),
});

// ── report ───────────────────────────────────────────────────────────────────

console.log(`\n  ${C.bold('WHAT THE DECK SAYS IT IS')}`);
console.log(C.grey(wrap(memo.oneLinerFromFullDeck, '    ')));

console.log(`\n  ${C.bold('WHAT THE INVESTOR PICTURED')}`);
console.log(C.cyan(wrap(mirror.readAs, '    ')));

console.log(`\n  ${C.bold('THE BRIEF IT DREW FROM')} ${C.dim('— shown so the argument is about the deck')}`);
console.log(C.grey(wrap(mirror.visualBrief, '    ')));

console.log(`\n  ${C.bold('WHAT IT COULD NOT PICTURE AT ALL')} ${C.dim('— the useful part')}`);
for (const spot of mirror.couldNotPicture) {
  console.log(
    `    ${C.red('✕')} ${spot.thing}${spot.slideRef ? C.grey(`  (slide ${spot.slideRef})`) : ''}`,
  );
}

if (mirror.slideOneDrift.drifted) {
  console.log(`\n  ${C.amber('▲ SLIDE ONE SENDS THEM SOMEWHERE ELSE')}`);
  console.log(C.grey(wrap(mirror.slideOneDrift.note, '    ')));
}

console.log(
  C.dim(
    `\n  ${mirror.cost.seconds.toFixed(0)}s · ~$${mirror.cost.usd.toFixed(2)} · ` +
      `${resolve(mirrorDir(), 'planted-flaws.jpg')}`,
  ),
);

if (save) {
  await mkdir(mirrorDir(), { recursive: true });
  const out = resolve(mirrorDir(), 'planted-flaws.json');
  await writeFile(out, JSON.stringify(mirror, null, 2));
  console.log(C.dim(`  saved → ${out}`));
}

console.log();
