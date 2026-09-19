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
- **TASK-401: Air Force Deep Pass (AirCombat module + main.js integration)**
  - **Status**: Module extraction + integration COMPLETE (commits `0950a3f` → `770df7c`).
  - **Architecture**: `src/air/aircombat.js` owns all air doctrine (dogfight, strike, SEAD, squadrons, veterancy, tanking, VFX, wrecks). `main.js` Plane class delegates through the **AIRW bridge** (live getters → module scope; module never imports the game).
  - **New gameplay**: kill XP → 4 veterancy tiers (dmg/evade/decoy bonuses + tally marks + UI rank row); squadrons form on multi-plane orders (highest-XP leads, echelon offsets, mid-air succession on leader loss); SEAD anti-radiation missiles vs emitting radars (EMP suppression breaks seeker lock); KC-135 tanker + AWACS buddy refueling with RTB resume; doctrine altitudes per role; fighters hunt enemy drones; nap-of-earth helis (AA range ×0.5, SAM lock-miss 50%); RWR lock tone for player crews.
  - **Fixes riding along**: drones were updated TWICE per tick (dup line, audit #3 regression); AAM pKill went NaN vs drone targets (missing turnRate — never hit); AAMs now credit kills to the shooter (veterancy); wreck gravity sign inverted (flew AWAY from globe).
  - **Verification**: `scripts/test_aircombat.mjs` — 56/56 Node unit tests (real THREE + constants, mocked world). `npx vite build` clean. Live browser probes on :3001 ALL PASS: airstrike (3 runs → 3 structures destroyed), dogfight (F-22 kills F-16 + promotes to مدرَّب), stealth gating, samVsPlane (15 SAM shots, nap-of-earth lock misses), botWing (auto-scramble), airModelsCheck (11/11 PCFG types construct incl. KC-135), movement (50 km/s measured vs 49.5 expected on the alloc-free path).
  - **Perf (audit #22)**: Plane.update movement is allocation-free (`_mv1-4` scratch + `latLonToVec3(lat, lon, r, out)` optional out-param; was ~5 Vector3/plane/frame). Bot air wings buy doctrine support: exactly one tanker + one AWACS per rival once 2+ combat planes exist; F-22 unlocks for rich rivals (commit `50fdb2d`).
  - **Status**: READY FOR MERGE — branch `feature/airforce-system`, HEAD `50fdb2d`.
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

### **TASK-401 (feature/airforce-system, 2026-09-19)**
* **AirCombat module**: ~500-line air-doctrine module extracted from Plane (`src/air/aircombat.js`) — dogfight/strike/SEAD/squadrons/veterancy/tankers/VFX/wrecks behind the AIRW world bridge.
* **Integration**: Plane.update() delegates parkedTick/dogfightScan/dogfightWeapons/strikeTick/tickRefuel/squadronSteer/vfxTick; down/crash spawn wrecks + leader succession; AAM carries shooter for kill credit; SAM battery fires RWR tone + nap-of-earth lock misses.
* **Tests**: `scripts/test_aircombat.mjs` (56 assertions, Node + real three) + all live `__ffaProbe` air probes green.

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
