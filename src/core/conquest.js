// ════════════════════════════════════════════════════════════════════
//  CONQUEST & OCCUPATION ENGINE
//  Faithful port of OpenFrontIO's AttackExecution / GameMap conquest model,
//  adapted from a flat tile grid to a spherical lat/lon grid for the 3D globe.
//
//  Exports:
//    CONQUEST_CFG        — tuning constants (grid size, terrain, combat)
//    ConquestGrid        — ownership + terrain grid (logic, decoupled from render)
//    ConquestAttack      — long-running flood-fill conquest (port of AttackExecution)
//    attackLogic         — per-cell combat resolution (port of Config.attackLogic)
//    attackTilesPerTick  — conquest speed (port of Config.attackTilesPerTick)
// ════════════════════════════════════════════════════════════════════

export const CONQUEST_CFG = {
  // ── Grid resolution ──
  GRID_W: 7200,           // longitude cells (0.05° each → ~5.5km at equator) — small countries playable
  GRID_H: 3600,           // latitude cells  (0.05° each)
  CELL_DEG: 0.05,

  // ── Water dilation (Option 1: thicken rivers/straits for navigation) ──
  // After building the land mask, expand water features outward by this many
  // rings. Makes 1-cell rivers/straits navigable. 0 = off.
  WATER_DILATION_RINGS: 1,
  // A land cell converts to water only if it has ≥ this many water neighbours
  // (8-connected). 1 = full dilation (any water neighbour). 2 = gentler.
  WATER_DILATION_MIN_NEIGHBORS: 1,

  // ── TASK-506: geo-referenced COAST REPAIR ──
  // The OpenFront terrain binary (IoU 76% vs GeoJSON) OVER-WATERS some
  // coasts — e.g. Kent/SE England is drawn ~25km too far east and Spain's
  // Costa del Sol ~78km too far north, which keeps Dover/Gibraltar past
  // the armor wade threshold even with geo-gated dilation. The repair
  // restores land the GeoJSON country polygons claim, under two gates:
  //   1. no binary LAND within COAST_REPAIR_MIN_INLAND cells → thin
  //      features (rivers hugging their banks) are never filled;
  //   2. a geo=0 (outside-polygon) cell within COAST_REPAIR_MAX_GEO_EDGE
  //      cells → only the coastal band is restored; inland seas/lakes
  //      (Great Lakes ≈41 cells from any polygon edge, Nile delta ≈14)
  //      stay water. Calibrated live: Kent sits at edge-distance 3-5,
  //      the Thames-mouth chunk at 5, everything worth keeping ≥ 14.
  COAST_REPAIR_MIN_INLAND: 3,
  COAST_REPAIR_MAX_GEO_EDGE: 12,

  // ── Owner codes ──
  WATER: 0,
  NEUTRAL: 1,
  PLAYER: 2,
  ENEMY: 3,

  // ── Terrain codes ──
  T_WATER: 0,
  T_PLAINS: 1,
  T_HIGHLAND: 2,
  T_MOUNTAIN: 3,

  // ── Terrain combat params (ported from OpenFront attackLogic) ──
  TERRAIN_MAG:   { 1: 80,  2: 100, 3: 120 },
  // ── DEVASTATION (TASK-102): missile/blast damage paints a weakening
  // layer onto the grid — pounded territory becomes cheaper + faster to
  // take. decays slowly so saturation fades after ~3-4 minutes of peace.
  DEVASTATION_MAX: 1.0,          // full weakness cap
  DEVASTATION_PER_HIT: 0.55,     // applied at blast center
  // TASK-506: per-DECAY-CALL step. decayDevastation() visits every live
  // devastation cell each call (~30 calls/s from the render loop), so a full
  // blast (0.55) heals in 0.55/0.00012/30 ≈ 150s ≈ 2.5min of peace. (The old
  // rotating-cursor implementation swept the whole 25.9M-cell grid at 48k
  // cells/s — each cell was visited once per ~9 MINUTES, making decay
  // effectively never happen.)
  DEVASTATION_DECAY_PER_TICK: 0.00012,
  // Safety cap on the live-devastation set (cells with dev>0). Each blast
  // paints ~100-300 cells; even a sustained total war stays well under this.
  DEVASTATION_SET_CAP: 200000,
  DEVASTATION_DEF_MULT: 0.35,    // at full devastation, terrain magnitude ×0.35
  DEVASTATION_SPEED_MULT: 1.8,   // at full devastation, conquest speed ×1.8
  // ── TASK-406: devastation VISUAL layer (scorch reads on the globe) ──
  DEV_VIS_LEVELS: 16,            // quantized alpha buckets (bucket change = repaint)
  DEV_VIS_MAX_ALPHA: 150,        // scorch opacity at full devastation
  // ── TASK-406: frontline heat ──
  HEAT_AGE_MS: 12000,            // a flipped cell stays "hot" this long
  HEAT_MAX_CELLS: 24000,         // safety cap on the heat map
  TERRAIN_SPEED: { 1: 16.5, 2: 20, 3: 25  },

  // ── Large-empire defense debuff (big defenders are slower/softer) ──
  DEFENSE_DEBUFF_MIDPOINT: 150000,
  DEFENSE_DEBUFF_DECAY_RATE: Math.LN2 / 50000,
  LARGE_EMPIRE_THRESHOLD: 100000,

  // ── Elimination: defender wiped out below this many owned cells ──
  ELIMINATION_CELL_THRESHOLD: 100,
  RETREAT_MALUS_PERCENT: 25,

  // ── Economy: how many cells count as one "province" for troop-cap scaling ──
  CELLS_PER_PROVINCE: 80,

  // ── Render colors (RGBA 0-255) painted into the grid canvas ──
  // Clean flat OpenFront-style biome palette. The grid canvas is the COMPLETE map.
  // Design: terrain-aware borders only — ALL land shows its biome color regardless
  // of owner; player/enemy ownership is shown ONLY via colored frontier outlines.
  COLOR: {
    water:    [58, 110, 165, 255],   // ocean blue
    plains:   [104, 152, 86, 255],   // grass green (temperate)
    desert:   [214, 196, 142, 255],  // sandy tan (subtropical band)
    highland: [170, 156, 110, 255],  // khaki / olive
    mountain: [122, 116, 108, 255],  // gray-brown
    snow:     [232, 238, 244, 255],  // polar white / tundra
    // TASK-103: stronger territory fills — countries must read instantly
    // over the (now dark-neutral) roads + biome base.
    player:   [46, 235, 125, 255],   // vivid green — frontier tint
    enemy:    [240, 72, 72, 255],    // vivid red — frontier tint
  },
  // Latitude thresholds for biome selection
  SNOW_LAT: 62,        // |lat| above this → snow/tundra
  DESERT_MIN_LAT: 15,  // subtropical desert band
  DESERT_MAX_LAT: 32,

  // ── Tick throttle: run attack logic every N game frames (6 frames ≈ 10 ticks/sec) ──
  TICK_INTERVAL: 6,
  // Max cells a single attack may conquer in one tick (safety cap)
  MAX_CELLS_PER_TICK: 12,   // BASE cap — attack Troops scale it up (see ConquestAttack.tick)
};

// ── Owner code ↔ string helpers ──
// Bots register dynamically (codes 4+): registerOwner('bot0', 4, [r,g,b]).
const CODE_TO_STR = { 0: 'neutral', 1: 'neutral', 2: 'player', 3: 'enemy' };
const STR_TO_CODE = { neutral: 1, player: 2, enemy: 3 };
const OWNER_COLORS = { 2: null, 3: null }; // null → cfg.COLOR.player/enemy fallback
export function registerOwner(str, code, rgb) {
  CODE_TO_STR[code] = str;
  STR_TO_CODE[str] = code;
  OWNER_COLORS[code] = rgb || null;
}
export function clearRegisteredOwners() {
  for (const code of Object.keys(OWNER_COLORS)) {
    if (code === '2' || code === '3') continue;
    const str = CODE_TO_STR[code];
    delete CODE_TO_STR[code];
    delete STR_TO_CODE[str];
    delete OWNER_COLORS[code];
  }
}
function ownerColor(code, cfg) {
  if (code === cfg.PLAYER) return cfg.COLOR.player;
  if (code === cfg.ENEMY) return cfg.COLOR.enemy;
  return OWNER_COLORS[code] || cfg.COLOR.enemy;
}
function isOwnedCode(code, cfg) {
  return code === cfg.PLAYER || code === cfg.ENEMY || OWNER_COLORS[code] != null;
}

// ════════════════════════════════════════════════════════════════════
//  TERRAIN HEURISTIC DATA
//  Approximate bounding boxes for major mountain ranges & highland plates.
//  A cell whose center falls inside a box is tagged Mountain/Highland.
// ════════════════════════════════════════════════════════════════════
const MOUNTAIN_RANGES = [
  // Asia
  { minLat: 27, maxLat: 40, minLon: 68,  maxLon: 105 }, // Himalayas + Tibetan plateau
  { minLat: 35, maxLat: 50, minLon: 50,  maxLon: 75  }, // Pamir + Hindu Kush + Tien Shan
  { minLat: 10, maxLat: 22, minLon: 92,  maxLon: 98  }, // Arakan (Myanmar)
  { minLat: 25, maxLat: 38, minLon: 126, maxLon: 142 }, // Japan alps
  { minLat: 3,  maxLat: 20, minLon: 118, maxLon: 128 }, // Philippines (partial)
  { minLat: 36, maxLat: 44, minLon: 30,  maxLon: 42  }, // Anatolia highlands / Pontic
  { minLat: 25, maxLat: 40, minLon: 44,  maxLon: 60  }, // Zagros + Alborz (Iran)
  { minLat: 12, maxLat: 28, minLon: 36,  maxLon: 46  }, // Ethiopian highlands
  // Europe
  { minLat: 43, maxLat: 48, minLon: 6,   maxLon: 14  }, // Alps
  { minLat: 40, maxLat: 46, minLon: -2,  maxLon: 12  }, // Pyrenees + Apennines
  { minLat: 41, maxLat: 45, minLon: 22,  maxLon: 30  }, // Balkan ranges
  { minLat: 60, maxLat: 71, minLon: 50,  maxLon: 70  }, // Urals
  { minLat: 60, maxLat: 70, minLon: 18,  maxLon: 32  }, // Scandinavian mtns
  { minLat: 42, maxLat: 46, minLon: 38,  maxLon: 50  }, // Caucasus
  // Africa
  { minLat: -5, maxLat: 5,  minLon: 28,  maxLon: 42  }, // East African rift
  { minLat: -35,maxLat: -20,minLon: 16,  maxLon: 30  }, // Drakensberg
  { minLat: 28, maxLat: 35, minLon: -4,  maxLon: 8   }, // Atlas
  // Americas
  { minLat: 35, maxLat: 65, minLon: -150,maxLon: -120}, // Rockies / Alaska range
  { minLat: 30, maxLat: 50, minLon: -125,maxLon: -110}, // Cascades / Sierra
  { minLat: -55,maxLat: 8,  minLon: -82, maxLon: -65 }, // Andes (long spine)
  { minLat: 15, maxLat: 22, minLon: -105,maxLon: -90 }, // Sierra Madre (Mexico)
  { minLat: 60, maxLat: 70, minLon: -145,maxLon: -120}, // Brooks / Yukon
  // Oceania
  { minLat: -40,maxLat: -25,minLon: 145, maxLon: 152 }, // Australian Alps
  { minLat: -47,maxLat: -40,minLon: 166, maxLon: 174 }, // NZ Southern Alps
];

