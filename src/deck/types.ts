/**
 * Deck model. (PLAN.md §5)
 *
 * The deck is a first-class *visual* input, not a text blob. `pdf-to-text`
 * discards nearly everything an investor actually reacts to — the unlabeled
 * y-axis, the projection drawn like an actual, the logo soup, the buried
 * footnote. So each slide is rendered to PNG and reasoned over as an image.
 */

export type DeckSection =
  | 'title'
  | 'problem'
  | 'solution'
  | 'product'
  | 'traction'
  | 'market'
  | 'business_model'
  | 'competition'
  | 'team'
  | 'ask'
  | 'roadmap'
  | 'other';

/**
 * Typed issue vocabulary.
 *
 * An enum rather than free text so issues are countable, testable against
 * planted-flaw decks, and each maps to a question the investor can ask —
 * `unlabeled_axis` on slide 8 becomes "your growth chart has no y-axis, what
 * are the real numbers?"
 */
export const SLIDE_ISSUES = [
  'unlabeled_axis',
  'truncated_axis',
  'projection_as_actual',
  'logo_soup',
  'vanity_metric',
  'no_source',
  'buried_caveat',
  'top_down_tam',
  'text_wall',
  'undefined_jargon',
  'inconsistent_number',
  'unreadable',
] as const;

export type SlideIssue = (typeof SLIDE_ISSUES)[number];

/** Human-readable, and the probe the investor can ask when it fires. */
export const ISSUE_PROBES: Record<SlideIssue, string> = {
  unlabeled_axis: 'The chart has no axis labels or units — what are the actual numbers?',
  truncated_axis: "The y-axis doesn't start at zero, which exaggerates the slope. What's the real growth?",
  projection_as_actual: 'Forward-looking figures are drawn the same as actuals. Which part of that line has happened?',
  logo_soup: 'A wall of logos — how many of those pay you, and how many are pilots?',
  vanity_metric: 'Signups and downloads measure curiosity. How many came back?',
  no_source: 'That statistic has no source. Where does it come from?',
  buried_caveat: 'There is a material qualifier in small print. Say it out loud.',
  top_down_tam: 'A percentage of a huge market is not a market. Build it bottom-up.',
  text_wall: 'This slide is unreadable at a glance — what is the one thing it says?',
  undefined_jargon: 'A term is used that is never defined.',
  inconsistent_number: 'This number contradicts another slide.',
  unreadable: 'Type is too small or low-contrast to read.',
};

export interface Slide {
  index: number;
  /** Absolute path to the rendered PNG. */
  imagePath: string;
  /** data: URI, for sending to the model and rendering in the UI. */
  dataUri: string;
  widthPx: number;
  heightPx: number;
}

export interface SlideCritique {
  slideNumber: number;
  detectedSection: DeckSection;
  /** What the slide is trying to do. */
  purpose: string;
  /** What it actually communicates — the gap between these two is the finding. */
  landsAs: string;
  issues: SlideIssue[];
  /** Verbatim text extracted, so cross-slide checks and the ledger can use it. */
  visibleText: string;
  /** Numbers stated on this slide, with the label they sit under. */
  numbers: Array<{ label: string; value: string }>;
  verdict: 'strong' | 'adequate' | 'weak' | 'harmful';
  /** Evidence for the critique — required, same rule as the grader. */
  evidence: string;
}

export interface DeckIssueFinding {
  kind: 'cross_slide_number' | 'missing_section' | 'density' | 'slide_issue';
  severity: 'high' | 'medium' | 'low';
  summary: string;
  slideNumbers: number[];
  probe: string;
}

export interface DeckAnalysis {
  slideCount: number;
  slides: Slide[];
  critiques: SlideCritique[];
  findings: DeckIssueFinding[];
  sectionsPresent: DeckSection[];
  sectionsMissing: DeckSection[];
  /** §5.6 — the one-liner test. */
  oneLinerFromSlide1: string;
  oneLinerFromFullDeck: string;
  score: DeckScore;
}

/** PLAN.md §8.2 — the deck is graded independently of the pitch. */
export interface DeckScore {
  comprehension: number;
  coverage: number;
  honestyOfVisuals: number;
  substantiation: number;
  internalConsistency: number;
  density: number;
}
