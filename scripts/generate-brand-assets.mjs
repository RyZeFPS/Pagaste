import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const markSource = resolve(root, 'assets/branding/pagaste-logo-mark.png');
const wordmarkSource = resolve(root, 'assets/branding/pagaste-logo-horizontal.png');
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

async function outputPath(relativePath) {
  const output = resolve(root, relativePath);
  await mkdir(dirname(output), { recursive: true });
  return output;
}

const mark = await sharp(markSource)
  .trim({ background: transparent })
  .png({ compressionLevel: 9 })
  .toBuffer();
const wordmark = await sharp(wordmarkSource)
  .trim({ background: transparent })
  .png({ compressionLevel: 9 })
  .toBuffer();

await sharp(mark)
  .resize({ height: 512, fit: 'inside', withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toFile(await outputPath('assets/images/pagaste-mark.png'));

await sharp(wordmark)
  .resize({ width: 1024, fit: 'inside', withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toFile(await outputPath('assets/images/pagaste-wordmark.png'));

const appIconMark = await sharp(mark).resize({ height: 760, fit: 'inside' }).png().toBuffer();
await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: '#F5F7FB',
  },
})
  .composite([{ input: appIconMark, gravity: 'center' }])
  .flatten({ background: '#F5F7FB' })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(await outputPath('assets/images/icon.png'));

const faviconMark = await sharp(mark).resize({ height: 56, fit: 'inside' }).png().toBuffer();
await sharp({
  create: { width: 64, height: 64, channels: 4, background: transparent },
})
  .composite([{ input: faviconMark, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile(await outputPath('assets/images/favicon.png'));

const splashMark = await sharp(mark).resize({ height: 440, fit: 'inside' }).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: transparent },
})
  .composite([{ input: splashMark, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile(await outputPath('assets/images/splash-icon.png'));

const androidMark = await sharp(mark).resize({ height: 520, fit: 'inside' }).png().toBuffer();
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: transparent },
})
  .composite([{ input: androidMark, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile(await outputPath('assets/images/android-icon-foreground.png'));

const { data: monochromeSource, info: monochromeInfo } = await sharp(androidMark)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const monochromeData = Buffer.alloc(monochromeSource.length);
for (let index = 0; index < monochromeSource.length; index += 4) {
  const red = monochromeSource[index] ?? 0;
  const green = monochromeSource[index + 1] ?? 0;
  const blue = monochromeSource[index + 2] ?? 0;
  const alpha = monochromeSource[index + 3] ?? 0;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const isColoredLogoPixel = maximum - minimum > 18 || maximum < 170;
  monochromeData[index] = 0;
  monochromeData[index + 1] = 0;
  monochromeData[index + 2] = 0;
  monochromeData[index + 3] = isColoredLogoPixel ? alpha : 0;
}
const monochromeMark = await sharp(monochromeData, {
  raw: {
    width: monochromeInfo.width,
    height: monochromeInfo.height,
    channels: 4,
  },
})
  .png()
  .toBuffer();
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: transparent },
})
  .composite([{ input: monochromeMark, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile(await outputPath('assets/images/android-icon-monochrome.png'));
