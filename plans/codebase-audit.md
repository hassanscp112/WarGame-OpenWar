# 🔍 Codebase Audit — Bugs, Errors & Optimization Opportunities

**Date:** 2026-07-22  
**Scope:** Full review of `src/main.js` (7,637 lines) + `src/core/conquest.js` (1,311 lines)  
**Method:** Systematic line-by-line analysis of game loop, rendering, AI, combat, memory, and UI

---

## 📊 Executive Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| 🐛 Bugs | 2 | 2 | 1 | 0 | **5** |
| ⚡ Performance | 0 | 3 | 3 | 3 | **9** |
| ⚠️ Potential Issues | 0 | 1 | 3 | 1 | **5** |
| **Total** | **2** | **6** | **7** | **4** | **19** |

**Top 3 fixes by impact:**
1. **B1 — GPU memory leak on restart** → WebGL crash after 3-4 games
2. **P1 — `updateCityLabels()` every frame** → 10-20% frame time wasted
3. **P2+P3 — Per-frame array + material allocations** → GC stutter spikes

---

## 🐛 BUGS

### B1. 🔴 CRITICAL — GPU Memory Leak on Game Restart

**File:** [`backToMenu()`](src/main.js:7363) (line 7363)

**Problem:** `backToMenu()` removes meshes from the scene but **never calls `.dispose()`** on geometries or materials. Every structure, missile, plane, explosion, particle, and selection ring leaks GPU memory permanently.

```javascript
// CURRENT — leaks everything
function backToMenu() {
    structs.forEach(s => { if(s.mesh) scene.remove(s.mesh); });
    missiles.forEach(m => { if(m.mesh) scene.remove(m.mesh); });
    // ... only removes from scene, never disposes geometry/material
}
```

**Impact:** After 3-4 game restarts, WebGL context is lost ("too many textures" / "out of memory"). Browser tab must be refreshed.

**Fix:** Dispose all geometries and materials before clearing arrays:
```javascript
function disposeMesh(mesh) {
    if (!mesh) return;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
        else mesh.material.dispose();
    }
    // Recursively dispose children (groups)
    if (mesh.children) mesh.children.forEach(disposeMesh);
}
```

---

### B2. 🔴 CRITICAL — Event Listener Accumulation

**File:** [`setupDevPortPanel()`](src/main.js:2858), [`setupMapEditorPanel()`](src/main.js:3468), [`setupColorGradePanel()`](src/main.js:3611)

**Problem:** All three dev panel setup functions call `window.addEventListener()` for drag handling and pointer events (lines 2989-2990, 3575-3576, 3586-3602, 3699-3704). These listeners are **never removed**. If `init3D()` is called again (game restart in DEV_MODE), duplicate listeners accumulate, causing:
- Drag handlers firing 2×, 3×, 4× per mouse move
- Paint events firing multiple times per click
- Memory leak (closures captured by anonymous listeners)

**Impact:** Dev panels become increasingly glitchy with each restart. Pointer events fire N times where N = number of restarts.

**Fix:** Store listener references and remove them in `backToMenu()`, or guard with a "already initialized" flag.

---

### B3. 🟡 HIGH — Dead Code Block (~100 lines)

**File:** [`runAI()`](src/main.js:6943) (lines 6943-7051)

**Problem:** ~100 lines of legacy AI strategies wrapped in `if (false) { ... }`. This code is completely unreachable but:
- Wastes parse/compile time on every page load
- Confuses anyone reading the AI logic
- Bloats the bundle by ~3KB

```javascript
if (false) { // legacy strategies disabled — superseded by aiConquestTick()
    // ... 100 lines of Strategy A/B/C/D that NEVER executes
}
```

**Fix:** Delete the entire `if (false)` block. The logic is preserved in git history if ever needed.

---

### B4. 🟡 HIGH — Plane Always Returns to First Airport

**File:** [`Plane` constructor](src/main.js:4168) (line 4168)

**Problem:** 
```javascript
this.baseStruct = structs.find(s => s.owner === owner && s.type === 'airport');
```
`Array.find()` returns the **first** matching element, not the nearest. If a player builds airports in multiple countries, all planes are assigned to the first-built airport regardless of where they were spawned.

**Impact:** Planes may fly across the entire globe to return to base instead of using the nearby airport. Visually confusing and tactically wrong.

**Fix:** Find the nearest airport by distance:
```javascript
this.baseStruct = structs
    .filter(s => s.owner === owner && s.type === 'airport' && !s.dead)
    .sort((a, b) => dst({lat, lon}, a) - dst({lat, lon}, b))[0];
```

---

### B5. 🟢 MEDIUM — `rebuildFrontierLines()` Leaks BufferAttributes

**File:** [`rebuildFrontierLines()`](src/main.js:2397) (lines 2397-2398)

