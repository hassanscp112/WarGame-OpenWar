#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════
// build_river_routes.cjs — Offline Pre-Computation for Hybrid Maritime
// Pathfinding.
//
// Generates TWO data files consumed at runtime by src/main.js:
//
//   1. river_routes.json   — River flow field (inland water → ocean)
//   2. ocean_highways.json — Sparse ocean highway graph for instant
//                            long-distance routing
//
// The terrain processing EXACTLY mirrors the game's pipeline:
//   loadTerrainFromBin → dilateWater → _ensureMediumArrays
// so that cell indices and water/land classifications are identical
// between offline data and runtime lookups.
// ════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ── Grid constants (must match CONQUEST_CFG + pathfinding constants) ──
const FINE_W = 7200, FINE_H = 3600;          // conquest grid resolution
const MED_W  = 3600, MED_H  = 1800;           // medium pathfinding grid
const MED_DEG = 0.1, MED_STRIDE = 2;          // medium = every 2nd fine cell
const SRC_W  = 4108, SRC_H  = 1948;           // terrain binary dimensions
const DILATION_RINGS = 1;                      // WATER_DILATION_RINGS
const DILATION_MIN_NBR = 1;                    // WATER_DILATION_MIN_NEIGHBORS
const WATER = 0, NEUTRAL = 1;                  // owner[] sentinels

// ── Ocean highway graph config ──
const HW_STRIDE = 20;                           // node spacing = 20 med cells = 2°
const BUILD_LEGACY = false;                      // skip dead flow-field/river-flow steps

// ── Adaptive densification config (STEP 7d) ──
// Fills navigable rivers/straits that miss the 2° lattice. A water cell farther
// than DENSIFY_RADIUS hops (8-connected) from any highway node triggers a new
// node chain traced along the all-water path back to the graph. Radius must
// stay ABOVE the open-ocean baseline (~14 hops on a 2° lattice) so only genuine
// gaps (rivers) are densified, not the already-served open ocean.
const DENSIFY_RADIUS       = 16;                 // hops; cells farther than this get a node
const DENSIFY_SAMPLE_EVERY = 3;                  // cells between nodes on a traced chain (keeps LOS)
const DENSIFY_MAX_NODES    = 16000;              // hard cap on added nodes (ocean + inland)
const DENSIFY_MAX_ITER     = 40;                 // BFS iteration cap
const DENSIFY_SEEDS_PER_IT = 64;                 // max seeds processed per iteration
const INLAND_MIN_SIZE      = 50;                 // min medium cells for an inland water body to get
                                                 // its own connected highway sub-graph (intra-body trade)

// ── Paths ──
const OUT_DIR     = path.join(__dirname, '..', 'public', 'data');
const TERRAIN_BIN = path.join(OUT_DIR, 'openfront_terrain_corrected.bin');

// ════════════════════════════════════════════════════════════════════════
// Utility: haversine distance in km
// ════════════════════════════════════════════════════════════════════════
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ════════════════════════════════════════════════════════════════════════
// STEP 1: Load terrain binary → fine-grid owner[]
// ════════════════════════════════════════════════════════════════════════
console.log('[1/8] Loading terrain binary...');
const terrainBuf = fs.readFileSync(TERRAIN_BIN);
const expectedBytes = SRC_W * SRC_H;
if (terrainBuf.length < expectedBytes) {
    throw new Error(`Terrain binary too small: ${terrainBuf.length} bytes, expected ${expectedBytes}`);
}
console.log(`  Terrain binary: ${terrainBuf.length} bytes (${SRC_W}x${SRC_H})`);

// Build fine-grid owner[] — mirrors loadTerrainFromBin() + buildLandMaskFromTerrain()
console.log('  Building fine grid (7200x3600)...');
const owner = new Uint8Array(FINE_W * FINE_H);
{
    const sx = SRC_W / FINE_W;
    const sy = SRC_H / FINE_H;
    for (let row = 0; row < FINE_H; row++) {
        const srcRow = Math.min(SRC_H - 1, ((row + 0.5) * sy) | 0);
        const srcBase = srcRow * SRC_W;
        const rowBase = row * FINE_W;
        for (let col = 0; col < FINE_W; col++) {
            const srcCol = ((col + 0.5) * sx) | 0;
            const tb = terrainBuf[srcBase + srcCol];
            owner[rowBase + col] = (tb & 0x80) ? NEUTRAL : WATER;
        }
    }
}
let fineWater = 0;
for (let i = 0; i < owner.length; i++) if (owner[i] === WATER) fineWater++;
console.log(`  Fine grid water: ${fineWater} / ${owner.length} (${(100 * fineWater / owner.length).toFixed(1)}%)`);

// ════════════════════════════════════════════════════════════════════════
// STEP 2: Dilate water — mirrors dilateWater(rings=1, minNeighbors=1)
// ════════════════════════════════════════════════════════════════════════
console.log('[2/8] Dilating water...');
for (let ring = 0; ring < DILATION_RINGS; ring++) {
    const snap = owner.slice();
    let converted = 0;
    for (let row = 0; row < FINE_H; row++) {
        const rowBase = row * FINE_W;
        for (let col = 0; col < FINE_W; col++) {
            const cell = rowBase + col;
            if (snap[cell] === WATER) continue;
            let wn = 0;
            for (let dy = -1; dy <= 1; dy++) {
                const nr = row + dy;
                if (nr < 0 || nr >= FINE_H) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nc = (((col + dx) % FINE_W) + FINE_W) % FINE_W;
                    if (snap[nr * FINE_W + nc] === WATER) wn++;
                }
            }
            if (wn >= DILATION_MIN_NBR) { owner[cell] = WATER; converted++; }
        }
    }
    console.log(`  Ring ${ring + 1}: ${converted} land cells -> water`);
}

// ════════════════════════════════════════════════════════════════════════
// STEP 3: Build medium water mask — mirrors _ensureMediumArrays()
// ════════════════════════════════════════════════════════════════════════
console.log('[3/8] Building medium water mask (3600x1800)...');
const mWater = new Uint8Array(MED_W * MED_H);
// Sample 2×2 block of fine cells (OR logic) — widens narrow straits
// (Hormuz ~33km, Gibraltar) that single-cell sampling misses.
for (let mr = 0; mr < MED_H; mr++) {
    const fr = mr * MED_STRIDE;
    const frRow = fr * FINE_W, fr1Row = (fr + 1) * FINE_W;
    for (let mc = 0; mc < MED_W; mc++) {
        const fc = mc * MED_STRIDE;
        mWater[mr * MED_W + mc] = (owner[frRow + fc] === WATER ||
                                   owner[frRow + fc + 1] === WATER ||
                                   owner[fr1Row + fc] === WATER ||
                                   owner[fr1Row + fc + 1] === WATER) ? 1 : 0;
    }
}
let medWater = 0;
for (let i = 0; i < mWater.length; i++) medWater += mWater[i];
console.log(`  Medium water: ${medWater} / ${mWater.length} (${(100 * medWater / mWater.length).toFixed(1)}%)`);

