# Plan: Map Editor Mode + Adaptive Highway Densification

> **Goal**: (1) Automatically densify the ocean highway graph so every navigable
> river/strait gets highway nodes, and (2) add a runtime **Map Editor** mode that
> lets you paint water/land and place highway nodes/edges directly on the globe,
> with edits persisted as a stroke overlay that is re-rasterized at build time.

---

## 1. Root Cause

Highway nodes are sampled on a **fixed 2° lattice** (`HW_STRIDE = 20` medium cells
× `0.1°`, see [`build_river_routes.cjs:305`](../scripts/build_river_routes.cjs:305)).
Any navigable waterway that does not cross a 2° grid intersection gets **zero
highway nodes**, forcing ships onto slow bounded Dijkstra (Phase 1/3) or failing.

Two distinct problems need two distinct tools:

| Problem | Example | Tool |
|---------|---------|------|
| River exists in mask but misses the 2° lattice | narrow/meandering rivers | **Automatic densification** |
| Water cell misclassified as land (data error / canal) | canals, closed straits | **Manual paint editor** |

---

## 2. Phase 1 — Automatic Adaptive Densification (build script)

**File**: [`scripts/build_river_routes.cjs`](../scripts/build_river_routes.cjs)

**Insert**: new `STEP 7d` after STEP 7c bridging (after line ~600), before STEP 7b.

### Algorithm — farthest-point sampling with path tracing

The flow-field Dijkstra (STEP 7b) is dead code (`BUILD_LEGACY=false`), so we run a
**dedicated multi-source BFS** from all current highway nodes across `mWater`:

1. **coverageBFS()** — flat-queue BFS from every `hwNodes[]` cell over `mWater`.
   Returns `dist[cell]` (hops to nearest node) + `came[cell]` (predecessor).
   Reset only visited cells (track a `visited` list). ~100–200 ms per pass.
2. **Find under-covered cells** — local maxima of `dist` that exceed
   `DENSIFY_RADIUS` (default 8 hops ≈ 0.8°). These are the deep points of
   under-covered regions; they are naturally spread out.
3. **For each seed** — trace `came` back to the nearest existing highway node
   → an all-water path. Sample a new highway node every `DENSIFY_SAMPLE_EVERY`
   (default 4) cells along it; connect consecutive nodes with
   [`lineOfSight()`](../scripts/build_river_routes.cjs:325)-validated edges.
   Because the path is all-water and nodes are close, LOS holds → connectivity
   is guaranteed (no new disconnected components).
4. **Repeat** until `max(dist) <= DENSIFY_RADIUS` or caps hit
   (`DENSIFY_MAX_NODES`, `DENSIFY_MAX_ITER`).
5. **Verify** with [`findComponents()`](../scripts/build_river_routes.cjs:394) →
   must remain a single connected component.

### Config (top of file)
```
const DENSIFY_RADIUS       = 8;     // hops; cells farther than this get a node
const DENSIFY_SAMPLE_EVERY = 4;     // cells between nodes on a traced chain
const DENSIFY_MAX_NODES    = 8000;  // hard cap on added nodes
const DENSIFY_MAX_ITER     = 30;    // BFS iteration cap
```

### Verification
- `node scripts/build_river_routes.cjs` → check node count rises, components = 1.
- `node scripts/test_routes.cjs` → must stay 100% (6523/6523), ideally faster.

---

## 3. Phase 2 — Map Editor (runtime) + stroke persistence

### 3a. Stroke overlay format — `public/data/map_edits.json`
```json
{
  "version": 1,
  "strokes": [
    { "type": "water", "radius": 2, "points": [[lat,lon], ...] },
    { "type": "land",  "radius": 3, "points": [[lat,lon], ...] },
    { "type": "highway_node", "lat": 26.5, "lon": 51.2 },
    { "type": "highway_edge", "from": [26.5,51.2], "to": [25.0,55.0] }
  ]
}
```
Stored as **vector strokes** (not raster diffs): tiny, editable,
resolution-independent, re-rasterizable.

### 3b. Build-time merge — `build_river_routes.cjs`
Insert stroke rasterization **right after STEP 3** (medium mask built, ~line 133),
BEFORE ocean-mask flood-fill, so painted water propagates into `oceanMask`,
highway lattice, **and** densification automatically. Painted rivers therefore
receive highway nodes for free via Phase 1.

- `water` stroke → set `mWater[cell]=1` (and fine `owner[cell]=WATER`) for every
  medium cell within `radius` of each polyline segment.
- `land` stroke → clear those cells.
- `highway_node` / `highway_edge` → appended to `hwNodes`/`hwEdges` after STEP 7d.

### 3c. Runtime editor — `src/main.js`
**Mode + UI panel** (mirrors `setupDevPortPanel()` at line 2846):
- Toggle: **Map Editor ON/OFF** (a game-state flag that intercepts globe clicks).
- Brush selector: `Water | Land | Highway Node | Highway Edge | Erase`.
- Radius slider (1–8 medium cells), Undo, Clear, **Export JSON**, Import JSON.
- Status line: current lat/lon + cell value.

**Brush painting** (reuses existing infra):
- Raycast: `raycaster.intersectObject(earthMesh)` → `vec3ToLatLon()` (pattern at
  [`src/main.js:5069`](../src/main.js:5069)).
- On pointer-down + drag, rasterize a disk of `radius` cells around the lat/lon
  onto `_mWater[]` (and `conquestGrid.owner[]` for the FINE overlay).
- Live preview: call [`applyWaterDebugOverlay()`](../src/main.js:1086) (mode 2
  reads `_mWater`, so painted cells appear immediately).
- Highway Node/Edge brushes hot-add to `_waterwayNetwork.hwNodes / hwAdj /
  hwCellSet` so routing uses them without a reload.

**Undo**: every brush action pushes a stroke object onto a history stack;
Undo pops + re-rasters from scratch (deterministic).

**Export**: serialize the history stack → download `map_edits.json`. Drop into
`public/data/` and rebuild to bake edits permanently.

### 3d. Runtime load of `map_edits.json`
On startup (after `_ensureMediumArrays` + `loadWaterwayNetwork`), if
`map_edits.json` exists, rasterize strokes onto `_mWater`/`owner` and apply
node/edge additions to `_waterwayNetwork`. This makes edits work immediately in
the running game even before a rebuild.

---

## 4. Implementation Order

1. ✅ Architecture plan (this file).
2. **Phase 1**: STEP 7d densification → rebuild → test_routes 100%.
3. **Phase 2 build**: stroke loader + rasterize-before-densification.
4. **Phase 2 runtime**: editor mode + UI panel.
5. **Phase 2 runtime**: brush painting + live overlay + undo.
6. **Phase 2 runtime**: highway node/edge hot-add + export/import.
7. In-game verify: Persian Gulf→India, Turkey→USA.

---

## 5. Synergy

Painting a river in the editor → exported stroke → rasterized at build time
BEFORE densification → densification automatically lays highway nodes along it
→ ships route through it instantly. The manual and automatic features compose.
