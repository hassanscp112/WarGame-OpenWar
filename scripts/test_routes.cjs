#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════
// test_routes.cjs — Offline HPA Pathfinding Integration Test
//
// Places a "port" at shoreline points around the globe and tests whether
// findHPAPath() can route between them. Logs every failure with
// coordinates and the phase that failed. This catches disconnected ocean
// basins, enclosed seas, and chokepoint issues without running the game.
//
// The pathfinding logic is an EXACT replica of src/main.js:
//   boundedMedDijkstra, findHighwayPath, findHPAPath, _nearestHighwayNode
// ════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ── Grid constants (must match main.js + build_river_routes.cjs) ──
const FINE_W = 7200, FINE_H = 3600;
const MED_W  = 3600, MED_H  = 1800;
const MED_DEG = 0.1, MED_STRIDE = 2;
const SRC_W  = 4108, SRC_H  = 1948;
const DILATION_RINGS = 1;
const DILATION_MIN_NBR = 1;
const WATER = 0, NEUTRAL = 1;

const OUT_DIR     = path.join(__dirname, '..', 'public', 'data');
const TERRAIN_BIN = path.join(OUT_DIR, 'openfront_terrain_corrected.bin');
const HW_JSON     = path.join(OUT_DIR, 'ocean_highways.json');

// ════════════════════════════════════════════════════════════════════════
// Utility
// ════════════════════════════════════════════════════════════════════════
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*toRad)*Math.cos(lat2*toRad)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function medToLatLon(cell) {
    return {
        lat: 90 - (Math.floor(cell / MED_W) + 0.5) * MED_DEG,
        lon: -180 + ((cell % MED_W) + 0.5) * MED_DEG,
    };
}

// ════════════════════════════════════════════════════════════════════════
// STEP 1: Load terrain → fine grid → dilate → medium grid (2×2 block)
// ════════════════════════════════════════════════════════════════════════
console.log('[TEST] Loading terrain binary...');
const terrainBuf = fs.readFileSync(TERRAIN_BIN);
const owner = new Uint8Array(FINE_W * FINE_H);
{
    const sx = SRC_W / FINE_W, sy = SRC_H / FINE_H;
    for (let row = 0; row < FINE_H; row++) {
        const srcRow = Math.min(SRC_H - 1, ((row + 0.5) * sy) | 0);
        const srcBase = srcRow * SRC_W, rowBase = row * FINE_W;
        for (let col = 0; col < FINE_W; col++) {
            const srcCol = ((col + 0.5) * sx) | 0;
            owner[rowBase + col] = (terrainBuf[srcBase + srcCol] & 0x80) ? NEUTRAL : WATER;
        }
    }
}
// Dilate water
for (let ring = 0; ring < DILATION_RINGS; ring++) {
    const snap = owner.slice();
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
            if (wn >= DILATION_MIN_NBR) owner[cell] = WATER;
        }
    }
}
// Medium grid — 2×2 block OR sampling (matches main.js)
const mWater = new Uint8Array(MED_W * MED_H);
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
console.log('[TEST] Medium grid built.');

const dirs8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

