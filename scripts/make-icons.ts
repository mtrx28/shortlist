import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { crc32 } from "./seed/avatar";

// Draws the app icons with no image library and no outside artwork: a teal
// rounded square with three white bars of falling length (a short list, the
// idea of the app). Run it with `npm run icons`; the files land in public/ and
// are committed, so the build never needs this script.
//
//   icon.svg                  the same picture as vector (browser tab)
//   icon-192.png, icon-512.png   for the web app manifest ("any" purpose)
//   icon-maskable-512.png     full bleed with the picture inside the safe zone
//   apple-touch-icon.png      180 px, no transparent corners (iOS adds its own)

const TEAL: [number, number, number] = [11, 93, 99]; // #0b5d63
const WHITE: [number, number, number] = [255, 255, 255];

// Everything is described on a 100 x 100 canvas, then scaled.
type Bar = { x: number; y: number; w: number; h: number };
function bars(scale: number): Bar[] {
  // scale < 1 shrinks the picture towards the centre (maskable safe zone).
  const base: Bar[] = [
    { x: 24, y: 28, w: 52, h: 10 },
    { x: 24, y: 45, w: 40, h: 10 },
    { x: 24, y: 62, w: 28, h: 10 },
  ];
  return base.map((b) => ({
    x: 50 + (b.x - 50) * scale,
    y: 50 + (b.y - 50) * scale,
    w: b.w * scale,
    h: b.h * scale,
  }));
}

function inRoundedRect(
  px: number,
  py: number,
  b: Bar,
  radius: number,
): boolean {
  const cx = Math.min(Math.max(px, b.x + radius), b.x + b.w - radius);
  const cy = Math.min(Math.max(py, b.y + radius), b.y + b.h - radius);
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
}

function render(size: number, opts: { rounded: boolean; scale: number }) {
  const SS = 3; // 3 x 3 samples per pixel for smooth edges
  const list = bars(opts.scale);
  const frame: Bar = { x: 0, y: 0, w: 100, h: 100 };
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ((x + (sx + 0.5) / SS) / size) * 100;
          const py = ((y + (sy + 0.5) / SS) / size) * 100;
          if (opts.rounded && !inRoundedRect(px, py, frame, 22)) continue;
          const onBar = list.some((bar) =>
            inRoundedRect(px, py, bar, bar.h / 2),
          );
          const c = onBar ? WHITE : TEAL;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const covered = a / 255; // how many samples were inside the shape
      const i = (y * size + x) * 4;
      if (covered > 0) {
        rgba[i] = Math.round(r / covered);
        rgba[i + 1] = Math.round(g / covered);
        rgba[i + 2] = Math.round(b / covered);
      }
      rgba[i + 3] = Math.round((a / n) * 1);
    }
  }
  return rgba;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function svg(): string {
  const rects = bars(1)
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.h / 2}" fill="#ffffff"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Shortlist"><rect width="100" height="100" rx="22" fill="#0b5d63"/>${rects}</svg>\n`;
}

const out = join(process.cwd(), "public");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "icon.svg"), svg());
const files: [string, number, { rounded: boolean; scale: number }][] = [
  ["icon-192.png", 192, { rounded: true, scale: 1 }],
  ["icon-512.png", 512, { rounded: true, scale: 1 }],
  ["icon-maskable-512.png", 512, { rounded: false, scale: 0.75 }],
  ["apple-touch-icon.png", 180, { rounded: false, scale: 0.9 }],
];
for (const [name, size, opts] of files) {
  writeFileSync(join(out, name), png(size, render(size, opts)));
  console.log(`wrote public/${name}`);
}
console.log("wrote public/icon.svg");
