// Dependency-free PWA icon generator for Water Sort.
//
// Draws a rounded dark tile with a test tube holding three distinct color
// bands. Standard icons are rounded with transparent corners; maskable icons
// are full-bleed squares whose content stays inside the central 80% safe zone.
//
// The PNG writer is hand-rolled: node:zlib for the DEFLATE stream and inline
// CRC32/IHDR/IDAT/IEND chunks, so icon generation adds no runtime dependency.
//
// Usage:
//   node scripts/generate-icons.mjs           # (re)write web/public/icons/*.png
//   node scripts/generate-icons.mjs --check   # verify on-disk icons match and are valid
//
// Output is deterministic: the same geometry produces byte-identical PNGs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Palette mirrored from web/src/styles.css (`--deep`, the tube glass and
// colors 3, 4, 1). Keep in sync when the theme changes.
const BACKGROUND = [7, 38, 52];
const TUBE_BORDER = [150, 196, 208];
const TUBE_BG = [16, 56, 72];
/** Bottom to top, matching how a level stacks units in a tube. */
const BANDS = [
  [54, 196, 90], // color-3 grün
  [255, 212, 59], // color-4 gelb
  [236, 58, 76], // color-1 rot
];

/** Supersampling factor per axis; 4 gives 16 samples per output pixel. */
const SUBSAMPLES = 4;

