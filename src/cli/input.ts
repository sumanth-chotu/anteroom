/**
 * Input source for the text harness.
 *
 * Interactive when stdin is a TTY; scripted when it is a pipe.
 *
 * Scripted mode is not just a testing convenience — the eval suite (PLAN.md §11)
 * replays adversarial founders through the same loop, so the harness has to be
 * driveable without a keyboard. Piped stdin also can't use readline directly:
 * the stream drains to EOF while we're awaiting a model call, and readline then
 * throws ERR_USE_AFTER_CLOSE on the next question.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export interface InputSource {
  /** Next answer, or null when exhausted. */
  next(prompt: string): Promise<string | null>;
  close(): void;
  readonly scripted: boolean;
}

function interactive(): InputSource {
  const rl = createInterface({ input: stdin, output: stdout });
  let closed = false;
  return {
    scripted: false,
    async next(prompt) {
      if (closed) return null;
      try {
        return await rl.question(prompt);
      } catch {
        return null;
      }
    },
    close() {
      if (!closed) {
        closed = true;
        rl.close();
      }
    },
  };
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function scripted(): Promise<InputSource> {
  const lines = (await readAllStdin())
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let index = 0;

  return {
    scripted: true,
    async next(prompt) {
      if (index >= lines.length) return null;
      const line = lines[index++] ?? null;
      // Echo so a piped transcript reads like a real session.
      if (line !== null) stdout.write(`${prompt}${line}\n`);
      return line;
    },
    close() {},
  };
}

/** Buffers piped input upfront; uses readline when attached to a terminal. */
export async function openInput(): Promise<InputSource> {
  return stdin.isTTY ? interactive() : scripted();
}

/** Answers supplied directly, for programmatic replay in the eval suite. */
export function fromArray(answers: readonly string[]): InputSource {
  let index = 0;
  return {
    scripted: true,
    async next() {
      return index < answers.length ? (answers[index++] ?? null) : null;
    },
    close() {},
  };
}