const HIGHLAND_BOXES = [
  { minLat: 45, maxLat: 70, minLon: -180, maxLon: 180 }, // high-latitude subarctic plateaus
  { minLat: -90,maxLat: -55,minLon: -180, maxLon: 180 }, // Antarctica fringe
  { minLat: 28, maxLat: 45, minLon: 80,  maxLon: 125 }, // Inner Asia / Gobi steppe
  { minLat: 8,  maxLat: 18, minLon: -12, maxLon: 10  }, // Sahel transition
];

// ── Terrain byte → color. Defaults are an EXACT replica of OpenFront's
// encodeTerrainTile (ColorUtils.ts) with oceanColor #4785b5 from
// render-settings.json. A mutable OF_PALETTE + OF_USE_FLAT flag let the in-game
// dev panel override individual band colors (flat) in real time. Byte:
// bit7 isLand | bit6 isShoreline | bit5 isOcean | bits0-4 magnitude(0-31).
const OF_OCEAN = [71, 133, 181]; // OpenFront oceanColor #4785b5 (exact)
// Representative per-band colors (used when OF_USE_FLAT is on). Initialized to
// OpenFront's mid-band values so the dev picker shows sensible defaults.
const OF_PALETTE = {
  ocean:      [71, 133, 181],
  shoreWater: [100, 143, 255],
  sand:       [204, 203, 158],
  plains:     [190, 200, 138],
  highland:   [220, 203, 158],
  mountain:   [240, 240, 240],
};
const BIOME_BANDS = Object.keys(OF_PALETTE);
let OF_USE_FLAT = false; // true → flat per-band palette (dev overrides)
export function setBiomeFlatMode(on) { OF_USE_FLAT = !!on; }
export function setBiomeBandColor(band, rgb) { if (OF_PALETTE[band]) OF_PALETTE[band] = rgb; }
export function getBiomeBandColor(band) { return OF_PALETTE[band] ? OF_PALETTE[band].slice() : null; }
export function getBiomeBands() { return BIOME_BANDS.slice(); }
function ofTerrainColor(tb) {
  const isLand = (tb & 0x80) !== 0;
  const isShoreline = (tb & 0x40) !== 0;
  const magnitude = tb & 0x1f;
  // Determine band key first (reused by flat-palette overrides).
  let band;
  if (isLand && isShoreline) band = 'sand';
  else if (isLand) band = magnitude < 10 ? 'plains' : magnitude < 20 ? 'highland' : 'mountain';
  else if (isShoreline) band = 'shoreWater';
  else band = 'ocean';
  if (OF_USE_FLAT) return OF_PALETTE[band];
  let r, g, b;
  if (band === 'sand') {
    // Shore (sand)
    r = 204; g = 203; b = 158;
  } else if (band === 'plains') {
    // Plains
    r = 190; g = 220 - 2 * magnitude; b = 138;
  } else if (band === 'highland') {
    // Highland
    r = 200 + 2 * magnitude; g = 183 + 2 * magnitude; b = 138 + 2 * magnitude;
  } else if (band === 'mountain') {
    // Mountain
    const v = Math.min(255, 230 + Math.floor(magnitude / 2));
    r = v; g = v; b = v;
  } else if (band === 'shoreWater') {
    // Shoreline water
    r = 100; g = 143; b = 255;
  } else {
    // Deep water — darkens with depth (magnitude)
    const m = Math.min(magnitude, 10);
    r = Math.max(0, OF_OCEAN[0] - m);
    g = Math.max(0, OF_OCEAN[1] - m);
    b = Math.max(0, OF_OCEAN[2] - m);
  }
  return [r, g, b];
}

// ════════════════════════════════════════════════════════════════════
//  Small math helpers
// ════════════════════════════════════════════════════════════════════
function within(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function sigmoid(value, decayRate, midpoint) {
  return 1 / (1 + Math.exp(-decayRate * (value - midpoint)));
}

// ════════════════════════════════════════════════════════════════════
//  MinHeap — port of OpenFront FlatBinaryHeap (lowest priority dequeued first)
// ════════════════════════════════════════════════════════════════════
class MinHeap {
  constructor(capacity = 1024) {
    this.pri = new Float32Array(capacity);
    this.cells = new Int32Array(capacity);
    this.len = 0;
  }
  clear() { this.len = 0; }
  size() { return this.len; }

  _grow() {
    const cap = this.pri.length * 2;
    const np = new Float32Array(cap);
    const nc = new Int32Array(cap);
    np.set(this.pri); nc.set(this.cells);
    this.pri = np; this.cells = nc;
  }

  enqueue(cell, priority) {
    if (this.len === this.pri.length) this._grow();
    let i = this.len++;
    // sift-up
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (priority >= this.pri[parent]) break;
      this.pri[i] = this.pri[parent];
      this.cells[i] = this.cells[parent];
      i = parent;
    }
    this.pri[i] = priority;
    this.cells[i] = cell;
  }

  dequeue() {
    if (this.len === 0) return -1;
    const top = this.cells[0];
    const lastPri = this.pri[--this.len];
    const lastCell = this.cells[this.len];
    let i = 0;
    // sift-down
    while (true) {
      const left = (i << 1) + 1;
      if (left >= this.len) break;
      const right = left + 1;
      let smallest = left;
      if (right < this.len && this.pri[right] < this.pri[left]) smallest = right;
      if (lastPri <= this.pri[smallest]) break;
      this.pri[i] = this.pri[smallest];
      this.cells[i] = this.cells[smallest];
      i = smallest;
    }
    this.pri[i] = lastPri;
    this.cells[i] = lastCell;
    return top;
  }
}

// ════════════════════════════════════════════════════════════════════
//  CONQUEST GRID
//  Owns: land mask, terrain, per-cell owner. Decoupled from rendering.
// ════════════════════════════════════════════════════════════════════
export class ConquestGrid {
  constructor(cfg = CONQUEST_CFG) {
    this.cfg = cfg;
    const N = cfg.GRID_W * cfg.GRID_H;
    this.owner = new Uint8Array(N);      // WATER/NEUTRAL/PLAYER/ENEMY
    this.terrain = new Uint8Array(N);    // T_WATER/T_PLAINS/T_HIGHLAND/T_MOUNTAIN (gameplay)
    this.terrainByte = new Uint8Array(N); // raw OpenFront terrain byte per cell (visual source)
    this._counts = { player: 0, enemy: 0, neutral: 0 };

    // Render surface: a small canvas at grid resolution, upscaled by the caller.
    this.gridCanvas = document.createElement('canvas');
    this.gridCanvas.width = cfg.GRID_W;
    this.gridCanvas.height = cfg.GRID_H;
    this.gridCtx = this.gridCanvas.getContext('2d');
    this.gridImage = this.gridCtx.createImageData(cfg.GRID_W, cfg.GRID_H);
    this._dirty = true;                  // full repaint needed
    this._dirtyCells = new Set();        // incremental: cell indices changed
    this._borderCells = new Set();       // cells currently drawn as territory borders
    // TASK-506 OPTIMIZE: scratch buffers reused across incremental flushes
    // (the flush path runs on every conquest tick — the old code allocated a
    // fresh Set + Array per call; classic churn at 10 ticks/s × N attacks).
    this._recheckScratch = new Set();
    this._nbScratch = new Int32Array(4);
    this._countsOther = new Map();        // bot owner code → owned cell count (O(1) countCells)
    this._devastation = new Float32Array(cfg.GRID_W * cfg.GRID_H);  // TASK-102 blast-weakening layer
    this._devCursor = 0;                  // rotating decay cursor (legacy, kept for API compat)
    // TASK-506: live-devastation set — decay iterates ONLY these cells
    // (blasts are sparse; the old full-grid rotating sweep never revisited a
    // cell often enough for the decay constant to matter).
    this._devSet = new Set();

    // TASK-406: devastation VISUAL layer — a second canvas painted with a
    // scorched tint whose alpha follows the logical devastation value and
    // fades with the same decay (bucketed so decay only repaints on change).
    this.devCanvas = document.createElement('canvas');
    this.devCanvas.width = cfg.GRID_W;
    this.devCanvas.height = cfg.GRID_H;
    this.devCtx = this.devCanvas.getContext('2d');
    this.devImage = this.devCtx.createImageData(cfg.GRID_W, cfg.GRID_H);
    this._devBuckets = new Uint8Array(N); // quantized 0..LEVELS-1 alpha bucket per cell
    this._devDirty = new Set();           // cells whose bucket changed since last flush

    // TASK-406: shared dirty-region queue — territory overlay uploads can blit
    // just the changed sub-rect instead of the whole 7200×3600 canvas.
    //   undefined = nothing pending · null = full repaint pending · {x,y,w,h} = union rect
    this._ovRect = undefined;
    this._lastFlush = { full: false, rect: null };

    // TASK-406 follow-up (over-watered coasts): GeoJSON inside-polygon ref
    // (1 = cell center is inside a country polygon). When set, dilateWater
    // only lets INTERIOR water (rivers/lakes/canals) push banks outward —
    // ocean/strait water never dilates, so coastlines keep their true width.
    this._geoLand = null;
    // TASK-506: how the LAST dilation ran — 'none' | 'blanket' | 'geo'.
    // A blanket dilation (GeoJSON arrived after grid init) can be safely
    // REDONE geo-gated by a late setGeoLandRef call — but only while no
    // cell is owned yet (pre-spawn); once territory exists the mask is
    // frozen (a rebuild would wipe every player/bot cell).
    this._dilateState = 'none';

    // TASK-406: frontline heat — cells involved in recent ownership flips
    // (the active frontline glows; ages out after HEAT_AGE_MS).
    this._heat = new Map();               // cell → performance.now() stamp

    // Biome canvas: the globe's LAND surface, painted tile-by-tile from terrainByte[]
    // (one pixel per cell). This REPLACES the old static photo texture — same resolution
    // as the territory overlay, so it is crisp at max zoom. Painted once at init.
    this.biomeCanvas = document.createElement('canvas');
    this.biomeCanvas.width = cfg.GRID_W;
    this.biomeCanvas.height = cfg.GRID_H;
    this.biomeCtx = this.biomeCanvas.getContext('2d');
    this.biomeImage = this.biomeCtx.createImageData(cfg.GRID_W, cfg.GRID_H);
    this._biomePainted = false;
  }