// ════════════════════════════════════════════════════════════════════════
// STEP 3b: Apply map edits (paint rivers/land) — BEFORE the ocean mask so
// painted water propagates into oceanMask, the highway lattice, AND the
// adaptive densification (painted rivers receive highway nodes for free).
//
// Reads public/data/map_edits.json (exported by the in-game Map Editor):
//   { strokes: [
//       { type:"water"|"land", radius, points:[[lat,lon],...] },
//       { type:"highway_node", lat, lon },
//       { type:"highway_edge", from:[lat,lon], to:[lat,lon] }
//   ] }
// Paint strokes are rasterized here; highway node/edge strokes are collected
// and applied after STEP 7d (densification).
// ════════════════════════════════════════════════════════════════════════
const EDITS_PATH = path.join(OUT_DIR, 'map_edits.json');
const _editHwNodeStrokes = [];   // deferred — applied after densification
const _editHwEdgeStrokes = [];

function latLonToMedRowCol(lat, lon) {
    let col = Math.floor((lon + 180) / MED_DEG);
    let row = Math.floor((90 - lat) / MED_DEG);
    col = ((col % MED_W) + MED_W) % MED_W;
    row = Math.max(0, Math.min(MED_H - 1, row));
    return [row, col];
}
function latLonToFineRowCol(lat, lon) {
    const fineDeg = MED_DEG / MED_STRIDE;            // 0.05° per fine cell
    let col = Math.floor((lon + 180) / fineDeg);
    let row = Math.floor((90 - lat) / fineDeg);
    col = ((col % FINE_W) + FINE_W) % FINE_W;
    row = Math.max(0, Math.min(FINE_H - 1, row));
    return [row, col];
}
function stampMedDisk(row, col, radius, value) {
    for (let dr = -radius; dr <= radius; dr++) {
        const r = row + dr;
        if (r < 0 || r >= MED_H) continue;
        for (let dc = -radius; dc <= radius; dc++) {
            if (dr * dr + dc * dc > radius * radius + radius) continue; // ~circle
            const c = (((col + dc) % MED_W) + MED_W) % MED_W;
            mWater[r * MED_W + c] = value;
        }
    }
}
function stampFineDisk(row, col, radius, value) {
    const fv = (value === 1) ? WATER : NEUTRAL;
    for (let dr = -radius; dr <= radius; dr++) {
        const r = row + dr;
        if (r < 0 || r >= FINE_H) continue;
        for (let dc = -radius; dc <= radius; dc++) {
            if (dr * dr + dc * dc > radius * radius + radius) continue;
            const c = (((col + dc) % FINE_W) + FINE_W) % FINE_W;
            owner[r * FINE_W + c] = fv;
        }
    }
}
// Cells along a line between two medium-grid points (handles lon wrap).
function bresLineMed(r1, c1, r2, c2, out) {
    let dc = c2 - c1;
    if (dc > MED_W / 2) dc -= MED_W;
    if (dc < -MED_W / 2) dc += MED_W;
    const dr = r2 - r1;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    out.length = 0;
    if (steps === 0) { out.push([r1, c1]); return; }
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const r = Math.round(r1 + dr * t);
        let c = Math.round(c1 + dc * t);
        c = ((c % MED_W) + MED_W) % MED_W;
        out.push([r, c]);
    }
}

let _paintStrokesApplied = 0;
if (fs.existsSync(EDITS_PATH)) {
    console.log('[3b/8] Applying map edits (paint rivers/land)...');
    let edits = null;
    try { edits = JSON.parse(fs.readFileSync(EDITS_PATH, 'utf8')); }
    catch (e) { console.warn(`  map_edits.json parse failed: ${e.message} — skipping`); }
    if (edits && Array.isArray(edits.strokes)) {
        const seg = [];                                  // reused scratch
        for (const s of edits.strokes) {
            if (s.type === 'water' || s.type === 'land') {
                const value = (s.type === 'water') ? 1 : 0;
                // radius is in FINE TILES (0.05° each), matching the runtime editor
                // (_mapEditor.radius). Derive the medium-cell radius for the nav mask.
                const tiles = Math.max(0, Math.min(40, s.radius || 1));
                const medR = Math.max(1, Math.round(tiles / MED_STRIDE));
                const pts = Array.isArray(s.points) ? s.points : [];
                let prev = null;
                for (const p of pts) {
                    const [mr, mc] = latLonToMedRowCol(p[0], p[1]);
                    const [fr, fc] = latLonToFineRowCol(p[0], p[1]);
                    stampMedDisk(mr, mc, medR, value);
                    stampFineDisk(fr, fc, tiles, value);
                    if (prev) {
                        bresLineMed(prev[0], prev[1], mr, mc, seg);
                        for (const [rr, cc] of seg) {
                            stampMedDisk(rr, cc, medR, value);
                            stampFineDisk(Math.min(FINE_H - 1, rr * MED_STRIDE),
                                          cc * MED_STRIDE, tiles, value);
                        }
                    }
                    prev = [mr, mc];
                }
                _paintStrokesApplied++;
            } else if (s.type === 'highway_node') {
                _editHwNodeStrokes.push(s);
            } else if (s.type === 'highway_edge') {
                _editHwEdgeStrokes.push(s);
            }
        }
        console.log(`  Applied ${_paintStrokesApplied} paint strokes | ` +
                    `${_editHwNodeStrokes.length} node + ${_editHwEdgeStrokes.length} edge strokes deferred`);
    }
} else {
    console.log('[3b/8] No map_edits.json found — skipping paint step');
}

// ════════════════════════════════════════════════════════════════════════
// STEP 4: Build ocean mask — flood-fill from mid-Pacific seed
// ════════════════════════════════════════════════════════════════════════
console.log('[4/8] Building ocean mask (flood-fill from mid-Pacific)...');
const oceanMask = new Uint8Array(MED_W * MED_H);

let seedCol = Math.floor((-160 + 180) / MED_DEG);
let seedRow = Math.floor((90 - 0) / MED_DEG);
let seed = seedRow * MED_W + seedCol;

if (mWater[seed] !== 1) {
    foundSeed: for (let ring = 1; ring <= 300; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
            const r = seedRow + dy;
            if (r < 0 || r >= MED_H) continue;
            for (let dx = -ring; dx <= ring; dx++) {
                if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                const c = ((seedCol + dx) % MED_W + MED_W) % MED_W;
                if (mWater[r * MED_W + c] === 1) { seed = r * MED_W + c; break foundSeed; }
            }
        }
    }
}