// Build ocean mask (flood-fill from mid-Pacific — same as build_river_routes.cjs)
console.log('[TEST] Building ocean mask...');
const oceanMask = new Uint8Array(MED_W * MED_H);
{
    let seedCol = Math.floor((-160 + 180) / MED_DEG);
    let seedRow = Math.floor((90 - 0) / MED_DEG);
    let seed = seedRow * MED_W + seedCol;
    if (!mWater[seed]) {
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
    const stack = [seed];
    oceanMask[seed] = 1;
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
console.log('[TEST] Ocean cells:', oceanCount, '(' + (100 * oceanCount / (MED_W * MED_H)).toFixed(1) + '%)');

// ════════════════════════════════════════════════════════════════════════
// STEP 2: Load highway graph
// ════════════════════════════════════════════════════════════════════════
console.log('[TEST] Loading ocean_highways.json...');
const hwData = JSON.parse(fs.readFileSync(HW_JSON, 'utf8'));
const hwNodes = hwData.nodes;
const hwAdj = new Array(hwNodes.length);
for (let i = 0; i < hwNodes.length; i++) hwAdj[i] = [];
for (const [a, b, dist] of hwData.edges) {
    hwAdj[a].push({ to: b, dist });
    hwAdj[b].push({ to: a, dist });
}
const hwCellSet = new Set();
for (const node of hwNodes) {
    const col = Math.min(MED_W - 1, Math.max(0, Math.floor((node.lon + 180) / MED_DEG)));
    const row = Math.min(MED_H - 1, Math.max(0, Math.floor((90 - node.lat) / MED_DEG)));
    hwCellSet.add(row * MED_W + col);
}
console.log('[TEST] Highway graph loaded | nodes:', hwNodes.length, '| edges:', hwData.edges.length);

// ════════════════════════════════════════════════════════════════════════
// STEP 2b: Detect highway components (DFS) — tells us which ocean basins
// are genuinely disconnected vs which failures are bugs.
// ════════════════════════════════════════════════════════════════════════
const nodeComp = new Int32Array(hwNodes.length).fill(-1);
let numComp = 0;
const compSizes = [];
for (let s = 0; s < hwNodes.length; s++) {
    if (nodeComp[s] !== -1) continue;
    const cid = numComp++;
    let sz = 0;
    const stk = [s];
    nodeComp[s] = cid;
    while (stk.length) {
        const n = stk.pop();
        sz++;
        for (let e = 0; e < hwAdj[n].length; e++) {
            const t = hwAdj[n][e].to;
            if (nodeComp[t] === -1) { nodeComp[t] = cid; stk.push(t); }
        }
    }
    compSizes.push(sz);
}
const compSorted = compSizes.map((sz, i) => ({ id: i, size: sz })).sort((a, b) => b.size - a.size);
const mainCompId = compSorted[0].id;
console.log('[TEST] Highway components:', numComp, '| main comp #' + mainCompId + ':', compSorted[0].size, 'nodes');
if (numComp > 1) {
    console.log('  Component sizes:', compSorted.map(c => c.size).join(', '));
}

// ════════════════════════════════════════════════════════════════════════
// STEP 3: Pathfinding functions (EXACT replica of main.js)
// ════════════════════════════════════════════════════════════════════════

// Shared typed arrays for boundedMedDijkstra
const _mGScore = new Float32Array(MED_W * MED_H).fill(Infinity);
const _mCameFrom = new Int32Array(MED_W * MED_H).fill(-1);
const _mClosed = new Uint8Array(MED_W * MED_H);
let _mVisited = [];

// Shared typed arrays for highway Dijkstra
let _hwGScore = new Float64Array(hwNodes.length).fill(Infinity);
let _hwCameFrom = new Int32Array(hwNodes.length).fill(-1);
let _hwClosed = new Uint8Array(hwNodes.length);

function nearestMedWater(lat, lon, maxRing) {
    const col = Math.min(MED_W - 1, Math.max(0, Math.floor((lon + 180) / MED_DEG)));
    const row = Math.min(MED_H - 1, Math.max(0, Math.floor((90 - lat) / MED_DEG)));
    const cell = row * MED_W + col;
    if (mWater[cell]) return cell;
    for (let ring = 1; ring <= maxRing; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
            const r = row + dy;
            if (r < 0 || r >= MED_H) continue;
            for (let dx = -ring; dx <= ring; dx++) {
                if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                const c = (((col + dx) % MED_W) + MED_W) % MED_W;
                const mc = r * MED_W + c;
                if (mWater[mc]) return mc;
            }
        }
    }
    return -1;
}

// Spatial grid index for O(1) nearest-highway-node lookup
const HW_BUCKET = 5; // degrees per bucket
const _hwGrid = new Map();
for (let i = 0; i < hwNodes.length; i++) {
    const br = Math.floor(hwNodes[i].lat / HW_BUCKET);
    const bc = Math.floor(hwNodes[i].lon / HW_BUCKET);
    const key = br + ',' + bc;
    if (!_hwGrid.has(key)) _hwGrid.set(key, []);
    _hwGrid.get(key).push(i);
}

function nearestHighwayNode(lat, lon) {
    const br = Math.floor(lat / HW_BUCKET), bc = Math.floor(lon / HW_BUCKET);
    let bestIdx = -1, bestDist = Infinity;
    for (let ring = 0; ring <= 8; ring++) {
        for (let dr = -ring; dr <= ring; dr++) {
            for (let dc = -ring; dc <= ring; dc++) {
                if (ring > 0 && Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;
                const bucket = _hwGrid.get((br + dr) + ',' + (bc + dc));
                if (!bucket) continue;
                for (let bi = 0; bi < bucket.length; bi++) {
                    const idx = bucket[bi];
                    const d = haversineKm(lat, lon, hwNodes[idx].lat, hwNodes[idx].lon);
                    if (d < bestDist) { bestDist = d; bestIdx = idx; }
                }
            }
        }
        if (bestIdx >= 0 && ring >= 1) break; // found in inner ring — good enough
    }
    return bestIdx;
}

// A* heuristic: Euclidean distance in grid steps (admissible since diagonal cost ≥ √2).
function medHeuristic(cell, targetLat, targetLon) {
    const r = (cell / MED_W) | 0;
    const c = cell % MED_W;
    const tr = Math.round((90 - targetLat) / MED_DEG);
    const tc = Math.round((targetLon + 180) / MED_DEG);
    const dr = r - tr, dc = c - tc;
    const dcw = Math.abs(dc) > MED_W * 0.5 ? dc - Math.sign(dc) * MED_W : dc;
    return Math.sqrt(dr * dr + dcw * dcw);
}

function boundedMedDijkstra(startCell, targetSet, maxNodes, targetCell) {
    if (!mWater[startCell]) return null;
    // Reset visited cells
    for (let i = 0; i < _mVisited.length; i++) {
        const c = _mVisited[i];
        _mGScore[c] = Infinity; _mCameFrom[c] = -1; _mClosed[c] = 0;
    }
    _mVisited = [];
    _mGScore[startCell] = 0; _mVisited.push(startCell);
    // A* heuristic support: when targetCell provided, use directional search.
    const useAStar = (targetCell !== undefined && targetCell >= 0);
    let hLat = 0, hLon = 0;
    if (useAStar) {
        const ll = medToLatLon(targetCell);
        hLat = ll.lat; hLon = ll.lon;
    }
    const initF = useAStar ? medHeuristic(startCell, hLat, hLon) : 0;
    const heap = [[initF, startCell]];
    let expanded = 0;
    while (heap.length > 0) {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                let m = i; const l = 2*i+1, r = 2*i+2;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
            }
        }
        const cell = top[1];
        if (_mClosed[cell]) continue;
        _mClosed[cell] = 1;
        if (targetSet.has(cell)) {
            const path = []; let c = cell;
            while (c !== -1) { path.unshift(c); c = _mCameFrom[c]; }
            return { path, targetCell: cell };
        }
        expanded++;
        if (expanded > maxNodes) return null;
        const g = _mGScore[cell];
        const r = (cell / MED_W) | 0, cc = cell % MED_W;
        for (let dr = -1; dr <= 1; dr++) {
            const nr = r + dr;
            if (nr < 0 || nr >= MED_H) continue;
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nc = (((cc + dc) % MED_W) + MED_W) % MED_W;
                const nb = nr * MED_W + nc;
                if (!mWater[nb] || _mClosed[nb]) continue;
                const cost = (dr === 0 || dc === 0) ? 1 : 1.414;
                const tentG = g + cost;
                if (tentG < _mGScore[nb]) {
                    if (_mGScore[nb] === Infinity) _mVisited.push(nb);
                    _mGScore[nb] = tentG;
                    _mCameFrom[nb] = cell;
                    const f = useAStar ? tentG + medHeuristic(nb, hLat, hLon) : tentG;
                    heap.push([f, nb]);
                    let i = heap.length - 1;
                    while (i > 0) {
                        const p = (i - 1) >> 1;
                        if (heap[p][0] <= heap[i][0]) break;
                        const t2 = heap[p]; heap[p] = heap[i]; heap[i] = t2; i = p;
                    }
                }
            }
        }
    }
    return null;
}

