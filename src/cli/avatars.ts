/**
 * Generate the investor cast's avatars with Grok Imagine.
 *
 *   npm run avatars -- --list
 *   npm run avatars -- essayist              # still only     (~$0.20, seconds)
 *   npm run avatars -- essayist --motion     # + two loops    (~$10, ~90s)
 *   npm run avatars -- all                   # every still
 *   npm run avatars -- all --motion          # the full set   (~$80)
 *
 * Stills are cheap; motion is not. Default is stills only, and `--motion` is
 * opt-in per investor, because a full motion set is roughly $80 and takes several
 * minutes — not something to trigger by accident while iterating.
 *
 * Assets and a manifest land in `fixtures/avatars/`. Already-generated investors
 * are skipped unless `--force`.
 */

import { PROFILES, getProfile } from '../investor/profiles.ts';
import { personaFor } from '../investor/persona.ts';
import { resolveProfileId } from '../investor/dossier-store.ts';
import {
  MOTION,
  download,
  generateImage,
  generateVideo,
  loadManifest,
  portraitPrompt,
  saveManifest,
  type AvatarManifest,
} from '../avatar/imagine.ts';

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const motion = args.includes('--motion');
const force = args.includes('--force');
const target = args.find((a) => !a.startsWith('--'));

if (args.includes('--list') || !target) {
  console.log(`\n${C.bold('Avatars')}\n`);
  const manifest = await loadManifest();
  for (const profile of PROFILES) {
    const entry = manifest[profile.id];
    const state = entry
      ? C.green(`still${entry.idle ? ' + idle' : ''}${entry.speaking ? ' + speaking' : ''}`)
      : C.grey('none');
    console.log(`  ${profile.id.padEnd(22)} ${state}`);
  }
  console.log(
    `\n  ${C.dim('npm run avatars -- all')}            ${C.grey('stills, ~$0.20 each')}\n` +
      `  ${C.dim('npm run avatars -- essayist --motion')} ${C.grey('adds idle + speaking loops, ~$10')}\n`,
  );
  process.exit(0);
}

/**
 * One line describing the archetype, used in place of the person's name.
 *
 * The prompt must not name a real person — see the note in avatar/imagine.ts.
 * The profile's own blurb is the right source: it describes the behaviour the
 * illustration should read as.
 */
function archetypeFor(profileId: string): string {
  const profile = getProfile(profileId);
  return `${profile.name.toLowerCase()} — ${profile.blurb.split('.')[0]}`;
}

async function build(profileId: string, manifest: AvatarManifest): Promise<number> {
  const persona = personaFor(profileId);
  const profile = getProfile(profileId);
  if (!persona) {
    console.log(C.grey(`  ${profileId}: no persona, skipping`));
    return 0;
  }

  const existing = manifest[profileId];
  const needsStill = force || !existing?.still;
  const needsMotion = motion && (force || !existing?.idle || !existing?.speaking);
  if (!needsStill && !needsMotion) {
    console.log(C.grey(`  ${profileId}: already built, skipping (--force to redo)`));
    return 0;
  }

  console.log(`\n  ${C.bold(profileId)} ${C.grey(persona.fullName)}`);
  let spend = 0;

  // The still comes first and the loops are seeded FROM it. Generating them
  // independently produces three different faces — the video endpoint has no
  // memory of the image unless you hand it one.
  let stillUrl = existing?.still;
  if (needsStill) {
    const prompt = portraitPrompt(persona.avatar, archetypeFor(profileId));
    const image = await generateImage(prompt);
    spend += image.costUsd;
    const path = await download(image.url, `${profileId}.jpg`);
    stillUrl = image.url;
    console.log(`    ${C.green('✓')} still ${C.grey(`$${image.costUsd.toFixed(2)} → ${path}`)}`);

    manifest[profileId] = {
      still: image.url,
      builtAt: new Date().toISOString(),
      costUsd: (existing?.costUsd ?? 0) + image.costUsd,
    };
    await saveManifest(manifest);
  }

  if (needsMotion) {
    if (!stillUrl) throw new Error('cannot animate without a still');

    for (const kind of ['idle', 'speaking'] as const) {
      const video = await generateVideo({
        prompt: MOTION[kind],
        imageUrl: stillUrl,
        seconds: 6,
        onProgress: (message) => console.log(C.grey(`      ${message}`)),
      });
      spend += video.costUsd;
      const path = await download(video.url, `${profileId}-${kind}.mp4`);
      console.log(`    ${C.green('✓')} ${kind} ${C.grey(`$${video.costUsd.toFixed(2)} → ${path}`)}`);

      const entry = manifest[profileId] ?? {
        still: stillUrl,
        builtAt: new Date().toISOString(),
        costUsd: 0,
      };
      entry[kind] = video.url;
      entry.costUsd += video.costUsd;
      manifest[profileId] = entry;
      await saveManifest(manifest);
    }
  }

  console.log(C.dim(`    ${profile.name} · $${spend.toFixed(2)}`));
  return spend;
}

const manifest = await loadManifest();
let total = 0;

if (target === 'all') {
  console.log(`\n${C.bold('AVATARS')} ${C.dim(`${PROFILES.length} investors${motion ? ' + motion' : ''}`)}`);
  for (const profile of PROFILES) {
    try {
      total += await build(profile.id, manifest);
    } catch (error) {
      console.error(C.red(`    ${profile.id} failed: ${error instanceof Error ? error.message : error}`));
    }
  }
} else {
  total = await build(resolveProfileId(target), manifest);
}

console.log(C.dim(`\n  total ~$${total.toFixed(2)}\n`));