{
    const stack = [seed];
    oceanMask[seed] = 1;
    const dirs8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    while (stack.length) {
        const cc = stack.pop();
        const cr = (cc / MED_W) | 0, ccol = cc % MED_W;
        for (let i = 0; i < 8; i++) {
            const nr = cr + dirs8[i][0];
            if (nr < 0 || nr >= MED_H) continue;
            const nc = ((ccol + dirs8[i][1]) % MED_W + MED_W) % MED_W;
            const nb = nr * MED_W + nc;
            if (mWater[nb] === 1 && !oceanMask[nb]) { oceanMask[nb] = 1; stack.push(nb); }
        }
    }
}
let oceanCount = 0;
for (let i = 0; i < oceanMask.length; i++) oceanCount += oceanMask[i];
console.log(`  Ocean body: ${oceanCount} cells (${(100 * oceanCount / (MED_W * MED_H)).toFixed(1)}% of grid)`);

// ════════════════════════════════════════════════════════════════════════
// STEP 5: Classify — inland water cells + river mouths
// ════════════════════════════════════════════════════════════════════════
console.log('[5/8] Classifying water cells...');
const inlandMask = new Uint8Array(MED_W * MED_H);
let inlandCount = 0;
for (let i = 0; i < mWater.length; i++) {
    if (mWater[i] === 1 && !oceanMask[i]) {
        inlandMask[i] = 1;
        inlandCount++;
    }
}
console.log(`  Inland water: ${inlandCount} cells`);

// River mouths: inland cells with >=1 ocean neighbor (8-connected)
const mouthCells = [];
{
    const dirs8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (let row = 0; row < MED_H; row++) {
        for (let col = 0; col < MED_W; col++) {
            const cell = row * MED_W + col;
            if (!inlandMask[cell]) continue;
            let isMouth = false;
            for (let i = 0; i < 8 && !isMouth; i++) {
                const nr = row + dirs8[i][0];
                if (nr < 0 || nr >= MED_H) continue;
                const nc = ((col + dirs8[i][1]) % MED_W + MED_W) % MED_W;
                if (oceanMask[nr * MED_W + nc]) isMouth = true;
            }
            if (isMouth) mouthCells.push(cell);
        }
    }
}
console.log(`  River mouths: ${mouthCells.length} cells`);

// ════════════════════════════════════════════════════════════════════════
// STEP 6: Multi-source Dijkstra from river mouths -> flow field
// For every inland cell, flow[cell] = next cell toward nearest ocean exit.
// River mouths self-reference: flow[mouth] = mouth.
// ════════════════════════════════════════════════════════════════════════
console.log('[6/8] Multi-source Dijkstra (river mouths -> inland network)...');
const flow = new Int32Array(MED_W * MED_H).fill(-1);
const gScore = new Float32Array(MED_W * MED_H).fill(Infinity);

// Min-heap of [cost, cell]
const heap = [];
for (const cell of mouthCells) {
    gScore[cell] = 0;
    flow[cell] = cell;
    heap.push([0, cell]);
}
// Heapify
for (let i = (heap.length >> 1) - 1; i >= 0; i--) {
    let idx = i;
    for (;;) {
        let m = idx;
        const l = 2 * idx + 1, r = 2 * idx + 2;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === idx) break;
        const t = heap[m]; heap[m] = heap[idx]; heap[idx] = t; idx = m;
    }
}

const dijDirs = [
    [-1,-1,1.414], [-1,0,1.0], [-1,1,1.414],
    [0,-1,1.0],                   [0,1,1.0],
    [1,-1,1.414],  [1,0,1.0],  [1,1,1.414]
];
let processed = 0;

if (BUILD_LEGACY) while (heap.length > 0) {   // dead code — skipped for speed
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
            let m = i; const l = 2 * i + 1, r = 2 * i + 2;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break;
            const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
    }
    const g = top[0], cell = top[1];
    if (g > gScore[cell]) continue;

    processed++;
    const col = cell % MED_W, row = (cell / MED_W) | 0;

    for (let d = 0; d < 8; d++) {
        const nr = row + dijDirs[d][0];
        if (nr < 0 || nr >= MED_H) continue;
        const nc = ((col + dijDirs[d][1]) % MED_W + MED_W) % MED_W;
        const nb = nr * MED_W + nc;
        if (!inlandMask[nb]) continue;
        const tentG = g + dijDirs[d][2];
        if (tentG < gScore[nb]) {
            gScore[nb] = tentG;
            flow[nb] = cell;
            heap.push([tentG, nb]);
            let i = heap.length - 1;
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (heap[p][0] <= heap[i][0]) break;
                const t2 = heap[p]; heap[p] = heap[i]; heap[i] = t2; i = p;
            }
        }
    }
}

let flowEntries = 0;
for (let i = 0; i < flow.length; i++) if (flow[i] !== -1) flowEntries++;
console.log(`  Processed ${processed} cells | flow entries: ${flowEntries}`);

// ════════════════════════════════════════════════════════════════════════
// STEP 7: Build sparse ocean highway graph
// Nodes at every HW_STRIDE cells on ocean. Edges between 8-connected
// neighbors, validated by Bresenham line-of-sight (no edge crosses land).
// ════════════════════════════════════════════════════════════════════════
console.log('[7/8] Building ocean highway graph...');

const hwNodes = [];
const hwGrid = new Int32Array(MED_W * MED_H).fill(-1);

for (let row = 0; row < MED_H; row += HW_STRIDE) {
    for (let col = 0; col < MED_W; col += HW_STRIDE) {
        const cell = row * MED_W + col;
        if (oceanMask[cell]) {
            const idx = hwNodes.length;
            hwNodes.push({
                lat: +(90 - (row + 0.5) * MED_DEG).toFixed(3),
                lon: +(-180 + (col + 0.5) * MED_DEG).toFixed(3),
                cell: cell,
                row: row,
                col: col
            });
            hwGrid[cell] = idx;
        }
    }
}
console.log(`  Highway nodes: ${hwNodes.length}`);

// Bresenham line-of-sight: true if all cells between two points are water.
// Handles longitude wrapping by taking the shortest angular path.
function lineOfSight(r1, c1, r2, c2) {
    let dc = c2 - c1;
    if (dc > MED_W / 2) dc -= MED_W;
    if (dc < -MED_W / 2) dc += MED_W;
    const dr = r2 - r1;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    if (steps === 0) return true;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const r = Math.round(r1 + dr * t);
        let c = Math.round(c1 + dc * t);
        c = ((c % MED_W) + MED_W) % MED_W;
        if (r < 0 || r >= MED_H) return false;
        if (!mWater[r * MED_W + c]) return false;
    }
    return true;
}

