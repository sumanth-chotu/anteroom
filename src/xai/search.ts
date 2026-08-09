/**
 * xAI Agent Tools API — server-side X and web search.
 *
 * A different endpoint and a different request shape from chat completions:
 * `POST /v1/responses` with `input` (not `messages`) and `tools: [{type}]`.
 * The older `search_parameters` on chat completions is deprecated and the API
 * says so explicitly if you try it.
 *
 * The valuable part is `annotations` on the output message: `url_citation`
 * entries pointing at the actual posts. Without those the whole category brief
 * would be an unattributable summary, and an objection we cannot link back to a
 * real post is one we should not be putting in an investor's mouth.
 */

import { config } from '../config.ts';
import { recordUsage } from './client.ts';

export interface Citation {
  url: string;
  title?: string;
  startIndex?: number;
  endIndex?: number;
}

export interface SearchResult {
  text: string;
  citations: Citation[];
  toolCalls: number;
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number };
  /** xAI's own cost figure for the call, in USD. */
  costUsd: number;
}

export type SearchTool = 'x_search' | 'web_search';

interface RawResponse {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string; start_index?: number; end_index?: number }>;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    num_server_side_tools_used?: number;
    cost_in_usd_ticks?: number;
  };
  error?: unknown;
}

/**
 * xAI reports cost as "ticks". Empirically 1e9 ticks ≈ 1 USD, cross-checked
 * against token counts and the published $5/1K server-tool rate. Treated as
 * indicative — the dashboard remains authoritative.
 */
const TICKS_PER_USD = 1e9;

export interface SearchOptions {
  tools?: SearchTool[];
  /** Free-text steer prepended as an instruction, e.g. a recency window. */
  instructions?: string;
  maxOutputTokens?: number;
  tag?: string;
  signal?: AbortSignal;
}

export async function search(prompt: string, options: SearchOptions = {}): Promise<SearchResult> {
  const tools = (options.tools ?? ['x_search']).map((type) => ({ type }));

  const body: Record<string, unknown> = {
    model: config.xai.reasoning,
    input: [{ role: 'user', content: prompt }],
    tools,
    max_output_tokens: options.maxOutputTokens ?? 8192,
  };
  if (options.instructions) body['instructions'] = options.instructions;

  const response = await fetch(`${config.xai.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.xai.apiKey}`,
    },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`x_search failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }

  const raw = (await response.json()) as RawResponse;
  if (raw.error) throw new Error(`x_search error: ${JSON.stringify(raw.error).slice(0, 300)}`);

  const message = raw.output?.find((item) => item.type === 'message');
  const part = message?.content?.find((c) => c.type === 'output_text');

  const citations: Citation[] = (part?.annotations ?? [])
    .filter((a) => a.type === 'url_citation' && a.url)
    .map((a) => {
      const citation: Citation = { url: a.url! };
      if (a.title) citation.title = a.title;
      if (a.start_index !== undefined) citation.startIndex = a.start_index;
      if (a.end_index !== undefined) citation.endIndex = a.end_index;
      return citation;
    });

  const usage = {
    promptTokens: raw.usage?.input_tokens ?? 0,
    completionTokens: raw.usage?.output_tokens ?? 0,
    cachedTokens: raw.usage?.input_tokens_details?.cached_tokens ?? 0,
  };
  recordUsage(options.tag ?? 'search', config.xai.reasoning, { ...usage, reasoningTokens: 0 });

  return {
    text: part?.text ?? '',
    citations,
    toolCalls: raw.usage?.num_server_side_tools_used ?? 0,
    usage,
    costUsd: (raw.usage?.cost_in_usd_ticks ?? 0) / TICKS_PER_USD,
  };
}

/** Keep only real X post links — drop profile pages, search URLs and non-X hosts. */
export function xPostCitations(citations: Citation[]): Citation[] {
  return citations.filter((c) => /^https?:\/\/(x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(c.url));
}
