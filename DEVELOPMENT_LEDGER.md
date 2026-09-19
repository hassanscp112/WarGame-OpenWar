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
- **Task: TASK-403 — Missile System Deep Pass (feature/missile-system)**
  - **Pass 1 (commit 8cd8722)** ✅: SAM radar-chain perf (chain-band-only checks + owner-cached source lists, 30f TTL, live EMP/death re-check), Drone.ACQUIRE candidate cache (#21), DRONE_HIT_RANGE_KM wired, DRONE_SPEED_MUL removed; drive-by fix — drones updated TWICE per tick since TASK-302 merge (logged for @lead).
  - **Pass 2 (commit 5d75186)** ✅ ALL 6 PROBES PASS (browser-verified 2026-09-19):
    - `radar_ecm` station (hotkey **J**, $650): ONE mid-course guidance re-scatter of (ECM_SCATTER_MUL−1)× natural scatter for enemy missiles inside 520km; hyper exempt, EMP-dark, friendly immune, EMP-jammable itself.
    - Launcher magazine: `LAUNCHER_MAG`=6 rounds → `LAUNCHER_REARM_FRAMES` (10s) bulk reload; dry pads hide the pad rocket, are skipped by `_pickLaunchPoint`, excluded from AI readiness; player re-arm log events (Arabic).
    - AA vs drones: SAM/iron_dome guided interceptors (`fireSAMDrone`, `tgtIsDrone` arms in `Missile.update`); flak/CIWS agility-scaled chance barrage at `AA_DRONE_DETECT`=160km with near-miss puffs.
    - MIRV: bus → 3 slim RV models, spread-preview rings, dmgScale 0.55.
    - Mixed volleys: `_volleyPlan` multi-type salvos (cost + order preserved), per-shot magazine consumption, `volleyCount='mix'`.
    - Probes: `samTest` 4/4, `ecmTest` 6/6, `aaDroneTest` 4/4, `magTest` 5/5, `mirvTest` 5/5, `mixVolleyTest` 6/6 — `window.<name>()` from browser console.
    - **Probe gotcha (repeat offender)**: `new Structure()`/`new Drone()` do NOT self-register into `structs`/`drones` — live flow (`build*`, `launchDrone`) pushes them; probes MUST push too or scans see nothing (caused 2 false FAILs).
  - **Pass 3 — FULL-SCOPE VERIFICATION** ✅ (2026-09-19, status → ready-for-merge):
    - POLISH verified present: MTAGS Arabic tooltips on all R-mode chips; `_magPipsRing` ammo pips (green/dim/orange arcs on the range ring); launch-smoke per style (silo column / rail sparks / sub spray + surface ring / air none); `_oceanSplash` for intercepts over water; `_mushroomStack` rising torus column (4s) + W80 falloff/flash/blast-EMP.
    - REFACTOR verified present: `WARHEADS[mkey].onImpact(ctx)` table; `MPHASE` flight-phase enum (BOOST/COAST/REENTRY/CRUISE).
    - **Live E2E in browser**: spawn → build launcher (hotbar 4, $180) → R-mode rings+pips → fire volley → HUD "منصات جاهزة 1/1→0/1 · المخزون 6/6→5/6". No console errors; probes leave no leaked entities (`__ffaProbe.droneCheck()` clean).
    - Remaining: audit **#15 drone selection panel** — explicitly coordination with TASK-406 agent or lead, not solo work.
  - **Next**: TASK-407 refactor (lead-led, after 401-406).
- **Task: AI-Context Bootstrap & Development Ledger Setup**
  - **Status**: Compiling `AI_BOOTSTRAP.md` and `DEVELOPMENT_LEDGER.md` in the workspace root.
  - **Progress**: Mapped codebase specifications, math pipelines, class specifications, and tasks.

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
