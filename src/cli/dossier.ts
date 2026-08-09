/**
 * Research a real investor: what they press on, and how they talk.
 *
 *   npm run dossier -- --list
 *   npm run dossier -- skeptic
 *   npm run dossier -- skeptic --save          # → fixtures/dossiers/<id>.json
 *   npm run dossier -- all --save              # every non-fictional profile
 *
 * Offline and cached. Nothing here is on a latency path — a dossier is built
 * once per investor and read from disk by every session afterwards.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildDossier, type Dossier } from '../investor/dossier.ts';
import { PROFILES, getProfile } from '../investor/profiles.ts';
import { personaFor } from '../investor/persona.ts';
import { ALIASES, dossierPath } from '../investor/dossier-store.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const save = args.includes('--save');
const target = args.find((a) => !a.startsWith('--'));

if (args.includes('--list') || !target) {
  console.log(`\n${C.bold('Investors that can be researched')}\n`);
  for (const [alias, id] of Object.entries(ALIASES)) {
    const persona = personaFor(id);
    if (!persona) continue;
    const note = persona.fictional ? C.grey('  (fictional — no dossier)') : '';
    console.log(`  ${C.cyan(alias.padEnd(14))} ${persona.fullName.padEnd(20)} ${C.grey(persona.firm)}${note}`);
  }
  console.log(`\n  ${C.dim('npm run dossier -- skeptic --save')}`);
  console.log(`  ${C.dim('npm run dossier -- all --save')}\n`);
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

const FOOTPRINT = {
  extensive: C.green('extensive'),
  moderate: C.amber('moderate'),
  thin: C.red('thin'),
} as const;

function report(dossier: Dossier): void {
  console.log(
    `\n  ${C.bold(dossier.person)} ${C.grey(`· public footprint: `)}${FOOTPRINT[dossier.publicFootprint]}`,
  );

  const { focus } = dossier;
  if (focus.stages.length || focus.sectors.length || focus.checkSize) {
    console.log(
      C.grey(
        `  ${[
          focus.stages.join('/'),
          focus.sectors.slice(0, 4).join(', '),
          focus.checkSize,
        ].filter(Boolean).join(' · ')}`,
      ),
    );
  }

  // Speech first — it is the part that makes the simulation stop sounding
  // like a language model, so it is the part worth reading.
  console.log(`\n  ${C.bold('HOW THEY TALK')} ${C.dim('— feeds the anti-AI-tell layer')}`);
  console.log(C.cyan(wrap(dossier.speech.rhythm, '    ')));
  if (dossier.speech.register) console.log(C.grey(wrap(`register: ${dossier.speech.register}`, '    ')));
  if (dossier.speech.humour) console.log(C.grey(wrap(`humour: ${dossier.speech.humour}`, '    ')));
  for (const tic of dossier.speech.tics) console.log(C.grey(wrap(`· ${tic}`, '    ')));
  if (dossier.speech.signaturePhrases.length) {
    console.log(`    ${C.dim('says:')} ${dossier.speech.signaturePhrases.map((p) => `"${p}"`).join('  ')}`);
  }
  if (dossier.speech.neverSays.length) {
    console.log(`    ${C.dim('never:')} ${dossier.speech.neverSays.map((p) => `"${p}"`).join('  ')}`);
  }

  console.log(`\n  ${C.bold('WHAT THEY PRESS ON')} ${C.dim(`(${dossier.pressurePoints.length}, all cited)`)}`);
  for (const point of dossier.pressurePoints.slice(0, 6)) {
    console.log(`\n    ${C.bold(point.topic)} ${C.grey(`— ${point.why}`)}`);
    console.log(C.cyan(wrap(`→ "${point.question}"`, '      ')));
    console.log(C.grey(wrap(`“${point.quote}”`, '      ')));
    console.log(C.grey(`      ${point.sourceUrl}`));
  }

  if (dossier.dealbreakers.length) {
    console.log(`\n  ${C.bold('DEALBREAKERS')}`);
    for (const breaker of dossier.dealbreakers.slice(0, 5)) {
      console.log(`    ${C.red('✕')} ${breaker.text}`);
      console.log(C.grey(wrap(`“${breaker.quote}”`, '      ')));
    }
  }

  if (dossier.positions.length) {
    console.log(`\n  ${C.bold('STATED POSITIONS')} ${C.dim(`(${dossier.positions.length})`)}`);
    for (const position of dossier.positions.slice(0, 6)) {
      console.log(`    ${C.bold(position.topic)}: ${position.stance}`);
    }
  }

  console.log(
    C.dim(
      `\n  ${dossier.cost.seconds.toFixed(0)}s · ${dossier.cost.toolCalls} tool calls · ` +
        `${dossier.sources.length} sources · ~$${dossier.cost.usd.toFixed(2)}`,
    ),
  );
}

async function build(profileId: string): Promise<Dossier | undefined> {
  const persona = personaFor(profileId);
  if (!persona) {
    console.error(C.red(`  no persona for "${profileId}"`));
    return undefined;
  }
  if (persona.fictional) {
    console.log(C.grey(`  skipping ${persona.fullName} — fictional, nothing to research`));
    return undefined;
  }

  getProfile(profileId); // throws early on a bad id

  console.log(`\n${C.bold('DOSSIER')} ${C.dim(`${persona.fullName} · ${persona.firm}`)}`);

  const dossier = await buildDossier({
    profileId,
    person: persona.fullName,
    firm: persona.firm,
    onProgress: (message) => console.log(C.dim(`  ${message}`)),
  });

  report(dossier);

  if (save) {
    const path = dossierPath(profileId);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(dossier, null, 2));
    console.log(C.dim(`  saved → ${path}`));
  }

  return dossier;
}

if (target === 'all') {
  // Sequential on purpose: each dossier is three concurrent searches already,
  // and running seven at once buys nothing but rate-limit errors.
  const ids = PROFILES.map((p) => p.id).filter((id) => !personaFor(id)?.fictional);
  let spend = 0;
  for (const id of ids) {
    try {
      const dossier = await build(id);
      spend += dossier?.cost.usd ?? 0;
    } catch (error) {
      console.error(C.red(`  ${id} failed: ${error instanceof Error ? error.message : error}`));
    }
  }
  console.log(C.dim(`\n  total ~$${spend.toFixed(2)} across ${ids.length} investors\n`));
} else {
  const profileId = ALIASES[target] ?? target;
  await build(profileId);
  console.log();
}
