import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  arithmeticMismatches,
  commitmentConflations,
  directContradictions,
  implausibleAcv,
  runChecks,
  smallBaseGrowth,
  timelineInconsistencies,
  topDownTam,
  vanityAsTraction,
} from './checks.ts';
import { emptyLedger, type Claim, type Ledger, type MetricKey } from './types.ts';

let seq = 0;

function claim(metric: MetricKey, value: number | null, overrides: Partial<Claim> = {}): Claim {
  seq += 1;
  return {
    id: `c${seq}`,
    sessionId: 's1',
    source: 'spoken',
    turnId: `t${seq}`,
    metric,
    value,
    valueRaw: String(value),
    verbatim: `we have ${value} ${metric}`,
    confidence: 0.9,
    createdAt: seq,
    ...overrides,
  };
}

function ledgerOf(...claims: Claim[]): Ledger {
  return { ...emptyLedger('s1'), claims };
}

describe('directContradictions', () => {
  test('flags the same metric stated at two values for the same period', () => {
    const found = directContradictions(
      ledgerOf(
        claim('customers_paying', 12, { period: 'now' }),
        claim('customers_paying', 8, { period: 'now' }),
      ),
    );
    assert.equal(found.length, 1);
    assert.equal(found[0]?.severity, 'high');
    assert.match(found[0]?.probe ?? '', /Which is it/);
  });

  test('allows the same metric to differ across periods', () => {
    const found = directContradictions(
      ledgerOf(
        claim('mrr', 5000, { period: 'Jan 2026' }),
        claim('mrr', 9000, { period: 'Feb 2026' }),
      ),
    );
    assert.equal(found.length, 0);
  });

  test('ignores low-confidence claims', () => {
    const found = directContradictions(
      ledgerOf(
        claim('customers_paying', 12, { period: 'now' }),
        claim('customers_paying', 8, { period: 'now', confidence: 0.2 }),
      ),
    );
    assert.equal(found.length, 0);
  });
});

describe('arithmeticMismatches', () => {
  test('flags MRR x 12 diverging from stated ARR', () => {
    const found = arithmeticMismatches(ledgerOf(claim('mrr', 10_000), claim('arr', 500_000)));
    assert.equal(found.length, 1);
    assert.match(found[0]?.summary ?? '', /120,000/);
  });

  test('accepts consistent MRR and ARR', () => {
    const found = arithmeticMismatches(ledgerOf(claim('mrr', 10_000), claim('arr', 120_000)));
    assert.equal(found.length, 0);
  });

  test('tolerates minor drift', () => {
    const found = arithmeticMismatches(ledgerOf(claim('mrr', 10_000), claim('arr', 125_000)));
    assert.equal(found.length, 0);
  });
});