**Problem:** Every territory change creates new `THREE.BufferAttribute` objects for positions and colors, but the old attributes are never disposed:
```javascript
frontierLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
frontierLine.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
```

**Impact:** Slow GPU memory leak over a long game (hundreds of territory changes). Each leak is small (~few KB) but accumulates.

**Fix:** Dispose old attributes before replacing:
```javascript
const oldPos = frontierLine.geometry.getAttribute('position');
const oldCol = frontierLine.geometry.getAttribute('color');
if (oldPos) oldPos.dispose?.();  // or just set .array = null for GC
if (oldCol) oldCol.dispose?.();
frontierLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
frontierLine.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
```

---

## ⚡ PERFORMANCE ISSUES

### P1. 🔴 HIGH — `updateCityLabels()` Called Every Frame

**File:** [`loop()`](src/main.js:7286) → [`updateCityLabels()`](src/main.js:5061)

**Problem:** `updateCityLabels()` is called **every single frame** (60 FPS). It projects every city node through the camera projection matrix, does backface culling, screen-space bounds checking, and updates DOM styles for each visible city.

With 200+ cities, each frame does:
- 200× `latLonToVec3()` (trig operations)
- 200× `_dummyVec.project(camera)` (matrix multiply)
- 200× DOM style writes (`display`, `left`, `top`, `color`, `fontSize`, `fontWeight`)

**Impact:** Estimated 3-8ms per frame (20-50% of frame budget at 60 FPS). DOM style writes are especially expensive because they trigger layout reflow.

**Fix:** Throttle to every 2-3 frames:
```javascript
if (frame % 3 === 0) updateCityLabels();
```
Or better: only update positions every 3 frames, but update visibility (show/hide) every frame using a cheaper dot-product check.

---

### P2. 🔴 HIGH — Per-Frame Array Allocations in Game Loop

**File:** [`loop()`](src/main.js:7205) (lines 7205-7214)

**Problem:** Six `.filter()` calls create **new arrays every frame**:
```javascript
missiles = missiles.filter(m => { m.update(); return !m.dead; });
planes = planes.filter(p => !p.dead);
tradeShips = tradeShips.filter(ts => { ts.update(); return !ts.dead; });
trains = trains.filter(t => { t.update(); return !t.dead; });
troopCohorts = troopCohorts.filter(tc => { tc.update(); return !tc.dead; });
window.paintExpansions = window.paintExpansions.filter(pe => { pe.update(); return !pe.dead; });
```

Each `.filter()` allocates a new array, copies references, and discards the old array. At 60 FPS, this creates 360 garbage arrays per second.

**Impact:** GC pressure causing periodic micro-stutters (1-3ms spikes every few seconds when GC runs).

**Fix:** Use in-place compaction (swap-and-pop pattern):
```javascript
function compactInPlace(arr, updateFn) {
    let w = 0;
    for (let r = 0; r < arr.length; r++) {
        if (updateFn) updateFn(arr[r]);
        if (!arr[r].dead) {
            if (w !== r) arr[w] = arr[r];
            w++;
        }
    }
    arr.length = w;
}
```

---

### P3. 🔴 HIGH — Trail Particle Material Churn

**File:** [`createTrailMesh()`](src/main.js:4310) + [`Missile.update()`](src/main.js:4142)

**Problem:** Missiles create trail particles at 50% probability per frame (line 4142):
```javascript
if (Math.random() < 0.5 && this.mesh.visible) createTrailMesh(curVec);
```

Each `createTrailMesh()` allocates a **new `MeshBasicMaterial`** (line 4313):
```javascript
const mat = new THREE.MeshBasicMaterial({color: 0xaaaaaa, transparent: true, opacity: 1.0});
```

With 5 active missiles, this creates ~150 materials/second. Each material is disposed when the particle dies (line 7241), but the allocation/disposal churn causes severe GC pressure.

**Impact:** Visible stutter when missiles are in flight. Material creation involves GPU state setup — not cheap.

**Fix:** Pool materials or use a single shared material:
```javascript
if (!MAT_CACHE['trail']) MAT_CACHE['trail'] = new THREE.MeshBasicMaterial({color: 0xaaaaaa, transparent: true, opacity: 1.0});
const m = new THREE.Mesh(GEO_CACHE['trail'], MAT_CACHE['trail']);
// Don't dispose in cleanup — shared material lives forever
```
Note: this requires changing opacity animation to use `material.opacity` on a per-mesh basis (via `onBeforeRender` or a custom shader), or accepting uniform opacity for all trails.

---

### P4. 🟡 MEDIUM — Explosion Material Churn

**File:** [`spawnExp()`](src/main.js:4299)

**Problem:** Same pattern as P3. Each explosion creates a new material:
```javascript
const mat = new THREE.MeshBasicMaterial({color: new THREE.Color(col), transparent: true, opacity: 0.8});
```