// Connect 8-connected neighbors at HW_STRIDE offset
const hwEdges = [];
const nbrOffsets = [
    [-HW_STRIDE, 0], [HW_STRIDE, 0],
    [0, -HW_STRIDE], [0, HW_STRIDE],
    [-HW_STRIDE, -HW_STRIDE], [-HW_STRIDE, HW_STRIDE],
    [HW_STRIDE, -HW_STRIDE], [HW_STRIDE, HW_STRIDE]
];

for (let ni = 0; ni < hwNodes.length; ni++) {
    const node = hwNodes[ni];
    for (let d = 0; d < 8; d++) {
        const nr = node.row + nbrOffsets[d][0];
        const nc = ((node.col + nbrOffsets[d][1]) % MED_W + MED_W) % MED_W;
        if (nr < 0 || nr >= MED_H) continue;
        const nbCell = nr * MED_W + nc;
        const nbIdx = hwGrid[nbCell];
        if (nbIdx < 0 || nbIdx <= ni) continue; // avoid duplicate edges
        if (!lineOfSight(node.row, node.col, nr, nc)) continue;
        const dist = haversineKm(node.lat, node.lon, hwNodes[nbIdx].lat, hwNodes[nbIdx].lon);
        hwEdges.push([ni, nbIdx, Math.round(dist)]);
    }
}
console.log(`  Highway edges: ${hwEdges.length}`);

// Remove isolated nodes (no edges) — they can't route anywhere
{
    const hasEdge = new Uint8Array(hwNodes.length);
    for (const [a, b] of hwEdges) { hasEdge[a] = 1; hasEdge[b] = 1; }
    let isolated = 0;
    for (let i = 0; i < hasEdge.length; i++) if (!hasEdge[i]) isolated++;
    if (isolated > 0) console.log(`  Isolated nodes (no edges): ${isolated} — will be ignored at runtime`);
}

// ════════════════════════════════════════════════════════════════════════
// STEP 7c: Bridge disconnected highway components
//
// The 2° node spacing + Bresenham line-of-sight edges can miss narrow
// maritime chokepoints (Strait of Gibraltar ~13km, Bosporus, Danish
// Straits, etc.), splitting the sparse highway graph into disconnected
// components.  Ships cannot route between components (e.g. Mediterranean
// ↔ Atlantic).
//
// Fix: detect connected components, then for each smaller component run
// a multi-source Dijkstra on the FULL medium water grid (which IS
// connected through the straits at 0.1° resolution) to find the shortest
// all-water bridge path to the largest component.  Sample highway nodes
// along that path and connect them, merging the components.
// ════════════════════════════════════════════════════════════════════════
console.log('[7c] Bridging disconnected highway components...');

function findComponents(nodeCount, edges) {
    const adj = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) adj[i] = [];
    for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
    const compId = new Int32Array(nodeCount).fill(-1);
    const components = [];
    for (let s = 0; s < nodeCount; s++) {
        if (compId[s] !== -1) continue;
        const cid = components.length;
        const members = [];
        const stack = [s];
        compId[s] = cid;
        while (stack.length) {
            const n = stack.pop();
            members.push(n);
            for (const nb of adj[n]) {
                if (compId[nb] === -1) { compId[nb] = cid; stack.push(nb); }
            }
        }
        components.push(members);
    }
    return components;
}

