/**
 * Where each investor's actual body of work lives.
 *
 * A search snippet tells you an investor "cares about unit economics". Their
 * essays tell you the argument they make about unit economics, in their own
 * sentences, at length, repeatedly, over twenty years. Only the second one is
 * enough to build a persona that asks a good question — which is why this module
 * exists rather than leaning on `dossier.ts` alone.
 *
 * Not every investor has a corpus. Some write essays for two decades; some only
 * ever appear on podcasts. `dossier.ts` (search-based) is the fallback, and the
 * two are designed to compose: corpus for depth of belief, dossier for recency
 * and for speech captured from actual recordings.
 *
 * ── COPYRIGHT ───────────────────────────────────────────────────────────────
 *
 * These essays belong to the people who wrote them. So:
 *
 *   - Fetched text is cached under `.tmp/corpus/`, which is gitignored. Full
 *     essay text is never committed to this repository.
 *   - What IS committed is the derived persona: convictions restated in our own
 *     words, each carrying one short verbatim quote and a link back to the
 *     original. That is analysis with attribution, not redistribution.
 *   - The persona prompt is capped at short quotes for the same reason.
 *
 * Anyone running the ingest is fetching public pages at a polite rate for
 * analysis. Nothing here republishes a corpus.
 */

export interface CorpusSource {
  profileId: string;
  /** Human label for the body of work. */
  label: string;
  /** Page listing the articles. */
  index: string;
  /**
   * Which links on the index page are articles.
   *
   * A permissive pattern picks up navigation, feeds and archive pages, and those
   * pollute the corpus with menus rather than prose — so each source names its
   * own shape instead of sharing a generic heuristic.
   */
  articlePattern: RegExp;
  /** Links matching these are never articles, however well they match above. */
  exclude?: RegExp;
  /** Drop extracted documents shorter than this. Filters stubs and link posts. */
  minChars?: number;
}

/**
 * Ordered by how much genuine long-form material exists, which is also roughly
 * how well the resulting persona works.
 */
export const CORPUS_SOURCES: CorpusSource[] = [
  {
    profileId: 'essayist',
    label: 'paulgraham.com — collected essays',
    index: 'https://paulgraham.com/articles.html',
    // Flat site: every essay is a bare `foo.html` at the root.
    articlePattern: /^[a-z0-9]+\.html$/,
    exclude:
      /^(index|articles|books|arc|bel|lisp|antispam|rss|faq|bio|raq|infoarb|carl|kedrosky|trolls|prcmc|foundervisa)\.html$/,
    minChars: 2500,
  },
  {
    profileId: 'seed_skeptic',
    label: 'abovethecrowd.com — Bill Gurley',
    index: 'https://abovethecrowd.com/archives/',
    articlePattern: /abovethecrowd\.com\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/,
    minChars: 3000,
  },
  {
    profileId: 'seed_generalist',
    label: 'avc.com — Fred Wilson',
    index: 'https://avc.com/archive/',
    articlePattern: /avc\.com\/\d{4}\/\d{2}\/[^/]+\/?$/,
    minChars: 1200,
  },
  {
    profileId: 'thesis_macro',
    label: 'pmarchive.com — Marc Andreessen blog archive',
    index: 'https://pmarchive.com/',
    articlePattern: /pmarchive\.com\/[a-z0-9_]+\.html$/,
    exclude: /pmarchive\.com\/index\.html$/,
    minChars: 3000,
  },
];

export function sourceFor(profileId: string): CorpusSource | undefined {
  return CORPUS_SOURCES.find((s) => s.profileId === profileId);
}