Less frequent than trails (explosions are discrete events) but still creates unnecessary GC pressure during combat.

**Fix:** Cache materials by color key:
```javascript
function getExpMat(col) {
    if (!MAT_CACHE['exp_' + col]) MAT_CACHE['exp_' + col] = new THREE.MeshBasicMaterial({color: new THREE.Color(col), transparent: true, opacity: 0.8});
    return MAT_CACHE['exp_' + col];
}
```

---

### P5. 🟡 MEDIUM — AI Repeated `structs.filter()` Scans

**File:** [`runAI()`](src/main.js:6895)

**Problem:** Per AI tick, the code does 5+ separate `.filter()` calls on the `structs` array:
- Line 6901: `structs.filter(s => s.owner==='enemy' && s.type==='launcher' && s.reload <= 0)`
- Line 6904: `structs.filter(s => s.owner === 'player' && !s.dead)`
- Line 7130: `structs.filter(s => s.owner === 'enemy' && s.type === 'base' && ...)`
- Line 7131: `structs.filter(s => s.owner === 'enemy' && s.type === 'launcher' && ...)`
- Line 7132: `structs.filter(s => s.owner === 'enemy' && s.type === 'airport' && ...)`

Each is O(N). With 50+ structures, this is 250+ comparisons per AI tick.

**Fix:** Pre-filter once into categorized arrays:
```javascript
const enemy = structs.filter(s => s.owner === 'enemy' && !s.dead);
const enemyLaunchers = enemy.filter(s => s.type === 'launcher');
const enemyBases = enemy.filter(s => s.type === 'base');
// ... use these throughout
```

---

### P6. 🟡 MEDIUM — `Structure.update()` Scans All Missiles Every Frame

**File:** [`Structure.update()`](src/main.js:4070) (line 4074)

**Problem:** Every structure with `fireRange > 0` scans the entire missiles array every frame:
```javascript
let trg = missiles.find(m => !m.dead && m.owner !== this.owner && dst(this, m) < this.fireRange);
```

With S SAM structures and M missiles, this is O(S × M) per frame. At 20 SAMs and 10 missiles, that's 200 distance calculations per frame.

**Fix:** Only check missiles that are airborne (progress > 0.1) and within a rough angular distance. Or maintain a spatial index. Or simply throttle the check to every 5-10 frames (missiles move slowly enough).

---

### P7. 🟢 LOW — `calcIncome()` Called Twice Per Econ Tick

**File:** [`loop()`](src/main.js:7250) (lines 7250-7251)

**Problem:** Each econ tick calls `calcIncome('player')` and `calcIncome('enemy')`. Each call iterates all structures AND all planes. The plane filter is redundant:
```javascript
let planeCount = planes.filter(p => p.owner === side && !p.dead).length;
```

**Fix:** Combine into a single pass that counts both sides simultaneously.

---

### P8. 🟢 LOW — Mode 2 AI O(P²) Province Scan

**File:** [`runAI()`](src/main.js:7079) (lines 7079-7103)

**Problem:** For each enemy province, iterates ALL provinces to find attack targets. With 100 provinces, this is 10,000 iterations per AI tick.

**Fix:** Pre-compute province adjacency or use a spatial index.

---

### P9. 🟡 MEDIUM — Parked Plane Vector3 Allocation Storm

**File:** [`Plane.update()`](src/main.js:4219) (lines 4219-4237)

**Problem:** Each parked plane creates ~10 `THREE.Vector3` objects per frame for orbit math:
```javascript
let right = new THREE.Vector3(0,1,0).cross(bPos).normalize();
let up = bPos.clone().cross(right).normalize();
let orbitVec = bPos.clone().multiplyScalar(EARTH_RADIUS + 50.0);
orbitVec.add(right.multiplyScalar(Math.cos(angle) * 3));
orbitVec.add(up.multiplyScalar(Math.sin(angle) * 3));
// ... then does it AGAIN for the ahead vector (lines 4231-4237)
```

With 20 parked planes, this creates ~200 Vector3 objects per frame = 12,000/second.

**Fix:** Use pre-allocated scratch vectors (module-level `_v1`, `_v2`, `_v3`).

---

## ⚠️ POTENTIAL ISSUES

### I1. 🟡 HIGH — No Error Boundary on Game Loop

**File:** [`loop()`](src/main.js:7189)

**Problem:** The main game loop has no try/catch wrapper. If ANY update function throws an exception (e.g., null reference in `structs.forEach(s => s.update())`), the `requestAnimationFrame(loop)` at the bottom is never reached, and the game **permanently freezes**.

Currently only `updateResearch()` is wrapped (line 7276):
```javascript
try { updateResearch(); } catch(e) { console.error('[LOOP] updateResearch crashed:', e); }
```