{
    const components = findComponents(hwNodes.length, hwEdges);
    console.log(`  Connected components: ${components.length}`);
    components.forEach((c, i) => {
        if (c.length > 1 || components.length <= 8)
            console.log(`    Component ${i}: ${c.length} nodes`);
    });

    if (components.length > 1) {
        // Largest component = main ocean graph
        components.sort((a, b) => b.length - a.length);
        console.log(`  Largest component: ${components[0].length} nodes`);

        // Set of medium cells belonging to largest component's highway nodes
        const largestCellSet = new Set();
        for (const ni of components[0]) largestCellSet.add(hwNodes[ni].cell);

        const bDirs = [
            [-1,-1,1.414], [-1,0,1.0], [-1,1,1.414],
            [0,-1,1.0],                  [0,1,1.0],
            [1,-1,1.414],  [1,0,1.0],  [1,1,1.414]
        ];

        let bridgesAdded = 0, bridgeNodesAdded = 0, bridgeEdgesAdded = 0;

        // Shared arrays for bridge Dijkstra (Float64 + closed-set avoids the
        // Float32 precision bug that caused premature termination — singletons
        // explored only ~200 cells instead of millions for ocean-connected nodes)
        const _bG = new Float64Array(MED_W * MED_H).fill(Infinity);
        const _bCame = new Int32Array(MED_W * MED_H).fill(-1);
        const _bClosed = new Uint8Array(MED_W * MED_H);

        for (let ci = 1; ci < components.length; ci++) {
            const comp = components[ci];
            if (comp.length === 0) continue;

            // ── Multi-source Dijkstra from this component's highway cells ──
            // Uses shared Float64 arrays + closed-set (resets only visited cells).
            const bH = [];
            const bVisited = [];
            for (const ni of comp) {
                const cell = hwNodes[ni].cell;
                if (_bG[cell] !== 0) {
                    _bG[cell] = 0; _bCame[cell] = -1; _bClosed[cell] = 0;
                    bVisited.push(cell);
                    bH.push([0, cell]);
                }
            }
            let bExpanded = 0;
            let foundCell = -1;
            while (bH.length > 0) {
                const top = bH[0];
                const last = bH.pop();
                if (bH.length > 0) {
                    bH[0] = last;
                    let i = 0;
                    for (;;) {
                        let m = i; const l = 2*i+1, r = 2*i+2;
                        if (l < bH.length && bH[l][0] < bH[m][0]) m = l;
                        if (r < bH.length && bH[r][0] < bH[m][0]) m = r;
                        if (m === i) break;
                        const t = bH[m]; bH[m] = bH[i]; bH[i] = t; i = m;
                    }
                }
                const g = top[0], cell = top[1];
                if (_bClosed[cell]) continue;
                _bClosed[cell] = 1;
                bExpanded++;
                if (largestCellSet.has(cell)) { foundCell = cell; break; }
                const col = cell % MED_W, row = (cell / MED_W) | 0;
                for (let d = 0; d < 8; d++) {
                    const nr = row + bDirs[d][0];
                    if (nr < 0 || nr >= MED_H) continue;
                    const nc = ((col + bDirs[d][1]) % MED_W + MED_W) % MED_W;
                    const nb = nr * MED_W + nc;
                    if (!mWater[nb] || _bClosed[nb]) continue;
                    const tg = g + bDirs[d][2];
                    if (tg < _bG[nb]) {
                        if (_bG[nb] === Infinity) bVisited.push(nb);
                        _bG[nb] = tg;
                        _bCame[nb] = cell;
                        bH.push([tg, nb]);
                        let i = bH.length - 1;
                        while (i > 0) {
                            const p = (i - 1) >> 1;
                            if (bH[p][0] <= bH[i][0]) break;
                            const t = bH[p]; bH[p] = bH[i]; bH[i] = t; i = p;
                        }
                    }
                }
            }
            if (foundCell < 0) {
                const n0 = hwNodes[comp[0]];
                const isOcean = oceanMask[n0.cell];
                console.log(`    Component ${ci} (${comp.length} nodes) at [${n0.lat.toFixed(1)},${n0.lon.toFixed(1)}]: ` +
                            `no bridge (explored ${bExpanded} cells) — ${isOcean ? '⚠️ OCEAN but isolated!' : 'inland sea'}`);
                continue;
            }

            // ── Reconstruct bridge path (smaller → largest) ──
            const path = [];
            let c = foundCell;
            while (c !== -1) { path.push(c); c = _bCame[c]; }
            path.reverse(); // now [smallerCompCell, ..., largestCompCell]

            // ── Sample highway nodes along the path ──
            // Endpoints are existing highway nodes.  Add intermediate nodes
            // every 3 cells so straight-line segments stay in the water corridor.
            const bridgeIds = [];
            let lastSampled = -3;
            for (let pi = 0; pi < path.length; pi++) {
                const cell = path[pi];
                const existing = hwGrid[cell];
                const isEndpoint = (pi === 0 || pi === path.length - 1);
                if (existing >= 0) {
                    bridgeIds.push(existing);
                    lastSampled = pi;
                } else if (isEndpoint) {
                    // Endpoint without a highway node — create one
                    const row = (cell / MED_W) | 0, col = cell % MED_W;
                    const idx = hwNodes.length;
                    hwNodes.push({
                        lat: +(90 - (row + 0.5) * MED_DEG).toFixed(3),
                        lon: +(-180 + (col + 0.5) * MED_DEG).toFixed(3),
                        cell: cell, row: row, col: col
                    });
                    hwGrid[cell] = idx;
                    bridgeIds.push(idx);
                    bridgeNodesAdded++;
                } else if (pi - lastSampled >= 3) {
                    const row = (cell / MED_W) | 0, col = cell % MED_W;
                    const idx = hwNodes.length;
                    hwNodes.push({
                        lat: +(90 - (row + 0.5) * MED_DEG).toFixed(3),
                        lon: +(-180 + (col + 0.5) * MED_DEG).toFixed(3),
                        cell: cell, row: row, col: col
                    });
                    hwGrid[cell] = idx;
                    bridgeIds.push(idx);
                    lastSampled = pi;
                    bridgeNodesAdded++;
                }
            }

            // ── Connect consecutive bridge nodes with edges ──
            for (let bi = 0; bi < bridgeIds.length - 1; bi++) {
                const a = bridgeIds[bi], b = bridgeIds[bi + 1];
                if (a === b) continue;
                const dist = haversineKm(hwNodes[a].lat, hwNodes[a].lon,
                                         hwNodes[b].lat, hwNodes[b].lon);
                hwEdges.push([a, b, Math.round(dist)]);
                bridgeEdgesAdded++;
            }

            // Reset shared arrays for next component (MUST be after path reconstruction!)
            for (let i = 0; i < bVisited.length; i++) {
                const c = bVisited[i];
                _bG[c] = Infinity; _bCame[c] = -1; _bClosed[c] = 0;
            }

            bridgesAdded++;
            const sN = hwNodes[bridgeIds[0]];
            const eN = hwNodes[bridgeIds[bridgeIds.length - 1]];
            console.log(`    Component ${ci} (${comp.length} nodes): bridged via ${path.length}-cell path (exp ${bExpanded}) ` +
                        `[${sN.lat.toFixed(1)},${sN.lon.toFixed(1)}]→[${eN.lat.toFixed(1)},${eN.lon.toFixed(1)}]`);
        }
        console.log(`  Bridges: ${bridgesAdded} | new nodes: ${bridgeNodesAdded} | new edges: ${bridgeEdgesAdded}`);

        // ── Verify connectivity after bridging ──
        const postComponents = findComponents(hwNodes.length, hwEdges);
        console.log(`  Post-bridge components: ${postComponents.length}`);
        if (postComponents.length > 1) {
            postComponents.sort((a, b) => b.length - a.length);
            console.log(`  Remaining disconnected components (enclosed seas):`);
            for (let i = 1; i < Math.min(postComponents.length, 6); i++) {
                const n = hwNodes[postComponents[i][0]];
                console.log(`    ${postComponents[i].length} nodes near [${n.lat.toFixed(1)},${n.lon.toFixed(1)}]`);
            }
        }
    }
}
console.log(`  Highway nodes (after bridging): ${hwNodes.length}`);
console.log(`  Highway edges (after bridging): ${hwEdges.length}`);

// ════════════════════════════════════════════════════════════════════════
// STEP 7d: Adaptive highway densification (farthest-point sampling)
//
// The 2° lattice (STEP 7) only places a node where a grid intersection lands
// on ocean. Navigable rivers/straits/canals that weave between intersections
// get ZERO nodes, so ships must bounded-Dijkstra the whole length (slow, may
// hit the runtime maxNodes cap). This pass finds water cells far from any
// highway node via multi-source BFS and extends the graph into them by tracing
// the all-water path back to the graph and sampling nodes along it.
//
// Connectivity is guaranteed: every traced path is water-connected to an
// existing highway node, and consecutive sampled nodes are only
// DENSIFY_SAMPLE_EVERY cells apart so Bresenham line-of-sight holds.
// ════════════════════════════════════════════════════════════════════════
console.log('[7d/9] Adaptive highway densification (farthest-point sampling)...');

const densDirs = [
    [-1,-1], [-1,0], [-1,1],
    [0,-1],         [0,1],
    [1,-1],  [1,0],  [1,1]
];

// Reusable BFS buffers (allocated once; reset only visited cells each pass).
const _dQueue = new Int32Array(MED_W * MED_H);
const _dDist  = new Int32Array(MED_W * MED_H).fill(-1);
const _dCame  = new Int32Array(MED_W * MED_H).fill(-1);

