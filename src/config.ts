/**
 * Environment configuration.
 *
 * Model IDs are env-driven, never hardcoded — xAI retired the Grok 3/4 families
 * in May 2026 and will do so again. One place to change them. (PLAN.md §14)
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}.\n` +
        `Copy .env.example to .env and fill it in, then run with --env-file=.env`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  xai: {
    apiKey: required('XAI_API_KEY'),
    baseUrl: optional('XAI_BASE_URL', 'https://api.x.ai/v1'),
    /** Vision, grading, per-slide critique. Best quality. */
    reasoning: optional('XAI_MODEL_REASONING', 'grok-4.5'),
    /** Whole-deck and whole-corpus passes where context is the binding constraint. */
    longContext: optional('XAI_MODEL_LONG_CONTEXT', 'grok-4.3'),
    /** Realtime speech-to-speech (Phase 2). */
    voice: optional('XAI_MODEL_VOICE', 'grok-voice-latest'),
  },
} as const;

export type Config = typeof config;
