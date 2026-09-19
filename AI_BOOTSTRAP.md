# 🤖 CODENAME: ANTIGRAVITY ROCKET GAME - AI BOOTSTRAP CONTEXT MAP
> Ultra-Dense Token-Optimized Specification for Large Language Models. Read once to bootstrap complete codebase comprehension.

---

## 🛠️ TECH STACK & SYSTEM DEPENDENCIES
- **Runtime / Bundler**: Vite (v8+), pure ESM loading (`type: "module"`)
- **Render Engine**: Three.js (r128) - 3D globe scene, meshes, cameras, directional/ambient lighting, OrbitControls, OBJ/MTL preloading
- **Geo-Math Utilities**: D3.js (v7) - geographic projections, spherical Voronoi maps, JSON paths
- **UI & Layout**: HTML5 shell over canvas, Vanilla CSS (Arabic RTL support, "Rajdhani" typography)
- **Math System**: Spherical trigonometry, Great Circle distance maps

---

## 📁 DIRECTORY STRUCTURE & FILE ROLES
```plaintext
Rocket Game/
├── index.html                           # App shell, Arabic UI tabs, CDNs, script imports
├── package.json                         # Scripts: "dev": "vite", dependencies (Three.js, Turf, JSdom)
├── vite.config.js                       # Basic Vite dev server mapping (port 3000 default)
├── public/data/                         # Static databases and optimized Geo modules
│   ├── world_cities_generated.js        # Static DB: 7,270 real-world cities mapped to lat/lon/iso3
│   ├── provinces_geo.js / province_polygons.js # Raw GeoJSON arrays for borders & Voronoi mapping
│   ├── geo_fetcher.js                   # Handles Overpass API city/road extraction & local fallbacks
│   ├── geo_filter.js                    # City importance scoring, snapped highways, deduplication
│   ├── geo_renderer.js                  # InstancedMesh rendering for cities (national/provincial/major)
│   └── geo_manager.js                   # Pipeline orchestrator: Fetch -> Filter -> Render
├── src/
│   ├── main.js                          # Core game engine loop, Audio, entity classes, mouse interactions
│   └── data/constants.js                # Game balance config, tech trees, SDEFS, MCFG, PCFG
└── scripts/                             # Offline NodeJS geo-data compilers & parsers
```

---

## 🚀 ENTRY POINT & LIFE CYCLE
1. **HTML Ingestion**: `index.html` loads CDN scripts (`three.min.js`, `OrbitControls.js`, `d3.v7.min.js`) sequentially, then imports `/src/main.js` via ESM `<script type="module">`.
2. **Initial Interaction**: User chooses difficulty/countries and triggers `startVsAI()`.
3. **Audio Setup**: `SFX.init()` starts `AudioContext` on first user interaction to bypass browser auto-play blocks.
4. **3D Context Creation**: `init3D()` sets up WebGLRenderer, Scene, PerspectiveCamera, OrbitControls (damped, locked panning, right-click rotates, scroll zooms), and ambient/directional light.
5. **Globe Mesh**: Earth sphere created (`EARTH_RADIUS = 6371`, Phongs Material, flatShading).
6. **Asset Preload**: Jet meshes (F15, F22, Su27) loaded via OBJ/MTL loaders, auto-scaled to `15.0` scalar, cached in `GLOBAL_MODELS`.
7. **Territory Initialization**: Fetches Natural-Earth GeoJSON, draws country border lines, and spawns static structures (cities, bases, launchers).
8. **Geo-Data Bootstrap**: Calls `GEO_RENDERER.init(scene, camera)` to hook optimized city markers.
9. **Game Frame Loop**: `requestAnimationFrame` loop updating entities, rendering Three.js scene, checking collision sweeps, and drawing particles.

---