// Multi-source BFS from every highway node across mWater. Fills _dDist/_dCame
// for all water cells reachable from the graph and returns the visited list +
// the farthest cell. Caller MUST resetCoverage(visited) when done.
function coverageBFS() {
    let head = 0, tail = 0;
    const visited = [];
    for (let ni = 0; ni < hwNodes.length; ni++) {
        const cell = hwNodes[ni].cell;
        if (_dDist[cell] !== -1) continue;          // dedupe (one node per cell)
        _dDist[cell] = 0;
        _dCame[cell] = -1;
        _dQueue[tail++] = cell;
        visited.push(cell);
    }
    let maxDist = 0, maxCell = -1;
    while (head < tail) {
        const cell = _dQueue[head++];
        const d = _dDist[cell];
        if (d > maxDist) { maxDist = d; maxCell = cell; }
        const col = cell % MED_W, row = (cell / MED_W) | 0;
        for (let k = 0; k < 8; k++) {
            const nr = row + densDirs[k][0];
            if (nr < 0 || nr >= MED_H) continue;
            const nc = (((col + densDirs[k][1]) % MED_W) + MED_W) % MED_W;
            const nb = nr * MED_W + nc;
            if (!mWater[nb] || _dDist[nb] !== -1) continue;
            _dDist[nb] = d + 1;
            _dCame[nb] = cell;
            _dQueue[tail++] = nb;
            visited.push(nb);
        }
    }
    return { maxDist, maxCell, visited };
}

function resetCoverage(visited) {
    for (let i = 0; i < visited.length; i++) {
        const c = visited[i];
        _dDist[c] = -1;
        _dCame[c] = -1;
    }
}

// Add a highway node at a medium cell (no-op if one already exists there).
// Returns the node index.
function addHighwayNodeAt(cell) {
    let idx = hwGrid[cell];
    if (idx >= 0) return idx;
    const row = (cell / MED_W) | 0, col = cell % MED_W;
    idx = hwNodes.length;
    hwNodes.push({
        lat: +(90 - (row + 0.5) * MED_DEG).toFixed(3),
        lon: +(-180 + (col + 0.5) * MED_DEG).toFixed(3),
        cell: cell, row: row, col: col
    });
    hwGrid[cell] = idx;
    return idx;
}

// Connect two highway nodes with a LOS-validated edge (no-op if same node).
function connectHighway(a, b) {
    if (a === b) return;
    const na = hwNodes[a], nb = hwNodes[b];
    if (!lineOfSight(na.row, na.col, nb.row, nb.col)) return;
    hwEdges.push([a, b, Math.round(haversineKm(na.lat, na.lon, nb.lat, nb.lon))]);
}

// ── Seed inland water components (disconnected from the ocean) so each gets
//    its own connected highway sub-graph → ports on the same inland sea/lake
//    can trade with each other even without an ocean connection. The main
//    densification loop below then floods + densifies these components too. ──
console.log('[7f] Seeding inland water components (for intra-body trade)...');
{
    const compId = new Int32Array(MED_W * MED_H).fill(-1);
    const compSeed = [];                          // first cell of each component
    const compSize = [];
    const q = new Int32Array(MED_W * MED_H);
    let nComp = 0;
    const iDirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (let start = 0; start < mWater.length; start++) {
        if (!mWater[start] || compId[start] !== -1) continue;
        let head = 0, tail = 0;
        compId[start] = nComp;
        q[tail++] = start;
        let size = 0;
        while (head < tail) {
            const cell = q[head++];
            size++;
            const col = cell % MED_W, row = (cell / MED_W) | 0;
            for (let k = 0; k < 8; k++) {
                const nr = row + iDirs[k][0];
                if (nr < 0 || nr >= MED_H) continue;
                const nc = (((col + iDirs[k][1]) % MED_W) + MED_W) % MED_W;
                const nb = nr * MED_W + nc;
                if (!mWater[nb] || compId[nb] !== -1) continue;
                compId[nb] = nComp;
                q[tail++] = nb;
            }
        }
        compSeed[nComp] = start;
        compSize[nComp] = size;
        nComp++;
    }
    // Mark components that already contain a highway node (ocean-connected).
    const compHasHw = new Uint8Array(nComp);
    for (const node of hwNodes) {
        if (node.cell >= 0 && compId[node.cell] >= 0) compHasHw[compId[node.cell]] = 1;
    }
    let seeded = 0;
    for (let c = 0; c < nComp; c++) {
        if (!compHasHw[c] && compSize[c] >= INLAND_MIN_SIZE) {
            addHighwayNodeAt(compSeed[c]);
            seeded++;
        }
    }
    console.log(`  Water components: ${nComp} | inland seeded: ${seeded} ` +
                `(>= ${INLAND_MIN_SIZE} cells) | highway nodes now: ${hwNodes.length}`);
}

let densAdded = 0;
for (let iter = 0; iter < DENSIFY_MAX_ITER; iter++) {
    const { maxDist, visited } = coverageBFS();

    // Iteration 0: log coverage distribution for tuning.
    if (iter === 0) {
        let above12 = 0, above16 = 0, above24 = 0;
        for (let i = 0; i < visited.length; i++) {
            const d = _dDist[visited[i]];
            if (d > 12) above12++;
            if (d > 16) above16++;
            if (d > 24) above24++;
        }
        console.log(`  Coverage baseline: max ${maxDist} hops | ` +
                    `cells >12:${above12} >16:${above16} >24:${above24} (of ${visited.length} water)`);
    }

    if (maxDist <= DENSIFY_RADIUS) {
        resetCoverage(visited);
        console.log(`  iter ${iter}: max coverage ${maxDist} hops <= ${DENSIFY_RADIUS} — converged`);
        break;
    }

    // Collect local-maxima seeds above the radius (spread out, one per ridge).
    const seeds = [];
    for (let i = 0; i < visited.length; i++) {
        const cell = visited[i];
        const d = _dDist[cell];
        if (d < DENSIFY_RADIUS) continue;
        const col = cell % MED_W, row = (cell / MED_W) | 0;
        let isMax = true;
        for (let k = 0; k < 8; k++) {
            const nr = row + densDirs[k][0];
            if (nr < 0 || nr >= MED_H) continue;
            const nc = (((col + densDirs[k][1]) % MED_W) + MED_W) % MED_W;
            const nb = nr * MED_W + nc;
            if (mWater[nb] && _dDist[nb] > d) { isMax = false; break; }
        }
        if (isMax) seeds.push(cell);
    }
    seeds.sort((a, b) => _dDist[b] - _dDist[a]);
    const chosen = seeds.slice(0, DENSIFY_SEEDS_PER_IT);

    let addedThisIter = 0;
    for (const seed of chosen) {
        if (densAdded >= DENSIFY_MAX_NODES) break;

        // Trace came[] from seed back to the nearest existing highway node.
        const path = [];
        let c = seed, guard = 0;
        while (c !== -1 && hwGrid[c] < 0 && guard++ < 100000) {
            path.push(c);
            c = _dCame[c];
        }
        if (c === -1 || hwGrid[c] < 0) continue;    // unreachable (shouldn't happen)
        const anchorIdx = hwGrid[c];

        // Walk anchor → seed, placing a node every DENSIFY_SAMPLE_EVERY cells and
        // adaptively at bends (when LOS to the next cell would break) so every
        // edge has line-of-sight.
        path.reverse();                              // now [nearAnchor, ..., seed]
        let prevIdx = anchorIdx;
        let prevR = hwNodes[anchorIdx].row, prevC = hwNodes[anchorIdx].col;
        let sinceNode = 0;
        for (let i = 0; i < path.length; i++) {
            const cell = path[i];
            const r = (cell / MED_W) | 0, col = cell % MED_W;
            sinceNode++;
            const isEnd = (i === path.length - 1);

            // Look ahead: if LOS from the current prev node to the NEXT path
            // cell would cross land, we must anchor a node HERE first.
            let losBreaksNext = false;
            if (!isEnd) {
                const nCell = path[i + 1];
                const nr = (nCell / MED_W) | 0, nc = nCell % MED_W;
                if (!lineOfSight(prevR, prevC, nr, nc)) losBreaksNext = true;
            }

            if (isEnd || sinceNode >= DENSIFY_SAMPLE_EVERY || losBreaksNext) {
                const idx = addHighwayNodeAt(cell);
                if (idx === hwNodes.length - 1 || idx !== prevIdx) {
                    // idx is new (or distinct) — connect to prevIdx.
                    if (idx !== prevIdx) {
                        connectHighway(prevIdx, idx);
                        if (idx === hwNodes.length - 1) { densAdded++; addedThisIter++; }
                    }
                }
                prevIdx = idx;
                prevR = hwNodes[idx].row;
                prevC = hwNodes[idx].col;
                sinceNode = 0;
            }
        }
    }

    resetCoverage(visited);
    console.log(`  iter ${iter}: max ${maxDist} hops | seeds ${chosen.length} | ` +
                `+${addedThisIter} nodes (total added ${densAdded})`);
    if (densAdded >= DENSIFY_MAX_NODES) {
        console.log(`  hit DENSIFY_MAX_NODES cap (${DENSIFY_MAX_NODES}) — stopping`);
        break;
    }
}
console.log(`  Densification complete: +${densAdded} highway nodes ` +
            `(${hwNodes.length} total, ${hwEdges.length} edges)`);

