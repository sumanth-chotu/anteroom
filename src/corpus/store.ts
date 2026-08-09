/**
 * Loading a built persona. Deliberately dependency-light.
 *
 * Kept out of `persona.ts` so the server and the voice relay can read a persona
 * without importing the synthesis pipeline, its Zod schemas, or the ingest
 * fetcher. A relay handling live audio has no business pulling in a research
 * pipeline to look up a JSON file.
 *
 * A missing persona is never an error. The app degrades to the hand-written
 * profile in `profiles.ts`, which is exactly how it behaved before corpora
 * existed.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CorpusPersona } from './types.ts';

export function personaPath(profileId: string): string {
  return resolve(`fixtures/personas/${profileId}.json`);
}

const cache = new Map<string, CorpusPersona | null>();

export async function loadCorpusPersona(profileId: string): Promise<CorpusPersona | null> {
  const cached = cache.get(profileId);
  if (cached !== undefined) return cached;

  let persona: CorpusPersona | null = null;
  try {
    persona = JSON.parse(await readFile(personaPath(profileId), 'utf8')) as CorpusPersona;
  } catch {
    persona = null;
  }
  cache.set(profileId, persona);
  return persona;
}

export function clearPersonaCache(): void {
  cache.clear();
}
