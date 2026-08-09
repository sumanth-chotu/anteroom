/**
 * Build a persona from an investor's own published work.
 *
 *   npm run persona -- --list
 *   npm run persona -- essayist                # ingest + synthesise, print
 *   npm run persona -- essayist --save         # → fixtures/personas/<id>.json
 *   npm run persona -- essayist --limit 40     # cheaper pass while iterating
 *
 * Two stages. Ingest fetches the corpus once and caches it under `.tmp/corpus/`;
 * synthesis reads the whole thing in a single long-context pass. Neither is on
 * any latency path — a persona is built once and loaded from disk thereafter.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CORPUS_SOURCES, sourceFor } from '../corpus/sources.ts';
import { ingestCorpus } from '../corpus/ingest.ts';
import { synthesisePersona, type CorpusPersona } from '../corpus/persona.ts';
import { personaPath } from '../corpus/store.ts';
import { personaFor } from '../investor/persona.ts';
import { resolveProfileId } from '../investor/dossier-store.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const args = process.argv.slice(2);
const save = args.includes('--save');
const limitArg = flag('limit');
const limit = limitArg ? Number(limitArg) : undefined;
const target = args.filter((a) => !a.startsWith('--') && a !== limitArg)[0];

if (args.includes('--list') || !target) {
  console.log(`\n${C.bold('Investors with an ingestible body of work')}\n`);
  for (const source of CORPUS_SOURCES) {
    const who = personaFor(source.profileId);
    console.log(`  ${C.cyan(source.profileId.padEnd(18))} ${(who?.fullName ?? '').padEnd(18)} ${C.grey(source.label)}`);
  }
  console.log(`\n  ${C.dim('npm run persona -- essayist --save')}`);
  console.log(`  ${C.grey('Investors without a corpus use `npm run dossier` instead.')}\n`);
  process.exit(0);
}

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

function report(persona: CorpusPersona): void {
  console.log(
    `\n  ${C.bold(persona.person)} ${C.grey(
      `· ${persona.corpus.documents} documents · ${(persona.corpus.chars / 1000).toFixed(0)}k chars`,
    )}`,
  );

  // The opening first: it is the moment the user said felt coldest, so it is
  // the first thing worth eyeballing after a build.
  console.log(`\n  ${C.bold('HOW THEY OPEN')} ${C.dim('— replaces the cold generic greeting')}`);
  console.log(C.grey(wrap(persona.opening.style, '    ')));
  for (const example of persona.opening.examples) {
    console.log(C.cyan(wrap(`“${example}”`, '    ')));
  }

  console.log(`\n  ${C.bold('CONVICTIONS')} ${C.dim(`(${persona.convictions.length}, every one cited)`)}`);
  for (const conviction of persona.convictions.slice(0, 6)) {
    console.log(`\n    ${C.bold(conviction.belief)}`);
    console.log(C.grey(wrap(conviction.argument, '      ')));
    console.log(C.cyan(wrap(`asks: "${conviction.question}"`, '      ')));
    console.log(C.grey(wrap(`“${conviction.quote}”  — ${conviction.sourceTitle}`, '      ')));
    console.log(C.dim(`      fires on: ${conviction.triggersOn.slice(0, 6).join(' · ')}`));
  }
  if (persona.convictions.length > 6) {
    console.log(C.dim(`\n    …and ${persona.convictions.length - 6} more`));
  }

  console.log(`\n  ${C.bold('HOW THEY TAKE A CLAIM APART')}`);
  for (const diagnostic of persona.diagnostics) {
    console.log(`    ${C.amber('▸')} ${diagnostic.move}`);
    console.log(C.grey(wrap(`when ${diagnostic.when} — “${diagnostic.example}”`, '        ')));
  }

  console.log(`\n  ${C.bold('VOICE')}`);
  console.log(C.grey(wrap(persona.voice.rhythm, '    ')));
  for (const tic of persona.voice.tics) console.log(C.grey(wrap(`· ${tic}`, '    ')));
  if (persona.canon.length) console.log(`    ${C.dim('own terms:')} ${persona.canon.join(' · ')}`);
  if (persona.dismissals.length) {
    console.log(`\n  ${C.bold('BORED BY')}`);
    for (const item of persona.dismissals) console.log(C.grey(`    ✕ ${item}`));
  }

  console.log(
    C.dim(
      `\n  ${persona.cost.seconds.toFixed(0)}s · ${(persona.cost.promptTokens / 1000).toFixed(0)}k prompt tokens · ` +
        `${persona.cost.completionTokens} completion tokens`,
    ),
  );
}

const profileId = resolveProfileId(target);
const source = sourceFor(profileId);

if (!source) {
  console.error(
    `\n  ${C.red('no corpus source for')} "${profileId}"\n` +
      `  ${C.grey('Add one in src/corpus/sources.ts, or use `npm run dossier` for a search-based build.')}\n`,
  );
  process.exit(1);
}

const who = personaFor(profileId);
console.log(`\n${C.bold('PERSONA')} ${C.dim(`${who?.fullName ?? profileId} · ${source.label}`)}\n`);

const corpus = await ingestCorpus({
  source,
  ...(limit ? { limit } : {}),
  onProgress: (message) => console.log(C.dim(`  ${message}`)),
});

const persona = await synthesisePersona({
  corpus,
  person: who?.fullName ?? profileId,
  onProgress: (message) => console.log(C.dim(`  ${message}`)),
});

report(persona);

if (save) {
  const path = personaPath(profileId);
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(persona, null, 2));
  console.log(C.dim(`  saved → ${path}`));
}

console.log(`\n  ${C.green('✓')} ${C.grey('load it in a session with')} npm run pitch -- ${target}\n`);
