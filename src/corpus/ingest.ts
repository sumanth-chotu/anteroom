/**
 * Fetch an investor's body of work and turn it into plain text.
 *
 *   index page ──▶ article links ──▶ fetch each ──▶ strip HTML ──▶ cache
 *
 * No dependencies. These are static pages of prose, and a regex strip is enough
 * — an HTML parser would be more correct and would not change a single sentence
 * that reaches the model.
 *
 * Cached to `.tmp/corpus/<profileId>/` and never re-fetched. Ingest is slow and
 * hits somebody else's server; doing it twice for the same corpus is rude and
 * pointless.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CorpusSource } from './sources.ts';

export interface Document {
  /** Filename-safe id, derived from the URL. */
  id: string;
  url: string;
  title: string;
  text: string;
}

export interface Corpus {
  profileId: string;
  label: string;
  documents: Document[];
  chars: number;
  /** ~4 chars/token. Indicative only — for deciding whether a pass will fit. */
  tokensApprox: number;
}

const UA = 'anteroom-research/0.1 (pitch-practice persona building; contact via repo)';

/** Politeness. Six at a time is brisk for us and invisible to a static blog. */
const CONCURRENCY = 6;

// ─────────────────────────────────────────────────────────────────────────────
// HTML → text
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip to readable prose.
 *
 * Order matters: script/style bodies must go before tags are removed, or their
 * contents survive as text and the corpus fills up with CSS.
 */
export function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ');
  // Block boundaries become newlines so paragraphs survive as paragraphs.
  text = text.replace(/<\/(p|div|br|h[1-6]|li|tr|blockquote)\s*>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/[ \t ]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
    rdquo: '”', ldquo: '“', eacute: 'é', uuml: 'ü', ouml: 'ö',
  };
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole);
}

export function extractTitle(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) return decodeEntities(title).replace(/\s+/g, ' ').trim();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  return h1 ? htmlToText(h1).slice(0, 120) : '';
}

/**
 * Article links from an index page, absolute and de-duplicated.
 *
 * Matched against both the raw href and its absolute form, because a flat site
 * writes `essay.html` while a WordPress archive writes the full URL, and one
 * pattern should be able to describe either.
 */
export function articleLinks(html: string, base: string, source: CorpusSource): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#?]+)["']/gi)) {
    const href = match[1]?.trim();
    if (!href || /^(mailto|javascript):/i.test(href)) continue;

    let absolute: string;
    try {
      absolute = new URL(href, base).toString();
    } catch {
      continue;
    }

    const matches = source.articlePattern.test(href) || source.articlePattern.test(absolute);
    if (!matches) continue;
    if (source.exclude && (source.exclude.test(href) || source.exclude.test(absolute))) continue;

    found.add(absolute);
  }
  return [...found];
}

function idFor(url: string): string {
  return (
    new URL(url).pathname
      .replace(/\.html?$/, '')
      .replace(/^\/|\/$/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .slice(0, 80) || 'index'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────────

async function get(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return await response.text();
}

/** Run tasks with a fixed concurrency, keeping failures out of the results. */
async function pooled<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      if (!task) return;
      try {
        results.push(await task());
      } catch {
        // One dead link must not fail a 200-essay ingest.
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export function cacheDir(profileId: string): string {
  return resolve(`.tmp/corpus/${profileId}`);
}

export interface IngestOptions {
  source: CorpusSource;
  /** Hard cap on documents. Useful for a blog with twenty years of dailies. */
  limit?: number;
  onProgress?: (message: string) => void;
}

export async function ingestCorpus(options: IngestOptions): Promise<Corpus> {
  const { source, onProgress = () => {} } = options;
  const dir = cacheDir(source.profileId);

  const cached = await loadCached(source);
  if (cached && cached.documents.length > 0) {
    onProgress(`cached: ${cached.documents.length} documents, ${(cached.chars / 1000).toFixed(0)}k chars`);
    return cached;
  }

  onProgress(`fetching index ${source.index}`);
  const indexHtml = await get(source.index);
  let links = articleLinks(indexHtml, source.index, source);
  onProgress(`${links.length} article links found`);

  if (links.length === 0) {
    throw new Error(
      `No article links matched on ${source.index}. The site layout probably changed — ` +
        `check articlePattern in src/corpus/sources.ts.`,
    );
  }
  if (options.limit) links = links.slice(0, options.limit);

  await mkdir(dir, { recursive: true });

  let done = 0;
  const documents = await pooled(
    links.map((url) => async (): Promise<Document | undefined> => {
      const html = await get(url);
      const text = htmlToText(html);
      done++;
      if (done % 25 === 0) onProgress(`  ${done}/${links.length}`);
      if (text.length < (source.minChars ?? 1000)) return undefined;
      const document: Document = { id: idFor(url), url, title: extractTitle(html), text };
      await writeFile(
        resolve(dir, `${document.id}.json`),
        JSON.stringify(document, null, 2),
      );
      return document;
    }),
    CONCURRENCY,
  );

  const kept = documents.filter((d): d is Document => d !== undefined);
  const chars = kept.reduce((sum, d) => sum + d.text.length, 0);
  onProgress(
    `ingested ${kept.length} documents (${links.length - kept.length} too short), ` +
      `${(chars / 1000).toFixed(0)}k chars ≈ ${Math.round(chars / 4 / 1000)}k tokens`,
  );

  return {
    profileId: source.profileId,
    label: source.label,
    documents: kept,
    chars,
    tokensApprox: Math.round(chars / 4),
  };
}

async function loadCached(source: CorpusSource): Promise<Corpus | undefined> {
  const dir = cacheDir(source.profileId);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch {
    return undefined;
  }
  if (names.length === 0) return undefined;

  const documents: Document[] = [];
  for (const name of names) {
    try {
      documents.push(JSON.parse(await readFile(resolve(dir, name), 'utf8')) as Document);
    } catch {
      // Skip a corrupt cache entry rather than failing the whole load.
    }
  }
  const chars = documents.reduce((sum, d) => sum + d.text.length, 0);
  return {
    profileId: source.profileId,
    label: source.label,
    documents,
    chars,
    tokensApprox: Math.round(chars / 4),
  };
}

/**
 * Pack a corpus into a single prompt string under a character budget.
 *
 * Longest-first. When the budget binds, a few complete essays beat many
 * truncated ones: the persona is built from arguments, and half an argument is
 * worse than none. Documents are never cut mid-way — one is either in or out.
 */
export function packCorpus(corpus: Corpus, budgetChars: number): { text: string; used: Document[] } {
  const ordered = [...corpus.documents].sort((a, b) => b.text.length - a.text.length);
  const used: Document[] = [];
  let total = 0;

  for (const document of ordered) {
    const framed = document.text.length + 200;
    if (total + framed > budgetChars) continue;
    used.push(document);
    total += framed;
  }

  const text = used
    .map((d) => `<document title="${d.title.replace(/"/g, "'")}" url="${d.url}">\n${d.text}\n</document>`)
    .join('\n\n');

  return { text, used };
}
