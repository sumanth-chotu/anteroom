/**
 * Smoke test — verifies the xAI client end to end before anything is built on it.
 *   npm run smoke
 */

import { z } from 'zod';
import { chat, chatStructured, usageSummary } from '../xai/client.ts';
import { config } from '../config.ts';

function ok(label: string, detail = '') {
  console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label: string, error: unknown) {
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  console.log(`    ${error instanceof Error ? error.message : String(error)}`);
}

let failures = 0;

console.log('\n\x1b[1mxAI client smoke test\x1b[0m');
console.log(`  base: ${config.xai.baseUrl}`);
console.log(`  models: ${config.xai.reasoning}, ${config.xai.longContext}\n`);

// 1 — basic chat
try {
  const t0 = Date.now();
  const result = await chat([{ role: 'user', content: 'Reply with exactly: OK' }], {
    maxTokens: 16,
    tag: 'smoke:chat',
  });
  const ms = Date.now() - t0;
  if (!result.text.includes('OK')) throw new Error(`unexpected: ${JSON.stringify(result.text)}`);
  ok('chat', `${ms}ms · ${result.model} · ${result.usage.completionTokens} out`);
} catch (error) {
  failures++;
  fail('chat', error);
}

// 2 — reasoning trace exposed
try {
  const result = await chat(
    [{ role: 'user', content: 'A founder says "40% week-over-week growth off 9 users." Is that impressive? One sentence.' }],
    { maxTokens: 2048, reasoningEffort: 'low', tag: 'smoke:reasoning' },
  );
  ok(
    'reasoning_effort',
    result.reasoning
      ? `trace exposed (${result.usage.reasoningTokens} reasoning tokens)`
      : `accepted, no trace returned`,
  );
  console.log(`    \x1b[2m↳ ${result.text.trim().slice(0, 140)}\x1b[0m`);
} catch (error) {
  failures++;
  fail('reasoning_effort', error);
}

// 3 — structured output (the claim ledger depends on this)
const ClaimSchema = z.object({
  metric: z.string(),
  value: z.string(),
  isPaying: z.boolean(),
});
const claimJsonSchema = {
  type: 'object',
  properties: {
    metric: { type: 'string' },
    value: { type: 'string' },
    isPaying: { type: 'boolean' },
  },
  required: ['metric', 'value', 'isPaying'],
  additionalProperties: false,
};

try {
  const { data } = await chatStructured(
    [
      {
        role: 'user',
        content:
          'Extract the metric from this founder statement: "We have 12 design partners, none of them pay us yet."',
      },
    ],
    ClaimSchema,
    claimJsonSchema,
    { maxTokens: 2048, schemaName: 'claim', tag: 'smoke:structured' },
  );
  ok('structured output', JSON.stringify(data));
} catch (error) {
  failures++;
  fail('structured output', error);
}

// 4 — long-context model reachable
try {
  const result = await chat([{ role: 'user', content: 'Reply with exactly: OK' }], {
    model: config.xai.longContext,
    maxTokens: 16,
    tag: 'smoke:long-context',
  });
  ok('long-context model', result.model);
} catch (error) {
  failures++;
  fail('long-context model', error);
}

const usage = usageSummary();
console.log(
  `\n  usage: ${usage.calls} calls · ${usage.totalPromptTokens} in ` +
    `(${usage.totalCachedTokens} cached) · ${usage.totalCompletionTokens} out`,
);

if (failures > 0) {
  console.log(`\n\x1b[31m${failures} check(s) failed\x1b[0m\n`);
  process.exit(1);
}
console.log('\n\x1b[32mAll checks passed.\x1b[0m\n');