function findHighwayPath(srcLat, srcLon, dstLat, dstLon) {
    const N = hwNodes.length;
    const srcNode = nearestHighwayNode(srcLat, srcLon);
    const dstNode = nearestHighwayNode(dstLat, dstLon);
    if (srcNode < 0 || dstNode < 0) return null;
    if (srcNode === dstNode) return [{ lat: hwNodes[srcNode].lat, lon: hwNodes[srcNode].lon }];
    for (let i = 0; i < N; i++) {
        _hwGScore[i] = Infinity; _hwCameFrom[i] = -1; _hwClosed[i] = 0;
    }
    _hwGScore[srcNode] = 0;
    // A* heuristic: haversine distance (km) to destination — admissible.
    const dstLatN = hwNodes[dstNode].lat, dstLonN = hwNodes[dstNode].lon;
    const h0 = haversineKm(hwNodes[srcNode].lat, hwNodes[srcNode].lon, dstLatN, dstLonN);
    const heap = [[h0, srcNode]]; // [fScore, nodeIdx]
    let found = false;
    while (heap.length > 0) {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                let m = i; const l = 2*i+1, r = 2*i+2;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
            }
        }
        const node = top[1];
        if (_hwClosed[node]) continue;
        _hwClosed[node] = 1;
        if (node === dstNode) { found = true; break; }
        const g = _hwGScore[node];
        const edges = hwAdj[node];
        for (let e = 0; e < edges.length; e++) {
            const nb = edges[e].to;
            if (_hwClosed[nb]) continue;
            const tentG = g + edges[e].dist;
            if (tentG < _hwGScore[nb]) {
                _hwGScore[nb] = tentG;
                _hwCameFrom[nb] = node;
                const h = haversineKm(hwNodes[nb].lat, hwNodes[nb].lon, dstLatN, dstLonN);
                heap.push([tentG + h, nb]);
                let i = heap.length - 1;
                while (i > 0) {
                    const p = (i - 1) >> 1;
                    if (heap[p][0] <= heap[i][0]) break;
                    const t2 = heap[p]; heap[p] = heap[i]; heap[i] = t2; i = p;
                }
            }
        }
    }
    if (!found) return null;
    const path = [];
    let n = dstNode;
    while (n !== -1) { path.unshift({ lat: hwNodes[n].lat, lon: hwNodes[n].lon }); n = _hwCameFrom[n]; }
    return path;
}

