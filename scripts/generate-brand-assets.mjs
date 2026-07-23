import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = [
  ['assets/branding/pagaste-icon.svg', 'assets/images/icon.png', 1024],
  ['assets/branding/pagaste-icon.svg', 'assets/images/favicon.png', 64],
  ['assets/branding/pagaste-mark-light.svg', 'assets/images/splash-icon.png', 512],
  ['assets/branding/pagaste-mark-primary.svg', 'assets/images/android-icon-foreground.png', 1024],
  ['assets/branding/pagaste-monochrome.svg', 'assets/images/android-icon-monochrome.png', 1024],
];

const browser = await chromium.launch({ headless: true });
try {
  for (const [source, destination, size] of jobs) {
    const output = resolve(root, destination);
    await mkdir(dirname(output), { recursive: true });
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.goto(pathToFileURL(resolve(root, source)).href);
    const image = page.locator('svg');
    await image.waitFor();
    await image.evaluate((element, nextSize) => {
      element.setAttribute('width', String(nextSize));
      element.setAttribute('height', String(nextSize));
      element.style.display = 'block';
      element.style.width = `${nextSize}px`;
      element.style.height = `${nextSize}px`;
      document.documentElement.style.margin = '0';
      document.documentElement.style.background = 'transparent';
    }, size);
    await image.screenshot({ path: output, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
