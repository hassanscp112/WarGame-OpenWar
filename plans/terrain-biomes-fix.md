# Plan: Color-Quantized Flat Map (OpenFront-style)

## User's exact request
Take the real Earth image, **scan each pixel's color**, convert it to a **flat solid color**
from a small palette (reduce color variation), so the map looks clean like OpenFront —
flat solid colors but with REAL biome shapes (Sahara=tan, Amazon=green, Greenland=white).

## Why previous attempts failed
- Attempt 1 (latitude biomes + NearestFilter): giant squared latitude bands → "biomes are squared"
- Attempt 2 (raw photo + LinearFilter): blurry low-res photo → "used the old way, worse resolution"

## The fix — COLOR QUANTIZATION (the missing piece)
The entire pipeline is already in place from the last edit:
- `setLandCoverImage()` rasterizes the photo → `landBase`
- `paintCell()` uses `landBase` as base + green/red territory fill
- Globe uses `LinearFilter` (smooth)

**Only `setLandCoverImage()` needs to change**: instead of storing the RAW photo color per
cell, classify each pixel into a FLAT palette color. This converts the photo into a clean
flat-color map with real biome shapes.

### Quantization palette (flat solid colors)
```
DEEP_WATER [28, 58, 110]   // dark ocean
WATER      [48, 98, 158]   // ocean blue
DESERT     [205, 185, 130] // sandy tan (Sahara, Arabia, Australia)
PLAINS     [108, 158, 88]  // grass green (vegetation)
FOREST     [78, 128, 68]   // dark green (boreal/tropical)
MOUNTAIN   [128, 108, 88]  // brown (ranges/barren)
SNOW       [232, 236, 240] // white (ice/tundra)
```

### Classification logic (per pixel r,g,b)
```
lum = 0.299r + 0.587g + 0.114b
sat = (max-min)/max  (0 if max==0)

1. WATER:  blue dominant (b >= r && b >= g) → DEEP_WATER if dark else WATER
2. SNOW:   lum > 205 && sat < 0.30
3. DESERT: lum > 150 && r >= g && sat < 0.45  (bright warm tan)
4. MOUNTAIN: lum < 105 && r >= g && g >= b    (dark warm brown)
5. FOREST: g > r && g > b && lum < 120        (dark green)
6. PLAINS: default vegetation green
```

### Source image
NASA Blue Marble equirectangular (already wired in `loadLandCoverForConquest`).
Equirectangular = maps directly onto the sphere. (OpenFront's world PNG projection is
uncertain, so Blue Marble is the safe choice.)

## Implementation — ONE function rewrite
Rewrite [`setLandCoverImage()`](src/core/conquest.js) to quantize each pixel to a flat
palette color instead of storing raw RGB. Everything else stays. Thresholds tunable after
first visual check.

## Result
Clean flat OpenFront-style map: solid green/tan/brown/white/blue regions following real
biome shapes, with green/red FILLED territory on top. No blocky cells, no blurry photo.
