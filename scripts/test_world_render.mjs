// ════════════════════════════════════════════════════════════════════
//  TASK-406 headless integration test — world render layer + grid APIs
//  Run:  node scripts/test_world_render.mjs
//
//  Covers:
//    A. ConquestGrid TASK-406 logic (no DOM beyond a canvas shim):
//       - shared dirty-region queue (takeOverlayRect: null=full / rect / undefined)
//       - rect union across multiple flips, consume-once semantics
//       - devastation visual buckets (applyDevastation → flushDevastationRender)
//       - decay → bucket change → repaint → scorch heals to alpha 0
//       - frontline heat (getHotEdges fresh + aged-out pruning)
//       - frontier edges consistent (segs/own lengths)
//    B. src/world/render.js module contract with a stubbed THREE:
//       - tickTerritory creates overlay mesh + texture, hides legacy mesh
//       - throttled sub-rect upload retry path after 100ms
//       - frontier line rebuild after the 150ms throttle window
//       - capture flash pool (onCellConquered writes birth/color buffers)
//       - frontline heat line on frame%20, drone ring add/remove
//       - devastation mesh creation on first dirty flush
//       - reset() removes + disposes everything it created
// ════════════════════════════════════════════════════════════════════
import { createCanvas } from 'canvas';

// ── browser shims (must exist BEFORE importing the modules) ──
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return createCanvas(1, 1);
    throw new Error('test shim: unsupported createElement tag ' + tag);
  },
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

// Minimal THREE stub — records enough surface for render.js to run headless.
class CanvasTexture { constructor(img) { this.image = img; this.needsUpdate = false; } dispose() { this.disposed = true; } }
class SphereGeometry { constructor(...a) { this.args = a; } dispose() { this.disposed = true; } }
class RingGeometry { constructor(...a) { this.args = a; } dispose() { this.disposed = true; } }
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  computeBoundingSphere() {}
  dispose() { this.disposed = true; }
}
class BufferAttribute {
  constructor(arr, size) { this.array = arr; this.itemSize = size; this.needsUpdate = false; }
  setX(i, v) { this.array[i] = v; }
  setXYZ(i, x, y, z) { this.array[i * 3] = x; this.array[i * 3 + 1] = y; this.array[i * 3 + 2] = z; }
}
class MeshBasicMaterial { constructor(o = {}) { Object.assign(this, o); this.needsUpdate = false; } dispose() { this.disposed = true; } }
class LineBasicMaterial { constructor(o = {}) { Object.assign(this, o); } dispose() { this.disposed = true; } }
class ShaderMaterial { constructor(o = {}) { Object.assign(this, o); } dispose() { this.disposed = true; } }
const _pos = { x: 0, y: 0, z: 0, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } };
class Mesh {
  constructor(geo, mat) { this.geometry = geo; this.material = mat; this.visible = true; this.position = { ..._pos, copy: _pos.copy }; }
  lookAt() {}
}
class LineSegments extends Mesh {}
class Points extends Mesh {}
const THREE_STUB = {
  CanvasTexture, SphereGeometry, RingGeometry, BufferGeometry, BufferAttribute,
  MeshBasicMaterial, LineBasicMaterial, ShaderMaterial, Mesh, LineSegments, Points,
  RepeatWrapping: 1000, ClampToEdgeWrapping: 1001, NearestFilter: 1003, LinearFilter: 1006,
  FrontSide: 0, DoubleSide: 1, AdditiveBlending: 2, SRGBColorSpace: 'srgb',
};
globalThis.THREE = THREE_STUB;
globalThis.window = globalThis;   // render.js reads window.THREE

const { ConquestGrid, CONQUEST_CFG } = await import('../src/core/conquest.js');
const { createWorldRender } = await import('../src/world/render.js');

// ── tiny harness ──
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.error('  ✘ FAIL: ' + name); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Small fast grid (0.5° cells). Full-size semantics identical.
const TEST_CFG = {
  ...CONQUEST_CFG,
  GRID_W: 720, GRID_H: 360, CELL_DEG: 0.5,
  DEVASTATION_DECAY_PER_TICK: 0.5,   // 2 decay passes fully heal in-test
};
const W = TEST_CFG.GRID_W, H = TEST_CFG.GRID_H;

