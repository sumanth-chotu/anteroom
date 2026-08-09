/**
 * Spoken number → numeric value.
 *
 * Transcripts spell numbers out. `note_claim` fires on speech, so the voice path
 * receives "twelve", "four thousand", "a couple hundred" — not "12". The text
 * path normalises through a model call and handles this for free; the voice path
 * cannot afford one mid-sentence, so it needs a parser.
 *
 * Without it the voice ledger is effectively blind: every spoken claim lands
 * with `value: null`, and every check that compares values silently skips.
 * Observed live — the founder said "twelve design partners and all twelve are
 * paying customers", both claims were captured, and the conflation check found
 * nothing because neither had a number.
 */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/** Vague quantities founders actually say. Approximations, flagged as such. */
const FUZZY: Record<string, number> = {
  'a couple': 2, couple: 2, 'a few': 3, few: 3, several: 4,
  'a dozen': 12, dozen: 12, 'a handful': 5, handful: 5,
};

/** Suffixes: 16k, 1.2m, $3M. */
const SUFFIX: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

/**
 * Parse a spoken or written quantity. Returns null when there is no number,
 * rather than guessing — a wrong value is worse than an absent one, because it
 * produces a confident false contradiction.
 */
export function parseSpokenNumber(input: string): number | null {
  const text = input.toLowerCase().trim();
  if (!text) return null;

  // 1. Digits, with optional scale suffix or trailing scale word.
  //    "16k" · "$3M" · "1.2 million" · "31,000"
  const digits = /(-?\d[\d,]*\.?\d*)\s*(k|m|b|hundred|thousand|million|billion)?/.exec(text);
  if (digits?.[1]) {
    const base = Number.parseFloat(digits[1].replace(/,/g, ''));
    if (Number.isFinite(base)) {
      const scaleWord = digits[2];
      const scale = scaleWord ? (SUFFIX[scaleWord] ?? SCALES[scaleWord] ?? 1) : 1;
      return base * scale;
    }
  }

  // 2. Fuzzy quantities — longest match first so "a couple hundred" beats "a couple".
  for (const phrase of Object.keys(FUZZY).sort((a, b) => b.length - a.length)) {
    if (text.includes(phrase)) {
      const value = FUZZY[phrase]!;
      const scale = Object.keys(SCALES).find((s) => text.includes(s));
      return scale ? value * SCALES[scale]! : value;
    }
  }

  // 3. Written-out words: "twenty four", "four thousand", "three hundred and fifty".
  const words = text.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let matched = false;

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (!clean || clean === 'and') continue;

    if (UNITS[clean] !== undefined) {
      current += UNITS[clean]; matched = true;
    } else if (TENS[clean] !== undefined) {
      current += TENS[clean]; matched = true;
    } else if (clean === 'hundred') {
      current = (current || 1) * 100; matched = true;
    } else if (SCALES[clean] !== undefined) {
      total += (current || 1) * SCALES[clean];
      current = 0;
      matched = true;
    }
  }

  if (!matched) return null;
  return total + current;
}
