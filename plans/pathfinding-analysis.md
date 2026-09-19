# 🔬 PATHFINDING ALGORITHM ANALYSIS — Improvement Opportunities

> **Date**: 2026-07-22
> **Scope**: Trade-ship HPA pathfinding system in `src/main.js` + `scripts/build_river_routes.cjs`
> **Reference**: OpenFrontIO `AStar.WaterHierarchical.ts`

---

## 🏗️ CURRENT ARCHITECTURE

### How it works (3-phase HPA routing)

```
findHPAPath(srcLat, srcLon, dstLat, dstLon)
│
├─ Phase 1: boundedMedDijkstra(srcPort → hwCellSet, maxNodes=12000)
│   └─ 8-dir grid Dijkstra, binary heap, hard node cap
│
├─ Phase 2: boundedMedDijkstra(dstPort → hwCellSet, maxNodes=12000)
│   └─ Same, finds nearest highway node from destination
│
├─ Phase 3: findHighwayPath(srcNode → dstNode)
│   └─ Pure Dijkstra on sparse graph (~28K nodes), binary heap
│   └─ Full O(N) array reset every call
│
├─ Phase 4: Combine srcFlow + hwPath + reverse(dstFlow)
│
└─ Fallback: boundedMedDijkstra(src → dst, maxNodes=60000)
```

### Data structures
- **Medium grid**: 3600×1800 (6.48M cells), `_mWater`/`_mGScore`/`_mCameFrom`/`_mClosed` (~70MB)
- **Highway graph**: 28,539 nodes, 62,327 edges, adjacency list of `{to, dist}` objects
- **Heap**: JS array of `[cost, node]` pairs (both Dijkstras)

---

## ✅ STRENGTHS (What works well)

| Aspect | Detail |
|--------|--------|
| **No freeze guarantee** | Hard `maxNodes` cap on every Dijkstra — impossible to explore unbounded cells |
| **Incremental reset** | `boundedMedDijkstra` tracks `_mVisited[]` and resets only touched cells — O(visited) not O(6.48M) |
| **Lazy path computation** | Path computed on first `update()`, not constructor — spreads cost across frames |
| **100% route success** | 6523/6523 routes pass offline test, 42 components (1 ocean + 41 inland) |
| **Graceful degradation** | Ships die silently if no path — no crash, no freeze |
| **Highway graph bridges** | Disconnected components bridged at build time (Gibraltar, Hormuz, Suez Canal) |

---

## ⚠️ WEAKNESSES & IMPROVEMENT OPPORTUNITIES

### 🔴 HIGH IMPACT

#### 1. Highway search uses Dijkstra, not A* (biggest win)
**Current** ([`findHighwayPath()`](src/main.js:1338)): Pure Dijkstra — explores equally in all directions.

**Problem**: For a Turkey→USA route, Dijkstra explores the entire Mediterranean, Indian Ocean, and Pacific before finding the destination. With 28K nodes, that's potentially 28K nodes explored.

**Fix**: Add A* heuristic — `f = g + haversine(node, dstNode)`. This directs the search toward the destination, typically exploring **5-10× fewer nodes**.

```javascript
// CURRENT (Dijkstra):
const tentG = g + edges[e].dist;
heap.push([tentG, nb]);

// IMPROVED (A*):
const tentG = g + edges[e].dist;
const f = tentG + haversineDist(nodes[nb].lat, nodes[nb].lon, dstLat, dstLon);
heap.push([f, nb]);  // priority = f, but gScore still tracks tentG
```

**OpenFront does this**: `this.abstractAStar.findPath()` uses A* with heuristic.

**Estimated improvement**: 5-10× faster highway queries. Currently <1ms, would drop to <0.2ms.

---

#### 2. `_nearestHighwayNode()` is O(N) linear scan — called 4× per route
**Current** ([`_nearestHighwayNode()`](src/main.js:1322)): Scans all 28K nodes twice in `findHPAPath` (src + dst exit), plus twice more in `findHighwayPath`.

**Problem**: 4 × 28K = 112K haversine calculations per route. At 28K nodes this is ~0.5ms, but it scales linearly with graph growth.

**Fix**: Build a **spatial grid** at load time — bucket highway nodes into a coarse lat/lon grid (e.g., 5° cells). Lookup becomes O(1) + scan ~10 nearby nodes.