  // Rasterize a real-world land-cover equirectangular image, then COLOR-QUANTIZE each
  // pixel into a flat solid palette color. This converts the photo into a clean
  // OpenFront-style flat map that still follows REAL biome shapes (Sahara=tan,
  // Amazon=green, Greenland=white) — not a blurry photo, not blocky cells.
  setLandCoverImage(img) {
    const cfg = this.cfg;
    const W = cfg.GRID_W, H = cfg.GRID_H;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;   // smooth downscale first
    tctx.drawImage(img, 0, 0, W, H);
    const src = tctx.getImageData(0, 0, W, H).data;

    // Flat palette (RGBA) — the only colors the map will use.
    const P = {
      DEEP:    [24, 52, 100, 255],
      WATER:   [46, 96, 156, 255],
      DESERT:  [206, 186, 132, 255],
      PLAINS:  [106, 156, 86, 255],
      FOREST:  [74, 124, 64, 255],
      MOUNTAIN:[126, 106, 86, 255],
      SNOW:    [232, 236, 240, 255],
    };

    // Classify one pixel → flat palette color.
    const classify = (r, g, b) => {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      // 1. Water: blue is the dominant channel
      if (b >= r && b >= g) return lum < 80 ? P.DEEP : P.WATER;
      // 2. Snow / ice: very bright + low saturation
      if (lum > 200 && sat < 0.30) return P.SNOW;
      // 3. Desert: bright, warm (r >= g >= b), low-moderate saturation
      if (lum > 150 && r >= g && sat < 0.45) return P.DESERT;
      // 4. Mountain / barren: dark, warm brown
      if (lum < 105 && r >= g && g >= b) return P.MOUNTAIN;
      // 5. Forest: green-dominant + dark
      if (g > r && g > b && lum < 120) return P.FOREST;
      // 6. Default: plains (vegetation green)
      return P.PLAINS;
    };

    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const c = classify(src[i], src[i + 1], src[i + 2]);
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
    this.landBase = out;
    this._dirty = true;                  // force a full repaint with the flat base
  }

  // ── coordinate conversion ──
  latLonToCell(lat, lon) {
    const cfg = this.cfg;
    // normalize longitude to [-180,180)
    let l = lon;
    l = ((l + 180) % 360 + 360) % 360 - 180;
    const col = Math.min(cfg.GRID_W - 1, Math.max(0, Math.floor((l + 180) / cfg.CELL_DEG)));
    const la = Math.min(90, Math.max(-90, lat));
    const row = Math.min(cfg.GRID_H - 1, Math.max(0, Math.floor((90 - la) / cfg.CELL_DEG)));
    return row * cfg.GRID_W + col;
  }
  cellToLatLon(cell) {
    const cfg = this.cfg;
    const col = cell % cfg.GRID_W;
    const row = (cell / cfg.GRID_W) | 0;
    return {
      lon: -180 + (col + 0.5) * cfg.CELL_DEG,
      lat: 90 - (row + 0.5) * cfg.CELL_DEG,
    };
  }
  cellColRow(cell) {
    const cfg = this.cfg;
    return { col: cell % cfg.GRID_W, row: (cell / cfg.GRID_W) | 0 };
  }

  // ── Frontier edges as lat/lon segments for crisp VECTOR border lines ──
  // Returns { segs:Number[], own:Number[] }: each edge is 4 consecutive numbers in
  // `segs` (lat1, lon1, lat2, lon2); `own[i]` is the owner code (PLAYER/ENEMY) of the
  // owned cell that border belongs to. An edge is emitted for EVERY pair of adjacent
  // cells with different owners, so this outlines each owned region against water,
  // neutral land, and the opposing side. main.js turns these into 3D LineSegments on
  // the sphere — razor-sharp at any zoom (like the 3D buildings), unlike texture borders.
  getFrontierEdges() {
    const cfg = this.cfg;
    const W = cfg.GRID_W, H = cfg.GRID_H, D = cfg.CELL_DEG;
    const owner = this.owner;
    if (!this._feSegs) { this._feSegs = []; this._feOwn = []; this._feSeen = new Set(); }
    const segs = this._feSegs, own = this._feOwn, seen = this._feSeen;
    segs.length = 0; own.length = 0; seen.clear();
    for (const cell of this._borderCells) {
      const col = cell % W;
      const row = (cell / W) | 0;
      const o = owner[cell];
      const wLon = -180 + col * D;
      const eLon = wLon + D;
      const nLat = 90 - row * D;
      const sLat = nLat - D;
      // east neighbour (longitude wraps)
      const eCell = row * W + (col < W - 1 ? col + 1 : 0);
      if (owner[eCell] !== o) this._fePush(segs, own, seen, cell, eCell, o, nLat, eLon, sLat, eLon);
      // west neighbour (longitude wraps)
      const wCell = row * W + (col > 0 ? col - 1 : W - 1);
      if (owner[wCell] !== o) this._fePush(segs, own, seen, cell, wCell, o, nLat, wLon, sLat, wLon);
      // north neighbour (latitude clamps at pole)
      if (row > 0 && owner[cell - W] !== o) this._fePush(segs, own, seen, cell, cell - W, o, nLat, wLon, nLat, eLon);
      // south neighbour (latitude clamps at pole)
      if (row < H - 1 && owner[cell + W] !== o) this._fePush(segs, own, seen, cell, cell + W, o, sLat, wLon, sLat, eLon);
    }
    return { segs, own };
  }
  // Dedupe: a player↔enemy edge is reachable from both cells; emit it once.
  // NUMERIC key (a*N + b, N = 25.9M cells → max ~6.7e14 < 2^53): avoids one string
  // allocation + 2 Set ops on strings per candidate edge on every frontier rebuild.
  _fePush(segs, own, seen, a, b, o, lat1, lon1, lat2, lon2) {
    const N = this.cfg.GRID_W * this.cfg.GRID_H;
    const key = a < b ? a * N + b : b * N + a;
    if (seen.has(key)) return;
    seen.add(key);
    segs.push(lat1, lon1, lat2, lon2);
    own.push(o);
  }

  // ── neighbors (4-connected, longitude wraps, latitude clamps at poles) ──
  neighbors4(cell, out) {
    const cfg = this.cfg;
    const col = cell % cfg.GRID_W;
    const row = (cell / cfg.GRID_W) | 0;
    let n = 0;
    if (row > 0)              out[n++] = cell - cfg.GRID_W;          // north
    if (row < cfg.GRID_H - 1) out[n++] = cell + cfg.GRID_W;          // south
    out[n++] = row * cfg.GRID_W + (col > 0 ? col - 1 : cfg.GRID_W - 1); // west (wrap)
    out[n++] = row * cfg.GRID_W + (col < cfg.GRID_W - 1 ? col + 1 : 0); // east (wrap)
    return n;
  }

  // ── land mask: caller passes ImageData (RGBA) of a filled land raster ──
  buildLandMaskFromImageData(imgData) {
    const cfg = this.cfg;
    const d = imgData.data;
    // imgData is expected at GRID_W x GRID_H (1px == 1 cell)
    for (let i = 0; i < this.owner.length; i++) {
      const a = d[i * 4 + 3];
      if (a > 40) {
        this.owner[i] = cfg.NEUTRAL;
        this._counts.neutral++;
      } else {
        this.owner[i] = cfg.WATER;
      }
    }
    this.buildTerrainHeuristic();
    this._dirty = true;
  }

  // ── fallback land mask: test each cell's centre against GeoJSON features via d3.geoContains ──
  buildLandMaskFromGeoContains(features) {
    const cfg = this.cfg;
    const W = cfg.GRID_W, H = cfg.GRID_H;
    const d3ref = (typeof d3 !== 'undefined') ? d3 : (typeof window !== 'undefined' ? window.d3 : null);
    if (!d3ref || !d3ref.geoContains) return;
    // Pre-compute bounding boxes for fast rejection
    const bboxes = features.map(f => {
      try { const b = d3ref.geoBounds(f); return [[b[0][0], b[0][1]], [b[1][0], b[1][1]]]; }
      catch (e) { return null; }
    });
    for (let row = 0; row < H; row++) {
      const lat = 90 - (row + 0.5) * cfg.CELL_DEG;
      const rowStart = row * W;
      for (let col = 0; col < W; col++) {
        const cell = rowStart + col;
        if (this.owner[cell] === cfg.NEUTRAL) continue; // already land
        const lon = -180 + (col + 0.5) * cfg.CELL_DEG;
        // Quick bounding-box pre-filter
        for (let fi = 0; fi < features.length; fi++) {
          const bb = bboxes[fi];
          if (!bb) continue;
          if (lon < bb[0][0] || lon > bb[1][0] || lat < bb[0][1] || lat > bb[1][1]) continue;
          // Precise point-in-polygon test
          if (d3ref.geoContains(features[fi], [lon, lat])) {
            this.owner[cell] = cfg.NEUTRAL;
            this._counts.neutral++;
            break;
          }
        }
      }
    }
    this.buildTerrainHeuristic();
    this._dirty = true;
  }

  // ── Load corrected OpenFront terrain binary (equirectangular) into terrainByte[] ──
  // srcW×srcH is the binary's pixel dims (e.g. 4108×1948). Both source and grid are
  // equirectangular, so each grid cell maps linearly to a source pixel by lat/lon.
  // This is the SINGLE SOURCE OF TRUTH for both the land mask and the biome colors.
  loadTerrainFromBin(uint8, srcW, srcH) {
    const cfg = this.cfg;
    const W = cfg.GRID_W, H = cfg.GRID_H;
    const sx = srcW / W;   // source px per grid cell (longitude)
    const sy = srcH / H;   // source px per grid cell (latitude)
    const tb = this.terrainByte;
    for (let row = 0; row < H; row++) {
      const srcRow = Math.min(srcH - 1, ((row + 0.5) * sy) | 0);
      const srcRowBase = srcRow * srcW;
      const rowBase = row * W;
      for (let col = 0; col < W; col++) {
        const srcCol = ((col + 0.5) * sx) | 0;   // longitude wraps naturally (0..srcW-1)
        tb[rowBase + col] = uint8[srcRowBase + srcCol];
      }
    }
  }

  // ── land mask FROM the terrain byte (bit7 = isLand). Replaces GeoJSON rasterization. ──
  // Now the conquerable land is EXACTLY the visible land — one grid, perfectly synced.
  // rebuildTerrain=false skips buildTerrainHeuristic (26M-cell recompute) when the
  // caller KNOWS this.terrain[] is already valid for this terrainByte (e.g. the
  // TASK-506 geoLand late-load re-apply — identical inputs, identical output).
  buildLandMaskFromTerrain(rebuildTerrain = true) {
    const cfg = this.cfg;
    this._counts.neutral = 0;
    const tb = this.terrainByte, owner = this.owner;
    for (let cell = 0; cell < owner.length; cell++) {
      if ((tb[cell] & 0x80) !== 0) {       // bit7 set → land
        owner[cell] = cfg.NEUTRAL;
        this._counts.neutral++;
      } else {
        owner[cell] = cfg.WATER;
      }
    }
    if (rebuildTerrain) this.buildTerrainHeuristic();
    this._dirty = true;
  }

