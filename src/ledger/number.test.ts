import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseSpokenNumber as p } from './number.ts';

describe('parseSpokenNumber', () => {
  test('written-out words — what transcripts actually contain', () => {
    // The live failure: "twelve" parsed to null, so the conflation check
    // compared two claims that both had no value and found nothing.
    assert.equal(p('twelve'), 12);
    assert.equal(p('four'), 4);
    assert.equal(p('twenty four'), 24);
    assert.equal(p('twenty-four'), 24);
    assert.equal(p('three hundred'), 300);
    assert.equal(p('three hundred and fifty'), 350);
    assert.equal(p('four thousand'), 4000);
    assert.equal(p('sixteen thousand'), 16000);
    assert.equal(p('two million'), 2_000_000);
  });

  test('digits with scale words and suffixes', () => {
    assert.equal(p('12'), 12);
    assert.equal(p('31,000'), 31000);
    assert.equal(p('16k'), 16000);
    assert.equal(p('$3M'), 3_000_000);
    assert.equal(p('1.2 million'), 1_200_000);
    assert.equal(p('40%'), 40);
  });

  test('fuzzy quantities founders actually say', () => {
    assert.equal(p('a dozen'), 12);
    assert.equal(p('a couple'), 2);
    assert.equal(p('a few'), 3);
    // Longest match wins, so the scale is not dropped.
    assert.equal(p('a couple hundred'), 200);
  });

  test('returns null rather than guessing', () => {
    // A wrong value is worse than an absent one: it produces a confident false
    // contradiction, which discredits every true finding.
    assert.equal(p('lots'), null);
    assert.equal(p(''), null);
    assert.equal(p('significant growth'), null);
  });

  test('handles the phrasing from the live session', () => {
    assert.equal(p('twelve'), 12);
    assert.equal(p('four thousand a month each'), 4000);
    assert.equal(p('two thousand a week'), 2000);
    assert.equal(p('thirty-one thousand'), 31000);
    assert.equal(p('nine weeks'), 9);
  });
});
