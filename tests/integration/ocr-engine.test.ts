import { afterAll, describe, expect, it } from 'vitest';
import { parseReceiptLines } from '../../server/ocr/receipt-parser';
import {
  assessReceiptImage,
  recognizeReceiptImage,
  shutdownReceiptOcr,
} from '../../server/ocr/tesseract-receipt';

const syntheticReceipt = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
  <rect width="900" height="1200" fill="white"/>
  <g fill="black" font-family="Arial, sans-serif" font-size="42">
    <text x="110" y="100" font-size="54" font-weight="bold">MERCADONA</text>
    <text x="110" y="165">C/ MAYOR, 12</text>
    <text x="110" y="280">AGUA MINERAL</text>
    <text x="680" y="280">1,50</text>
    <text x="110" y="355">PAN INTEGRAL</text>
    <text x="680" y="355">2,40</text>
    <line x1="100" y1="420" x2="800" y2="420" stroke="black" stroke-width="3"/>
    <text x="110" y="510" font-size="52" font-weight="bold">TOTAL</text>
    <text x="650" y="510" font-size="52" font-weight="bold">3,90 EUR</text>
  </g>
</svg>
`);

afterAll(async () => {
  await shutdownReceiptOcr();
});

describe('server receipt OCR', () => {
  it('reports measurable image-quality problems before interpreting text', async () => {
    const poorImage = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="500" height="850">
        <rect width="500" height="850" fill="#161616"/>
      </svg>
    `);
    const quality = await assessReceiptImage(poorImage);

    expect(quality.warnings).toEqual(
      expect.arrayContaining([
        'image_low_resolution',
        'image_too_dark',
        'image_low_contrast',
        'image_blurry',
      ]),
    );
  });

  it('reads a receipt image with the bundled Spanish model', async () => {
    const recognition = await recognizeReceiptImage(syntheticReceipt);
    const result = parseReceiptLines(recognition.lines, {
      pageConfidence: recognition.confidence,
    });

    expect(recognition.lines.length).toBeGreaterThanOrEqual(4);
    expect(result.merchantName).toBe('Mercadona');
    expect(result.totalCents).toBe(390);
    expect(result.items.map((item) => item.lineTotalCents)).toEqual([150, 240]);
  }, 45_000);
});
