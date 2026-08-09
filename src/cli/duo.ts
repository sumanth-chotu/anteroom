/**
 * Two-agent demo — AI founder pitches the AI investor.
 *
 *   npm run duo
 *   npm run duo -- --profile thesis_macro --founder evasive --turns 6
 *   npm run duo -- --deck fixtures/decks/planted-flaws/deck.pdf
 *   npm run duo -- --save demo-script.md
 *
 * Produces a clean alternating transcript — the rough script for a demo video —
 * and writes the audio to a .wav you can listen to or drop into an edit.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { runDuo, type DuoEvent } from '../voice/duo.ts';
import { FOUNDER_SCRIPTS, DEFAULT_FOUNDER } from '../voice/founder.ts';
import { personaFor } from '../investor/persona.ts';
import { generatePreRead } from '../preread/preread.ts';
import type { PreReadMemo } from '../preread/types.ts';
import { REALTIME_SAMPLE_RATE } from '../voice/protocol.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const profileId = flag('profile', 'seed_skeptic')!;
const founderId = flag('founder', DEFAULT_FOUNDER)!;
const turns = Number(flag('turns', '6'));
const deckPath = flag('deck');
const savePath = flag('save');

const investor = personaFor(profileId);
const founder = FOUNDER_SCRIPTS[founderId];
if (!founder) {
  console.error(`Unknown founder "${founderId}". Available: ${Object.keys(FOUNDER_SCRIPTS).join(', ')}`);
  process.exit(1);
}

function wrap(text: string, indent: string, width = 72): string {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) { out.push(indent + line.trim()); line = word; }
    else line += ' ' + word;
  }
  if (line.trim()) out.push(indent + line.trim());
  return out.join('\n');
}

let memo: PreReadMemo | undefined;
if (deckPath) {
  const cached = resolve('.tmp/prereads', `${basename(deckPath).replace(/\.\w+$/, '')}.json`);
  try {
    memo = JSON.parse(await readFile(cached, 'utf8')) as PreReadMemo;
    console.log(C.dim(`  using cached pre-read`));
  } catch {
    console.log(C.dim(`  reading the deck first…`));
    memo = (await generatePreRead(deckPath)).memo;
  }
}

console.log(`\n${C.bold('TWO-AGENT DEMO')}`);
console.log(
  C.grey(`  ${investor?.fullName ?? profileId} × ${founder.name} (${founder.company})` +
    `${memo ? ` · deck attached, walks in ${memo.initialPosture}` : ''}\n`),
);

// PCM16 chunks per speaker, so the .wav has both sides in the order they spoke.
const audio: Buffer[] = [];
const script: string[] = [];
const started = Date.now();
let claims = 0;
let findings = 0;

function onEvent(event: DuoEvent): void {
  switch (event.kind) {
    case 'status':
      console.log(C.dim(`  ${event.text}\n`));
      return;

    case 'audio':
      audio.push(Buffer.from(event.base64, 'base64'));
      return;

    case 'turn': {
      const who = event.speaker === 'investor' ? (investor?.shortName ?? 'INVESTOR') : founder!.name.split(' ')[0]!;
      const colour = event.speaker === 'investor' ? C.cyan : C.green;
      console.log(colour(`  ${who.toUpperCase()}`));
      console.log(wrap(event.text, '    '));
      console.log();
      script.push(`**${who}:** ${event.text}`);
      return;
    }

    case 'claim':
      claims++;
      console.log(C.grey(`    → ledger: ${event.metric} = ${event.value}`));
      return;

    case 'finding':
      findings++;
      console.log(C.red(`    ‼ ${event.summary}`));
      script.push(`> *[ledger fires: ${event.summary}]*`);
      return;

    case 'error':
      console.log(C.red(`  error: ${event.message}`));
      return;

    case 'done':
      console.log(C.dim(`  ${event.turns} turns`));
      return;
  }
}

await runDuo({
  profileId,
  founderId,
  ...(memo ? { memo } : {}),
  maxTurns: turns,
  onEvent,
});

// ── outputs ──────────────────────────────────────────────────────────────────

const pcm = Buffer.concat(audio);
const seconds = pcm.length / 2 / REALTIME_SAMPLE_RATE;

await mkdir('.tmp/demos', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const wavPath = resolve('.tmp/demos', `duo-${stamp}.wav`);
await writeFile(wavPath, wav(pcm));

const markdown =
  `# Demo script — ${investor?.fullName ?? profileId} × ${founder.name}\n\n` +
  `*${founder.company} · ${seconds.toFixed(0)}s · ${claims} claims captured · ${findings} contradictions caught*\n\n` +
  (memo ? `Deck attached. Investor walked in **${memo.initialPosture.replace(/_/g, ' ')}**.\n\n` : '') +
  script.join('\n\n') +
  '\n';

const scriptPath = savePath ? resolve(savePath) : resolve('.tmp/demos', `duo-${stamp}.md`);
await writeFile(scriptPath, markdown);

console.log(`\n${C.bold('  Output')}`);
console.log(`    script  ${scriptPath}`);
console.log(`    audio   ${wavPath} ${C.dim(`(${seconds.toFixed(1)}s)`)}`);
console.log(
  C.dim(`\n  ${((Date.now() - started) / 1000).toFixed(0)}s wall clock · ${claims} claims · ${findings} contradictions\n`),
);

/** Minimal 16-bit mono WAV header — avoids a dependency for 44 bytes. */
function wav(pcmData: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(REALTIME_SAMPLE_RATE, 24);
  header.writeUInt32LE(REALTIME_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}
