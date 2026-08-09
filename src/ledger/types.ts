/**
 * The claim ledger. (PLAN.md §7)
 *
 * Every number a founder states — in the deck or out loud — lands here. The
 * ledger is what lets the investor catch the founder contradicting themselves
 * twenty minutes later, and it's the substrate for the whole feedback report.
 *
 * Seed-calibrated: the interesting failures at this stage are *inflation and
 * conflation* (design partner → customer → paying customer), not unit economics.
 */

/**
 * Canonical metric vocabulary.
 *
 * Free-text metric names can't be cross-checked — "customers", "users", and
 * "logos" would never collide. Normalizing at extraction time is what makes the
 * deterministic checks in `checks.ts` possible.
 */
export const METRIC_KEYS = [
  // Revenue
  'mrr',
  'arr',
  'revenue_total',
  // Customer counts — deliberately distinct; conflating them is the #1 seed tell
  'customers_paying',
  'customers_total',
  'design_partners',
  'pilots',
  'lois',
  // Soft traction — easy to inflate, rarely evidence of demand
  'waitlist',
  'signups',
  'active_users',
  'downloads',
  // Growth
  'growth_rate_wow',
  'growth_rate_mom',
  'retention_rate',
  'churn_rate',
  // Money
  'burn_monthly',
  'runway_months',
  'raise_amount',
  'valuation',
  // Company
  'headcount',
  'founded_date',
  'launch_date',
  'months_working_on_it',
  // Market
  'tam',
  'sam',
  'som',
  'price_point',
  'other',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/** Metrics that represent a count of customers at differing levels of commitment. */
export const COMMITMENT_LADDER: readonly MetricKey[] = [
  'waitlist',
  'signups',
  'design_partners',
  'pilots',
  'lois',
  'customers_total',
  'customers_paying',
] as const;

/** Soft metrics frequently presented as if they were traction. */
export const VANITY_METRICS: readonly MetricKey[] = [
  'waitlist',
  'signups',
  'downloads',
] as const;

export interface Claim {
  id: string;
  sessionId: string;
  source: 'deck' | 'spoken';
  /** Populated when source === 'deck'. */
  slideNumber?: number;
  /** Populated when source === 'spoken'. */
  turnId?: string;

  metric: MetricKey;
  /** Normalized numeric value where one exists; null for qualitative claims. */
  value: number | null;
  /** Raw value as stated, e.g. "about 40%", "a dozen". */
  valueRaw: string;
  unit?: string;
  /** Period the claim refers to, as stated: "last 30d", "Jan 2026", "TTM". */
  period?: string;

  /** Exact words the founder used. Required — this is what powers the report. */
  verbatim: string;
  /** Extraction confidence, 0–1. Low-confidence claims don't trigger contradictions. */
  confidence: number;
  createdAt: number;
}

export type FindingKind =
  /** Same metric, same period, two different values. */
  | 'direct_contradiction'
  /** Numbers that don't reconcile: mrr × 12 ≠ arr. */
  | 'arithmetic_mismatch'
  /** Same cohort described at two levels of commitment. */
  | 'commitment_conflation'
  /** revenue ÷ customers gives an implausible deal size. */
  | 'implausible_acv'
  /** A growth rate quoted off a base small enough to be meaningless. */
  | 'small_base_growth'
  /** A soft metric offered where traction was asked for. */
  | 'vanity_as_traction'
  /** Timeline claims that don't fit together. */
  | 'timeline_inconsistency'
  /** Top-down market sizing with no bottom-up build. */
  | 'top_down_tam'
  /** Spoken claim contradicts the deck. Phase 1. */
  | 'contradicts_deck'
  /** Competitive claim contradicts the category brief. Phase 4. */
  | 'contradicts_market';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** Plain-language statement of the problem, for the report. */
  summary: string;
  /** The claims involved. Always at least one. */
  claims: Claim[];
  /**
   * The question an investor would ask on noticing this. Deterministic checks
   * produce a serviceable default; the engine may rephrase in the archetype's voice.
   */
  probe: string;
}

export interface Ledger {
  sessionId: string;
  claims: Claim[];
}

export function emptyLedger(sessionId: string): Ledger {
  return { sessionId, claims: [] };
}

export function addClaim(ledger: Ledger, claim: Claim): Ledger {
  return { ...ledger, claims: [...ledger.claims, claim] };
}

export function claimsFor(ledger: Ledger, metric: MetricKey): Claim[] {
  return ledger.claims.filter((c) => c.metric === metric);
}
