/**
 * Dev server for the testing UI.
 *
 *   npm run ui        →  http://localhost:4317
 *
 * Deliberately a plain Node HTTP server rather than Next.js: no build step, no
 * new dependencies, and session state lives in the same process as the engine
 * so there is no serialization boundary to debug. When Phase 2 lands, this same
 * long-lived process becomes the WebSocket relay host (PLAN.md §2.3) — which
 * Vercel serverless could not have been anyway.
 *
 * Local only. No auth, in-memory sessions, binds to loopback.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createSession,
  founderTurn,
  investorTurn,
  probeOutcomes,
  transcriptFor,
  type SessionState,
} from '../session/session.ts';
import { PROFILES } from '../investor/profiles.ts';
import { generatePreRead } from '../preread/preread.ts';
import { computePostureDelta, type PostureDeltaResult } from '../preread/delta.ts';
import type { PreReadMemo } from '../preread/types.ts';
import { profileView, sessionView, snapshotUsage, type UsageSnapshot } from './view.ts';
import { attachVoiceRelay } from '../voice/relay.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['PORT'] ?? 4317);

interface Entry {
  session: SessionState;
  usageAtStart: UsageSnapshot;
  /** Serializes turns per session — double-submits would corrupt engine state. */
  lock: Promise<unknown>;
  delta?: PostureDeltaResult;
}

const sessions = new Map<string, Entry>();

/** Pre-reads live for the process lifetime, keyed so a session can reference one. */
const memos = new Map<string, PreReadMemo>();

/** Decks can be a few MB of base64. Well under this; the cap is a sanity bound. */
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_UPLOAD_BYTES) throw new Error('Upload too large.');
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Queue work behind any in-flight turn for this session. */
function withLock<T>(entry: Entry, work: () => Promise<T>): Promise<T> {
  const next = entry.lock.then(work, work);
  entry.lock = next.catch(() => undefined);
  return next;
}

