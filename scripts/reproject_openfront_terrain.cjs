// ═══════════════════════════════════════════════════════════════════════
// Reproject OpenFront giantworldmap terrain (.bin) into CORRECT equirectangular
// projection by registering its land mask against Natural Earth GeoJSON land.
//
// Why: the giantworldmap is ~2.11:1 (not 2:1) → visible offset vs real lat/lon.
// This finds the exact (dx, dy) shift via land-shape cross-correlation, then
// resamples every terrain byte into a clean equirectangular frame so the grid
// can sample it 1:1 with no offset.
//
// Usage:  node scripts/reproject_openfront_terrain.cjs
// Output: public/data/openfront_terrain_corrected.bin  (4108 x 1948 bytes)
// ═══════════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");

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
  "data",
  "openfront_terrain_corrected.bin",
);
const GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const OF_W = 4108,
  OF_H = 1948;
const zlib = require("zlib");

// ── encodeTerrainTile (OpenFront ColorUtils) for preview PNG ──
const OCEAN = [71, 133, 181];
function encodeTerrainTile(tb) {
  const isLand = (tb & 0x80) !== 0;
  const isShoreline = (tb & 0x40) !== 0;
  const magnitude = tb & 0x1f;
  if (isLand && isShoreline) return [204, 203, 158];
  if (isLand) {
    if (magnitude < 10) return [190, 220 - 2 * magnitude, 138];
    if (magnitude < 20)
      return [200 + 2 * magnitude, 183 + 2 * magnitude, 138 + 2 * magnitude];
    const v = Math.min(255, 230 + Math.floor(magnitude / 2));
    return [v, v, v];
  }
  if (isShoreline) return [100, 143, 255];
  const m = Math.min(magnitude, 10);
  return [Math.max(0, OCEAN[0] - m), Math.max(0, OCEAN[1] - m), Math.max(0, OCEAN[2] - m)];
}
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ── equirectangular lon/lat → pixel ──
const lonToX = (lon, W) => ((lon + 180) / 360) * W;
const latToY = (lat, H) => ((90 - lat) / 180) * H;

// ── Rasterize GeoJSON land polygons → binary mask (Uint8Array, 1=land) ──
function rasterizeLand(geojson, W, H) {
  let canvas, ctx;
  try {
    const { createCanvas } = require("canvas");
    canvas = createCanvas(W, H);
    ctx = canvas.getContext("2d");
  } catch (e) {
    throw new Error("canvas package required for GeoJSON rasterization: " + e);
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H); // water = black
  ctx.fillStyle = "#fff"; // land = white
  const drawRing = (ring) => {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const x = lonToX(ring[i][0], W);
      const y = latToY(ring[i][1], H);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  for (const feat of geojson.features) {
    const g = feat.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) drawRing(ring);
  }
  const img = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = img[i * 4] > 128 ? 1 : 0;
  return mask;
}

// ── Sample OpenFront map.bin land mask (bit7) down to CALW×CALH ──
function sampleOfLand(buf, CALW, CALH) {
  const mask = new Uint8Array(CALW * CALH);
  for (let y = 0; y < CALH; y++) {
    const ofY = Math.min(OF_H - 1, ((y + 0.5) / CALH) * OF_H) | 0;
    for (let x = 0; x < CALW; x++) {
      const ofX = Math.min(OF_W - 1, ((x + 0.5) / CALW) * OF_W) | 0;
      mask[y * CALW + x] = (buf[ofY * OF_W + ofX] & 0x80) ? 1 : 0;
    }
  }
  return mask;
}

// ── Overlap (IoU) for a given affine: sample `of` at ((x-dx)*sx, (y-dy)*sy) ──
// x wraps (longitude), y clamps (latitude). dx,dy in calibration px; sx,sy scale.
function evalIoU(ref, of, W, H, dx, dy, sx, sy) {
  let inter = 0,
    uni = 0;
  for (let y = 0; y < H; y++) {
    let oy = (y - dy) * sy;
    oy = Math.round(oy);
    if (oy < 0) oy = 0;
    if (oy >= H) oy = H - 1;
    const rowOf = oy * W;
    const rowRef = y * W;
    for (let x = 0; x < W; x++) {
      let ox = ((x - dx) * sx) % W;
      if (ox < 0) ox += W;
      ox = Math.round(ox);
      const a = ref[rowRef + x];
      const b = of[rowOf + ox];
      if (a || b) {
        uni++;
        if (a && b) inter++;
      }
    }
  }
  return inter / uni;
}