  // ── Water dilation: thicken rivers/lakes so they read + navigate at grid res. ──
  // Morphological dilation of water cells. For each ring iteration, a LAND cell
  // becomes WATER if it has ≥ minNeighbors water neighbours (8-connected).
  //   rings=0           → no change
  //   rings=1, min=1    → +1 cell around every eligible water feature (rivers → 3 wide)
  //   rings=1, min=2    → only cells touching water on 2+ sides (gentler coasts)
  // TASK-406 follow-up (over-watered coasts): when a GeoJSON land reference is
  // set (setGeoLandRef), only water cells INSIDE country polygons (rivers,
  // lakes, canals — geo 1) push their banks outward. Ocean/sea cells (geo 0)
  // never dilate, so coastlines and straits keep their true width — the old
  // blanket dilation eroded EVERY coast by one cell (~5.5km) and pushed the
  // major straits (Dover 34km, Gibraltar 14km) past the armor wade threshold
  // (GAME_CONSTANTS.TANK_RIVER_PROBE_KM = 48km), making them un-crossable.
  // Without a reference the behaviour is unchanged (blanket dilation).
  // Longitude wraps; latitude clamps at poles. Recounts neutral cells after.
  dilateWater(rings = 1, minNeighbors = 1) {
    if (rings <= 0) return;
    const cfg = this.cfg;
    const W = cfg.GRID_W, H = cfg.GRID_H, WATER = cfg.WATER, NEUTRAL = cfg.NEUTRAL;
    const owner = this.owner;
    const geo = this._geoLand || null;     // null → legacy blanket dilation
    for (let ring = 0; ring < rings; ring++) {
      const snap = owner.slice();          // snapshot — avoid in-place cascade
      for (let row = 0; row < H; row++) {
        const rowBase = row * W;
        for (let col = 0; col < W; col++) {
          const cell = rowBase + col;
          if (snap[cell] === WATER) continue;          // already water
          let wn = 0;                                   // water-neighbour count
          for (let dy = -1; dy <= 1; dy++) {
            const nr = row + dy;
            if (nr < 0 || nr >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nc = (((col + dx) % W) + W) % W;   // longitude wraps
              const ncell = nr * W + nc;
              // geo-gated: interior water (rivers) counts, ocean does not
              if (snap[ncell] === WATER && (!geo || geo[ncell] === 1)) wn++;
            }
          }
          if (wn >= minNeighbors) owner[cell] = WATER;  // convert land → water
        }
      }
    }
    // Recount neutral land cells (dilation removed some).
    let n = 0;
    for (let i = 0; i < owner.length; i++) if (owner[i] === NEUTRAL) n++;
    this._counts.neutral = n;
    this._dilateState = geo ? 'geo' : 'blanket';
    this._dirty = true;
  }

  // ── TASK-406 follow-up: GeoJSON inside-polygon reference for dilateWater. ──
  // u8: Uint8Array(W*H), 1 = cell center inside a country polygon. Passing
  // null/undefined clears it (dilation returns to blanket mode).
  //
  // TASK-506 LATE-LOAD RE-APPLY: if the grid was dilated BLANKET (GeoJSON
  // had not arrived within initConquestGrid's bounded wait) and this is the
  // FIRST valid ref, the mask is rebuilt geo-gated — but ONLY while zero
  // cells are owned (pre-spawn). Rebuilding re-runs buildLandMaskFromTerrain
  // + dilateWater + the biome repaint; everything downstream (overlay full
  // repaint via _dirty, frontier rebuild, coarse water mask via the caller)
  // picks the corrected coasts up on the next frame. Once any side owns
  // territory the fallback is FINAL and precisely documented: blanket coasts
  // (~5.5km erosion, wide straits) stay for the whole game — a mid-game
  // rebuild would wipe ownership, so it must never fire.
  // Returns true when a re-apply actually happened (caller may rebuild
  // derived caches); false otherwise.
  setGeoLandRef(u8) {
    const valid = (u8 && u8.length === this.cfg.GRID_W * this.cfg.GRID_H) ? u8 : null;
    const isFirstRef = valid && !this._geoLand;
    this._geoLand = valid;
    if (!isFirstRef || this._dilateState !== 'blanket') return false;
    const owned =
      (this._counts.player || 0) + (this._counts.enemy || 0) +
      (this._countsOther ? Array.from(this._countsOther.values()).reduce((a, b) => a + b, 0) : 0);
    if (owned > 0) {
      // Game already underway on a blanket mask — document precisely and keep it.
      console.warn('[CONQUEST] geoLand ref arrived AFTER spawn on a blanket-dilated mask — ' +
        'keeping blanket coasts for this game (a rebuild would wipe territory). ' +
        'Next game initializes geo-gated if GeoJSON loads in time.');
      return false;
    }
    // Safe pre-spawn re-apply: terrain → mask → coast repair → geo-gated
    // dilation → biome repaint (terrain heuristic already valid — same
    // terrainByte, skip the 26M-cell recompute).
    this.buildLandMaskFromTerrain(false);
    this.repairCoastFromGeoRef();
    this.dilateWater(this.cfg.WATER_DILATION_RINGS, this.cfg.WATER_DILATION_MIN_NEIGHBORS);
    this.paintBiomeBase();
    console.log('[CONQUEST] geoLand late-load: mask re-applied geo-gated (coasts/straits restored to true width)');
    return true;
  }

