import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseSpokenClaim as n } from './normalise.ts';

describe('normaliseSpokenClaim', () => {
  test('keeps the commitment ladder separate — the whole point', () => {
    // If any two of these collapse, the conflation check goes blind and the
    // signature seed failure stops being detectable.
    assert.equal(n('paying customers'), 'customers_paying');
    assert.equal(n('customers'), 'customers_total');
    assert.equal(n('design partners'), 'design_partners');
    assert.equal(n('pilots'), 'pilots');
    assert.equal(n('LOIs'), 'lois');
    assert.equal(n('waitlist'), 'waitlist');
    assert.equal(n('signups'), 'signups');
  });

  test('specific beats general regardless of phrasing', () => {
    // Each of these contains "customer" and must NOT fall through to
    // customers_total.
    assert.equal(n('paying customers'), 'customers_paying');
    assert.equal(n('paid customers'), 'customers_paying');
    assert.equal(n('customers who pay us'), 'customers_paying');
    // "design partner customers" is design partners being *called* customers —
    // exactly the conflation we want visible, so it must resolve to the rung
    // the words actually support, not the flattering one.
    assert.equal(n('design partner customers'), 'design_partners');
  });

  test('revenue terms', () => {
    assert.equal(n('ARR'), 'arr');
    assert.equal(n('annual recurring revenue'), 'arr');
    assert.equal(n('MRR'), 'mrr');
    assert.equal(n('monthly recurring revenue'), 'mrr');
    assert.equal(n('revenue'), 'revenue_total');
  });

  test('growth periods are distinguished', () => {
    assert.equal(n('week over week growth'), 'growth_rate_wow');
    assert.equal(n('WoW'), 'growth_rate_wow');
    assert.equal(n('month over month'), 'growth_rate_mom');
    assert.equal(n('growth'), 'growth_rate_mom');
  });

  test('money and company terms', () => {
    assert.equal(n('burn'), 'burn_monthly');
    assert.equal(n('runway'), 'runway_months');
    assert.equal(n('raising'), 'raise_amount');
    assert.equal(n('headcount'), 'headcount');
    assert.equal(n('engineers to hire'), 'headcount');
  });

  test('unknown labels fall back rather than guessing', () => {
    // 'other' is excluded from cross-comparison in checks.ts, so an unmatched
    // label is inert rather than a source of false contradictions.
    assert.equal(n('vibes'), 'other');
    assert.equal(n('p99 latency'), 'other');
  });

  test('is case and spacing insensitive', () => {
    assert.equal(n('  PAYING CUSTOMERS  '), 'customers_paying');
    assert.equal(n('Design Partner'), 'design_partners');
    assert.equal(n('wait list'), 'waitlist');
  });
});
