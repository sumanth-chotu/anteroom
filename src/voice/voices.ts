/**
 * Casting a voice for each investor.
 *
 * Before this, every investor spoke in the same voice — and not by choice. The
 * realtime API takes a `voice` parameter, we never set one, and its default is
 * `xai_ara`. Seven distinct personalities, one woman's voice, which undoes most
 * of what the persona work buys.
 *
 * ── TWO THINGS THE API DOES THAT WILL BITE YOU ──────────────────────────────
 *
 * 1. `voice` is a CONNECT-URL parameter, not a session field. Sending it in
 *    `session.update` is accepted, echoed back without the field, and silently
 *    ignored. Verified against the live socket.
 *
 * 2. An unrecognised voice id does NOT error. It falls back to `human_eve`. So a
 *    typo produces a working session in the wrong voice, which is exactly the bug
 *    that hid here in the first place — `assertVoice` exists to make that loud.
 *
 * Ids are not uniformly namespaced: some are bare (`orion`), some carry `xai_`
 * (`xai_ara`, `xai_sal`, `xai_rex`) and some `human_` (`human_eve`, `human_leo`).
 * Enumerated by connecting with each candidate and reading back what
 * `session.created` reported. There is no list endpoint — `/v1/realtime/voices`
 * requires an entitlement this team does not have.
 *
 * Cloning a specific real person's voice is deliberately not attempted. The
 * custom-voice endpoint is gated anyway, and this repo's whole approach to real
 * public figures is a labelled caricature rather than an imitation good enough to
 * mistake — a cloned voice would cross that line. Casting a stock voice by vocal
 * character gets the distinctness without the impersonation.
 */

/** Fallback the API silently substitutes for anything it does not recognise. */
export const SILENT_FALLBACK = 'human_eve';

/** Verified default when no voice is requested. */
export const API_DEFAULT = 'xai_ara';

/**
 * Every id confirmed to be honoured, with the canonical namespace it needs.
 *
 * Confirmed by asserting `session.created.voice === requested`. Bare names that
 * were NOT honoured are omitted rather than aliased, so nothing here can quietly
 * resolve to the fallback.
 */
export const REALTIME_VOICES = [
  'altair', 'atlas', 'carina', 'castor', 'celeste', 'cosmo', 'helios', 'helix',
  'human_eve', 'human_leo', 'iris', 'kepler', 'lumen', 'luna', 'lux', 'naksh',
  'orion', 'perseus', 'rigel', 'sirius', 'ursa', 'xai_ara', 'xai_rex', 'xai_sal',
  'zagan', 'zenith',
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

const VALID = new Set<string>(REALTIME_VOICES);

/**
 * Casting notes.
 *
 * Chosen for vocal character against each profile's temperament — pace, weight,
 * and how a clipped line lands. Not an attempt to match how the real person
 * sounds, which would be both impossible with stock voices and the wrong goal.
 *
 * The point is only that they are DIFFERENT from each other. A founder who
 * practises against four investors should remember four people.
 */
const CASTING: Record<string, { voice: RealtimeVoice; why: string }> = {
  seed_generalist: {
    voice: 'kepler',
    why: 'unhurried and even — warmth that reads as genuine rather than performed',
  },
  seed_skeptic: {
    voice: 'orion',
    why: 'flat, low and unimpressed; a short line lands hard without being raised',
  },
  technical_angel: {
    voice: 'helix',
    why: 'precise and quiet, the register of someone describing a system',
  },
  thesis_macro: {
    voice: 'zenith',
    why: 'declarative and expansive — carries a long argument without flagging',
  },
  accelerator_operator: {
    voice: 'lux',
    why: 'fast and clipped, matching the shortest interrupt threshold in the cast',
  },
  solo_capitalist: {
    voice: 'xai_rex',
    why: 'bright and quick, the voice of someone who is extremely online',
  },
  essayist: {
    voice: 'lumen',
    why: 'plain and deliberate; pauses read as thinking rather than as latency',
  },
  incubator_blowhard: {
    voice: 'zagan',
    why: 'loud and pleased with itself — the comedy needs volume, not menace',
  },
};

export function voiceFor(profileId: string): RealtimeVoice {
  return CASTING[profileId]?.voice ?? 'orion';
}

export function castingNote(profileId: string): string {
  return CASTING[profileId]?.why ?? 'default casting';
}

export function isValidVoice(voice: string): voice is RealtimeVoice {
  return VALID.has(voice);
}

/**
 * Build the realtime connect URL with the voice baked in.
 *
 * The only correct place to set it — see the header note.
 */
export function realtimeUrl(baseUrl: string, model: string, voice: string): string {
  const url = new URL(`${baseUrl.replace(/^http/, 'ws')}/realtime`);
  url.searchParams.set('model', model);
  url.searchParams.set('voice', voice);
  return url.toString();
}

/**
 * Compare what the server reported against what was asked for.
 *
 * Returns a warning string, or undefined when correct. Call this on
 * `session.created` — it is the only signal that a voice request was honoured,
 * because the failure mode is a silent substitution rather than an error.
 */
export function assertVoice(requested: string, reported: string | undefined): string | undefined {
  if (!reported || reported === requested) return undefined;
  return (
    `voice "${requested}" was not honoured — the API substituted "${reported}". ` +
    (reported === SILENT_FALLBACK
      ? `That is the silent fallback, so the id is not recognised. Check it against ` +
        `REALTIME_VOICES in src/voice/voices.ts.`
      : `Expected "${requested}".`)
  );
}
