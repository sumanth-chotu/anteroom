/**
 * Grok Imagine — portraits and motion loops for the investor cast.
 *
 * Two endpoints, verified against the live API. Neither is documented the way
 * you would guess, so the shapes here are observed rather than assumed:
 *
 *   POST /v1/images/generations   synchronous. Returns { data: [{ url }] }.
 *   POST /v1/videos/generations   async. Returns { request_id }, then poll
 *                                 GET /v1/videos/{request_id} until
 *                                 status === 'done'.
 *
 * ── THE ONE THAT COSTS YOU AN HOUR ──────────────────────────────────────────
 *
 * Image-to-video needs `image: { url }` — a nested object. Passing
 * `image_url: "<url>"` is ACCEPTED, returns a request id, and produces a video
 * with no relation to the image, because the video endpoint silently ignores
 * unknown parameters. Verified twice: a flat vector portrait of a man returned a
 * photorealistic woman in an office. `image: "<url>"` as a bare string is the
 * only form that errors, which is what pointed at the right shape.
 *
 * Consequence for this module: generate the still FIRST, then animate that exact
 * still. It is the only way the portrait and the moving avatar are the same
 * person — text-to-video twice gives two different faces.
 *
 * ── WHY ILLUSTRATED, NOT PHOTOREAL ──────────────────────────────────────────
 *
 * The cast is modelled on real, living public figures. `persona.ts` already
 * decided the position: drawn caricatures, never photographs, disclaimer
 * everywhere, nothing that could pass as a real image of a real person.
 *
 * A photorealistic likeness that moves and talks is a different thing from a
 * flat cartoon, so prompts here are built from the profile's `AvatarSpec`
 * (hair, glasses, beard, palette) and the ARCHETYPE — never from the person's
 * name. The result is a consistent illustrated set that reads as illustration
 * at a glance, which is the property worth keeping.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { config } from '../config.ts';
import type { AvatarSpec } from '../investor/persona.ts';

const IMAGE_MODEL = process.env['XAI_MODEL_IMAGE'] ?? 'grok-imagine-image';
const VIDEO_MODEL = process.env['XAI_MODEL_VIDEO'] ?? 'grok-imagine-video-1.5';

/** xAI reports cost in ticks. 1e9 ticks ≈ $1, same assumption as xai/search.ts. */
const TICKS_PER_USD = 1e9;

