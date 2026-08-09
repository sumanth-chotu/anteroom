/**
 * Build a category brief from X discussion.
 *
 *   npm run brief -- "real-time payment fraud detection"
 *   npm run brief -- "AI SDR tools" --competitors "Artisan,11x,Regie"
 *   npm run brief -- "<category>" --save
 *
 * Offline and cached — this is Loop 0 (PLAN.md §4), not on any latency path.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildCategoryBrief } from '../category/brief.ts';
import { briefPriors } from '../category/types.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const args = process.argv.slice(2);
const competitorsArg = flag('competitors');
const category = args.filter((a) => !a.startsWith('--') && a !== competitorsArg)[0];

if (!category) {
  console.error('usage: npm run brief -- "<category>" [--competitors "A,B,C"] [--save]');
  process.exit(1);
}

const competitors = competitorsArg?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

function wrap(text: string, indent: string, width = 74): string {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) { out.push(indent + line.trim()); line = word; }
    else line += ' ' + word;
  }
  if (line.trim()) out.push(indent + line.trim());
  return out.join('\n');
}

console.log(`\n${C.bold('CATEGORY BRIEF')} ${C.dim(category)}`);
if (competitors.length) console.log(C.grey(`  competitors: ${competitors.join(', ')}`));
console.log();

const brief = await buildCategoryBrief({
  category,
  competitors,
  onProgress: (message) => console.log(C.dim(`  ${message}`)),
});

// ── events ───────────────────────────────────────────────────────────────────
const RECEPTION = {
  strong: C.green('landed  '),
  mixed: C.dim('mixed   '),
  skeptical: C.red('doubted '),
  ignored: C.grey('ignored '),
} as const;

console.log(`\n${C.bold('  What happened in this category')}`);
if (brief.events.length === 0) console.log(C.grey('    nothing surfaced'));
for (const event of brief.events) {
  console.log(
    `    ${RECEPTION[event.reception]} ${C.bold(event.company)} ${C.dim(event.type)}` +
      `${event.amount ? ` ${event.amount}` : ''}${event.when ? C.grey(` · ${event.when}`) : ''}`,
  );
  console.log(C.grey(wrap(event.summary, '            ')));
}

// ── the product ──────────────────────────────────────────────────────────────
console.log(`\n${C.bold('  What the community objects to')} ${C.dim('— and the question it becomes')}`);
if (brief.objectionThemes.length === 0) {
  console.log(C.grey('    no citable objections found'));
}
for (const theme of brief.objectionThemes) {
  const weight = theme.frequency * theme.severity;
  const tag = weight >= 16 ? C.red('■■■') : weight >= 9 ? C.amber('■■ ') : C.grey('■  ');
  console.log(`\n    ${tag} ${C.bold(`"${theme.theme}"`)} ${C.grey(`freq ${theme.frequency} · sev ${theme.severity}`)}`);
  for (const quote of theme.quotes.slice(0, 2)) {
    console.log(C.grey(wrap(`“${quote.text}”`, '        ')));
    console.log(C.grey(`          ${quote.url}`));
  }
  console.log(C.cyan(wrap(`→ "${theme.investorQuestion}"`, '        ')));
}

console.log(`\n${C.bold('  Priors handed to the investor')}`);
for (const prior of briefPriors(brief)) console.log(`    · ${prior}`);

if (args.includes('--save')) {
  const dir = resolve('.tmp/briefs');
  await mkdir(dir, { recursive: true });
  const slug = brief.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const out = resolve(dir, `${slug}.json`);
  await writeFile(out, JSON.stringify(brief, null, 2));
  console.log(C.dim(`\n  saved → ${out}`));
}

console.log(
  C.dim(
    `\n  ${brief.cost.seconds.toFixed(0)}s · ${brief.cost.searches} search angles · ` +
      `${brief.cost.toolCalls} tool calls · ${brief.sources.length} posts · ~$${brief.cost.usd.toFixed(2)}\n`,
  ),
);
