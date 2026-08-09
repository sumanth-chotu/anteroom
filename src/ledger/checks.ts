/**
 * Deterministic contradiction checks. (PLAN.md §7.1)
 *
 * Pure functions over the ledger. No model calls — these are arithmetic and set
 * logic, which makes them cheap, instant, unit-testable, and incapable of
 * hallucinating. Per CLAUDE.md, deterministic checks run first and take
 * precedence; a model only gets involved for genuine ambiguity.
 *
 * Every check returns Findings with a ready-to-ask `probe`, so the question
 * engine can fire one immediately without a round trip.
 */

import {
  COMMITMENT_LADDER,
  VANITY_METRICS,
  type Claim,
  type Finding,
  type Ledger,
  type MetricKey,
} from './types.ts';

/** Below this, a growth percentage describes noise rather than traction. */
const SMALL_BASE_THRESHOLD = 50;

/** Monthly revenue per paying customer above this suggests one pilot annualized. */
const IMPLAUSIBLE_MONTHLY_ACV = 50_000;

/** Claims below this confidence never trigger a finding — too noisy. */
const MIN_CONFIDENCE = 0.6;

/**
 * Metrics that must never be cross-compared.
 *
 * `other` is a catch-all bucket, so two claims land in it for entirely
 * unrelated reasons — "six years at Stripe" and "cheap enough about a year ago"
 * both normalize to `other`, and comparing them yields a nonsense contradiction.
 *
 * Caught in the first end-to-end run. A false contradiction is worse than a
 * missed one: it destroys the founder's trust in every other finding, and the
 * whole product rests on those findings being believable.
 */
const NON_COMPARABLE: readonly MetricKey[] = ['other'] as const;

function confident(claims: Claim[]): Claim[] {
  return claims.filter((c) => c.confidence >= MIN_CONFIDENCE);
}

function comparable(claims: Claim[]): Claim[] {
  return confident(claims).filter((c) => !NON_COMPARABLE.includes(c.metric));
}

function numeric(claims: Claim[], metric: MetricKey): Claim[] {
  return confident(claims).filter((c) => c.metric === metric && c.value !== null);
}