  // ── TASK-506: geo-referenced COAST REPAIR (see cfg.COAST_REPAIR_* docs) ──
  // Restores land the terrain binary over-waters INSIDE country polygons
  // (missing Kent peninsula, Spain's south coast), leaving rivers (hug
  // binary land), lakes (deep inside polygons) and the ocean untouched.
  // Returns the number of cells repaired (0 when no geo ref is set).
  // Call AFTER the land mask is built and the geo ref is set, BEFORE
  // dilateWater/paintBiomeBase (repaired cells get tb=0xC0 → sand shore).
  repairCoastFromGeoRef() {
    if (!this._geoLand) return 0;
    const cfg = this.cfg;
    const W = cfg.GRID_W, H = cfg.GRID_H, WATER = cfg.WATER, NEUTRAL = cfg.NEUTRAL;
    const geo = this._geoLand, owner = this.owner, tb = this.terrainByte;
    const MIN_IN = cfg.COAST_REPAIR_MIN_INLAND, MAX_EDGE = cfg.COAST_REPAIR_MAX_GEO_EDGE;
    const isLandT = (r, c) => (tb[r * W + (((c % W) + W) % W)] & 0x80) !== 0;
    const isGeoOut = (r, c) => { const cc = ((c % W) + W) % W; return !geo[r * W + cc]; };
    // Phase 1 — collect candidates (read-only: writes mid-scan would turn
    // repaired cells into "binary land" and suppress their neighbours —
    // the first version left a comb pattern of un-repaired stripes).
    // Two defect classes share the coastal-band gate:
    //   class 1 — thick missing chunks (Kent): no binary land within MIN_IN
    //             cells → not a river bank / shore hugging land;
    //   class 2 — plain-OCEAN bytes (bit5, no land/shore flags) inside the
    //             polygon (Spain's south coast band): the binary drew open
    //             ocean where the polygon says land. River mouths carry the
    //             shoreline flag (0xC0-0xC2) and are never touched.
    const cand = [];
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const cell = row * W + col;
        if (owner[cell] !== WATER || !geo[cell]) continue;   // only polygon-interior water
        const tbv = tb[cell];
        const plainOcean = (tbv & 0x80) === 0 && (tbv & 0x40) === 0 && (tbv & 0x20) !== 0;
        if (!plainOcean) {
          // gate 1: no binary land within MIN_IN cells (Chebyshev) → not a river bank
          let nearLand = false;
          for (let dy = -MIN_IN; dy <= MIN_IN && !nearLand; dy++) {
            const nr = row + dy;
            if (nr < 0 || nr >= H) continue;
            for (let dx = -MIN_IN; dx <= MIN_IN; dx++) {
              if (isLandT(nr, col + dx)) { nearLand = true; break; }
            }
          }
          if (nearLand) continue;
        }
        // gate 2: a geo=0 (outside-polygon) cell within MAX_EDGE rings → coastal band
        let coastal = false;
        for (let rr = 1; rr <= MAX_EDGE && !coastal; rr++) {
          for (let dy = -rr; dy <= rr && !coastal; dy++) {
            const nr = row + dy;
            if (nr < 0 || nr >= H) continue;
            for (let dx = -rr; dx <= rr; dx++) {
              if (Math.max(Math.abs(dy), Math.abs(dx)) !== rr) continue;   // ring cells only
              if (isGeoOut(nr, col + dx)) { coastal = true; break; }
            }
          }
        }
        if (!coastal) continue;   // inland sea / lake — keep as water
        cand.push(cell);
      }
    }
    // Phase 2 — apply all writes after the scan.
    for (const cell of cand) {
      owner[cell] = NEUTRAL;
      tb[cell] = 0xC0;          // land + shoreline → paints as sand
    }
    if (cand.length > 0) {
      let n = 0;
      for (let i = 0; i < owner.length; i++) if (owner[i] === NEUTRAL) n++;
      this._counts.neutral = n;
      this._dirty = true;
    }
    return cand.length;
  }

  // ── Paint the biome base canvas tile-by-tile from terrainByte[] via ofTerrainColor(). ──
  // One pixel per cell (7200×3600), NearestFilter upscaled by the caller → crisp at max zoom.
  // This REPLACES the old static photo texture. Called once at init.
  paintBiomeBase() {
    const data = this.biomeImage.data;
    const tb = this.terrainByte;
    const owner = this.owner;
    const WATERC = this.cfg.WATER;
    for (let cell = 0; cell < tb.length; cell++) {
      // Paint water where the CONQUERABLE mask (post water-dilation) says water,
      // not where the raw terrain byte says land. The visible coastline must
      // EQUAL the conquerable coastline — otherwise the mask is one cell (~5.5km)
      // smaller than what's on screen and coastal clicks silently no-op.
      const c = owner[cell] === WATERC ? OF_OCEAN : ofTerrainColor(tb[cell]);
      const i = cell * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
    this.biomeCtx.putImageData(this.biomeImage, 0, 0);
    this._biomePainted = true;
  }

  // ── TASK-406: INCREMENTAL biome painter — repaint just the given cells into
  // the biome canvas (the biome side of the shared dirty-region queue: water
  // dilation + editor edits no longer need a full 26M-cell repaint).
  paintBiomeCells(cells) {
    if (!cells || cells.length === 0) return;
    const cfg = this.cfg;
    const W = cfg.GRID_W;
    const data = this.biomeImage.data;
    const tb = this.terrainByte, owner = this.owner;
    const WATERC = cfg.WATER;
    let minC = W, minR = cfg.GRID_H, maxC = -1, maxR = -1;
    for (const cell of cells) {
      const c = owner[cell] === WATERC ? OF_OCEAN : ofTerrainColor(tb[cell]);
      const i = cell * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
      const col = cell % W, row = (cell / W) | 0;
      if (col < minC) minC = col;
      if (col > maxC) maxC = col;
      if (row < minR) minR = row;
      if (row > maxR) maxR = row;
    }
    this.biomeCtx.putImageData(this.biomeImage, 0, 0, minC, minR, maxC - minC + 1, maxR - minR + 1);
    this._biomePainted = true;
  }

  // ── Fallback biome painter: used only when the OpenFront binary is unavailable. ──
  // Paints from the latitude/terrain heuristic (this.terrain[] + owner[]) using the
  // flat COLOR palette, so the globe still gets a clean land surface.
  paintBiomeFallback() {
    const cfg = this.cfg;
    const data = this.biomeImage.data;
    const owner = this.owner, terrain = this.terrain;
    const SNOW = cfg.SNOW_LAT, DMIN = cfg.DESERT_MIN_LAT, DMAX = cfg.DESERT_MAX_LAT;
    const C = cfg.COLOR;
    for (let cell = 0; cell < owner.length; cell++) {
      let c;
      if (owner[cell] === cfg.WATER) {
        c = C.water;
      } else {
        const lat = 90 - ((cell / cfg.GRID_W | 0) + 0.5) * cfg.CELL_DEG;
        const t = terrain[cell];
        const al = lat < 0 ? -lat : lat;
        if (al > SNOW) c = C.snow;
        else if (t === cfg.T_MOUNTAIN) c = C.mountain;
        else if (t === cfg.T_HIGHLAND) c = C.highland;
        else if (al >= DMIN && al <= DMAX) c = C.desert;
        else c = C.plains;
      }
      const i = cell * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
    this.biomeCtx.putImageData(this.biomeImage, 0, 0);
    this._biomePainted = true;
  }

  // ── terrain heuristic from latitude bands + known ranges ──
  buildTerrainHeuristic() {
    const cfg = this.cfg;
    for (let cell = 0; cell < this.owner.length; cell++) {
      if (this.owner[cell] === cfg.WATER) {
        this.terrain[cell] = cfg.T_WATER;
        continue;
      }
      const { lat, lon } = this.cellToLatLon(cell);
      let t = cfg.T_PLAINS;
      // mountain check first
      for (const r of MOUNTAIN_RANGES) {
        if (lat >= r.minLat && lat <= r.maxLat && lon >= r.minLon && lon <= r.maxLon) {
          t = cfg.T_MOUNTAIN; break;
        }
      }
      if (t !== cfg.T_MOUNTAIN) {
        for (const r of HIGHLAND_BOXES) {
          if (lat >= r.minLat && lat <= r.maxLat && lon >= r.minLon && lon <= r.maxLon) {
            t = cfg.T_HIGHLAND; break;
          }
        }
      }
      this.terrain[cell] = t;
    }
  }

  // ── ownership queries ──
  ownerCodeAtCell(cell) { return this.owner[cell]; }
  ownerCodeAt(lat, lon) { return this.owner[this.latLonToCell(lat, lon)]; }
  ownerAt(lat, lon) {
    const code = this.owner[this.latLonToCell(lat, lon)];
    if (code === this.cfg.WATER) return 'water'; // distinct from neutral LAND
    return CODE_TO_STR[code] || 'neutral';
  }
  isLandCell(cell) { return this.owner[cell] !== this.cfg.WATER; }
  terrainAtCell(cell) { return this.terrain[cell]; }

  countCells(ownerStr) {
    // Player/enemy/neutral: incremental counters. Bots (codes 4+): incremental
    // Map maintained in conquerCell — O(1). (The previous lazy FULL-GRID scan
    // ran 26M iterations per call, and countCells is hit from troop growth,
    // HUD, leaderboard, AI and win checks — billions of iterations/sec with bots.)
    if (this._counts[ownerStr] != null) return this._counts[ownerStr];
    const code = STR_TO_CODE[ownerStr];
    if (!code || code <= 3) return 0;
    return this._countsOther.get(code) || 0;
  }

  // Find the nearest cell owned by `ownerStr` to a given lat/lon.
  // Uses an expanding-ring BFS from the target cell. Returns { cell, lat, lon } or null.
  // Searches up to maxRing cells outward (default ~50 cells ≈ 2750 km at equator).
  findNearestOwnedCell(lat, lon, ownerStr, maxRing = 120) {
    const cfg = this.cfg;
    const ownerCode = STR_TO_CODE[ownerStr];
    if (!ownerCode) return null;
    const startCell = this.latLonToCell(lat, lon);
    if (this.owner[startCell] === ownerCode) {
      const ll = this.cellToLatLon(startCell);
      return { cell: startCell, lat: ll.lat, lon: ll.lon };
    }
    const nbuf = new Int32Array(4);
    const seen = new Set([startCell]);
    let ring = [startCell];
    for (let r = 0; r < maxRing && ring.length; r++) {
      const next = [];
      for (const cell of ring) {
        const n = this.neighbors4(cell, nbuf);
        for (let i = 0; i < n; i++) {
          const nb = nbuf[i];
          if (seen.has(nb)) continue;
          seen.add(nb);
          if (this.owner[nb] === ownerCode) {
            const ll = this.cellToLatLon(nb);
            return { cell: nb, lat: ll.lat, lon: ll.lon };
          }
          if (this.owner[nb] !== cfg.WATER) next.push(nb);
        }
      }
      ring = next;
    }
    return null;
  }

  // Find a border cell owned by `attackerStr` that borders a non-attacker land cell.
  // Prefers a neighbor owned by `preferStr` (e.g. 'player'); falls back to any other land.
  // Returns { srcCell, dstCell, target } or null.
  // PRIMARY: iterate _borderCells (small, always current — reliable even for
  // tiny empires). FALLBACK: random sampling for huge empires where the border
  // set is large anyway.
  findFrontlineTarget(attackerStr, preferStr) {
    const cfg = this.cfg;
    const attCode = STR_TO_CODE[attackerStr];
    const preferCode = STR_TO_CODE[preferStr];
    const nbuf = new Int32Array(4);
    // ── Primary: border-set scan ──
    if (this._borderCells && this._borderCells.size > 0) {
      // Collect matching candidates (up to 64) then pick one at random
      const cands = [];
      for (const cell of this._borderCells) {
        if (this.owner[cell] !== attCode) continue;
        cands.push(cell);
        if (cands.length >= 64) break;
      }
      if (cands.length > 0) {
        for (let t = 0; t < 8; t++) {
          const cell = cands[(Math.random() * cands.length) | 0];
          const n = this.neighbors4(cell, nbuf);
          let fallbackDst = -1, fallbackTarget = null;
          for (let i = 0; i < n; i++) {
            const nb = nbuf[i];
            const o = this.owner[nb];
            if (o === cfg.WATER || o === attCode) continue;
            if (o === preferCode) return { srcCell: cell, dstCell: nb, target: preferStr };
            if (fallbackDst < 0) { fallbackDst = nb; fallbackTarget = CODE_TO_STR[o]; }
          }
          if (fallbackDst >= 0) return { srcCell: cell, dstCell: fallbackDst, target: fallbackTarget };
        }
      }
    }
    // ── Fallback: random sampling (original approach) ──
    const total = this.owner.length;
    for (let attempt = 0; attempt < 4000; attempt++) {
      const cell = (Math.random() * total) | 0;
      if (this.owner[cell] !== attCode) continue;
      const n = this.neighbors4(cell, nbuf);
      let fallbackDst = -1, fallbackTarget = null;
      for (let i = 0; i < n; i++) {
        const nb = nbuf[i];
        const o = this.owner[nb];
        if (o === cfg.WATER || o === attCode) continue;
        if (o === preferCode) {
          return { srcCell: cell, dstCell: nb, target: preferStr };
        }
        if (fallbackDst < 0) { fallbackDst = nb; fallbackTarget = CODE_TO_STR[o]; }
      }
      if (fallbackDst >= 0) {
        return { srcCell: cell, dstCell: fallbackDst, target: fallbackTarget };
      }
    }
    return null;
  }

  // ── find nearest NEUTRAL (land) cell to a lat/lon, traversing water if needed ──
  findNearestLandCell(lat, lon, maxRing = 60) {
    const cfg = this.cfg;
    const startCell = this.latLonToCell(lat, lon);
    if (this.owner[startCell] !== cfg.WATER) {
      const ll = this.cellToLatLon(startCell);
      return { cell: startCell, lat: ll.lat, lon: ll.lon };
    }
    const nbuf = new Int32Array(4);
    const seen = new Set([startCell]);
    let ring = [startCell];
    for (let r = 0; r < maxRing && ring.length; r++) {
      const next = [];
      for (const cell of ring) {
        const n = this.neighbors4(cell, nbuf);
        for (let i = 0; i < n; i++) {
          const nb = nbuf[i];
          if (seen.has(nb)) continue;
          seen.add(nb);
          if (this.owner[nb] !== cfg.WATER) {
            const ll = this.cellToLatLon(nb);
            return { cell: nb, lat: ll.lat, lon: ll.lon };
          }
          next.push(nb); // traverse through water to reach land
        }
      }
      ring = next;
    }
    return null;
  }

    // ── change ownership of one cell (updates counts + render dirty) ──
  conquerCell(cell, newOwnerStr) {
    const cfg = this.cfg;
    const newCode = STR_TO_CODE[newOwnerStr];
    const old = this.owner[cell];
    if (old === newCode) return false;
    if (old === cfg.WATER) return false;          // can't conquer ocean
    this.owner[cell] = newCode;
    // Occupation resets devastation (the new owner garrisons + repairs) —
    // BOTH the logical value and the visual scorch pixel (TASK-506: the old
    // code zeroed the value but never touched the bucket/dirty set, so a
    // captured land kept its scorch overlay forever).
    if (this._devastation && this._devastation[cell] > 0) {
      this._devastation[cell] = 0;
      this._devSet.delete(cell);
      if (this._devBuckets[cell] !== 0) {
        this._devBuckets[cell] = 0;
        this._devDirty.add(cell);
      }
    }
    // adjust counts (ALL owners — bots live in _countsOther for O(1) reads)
    if (old === cfg.PLAYER) this._counts.player--;
    else if (old === cfg.ENEMY) this._counts.enemy--;
    else if (old === cfg.NEUTRAL) this._counts.neutral--;
    else if (old > 3) this._countsOther.set(old, (this._countsOther.get(old) || 0) - 1);
    if (newCode === cfg.PLAYER) this._counts.player++;
    else if (newCode === cfg.ENEMY) this._counts.enemy++;
    else if (newCode === cfg.NEUTRAL) this._counts.neutral++;
    else if (newCode > 3) this._countsOther.set(newCode, (this._countsOther.get(newCode) || 0) + 1);
    this._dirtyCells.add(cell);
    // TASK-406: stamp the frontline heat map (cap guards mass flips — e.g.
    // eliminations repaint a whole empire in one tick).
    if (this._heat.size < cfg.HEAT_MAX_CELLS) this._heat.set(cell, performance.now());
    return true;
  }

  // ── TASK-406: frontline HEAT edges — vector segments around cells involved
  // in recent ownership flips. Same edge geometry as getFrontierEdges but only
  // for the ACTIVE frontline (recently fought-over cells), so the render layer
  // can pulse a glow over live combat zones. Stale entries are pruned in-pass.
  getHotEdges(maxAgeMs) {
    const cfg = this.cfg;
    const ageMs = maxAgeMs || cfg.HEAT_AGE_MS;
    const W = cfg.GRID_W, H = cfg.GRID_H, D = cfg.CELL_DEG;
    const owner = this.owner;
    const now = performance.now();
    if (!this._heSegs) { this._heSegs = []; this._heSeen = new Set(); }
    const segs = this._heSegs, seen = this._heSeen;
    segs.length = 0; seen.clear();
    const N = W * H;
    const dead = [];
    for (const entry of this._heat) {
      const cell = entry[0], ts = entry[1];
      if (now - ts > ageMs) { dead.push(cell); continue; }
      const o = owner[cell];
      if (o === cfg.WATER || o === cfg.NEUTRAL) continue;   // only owned frontage glows
      const col = cell % W;
      const row = (cell / W) | 0;
      const wLon = -180 + col * D;
      const eLon = wLon + D;
      const nLat = 90 - row * D;
      const sLat = nLat - D;
      const push = (b, lat1, lon1, lat2, lon2) => {
        const key = cell < b ? cell * N + b : b * N + cell;
        if (seen.has(key)) return;
        seen.add(key);
        segs.push(lat1, lon1, lat2, lon2);
      };
      const eCell = row * W + (col < W - 1 ? col + 1 : 0);
      if (owner[eCell] !== o) push(eCell, nLat, eLon, sLat, eLon);
      const wCell = row * W + (col > 0 ? col - 1 : W - 1);
      if (owner[wCell] !== o) push(wCell, nLat, wLon, sLat, wLon);
      if (row > 0 && owner[cell - W] !== o) push(cell - W, nLat, wLon, nLat, eLon);
      if (row < H - 1 && owner[cell + W] !== o) push(cell + W, sLat, wLon, sLat, eLon);
    }
    for (const c of dead) this._heat.delete(c);
    return segs;
  }

  // ── TASK-406: devastation VISUAL flush — paint bucket-dirty cells into the
  // scorch canvas (dark tint, alpha ∝ devastation). Returns true when pixels
  // changed (caller re-uploads the texture, throttled).
  flushDevastationRender() {
    if (!this._devDirty || this._devDirty.size === 0) return false;
    const cfg = this.cfg;
    const W = cfg.GRID_W, H = cfg.GRID_H;
    const data = this.devImage.data;
    const L = cfg.DEV_VIS_LEVELS - 1;
    const maxA = cfg.DEV_VIS_MAX_ALPHA;
    let minC = W, minR = H, maxC = -1, maxR = -1;
    for (const cell of this._devDirty) {
      const b = this._devBuckets[cell];
      const p = cell * 4;
      if (b > 0) {
        data[p] = 34; data[p + 1] = 24; data[p + 2] = 16;   // charcoal scorch
        data[p + 3] = Math.round((b / L) * maxA);
      } else {
        data[p + 3] = 0;                                    // fully healed → clear
      }
      const c = cell % W, r = (cell / W) | 0;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    this._devDirty.clear();
    this.devCtx.putImageData(this.devImage, 0, 0, minC, minR, maxC - minC + 1, maxR - minR + 1);
    return true;
  }
  hasDevDirty() { return this._devDirty.size > 0; }
  getDevastationCanvas() { return this.devCanvas; }

  // ── TASK-406: shared dirty-region queue (consumed by the render layer) ──
  // Returns: undefined (nothing pending) · null (full repaint pending) ·
  // {x,y,w,h} (union sub-rect of every change since the last consume).
  takeOverlayRect() {
    const v = this._ovRect;
    this._ovRect = undefined;
    return v;
  }
  getLastFlush() { return this._lastFlush; }

  // ── DEVASTATION (TASK-102) ──
  // Blast damage from missiles/bombs weakens territory: each hit paints
  // DEVASTATION_PER_HIT at the center, falling off linearly to the blast
  // rim (in CELLS, ~55km each). attackLogic reads it via devastationAt().
  // Call from Missile.explode / warship shells / air strikes.
  applyDevastation(lat, lon, radiusKm, power = 1) {
    if (!this._devastation) return;
    const cfg = this.cfg;
    const center = this.latLonToCell(lat, lon);
    const { col: cc, row: cr } = this.cellColRow(center);
    const radiusDeg = radiusKm / 111.12;
    const spanLat = Math.ceil(radiusDeg / cfg.CELL_DEG) + 1;
    const spanLon = Math.ceil(radiusDeg / (cfg.CELL_DEG * Math.max(0.25, Math.cos(lat * Math.PI / 180)))) + 1;
    const hit = cfg.DEVASTATION_PER_HIT * power;
    const maxD = cfg.DEVASTATION_MAX;
    for (let dr = -spanLat; dr <= spanLat; dr++) {
      const row = cr + dr;
      if (row < 0 || row >= cfg.GRID_H) continue;
      const dyKm = dr * cfg.CELL_DEG * 111.12;
      for (let dc = -spanLon; dc <= spanLon; dc++) {
        let col = (cc + dc) % cfg.GRID_W;
        if (col < 0) col += cfg.GRID_W;
        const cell = row * cfg.GRID_W + col;
        if (this.owner[cell] === cfg.WATER) continue;
        const dxKm = dc * cfg.CELL_DEG * 111.12 * Math.cos(lat * Math.PI / 180);
        const dist = Math.hypot(dyKm, dxKm);
        if (dist > radiusKm) continue;
        const fall = 1 - dist / Math.max(1, radiusKm);          // 1 at center → 0 at rim
        const add = hit * fall;
        const cur = this._devastation[cell];
        const nv = cur + add > maxD ? maxD : cur + add;
        if (nv > 0 && this._devSet.size < cfg.DEVASTATION_SET_CAP) this._devSet.add(cell);
        this._devastation[cell] = nv;
        // TASK-406: track the visual bucket — repaint only when it changes
        const nb = Math.min(cfg.DEV_VIS_LEVELS - 1, Math.round(nv * (cfg.DEV_VIS_LEVELS - 1)));
        if (nb !== this._devBuckets[cell]) {
          this._devBuckets[cell] = nb;
          this._devDirty.add(cell);
        }
      }
    }
  }

  devastationAt(cell) {
    return this._devastation ? this._devastation[cell] : 0;
  }

  // TASK-506: decay — iterates ONLY the live-devastation set (cells that
  // actually carry dev>0), so every devastated cell decays at the full
  // per-call rate regardless of grid size. nCells remains a per-call budget
  // cap (defensive only — the set is bounded by DEVASTATION_SET_CAP; entries
  // beyond the budget decay on a later call). Cells that hit 0 are removed
  // from the set; bucket changes queue a scorch-pixel repaint.
  decayDevastation(nCells = 1600) {
    if (!this._devastation || this._devSet.size === 0) return;
    const d = this._devastation;
    const dec = this.cfg.DEVASTATION_DECAY_PER_TICK;
    const L = this.cfg.DEV_VIS_LEVELS - 1;
    let budget = Math.min(nCells, this._devSet.size);
    for (const idx of this._devSet) {
      if (budget-- <= 0) break;
      const v = d[idx];
      if (v <= 0) { this._devSet.delete(idx); continue; }   // stale zero (cleared elsewhere)
      const nv = v <= dec ? 0 : v - dec;
      d[idx] = nv;
      if (nv === 0) this._devSet.delete(idx);
      // bucket change → scorch pixel repaint (usually stays same → no-op)
      const nb = nv <= 0 ? 0 : Math.min(L, Math.round(nv * L));
      if (nb !== this._devBuckets[idx]) {
        this._devBuckets[idx] = nb;
        this._devDirty.add(idx);
      }
    }
  }
  // Introspection for probes/tests: how many cells currently carry devastation.
  devastationCellCount() { return this._devSet.size; }
  seedCircle(lat, lon, radiusKm, ownerStr) {
    const cfg = this.cfg;
    // Snap to nearest land cell if the clicked location falls on water in the grid
    const probeCell = this.latLonToCell(lat, lon);
    if (this.owner[probeCell] === cfg.WATER) {
      const nearest = this.findNearestLandCell(lat, lon, 60);
      if (nearest) { lat = nearest.lat; lon = nearest.lon; }
    }
    const center = this.latLonToCell(lat, lon);
    const { col: cc, row: cr } = this.cellColRow(center);
    // radius in cells: ~ each cell ≈ 55km (0.5°). Use lat-adjusted span.
    const cellDeg = cfg.CELL_DEG;
    const radiusDeg = radiusKm / 111.12;
    const spanLat = Math.ceil(radiusDeg / cellDeg) + 1;
    const spanLon = Math.ceil(radiusDeg / (cellDeg * Math.max(0.25, Math.cos(lat * Math.PI / 180)))) + 1;
    for (let dr = -spanLat; dr <= spanLat; dr++) {
      const row = cr + dr;
      if (row < 0 || row >= cfg.GRID_H) continue;
      for (let dc = -spanLon; dc <= spanLon; dc++) {
        let col = (cc + dc) % cfg.GRID_W;
        if (col < 0) col += cfg.GRID_W;
        const cell = row * cfg.GRID_W + col;
        if (this.owner[cell] === cfg.WATER) continue;
        const { lat: clat, lon: clon } = this.cellToLatLon(cell);
        // great-circle-ish distance via equirectangular approximation
        const dy = (clat - lat) * 111.12;
        const dx = (clon - lon) * 111.12 * Math.cos(lat * Math.PI / 180);
        if (dx * dx + dy * dy <= radiusKm * radiusKm) {
          this.conquerCell(cell, ownerStr);
        }
      }
    }
    // Note: conquerCell() already records changed cells in _dirtyCells, so we use
    // the incremental render path (the initial full repaint from grid init ensures
    // the canvas is already painted before any spawn).
  }

  // ══════════════════════════════════════════════════════════════════
  //  RENDER SYNC
  //  Updates the grid canvas pixels for dirty cells. Caller draws this canvas
  //  (scaled) onto the territory texture + strokes country borders on top.
  // ══════════════════════════════════════════════════════════════════
  flushRender() {
    const cfg = this.cfg;
    const data = this.gridImage.data;
    const W = cfg.GRID_W;
    const H = cfg.GRID_H;

    // ── Territory overlay (TRANSPARENT). Biomes are painted on the SAME grid's
    // biomeCanvas (see paintBiomeBase + main.js applyBiomeGlobeTexture); this canvas
    // only carries player/enemy territory fills + borders so the biomes show through.
    //   water / neutral land → fully transparent (biome shows through)
    //   player → solid green fill
    //   enemy  → solid red fill
    const paintCell = (cell) => {
      const p = cell * 4;
      const o = this.owner[cell];
      if (isOwnedCode(o, cfg)) {
        const c = ownerColor(o, cfg);
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 150;   // TASK-103: was 90 — nations must POP over neutral roads
      } else {
        data[p + 3] = 0;   // transparent — biome base shows through
      }
    };
    // ── Territory border: owned cells whose neighbor has a different owner ──
    // (membership feeds the vector frontier lines + AI frontline targeting;
    // the canvas itself no longer darkens border pixels — TASK-406 removed the
    // per-pixel darkening in favour of the crisp vector overlay.)
    const isBorderCell = (cell) => {
      const o = this.owner[cell];
      if (!isOwnedCode(o, cfg)) return false;
      const col = cell % W;
      const row = (cell / W) | 0;
      if (this.owner[col === W - 1 ? cell - W + 1 : cell + 1] !== o) return true; // east (wrap)
      if (this.owner[col === 0 ? cell + W - 1 : cell - 1] !== o) return true;     // west (wrap)
      if (row > 0 && this.owner[cell - W] !== o) return true;                      // north
      if (row < H - 1 && this.owner[cell + W] !== o) return true;                  // south
      return false;
    };

    let dirtyRect = null; // null = full-canvas copy; otherwise {x,y,w,h}

    if (this._dirty) {
      // Full repaint — TASK-406: paint + border detection FUSED into one pass
      // (the old code ran a second 26M-cell scan for border membership).
      const owner = this.owner;
      this._borderCells.clear();
      for (let row = 0; row < H; row++) {
        const rowStart = row * W;
        for (let col = 0; col < W; col++) {
          const i = rowStart + col;
          const o = owner[i];
          const p = i * 4;
          if (isOwnedCode(o, cfg)) {
            const c = ownerColor(o, cfg);
            data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 150;
            // fused border detection (east/west wrap, north/south clamp)
            const e = col === W - 1 ? i - W + 1 : i + 1;
            const w = col === 0 ? i + W - 1 : i - 1;
            if (owner[e] !== o || owner[w] !== o ||
                (row > 0 && owner[i - W] !== o) ||
                (row < H - 1 && owner[i + W] !== o)) {
              this._borderCells.add(i);
            }
          } else {
            data[p + 3] = 0;   // transparent — biome base shows through
          }
        }
      }
      this._dirty = false;
      this._dirtyCells.clear();
      this._ovRect = null;                 // full repaint pending for the overlay
      this._lastFlush = { full: true, rect: null };
      // dirtyRect stays null → full putImageData (startup / land-mask rebuild only)
    } else if (this._dirtyCells.size > 0) {
      // ── Incremental: repaint dirty cells, then fix borders for affected cells ──
      // Collect all cells whose border status might have changed: dirty cells + neighbors
      const recheck = this._recheckScratch;
      recheck.clear();
      const nbBuf = this._nbScratch;
      for (const cell of this._dirtyCells) {
        recheck.add(cell);
        const n = this.neighbors4(cell, nbBuf);
        for (let k = 0; k < n; k++) recheck.add(nbBuf[k]);
      }
      // Step 1: repaint dirty cells (ownership may have changed — paintCell
      // fully overwrites the pixel for owned cells and clears alpha otherwise)
      for (const cell of this._dirtyCells) {
        paintCell(cell);
      }
      // Step 2: restore normal color for all recheck cells (undo prior border darkening)
      for (const cell of recheck) {
        paintCell(cell);
      }
      // Step 3: update frontier membership for the recheck set (vector lines are drawn
      // separately, so this is pure bookkeeping — no texture darkening).
      for (const cell of recheck) {
        if (isBorderCell(cell)) {
          this._borderCells.add(cell);
        } else {
          this._borderCells.delete(cell);
        }
      }      // Bounding box of every touched cell → only copy that slice to the canvas.
      // At 7200x3600 a full putImageData (~104MB) every conquest tick would stutter;
      // the dirty rect bounds the copy to just the changed region.
      let minC = W, minR = H, maxC = -1, maxR = -1;
      for (const cell of recheck) {
        const c = cell % W;
        const r = (cell / W) | 0;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
      dirtyRect = { x: minC, y: minR, w: maxC - minC + 1, h: maxR - minR + 1 };
      this._dirtyCells.clear();
      // TASK-406: union into the shared overlay dirty-region queue (a null
      // sentinel from an earlier full repaint wins — full blit covers it).
      if (this._ovRect === undefined) this._ovRect = dirtyRect;
      else if (this._ovRect !== null) {
        const r = this._ovRect;
        const x2 = Math.max(r.x + r.w, dirtyRect.x + dirtyRect.w);
        const y2 = Math.max(r.y + r.h, dirtyRect.y + dirtyRect.h);
        r.x = Math.min(r.x, dirtyRect.x);
        r.y = Math.min(r.y, dirtyRect.y);
        r.w = x2 - r.x;
        r.h = y2 - r.y;
      }
      this._lastFlush = { full: false, rect: dirtyRect };
    } else {
      return false; // nothing changed
    }

    if (dirtyRect) {
      this.gridCtx.putImageData(this.gridImage, 0, 0, dirtyRect.x, dirtyRect.y, dirtyRect.w, dirtyRect.h);
    } else {
      this.gridCtx.putImageData(this.gridImage, 0, 0);
    }
    return true;
  }

  getCanvas() { return this.gridCanvas; }
  markDirty() { this._dirty = true; }
  hasDirty() { return this._dirty || this._dirtyCells.size > 0; }
}

// ════════════════════════════════════════════════════════════════════
//  COMBAT MATH — faithful port of OpenFront Config.attackLogic
// ════════════════════════════════════════════════════════════════════
export function attackLogic(grid, attackTroops, attackerStr, defenderStr, cell, ctx) {
  const cfg = grid.cfg;
  const t = grid.terrainAtCell(cell);
  let mag = cfg.TERRAIN_MAG[t] || 80;
  const speed = cfg.TERRAIN_SPEED[t] || 16.5;

  // TASK-102 DEVASTATION: blast-pounded cells fight back weaker AND fall
  // faster — missiles now shape the land war (was: no effect at all).
  const dev = grid.devastationAt ? grid.devastationAt(cell) : 0;
  mag *= 1 - dev * (1 - cfg.DEVASTATION_DEF_MULT);
  const devSpeed = 1 + dev * (cfg.DEVASTATION_SPEED_MULT - 1);

  // TASK-406 MORALE: recent-loss ratio modulates troop effectiveness ±15%.
  // Low-morale attackers bleed more per tile and conquer slower; low-morale
  // defenders lose more per tile. (2 − m) inverts the scale so m∈[0.85,1.15]
  // maps exactly to ×[1.15,0.85] on losses; m multiplies conquest speed.
  const mA = ctx.getMorale ? ctx.getMorale(attackerStr) : 1;

  // Any OWNED territory (player, legacy enemy, or a registered bot nation)
  const isBot = (s) => typeof s === 'string' && s.startsWith('bot');
  const defenderIsPlayer = (defenderStr === 'player' || defenderStr === 'enemy' || isBot(defenderStr));

  // OpenFront: human attacker vs a Bot defender pays 0.7× the terrain magnitude.
  if (defenderIsPlayer && attackerStr === 'player') {
    mag *= 0.7;
  }

  if (defenderIsPlayer) {
    const defTroops = ctx.getTroops(defenderStr);
    const defCells = Math.max(1, grid.countCells(defenderStr));
    const mD = ctx.getMorale ? ctx.getMorale(defenderStr) : 1;

    // large-empire defense debuff
    const defenseSig = 1 - sigmoid(defCells, cfg.DEFENSE_DEBUFF_DECAY_RATE, cfg.DEFENSE_DEBUFF_MIDPOINT);
    const largeDefenderSpeedDebuff = 0.7 + 0.3 * defenseSig;
    const largeDefenderAttackDebuff = 0.7 + 0.3 * defenseSig;

    const attackerCells = grid.countCells(attackerStr);
    let largeAttackBonus = 1;
    if (attackerCells > cfg.LARGE_EMPIRE_THRESHOLD) {
      largeAttackBonus = Math.pow(Math.sqrt(cfg.LARGE_EMPIRE_THRESHOLD / attackerCells), 0.7);
    }
    let largeAttackerSpeedBonus = 1;
    if (attackerCells > cfg.LARGE_EMPIRE_THRESHOLD) {
      largeAttackerSpeedBonus = Math.pow(cfg.LARGE_EMPIRE_THRESHOLD / attackerCells, 0.6);
    }

    const defenderTroopLoss = (defTroops / defCells) * (2 - mD);
    const currentAttackerLoss =
      within(defTroops / Math.max(1, attackTroops), 0.6, 2) *
      mag * 0.8 * largeDefenderAttackDebuff * largeAttackBonus;
    const altAttackerLoss = 1.3 * defenderTroopLoss * (mag / 100);
    const attackerTroopLoss = (0.6 * currentAttackerLoss + 0.4 * altAttackerLoss) * (2 - mA);

    // TASK-102 TROOP-SCALE: absolute commitment now matters — losses scale
    // DOWN with a large force (economy of force): a 10× bigger force takes
    // a tile for ~half the per-tile cost (was: loss independent of size).
    const forceEff = 1 / (1 + Math.log10(Math.max(1, attackTroops / 500)) * 0.5);

    return {
      attackerTroopLoss: attackerTroopLoss * Math.max(0.45, forceEff),
      defenderTroopLoss,
      tilesPerTickUsed:
        within(defTroops / (5 * Math.max(1, attackTroops)), 0.2, 1.5) *
        speed * devSpeed * largeDefenderSpeedDebuff * largeAttackerSpeedBonus * mA,
    };
  } else {
    // vs neutral wilderness — OpenFront: bots expand at HALF the human cost
    // (attackerTroopLoss: bot ? mag/10 : mag/5).
    // TASK-102: per-tile COST is INVERSE with force (a big army steamrolls
    // cheaply, floor 5) — the BUDGET scaling lives in attackTilesPerTickCtx
    // and the dynamic cap in ConquestAttack.tick. (My first attempt scaled
    // cost UP with troops — one tile ate the whole budget: 1 cell/tick.)
    const forceEff = Math.max(0.45, 1 / (1 + Math.log10(Math.max(1, attackTroops / 500)) * 0.5));
    return {
      attackerTroopLoss: ((attackerStr === 'enemy' || isBot(attackerStr)) ? mag / 10 : mag / 5) * forceEff * (2 - mA),
      defenderTroopLoss: 0,
      tilesPerTickUsed: within((2000 * Math.max(10, speed)) / Math.max(1, attackTroops), 5, 100) * devSpeed * mA,
    };
  }
}

// Conquest speed — port of Config.attackTilesPerTick.
// Needs the defender's live troop pool (passed via ctx by the caller).
export function attackTilesPerTickCtx(grid, attackTroops, defenderStr, defenderTroops, numAdjacentEnemyCells) {
  const isBot = (s) => typeof s === 'string' && s.startsWith('bot');
  const defenderIsPlayer = (defenderStr === 'player' || defenderStr === 'enemy' || isBot(defenderStr));
  if (defenderIsPlayer) {
    return (
      within(((5 * attackTroops) / Math.max(1, defenderTroops)) * 2, 0.01, 0.5) *
      numAdjacentEnemyCells * 3
    );
  }
  // TASK-102 TROOP-SCALE (neutral): tile rate now scales with committed force
  // via sqrt — was a flat numAdjacent×2 where 100 and 100,000 troops were
  // identical.
  const forceScale = Math.sqrt(Math.max(1, attackTroops) / 1000);
  return numAdjacentEnemyCells * 2 * Math.min(6, forceScale);
}

// ════════════════════════════════════════════════════════════════════
//  CONQUEST ATTACK — port of OpenFront AttackExecution
//
//  ctx interface:
//    getTroops(ownerStr)            → number
//    addTroops(ownerStr, delta)     → void   (delta may be negative)
//    onConquerCell(cell, ownerStr)  → void   (optional hook)
//    onEliminated(conqueror, conquered) → void
//    log(msg, type)                 → void   (optional)
// ════════════════════════════════════════════════════════════════════
export class ConquestAttack {
  constructor({ grid, owner, target, troops, srcLat, srcLon, dstLat, dstLon, ctx }) {
    this.grid = grid;
    this.cfg = grid.cfg;
    this.owner = owner;                 // 'player' | 'enemy'
    this.target = target;               // 'player' | 'enemy' | 'neutral'
    this.ctx = ctx;

    this.troops = Math.max(0, Math.floor(troops));
    this.active = true;
    this.retreating = false;

    this.heap = new MinHeap(2048);
    this.border = new Set();
    this._nbuf = new Int32Array(4);

    this.tickCount = 0;
    this._randState = ((this.grid.latLonToCell(srcLat, srcLon) ^ 0x9e3779b9) >>> 0) || 1;

    // init: deduct troops from attacker pool
    this.ctx.addTroops(this.owner, -this.troops);

    this.srcCell = this.grid.latLonToCell(srcLat, srcLon);
    this.dstCell = this.grid.latLonToCell(dstLat, dstLon);

    this._init();
  }

  // small deterministic PRNG (mirrors OpenFront PseudoRandom.nextInt(0,7))
  _nextInt(lo, hi) {
    // xorshift32
    let x = this._randState;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this._randState = x;
    const range = hi - lo;
    return lo + (x % range);
  }

  _ownerCode(str) { return STR_TO_CODE[str] || 1; }

  _init() {
  const grid = this.grid;
  const ownerCode = this._ownerCode(this.owner);
  const srcOwner = grid.ownerCodeAtCell(this.srcCell);

  // Seed the frontier by BFS from the source through attacker-owned land,
  // enqueuing any target-owned land we touch. This lets the player click
  // anywhere in their territory (not just the frontline) and still reach the target.
  if (srcOwner === ownerCode) {
    this._seedFrontierFromSource();
  } else {
    this._refreshFromBorders();
  }

  if (this.heap.size() === 0) {
    // no reachable target tiles — refund and abort
    console.warn('[CONQUEST ATK] ABORT: heap empty, refunding %d troops', this.troops);
    this.ctx.addTroops(this.owner, this.troops);
    this.troops = 0;
    this.active = false;
  }
}

// BFS from srcCell through attacker-owned land, enqueueing target-owned neighbors.
// Bounded + early-exits once a healthy frontier is found.
_seedFrontierFromSource() {
  const grid = this.grid;
  const ownerCode = this._ownerCode(this.owner);
  const targetCode = this._ownerCode(this.target);
  const nbuf = this._nbuf;
  const seen = new Set([this.srcCell]);
  const queue = [this.srcCell];
  let head = 0, guard = 0;
  while (head < queue.length && guard < 60000) {
    guard++;
    const cell = queue[head++];
    const n = grid.neighbors4(cell, nbuf);
    for (let i = 0; i < n; i++) {
      const nb = nbuf[i];
      const o = grid.ownerCodeAtCell(nb);
      if (o === targetCode && grid.isLandCell(nb)) {
        if (!this.border.has(nb)) this._enqueueTargetCell(cell, nb);
      } else if (o === ownerCode && !seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
    if (this.border.size > 150) break; // enough frontline seeded
  }
}

// Enqueue a target cell with OpenFront-style priority (terrain + owned-by-me).
_enqueueTargetCell(attackerCell, targetCell) {
  if (this.border.has(targetCell)) return;
  this.border.add(targetCell);
  const cfg = this.cfg;
  const ownerCode = this._ownerCode(this.owner);
  const t = this.grid.terrainAtCell(targetCell);
  const mag = cfg.TERRAIN_MAG[t] || 80;
  // count attacker-owned neighbors of the target cell
  const nbuf2 = new Int32Array(4);
  let numOwnedByMe = 0;
  const m = this.grid.neighbors4(targetCell, nbuf2);
  for (let j = 0; j < m; j++) {
    if (this.grid.ownerCodeAtCell(nbuf2[j]) === ownerCode) numOwnedByMe++;
  }
  const priority = (this._nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2) + this.tickCount;
  this.heap.enqueue(targetCell, priority);
}

  // Rebuild the frontier from all attacker border cells (fallback path)
  _refreshFromBorders() {
    this.heap.clear();
    this.border.clear();
    const grid = this.grid;
    const cfg = this.cfg;
    const ownerCode = this._ownerCode(this.owner);
    const targetCode = this._ownerCode(this.target);
    const nbuf = this._nbuf;
    // Scan a window around destination first for performance, else full grid.
    // We do a bounded BFS from dstCell over target-owned land to find cells
    // adjacent to attacker-owned cells.
    const seen = new Set();
    const queue = [this.dstCell];
    seen.add(this.dstCell);
    // Head-index pattern (NOT queue.shift() — shift is O(n) per pop and made this
    // BFS O(n²), freezing the main thread on large territories). Same as
    // _seedFrontierFromSource above.
    let guard = 0, head = 0;
    while (head < queue.length && guard < 200000) {
      guard++;
      const cell = queue[head++];
      const n = grid.neighbors4(cell, nbuf);
      for (let i = 0; i < n; i++) {
        const nb = nbuf[i];
        if (seen.has(nb)) continue;
        const o = grid.ownerCodeAtCell(nb);
        if (o === ownerCode) {
          // attacker borders this target cell → enqueue target cell
          if (grid.ownerCodeAtCell(cell) === targetCode) {
            this._enqueueTargetCell(nb, cell);
          }
        }
        if (o === targetCode) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
  }

  // Port of AttackExecution.addNeighbors: enqueue target-owned land cells
  // adjacent to `cell`, prioritized by terrain + owned-by-me weighting.
  _addNeighbors(cell) {
    const grid = this.grid;
    const cfg = this.cfg;
    const ownerCode = this._ownerCode(this.owner);
    const targetCode = this._ownerCode(this.target);
    const nbuf = this._nbuf;
    const nbuf2 = new Int32Array(4);
    const tickNow = this.tickCount;

    const n = grid.neighbors4(cell, nbuf);
    for (let i = 0; i < n; i++) {
      const neighbor = nbuf[i];
      if (!grid.isLandCell(neighbor)) continue;
      if (grid.ownerCodeAtCell(neighbor) !== targetCode) continue;
      if (this.border.has(neighbor)) continue;
      this.border.add(neighbor);

      // count how many of neighbor's neighbors are owned by attacker
      let numOwnedByMe = 0;
      const m = grid.neighbors4(neighbor, nbuf2);
      for (let j = 0; j < m; j++) {
        if (grid.ownerCodeAtCell(nbuf2[j]) === ownerCode) numOwnedByMe++;
      }

      const t = grid.terrainAtCell(neighbor);
      const mag = cfg.TERRAIN_MAG[t] || 80;

      const priority =
        (this._nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2) + tickNow;

      this.heap.enqueue(neighbor, priority);
    }
  }

  // ── Per-frame tick (call from game loop) ──
  tick() {
    if (!this.active) return;
    const grid = this.grid;
    const cfg = this.cfg;
    const ownerCode = this._ownerCode(this.owner);
    const targetCode = this._ownerCode(this.target);
    const nbuf = this._nbuf;

    this.tickCount++;
    if (this.tickCount % cfg.TICK_INTERVAL !== 0) return;
    if (this.troops < 1) { this._end(); return; }

    // recompute target in case ownership shifted
    const defenderTroops = this.ctx.getTroops(this.target);
    const numAdjacent = Math.min(this.border.size, 40) + this._nextInt(0, 5);
    let numTilesThisTick = attackTilesPerTickCtx(grid, this.troops, this.target, defenderTroops, numAdjacent);
    // TASK-102 v2: DYNAMIC per-tick cap — the old flat MAX_CELLS_PER_TICK=12
    // ate ALL troop scaling above ~2k troops (everything capped at the same
    // 12 cells/tick = "no matter how many troops, it's the same"). Now a big
    // commitment visibly conquers faster: cap grows with sqrt(troops),
    // ~3× base at 10k, 5× at 25k+ (soft, still bounded for perf).
    const capScale = 1 + Math.min(4, Math.sqrt(Math.max(0, this.troops - 500) / 1500));
    const dynamicCap = Math.round(cfg.MAX_CELLS_PER_TICK * capScale);
    numTilesThisTick = Math.min(numTilesThisTick, dynamicCap);

    let processed = 0;
    while (numTilesThisTick > 0) {
      if (this.troops < 1) break;
      if (this.heap.size() === 0) {
        // try to refresh frontier from current borders
        this._refreshFromBorders();
        if (this.heap.size() === 0) { this._end(); return; }
      }

      const cell = this.heap.dequeue();
      this.border.delete(cell);

      // validate: must still be target-owned AND border an attacker cell
      if (grid.ownerCodeAtCell(cell) !== targetCode) continue;
      if (!grid.isLandCell(cell)) continue;
      let onBorder = false;
      const nn = grid.neighbors4(cell, nbuf);
      for (let i = 0; i < nn; i++) {
        if (grid.ownerCodeAtCell(nbuf[i]) === ownerCode) { onBorder = true; break; }
      }
      if (!onBorder) continue;

      // resolve combat for this cell
      const res = attackLogic(grid, this.troops, this.owner, this.target, cell, this.ctx);
      numTilesThisTick -= Math.max(1, res.tilesPerTickUsed);

      this.troops -= res.attackerTroopLoss;
      if (this.troops < 0) this.troops = 0;
      if (this.target !== 'neutral') {
        this.ctx.addTroops(this.target, -res.defenderTroopLoss);
      }
      // TASK-406 morale: feed the recent-loss trackers (both sides of the fight)
      if (this.ctx.onLosses) {
        this.ctx.onLosses(this.owner, res.attackerTroopLoss);
        if (this.target !== 'neutral') this.ctx.onLosses(this.target, res.defenderTroopLoss);
      }

      // conquer the cell
      grid.conquerCell(cell, this.owner);
      if (this.ctx.onConquerCell) this.ctx.onConquerCell(cell, this.owner);

      // expand frontier into newly adjacent target cells
      this._addNeighbors(cell);

      processed++;
      if (processed >= dynamicCap) break;

      // check elimination
      if (this.target !== 'neutral' && grid.countCells(this.target) < cfg.ELIMINATION_CELL_THRESHOLD) {
        this._eliminateDefender();
        this._end();
        return;
      }
    }

    if (this.troops < 1 || this.heap.size() === 0) {
      this._end();
    }
  }

  _eliminateDefender() {
    const grid = this.grid;
    const cfg = this.cfg;
    const targetCode = this._ownerCode(this.target);
    const ownerCode = this._ownerCode(this.owner);
    // take all remaining defender cells
    for (let cell = 0; cell < grid.owner.length; cell++) {
      if (grid.owner[cell] === targetCode) {
        grid.conquerCell(cell, this.owner);
      }
    }
    // OpenFront conquerPlayer: the conquered side loses their ENTIRE remaining
    // troop pool (previously the loser kept breeding troops with zero territory).
    if (this.ctx && this.ctx.getTroops && this.ctx.addTroops) {
      const wiped = this.ctx.getTroops(this.target);
      this.ctx.addTroops(this.target, -wiped);
      if (this.ctx.onLosses && wiped > 0) this.ctx.onLosses(this.target, wiped);   // TASK-406 morale
    }
    // Elimination logging is owned by ctx.onEliminated (main.js) — it knows bot
    // names/flags; the old generic log here duplicated every elimination notice.
    if (this.ctx.onEliminated) this.ctx.onEliminated(this.owner, this.target);
  }

  _end() {
    // return survivors to attacker pool
    if (this.troops > 0) {
      this.ctx.addTroops(this.owner, Math.floor(this.troops));
    }
    this.active = false;
  }
}
