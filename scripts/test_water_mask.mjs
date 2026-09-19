// ════════════════════════════════════════════════════════════════════
//  TASK-406 follow-up — GeoJSON-aware water dilation (over-watered coasts)
//  Run:  node scripts/test_water_mask.mjs
//
//  The blanket dilateWater(1,1) converted ANY land cell with ≥1 water
//  neighbour to water — eroding every coast by ~5.5km and widening the
//  major straits past TANK_RIVER_PROBE_KM (48km), making Dover/Gibraltar
//  un-wadeable for armor (flagged by the tanks agent, TASK-405 merge).
//
//  Fix: with a GeoJSON land reference set (setGeoLandRef), only water
//  cells INSIDE country polygons (rivers/lakes/canals) push their banks
//  outward; ocean/strait water never dilates.
//
//  Synthetic world (360×180, 1° cells — assertions are in CELLS):
//    · two continents separated by a 20-cell strait (ocean, geo=0)
//    · a 1-cell river crossing the left continent (interior, geo=1)
//  Checks:
//    A. strait width UNCHANGED, both shores intact
//    B. river widened exactly 1 ring (3 wide, +1 at each end)
//    C. ocean coast NOT eroded (top/bottom/left/right edges keep land)
//    D. regression guard: WITHOUT the ref, blanket dilation still erodes
//       the strait shores (old behaviour preserved for the fallback path)
//    E. setGeoLandRef rejects wrong-length arrays (falls back cleanly)
// ════════════════════════════════════════════════════════════════════
import { createCanvas } from 'canvas';

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return createCanvas(1, 1);
    throw new Error('test shim: unsupported createElement tag ' + tag);
  },
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const { ConquestGrid, CONQUEST_CFG } = await import('../src/core/conquest.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.error('  ✘ FAIL: ' + name); }
}

const TEST_CFG = { ...CONQUEST_CFG, GRID_W: 360, GRID_H: 180, CELL_DEG: 1.0 };
const W = TEST_CFG.GRID_W, H = TEST_CFG.GRID_H;
const NEUTRAL = TEST_CFG.NEUTRAL, WATER = TEST_CFG.WATER;

// ── synthetic terrain binary (1:1 with the grid) ──
// continents: rows 60-119 · left cols 40-139 · right cols 160-259
// strait: cols 140-159 (ocean between them) · river: row 90, cols 50-130
const L_ROWS = [60, 119], LC = [40, 139], RC = [160, 259];
const RIVER_ROW = 90, RIVER_C = [50, 130];

function buildWorld() {
  const grid = new ConquestGrid(TEST_CFG);
  const bin = new Uint8Array(W * H);          // bit7 = land
  const geo = new Uint8Array(W * H);          // 1 = inside a country polygon
  for (let row = L_ROWS[0]; row <= L_ROWS[1]; row++) {
    for (let col = LC[0]; col <= LC[1]; col++) {
      bin[row * W + col] = 0x80;
      geo[row * W + col] = 1;                 // left country incl. its river
    }
    for (let col = RC[0]; col <= RC[1]; col++) {
      bin[row * W + col] = 0x80;
      geo[row * W + col] = 1;                 // right country
    }
  }
  for (let col = RIVER_C[0]; col <= RIVER_C[1]; col++) {
    bin[RIVER_ROW * W + col] = 0x00;          // river cuts through the land
  }
  grid.loadTerrainFromBin(bin, W, H);
  grid.buildLandMaskFromTerrain();
  return { grid, geo };
}
const owner = (g, row, col) => g.owner[row * W + col];

// ═══ A/B/C: geo-gated dilation ═══
console.log('\n[A/B/C] GeoJSON-gated dilation — rivers thicken, ocean does not');
{
  const { grid, geo } = buildWorld();
  grid.setGeoLandRef(geo);
  grid.dilateWater(1, 1);

  // A — strait width unchanged, shores intact
  ok(owner(grid, 90, 139) === NEUTRAL, 'A1 left strait shore NOT eroded (col 139 land)');
  ok(owner(grid, 90, 160) === NEUTRAL, 'A2 right strait shore NOT eroded (col 160 land)');
  let straitWater = 0;
  for (let col = 140; col <= 159; col++) if (owner(grid, 90, col) === WATER) straitWater++;
  ok(straitWater === 20, 'A3 strait stays 20 cells wide (' + straitWater + ')');

  // B — river widened exactly one ring (3 wide, +1 per end)
  ok(owner(grid, 90, 49) === WATER, 'B1 river end extends +1 west (col 49 converted)');
  ok(owner(grid, 90, 48) === NEUTRAL, 'B2 river westward spread stops at 1 ring (col 48 land)');
  ok(owner(grid, 89, 80) === WATER && owner(grid, 91, 80) === WATER, 'B3 river banks widened (rows 89+91)');
  ok(owner(grid, 88, 80) === NEUTRAL && owner(grid, 92, 80) === NEUTRAL, 'B4 river widening stops at 1 ring');
  ok(owner(grid, 90, 131) === WATER && owner(grid, 90, 132) === NEUTRAL, 'B5 river ends +1 only (131 water, 132 land)');

  // C — ocean coasts NOT eroded
  ok(owner(grid, 60, 100) === NEUTRAL, 'C1 north coast intact (row 60)');
  ok(owner(grid, 119, 100) === NEUTRAL, 'C2 south coast intact (row 119)');
  ok(owner(grid, 90, 40) === NEUTRAL, 'C3 west ocean coast intact (col 40)');
  ok(owner(grid, 90, 259) === NEUTRAL, 'C4 east ocean coast intact (col 259)');
  ok(owner(grid, 59, 100) === WATER && owner(grid, 120, 100) === WATER, 'C5 ocean stays ocean');
}