// EXACT replica of findHPAPath from main.js
function findHPAPath(srcLat, srcLon, dstLat, dstLon) {
    const srcCell = nearestMedWater(srcLat, srcLon, 25);
    const dstCell = nearestMedWater(dstLat, dstLon, 25);
    if (srcCell < 0 || dstCell < 0) return { ok: false, reason: 'snap_fail' };

    // Phase 1: src port → highway (A* biased toward destination)
    const srcRes = boundedMedDijkstra(srcCell, hwCellSet, 12000, dstCell);
    if (!srcRes) return { ok: false, reason: 'phase1_fail' };

    // Phase 2: dst port → highway (A* biased toward source)
    const dstRes = boundedMedDijkstra(dstCell, hwCellSet, 12000, srcCell);
    if (!dstRes) return { ok: false, reason: 'phase2_fail' };

    // Phase 3: highway graph Dijkstra
    const srcExit = medToLatLon(srcRes.targetCell);
    const dstExit = medToLatLon(dstRes.targetCell);
    const srcNode = nearestHighwayNode(srcExit.lat, srcExit.lon);
    const dstNode = nearestHighwayNode(dstExit.lat, dstExit.lon);
    if (srcNode !== dstNode) {
        const hwPath = findHighwayPath(srcExit.lat, srcExit.lon, dstExit.lat, dstExit.lon);
        if (!hwPath) {
            // Fallback: direct bounded Dijkstra
            const directRes = boundedMedDijkstra(srcCell, new Set([dstCell]), 60000, dstCell);
            if (!directRes) return { ok: false, reason: 'disconnected', srcNode, dstNode };
            return { ok: true, fallback: true };
        }
    }
    return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════
// STEP 4: Sample shoreline ports
// ════════════════════════════════════════════════════════════════════════
console.log('[TEST] Sampling shoreline ports...');
const SHORE_STRIDE = 15; // sample every 15 medium cells (~1.5°)
const ports = [];

for (let row = 1; row < MED_H - 1; row += SHORE_STRIDE) {
    for (let col = 0; col < MED_W; col += SHORE_STRIDE) {
        const cell = row * MED_W + col;
        // Shoreline = land cell with ≥1 water neighbor
        if (mWater[cell]) continue;
        let hasWaterNbr = false;
        for (let d = 0; d < 8 && !hasWaterNbr; d++) {
            const nr = row + dirs8[d][0];
            if (nr < 0 || nr >= MED_H) continue;
            const nc = (((col + dirs8[d][1]) % MED_W) + MED_W) % MED_W;
            if (mWater[nr * MED_W + nc]) hasWaterNbr = true;
        }
        if (!hasWaterNbr) continue;
        // Snap to nearest water cell
        const ll = medToLatLon(cell);
        const waterCell = nearestMedWater(ll.lat, ll.lon, 10);
        if (waterCell < 0) continue;
        // Filter out inland water (lakes/rivers) — only keep ocean ports
        if (!oceanMask[waterCell]) continue;
        const wll = medToLatLon(waterCell);
        ports.push({ lat: wll.lat, lon: wll.lon, cell: waterCell });
    }
}
console.log('[TEST] Sampled', ports.length, 'shoreline ports');

// ════════════════════════════════════════════════════════════════════════
// STEP 5: Hub destinations — spread across all ocean basins
// ════════════════════════════════════════════════════════════════════════
const hubs = [
    { name: 'N.Atlantic',   lat: 40,  lon: -50 },
    { name: 'S.Atlantic',   lat: -20, lon: -10 },
    { name: 'N.Pacific',    lat: 35,  lon: -150 },
    { name: 'S.Pacific',    lat: -20, lon: -140 },
    { name: 'Indian Ocean', lat: -10, lon: 70 },
    { name: 'Mediterranean',lat: 38,  lon: 15 },
    { name: 'Caribbean',    lat: 15,  lon: -70 },
    { name: 'Persian Gulf', lat: 26,  lon: 52 },
    { name: 'Arabian Sea',  lat: 20,  lon: 65 },
    { name: 'South China',  lat: 15,  lon: 115 },
    { name: 'Bering Sea',   lat: 55,  lon: 175 },
    { name: 'Cape Horn',    lat: -56, lon: -70 },
    { name: 'Bay of Bengal',lat: 15,  lon: 88 },
    { name: 'N.Sea/Baltic', lat: 56,  lon: 5 },
    { name: 'Black Sea',    lat: 43,  lon: 34 },
];

// Snap hubs to water
for (const hub of hubs) {
    hub.cell = nearestMedWater(hub.lat, hub.lon, 25);
}

// Map each port & hub to its highway component (via nearest highway node)
for (const port of ports) {
    const n = nearestHighwayNode(port.lat, port.lon);
    port.comp = (n >= 0) ? nodeComp[n] : -1;
}
for (const hub of hubs) {
    const n = nearestHighwayNode(hub.lat, hub.lon);
    hub.comp = (n >= 0) ? nodeComp[n] : -1;
}
const portsInMain = ports.filter(p => p.comp === mainCompId).length;
console.log('[TEST] Ports in main component:', portsInMain, '/', ports.length,
    '| hubs in main:', hubs.filter(h => h.comp === mainCompId).length, '/', hubs.length);

// ════════════════════════════════════════════════════════════════════════
// STEP 6: Run tests
// ════════════════════════════════════════════════════════════════════════
console.log('[TEST] Testing', ports.length, 'ports ×', hubs.length, 'hubs =',
    ports.length * hubs.length, 'routes...\n');

let okCount = 0, failCount = 0, fallbackCount = 0;
const failures = [];
const portFailStats = new Map(); // portIdx → [failed hubs]

const t0 = Date.now();
for (let pi = 0; pi < ports.length; pi++) {
    const port = ports[pi];
    if (pi % 50 === 0) console.log(`  [progress] port ${pi}/${ports.length}...`);
    let portFails = 0;
    for (let hi = 0; hi < hubs.length; hi++) {
        const hub = hubs[hi];
        if (hub.cell < 0) continue;
        const dist = haversineKm(port.lat, port.lon, hub.lat, hub.lon);
        if (dist < 200) continue; // skip very close pairs

        const result = findHPAPath(port.lat, port.lon, hub.lat, hub.lon);
        if (result.ok) {
            if (result.fallback) fallbackCount++;
            else okCount++;
        } else {
            failCount++;
            portFails++;
            failures.push({
                port: `${port.lat.toFixed(1)},${port.lon.toFixed(1)}`,
                portComp: port.comp,
                hub: hub.name,
                hubComp: hub.comp,
                reason: result.reason,
                srcNode: result.srcNode,
                dstNode: result.dstNode,
                sameComp: result.srcNode !== undefined && nodeComp[result.srcNode] === nodeComp[result.dstNode],
            });
        }
    }
    if (portFails > 0) portFailStats.set(pi, portFails);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ════════════════════════════════════════════════════════════════════════
// STEP 7: Report
// ════════════════════════════════════════════════════════════════════════
console.log('═══════════════════════════════════════════════════════════════');
console.log('  HPA ROUTING TEST RESULTS');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Ports tested:  ${ports.length}`);
console.log(`  Hubs:          ${hubs.length}`);
console.log(`  Total routes:  ${okCount + fallbackCount + failCount}`);
console.log(`  ✓ OK:          ${okCount}`);
console.log(`  ~ Fallback:    ${fallbackCount} (direct bounded Dijkstra)`);
console.log(`  ✗ FAILED:      ${failCount}`);
console.log(`  Time:          ${elapsed}s`);
console.log(`  Success rate:  ${(100 * (okCount + fallbackCount) / (okCount + fallbackCount + failCount)).toFixed(1)}%`);
console.log('═══════════════════════════════════════════════════════════════\n');

// ── Categorize failures: genuine (different components) vs bugs (same component) ──
const genuineFails = failures.filter(f => !f.sameComp);
const bugFails = failures.filter(f => f.sameComp);

// Count same-component routes (port & hub in same highway component)
let sameCompRoutes = 0;
for (let pi = 0; pi < ports.length; pi++) {
    const port = ports[pi];
    if (port.comp < 0) continue;
    for (let hi = 0; hi < hubs.length; hi++) {
        const hub = hubs[hi];
        if (hub.cell < 0 || hub.comp < 0) continue;
        if (haversineKm(port.lat, port.lon, hub.lat, hub.lon) < 200) continue;
        if (port.comp === hub.comp) sameCompRoutes++;
    }
}
const sameCompOk = sameCompRoutes - bugFails.length;

console.log('\n───────────────────────────────────────────────────────────────');
console.log('  COMPONENT ANALYSIS');
console.log('───────────────────────────────────────────────────────────────');
console.log(`  Highway components:  ${numComp}`);
console.log(`  Main component:      #${mainCompId} (${compSorted[0].size} nodes)`);
console.log(`  Same-comp routes:    ${sameCompRoutes} | OK: ${sameCompOk} | FAILED: ${bugFails.length}`);
if (sameCompRoutes > 0) {
    const pct = (100 * sameCompOk / sameCompRoutes).toFixed(1);
    console.log(`  ⚡ Same-comp success: ${pct}%  ${pct === '100.0' ? '✅ PERFECT' : '⚠️ BUGS EXIST'}`);
}
console.log(`  Genuine disconnects: ${genuineFails.length} (different ocean basins)`);
console.log('───────────────────────────────────────────────────────────────\n');

if (bugFails.length > 0) {
    console.log('⚠️  UNEXPECTED FAILURES (same component, routing failed = BUG):');
    const seen = new Set();
    for (const f of bugFails) {
        if (seen.has(f.port)) continue;
        seen.add(f.port);
        console.log(`    ${f.port} → ${f.hub} (hw ${f.srcNode}→${f.dstNode})`);
    }
    console.log('');
}

if (genuineFails.length > 0) {
    // Group stranded ports by their component
    const byComp = {};
    for (const f of genuineFails) {
        const key = f.portComp;
        if (!byComp[key]) byComp[key] = new Set();
        byComp[key].add(f.port);
    }
    console.log('GENUINE DISCONNECTIONS — stranded ports by component:');
    const sorted = Object.entries(byComp).sort((a, b) => b[1].size - a[1].size);
    for (const [compId, portSet] of sorted) {
        const compSize = compSizes[compId] || 0;
        const portsList = [...portSet];
        console.log(`\n  Component #${compId} (${compSize} highway nodes) — ${portsList.length} stranded ports:`);
        for (const p of portsList.slice(0, 25)) console.log(`    ${p}`);
        if (portsList.length > 25) console.log(`    ... and ${portsList.length - 25} more`);
    }
} else if (bugFails.length === 0) {
    console.log('✅ ALL ROUTES SUCCEEDED — no failures!');
}
console.log('\n✅ Test complete.');
