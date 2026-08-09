/**
 * Phase 0 text harness.
 *
 *   npm run pitch                 # default archetype
 *   npm run pitch -- generalist   # generalist | skeptic | angel
 *   npm run pitch -- skeptic --debug
 *
 * A development tool, not a shipped product (PLAN.md §13). It exists because you
 * cannot iterate on question quality through a voice loop — and it stays useful
 * afterwards as the eval substrate.
 *
 * --debug shows the machinery: which layer fired, what the ledger captured, and
 * how the satisfaction gate scored each answer.
 */

import { openInput } from './input.ts';
import {
  createSession,
  founderTurn,
  investorTurn,
  isComplete,
  sessionMetrics,
} from '../session/session.ts';
import { runChecks } from '../ledger/checks.ts';
import { usageSummary } from '../xai/client.ts';
import { DEFAULT_PROFILE_ID, PROFILES, getProfile, isChaotic } from '../investor/profiles.ts';
import { DISCLAIMER, personaFor } from '../investor/persona.ts';

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
};

const ALIASES: Record<string, string> = {
  generalist: 'seed_generalist',
  skeptic: 'seed_skeptic',
  angel: 'technical_angel',
  thesis: 'thesis_macro',
  accelerator: 'accelerator_operator',
  solo: 'solo_capitalist',
  blowhard: 'incubator_blowhard',
  chaos: 'incubator_blowhard',
};

const args = process.argv.slice(2);
const debug = args.includes('--debug');

const KIND_LABEL = {
  synthetic: 'composite archetypes',
  derived: 'derived from public investor behaviour',
  character: 'unserious — trains room control',
} as const;

if (args.includes('--list')) {
  console.log('\n\x1b[1mInvestor profiles\x1b[0m\n');
  for (const kind of ['synthetic', 'derived', 'character'] as const) {
    console.log(`  \x1b[2m${KIND_LABEL[kind]}\x1b[0m`);
    for (const p of PROFILES.filter((x) => x.kind === kind)) {
      const alias = Object.entries(ALIASES).find(([, id]) => id === p.id)?.[0] ?? p.id;
      const who = personaFor(p.id);
      console.log(
        `    \x1b[1m${alias.padEnd(13)}\x1b[0m ${who ? who.fullName : p.name}` +
          (who ? ` \x1b[2m· ${who.title}, ${who.firm}\x1b[0m` : ''),
      );
      console.log(`    ${' '.repeat(13)} \x1b[2m${p.blurb}\x1b[0m`);
    }
    console.log();
  }
  process.exit(0);
}

const requested = args.find((a) => !a.startsWith('--')) ?? '';
const profileId = ALIASES[requested] ?? (requested || DEFAULT_PROFILE_ID);
const profile = getProfile(profileId);

function wrap(text: string, width = 76, indent = '  '): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line += ' ' + word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => indent + l).join('\n');
}

console.log(`\n${C.bold('RADAR')} ${C.dim('· seed pitch practice · phase 0 text harness')}`);
const who = personaFor(profile.id);
if (who) {
  console.log(`${C.dim('Investor:')} ${C.bold(who.fullName)} ${C.dim(`— ${who.title}, ${who.firm}`)}`);
  console.log(C.grey(`  ${who.bio}`));
  console.log(C.grey(`  ${who.fictional ? 'Fictional character.' : DISCLAIMER}`));
} else {
  console.log(`${C.dim('Investor:')} ${C.bold(profile.name)} — ${C.dim(profile.blurb)}`);
}
console.log(C.dim(`Type your answers. "quit" to end early and see the debrief.\n`));

const input = await openInput();
let session = createSession(profileId);

