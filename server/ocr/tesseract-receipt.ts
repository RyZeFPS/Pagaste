import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import path from 'node:path';
import type { OcrLine } from './receipt-parser';

export type Recognition = Readonly<{
  lines: readonly OcrLine[];
  confidence: number;
  qualityWarnings: readonly string[];
}>;

type PositionedLine = OcrLine &
  Readonly<{
    bottom: number;
    right: number;
  }>;

let workerPromise: ReturnType<typeof Tesseract.createWorker> | undefined;
let queue: Promise<void> = Promise.resolve();

export type ReceiptImageQuality = Readonly<{
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  warnings: readonly string[];
}>;

async function worker() {
  workerPromise ??= Tesseract.createWorker('spa', Tesseract.OEM.LSTM_ONLY, {
    langPath: path.join(process.cwd(), 'server', 'ocr', 'data'),
    gzip: true,
    cacheMethod: 'readOnly',
  }).then(async (instance) => {
    await instance.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    return instance;
  });
  return workerPromise;
}

async function prepareImage(input: Buffer): Promise<Buffer> {
  const image = sharp(input, {
    failOn: 'error',
    limitInputPixels: 40_000_000,
    sequentialRead: true,
  }).rotate();
  const metadata = await image.metadata();
  const sourceWidth = metadata.width ?? 1_600;
  const sourceHeight = metadata.height ?? 2_400;
  const desiredWidth = Math.min(
    2_400,
    Math.max(1_800, sourceWidth < 1_400 ? sourceWidth * 2 : sourceWidth),
  );
  // Keep long receipts intact while bounding the expanded bitmap so Tesseract
  // does not need to decode an unnecessarily huge upscaled strip.
  const pixelBoundWidth = Math.floor(
    Math.sqrt((28_000_000 * Math.max(sourceWidth, 1)) / Math.max(sourceHeight, 1)),
  );
  const targetWidth = Math.max(900, Math.min(desiredWidth, pixelBoundWidth));
  return image
    .flatten({ background: '#ffffff' })
    .resize({ width: targetWidth, fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .clahe({ width: 3, height: 3, maxSlope: 2 })
    .sharpen({ sigma: 0.8 })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

export async function assessReceiptImage(input: Buffer): Promise<ReceiptImageQuality> {
  const source = sharp(input, {
    failOn: 'error',
    limitInputPixels: 40_000_000,
    sequentialRead: true,
  });
  const metadata = await source.metadata();
  const swapsEdges = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  const width = swapsEdges ? (metadata.height ?? 0) : (metadata.width ?? 0);
  const height = swapsEdges ? (metadata.width ?? 0) : (metadata.height ?? 0);
  const analysis = source
    .clone()
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: 1_000, fit: 'inside', withoutEnlargement: true })
    .grayscale();
  const stats = await analysis.stats();
  const channel = stats.channels[0];
  const brightness = channel?.mean ?? 255;
  const contrast = channel?.stdev ?? 0;
  const warnings: string[] = [];
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);

  if (width > 0 && height > 0 && (shortEdge < 720 || width * height < 800_000)) {
    warnings.push('image_low_resolution');
  }
  if (shortEdge > 0 && (longEdge / shortEdge < 1.08 || longEdge / shortEdge > 12)) {
    warnings.push('image_unusual_aspect_ratio');
  }
  if (brightness < 68) warnings.push('image_too_dark');
  else if (brightness > 247) warnings.push('image_overexposed');
  if (contrast < 20) warnings.push('image_low_contrast');
  if (stats.sharpness < 0.65) warnings.push('image_blurry');

  return {
    width,
    height,
    brightness,
    contrast,
    sharpness: stats.sharpness,
    warnings,
  };
}

function mergeAlignedLines(lines: readonly PositionedLine[]): OcrLine[] {
  const rows: PositionedLine[][] = [];
  for (const line of [...lines].sort(
    (left, right) => left.top! - right.top! || left.left! - right.left!,
  )) {
    const center = (line.top! + line.bottom) / 2;
    const height = Math.max(1, line.bottom - line.top!);
    const row = rows.find((candidate) => {
      const candidateTop = Math.min(...candidate.map((entry) => entry.top!));
      const candidateBottom = Math.max(...candidate.map((entry) => entry.bottom));
      const candidateCenter = (candidateTop + candidateBottom) / 2;
      const candidateHeight = Math.max(1, candidateBottom - candidateTop);
      return Math.abs(center - candidateCenter) <= Math.max(height, candidateHeight) * 0.55;
    });
    if (row) row.push(line);
    else rows.push([line]);
  }
  return rows
    .map((row) => {
      const ordered = row.sort((left, right) => left.left! - right.left!);
      const confidence =
        ordered.reduce((sum, line) => sum + line.confidence, 0) / Math.max(ordered.length, 1);
      return {
        text: ordered
          .map((line) => line.text.trim())
          .filter(Boolean)
          .join(' '),
        confidence,
        top: Math.min(...ordered.map((line) => line.top!)),
        left: Math.min(...ordered.map((line) => line.left!)),
      };
    })
    .sort((left, right) => (left.top ?? 0) - (right.top ?? 0));
}

async function recognizePrepared(image: Buffer): Promise<Recognition> {
  const instance = await worker();
  try {
    const result = await instance.recognize(
      image,
      { rotateAuto: true },
      { text: true, blocks: true },
    );
    const positionedLines = result.data.blocks
      ?.flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .map((line) => ({
        text: line.text,
        confidence: line.confidence,
        top: line.bbox.y0,
        left: line.bbox.x0,
        bottom: line.bbox.y1,
        right: line.bbox.x1,
      }))
      .sort((left, right) => left.top - right.top || left.left - right.left);
    const lines = positionedLines?.length
      ? mergeAlignedLines(positionedLines)
      : result.data.text
          .split(/\r?\n/u)
          .map((text) => ({ text, confidence: result.data.confidence }));
    return { lines, confidence: result.data.confidence, qualityWarnings: [] };
  } catch (error) {
    const failedWorker = await workerPromise?.catch(() => undefined);
    workerPromise = undefined;
    await failedWorker?.terminate().catch(() => undefined);
    throw error;
  }
}

export async function recognizeReceiptImage(input: Buffer): Promise<Recognition> {
  const [image, quality] = await Promise.all([prepareImage(input), assessReceiptImage(input)]);
  const recognition = queue.then(() => recognizePrepared(image));
  queue = recognition.then(
    () => undefined,
    () => undefined,
  );
  return { ...(await recognition), qualityWarnings: quality.warnings };
}

export async function shutdownReceiptOcr(): Promise<void> {
  await queue.catch(() => undefined);
  const instance = await workerPromise?.catch(() => undefined);
  workerPromise = undefined;
  await instance?.terminate().catch(() => undefined);
}

process.once('SIGTERM', () => {
  void shutdownReceiptOcr();
});