// Report component structure. After STEP 7f, multiple components are EXPECTED:
// 1 ocean-connected mega-component + N inland water bodies (lakes/inland seas),
// each with its own connected sub-graph for intra-body trade. We only warn if
// the largest component is unexpectedly small (real fragmentation).
{
    const comps = findComponents(hwNodes.length, hwEdges);
    comps.sort((a, b) => b.length - a.length);
    const largest = comps[0].length;
    const total = hwNodes.length;
    const inland = comps.length - 1;
    let inlandNodes = 0;
    for (let i = 1; i < comps.length; i++) inlandNodes += comps[i].length;
    console.log(`  Post-densification components: ${comps.length} ` +
                `(1 ocean: ${largest} nodes${inland ? ` + ${inland} inland bodies: ${inlandNodes} nodes` : ''})`);
    // Only warn on genuine fragmentation: largest component holds < 80% of nodes
    // AND there are inland components we did NOT intentionally seed.
    if (largest < total * 0.8) {
        console.log(`  ⚠️ Largest component holds only ${((largest / total) * 100).toFixed(1)}% of nodes — ` +
                    `possible fragmentation; check DENSIFY_SAMPLE_EVERY / LOS gaps`);
    }
}

// ════════════════════════════════════════════════════════════════════════
// STEP 7e: Apply deferred highway node/edge edits (from map_edits.json).
// Paint strokes were rasterized in STEP 3b; these graph edits are applied
// after densification so they sit on top of the final node set.
// ════════════════════════════════════════════════════════════════════════
if (_editHwNodeStrokes.length || _editHwEdgeStrokes.length) {
    console.log(`[7e] Applying ${_editHwNodeStrokes.length} node + ${_editHwEdgeStrokes.length} edge edits...`);
    const editNodeByKey = new Map();
    for (const s of _editHwNodeStrokes) {
        const [mr, mc] = latLonToMedRowCol(s.lat, s.lon);
        const cell = mr * MED_W + mc;
        if (!mWater[cell]) mWater[cell] = 1;            // ensure navigable
        const idx = addHighwayNodeAt(cell);
        editNodeByKey.set(`${+(s.lat).toFixed(3)},${+(s.lon).toFixed(3)}`, idx);
        // Connect to nearest line-of-sight highway node (41×41 window).
        let bestIdx = -1, bestD = Infinity;
        for (let dr = -20; dr <= 20; dr++) {
            const r = mr + dr;
            if (r < 0 || r >= MED_H) continue;
            for (let dc = -20; dc <= 20; dc++) {
                const c = (((mc + dc) % MED_W) + MED_W) % MED_W;
                const nb = hwGrid[r * MED_W + c];
                if (nb < 0 || nb === idx) continue;
                const d = dr * dr + dc * dc;
                if (d < bestD && lineOfSight(mr, mc, r, c)) { bestD = d; bestIdx = nb; }
            }
        }
        if (bestIdx >= 0) connectHighway(idx, bestIdx);
    }
    for (const s of _editHwEdgeStrokes) {
        const a = editNodeByKey.get(`${+(s.from[0]).toFixed(3)},${+(s.from[1]).toFixed(3)}`);
        const b = editNodeByKey.get(`${+(s.to[0]).toFixed(3)},${+(s.to[1]).toFixed(3)}`);
        if (a !== undefined && b !== undefined) connectHighway(a, b);
    }
    console.log(`  Edit nodes applied | nodes: ${hwNodes.length} | edges: ${hwEdges.length}`);
}

// ════════════════════════════════════════════════════════════════════════
// STEP 7b: Flow field — multi-source Dijkstra from ALL highway nodes into
// ALL water cells. For every water cell, stores a direction code (0-7)
// pointing toward the nearest highway node. At runtime, following these
// directions gives a pre-computed path — ZERO runtime Dijkstra needed.
//
// Encoding (Uint8Array):
//   0-7  = direction to next cell toward nearest highway node
//   8    = this cell IS a highway node (destination reached)
//   255  = land (not navigable)
// ════════════════════════════════════════════════════════════════════════
console.log('[7b/9] Building flow field (multi-source Dijkstra from highway nodes)...');

const flowField = new Uint8Array(MED_W * MED_H).fill(255); // 255 = land
const ffGScore = new Float32Array(MED_W * MED_H).fill(Infinity);
const ffHeap = [];

