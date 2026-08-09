/**
 * Where dossiers live on disk, and the short names people type.
 *
 * Separate from `dossier.ts` so that reading a cached dossier costs nothing.
 * `dossier.ts` pulls in the search client and the whole extraction schema; the
 * server, the relay and the CLIs only ever want to LOAD one, and a voice relay
 * should not be importing a research pipeline to do it.
 *
 * A missing dossier is never an error. Every consumer degrades to the
 * hand-written persona summary in `persona.ts`, which is exactly what the app
 * did before dossiers existed.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Dossier } from './dossier.ts';

/** Short names accepted on the CLI and in `?profile=` query params. */
export const ALIASES: Record<string, string> = {
  generalist: 'seed_generalist',
  skeptic: 'seed_skeptic',
  angel: 'technical_angel',
  thesis: 'thesis_macro',
  accelerator: 'accelerator_operator',
  solo: 'solo_capitalist',
  blowhard: 'incubator_blowhard',
  chaos: 'incubator_blowhard',
};

export function resolveProfileId(nameOrId: string): string {
  return ALIASES[nameOrId] ?? nameOrId;
}

/**
 * Committed under `fixtures/`, not `.tmp/`.
 *
 * A dossier is a deliberate, reviewed artifact about a real person and it takes
 * minutes and real money to rebuild. Treating it as a cache invites a
 * regenerate-on-demand path where nobody reads what went into the prompt.
 */
export function dossierPath(profileId: string): string {
  return resolve(`fixtures/dossiers/${profileId}.json`);
}

const cache = new Map<string, Dossier | null>();

/** Load a dossier, or null when none has been built. Never throws. */
export async function loadDossier(profileId: string): Promise<Dossier | null> {
  const cached = cache.get(profileId);
  if (cached !== undefined) return cached;

  let dossier: Dossier | null = null;
  try {
    dossier = JSON.parse(await readFile(dossierPath(profileId), 'utf8')) as Dossier;
  } catch {
    dossier = null;
  }
  cache.set(profileId, dossier);
  return dossier;
}

export function clearDossierCache(): void {
  cache.clear();
}