export interface Generated {
  url: string;
  costUsd: number;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.xai.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.xai.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared art direction.
 *
 * Identical for every investor so the cast looks like one set rather than eight
 * unrelated pictures. "Editorial illustration" and "flat vector" are doing real
 * work: without them the model drifts to photoreal, which is the one thing this
 * must not produce.
 */
const ART_DIRECTION =
  'Editorial vector illustration, flat shapes, clean thick outlines, limited palette, ' +
  'subtle paper grain. Head and shoulders, centred, facing the viewer, calm neutral ' +
  'expression. Plain flat background, no text, no logos, no border. Deliberately ' +
  'stylised and non-photographic — clearly a drawing, not a photograph of a real person.';

const HAIR_WORDS: Record<AvatarSpec['hairStyle'], string> = {
  short: 'short neat hair',
  crop: 'very short cropped hair',
  long: 'long hair past the shoulders',
  bald: 'bald head',
  receding: 'receding hairline, thin greying hair at the sides',
  locs: 'shoulder-length locs',
  swept: 'hair swept to one side',
};

/**
 * Build the portrait prompt from the spec and the archetype.
 *
 * Note what is absent: any real person's name. The model is describing a role,
 * and the visual identity comes from the `AvatarSpec` the repo already authored.
 */
export function portraitPrompt(spec: AvatarSpec, archetype: string): string {
  const features = [
    HAIR_WORDS[spec.hairStyle],
    spec.glasses ? 'wearing glasses' : 'no glasses',
    spec.beard ? 'with a short beard' : 'clean shaven',
  ].join(', ');

  return (
    `Portrait of a venture capital investor: ${archetype}. ` +
    `Middle-aged, ${features}. Wearing a plain shirt or jacket. ` +
    `Palette: background ${spec.bg}, clothing ${spec.clothes}, hair ${spec.hair}. ` +
    ART_DIRECTION
  );
}

/**
 * Motion prompts.
 *
 * Two loops because the avatar has two jobs. Both are deliberately tiny
 * movements: a generated talking head that gesticulates is distracting, and no
 * amount of prompting will lip-sync it to speech we synthesise separately. The
 * honest version is presence, not performance — the face is alive while the
 * voice comes from the realtime model.
 */
export const MOTION = {
  idle:
    'The illustrated portrait comes subtly to life while listening: slow blinking, ' +
    'a small shift of the head, faint breathing. Camera perfectly still. The style, ' +
    'colours and character stay exactly as in the source image. Very subtle motion only.',
  speaking:
    'The illustrated portrait is speaking: mouth moving as if talking, occasional ' +
    'small head movements and eyebrow shifts, engaged expression. Camera perfectly ' +
    'still. The style, colours and character stay exactly as in the source image.',
} as const;

export type MotionKind = keyof typeof MOTION;

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

export async function generateImage(prompt: string): Promise<Generated> {
  const raw = await post('/images/generations', {
    model: IMAGE_MODEL,
    prompt,
    n: 1,
    response_format: 'url',
  });

  const data = raw['data'] as Array<{ url?: string }> | undefined;
  const url = data?.[0]?.url;
  if (!url) throw new Error(`no image url in response: ${JSON.stringify(raw).slice(0, 200)}`);

  const usage = raw['usage'] as { cost_in_usd_ticks?: number } | undefined;
  return { url, costUsd: (usage?.cost_in_usd_ticks ?? 0) / TICKS_PER_USD };
}

export interface VideoOptions {
  prompt: string;
  /** Source still. Omit for text-to-video, which will NOT match any portrait. */
  imageUrl?: string;
  seconds?: number;
  onProgress?: (message: string) => void;
  pollMs?: number;
  timeoutMs?: number;
}

export async function generateVideo(options: VideoOptions): Promise<Generated> {
  const { prompt, imageUrl, seconds = 6, onProgress = () => {} } = options;

  const started = await post('/videos/generations', {
    model: VIDEO_MODEL,
    prompt,
    duration: seconds,
    // Nested object. See the header note — `image_url` is silently ignored.
    ...(imageUrl ? { image: { url: imageUrl } } : {}),
  });

  const requestId = started['request_id'];
  if (typeof requestId !== 'string') {
    throw new Error(`no request_id: ${JSON.stringify(started).slice(0, 200)}`);
  }
  onProgress(`queued ${requestId}`);

  const pollMs = options.pollMs ?? 5000;
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);

  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, pollMs));

    const response = await fetch(`${config.xai.baseUrl}/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${config.xai.apiKey}` },
    });
    if (!response.ok) continue; // A transient poll failure is not a dead job.

    const status = (await response.json()) as {
      status?: string;
      progress?: number;
      video?: { url?: string };
      usage?: { cost_in_usd_ticks?: number };
    };

    if (status.status === 'done') {
      const url = status.video?.url;
      if (!url) throw new Error('status done but no video url');
      return { url, costUsd: (status.usage?.cost_in_usd_ticks ?? 0) / TICKS_PER_USD };
    }
    if (status.status && !['pending', 'processing', 'queued'].includes(status.status)) {
      throw new Error(`video generation ${status.status}`);
    }
    onProgress(`  ${status.status ?? 'pending'} ${status.progress ?? 0}%`);
  }

  throw new Error('video generation timed out');
}

// ─────────────────────────────────────────────────────────────────────────────
// Local cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assets are downloaded rather than hot-linked.
 *
 * The returned URLs are temporary signed links on imgen.x.ai / vidgen.x.ai — a
 * demo that loads them live breaks when they expire, which is exactly when you
 * least want it to. Committed under `fixtures/avatars/` because regenerating the
 * set costs real money and about a minute per investor.
 */
export function avatarDir(): string {
  return resolve('fixtures/avatars');
}

export async function download(url: string, filename: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed (${response.status}) ${url}`);

  await mkdir(avatarDir(), { recursive: true });
  const path = resolve(avatarDir(), filename);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

export interface AvatarManifest {
  [profileId: string]: {
    still: string;
    idle?: string;
    speaking?: string;
    builtAt: string;
    costUsd: number;
  };
}

export function manifestPath(): string {
  return resolve(avatarDir(), 'manifest.json');
}

export async function loadManifest(): Promise<AvatarManifest> {
  try {
    return JSON.parse(await readFile(manifestPath(), 'utf8')) as AvatarManifest;
  } catch {
    return {};
  }
}

export async function saveManifest(manifest: AvatarManifest): Promise<void> {
  await mkdir(avatarDir(), { recursive: true });
  await writeFile(manifestPath(), JSON.stringify(manifest, null, 2));
}