```javascript
// At load time:
const _hwSpatialGrid = {};  // "lat5,lon5" → [nodeIdx, ...]
for (let i = 0; i < nodes.length; i++) {
    const key = `${Math.floor(nodes[i].lat/5)},${Math.floor(nodes[i].lon/5)}`;
    (_hwSpatialGrid[key] ||= []).push(i);
}
// Lookup: check 3×3 surrounding cells, find nearest among ~20 nodes
```

**OpenFront does this**: `findNearestNode()` uses cluster-based `tileBFS.search()` bounded to a single cluster — O(clusterSize²) not O(N).

---

#### 3. Highway Dijkstra does full O(N) array reset every call
**Current** ([lines 1360-1364](src/main.js:1360)): Resets all 28K entries in `_hwGScore`, `_hwCameFrom`, `_hwClosed` every call.

**Problem**: 3 × 28K = 84K array writes per route, even if only 500 nodes were visited.

**Fix**: Use the same incremental-reset pattern as `boundedMedDijkstra` — track visited nodes and reset only those.

```javascript
const _hwVisited = [];
// ... during search:
if (_hwGScore[nb] === Infinity) _hwVisited.push(nb);
// ... after search:
for (const n of _hwVisited) { _hwGScore[n] = Infinity; _hwCameFrom[n] = -1; _hwClosed[n] = 0; }
_hwVisited.length = 0;
```

**Estimated improvement**: 84K writes → ~1.5K writes (only visited nodes). ~50× less reset overhead.

---

### 🟡 MEDIUM IMPACT

#### 4. No path caching between highway node pairs
**Current**: Every ship recomputes the full highway path, even if 10 ships take the same route.

**OpenFront does this**: `graph.getCachedPath(edgeId, fromNodeId)` — caches local path segments between abstract nodes. Reused by all subsequent ships.

**Fix**: Cache highway paths by `(srcNode, dstNode)` pair in a `Map`. Invalidate when the graph is edited. LRU eviction if memory grows.

```javascript
const _hwPathCache = new Map();  // "srcNode,dstNode" → [waypoints]
const key = `${srcNode},${dstNode}`;
if (_hwPathCache.has(key)) return _hwPathCache.get(key);
// ... compute path ...
_hwPathCache.set(key, path);
```

**Estimated improvement**: Repeated routes become O(1) hash lookup. Huge for trade routes (same path used by many ships).

---

#### 5. Binary heap uses JS array-of-pairs (GC pressure)
**Current**: `heap.push([tentG, nb])` — allocates a new 2-element array per heap insertion.

**Problem**: For a 12K-node bounded Dijkstra, that's ~12K array allocations per phase, 24K per route. GC pressure on hot path.

**Fix**: Use a **flat typed-array heap** like OpenFront's `FlatBinaryHeap`:
- `Float64Array` for priorities
- `Int32Array` for values (cell/node indices)
- No object allocation

**OpenFront does this**: [`FlatBinaryHeap.ts`](OpenFrontIO-main/src/core/execution/utils/FlatBinaryHeap.ts) — pre-allocated typed arrays, `enqueue(tile, priority)`.

---

#### 6. No path smoothing (jagged visual routes)
**Current**: The combined path has sharp 45°/90° corners at every grid cell and highway node junction.

**OpenFront does this**: `SmoothingTransformer` post-processes the raw path.

**Fix**: Apply **Douglas-Peucker simplification** (remove redundant collinear waypoints) + **Catmull-Rom interpolation** (smooth corners). This is purely visual — doesn't affect routing logic.

---

#### 7. Phase 1 and Phase 2 are independent unidirectional searches
**Current**: Two separate bounded Dijkstras — one from src port, one from dst port. If both ports are in the same region (e.g., Mediterranean), the search frontiers overlap wastefully.

**Fix**: **Bidirectional Dijkstra** — search from both ports simultaneously, terminate when frontiers meet. Halves the search radius (¼ the cells explored).

```
Current:  src ──────→ highway ←─────── dst    (two full searches)
Better:   src ──→ ←── dst                     (meet in middle)
```

---

### 🟢 LOW IMPACT / FUTURE

#### 8. Uniform cost model (no terrain awareness)
**Current**: All water cells cost 1.0 (orthogonal) or 1.414 (diagonal).

