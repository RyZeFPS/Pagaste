// Small, dependency-free QR encoder for Pagaste collaboration links.
// It intentionally emits a fixed Version 6 / ECC-L symbol (41×41), whose
// 134-byte payload capacity comfortably covers the app's public URLs.

const VERSION = 6;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 136;
const BLOCK_COUNT = 2;
const DATA_CODEWORDS_PER_BLOCK = 68;
const EC_CODEWORDS_PER_BLOCK = 18;
const FORMAT_GENERATOR = 0x537;
const FORMAT_MASK = 0x5412;

type Cell = boolean | null;

function appendBits(target: number[], value: number, length: number): void {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push(((value >>> bit) & 1) === 1 ? 1 : 0);
}

function payloadBytes(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 134) throw new Error('QR_PAYLOAD_TOO_LONG');
  return bytes;
}

function dataCodewords(value: string): number[] {
  const bytes = payloadBytes(value);
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  const capacity = DATA_CODEWORDS * 8;
  for (let index = 0; index < Math.min(4, capacity - bits.length); index += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const result: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    result.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; result.length < DATA_CODEWORDS; pad += 1) {
    result.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  return result;
}

function makeGaloisTables(): { exp: number[]; log: number[] } {
  const exp = Array<number>(512).fill(0);
  const log = Array<number>(256).fill(0);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < exp.length; index += 1) exp[index] = exp[index - 255] ?? 0;
  return { exp, log };
}

const galois = makeGaloisTables();

function multiply(left: number, right: number): number {
  if (!left || !right) return 0;
  return galois.exp[(galois.log[left] ?? 0) + (galois.log[right] ?? 0)] ?? 0;
}

function generatorPolynomial(degree: number): number[] {
  let polynomial = [1];
  for (let exponent = 0; exponent < degree; exponent += 1) {
    const next = Array<number>(polynomial.length + 1).fill(0);
    for (let index = 0; index < polynomial.length; index += 1) {
      next[index] = (next[index] ?? 0) ^ (polynomial[index] ?? 0);
      next[index + 1] =
        (next[index + 1] ?? 0) ^ multiply(polynomial[index] ?? 0, galois.exp[exponent] ?? 0);
    }
    polynomial = next;
  }
  return polynomial;
}

const ecGenerator = generatorPolynomial(EC_CODEWORDS_PER_BLOCK);

function errorCorrection(data: number[]): number[] {
  const remainder = Array<number>(EC_CODEWORDS_PER_BLOCK).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0);
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < remainder.length; index += 1) {
      remainder[index] = (remainder[index] ?? 0) ^ multiply(ecGenerator[index + 1] ?? 0, factor);
    }
  }
  return remainder;
}

function interleavedCodewords(value: string): number[] {
  const data = dataCodewords(value);
  const blocks = Array.from({ length: BLOCK_COUNT }, (_, block) =>
    data.slice(block * DATA_CODEWORDS_PER_BLOCK, (block + 1) * DATA_CODEWORDS_PER_BLOCK),
  );
  const ecBlocks = blocks.map(errorCorrection);
  const result: number[] = [];
  for (let index = 0; index < DATA_CODEWORDS_PER_BLOCK; index += 1) {
    for (const block of blocks) result.push(block[index] ?? 0);
  }
  for (let index = 0; index < EC_CODEWORDS_PER_BLOCK; index += 1) {
    for (const block of ecBlocks) result.push(block[index] ?? 0);
  }
  return result;
}

function emptyMatrix(): Cell[][] {
  return Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
}

function finder(matrix: Cell[][], row: number, column: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const y = row + dy;
      const x = column + dx;
      if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) continue;
      matrix[y]![x] =
        dy >= 0 &&
        dy <= 6 &&
        dx >= 0 &&
        dx <= 6 &&
        (dy === 0 ||
          dy === 6 ||
          dx === 0 ||
          dx === 6 ||
          (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4));
    }
  }
}

function alignment(matrix: Cell[][], row: number, column: number): void {
  if (matrix[row]?.[column] !== null) return;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      matrix[row + dy]![column + dx] =
        Math.max(Math.abs(dx), Math.abs(dy)) === 2 || (dx === 0 && dy === 0);
    }
  }
}