// ═══ A. ConquestGrid TASK-406 logic ═══
console.log('\n[A] ConquestGrid — dirty-region queue / devastation / heat');
{
  const grid = new ConquestGrid(TEST_CFG);
  grid.owner.fill(TEST_CFG.NEUTRAL);   // all land, unowned

  // A1 — first flush = full repaint sentinel
  ok(grid.flushRender() === true, 'A1 first flushRender() reports change');
  ok(grid.takeOverlayRect() === null, 'A1 full repaint queued as null sentinel');

  // A2 — nothing dirty → false + undefined
  ok(grid.flushRender() === false, 'A2 idle flushRender() false');
  ok(grid.takeOverlayRect() === undefined, 'A2 empty queue returns undefined');

  // A3 — two distant flips union into one rect
  const cellA = 10 * W + 10;          // (col 10, row 10)
  const cellB = 100 * W + 200;        // (col 200, row 100)
  ok(grid.conquerCell(cellA, 'player') === true, 'A3 conquerCell A flips');
  ok(grid.conquerCell(cellB, 'player') === true, 'A3 conquerCell B flips');
  ok(grid.flushRender() === true, 'A3 dirty flush true');
  const rect = grid.takeOverlayRect();
  ok(rect && typeof rect.x === 'number', 'A3 rect returned (' + JSON.stringify(rect) + ')');
  // bounds must cover both cells + 1 neighbor ring
  ok(rect.x <= 9 && rect.x + rect.w >= 201, 'A3 rect cols cover 9..201');
  ok(rect.y <= 9 && rect.y + rect.h >= 101, 'A3 rect rows cover 9..101');
  ok(grid.takeOverlayRect() === undefined, 'A3 queue consumed exactly once');

  // A4 — frontier edges consistent after flips
  const { segs, own } = grid.getFrontierEdges();
  ok(segs.length === own.length * 4, 'A4 frontier segs/own lengths consistent (' + own.length + ' edges)');

  // A5 — heat edges fresh, then aged out
  let hot = grid.getHotEdges();
  ok(hot.length > 0, 'A5 fresh heat edges present (' + (hot.length / 4) + ' segs)');
  const stale = performance.now() - TEST_CFG.HEAT_AGE_MS - 1000;
  for (const [cell] of grid._heat) grid._heat.set(cell, stale);
  hot = grid.getHotEdges();
  ok(hot.length === 0, 'A5 aged heat pruned to 0');

  // A6 — devastation visual buckets
  const { lat: dlat, lon: dlon } = grid.cellToLatLon(cellA);
  grid.applyDevastation(dlat, dlon, 30, 2);
  ok(grid.hasDevDirty() === true, 'A6 applyDevastation marks visual dirty');
  ok(grid.flushDevastationRender() === true, 'A6 flushDevastationRender true on change');
  const px = cellA * 4 + 3;
  ok(grid.devImage.data[px] > 0, 'A6 scorch alpha painted (' + grid.devImage.data[px] + ')');
  ok(grid.flushDevastationRender() === false, 'A6 second flush false (queue drained)');
  // decay everything → bucket drops → dirty again → heals to alpha 0
  // (two full sweeps: pass 1 halves 1.0→0.5, pass 2 heals 0.5→0 at decay=0.5)
  grid.decayDevastation(W * H);
  ok(grid.hasDevDirty() === true, 'A6 decay crosses bucket → dirty again');
  ok(grid.flushDevastationRender() === true, 'A6 heal flush true');
  grid.decayDevastation(W * H);   // second pass fully heals the blast core
  ok(grid.flushDevastationRender() === true, 'A6 core heal flush true');
  ok(grid.devImage.data[px] === 0, 'A6 scorch healed to alpha 0');
  ok(grid.devastationCellCount() === 0, 'A6 dev set drained after full heal (TASK-506)');

  // ── TASK-506: set-based decay semantics ──────────────────────────────
  // The old rotating-cursor sweep visited each grid cell once per ~9min —
  // devastation never faded. Decay now visits ONLY live cells, so fade time
  // is grid-size independent, and occupation clears the scorch VISUALLY.
  {
    const g2 = new ConquestGrid(TEST_CFG);
    g2.owner.fill(TEST_CFG.NEUTRAL);
    const { lat, lon } = g2.cellToLatLon(100 * W + 100);
    g2.applyDevastation(lat, lon, 60, 1);
    const cellsLive = g2.devastationCellCount();
    ok(cellsLive > 0 && cellsLive < W * H, 'A7 decay tracks only live cells (' + cellsLive + ' of ' + (W * H) + ')');
    // Fade independent of grid size: with decay=0.5 and a budget that covers
    // the live set, two visits fully heal (0.55→0.05→0) no matter how big N is.
    let visits = 0;
    while (g2.devastationCellCount() > 0 && visits < 100) { g2.decayDevastation(1600); visits++; }
    ok(g2.devastationCellCount() === 0, 'A7 bounded-budget loop fully heals set (visits=' + visits + ')');
    // Occupation clears the VISUAL scorch instantly (bucket + dirty + set):
    const g3 = new ConquestGrid(TEST_CFG);
    g3.owner.fill(TEST_CFG.NEUTRAL);
    const c3 = 100 * W + 100;
    const ll3 = g3.cellToLatLon(c3);
    g3.applyDevastation(ll3.lat, ll3.lon, 60, 1);
    g3.flushDevastationRender();
    const px3 = c3 * 4 + 3;
    const liveBefore = g3.devastationCellCount();
    ok(g3.devImage.data[px3] > 0, 'A7 scorch painted before occupation (' + g3.devImage.data[px3] + ' live=' + liveBefore + ')');
    g3.conquerCell(c3, 'player');                    // occupation resets devastation
    ok(g3.devastationAt(c3) === 0, 'A7 occupation zeroes logical devastation');
    ok(g3.hasDevDirty() === true, 'A7 occupation queues scorch repaint (TASK-506 visual fix)');
    g3.flushDevastationRender();
    ok(g3.devImage.data[px3] === 0, 'A7 occupation heals scorch pixel to alpha 0');
    ok(g3.devastationCellCount() === liveBefore - 1, 'A7 occupied cell left the dev set (' + liveBefore + '→' + g3.devastationCellCount() + ')');
  }
}

