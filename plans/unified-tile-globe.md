# Plan: UNIFIED Tile-Painted Globe (one land/water system)

## The Problem (user-identified, correct)
Right now there are **TWO separate, un-synchronized systems**:

| | Visual globe (what you SEE) | Conquest system (what you can CONQUER) |
|---|---|---|
| **Data source** | OpenFront `openfront_terrain.png` (a static image) | GeoJSON country polygons |
| **Render method** | Texture stretched on sphere (4108×1948) | Canvas painted tile-by-tile (7200×3600) |
| **Crisp at max zoom?** | ❌ NO — texture blurs when magnified | ✅ YES — high-res canvas + NearestFilter |
| **Has rivers?** | ✅ yes (in the image) | ❌ no (GeoJSON has no rivers) |
| **Projection** | OpenFront's ~2.11:1 (OFFSET) | correct lat/lon |

→ They don't align. The visible coastline is offset from the conquerable land. Rivers exist visually but not in gameplay.

## The Solution: ONE grid, ONE canvas, painted tile-by-tile
Make the **land/biome layer** use the SAME method as the conquest overlay — paint it tile-by-tile on a high-res canvas from ONE authoritative grid. Delete the static texture entirely.

```
OpenFront map.bin (4108×1948)
  │ reproject to correct equirectangular (calibrate vs GeoJSON)
  ▼
ConquestGrid 7200×3600  ← SINGLE SOURCE OF TRUTH
  ├── terrain[cell]  : land/water/elevation/shoreline  (visual + gameplay)
  ├── owner[cell]    : neutral / player / enemy / water (gameplay)
  │
  ├── BIOME canvas (7200×3600) — painted ONCE from terrain[]
  │     water → blue depth gradient
  │     land  → green/tan/gray from elevation
  │     → becomes the globe sphere texture (replaces the photo/PNG)
  │
  └── TERRITORY canvas (7200×3600) — painted per-tick from owner[]  (unchanged)
        player → green, enemy → red, else transparent
        → transparent overlay sphere above the globe
```

### Why this fixes everything
- **Crisp at max zoom** — biome is now on a 7200×3600 canvas (same as the already-crisp territory overlay), not a 4108 texture. NearestFilter → hard edges.
- **Perfectly synced** — both canvases read from the same `terrain[]`/`owner[]`. Change water once → updates everywhere.
- **Rivers in gameplay** — OpenFront water cells (rivers/lakes) become non-conquerable WATER in `owner[]`, acting as natural barriers.
- **No offset** — one projection, one grid.

## Implementation Steps

### Step 1 — Reproject OpenFront map.bin to correct equirectangular
The giantworldmap is ~2.11:1 (not 2:1), causing the offset. Fix:
- Build script rasterizes GeoJSON land at 4108×1948 (correct equirectangular) as a **reference**.
- Empirically find the affine transform (scale + offset) that best aligns OpenFront's land/water to the reference (grid-search / least-squares on land overlap).
- Reproject: for each correct-equirectangular (lat,lon), sample OpenFront (x,y) via the transform → produce a corrected binary.
- Output: `public/data/openfront_terrain_corrected.bin` (4108×1948, correct projection).

### Step 2 — Load corrected terrain into the grid (`conquest.js`)
- Add `this.terrain = new Uint8Array(W*H)` to ConquestGrid (stores the OpenFront byte per cell).
- New method `loadTerrainFromBin(uint8, srcW, srcH)`: for each grid cell (col,row) → lat/lon → sample corrected bin → store byte.
- New method `buildLandMaskFromTerrain()`: `owner[cell] = (terrain land?) ? NEUTRAL : WATER`. Replaces the GeoJSON rasterization in `initConquestGrid()`.
- This makes terrain[] the single source: visual colors + gameplay land/water.

### Step 3 — Paint biome canvas from terrain[] (`conquest.js`)
- Add `this.biomeCanvas` (7200×3600) + `biomeImage`.
- New method `paintBiomeBase()`: for each cell, decode terrain byte → color (encodeTerrainTile algorithm). Paint ONCE at init.
- Water → blue (depth gradient), land → green/tan/gray (elevation), shore → sand.

### Step 4 — Wire biome canvas as the globe texture (`main.js`)
- `renderMode1Territory()`: set `earthMesh.material.map = new CanvasTexture(biomeCanvas)` (NearestFilter mag + NearestMipmapNearestFilter min).
- Remove `loadBiomeGlobeTexture()` / `LAND_COVER_URLS` / the PNG — no longer needed.
- Globe sphere is now painted tile-by-tile, same resolution as the territory overlay.
- Territory overlay sphere stays transparent above it (unchanged).

### Step 5 — initConquestGrid uses terrain mask
- Fetch `openfront_terrain_corrected.bin` → `conquestGrid.loadTerrainFromBin()` → `buildLandMaskFromTerrain()`.
- Remove/keep GeoJSON only as the projection-calibration reference (Step 1).

### Step 6 — Test
- Continents align with city/conquest positions (no offset).
- Rivers/lakes are crisp blue + non-conquerable.
- Max zoom: biome as crisp as territory overlay.
- Territory fills + vector borders align with coastline.

## Risk / Notes
- **Projection calibration** (Step 1) is the hard part — must be solved empirically. If it proves too difficult, fallback: keep GeoJSON mask for gameplay, use OpenFront only for biome canvas colors (rivers visual-only, not gameplay barriers).
- **Memory**: biome canvas 7200×3600 RGBA ≈ 104 MB (same as territory canvas — already works).
- **Load time**: decoding 8 MB bin + painting 26 M cells once at init (~100-300 ms).