const ICONS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (as used by PNG) over `buffer`, as an unsigned integer. */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length + type + data + CRC(type + data). */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Encodes an RGBA byte buffer as an 8-bit truecolor-with-alpha PNG. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression: DEFLATE
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type "None"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Reads the IHDR of a PNG buffer, throwing when it is not a valid RGBA PNG. */
function inspectPng(buffer, file) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${file}: not a PNG (bad signature)`);
  }
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') {
    throw new Error(`${file}: first chunk is ${chunkType}, expected IHDR`);
  }
  const info = {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28],
  };
  if (info.bitDepth !== 8 || info.colorType !== 6) {
    throw new Error(
      `${file}: expected 8-bit RGBA (bit depth 8, color type 6), got bit depth ${info.bitDepth}, color type ${info.colorType}`,
    );
  }
  if (info.interlace !== 0) {
    throw new Error(`${file}: interlaced PNGs are not supported here`);
  }
  return info;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** Point-in-rounded-rectangle with independent corner radii. */
function inRoundedRect(x, y, x0, y0, x1, y1, rtl, rtr, rbr, rbl) {
  if (x < x0 || x > x1 || y < y0 || y > y1) {
    return false;
  }
  if (x < x0 + rtl && y < y0 + rtl) {
    return (x - (x0 + rtl)) ** 2 + (y - (y0 + rtl)) ** 2 <= rtl * rtl;
  }
  if (x > x1 - rtr && y < y0 + rtr) {
    return (x - (x1 - rtr)) ** 2 + (y - (y0 + rtr)) ** 2 <= rtr * rtr;
  }
  if (x > x1 - rbr && y > y1 - rbr) {
    return (x - (x1 - rbr)) ** 2 + (y - (y1 - rbr)) ** 2 <= rbr * rbr;
  }
  if (x < x0 + rbl && y > y1 - rbl) {
    return (x - (x0 + rbl)) ** 2 + (y - (y1 - rbl)) ** 2 <= rbl * rbl;
  }
  return true;
}

/**
 * The color at one sub-sample point, or null when the point is outside the
 * icon shape (transparent). Colors are opaque; antialiasing comes from
 * averaging the sub-samples per output pixel.
 */
function sampleColor(x, y, geom) {
  const { size, maskable } = geom;
  let color;

  if (maskable) {
    // Full-bleed background: the whole square is covered.
    color = BACKGROUND;
  } else {
    if (
      !inRoundedRect(
        x,
        y,
        0,
        0,
        size,
        size,
        geom.bgRadius,
        geom.bgRadius,
        geom.bgRadius,
        geom.bgRadius,
      )
    ) {
      return null;
    }
    color = BACKGROUND;
  }

  const t = geom.tube;
  if (inRoundedRect(x, y, t.x0, t.y0, t.x1, t.y1, t.topRadius, t.topRadius, t.botRadius, t.botRadius)) {
    color = TUBE_BORDER;
  }
  const i = geom.inner;
  if (inRoundedRect(x, y, i.x0, i.y0, i.x1, i.y1, i.topRadius, i.topRadius, i.botRadius, i.botRadius)) {
    color = TUBE_BG;
    const rel = y - i.y0;
    if (rel >= 0 && rel < i.height) {
      const band = Math.min(BANDS.length - 1, Math.floor((rel / i.height) * BANDS.length));
      color = BANDS[band];
    }
  }

  return color;
}

/** Builds the geometry for one icon; content stays inside the safe zone. */
function geometryFor(size, maskable) {
  // Content occupies at most this fraction of the canvas. 0.62 keeps the tube
  // comfortably inside the maskable 80% safe zone (0.9 - 0.1 on each axis).
  const tubeWidth = Math.round(size * 0.33);
  const tubeHeight = Math.round(size * 0.54);
  const x0 = Math.round((size - tubeWidth) / 2);
  const y0 = Math.round((size - tubeHeight) / 2);
  const x1 = x0 + tubeWidth;
  const y1 = y0 + tubeHeight;

  const border = Math.max(2, Math.round(size * 0.03));
  const botRadius = Math.round(tubeWidth / 2);
  const topRadius = Math.max(0, Math.round(tubeWidth * 0.16));

  return {
    size,
    maskable,
    bgRadius: Math.round(size * 0.22),
    tube: { x0, y0, x1, y1, topRadius, botRadius },
    inner: {
      x0: x0 + border,
      y0: y0 + border,
      x1: x1 - border,
      y1: y1 - border,
      topRadius: Math.max(0, topRadius - border),
      botRadius: Math.max(0, botRadius - border),
      height: tubeHeight - 2 * border,
    },
  };
}

/** Renders one icon to an RGBA byte buffer. */
function renderIcon(size, maskable) {
  const geom = geometryFor(size, maskable);
  const out = Buffer.alloc(size * size * 4);
  const samples = SUBSAMPLES * SUBSAMPLES;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
        for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
          const x = px + (sx + 0.5) / SUBSAMPLES;
          const y = py + (sy + 0.5) / SUBSAMPLES;
          const color = sampleColor(x, y, geom);
          if (color !== null) {
            r += color[0];
            g += color[1];
            b += color[2];
            covered += 1;
          }
        }
      }
      if (covered === 0) {
        continue;
      }
      const index = (py * size + px) * 4;
      out[index] = Math.round(r / covered);
      out[index + 1] = Math.round(g / covered);
      out[index + 2] = Math.round(b / covered);
      out[index + 3] = Math.round((255 * covered) / samples);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function buildIcon(spec) {
  const bytes = encodePng(spec.size, renderIcon(spec.size, spec.maskable));
  const info = inspectPng(bytes, spec.file);
  if (info.width !== spec.size || info.height !== spec.size) {
    throw new Error(`${spec.file}: expected ${spec.size}x${spec.size}, got ${info.width}x${info.height}`);
  }
  if (bytes.length === 0) {
    throw new Error(`${spec.file}: empty output`);
  }
  return bytes;
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const outDir = join(resolve(scriptDir, '..'), 'web', 'public', 'icons');
  const check = process.argv.includes('--check');

  if (!check) {
    mkdirSync(outDir, { recursive: true });
  }

  let failed = false;
  for (const spec of ICONS) {
    const bytes = buildIcon(spec);
    const dest = join(outDir, spec.file);
    if (check) {
      const existing = existsSync(dest) ? readFileSync(dest) : null;
      if (existing === null || !existing.equals(bytes)) {
        console.error(`MISMATCH ${spec.file}: on-disk icon differs from regenerated output`);
        failed = true;
        continue;
      }
      console.log(`ok ${spec.file} ${spec.size}x${spec.size} (${bytes.length} bytes)`);
    } else {
      writeFileSync(dest, bytes);
      const written = readFileSync(dest);
      const info = inspectPng(written, spec.file);
      if (info.width !== spec.size || info.height !== spec.size) {
        throw new Error(`${spec.file}: wrote ${info.width}x${info.height}`);
      }
      console.log(`wrote ${spec.file} ${spec.size}x${spec.size} (${bytes.length} bytes)`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