try {
  while (true) {
    const turn = await investorTurn(session);
    session = turn.session;

    if (debug) console.log(C.grey(`  [layer: ${turn.move.layer}]`));
    console.log(C.cyan(wrap(turn.text)));

    if (turn.move.layer === 'wrap_up') break;

    console.log();
    const answer = await input.next('  > ');
    if (answer === null || !answer.trim() || answer.trim().toLowerCase() === 'quit') break;

    process.stdout.write(C.dim('  …thinking\n'));
    const result = await founderTurn(session, answer);
    session = result.session;

    if (debug) {
      const v = result.verdict;
      const mark =
        v.satisfied ? C.green('satisfied') : v.answered === 'dodged' ? C.red('dodged') : C.yellow(v.answered);
      console.log(C.grey(`  [${mark} · ${v.specificity}${v.missing ? ` · missing: ${v.missing}` : ''}]`));
      for (const claim of result.session.turns.at(-1)?.claims ?? []) {
        console.log(C.grey(`  [claim: ${claim.metric} = ${claim.valueRaw} (conf ${claim.confidence})]`));
      }
      for (const finding of result.newFindings) {
        console.log(C.red(`  [!! ${finding.kind}: ${finding.summary}]`));
      }
      const rc = result.session.turns.at(-1)?.roomControl;
      if (rc) {
        const colour = rc.outcome === 'reclaimed' ? C.green : rc.outcome === 'partial' ? C.yellow : C.red;
        console.log(C.grey(`  [room control: ${colour(rc.outcome)} — ${rc.note}]`));
      }
    }
    console.log();

    if (isComplete(session)) {
      const final = await investorTurn(session);
      session = final.session;
      console.log(C.cyan(wrap(final.text)));
      break;
    }
  }
} finally {
  input.close();
}

// ── Debrief ──────────────────────────────────────────────────────────────────

const metrics = sessionMetrics(session);
const findings = runChecks(session.ledger);

console.log(`\n${C.bold('─── DEBRIEF ───')}\n`);

console.log(C.bold('  Coverage'));
for (const topic of metrics.coverage.satisfied) console.log(`    ${C.green('✓')} ${topic.label}`);
for (const topic of metrics.coverage.dodged)
  console.log(`    ${C.red('✗')} ${topic.label} ${C.red('— asked, never answered')}`);
for (const topic of metrics.coverage.unasked) console.log(`    ${C.grey('·')} ${C.grey(`${topic.label} (not reached)`)}`);

console.log(`\n${C.bold('  Numbers you gave')} ${C.dim(`(${metrics.claimsCaptured} captured)`)}`);
if (session.ledger.claims.length === 0) {
  console.log(C.grey('    none — you did not state a single number'));
} else {
  for (const claim of session.ledger.claims) {
    console.log(`    ${claim.metric.replace(/_/g, ' ')}: ${C.bold(claim.valueRaw)} ${C.grey(`"${claim.verbatim.slice(0, 60)}"`)}`);
  }
}

console.log(`\n${C.bold('  What an investor would catch')}`);
if (findings.length === 0) {
  console.log(C.green('    Nothing contradicted itself.'));
} else {
  for (const finding of findings) {
    const tag = finding.severity === 'high' ? C.red('HIGH') : finding.severity === 'medium' ? C.yellow('MED ') : C.grey('LOW ');
    console.log(`    ${tag} ${finding.summary}`);
    console.log(C.grey(`         → "${finding.probe}"`));
  }
}

if (metrics.chaotic) {
  console.log(`\n${C.bold('  Room control')} ${C.dim('— did you get the meeting back?')}`);
  if (metrics.derailsJudged === 0) {
    console.log(C.grey('    They never derailed. Lucky.'));
  } else {
    const score = Math.round(metrics.roomControlScore * 100);
    const colour = score >= 70 ? C.green : score >= 40 ? C.yellow : C.red;
    console.log(
      `    reclaimed ${C.green(String(metrics.reclaimed))} · partial ${C.yellow(String(metrics.partial))} · ` +
        `followed ${C.red(String(metrics.followed))}  →  ${colour(`${score}%`)}`,
    );
    for (const note of metrics.roomControlNotes) console.log(C.grey(`    · ${note}`));
  }
}

console.log(`\n${C.bold('  Metrics')}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
console.log(`    non-answer rate      ${metrics.nonAnswerRate > 0.3 ? C.red(pct(metrics.nonAnswerRate)) : pct(metrics.nonAnswerRate)}`);
console.log(`    hand-wave rate       ${metrics.handWaveRate > 0.3 ? C.red(pct(metrics.handWaveRate)) : pct(metrics.handWaveRate)}`);
console.log(`    hedges / 100 words   ${metrics.hedgesPer100Words.toFixed(1)}`);
console.log(`    avg words per answer ${metrics.avgFounderWordsPerTurn}`);
console.log(`    talk ratio           ${metrics.talkRatio.toFixed(1)}:1 ${C.grey('(you : investor)')}`);

const usage = usageSummary();
console.log(
  `\n${C.dim(`  ${usage.calls} model calls · ${usage.totalPromptTokens} in (${usage.totalCachedTokens} cached) · ${usage.totalCompletionTokens} out`)}\n`,
);
