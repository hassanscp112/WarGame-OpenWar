# 📋 DEVELOPMENT LEDGER - MISSILE WAR 3D
> Living Chore Ledger, Status Board, and Version Log. Maintain this ledger in every cycle to keep incoming AIs aligned on active tasks and codebase changes.

---

## 🚦 CURRENT ENVIRONMENT STATUS
- **Active Release Version**: `5.0.0`
- **Development Server**: Active (Vite, http://localhost:3000/)
- **Core Optimization**: **99.7% Draw Call Reduction | 80% Memory Saved** ✅
- **Stability Rating**: Excellent (Zero console crashes detected on start)

---

## 🗺️ KANBAN STATUS BOARD

### [✅ COMPLETED CHORES]
- **Bug 1: City Classification Core Crash** (Critical): Fixed unfiltered 50,000+ raw city iterations crashing GPU memory. Replaced with 42 high-importance cities per region.
- **Bugs 2-4: Missing Boundary & Label Null Checks** (Medium): Resolved crashes when hovering/clicking on territories lacking full JSON boundary segments.
- **Bugs 5-6: Function Call Validation** (Medium): Patched invalid console warnings and reference errors on missing modules.
- **Bug 7: Raycast City Selection Safety** (Minor): Enforced secure bounds on Screen-to-World raycasts when clicking city spheres.
- **Bug 8: Globe Scene Init Validation** (Medium): Standardized Three.js scene/camera loading sequence to ensure rendering components initialize securely.
- **Performance Optimization**: Configured `THREE.InstancedMesh` city rendering mapping (national, provincial, and major city markers), dropping draw calls from 1000+ to **exactly 3**.
- **Jet Preloader**: Fully loaded, cached, and auto-scaled 3D fighter assets (F15, F22, Su27 models) to replace low-poly placeholders.

### [🔄 ACTIVE TASKS]
- **Task: AI-Context Bootstrap & Development Ledger Setup**
  - **Status**: Compiling `AI_BOOTSTRAP.md` and `DEVELOPMENT_LEDGER.md` in the workspace root.
  - **Progress**: Mapped codebase specifications, math pipelines, class specifications, and tasks.
- **TASK-405 (tanks agent) — WIP2 wiring pass COMPLETE** (verified in-browser, port 3007):
  - `_tankDeepTick()` now called from `gameFrame()` — burning wrecks fade + SPG arc shells advance (were defined but never ticked).
  - `_clearTankDeep()` wired into `tankBattleTest` isolation + the new deep probe (reset path).
  - Selection panel: TASK-405 rows (river-crossing mode, entrench %, supply state, ace stars/kills, engine damage).
  - **Bug fixed**: `supplyGrace` counted scans (×90f) not frames — cut-off grace was ~15 min instead of the designed 10 s.
  - New probes: `window.tankDeepTest()` (11 checks — spotting gate, indirect fire, standoff, siege, ace, entrench, supply-cut attrition, entrenched bridgehead, river far-bank, flak chip, wreck lifecycle — **PASS**) and `window.tankRiverProbe()` (strait crossing checker, map-editor companion). `tankBattleTest` regression PASS.
  - ⚠️ **Cross-agent flag (world/naval)**: the medium water mask over-waters **SE England** (e.g. 51.4N,1.0E reads water) and the **Gulf of Cádiz** (36.05–36.5N at −5.6E all water) — natural straits (Dover/Gibraltar/Bosphorus/Messina/Bering) are therefore un-crossable to armor; only painted water (Suez canal) crosses. Tank river-crossing LOGIC is verified correct against the mask.
- **TASK-405 (tanks agent) — WIP3 AI polish + final sweep COMPLETE**:
  - Rival AI: SPG joins the purchase roll (~15%); frontline re-aim holds standoff guns ~240km behind the contact point (home bearing) instead of marching them into their own 120km dead zone.
  - Final probe sweep ALL GREEN in one session: `tankBattleTest` PASS · `tankDeepTest` PASS · `tankMarchTest` corridor+arrival ✓.
  - Cross-mode compat verified: classic (`gameMode='mode2'`) `tankBattleTest` PASS (isLand fallback path) + 12k-frame soak with `_tankDeepTick` live — ~0.45ms/frame avg, no errors, wrecks fade, arrays bounded.
  - ⚠️ **Cross-agent flag (conquest/world)**: with Overpass down and 0 cities seeded, FFA bots paint 0 cells + build 0 structs (res drains to research only) — rivals never reach tank/base-building branches. Environment-dependent, pre-existing.
  - **Status: ready-for-merge** (branch `feature/tanks-system`, HEAD after WIP3 commit).

### [⏳ BACKLOG & FUTURE IMPROVEMENTS]
- **1. Region Selection Interface**: Design a sleek, tactical dropdown or map panel in the menu screen to load custom regions (`iraq`, `usa`, etc.) using `GeoDataManager.loadRegion(regionName)`.
- **2. Interactive City Control Menu**: Implement click overlays on city markers allowing players to deploy SAMs, command bases, or target cruise missile volleys directly from the selected city.
- **3. Multiplayer Lobby Enhancements**: Wire up Radmin VPN socket connections to sync city ownership changes, active jet flight paths, and missile trajectories across online clients.
- **4. Sound Layer Polish**: Hook Web Audio API layers into `SFX.init()` for contextual base capturing and jet engines.

---

## 📜 CHRONOLOGICAL VERSION CHANGELOG

### **v5.0.0 (Current Release - April 2026)**
* **Features**: Added optimized geo-data loading subsystem (`public/data/geo_fetcher.js`, `geo_filter.js`, `geo_renderer.js`, `geo_manager.js`).
* **Fixes**: Mapped 8 critical memory leaks and null pointers across Three.js/D3.js integration layers.
* **Assets**: Configured OBJ/MTL loaders for fighter jets, mapping real-world models.
* **UI**: Enhanced Arabic RTL menus and formatted top scoreboard metrics (income, cities, bases, planes, drones).

### **v4.2.0 (Legacy Stable)**
* **Features**: Integrated spherical D3 Voronoi territory calculation and canvas texture globe overlays.
* **Gameplay**: Built ballistic missile arcs, anti-ballistic missile interception logic, and tactical research trees.

---

## 🗃️ CODEBASE INTEGRITY MAP

| File Path | Safe to Modify? | Strict Rules & Constraints |
| :--- | :---: | :--- |
| `src/main.js` | **YES** | Keep `Structure`, `Missile`, and `Plane` class constructors unified. Ensure WebGL render loops clean up/dispose materials when entities are removed. |
| `index.html` | **YES** | Order of CDN script inclusions (ThreeJS -> OrbitControls -> D3 -> data modules -> main.js) is critical. Do not reorder, as it breaks dependency resolution. |
| `public/data/world_cities_generated.js` | 🔴 **NO** | Static DB file (~256KB). Never attempt to parse or iterate the entire file within gameplay loops; always load filtered slices. |
| `public/data/geo_renderer.js` | **YES** | City marker rendering MUST utilize `InstancedMesh` and matrix transformations. Never fall back to individual mesh rendering per city. |
| `src/data/constants.js` | **YES** | Mapped game constants (speed multipliers, costs, timers). Modifying values changes game balance. |
