/**
 * Deck ingestion: whatever the founder uploads → one PNG per slide.
 *
 *   PPTX / ODP  --soffice-->  PDF  --pdftoppm-->  PNG
 *   PDF         --pdftoppm-->                     PNG
 *   PNG / JPEG  (already images, used directly)
 *
 * Everything runs as a local binary. No hosted conversion service: founders'
 * decks are their most confidential material, and shipping them to a third
 * party for a format conversion we can do locally is not a trade worth making
 * (PLAN.md §2.5, §14).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

import type { Slide } from './types.ts';

const run = promisify(execFile);

/** 200 DPI — small type and footnotes stay legible without inflating tokens. */
const RENDER_DPI = 200;

/** xAI caps images at 20 MiB. 200 DPI on a 16:9 slide lands far under. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export class MissingToolError extends Error {
  tool: string;
  install: string;

  constructor(tool: string, install: string) {
    super(`Required tool "${tool}" not found.\n  Install with: ${install}`);
    this.name = 'MissingToolError';
    this.tool = tool;
    this.install = install;
  }
}

async function which(tool: string): Promise<boolean> {
  try {
    await run('command', ['-v', tool], { shell: '/bin/bash' } as never);
    return true;
  } catch {
    return false;
  }
}

async function requireTool(tool: string, install: string): Promise<void> {
  if (!(await which(tool))) throw new MissingToolError(tool, install);
}

/** PPTX / ODP / KEY → PDF via LibreOffice headless. */
async function officeToPdf(inputPath: string, workDir: string): Promise<string> {
  await requireTool('soffice', 'brew install --cask libreoffice');
  await run('soffice', [
    '--headless',
    '--norestore',
    '--convert-to',
    'pdf',
    '--outdir',
    workDir,
    inputPath,
  ]);
  const out = join(workDir, `${basename(inputPath, extname(inputPath))}.pdf`);
  await stat(out); // throws with a clear ENOENT if conversion silently produced nothing
  return out;
}

/** PDF → one PNG per page. */
async function pdfToPngs(pdfPath: string, workDir: string): Promise<string[]> {
  await requireTool('pdftoppm', 'brew install poppler');
  await run('pdftoppm', ['-png', '-r', String(RENDER_DPI), pdfPath, join(workDir, 'slide')]);
  const files = (await readdir(workDir))
    .filter((f) => f.startsWith('slide') && f.endsWith('.png'))
    // pdftoppm zero-pads, but sort numerically rather than trusting that.
    .sort((a, b) => pageNumber(a) - pageNumber(b));
  return files.map((f) => join(workDir, f));
}

function pageNumber(filename: string): number {
  const match = /(\d+)\.png$/.exec(filename);
  return match?.[1] ? Number(match[1]) : 0;
}

/** PNG dimensions from the IHDR chunk — no image library needed. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export interface IngestResult {
  slides: Slide[];
  sourceFormat: string;
  workDir: string;
}

/**
 * Render a deck to slide images.
 *
 * `workDir` holds the PNGs for the life of the process. Caller owns cleanup —
 * the pre-read needs the files to outlive this call.
 */
export async function ingestDeck(inputPath: string): Promise<IngestResult> {
  const ext = extname(inputPath).toLowerCase();
  const workDir = await mkdtemp(join(tmpdir(), 'anteroom-deck-'));

  let imagePaths: string[];
  let sourceFormat: string;

  switch (ext) {
    case '.pdf':
      sourceFormat = 'pdf';
      imagePaths = await pdfToPngs(inputPath, workDir);
      break;

    case '.pptx':
    case '.ppt':
    case '.odp':
    case '.key':
      sourceFormat = ext.slice(1);
      imagePaths = await pdfToPngs(await officeToPdf(inputPath, workDir), workDir);
      break;

    case '.png':
    case '.jpg':
    case '.jpeg':
      // Already an image — a single exported slide.
      sourceFormat = 'image';
      imagePaths = [inputPath];
      break;

    default:
      throw new Error(
        `Unsupported deck format "${ext}". Supported: .pdf, .pptx, .ppt, .odp, .key, .png, .jpg\n` +
          `Google Slides: use File → Download → PDF, then upload that.`,
      );
  }

  if (imagePaths.length === 0) throw new Error('Deck produced no pages.');

  const slides: Slide[] = [];
  for (const [i, imagePath] of imagePaths.entries()) {
    const buffer = await readFile(imagePath);
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `Slide ${i + 1} is ${(buffer.byteLength / 1e6).toFixed(1)}MB, over the 20MB image limit. ` +
          `Re-render at a lower DPI.`,
      );
    }
    const { width, height } = pngSize(buffer);
    const mime = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    slides.push({
      index: i + 1,
      imagePath,
      dataUri: `data:${mime};base64,${buffer.toString('base64')}`,
      widthPx: width,
      heightPx: height,
    });
  }

  return { slides, sourceFormat, workDir };
}
