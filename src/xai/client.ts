/**
 * xAI client — plain `fetch` against api.x.ai.
 *
 * Deliberately not the `openai` npm package (PLAN.md §2.4): no OpenAI-published
 * dependency, and cleaner types for the xAI-specific voice endpoints later.
 *
 * ALL model inference in this project goes through here. If you find yourself
 * adding a second provider, stop and read CLAUDE.md.
 */

import { config } from '../config.ts';
import type { z } from 'zod';

export type Role = 'system' | 'user' | 'assistant';

export interface TextContent {
  type: 'text';
  text: string;
}

/** xAI vision uses `input_image` / `input_text` content blocks. Phase 1. */
export interface ImageContent {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export type Content = string | Array<TextContent | ImageContent>;

export interface Message {
  role: Role;
  content: Content;
}

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  /** Free-text label used only for usage accounting, so we can report cost by stage. */
  tag?: string;
  signal?: AbortSignal;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface ChatResult {
  text: string;
  /** Grok 4.5 exposes its reasoning trace. Useful for debugging question selection. */
  reasoning?: string;
  usage: Usage;
  model: string;
  finishReason: string;
}

// Note: no TS parameter properties anywhere in this project — Node's
// --experimental-strip-types erases types but cannot transform syntax.
// tsconfig sets `erasableSyntaxOnly: true` so `npm run typecheck` catches it.

export class XAIError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'XAIError';
    this.status = status;
    this.body = body;
  }
}

/** Refusals arrive as HTTP 200 with a populated `refusal` field — not as an error. */
export class XAIRefusalError extends Error {
  refusal: string;

  constructor(refusal: string) {
    super(`Model refused: ${refusal}`);
    this.name = 'XAIRefusalError';
    this.refusal = refusal;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage accounting
//
// We need real cost numbers for the presentation (PRESENTATION.md), so every
// call is tallied by stage rather than reconstructed from a dashboard later.
// ─────────────────────────────────────────────────────────────────────────────

const usageLog: Array<Usage & { tag: string; model: string; at: number }> = [];

export function recordUsage(tag: string, model: string, usage: Usage): void {
  usageLog.push({ ...usage, tag, model, at: Date.now() });
}

export function usageSummary() {
  const byTag = new Map<string, Usage & { calls: number }>();
  for (const entry of usageLog) {
    const current = byTag.get(entry.tag) ?? {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    };
    current.calls += 1;
    current.promptTokens += entry.promptTokens;
    current.completionTokens += entry.completionTokens;
    current.cachedTokens += entry.cachedTokens;
    current.reasoningTokens += entry.reasoningTokens;
    byTag.set(entry.tag, current);
  }
  return {
    calls: usageLog.length,
    totalPromptTokens: usageLog.reduce((n, e) => n + e.promptTokens, 0),
    totalCompletionTokens: usageLog.reduce((n, e) => n + e.completionTokens, 0),
    totalCachedTokens: usageLog.reduce((n, e) => n + e.cachedTokens, 0),
    byTag: Object.fromEntries(byTag),
  };
}

export function resetUsage(): void {
  usageLog.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core request
// ─────────────────────────────────────────────────────────────────────────────

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

interface RawChoice {
  message?: { content?: string | null; reasoning_content?: string | null; refusal?: string | null };
  finish_reason?: string;
}

interface RawResponse {
  model?: string;
  choices?: RawChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

async function request(body: Record<string, unknown>, signal?: AbortSignal): Promise<RawResponse> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter.
      const delay = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 300;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    let response: Response;
    try {
      response = await fetch(`${config.xai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.xai.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error as Error;
      continue;
    }

    if (response.ok) return (await response.json()) as RawResponse;

    const text = await response.text();
    lastError = new XAIError(
      `xAI request failed (${response.status})`,
      response.status,
      text.slice(0, 500),
    );
    if (!RETRYABLE.has(response.status)) throw lastError;
  }

  throw lastError ?? new Error('xAI request failed after retries');
}

/** Single chat completion returning text. */
export async function chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResult> {
  const model = options.model ?? config.xai.reasoning;
  const tag = options.tag ?? 'untagged';

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? 4096,
  };
  if (options.reasoningEffort) body['reasoning_effort'] = options.reasoningEffort;

  const raw = await request(body, options.signal);
  const choice = raw.choices?.[0];

  if (choice?.message?.refusal) throw new XAIRefusalError(choice.message.refusal);

  const usage: Usage = {
    promptTokens: raw.usage?.prompt_tokens ?? 0,
    completionTokens: raw.usage?.completion_tokens ?? 0,
    cachedTokens: raw.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: raw.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
  recordUsage(tag, raw.model ?? model, usage);

  return {
    text: choice?.message?.content ?? '',
    reasoning: choice?.message?.reasoning_content ?? undefined,
    usage,
    model: raw.model ?? model,
    finishReason: choice?.finish_reason ?? 'unknown',
  };
}

/**
 * Chat completion constrained to a JSON schema, validated with Zod.
 *
 * Zod is the source of truth: we hand the API a JSON Schema derived from it,
 * then validate the response anyway. Schema-constrained decoding is not a
 * guarantee, and a silently-wrong shape downstream is worse than a throw.
 */
export async function chatStructured<T>(
  messages: Message[],
  schema: z.ZodType<T>,
  jsonSchema: Record<string, unknown>,
  options: ChatOptions & { schemaName?: string } = {},
): Promise<{ data: T; usage: Usage; raw: string }> {
  const model = options.model ?? config.xai.reasoning;
  const tag = options.tag ?? 'untagged';

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? 4096,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: options.schemaName ?? 'response',
        strict: true,
        schema: jsonSchema,
      },
    },
  };
  if (options.reasoningEffort) body['reasoning_effort'] = options.reasoningEffort;

  const raw = await request(body, options.signal);
  const choice = raw.choices?.[0];

  if (choice?.message?.refusal) throw new XAIRefusalError(choice.message.refusal);

  const usage: Usage = {
    promptTokens: raw.usage?.prompt_tokens ?? 0,
    completionTokens: raw.usage?.completion_tokens ?? 0,
    cachedTokens: raw.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: raw.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
  recordUsage(tag, raw.model ?? model, usage);

  const text = choice?.message?.content ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Model returned non-JSON for schema "${options.schemaName}": ${text.slice(0, 300)}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Schema validation failed for "${options.schemaName}": ${result.error.message}\n` +
        `Raw: ${text.slice(0, 300)}`,
    );
  }

  return { data: result.data, usage, raw: text };
}