describe('commitmentConflations', () => {
  test('catches the same headcount at two rungs of the ladder', () => {
    const found = commitmentConflations(
      ledgerOf(claim('design_partners', 12), claim('customers_paying', 12)),
    );
    assert.equal(found.length, 1);
    assert.equal(found[0]?.severity, 'high');
    assert.match(found[0]?.probe ?? '', /actually pay you/);
  });

  test('flags paying customers exceeding total customers', () => {
    const found = commitmentConflations(
      ledgerOf(claim('customers_total', 8), claim('customers_paying', 20)),
    );
    assert.ok(found.some((f) => /can't both be true/.test(f.probe)));
  });

  test('leaves genuinely different counts alone', () => {
    const found = commitmentConflations(
      ledgerOf(claim('design_partners', 12), claim('customers_paying', 3)),
    );
    assert.equal(found.length, 0);
  });
});

describe('implausibleAcv', () => {
  test('flags one pilot annualized into recurring revenue', () => {
    const found = implausibleAcv(ledgerOf(claim('mrr', 200_000), claim('customers_paying', 1)));
    assert.equal(found.length, 1);
    assert.match(found[0]?.probe ?? '', /pilot you've annualized/);
  });

  test('accepts a normal seed deal size', () => {
    const found = implausibleAcv(ledgerOf(claim('mrr', 12_000), claim('customers_paying', 8)));
    assert.equal(found.length, 0);
  });

  test('does not divide by zero', () => {
    const found = implausibleAcv(ledgerOf(claim('mrr', 5000), claim('customers_paying', 0)));
    assert.equal(found.length, 0);
  });
});

describe('smallBaseGrowth', () => {
  test('resolves a percentage on a tiny base to absolute numbers', () => {
    const found = smallBaseGrowth(
      ledgerOf(claim('growth_rate_wow', 40), claim('customers_total', 9)),
    );
    assert.equal(found.length, 1);
    // 40% of 9 ≈ 4
    assert.match(found[0]?.probe ?? '', /is 4 more/);
  });

  test('stays quiet on a meaningful base', () => {
    const found = smallBaseGrowth(
      ledgerOf(claim('growth_rate_mom', 40), claim('customers_total', 900)),
    );
    assert.equal(found.length, 0);
  });

  test('needs a base to reason about', () => {
    const found = smallBaseGrowth(ledgerOf(claim('growth_rate_wow', 40)));
    assert.equal(found.length, 0);
  });
});

describe('vanityAsTraction', () => {
  test('flags signups offered with no hard traction anywhere', () => {
    const found = vanityAsTraction(ledgerOf(claim('signups', 5000)));
    assert.equal(found.length, 1);
    assert.match(found[0]?.probe ?? '', /came back this week/);
  });

  test('stays quiet when real traction is also present', () => {
    const found = vanityAsTraction(
      ledgerOf(claim('signups', 5000), claim('customers_paying', 20)),
    );
    assert.equal(found.length, 0);
  });
});

describe('timelineInconsistencies', () => {
  test('flags a long build with nothing to show', () => {
    const found = timelineInconsistencies(ledgerOf(claim('months_working_on_it', 30)));
    assert.equal(found.length, 1);
    assert.match(found[0]?.probe ?? '', /What's taken the time/);
  });

  test('stays quiet when there is revenue', () => {
    const found = timelineInconsistencies(
      ledgerOf(claim('months_working_on_it', 30), claim('mrr', 4000)),
    );
    assert.equal(found.length, 0);
  });
});

describe('topDownTam', () => {
  test('flags a TAM with no bottom-up build', () => {
    const found = topDownTam(ledgerOf(claim('tam', 50_000_000_000)));
    assert.equal(found.length, 1);
  });

  test('accepts a TAM backed by a price point', () => {
    const found = topDownTam(ledgerOf(claim('tam', 50_000_000_000), claim('price_point', 200)));
    assert.equal(found.length, 0);
  });
});

describe('runChecks', () => {
  test('an empty ledger produces nothing', () => {
    assert.deepEqual(runChecks(emptyLedger('s1')), []);
  });

  test('orders findings by severity', () => {
    const found = runChecks(
      ledgerOf(
        claim('tam', 50_000_000_000), // low
        claim('design_partners', 12), // high, with the next line
        claim('customers_paying', 12),
      ),
    );
    assert.ok(found.length >= 2);
    assert.equal(found[0]?.severity, 'high');
    assert.equal(found[found.length - 1]?.severity, 'low');
  });

  test('the canonical seed pitch trips several checks at once', () => {
    // "12 design partners, all of them customers, 40% WoW, been at it 3 years"
    const found = runChecks(
      ledgerOf(
        claim('design_partners', 12),
        claim('customers_paying', 12),
        claim('growth_rate_wow', 40),
        claim('months_working_on_it', 36),
      ),
    );
    const kinds = new Set(found.map((f) => f.kind));
    assert.ok(kinds.has('commitment_conflation'));
    assert.ok(kinds.has('small_base_growth'));
  });

  test('a claimed-but-conflated paying count suppresses the timeline check', () => {
    // Known interaction, encoded deliberately rather than left as a surprise.
    //
    // timelineInconsistencies treats any customers_paying claim as evidence of
    // revenue, even one that commitmentConflations has already flagged as
    // probably-not-paying. We accept this: the conflation finding is high
    // severity and asks the better question ("how many actually pay you?"),
    // so firing both would be redundant rather than additive.
    const conflated = runChecks(
      ledgerOf(
        claim('design_partners', 12),
        claim('customers_paying', 12),
        claim('months_working_on_it', 36),
      ),
    );
    const kinds = new Set(conflated.map((f) => f.kind));
    assert.ok(kinds.has('commitment_conflation'));
    assert.ok(!kinds.has('timeline_inconsistency'));

    // Without the paying claim, the timeline check does fire.
    const bare = runChecks(
      ledgerOf(claim('design_partners', 12), claim('months_working_on_it', 36)),
    );
    assert.ok(new Set(bare.map((f) => f.kind)).has('timeline_inconsistency'));
  });
});
