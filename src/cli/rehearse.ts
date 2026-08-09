/**
 * Replay a fixed pitch against an investor and measure the personality layer.
 *
 *   npm run rehearse -- essayist
 *   npm run rehearse -- skeptic
 *
 * The founder's answers are scripted, so the only thing that varies between runs
 * is the investor. That makes this the eval for two claims that are otherwise
 * matters of opinion:
 *
 *   tellsPerTurn     did it sound like an AI assistant
 *   convictionTurns  did any question come from this investor's own documented
 *                    position rather than the generic spine
 *
 * The script is written to trip several conviction triggers AND to contain a
 * contradiction (800 users, then 2000), so layer selection is visible too. It
 * caught a real bug: with the conviction layer ranked below follow_up, a dodging
 * founder starved it and convictionTurns was 0 on a script that trips six
 * triggers.
 */

import { openSession, investorTurn, founderTurn, sessionMetrics } from '../session/session.ts';
import { briefingSummary } from '../investor/briefing.ts';
import { resolveProfileId } from '../investor/dossier-store.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

/**
 * A deliberately bad pitch: hypothetical market, unfocused, no user contact,
 * and a number that moves. Every weakness here is one some investor in the cast
 * has a documented position about.
 */
const ANSWERS = [
  "We're building an AI platform for small businesses. The TAM is billions — " +
    'basically everyone needs this. We have three products across multiple verticals.',
  "About 800 users signed up. We're growing 40% month over month, it's viral growth really.",
  'Well, we have around 2000 users now. Our advisor wants us to focus on enterprise, ' +
    "that's the standard approach everyone is doing.",
  "Honestly we haven't talked to that many users directly. The market research says " +
    'the demand is there.',
];

const requested = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'essayist';
const profileId = resolveProfileId(requested);

let session = await openSession(profileId);
console.log(
  `\n${C.bold('REHEARSAL')} ${C.dim(profileId)}\n` +
    `${C.grey(`  ${briefingSummary(session.briefing ?? { profile: session.profile })}`)}\n`,
);

for (let i = 0; i <= ANSWERS.length; i++) {
  const turn = await investorTurn(session);
  session = turn.session;
  const last = session.turns.at(-1);

  const flags = [
    last?.regenerated ? C.amber('RETRIED') : '',
    last?.tellScore ? C.red(`tells=${last.tellScore}`) : '',
  ]
    .filter(Boolean)
    .join(' ');

  console.log(`  ${C.dim(`[${turn.move.layer}]`)} ${flags}`);
  console.log(`  ${C.cyan(turn.text)}`);
  if (last?.convictionBelief) console.log(C.grey(`    ↳ ${last.convictionBelief}`));

  if (turn.move.layer === 'wrap_up') break;
  const answer = ANSWERS[i];
  if (!answer) break;
  console.log(`  ${C.grey(answer)}\n`);
  session = (await founderTurn(session, answer)).session;
}

const metrics = sessionMetrics(session) as Record<string, unknown>;
const tells = metrics['tellsPerTurn'] as number;

console.log(
  `\n  ${C.bold('MEASURED')}\n` +
    `    tells per turn      ${tells === 0 ? C.green('0.00') : C.red(tells.toFixed(2))} ` +
    `${C.grey('(0 = nothing that reads as an AI assistant)')}\n` +
    `    regenerated turns   ${metrics['regeneratedTurns']} ${C.grey('(cost of the detector)')}\n` +
    `    conviction turns    ${metrics['convictionTurns']} ` +
    `${C.grey("(questions from the investor's own positions)")}\n`,
);

const pressed = (metrics['convictionsPressed'] as string[] | undefined) ?? [];
for (const belief of pressed) console.log(C.grey(`      · ${belief}`));
console.log();
