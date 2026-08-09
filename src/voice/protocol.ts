/**
 * The xAI realtime wire contract.
 *
 * Verified empirically against the live socket (`npm run probe:realtime`) and
 * the xai-cookbook examples — NOT assumed from another vendor's realtime
 * protocol. Two things the docs get wrong or omit:
 *
 *   - Default voice is `xai_ara`, not "eve".
 *   - `turn_detection` defaults to `{type: null}` — server VAD is OFF unless you
 *     ask for it. Miss this and the agent never responds to speech.
 *
 * Audio is PCM16 / 24 kHz / mono, base64 in both directions.
 */

export const REALTIME_SAMPLE_RATE = 24_000;
export const REALTIME_CHANNELS = 1;

/** Voices confirmed available; `xai_ara` is the server default. */
export const VOICES = ['xai_ara', 'eve'] as const;

// ── client → server ──────────────────────────────────────────────────────────

export interface SessionUpdate {
  type: 'session.update';
  session: {
    instructions?: string;
    voice?: string;
    turn_detection?: { type: 'server_vad' | null };
    tools?: Array<{
      type: 'function';
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  };
}

export interface AudioAppend {
  type: 'input_audio_buffer.append';
  /** base64 PCM16 @ 24 kHz mono */
  audio: string;
}

export interface ItemCreate {
  type: 'conversation.item.create';
  item:
    | { type: 'message'; role: 'user' | 'assistant' | 'system'; content: Array<{ type: 'input_text'; text: string }> }
    | { type: 'function_call_output'; call_id: string; output: string };
}

export type ClientEvent =
  | SessionUpdate
  | AudioAppend
  | ItemCreate
  | { type: 'input_audio_buffer.commit' }
  | { type: 'input_audio_buffer.clear' }
  | { type: 'response.create' }
  | { type: 'response.cancel' };

// ── server → client ──────────────────────────────────────────────────────────

export type ServerEventType =
  | 'session.created'
  | 'session.updated'
  | 'conversation.created'
  | 'conversation.item.added'
  | 'conversation.item.input_audio_transcription.completed'
  | 'input_audio_buffer.speech_started'
  | 'input_audio_buffer.speech_stopped'
  | 'input_audio_buffer.committed'
  | 'response.created'
  | 'response.output_audio.delta'
  | 'response.output_audio.done'
  | 'response.output_audio_transcript.delta'
  | 'response.output_audio_transcript.done'
  | 'response.function_call_arguments.delta'
  | 'response.function_call_arguments.done'
  | 'response.output_item.added'
  | 'response.output_item.done'
  | 'response.done'
  | 'error'
  | 'ping';

export interface ServerEvent {
  type: ServerEventType | string;
  event_id?: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  error?: { message?: string; type?: string };
  [key: string]: unknown;
}

/** Tool exposed inside the voice session so claims are captured as they're spoken. */
export const NOTE_CLAIM_TOOL = {
  type: 'function' as const,
  name: 'note_claim',
  description:
    'Silently record a factual number the founder just stated — customer counts, revenue, ' +
    'growth rates, headcount, dates, amounts. Call this every time a number is spoken. ' +
    'It records only; it produces nothing for you to say and must not interrupt your speech.',
  parameters: {
    type: 'object',
    properties: {
      metric: {
        type: 'string',
        description:
          'What the number refers to, in the founder\'s own framing: "design partners", ' +
          '"paying customers", "MRR", "week over week growth".',
      },
      value: { type: 'string', description: 'The value exactly as stated.' },
      verbatim: { type: 'string', description: 'The exact words the founder used.' },
    },
    required: ['metric', 'value', 'verbatim'],
  },
};