## 🌍 SPHERICAL COORDINATE MATH
- **Constants**: `EARTH_RADIUS = 6371`
- **Lat/Lon to 3D Cartesian**:
  $$\phi = (90 - \text{lat}) \times \frac{\pi}{180}, \quad \theta = (\text{lon} + 180) \times \frac{\pi}{180}$$
  $$X = -(\text{r} \times \sin\phi \times \cos\theta), \quad Y = \text{r} \times \cos\phi, \quad Z = \text{r} \times \sin\phi \times \sin\theta$$
  *Javascript Implementation*: `latLonToVec3(lat, lon, r = EARTH_RADIUS)`
- **3D Cartesian to Lat/Lon**:
  *Javascript Implementation*: `vec3ToLatLon(vec)`
- **Precise Great Circle Distance (Haversine)**:
  Uses normalized vector dot-product angle to prevent polar floating anomalies.
  $$\text{dist} = \arccos(\vec{p}_1 \cdot \vec{p}_2) \times \text{EARTH\_RADIUS}$$
  *Javascript Implementation*: `haversineDist(lat1, lon1, lat2, lon2)`
- **Spherical Range Ring Generation**:
  Generates a clean circular line segment path draped flat over the sphere at `EARTH_RADIUS` plus slight offset `1.02` to avoid z-fighting.
  *Javascript Implementation*: `DrawSphericalRangeIndicator(lat, lon, maxRange)`

---

## 🎮 STATE DATA STRUCTURES (src/main.js GLOBALS)
- `structs`: Array of `Structure` class instances (Base, Launcher, SAM, Radar, City, Airport)
- `missiles`: Array of `Missile` class instances (Active rockets and SAM interceptors)
- `planes` / `drones`: Array of active flying jet or drone instances
- `exps` / `particles`: Visual effect meshes with active lifecycle decays (`userData.life -= maxLife`)
- `GLOBAL_MODELS`: Cache for preloaded ThreeJS group objects (F15, F22, Su27)
- `countryOwnership`: ISO3 code string mappings to `'neutral' | 'player' | 'enemy'`
- `selectedCity` / `hoveredCity`: References to interactive geographic city selections

---

## 👾 CORE CLASS DESCRIPTIONS

### 1. `Structure`
Static gameplay objects anchored to specific lat/lon positions.
- **Attributes**: `id`, `lat`, `lon`, `type`, `owner`, `hp`, `maxHp`, `reload`, `maxReload`, `radarRange`, `fireRange`, `pos` (Vector3), `mesh`, `selRing` (selection indicator)
- **Visuals**: Low-poly mesh geometries colored dynamically: Green (`0x00ff88` / Player), Red (`0xff4444` / Enemy), Gray (`0x888888` / Neutral).
- **Life Cycle**:
  - `hit(dmg)`: reduces HP, calls `destroy()` at `HP <= 0`.
  - `destroy()`: Spawns particle explosion, removes mesh from Scene, disposes materials.
  - `update()`: Handles SAM automated reloading/scanning; launches anti-missile sweeps if an enemy missile enters `fireRange`.

### 2. `Missile`
Projectiles traveling along spherical ballistic trajectories.
- **Attributes**: `id`, `cfg`, `owner`, `isSAM` (boolean), `lat`, `lon`, `tlat`, `tlon`, `tgt`, `progress` (0 to 1.0), `speed` (spd * multiplier), `startVec` (Vector3), `targetVec` (Vector3), `dist`, `pos` (Vector3), `mesh`
- **Trajectory Arc calculation**:
  Linear interpolation slerped from `startVec` to `targetVec` relative to `progress`, normalized and scaled dynamically:
  $$\text{height} = \sin(\text{progress} \times \pi) \times \text{maxArc}$$
  - Cruise / Stealth: low trajectory arc (`maxArc = dist * 0.4` or `0.5`).
  - ICBM: extreme high space-flight arc (`maxArc = dist * 1.5`).
  - Hypersonic: flat speed flight (`maxArc = dist * 0.2`).
- **Update Loop**:
  - Increments `progress` by speed.
  - Computes future look-at tangent at `progress + 0.01` to align missile model rotation.
  - Calls `explode()` at `progress >= 1.0`.
  - Spawns particle trail.
