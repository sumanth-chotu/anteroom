/**
 * Free-text metric label → canonical `MetricKey`, deterministically.
 *
 * The text path normalises via a model call (`ledger/extract.ts`), which is fine
 * when a turn already costs a round trip. The voice path cannot: `note_claim`
 * fires mid-sentence and the model blocks on the tool result, so anything slow
 * here stalls the conversation. This is keyword matching — microseconds, and it
 * never hallucinates a metric.
 *
 * Order matters. The commitment ladder is checked most-specific first, because
 * "paying customers" must not fall through to `customers_total` — collapsing
 * those two is precisely the seed failure the ledger exists to catch.
 */

import type { MetricKey } from './types.ts';

type Rule = [RegExp, MetricKey];

const RULES: Rule[] = [
  // ── Per-unit economics, BEFORE the ladder ──────────────────────────────────
  //
  // "revenue per paying customer" contains "paying customer" and would otherwise
  // match the ladder, turning a $4,000 price into a count of 4,000 customers —
  // observed live, and it produced a nonsense contradiction against "4 paying".
  // Anything phrased "per <unit>" is a rate, not a population.
  [/\bper\s+(paying\s+|active\s+)?(customer|client|account|seat|user|month|year|transaction)/, 'price_point'],
  [/\b(acv|arpu|arpa|contract value|deal size|price point|pricing)/, 'price_point'],

  // ── Commitment ladder — most specific first, always ────────────────────────
  [/\b(paying|paid)\s+(customer|client|account|logo|user)/, 'customers_paying'],
  [/\bcustomers?\s+(who|that)\s+pay/, 'customers_paying'],
  [/\b(revenue[- ]generating|monetis|monetiz)/, 'customers_paying'],
  [/\bdesign\s+partner/, 'design_partners'],
  [/\b(pilot|proof[- ]of[- ]concept|poc|trial)/, 'pilots'],
  [/\b(loi|letter of intent|verbal commit)/, 'lois'],
  [/\bwait\s?list/, 'waitlist'],
  [/\b(sign[- ]?up|registration)/, 'signups'],
  [/\bdownload/, 'downloads'],
  [/\b(active|weekly active|monthly active|wau|mau|dau)\b/, 'active_users'],
  [/\b(customer|client|account|logo)/, 'customers_total'],

  // ── Revenue ────────────────────────────────────────────────────────────────
  [/\b(arr|annual recurring)/, 'arr'],
  [/\b(mrr|monthly recurring)/, 'mrr'],
  [/\brevenue|\bbookings|\bgmv\b/, 'revenue_total'],
  [/\b(price|pricing|acv|per seat|per month per)/, 'price_point'],

  // ── Growth ─────────────────────────────────────────────────────────────────
  [/\bweek[- ]over[- ]week|\bwow\b|\bweekly growth/, 'growth_rate_wow'],
  [/\bmonth[- ]over[- ]month|\bmom\b|\bmonthly growth/, 'growth_rate_mom'],
  [/\bretention|\brenew|\bstuck around/, 'retention_rate'],
  [/\bchurn/, 'churn_rate'],
  [/\bgrow(th|ing)?\b/, 'growth_rate_mom'],

  // ── Money ──────────────────────────────────────────────────────────────────
  [/\bburn\b/, 'burn_monthly'],
  [/\brunway\b/, 'runway_months'],
  [/\b(rais|round size|seed round|cheque|check size)/, 'raise_amount'],
  [/\bvaluation|\bpre[- ]money|\bpost[- ]money/, 'valuation'],

  // ── Company ────────────────────────────────────────────────────────────────
  [/\b(headcount|employee|team size|engineer|hire)/, 'headcount'],
  [/\b(founded|started the company|incorporat)/, 'founded_date'],
  [/\blaunch/, 'launch_date'],
  [/\b(working on (this|it)|been at (this|it)|months? in|years? in)/, 'months_working_on_it'],

  // ── Market ─────────────────────────────────────────────────────────────────
  [/\btam\b|\btotal addressable/, 'tam'],
  [/\bsam\b|\bserviceable addressable/, 'sam'],
  [/\bsom\b|\bserviceable obtainable|\bbeachhead/, 'som'],
];

export function normaliseSpokenClaim(label: string): MetricKey {
  const text = label.toLowerCase().trim();
  for (const [pattern, metric] of RULES) {
    if (pattern.test(text)) return metric;
  }
  return 'other';
}
