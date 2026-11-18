import { deflateSync } from "node:zlib";

// Makes a simple illustrated avatar (soft gradient, a head and shoulders) as a
// PNG, with no image library and no third-party artwork. The same seed always
// gives the same picture. These are cartoon placeholders, never real faces.

const SIZE = 256;

// Small seeded random generator (mulberry32), so output is repeatable.
function rngFrom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// PNG chunks end with a CRC-32 checksum.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function makeAvatarPng(seed: string): Buffer {
  const rng = rngFrom(seed);
  const hue = rng() * 360;
  const top = hslToRgb(hue, 0.55, 0.78);
  const bottom = hslToRgb((hue + 35) % 360, 0.55, 0.58);
  const figure = hslToRgb(hue, 0.3, 0.3);

  // A little variety in where the head sits and how wide the shoulders are.
  const cx = 128 + (rng() - 0.5) * 16;
  const headY = 100 + (rng() - 0.5) * 12;
  const headR = 42 + rng() * 8;
  const shoulderRx = 78 + rng() * 14;

  const inHead = (x: number, y: number) =>
    (x - cx) ** 2 + (y - headY) ** 2 <= headR ** 2;
  const inBody = (x: number, y: number) =>
    ((x - cx) / shoulderRx) ** 2 + ((y - 250) / 78) ** 2 <= 1;

  // Each row starts with filter byte 0 (no filter), then R, G, B per pixel.
  const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
  let pos = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[pos++] = 0;
    const t = y / (SIZE - 1);
    for (let x = 0; x < SIZE; x++) {
      // 2x2 samples per pixel give smooth (anti-aliased) edges.
      let covered = 0;
      for (const dy of [0.25, 0.75]) {
        for (const dx of [0.25, 0.75]) {
          if (inHead(x + dx, y + dy) || inBody(x + dx, y + dy)) covered++;
        }
      }
      const f = covered / 4;
      for (let c = 0; c < 3; c++) {
        const bg = top[c] + (bottom[c] - top[c]) * t;
        raw[pos++] = Math.round(bg * (1 - f) + figure[c] * f);
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0); // width
  header.writeUInt32BE(SIZE, 4); // height
  header[8] = 8; // bit depth
  header[9] = 2; // colour type 2 = RGB
  // compression, filter and interlace bytes stay 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const AVATAR_SIZE = SIZE;