- **Explosion & Damage**: Spawns large radial explosion mesh, disposes materials, does distance sweeps on `structs`, and applies area-of-effect damage.

### 3. `Plane`
Maneuverable jets preloaded as high-quality ThreeJS 3D groups.
- **Attributes**: `id`, `lat`, `lon`, `cfg`, `owner`, `hp`, `dead`, `parked` (boolean), `speed`, `tlat`, `tlon`, `mode` (`'patrol' | 'attack' | 'return'`), `baseStruct` (Airport structure reference), `mesh`
- **Movement & Orbit logic**:
  - **Parked**: Orbits above parent Airport (`EARTH_RADIUS + 50.0`) in a continuous circle:
    $$\text{angle} = \text{frame} \times 0.03, \quad \text{orbit\_pos} = \text{base\_pos} + \vec{\text{right}} \times \cos(\text{angle}) \times 3 + \vec{\text{up}} \times \sin(\text{angle}) \times 3$$
  - **Flying**: Interpolates position vector slerped toward target vector at slerpSpeed (`speed / distance`), aligned along look-at vectors.
- **Attack Cycle**: If within threshold distance of target, launches Cruise Missile payload and switches mode to `'return'` to refuel at parent Airport.

---

## 🗺️ VORONOI TERRITORY CANVAS OVERLAY
- ** Voronoi Cells**: D3 Voronoi maps generated from city nodes.
- **Canvas Painting**: A dynamic canvas (`territoryCanvas`) painted with colored SVG paths relative to province ownership:
  - Neutral: `rgba(80,100,110,0.15)`
  - Player: `rgba(0,255,136,0.25)`
  - Enemy: `rgba(255,60,60,0.25)`
- **Globe Mapping**: Canvas is loaded into a `THREE.CanvasTexture` applied as a transparent overlay mesh wrapping the 3D Globe, dynamically redrawn when city/province control changes.

---

## ⚡ OPTIMIZED GEO-DATA SUBSYSTEM (`/public/data/`)
To achieve peak rendering framerates (60+ FPS), the geo system isolates raw coordinates and processes them via instanced operations:
1. **`GEO_RENDERER.js`**: Initializes three distinct `THREE.InstancedMesh` instances (one for each city tier: Tier 1 National Capital, Tier 2 Provincial Capital, Tier 3 Major City).
   - Reduces draw calls from over 1,000 to **exactly 3**.
   - Spawns city markers as spheres using matrix transformations:
     ```javascript
     _dummyMat4.makeTranslation(pos.x, pos.y, pos.z);
     instancedMesh.setMatrixAt(index, _dummyMat4);
     instancedMesh.setColorAt(index, _dummyColor);
     ```
2. **Raycasting / Interaction**: Instead of checking individual meshes, `GEO_RENDERER.getCityAtScreenPos(raycaster, mouse)` casts a ray onto the active `InstancedMesh` layers and resolves the index of the clicked city instantly.
3. **Deduplication (`geo_filter.js`)**: Runs a Haversine proximity scan on cities (sweeping a radius of 15km to 50km depending on tier) to filter clustered datasets, saving 80% of system memory.
4. **Highway Snap Snapping**: Roads/Highways are compiled as `THREE.LineSegments` of yellow arcs flat-mapped to snap directly onto rendering city Cartesian nodes.

---

## 🔑 AI CODING RULES & SAFETY PROTOCOLS
1. **Non-Destructive Integration**: Never modify standard ThreeJS loading steps or break ESM import mappings in `index.html`.
2. **Coordinate Preservation**: Ensure all math modifications preserve `EARTH_RADIUS = 6371` scaling. Linear distances must utilize `haversineDist`.
3. **No Thread Blocks**: Do not parse the 7,270 city database (`world_cities_generated.js`) synchronously in updates. Use filtered regional subsets (`GeoDataManager.loadRegion`).
4. **Mesh Disposal**: Always clean up geometry, textures, and materials (`dispose()`) when entities die to avoid massive browser tab memory leaks.
