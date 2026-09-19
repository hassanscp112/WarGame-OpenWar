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
- **Task: TASK-406 — World Render Layer (feature/world-system)**
  - **Status**: ✅ COMPLETE — ready-for-merge
  - **What**: Grid painting + frontier-line rendering extracted from `src/main.js` into `src/world/render.js` (the world-feature slice of the TASK-407 great split).
  - **New in `src/core/conquest.js`**: shared dirty-region queue (`takeOverlayRect()` — full/null/rect semantics), fused paint+border full pass, devastation VISUAL layer (scorch canvas, bucketed repaints), frontline heat map (`getHotEdges`).
  - **New in `src/world/render.js`**: territory overlay with SUB-RECT blits (was: full 2048×1024 re-blit per flush), crisp frontier lines (150ms throttle preserved), devastation scorch sphere, capture flash point pool (512, shader-faded), frontline heat glow (pulsing additive line), drone selection rings.
  - **`main.js` integration**: thin delegates (`renderMode1Territory`/`rebuildFrontierLines`), capture-flash hook in `conquestCtx.onConquerCell`, `WORLD_RENDER.reset()` in `cleanupTerritory`, `tickVfx`+`updateDroneRings` in the render loop; ~160 lines of inline state/pipeline deleted.
  - **Verified**: `scripts/test_world_render.mjs` — 48/48 headless checks (queue semantics, scorch lifecycle, heat pruning, mesh creation/disposal); `vite build` clean; browser smoke test — mode1 game spawned, territories painting green+red, 0 page errors over 12s of conquest ticks.

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