function formatBits(mask: number): number {
  const value = (0b01 << 3) | mask; // ECC level L
  let remainder = value << 10;
  while (Math.floor(Math.log2(remainder)) >= Math.floor(Math.log2(FORMAT_GENERATOR))) {
    remainder ^=
      FORMAT_GENERATOR <<
      (Math.floor(Math.log2(remainder)) - Math.floor(Math.log2(FORMAT_GENERATOR)));
  }
  return ((value << 10) | remainder) ^ FORMAT_MASK;
}

function setupFormat(matrix: Cell[][], mask: number): void {
  const bits = formatBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const dark = ((bits >>> index) & 1) === 1;
    if (index < 6) matrix[index]![8] = dark;
    else if (index < 8) matrix[index + 1]![8] = dark;
    else matrix[SIZE - 15 + index]![8] = dark;

    if (index < 8) matrix[8]![SIZE - index - 1] = dark;
    else if (index < 9) matrix[8]![15 - index] = dark;
    else matrix[8]![15 - index - 1] = dark;
  }
  matrix[SIZE - 8]![8] = true;
}

function functionPatterns(mask: number): Cell[][] {
  const matrix = emptyMatrix();
  finder(matrix, 0, 0);
  finder(matrix, SIZE - 7, 0);
  finder(matrix, 0, SIZE - 7);
  alignment(matrix, 6, 6);
  alignment(matrix, 6, 34);
  alignment(matrix, 34, 6);
  alignment(matrix, 34, 34);
  for (let index = 8; index < SIZE - 8; index += 1) {
    if (matrix[index]?.[6] === null) matrix[index]![6] = index % 2 === 0;
    if (matrix[6]?.[index] === null) matrix[6]![index] = index % 2 === 0;
  }
  setupFormat(matrix, mask);
  return matrix;
}

function maskBit(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return (((row * column) % 3) + ((row + column) % 2)) % 2 === 0;
  }
}

function placeData(matrix: Cell[][], codewords: number[], mask: number): void {
  let bitIndex = 0;
  let upward = true;
  for (let right = SIZE - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let offset = 0; offset < SIZE; offset += 1) {
      const row = upward ? SIZE - 1 - offset : offset;
      for (let side = 0; side < 2; side += 1) {
        const column = right - side;
        if (matrix[row]?.[column] !== null) continue;
        const byte = codewords[Math.floor(bitIndex / 8)] ?? 0;
        const data = ((byte >>> (7 - (bitIndex % 8))) & 1) === 1;
        matrix[row]![column] = data !== maskBit(mask, row, column);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function penalty(matrix: boolean[][]): number {
  let score = 0;
  const lines = [
    ...matrix,
    ...Array.from({ length: SIZE }, (_, column) => matrix.map((row) => row[column] ?? false)),
  ];
  for (const line of lines) {
    let run = 1;
    for (let index = 1; index <= SIZE; index += 1) {
      if (index < SIZE && line[index] === line[index - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + run - 5;
        run = 1;
      }
    }
    const pattern = '1011101';
    const text = line.map((dark) => (dark ? '1' : '0')).join('');
    for (let index = 0; index <= SIZE - pattern.length; index += 1) {
      if (
        text.slice(index, index + pattern.length) === pattern &&
        (text.slice(Math.max(0, index - 4), index) === '0000' ||
          text.slice(index + 7, index + 11) === '0000')
      ) {
        score += 40;
      }
    }
  }
  for (let row = 0; row < SIZE - 1; row += 1) {
    for (let column = 0; column < SIZE - 1; column += 1) {
      const value = matrix[row]![column];
      if (
        matrix[row]![column + 1] === value &&
        matrix[row + 1]![column] === value &&
        matrix[row + 1]![column + 1] === value
      ) {
        score += 3;
      }
    }
  }
  const dark = matrix.flat().filter(Boolean).length;
  score += Math.floor(Math.abs(dark * 20 - SIZE * SIZE * 10) / (SIZE * SIZE)) * 10;
  return score;
}

export function encodeQrCode(value: string): boolean[][] {
  const codewords = interleavedCodewords(value);
  let best: boolean[][] | undefined;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const cells = functionPatterns(mask);
    placeData(cells, codewords, mask);
    const matrix = cells.map((row) => row.map((cell) => cell ?? false));
    const currentPenalty = penalty(matrix);
    if (currentPenalty < bestPenalty) {
      best = matrix;
      bestPenalty = currentPenalty;
    }
  }
  if (!best) throw new Error('QR_ENCODING_FAILED');
  return best;
}