// ═══ B. world/render.js module contract ═══
console.log('\n[B] world/render.js — overlay/frontier/flash/heat/rings/reset');
{
  const grid = new ConquestGrid(TEST_CFG);
  grid.owner.fill(TEST_CFG.NEUTRAL);

  const scene = {
    added: [], removed: [],
    add(m) { this.added.push(m); },
    remove(m) { this.removed.push(m); },
  };
  let hidLegacy = 0;
  const WORLD = createWorldRender({
    grid: () => grid,
    scene: () => scene,
    bots: () => [],
    R: () => 6371,
    latLonToVec3: (lat, lon, r) => ({ x: r * Math.cos(lat) * Math.cos(lon), y: r * Math.sin(lat), z: 0 }),
    ownerHexColor: () => 0xff4444,
    hideTerritoryMesh: () => { hidLegacy++; },
  });

  // B1 — first tick: overlay mesh + texture + legacy hide
  WORLD.tickTerritory();
  ok(WORLD.state.overlayMesh instanceof Mesh, 'B1 overlay mesh created');
  ok(scene.added.includes(WORLD.state.overlayMesh), 'B1 overlay added to scene');
  ok(hidLegacy === 1, 'B1 legacy territory mesh hidden once');
  ok(WORLD.state.texture instanceof CanvasTexture, 'B1 overlay texture created');
  ok(WORLD.state.texture.image === WORLD.state.overlayCanvas, 'B1 texture bound to downscaled canvas');
  ok(grid.takeOverlayRect() === undefined, 'B1 full rect consumed');
  ok(typeof window.__overlayCanvas !== 'undefined', 'B1 debug handle kept');

  // B2 — flip → throttled upload pending, then sub-rect retry after 100ms
  const cell = 180 * W + 360;
  grid.conquerCell(cell, 'player');
  WORLD.tickTerritory();
  ok(WORLD.state.overlayPending === true, 'B2 upload throttled → pending flagged');
  ok(WORLD.state.frontierLine === null, 'B2 frontier throttled (<150ms) — not yet built');
  await sleep(220);   // past BOTH the 100ms upload and 150ms frontier throttles
  WORLD.tickTerritory();
  ok(WORLD.state.overlayPending === false, 'B2 pending upload retried after window');
  ok(WORLD.state.frontierLine instanceof LineSegments, 'B2 frontier line built after throttle');
  ok(WORLD.state.frontierLine.visible === true, 'B2 frontier visible');
  const { segs } = grid.getFrontierEdges();
  const vCount = WORLD.state.frontierLine.geometry.attributes.position.array.length / 3;
  ok(vCount === (segs.length / 4) * 2, 'B2 frontier vertex count matches edges (' + vCount + ' verts)');

  // B3 — capture flash pool
  WORLD.onCellConquered(cell, 'player');
  ok(WORLD.state.flashPoints instanceof Points, 'B3 flash pool created');
  let flashed = 0;
  const births = WORLD.state.flashPoints.geometry.attributes.aBirth.array;
  for (let i = 0; i < births.length; i++) if (births[i] > -1e8) flashed++;
  ok(flashed === 1, 'B3 exactly one flash alive in ring buffer');

  // B4 — heat line on frame%20 + drone rings lifecycle
  WORLD.tickVfx(20);
  ok(WORLD.state.heatLine instanceof LineSegments, 'B4 heat line built on frame 20');
  ok(WORLD.state.heatLine.visible === true, 'B4 heat line visible');
  WORLD.updateDroneRings([{ id: 7, dead: false, selected: true, pos: { x: 1, y: 2, z: 3 } }], 21);
  ok(WORLD.state.droneRings.size === 1, 'B4 ring added for selected drone');
  WORLD.updateDroneRings([{ id: 7, dead: true, selected: true, pos: { x: 1, y: 2, z: 3 } }], 22);
  ok(WORLD.state.droneRings.size === 0, 'B4 ring removed when drone dead');

  // B5 — devastation mesh on first dirty flush
  const { lat, lon } = grid.cellToLatLon(cell);
  grid.applyDevastation(lat, lon, 30, 1);
  WORLD.tickTerritory();
  ok(WORLD.state.devMesh instanceof Mesh, 'B5 devastation mesh created');
  ok(WORLD.state.devMesh.renderOrder === 0.5, 'B5 scorch layered under territory (renderOrder 0.5)');

  // B6 — reset removes + disposes everything
  const before = scene.added.slice();
  WORLD.reset();
  const offenders = before.filter(m => !(m.geometry.disposed && m.material.disposed));
  if (offenders.length) console.error('     offenders:', offenders.map(m =>
    m.constructor.name + '(geo=' + !!m.geometry.disposed + ',mat=' + !!m.material.disposed + ')').join(' '));
  ok(WORLD.state.overlayMesh === null && WORLD.state.frontierLine === null &&
     WORLD.state.flashPoints === null && WORLD.state.heatLine === null &&
     WORLD.state.devMesh === null, 'B6 reset nulls all mesh refs');
  ok(WORLD.state.droneRings.size === 0, 'B6 rings cleared');
  ok(before.every(m => scene.removed.includes(m)), 'B6 every created mesh removed from scene');
  ok(offenders.length === 0, 'B6 geometries + materials disposed');
  ok(WORLD.state.texture === null && WORLD.state.devTexture === null, 'B6 textures disposed + nulled');
}

console.log('\n═══ RESULT: ' + pass + ' passed, ' + fail + ' failed ═══');
process.exit(fail ? 1 : 0);
