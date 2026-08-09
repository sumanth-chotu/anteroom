/**
 * Category intelligence. (PLAN.md §4)
 *
 * The insight this is built on:
 *
 *   The replies to a competitor's launch are a free, crowd-sourced list of the
 *   sharpest skeptical questions about a category — very close to the list a
 *   seed investor will ask you.
 *
 * When an AI-SDR tool launches and the replies are "this is a GPT wrapper" and
 * "deliverability will kill you", those are not just tweets. They are, nearly
 * verbatim, two questions the founder will face. A generic LLM asks textbook
 * questions; one that has read the reaction to every launch in your category
 * asks *this month's* questions.
 */

export type Reception = 'strong' | 'mixed' | 'skeptical' | 'ignored';

export interface MarketEvent {
  type: 'raise' | 'launch' | 'pivot' | 'shutdown' | 'acquisition';
  company: string;
  /** As stated in the source; often approximate. */
  when: string;
  amount?: string;
  summary: string;
  reception: Reception;
  sourceUrls: string[];
}

export interface ObjectionQuote {
  text: string;
  url: string;
}

export interface ObjectionTheme {
  /** Short label, in the community's own words: "just a GPT wrapper". */
  theme: string;
  /** How widely it recurs, 1–5. Not a post count — a judgement about spread. */
  frequency: number;
  /** How damaging if unanswered, 1–5. */
  severity: number;
  /**
   * The compiled question — the product of this whole pipeline.
   *
   * Phrased as an investor would ask it. Crucially it does NOT cite X: real
   * investors do not say "on X someone said", they absorb the sentiment and ask
   * it as their own. Citations live in `quotes` for the report.
   */
  investorQuestion: string;
  /** Real posts backing the theme. A theme with none is dropped. */
  quotes: ObjectionQuote[];
  /** Which companies or events triggered it. */
  triggeredBy: string[];
}

export interface CategoryBrief {
  id: string;
  /** Human-readable category label, e.g. "real-time payment fraud detection". */
  category: string;
  /** What the brief was built from. */
  seedCompany?: string;
  competitors: string[];
  refreshedAt: string;
  events: MarketEvent[];
  objectionThemes: ObjectionTheme[];
  /** Every X post consulted, for the report's "go read the threads" section. */
  sources: string[];
  cost: { seconds: number; usd: number; searches: number; toolCalls: number };
}

/** Top themes as short priors for the pre-read and the investor's instructions. */
export function briefPriors(brief: CategoryBrief, limit = 4): string[] {
  return [...brief.objectionThemes]
    .sort((a, b) => b.frequency * b.severity - a.frequency * a.severity)
    .slice(0, limit)
    .map((t) => t.theme);
}