**Possible improvement**: Add cost weights — prefer deep ocean over shallow coastal water, avoid known warship patrol zones. Would require a depth/biome lookup per cell.

#### 9. No dynamic obstacle avoidance
**Current**: Ships route through enemy warship zones without avoidance.

**Possible improvement**: Mark cells near enemy warships as high-cost in `_mGScore`, forcing routes around them. Would need periodic refresh.

#### 10. 8-directional movement causes diagonal artifacts
**Current**: 8 directions → paths have visible 45° stair-step patterns.

**Possible improvement**: 16-direction movement or **JPS (Jump Point Search)** for more natural paths. JPS also speeds up uniform-cost grid search significantly.

#### 11. No contraction hierarchies (CH) or ALT landmarks
**Current**: The highway graph is searched with standard Dijkstra/A*.

**Possible improvement**: Precompute **contraction hierarchies** at build time. CH makes highway queries O(log N) — effectively instant for any graph size. This is the gold standard for road-network routing (Google Maps uses it).

#### 12. Medium grid memory footprint (~70MB)
**Current**: 4 typed arrays × 6.48M cells = ~70MB persistent memory.

**Possible improvement**: Use a **chunked/sparse representation** — only allocate arrays for water-containing regions. Or use `Uint16Array` for gScore (quantized costs) instead of `Float32Array`.

---

## 📊 PRIORITY MATRIX

| # | Improvement | Effort | Impact | Priority |
|---|------------|--------|--------|----------|
| 1 | A* heuristic on highway search | Low (10 lines) | 🔴 High | **Do first** |
| 2 | Spatial grid for node lookup | Medium (50 lines) | 🔴 High | **Do second** |
| 3 | Incremental reset on highway Dijkstra | Low (15 lines) | 🔴 High | **Do third** |
| 4 | Path caching | Medium (40 lines) | 🟡 Medium | Do fourth |
| 5 | Flat typed-array heap | Medium (80 lines) | 🟡 Medium | Optional |
| 6 | Path smoothing | Medium (60 lines) | 🟡 Visual | Optional |
| 7 | Bidirectional Dijkstra | High (100+ lines) | 🟡 Medium | Future |
| 8 | Terrain-aware costs | High | 🟢 Low | Future |
| 9 | Dynamic obstacles | High | 🟢 Low | Future |
| 10 | JPS / 16-dir | High | 🟢 Low | Future |
| 11 | Contraction hierarchies | Very High | 🔴 High | Future (big graph) |
| 12 | Sparse memory layout | Medium | 🟢 Low | Future |

---

## 🎯 RECOMMENDED ACTION PLAN

### Quick wins (1-2 hours total, items 1-3):
1. **Add A* heuristic** to `findHighwayPath()` — 10 lines, 5-10× faster highway queries
2. **Add incremental reset** to highway Dijkstra — 15 lines, 50× less reset overhead
3. **Add spatial grid** for `_nearestHighwayNode()` — 50 lines, O(1) lookup

These three changes together would make each route computation **~20× faster** with zero risk to correctness (same paths, just faster).

### Medium-term (items 4-6):
4. **Path caching** — eliminates redundant computation for repeated routes
5. **Flat heap** — reduces GC pressure
6. **Path smoothing** — makes routes look natural on the globe

### Long-term (if graph grows or performance matters):
7-12. Bidirectional search, CH, JPS, terrain costs, etc.

---

## 📖 OpenFront COMPARISON SUMMARY

| Feature | Our System | OpenFront |
|---------|-----------|-----------|
| Abstract search | Dijkstra (no heuristic) | **A*** (with heuristic) |
| Node lookup | O(N) linear scan | **O(cluster²) BFS** |
| Array reset | Full O(N) | **Incremental** (via visited tracking) |
| Path caching | ❌ None | **✅ Per-edge segment cache** |
| Heap | JS array-of-pairs | **FlatBinaryHeap (typed arrays)** |
| Local search | Bounded by node count | **Bounded by spatial cluster box** |
| Path smoothing | ❌ None | **✅ SmoothingTransformer** |
| Freeze prevention | ✅ Hard maxNodes cap | ✅ Bounded region + node cap |
| Multi-source | ❌ Single source | **✅ Multi-source (SourceResolver)** |
| Inland water | ✅ 41 seeded components | ❌ (not applicable — different map) |
| Dynamic editing | ✅ Map editor + rebuild | ❌ (static graph) |