// Staged affine search: shift → scale → shift refine
function findAffine(ref, of, W, H) {
  // Stage 1: shift only (sx=sy=1)
  let best = { iou: -1, dx: 0, dy: 0, sx: 1, sy: 1 };
  for (let dy = -20; dy <= 20; dy++)
    for (let dx = -80; dx <= 80; dx++) {
      const iou = evalIoU(ref, of, W, H, dx, dy, 1, 1);
      if (iou > best.iou) best = { iou, dx, dy, sx: 1, sy: 1 };
    }
  console.log(`  stage1 shift: dx=${best.dx} dy=${best.dy} IoU=${(best.iou * 100).toFixed(1)}%`);
  // Stage 2: scale refine (fix shift)
  for (let sy = 0.92; sy <= 1.09; sy += 0.01)
    for (let sx = 0.95; sx <= 1.05; sx += 0.01) {
      const iou = evalIoU(ref, of, W, H, best.dx, best.dy, sx, sy);
      if (iou > best.iou) best = { iou, dx: best.dx, dy: best.dy, sx, sy };
    }
  console.log(
    `  stage2 scale: sx=${best.sx.toFixed(3)} sy=${best.sy.toFixed(3)} IoU=${(best.iou * 100).toFixed(1)}%`,
  );
  // Stage 3: shift refine (fix scale)
  for (let dy = best.dy - 4; dy <= best.dy + 4; dy++)
    for (let dx = best.dx - 8; dx <= best.dx + 8; dx++) {
      const iou = evalIoU(ref, of, W, H, dx, dy, best.sx, best.sy);
      if (iou > best.iou) best = { iou, dx, dy, sx: best.sx, sy: best.sy };
    }
  console.log(`  stage3 refine: dx=${best.dx} dy=${best.dy} IoU=${(best.iou * 100).toFixed(1)}%`);
  return best;
}

// ── Main ──
(async () => {
  const buf = fs.readFileSync(BIN_PATH);
  console.log(`map.bin: ${buf.length} bytes (expect ${OF_W * OF_H})`);

  // 1. Fetch GeoJSON
  let geojson;
  try {
    console.log("Fetching Natural Earth GeoJSON...");
    const res = await fetch(GEOJSON_URL);
    geojson = await res.json();
    console.log(`GeoJSON: ${geojson.features.length} country features`);
  } catch (e) {
    console.error("GeoJSON fetch failed:", e.message);
    process.exit(1);
  }

  // 2. Rasterize reference land + sample OpenFront land at calibration resolution
  const CALW = 512,
    CALH = 256;
  console.log(`Rasterizing GeoJSON land at ${CALW}x${CALH}...`);
  const ref = rasterizeLand(geojson, CALW, CALH);
  const of = sampleOfLand(buf, CALW, CALH);
  const refLand = ref.reduce((s, v) => s + v, 0);
  const ofLand = of.reduce((s, v) => s + v, 0);
  console.log(
    `Calibration land: ref=${refLand} of=${ofLand} (${((100 * ofLand) / (CALW * CALH)).toFixed(1)}%)`,
  );

  // 3. Find best affine (shift + scale)
  console.log("Registering land shapes (staged affine search)...");
  const best = findAffine(ref, of, CALW, CALH);
  console.log(
    `Best affine: dx=${best.dx} dy=${best.dy} sx=${best.sx.toFixed(3)} sy=${best.sy.toFixed(3)} IoU=${(best.iou * 100).toFixed(1)}%`,
  );

  // Scale params to full OpenFront resolution
  const DX = (best.dx * OF_W) / CALW;
  const DY = (best.dy * OF_H) / CALH;
  const SX = best.sx,
    SY = best.sy;
  console.log(`Full-res: DX=${DX.toFixed(1)} DY=${DY.toFixed(1)} SX=${SX.toFixed(4)} SY=${SY.toFixed(4)}`);

  // 4. Reproject: corrected[x,y] = of[((x-DX)*SX) wrap, ((y-DY)*SY) clamp]
  const out = Buffer.alloc(OF_W * OF_H);
  for (let y = 0; y < OF_H; y++) {
    let sy = (y - DY) * SY;
    sy = Math.round(sy);
    if (sy < 0) sy = 0;
    if (sy >= OF_H) sy = OF_H - 1;
    const rowOf = sy * OF_W;
    for (let x = 0; x < OF_W; x++) {
      let sx = ((x - DX) * SX) % OF_W;
      if (sx < 0) sx += OF_W;
      sx = Math.round(sx);
      out[y * OF_W + x] = buf[rowOf + sx];
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, out);
  console.log(
    `Wrote ${OUT_PATH} (${(out.length / 1024 / 1024).toFixed(2)} MB) | IoU ${(best.iou * 100).toFixed(1)}%`,
  );

  // 5. Preview PNG (corrected terrain as flat colors) for visual sanity check
  const rgba = Buffer.alloc(OF_W * OF_H * 4);
  for (let i = 0; i < OF_W * OF_H; i++) {
    const [r, g, b] = encodeTerrainTile(out[i]);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  const previewPath = path.join(
    __dirname, "..", "public", "textures", "openfront_terrain_corrected.png");
  fs.writeFileSync(previewPath, encodePNG(OF_W, OF_H, rgba));
  console.log(`Wrote preview ${previewPath}`);
})();