// Seed all highway nodes as sources (cost 0)
for (const node of hwNodes) {
    ffGScore[node.cell] = 0;
    flowField[node.cell] = 8; // 8 = highway node marker
    ffHeap.push([0, node.cell]);
}
// Heapify
for (let i = (ffHeap.length >> 1) - 1; i >= 0; i--) {
    let idx = i;
    for (;;) {
        let m = idx; const l = 2 * idx + 1, r = 2 * idx + 2;
        if (l < ffHeap.length && ffHeap[l][0] < ffHeap[m][0]) m = l;
        if (r < ffHeap.length && ffHeap[r][0] < ffHeap[m][0]) m = r;
        if (m === idx) break;
        const t = ffHeap[m]; ffHeap[m] = ffHeap[idx]; ffHeap[idx] = t; idx = m;
    }
}

let ffProcessed = 0;
if (BUILD_LEGACY) while (ffHeap.length > 0) {  // dead code — skipped for speed
    const top = ffHeap[0];
    const last = ffHeap.pop();
    if (ffHeap.length > 0) {
        ffHeap[0] = last;
        let i = 0;
        for (;;) {
            let m = i; const l = 2 * i + 1, r = 2 * i + 2;
            if (l < ffHeap.length && ffHeap[l][0] < ffHeap[m][0]) m = l;
            if (r < ffHeap.length && ffHeap[r][0] < ffHeap[m][0]) m = r;
            if (m === i) break;
            const t = ffHeap[m]; ffHeap[m] = ffHeap[i]; ffHeap[i] = t; i = m;
        }
    }
    const g = top[0], cell = top[1];
    if (g > ffGScore[cell]) continue;
    ffProcessed++;
    const col = cell % MED_W, row = (cell / MED_W) | 0;
    for (let d = 0; d < 8; d++) {
        const nr = row + dijDirs[d][0];
        if (nr < 0 || nr >= MED_H) continue;
        const nc = ((col + dijDirs[d][1]) % MED_W + MED_W) % MED_W;
        const nb = nr * MED_W + nc;
        if (!mWater[nb]) continue; // skip land
        const tentG = g + dijDirs[d][2];
        if (tentG < ffGScore[nb]) {
            ffGScore[nb] = tentG;
            flowField[nb] = 7 - d; // reverse direction: from nb toward cell (toward highway)
            ffHeap.push([tentG, nb]);
            let i = ffHeap.length - 1;
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (ffHeap[p][0] <= ffHeap[i][0]) break;
                const t2 = ffHeap[p]; ffHeap[p] = ffHeap[i]; ffHeap[i] = t2; i = p;
            }
        }
    }
}

let ffWaterCells = 0;
for (let i = 0; i < flowField.length; i++) if (flowField[i] !== 255) ffWaterCells++;
console.log(`  Processed ${ffProcessed} cells | water cells with flow: ${ffWaterCells}`);

// ════════════════════════════════════════════════════════════════════════
// STEP 8: Write output files
// ════════════════════════════════════════════════════════════════════════
console.log('[8/9] Writing output files...');

// ── river_routes.json ──
const mouthCoords = mouthCells.map(cell => {
    const row = (cell / MED_W) | 0, col = cell % MED_W;
    return [
        +(90 - (row + 0.5) * MED_DEG).toFixed(3),
        +(-180 + (col + 0.5) * MED_DEG).toFixed(3)
    ];
});

// Sparse flow map: { "cellIndex": nextCellIndex, ... }
const flowMap = {};
for (let i = 0; i < flow.length; i++) {
    if (flow[i] !== -1) {
        flowMap[String(i)] = flow[i];
    }
}

const riverData = {
    gridW: MED_W,
    gridH: MED_H,
    cellDeg: MED_DEG,
    mouths: mouthCoords,
    flow: flowMap
};

const riverPath = path.join(OUT_DIR, 'river_routes.json');
fs.writeFileSync(riverPath, JSON.stringify(riverData));
const riverSize = fs.statSync(riverPath).size;
console.log(`  river_routes.json: ${(riverSize / 1048576).toFixed(2)} MB | mouths: ${mouthCoords.length} | flow entries: ${flowEntries}`);

// ── ocean_highways.json ──
const hwData = {
    cellDeg: MED_DEG,
    stride: HW_STRIDE,
    nodes: hwNodes.map(n => ({
        lat: n.lat,
        lon: n.lon,
        cell: n.cell
    })),
    edges: hwEdges
};

const hwPath = path.join(OUT_DIR, 'ocean_highways.json');
fs.writeFileSync(hwPath, JSON.stringify(hwData));
const hwSize = fs.statSync(hwPath).size;
console.log(`  ocean_highways.json: ${(hwSize / 1048576).toFixed(2)} MB | nodes: ${hwNodes.length} | edges: ${hwEdges.length}`);

// ── flowfield.bin (binary Uint8Array — direction codes for every cell) ──
const ffPath = path.join(OUT_DIR, 'flowfield.bin');
fs.writeFileSync(ffPath, Buffer.from(flowField.buffer));
const ffSize = fs.statSync(ffPath).size;
console.log(`  flowfield.bin: ${(ffSize / 1048576).toFixed(2)} MB | ${ffWaterCells} water cells with flow`);

// ── Summary ──
console.log('\n=== SUMMARY ===');
console.log(`Fine grid water:    ${(100 * fineWater / owner.length).toFixed(1)}%`);
console.log(`Medium grid water:  ${(100 * medWater / mWater.length).toFixed(1)}%`);
console.log(`Ocean body:         ${(100 * oceanCount / (MED_W * MED_H)).toFixed(1)}%`);
console.log(`Inland water:       ${inlandCount} cells`);
console.log(`River mouths:       ${mouthCells.length}`);
console.log(`Flow field entries: ${flowEntries}`);
console.log(`Highway nodes:      ${hwNodes.length}`);
console.log(`Highway edges:      ${hwEdges.length}`);
console.log(`Flow field cells:   ${ffWaterCells}`);
console.log(`river_routes.json:  ${(riverSize / 1048576).toFixed(2)} MB`);
console.log(`ocean_highways.json:${(hwSize / 1048576).toFixed(2)} MB`);
console.log(`flowfield.bin:      ${(ffSize / 1048576).toFixed(2)} MB`);

// Spot-check: print some river mouth coordinates
if (mouthCoords.length > 0) {
    console.log('\nSample river mouths (first 10):');
    for (let i = 0; i < Math.min(10, mouthCoords.length); i++) {
        console.log(`  [${mouthCoords[i][0].toFixed(1)}, ${mouthCoords[i][1].toFixed(1)}]`);
    }
}

// Spot-check: print some highway node coordinates
if (hwNodes.length > 0) {
    console.log('\nSample highway nodes (first 10):');
    for (let i = 0; i < Math.min(10, hwNodes.length); i++) {
        console.log(`  [${hwNodes[i].lat.toFixed(1)}, ${hwNodes[i].lon.toFixed(1)}]`);
    }
}

console.log('\n✅ Done!');