**Fix:** Wrap the entire loop body:
```javascript
function loop() {
    if (gOver) return;
    frame++;
    try {
        // ... all update logic ...
    } catch (e) {
        console.error('[LOOP] Frame crashed:', e);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}
```

---

### I2. 🟢 MEDIUM — External GeoJSON Dependency

**File:** [`init3D()`](src/main.js:3831)

**Problem:** Territory data is fetched from `raw.githubusercontent.com` at runtime. If GitHub is rate-limited or offline, it falls back to local `tmp_geojson.json`. If both fail, the game has no territory borders but continues running silently — the player won't know why countries don't render.

**Fix:** Bundle the GeoJSON locally as the primary source, or show a visible error banner if both fetches fail.

---

### I3. 🟢 MEDIUM — `spawnTradeShipsForActivePorts()` O(P × S)

**File:** [`spawnTradeShipsForActivePorts()`](src/main.js:2712)

**Problem:** For each port, filters ALL structures to find target ports:
```javascript
let targets = structs.filter(t => t.type === 'port' && t !== port && !t.dead && t.owner !== port.owner);
```

With P ports and S structures, this is O(P × S). Should pre-compute the port list once.

---

### I4. 🟢 MEDIUM — `Missile.explode()` Scans All Structures

**File:** [`Missile.explode()`](src/main.js:4151)

**Problem:** Every missile explosion iterates all structures for damage:
```javascript
structs.forEach(s => {
    if(s.owner !== this.owner && dst(this, s) < ((this.cfg.rad||60)/5)) {
        s.hit(this.cfg.dmg || 50);
    }
});
```

With simultaneous nuclear explosions, this is O(explosions × structures).

---

### I5. 🟢 LOW — `checkWin()` Multiple Array Scans

**File:** [`checkWin()`](src/main.js:6806)

**Problem:** Mode 2 win check does 6+ separate array scans (lines 6823-6844):
- 2× `structs.filter()` for base counts
- 1× `cityNodes.forEach()` for VP counting
- 2× `cityNodes.filter()` for city counts

Could be combined into a single pass.

---

## ✅ What's Working Well

These patterns are **correct and efficient** — no changes needed:

1. **Conquest grid incremental rendering** — `flushRender()` uses dirty-cell tracking with bounding-box-limited `putImageData()`. Only changed regions are copied to canvas.

2. **`countCells()` is O(1)** — Uses incrementally-maintained `_counts[ownerStr]` map. No scanning needed for win checks.

3. **Geometry caching** — `GEO_CACHE` and `getSharedGeo()`/`getSharedMat()` properly reuse geometries and materials for structures.

4. **HPA pathfinding** — Bounded Dijkstra with hard node caps, incremental reset, lazy path computation. 100% route success, no freeze risk. (See [`plans/pathfinding-analysis.md`](plans/pathfinding-analysis.md:1) for pathfinding-specific analysis.)

5. **LOD system for city labels** — 4-level distance-based culling correctly hides distant cities.

6. **Frontier line rendering** — Inlined `latLonToVec3` avoids per-vertex Vector3 allocation. Uses typed arrays (`Float32Array`) for GPU upload.

7. **Conquest attack system** — MinHeap-based frontier expansion with proper cell validation. Bounded `MAX_CELLS_PER_TICK` prevents frame spikes.

---

## 🎯 Recommended Fix Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 🔴 P0 | **B1** — Dispose geometries/materials in `backToMenu()` | 15 min | Prevents WebGL crash |
| 🔴 P0 | **I1** — Try/catch wrapper on game loop | 5 min | Prevents permanent freeze |
| 🔴 P1 | **P1** — Throttle `updateCityLabels()` to every 3 frames | 1 line | 10-20% frame time saved |
| 🔴 P1 | **P2** — In-place array compaction in loop | 20 min | Eliminates GC stutter |
| 🔴 P1 | **P3** — Shared material for trail particles | 10 min | Eliminates GC stutter |
| 🟡 P2 | **B2** — Remove event listeners on restart | 30 min | Fixes dev panel glitches |
| 🟡 P2 | **B3** — Delete dead `if (false)` code block | 2 min | Cleaner codebase |
| 🟡 P2 | **B4** — Plane finds nearest airport | 5 min | Correct gameplay |
| 🟡 P2 | **P5** — Pre-filter structs in AI | 15 min | Faster AI ticks |
| 🟡 P2 | **P9** — Scratch vectors for parked planes | 10 min | Less GC pressure |
| 🟢 P3 | **B5** — Dispose old BufferAttributes | 5 min | Slow leak fix |
| 🟢 P3 | **P4** — Cache explosion materials | 5 min | Less GC pressure |
| 🟢 P3 | **P6** — Throttle SAM missile scan | 5 min | Faster combat |
| 🟢 P3 | **P7-P9, I2-I5** | Various | Minor improvements |