// ═══ D: regression guard — blanket dilation (no ref) still the old way ═══
console.log('\n[D] Blanket dilation (no geoLand ref) — legacy behaviour intact');
{
  const { grid } = buildWorld();          // NO setGeoLandRef
  grid.dilateWater(1, 1);
  ok(owner(grid, 90, 139) === WATER, 'D1 strait shore eroded without ref (legacy)');
  ok(owner(grid, 60, 100) === WATER, 'D2 ocean coast eroded without ref (legacy)');
}

// ═══ E: ref validation ═══
console.log('\n[E] setGeoLandRef validation');
{
  const { grid, geo } = buildWorld();
  grid.setGeoLandRef(new Uint8Array(7));  // wrong length → rejected
  grid.dilateWater(1, 1);
  ok(owner(grid, 90, 139) === WATER, 'E1 wrong-length ref rejected → blanket fallback');
  const g2 = buildWorld();
  g2.grid.setGeoLandRef(geo);
  g2.grid.setGeoLandRef(null);            // clear → blanket
  g2.grid.dilateWater(1, 1);
  ok(owner(g2.grid, 90, 139) === WATER, 'E2 null ref clears → blanket fallback');
}

// ═══ F: countCells consistency after gated dilation ═══
console.log('\n[F] Neutral recount');
{
  const { grid, geo } = buildWorld();
  const before = grid.countCells('neutral');
  grid.setGeoLandRef(geo);
  grid.dilateWater(1, 1);
  let manual = 0;
  for (let i = 0; i < grid.owner.length; i++) if (grid.owner[i] === NEUTRAL) manual++;
  ok(grid.countCells('neutral') === manual, 'F1 countCells matches manual scan after gated dilation');
  ok(grid.countCells('neutral') < before, 'F2 gated dilation still converts some land (river banks)');
}

// ═══ G: TASK-506 late-load re-apply (GeoJSON arrives after blanket init) ═══
console.log('\n[G] geoLand late-load — safe re-apply pre-spawn, frozen in-game');
{
  // G1 — blanket init, then late ref: mask re-applied geo-gated
  const { grid, geo } = buildWorld();
  grid.dilateWater(1, 1);                      // NO ref — blanket (the 10s-timeout path)
  ok(owner(grid, 90, 139) === WATER, 'G1 pre: blanket dilation eroded the strait shore');
  ok(grid.setGeoLandRef(geo) === true, 'G1 late setGeoLandRef reports re-apply (no owned cells)');
  ok(owner(grid, 90, 139) === NEUTRAL, 'G1 strait shore restored to land');
  ok(owner(grid, 90, 160) === NEUTRAL, 'G1 both strait shores restored');
  ok(owner(grid, 89, 80) === WATER && owner(grid, 91, 80) === WATER, 'G1 river banks still widened (geo-gated re-dilation ran)');
  let straitWater = 0;
  for (let col = 140; col <= 159; col++) if (owner(grid, 90, col) === WATER) straitWater++;
  ok(straitWater === 20, 'G1 strait back to 20 cells wide');
  let manual = 0;
  for (let i = 0; i < grid.owner.length; i++) if (grid.owner[i] === NEUTRAL) manual++;
  ok(grid.countCells('neutral') === manual, 'G1 counts recounted after re-apply');

  // G2 — game underway (cells owned): re-apply REFUSED, mask frozen
  const g2 = buildWorld();
  g2.grid.dilateWater(1, 1);                   // blanket
  const some = 100 * W + 100;                  // interior LEFT-CONTINENT land cell (row 100 ≠ river row 90)
  ok(g2.grid.conquerCell(some, 'player') === true, 'G2 setup: player owns one land cell');
  ok(g2.grid.setGeoLandRef(g2.geo) === false, 'G2 re-apply refused once cells are owned');
  ok(owner(g2.grid, 90, 139) === WATER, 'G2 blanket coasts kept (documented fallback)');

  // G3 — idempotence: a second ref never triggers another rebuild
  const g3 = buildWorld();
  g3.grid.dilateWater(1, 1);
  ok(g3.grid.setGeoLandRef(g3.geo) === true, 'G3 first late ref re-applies');
  ok(g3.grid.setGeoLandRef(g3.geo) === false, 'G3 second ref is a plain swap (no rebuild)');

  // G4 — late ref BEFORE any dilation is just a store (init order variant)
  const g4 = buildWorld();
  ok(g4.grid.setGeoLandRef(g4.geo) === false, 'G4 ref before dilation only stores (dilateState=none)');
  g4.grid.dilateWater(1, 1);
  ok(owner(g4.grid, 90, 139) === NEUTRAL, 'G4 subsequent dilation runs geo-gated');
}

console.log('\n═══ RESULT: ' + pass + ' passed, ' + fail + ' failed ═══');
process.exit(fail ? 1 : 0);