function latest(claims: Claim[], metric: MetricKey): Claim | undefined {
  const matches = numeric(claims, metric);
  return matches.length > 0 ? matches[matches.length - 1] : undefined;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ─────────────────────────────────────────────────────────────────────────────

/** Same metric, same period, two different values. */
export function directContradictions(ledger: Ledger): Finding[] {
  const findings: Finding[] = [];
  const groups = new Map<string, Claim[]>();

  for (const claim of comparable(ledger.claims)) {
    if (claim.value === null) continue;
    const key = `${claim.metric}::${claim.period ?? 'unspecified'}`;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }

  for (const group of groups.values()) {
    const first = group[0];
    if (!first || group.length < 2) continue;

    // Two numbers stated in the same breath are a BREAKDOWN, not a
    // contradiction. "Hiring four engineers and two go-to-market hires" both
    // normalise to headcount, and comparing them yields a nonsense finding.
    //
    // A contradiction requires the founder to have said different things at
    // different moments — so claims sharing an origin are skipped.
    const origins = new Set(group.map((c) => c.turnId ?? `slide-${c.slideNumber}`));
    if (origins.size < 2) continue;

    const distinct = [...new Set(group.map((c) => c.value))];
    if (distinct.length < 2) continue;

    const a = group.find((c) => c.value === distinct[0]);
    const b = group.find((c) => c.value === distinct[1]);
    if (!a || !b) continue;

    findings.push({
      kind: 'direct_contradiction',
      severity: 'high',
      summary:
        `Stated ${first.metric} as ${fmt(a.value as number)} and ${fmt(b.value as number)} ` +
        `for the same period.`,
      claims: [a, b],
      probe:
        `Earlier you said "${a.verbatim.trim()}" — just now it was "${b.verbatim.trim()}". ` +
        `Which is it?`,
    });
  }

  return findings;
}

/** MRR × 12 should equal ARR. When it doesn't, one of the two is decorative. */
export function arithmeticMismatches(ledger: Ledger): Finding[] {
  const findings: Finding[] = [];
  const mrr = latest(ledger.claims, 'mrr');
  const arr = latest(ledger.claims, 'arr');

  if (mrr?.value && arr?.value) {
    const implied = mrr.value * 12;
    const drift = Math.abs(implied - arr.value) / Math.max(arr.value, 1);
    if (drift > 0.15) {
      findings.push({
        kind: 'arithmetic_mismatch',
        severity: 'high',
        summary: `MRR of ${fmt(mrr.value)} implies ARR of ${fmt(implied)}, but ARR was stated as ${fmt(arr.value)}.`,
        claims: [mrr, arr],
        probe:
          `You said ${fmt(mrr.value)} MRR and ${fmt(arr.value)} ARR. Twelve times your MRR is ` +
          `${fmt(implied)}. Where does the difference come from?`,
      });
    }
  }

  return findings;
}

/**
 * The signature seed failure: the same cohort described at two levels of
 * commitment. Twelve design partners become twelve customers become twelve
 * paying customers, and nobody ever signed anything.
 */
export function commitmentConflations(ledger: Ledger): Finding[] {
  const findings: Finding[] = [];
  const onLadder = confident(ledger.claims).filter(
    (c) => c.value !== null && COMMITMENT_LADDER.includes(c.metric),
  );

  // Same headcount appearing at two different rungs.
  const byValue = new Map<number, Claim[]>();
  for (const claim of onLadder) {
    byValue.set(claim.value as number, [...(byValue.get(claim.value as number) ?? []), claim]);
  }

  for (const [value, group] of byValue) {
    const rungs = [...new Set(group.map((c) => c.metric))];
    if (rungs.length < 2) continue;

    const a = group.find((c) => c.metric === rungs[0]);
    const b = group.find((c) => c.metric === rungs[1]);
    if (!a || !b) continue;

    findings.push({
      kind: 'commitment_conflation',
      severity: 'high',
      summary:
        `The same number (${fmt(value)}) was described as both ${a.metric.replace(/_/g, ' ')} ` +
        `and ${b.metric.replace(/_/g, ' ')}.`,
      claims: [a, b],
      probe:
        `You've called the same ${fmt(value)} both ${a.metric.replace(/_/g, ' ')} and ` +
        `${b.metric.replace(/_/g, ' ')}. Are those the same ${fmt(value)} — and how many of ` +
        `them actually pay you?`,
    });
  }

  // Paying customers cannot exceed total customers.
  const paying = latest(ledger.claims, 'customers_paying');
  const total = latest(ledger.claims, 'customers_total');
  if (paying?.value && total?.value && paying.value > total.value) {
    findings.push({
      kind: 'commitment_conflation',
      severity: 'high',
      summary: `Paying customers (${fmt(paying.value)}) exceeds total customers (${fmt(total.value)}).`,
      claims: [paying, total],
      probe:
        `You said ${fmt(total.value)} customers but ${fmt(paying.value)} paying. ` +
        `That can't both be true — walk me through the actual numbers.`,
    });
  }

  return findings;
}

/** Revenue ÷ paying customers. Catches a single pilot annualized into "ARR". */
export function implausibleAcv(ledger: Ledger): Finding[] {
  const mrr = latest(ledger.claims, 'mrr');
  const paying = latest(ledger.claims, 'customers_paying');
  if (!mrr?.value || !paying?.value || paying.value <= 0) return [];

  const acv = mrr.value / paying.value;
  if (acv < IMPLAUSIBLE_MONTHLY_ACV) return [];

  return [
    {
      kind: 'implausible_acv',
      severity: 'medium',
      summary:
        `${fmt(mrr.value)} MRR across ${fmt(paying.value)} paying customers implies ` +
        `${fmt(Math.round(acv))}/month each.`,
      claims: [mrr, paying],
      probe:
        `${fmt(mrr.value)} MRR over ${fmt(paying.value)} customers is about ` +
        `${fmt(Math.round(acv))} a month each. Is that a signed recurring contract, or a pilot ` +
        `you've annualized?`,
    },
  ];
}

/** A growth rate quoted off a base small enough to be meaningless. */
export function smallBaseGrowth(ledger: Ledger): Finding[] {
  const findings: Finding[] = [];
  const rates = [
    ...numeric(ledger.claims, 'growth_rate_wow'),
    ...numeric(ledger.claims, 'growth_rate_mom'),
  ];
  if (rates.length === 0) return [];

  // Smallest stated count is the most likely base for the rate.
  const counts = COMMITMENT_LADDER.flatMap((m) => numeric(ledger.claims, m));
  if (counts.length === 0) return [];

  const smallest = counts.reduce((min, c) =>
    (c.value as number) < (min.value as number) ? c : min,
  );
  if ((smallest.value as number) >= SMALL_BASE_THRESHOLD) return [];

  const rate = rates[rates.length - 1];
  if (!rate) return [];

  const base = smallest.value as number;
  const absolute = Math.round(base * ((rate.value as number) / 100));

  findings.push({
    kind: 'small_base_growth',
    severity: 'medium',
    summary:
      `${fmt(rate.value as number)}% growth quoted against a base of ${fmt(base)} — ` +
      `about ${fmt(absolute)} in absolute terms.`,
    claims: [rate, smallest],
    probe:
      `${fmt(rate.value as number)}% growth on ${fmt(base)} is ${fmt(absolute)} more. ` +
      `Give me the absolute numbers month by month instead of the percentage.`,
  });

  return findings;
}

/** Soft metrics standing in for traction, with no hard number anywhere. */
export function vanityAsTraction(ledger: Ledger): Finding[] {
  const claims = confident(ledger.claims);
  const vanity = claims.filter((c) => VANITY_METRICS.includes(c.metric) && c.value !== null);
  if (vanity.length === 0) return [];

  const hasHardTraction = claims.some(
    (c) =>
      c.value !== null &&
      (['customers_paying', 'mrr', 'arr', 'revenue_total', 'retention_rate'] as MetricKey[]).includes(
        c.metric,
      ),
  );
  if (hasHardTraction) return [];

  const strongest = vanity.reduce((max, c) => ((c.value as number) > (max.value as number) ? c : max));

  return [
    {
      kind: 'vanity_as_traction',
      severity: 'medium',
      summary:
        `Offered ${fmt(strongest.value as number)} ${strongest.metric.replace(/_/g, ' ')} as ` +
        `evidence, with no retention or revenue figure anywhere.`,
      claims: [strongest],
      probe:
        `${fmt(strongest.value as number)} ${strongest.metric.replace(/_/g, ' ')} tells me people ` +
        `were curious once. How many came back this week, and how many pay you?`,
    },
  ];
}

/** Timeline claims that don't fit together. */
export function timelineInconsistencies(ledger: Ledger): Finding[] {
  const findings: Finding[] = [];
  const working = latest(ledger.claims, 'months_working_on_it');
  const launched = latest(ledger.claims, 'launch_date');

  if (working?.value && working.value > 24) {
    const hasRevenue = confident(ledger.claims).some(
      (c) => (['mrr', 'arr', 'customers_paying'] as MetricKey[]).includes(c.metric) && c.value,
    );
    if (!hasRevenue) {
      findings.push({
        kind: 'timeline_inconsistency',
        severity: 'medium',
        summary: `${fmt(working.value)} months in with no revenue or paying customers stated.`,
        claims: launched ? [working, launched] : [working],
        probe:
          `You've been at this ${fmt(working.value)} months and haven't mentioned a single paying ` +
          `customer. What's taken the time?`,
      });
    }
  }

  return findings;
}

/** Top-down market sizing with nothing bottom-up behind it. */
export function topDownTam(ledger: Ledger): Finding[] {
  const tam = latest(ledger.claims, 'tam');
  if (!tam?.value) return [];

  const hasBottomUp = confident(ledger.claims).some(
    (c) => (['price_point', 'som'] as MetricKey[]).includes(c.metric) && c.value !== null,
  );
  if (hasBottomUp) return [];

  return [
    {
      kind: 'top_down_tam',
      severity: 'low',
      summary: `TAM of ${fmt(tam.value)} with no price point or bottom-up build.`,
      claims: [tam],
      probe:
        `You gave me a ${fmt(tam.value)} market. Build it up from the bottom instead — who pays ` +
        `you, how much, and how many of them are there?`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────

const CHECKS = [
  directContradictions,
  arithmeticMismatches,
  commitmentConflations,
  implausibleAcv,
  smallBaseGrowth,
  vanityAsTraction,
  timelineInconsistencies,
  topDownTam,
] as const;

const SEVERITY_ORDER: Record<Finding['severity'], number> = { high: 0, medium: 1, low: 2 };

/** Run every deterministic check. Highest severity first. */
export function runChecks(ledger: Ledger): Finding[] {
  return CHECKS.flatMap((check) => check(ledger)).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/**
 * Identity of a finding, for "have we already asked about this?".
 *
 * Keyed on kind + the METRICS involved, deliberately not the claim ids.
 *
 * Claim ids looked right and were wrong: as the founder revises a number, the
 * check re-fires against the new claim, producing a fresh key and asking the
 * same question again. Observed live — the investor asked "40% growth on 8 is
 * three people, give me the monthly numbers", the founder revised 8 to 4, and
 * three turns later it asked "40% growth on 4 is two people, give me the
 * monthly numbers". Same question, and it reads as not listening.
 *
 * Metrics are stable across revisions, so one topic is raised once.
 */
export function findingKey(finding: Finding): string {
  const metrics = [...new Set(finding.claims.map((c) => c.metric))].sort().join('+');
  return `${finding.kind}::${metrics}`;
}

export function unraisedFindings(ledger: Ledger, raised: ReadonlySet<string>): Finding[] {
  return runChecks(ledger).filter((f) => !raised.has(findingKey(f)));
}