const routes: Array<{
  method: string;
  pattern: RegExp;
  handle: (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void>;
}> = [
  {
    method: 'GET',
    pattern: /^\/api\/profiles$/,
    async handle(_req, res) {
      json(res, 200, { profiles: PROFILES.map(profileView) });
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/sessions$/,
    async handle(req, res) {
      const body = await readJson(req);
      const profileId = typeof body['profileId'] === 'string' ? body['profileId'] : 'seed_skeptic';
      const memoId = typeof body['memoId'] === 'string' ? body['memoId'] : undefined;
      const memo = memoId ? memos.get(memoId) : undefined;

      let entry: Entry;
      try {
        entry = {
          session: createSession(profileId, undefined, memo),
          usageAtStart: snapshotUsage(),
          lock: Promise.resolve(),
        };
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : 'bad profile' });
        return;
      }

      // Opening turn immediately — an empty transcript is a worse first impression
      // than a two-second wait.
      const opened = await investorTurn(entry.session);
      entry.session = opened.session;
      sessions.set(entry.session.id, entry);

      json(res, 201, sessionView(entry.session, entry.usageAtStart));
    },
  },

  {
    // The planted-flaw fixture, so a demo is one click rather than a file
    // picker. Same code path as a real upload — it just supplies the bytes.
    method: 'GET',
    pattern: /^\/api\/sample-deck$/,
    async handle(_req, res) {
      try {
        const bytes = await readFile(
          join(HERE, '..', '..', 'fixtures', 'decks', 'planted-flaws', 'deck.pdf'),
        );
        json(res, 200, { filename: 'sentinel-seed-deck.pdf', data: bytes.toString('base64') });
      } catch {
        json(res, 404, { error: 'sample deck not built — run: npm run fixture:deck' });
      }
    },
  },

  {
    // Upload a deck and run the pre-read. Slow by design (~40s) — it is the
    // work a real investor does before the meeting.
    method: 'POST',
    pattern: /^\/api\/decks$/,
    async handle(req, res) {
      const body = await readJson(req);
      const filename = typeof body['filename'] === 'string' ? body['filename'] : 'deck.pdf';
      const data = typeof body['data'] === 'string' ? body['data'] : '';
      if (!data) return json(res, 400, { error: 'no file data' });

      const dir = await mkdtemp(join(tmpdir(), 'radar-upload-'));
      const path = join(dir, filename.replace(/[^\w.\-]/g, '_'));
      await writeFile(path, Buffer.from(data, 'base64'));

      try {
        const { memo } = await generatePreRead(path);
        const memoId = `memo_${memos.size + 1}_${Date.now()}`;
        memos.set(memoId, memo);
        json(res, 201, { memoId, memo });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : 'pre-read failed' });
      }
    },
  },

  {
    // Re-assess after the meeting and diff against the pre-read.
    method: 'POST',
    pattern: /^\/api\/sessions\/([\w-]+)\/delta$/,
    async handle(_req, res, [id]) {
      const entry = sessions.get(id ?? '');
      if (!entry) return json(res, 404, { error: 'no such session' });
      if (!entry.session.memo) return json(res, 400, { error: 'session has no deck' });
      if (!entry.session.turns.some((t) => t.role === 'founder')) {
        return json(res, 400, { error: 'nothing said yet' });
      }

      try {
        const delta = await withLock(entry, () =>
          computePostureDelta(entry.session.memo!, transcriptFor(entry.session)),
        );
        entry.delta = delta;
        json(res, 200, { delta, probes: probeOutcomes(entry.session) });
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : 'delta failed' });
      }
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/sessions\/([\w-]+)$/,
    async handle(_req, res, [id]) {
      const entry = sessions.get(id ?? '');
      if (!entry) return json(res, 404, { error: 'no such session' });
      json(res, 200, sessionView(entry.session, entry.usageAtStart));
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/sessions\/([\w-]+)\/answer$/,
    async handle(req, res, [id]) {
      const entry = sessions.get(id ?? '');
      if (!entry) return json(res, 404, { error: 'no such session' });

      const body = await readJson(req);
      const answer = typeof body['answer'] === 'string' ? body['answer'].trim() : '';
      if (!answer) return json(res, 400, { error: 'answer required' });

      try {
        const view = await withLock(entry, async () => {
          const answered = await founderTurn(entry.session, answer);
          entry.session = answered.session;
          const next = await investorTurn(entry.session);
          entry.session = next.session;
          return sessionView(entry.session, entry.usageAtStart);
        });
        json(res, 200, view);
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : 'turn failed' });
      }
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/sessions\/([\w-]+)\/export$/,
    async handle(_req, res, [id]) {
      const entry = sessions.get(id ?? '');
      if (!entry) return json(res, 404, { error: 'no such session' });
      const view = sessionView(entry.session, entry.usageAtStart);
      const payload = JSON.stringify(view, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="radar-${id}.json"`,
      });
      res.end(payload);
    },
  },
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/voice.js') {
    try {
      const js = await readFile(join(HERE, 'public', 'voice.js'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(js);
    } catch {
      res.writeHead(404).end('voice.js missing');
    }
    return;
  }

  if (path === '/' || path === '/index.html') {
    try {
      const html = await readFile(join(HERE, 'public', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch {
      res.writeHead(500).end('index.html missing');
    }
    return;
  }

  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (match && route.method === req.method) {
      try {
        await route.handle(req, res, match.slice(1));
      } catch (error) {
        console.error(error);
        if (!res.headersSent) json(res, 500, { error: 'internal error' });
      }
      return;
    }
  }

  json(res, 404, { error: 'not found' });
});

// The voice relay shares this process deliberately: it needs a long-lived
// host, which is the same reason this is a plain Node server rather than
// Next.js on serverless (PLAN.md §2.3).
attachVoiceRelay(server, '/voice');

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  \x1b[1mRadar\x1b[0m testing UI  \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log(
    `  \x1b[2m${PROFILES.length} investor profiles · voice relay on ws://localhost:${PORT}/voice · ctrl-c to stop\x1b[0m\n`,
  );
});
