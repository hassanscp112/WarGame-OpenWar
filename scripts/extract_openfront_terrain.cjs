// ═══════════════════════════════════════════════════════════════════════
// Extract OpenFront giantworldmap terrain (.bin) -> equirectangular PNG
// globe texture. Pure OpenFront flat colors (encodeTerrainTile algorithm).
//
// Usage:  node scripts/extract_openfront_terrain.cjs
// Output: public/textures/openfront_terrain.png  (4108 x 1948, lossless)
// ═══════════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BIN_PATH = path.join(
  __dirname,
  "..",
  "OpenFrontIO-main",
  "resources",
  "maps",
  "giantworldmap",
  "map.bin",
);
const OUT_PATH = path.join(
  __dirname,
  "..",
  "public",
  "textures",
  "openfront_terrain.png",
);

// Dimensions from resources/maps/giantworldmap/manifest.json -> map.width/height
const WIDTH = 4108;
const HEIGHT = 1948;

// Deep-water base color — render-settings.json terrain.oceanColor "#4785b5"
const OCEAN = [71, 133, 181];

// ── OpenFront encodeTerrainTile (ColorUtils.ts) — single source of truth ──
// Terrain byte: bit7 isLand | bit6 isShoreline | bit5 isOcean | bits0-4 magnitude
function encodeTerrainTile(tb) {
  const isLand = (tb & 0x80) !== 0;
  const isShoreline = (tb & 0x40) !== 0;
  const magnitude = tb & 0x1f;

  if (isLand && isShoreline) return [204, 203, 158]; // shore (sand)
  if (isLand) {
    if (magnitude < 10) return [190, 220 - 2 * magnitude, 138]; // plains (green)
    if (magnitude < 20)
      return [
        200 + 2 * magnitude,
        183 + 2 * magnitude,
        138 + 2 * magnitude,
      ]; // highland (tan)
    const v = Math.min(255, 230 + Math.floor(magnitude / 2)); // mountain (gray)
    return [v, v, v];
  }
  if (isShoreline) return [100, 143, 255]; // shoreline water (light blue)
  const m = Math.min(magnitude, 10); // deep water — darkens with depth
  return [
    Math.max(0, OCEAN[0] - m),
    Math.max(0, OCEAN[1] - m),
    Math.max(0, OCEAN[2] - m),
  ];
}

// ── Minimal self-contained PNG encoder (8-bit RGBA) ──
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Main ──
const buf = fs.readFileSync(BIN_PATH);
const expected = WIDTH * HEIGHT;
let offset = 0;
if (buf.length === expected) {
  offset = 0; // headerless
} else if (buf.length === expected + 4) {
  offset = 4; // 4-byte header (width/height uint16 LE)
  console.log(
    `Header dims: ${buf.readUInt16LE(0)}x${buf.readUInt16LE(2)} (skipping 4-byte header)`,
  );
} else {
  console.error(
    `Unexpected map.bin size: ${buf.length} (expected ${expected} or ${expected + 4})`,
  );
  process.exit(1);
}

const rgba = Buffer.alloc(expected * 4);
let landCount = 0,
  waterCount = 0,
  shoreCount = 0;
for (let i = 0; i < expected; i++) {
  const tb = buf[offset + i];
  const isLand = (tb & 0x80) !== 0;
  const isShore = (tb & 0x40) !== 0;
  if (isLand) landCount++;
  else waterCount++;
  if (isShore) shoreCount++;
  const [r, g, b] = encodeTerrainTile(tb);
  rgba[i * 4] = r;
  rgba[i * 4 + 1] = g;
  rgba[i * 4 + 2] = b;
  rgba[i * 4 + 3] = 255;
}
console.log(
  `Tiles: land=${landCount} water=${waterCount} shoreline=${shoreCount} | land=${(100 * landCount / expected).toFixed(1)}%`,
);

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
const png = encodePNG(WIDTH, HEIGHT, rgba);
fs.writeFileSync(OUT_PATH, png);
console.log(
  `Wrote ${OUT_PATH} (${(png.length / 1024 / 1024).toFixed(2)} MB, ${WIDTH}x${HEIGHT})`,
);
