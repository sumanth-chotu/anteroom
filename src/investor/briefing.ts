/**
 * Everything known about one investor, loaded once per session.
 *
 * Three sources, in descending order of how much they change the output:
 *
 *   corpus    a persona synthesised from their own published work. Convictions,
 *             diagnostics, opening, voice. The strongest signal by a wide margin,
 *             because it was built by a model that read the whole body of work.
 *   dossier   search-based research: recent positions, speech captured from
 *             recordings, portfolio. For investors who talk more than they write.
 *   profile   the hand-written temperament dials. Always present.
 *
 * Loaded together and passed down as one object so that prompt building stays
 * synchronous. The alternative — awaiting a file read inside `buildSystemPrompt`
 * — would put disk I/O on the per-turn path and force every caller to become
 * async for no benefit, since none of this changes mid-session.
 *
 * All three are optional. With none of them the app behaves exactly as it did
 * before any of this existed, which is the property that makes the whole feature
 * safe to add: a missing fixture degrades, it does not break.
 */

import { loadCorpusPersona } from '../corpus/store.ts';
import type { CorpusPersona } from '../corpus/types.ts';
import { loadDossier } from './dossier-store.ts';
import type { Dossier } from './dossier.ts';
import { getProfile, type InvestorProfile } from './profiles.ts';
import { personaFor, type Persona } from './persona.ts';

export interface Briefing {
  profile: InvestorProfile;
  persona?: Persona;
  corpus?: CorpusPersona | null;
  dossier?: Dossier | null;
}

/** What the prompt builders need. Kept narrow so tests can construct one. */
export interface Enrichment {
  corpus?: CorpusPersona | null;
  dossier?: Dossier | null;
}

export async function loadBriefing(profileId: string): Promise<Briefing> {
  const profile = getProfile(profileId);
  const [corpus, dossier] = await Promise.all([
    loadCorpusPersona(profileId),
    loadDossier(profileId),
  ]);

  const briefing: Briefing = { profile, corpus, dossier };
  const persona = personaFor(profileId);
  if (persona) briefing.persona = persona;
  return briefing;
}

/** One-line summary of what a session is actually running on. For logs and UI. */
export function briefingSummary(briefing: Briefing): string {
  const parts: string[] = [];
  if (briefing.corpus) {
    parts.push(
      `corpus: ${briefing.corpus.corpus.documents} docs, ` +
        `${briefing.corpus.convictions.length} convictions`,
    );
  }
  if (briefing.dossier) {
    parts.push(`dossier: ${briefing.dossier.pressurePoints.length} pressure points`);
  }
  return parts.length ? parts.join(' · ') : 'profile only — no research loaded';
}
