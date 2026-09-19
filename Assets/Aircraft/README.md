# Aircraft Models (TASK-201)

Drop one **GLB per aircraft** here — named exactly as below. The game loads
them automatically at startup (`loadAircraftModels()` in `src/main.js`);
until a file exists that aircraft flies on the fallback OBJ jet or the
low-poly proxy, so the system works before any art exists.

## Authoring rules (Blender)

- Export **GLB**, -Z forward, +Y up (Blender default).
- Model in **real-world meters** — the loader measures the largest horizontal
  extent (wingspan) and normalizes it against the span table below, so scale
  inside the file doesn't matter, proportions do.
- Keep it low-poly (game runs 100+ aircraft). Flat-shaded board-game style
  matches the rest of the fleet.
- No animations needed; orientation is applied by the game.

## File names → aircraft

| File | Aircraft | Real wingspan |
|------|----------|---------------|
| `heli.glb` | AH-64 Apache | 14.6 m |
| `fighter.glb` | F-16 Falcon | 10.0 m |
| `bomber.glb` | Su-24 Fencer | 17.6 m |
| `interceptor.glb` | MiG-29 Fulcrum | 11.4 m |
| `a10.glb` | A-10 Warthog | 17.5 m |
| `gunship.glb` | AC-130 Spectre | 40.4 m |
| `awacs.glb` | E-3 Sentry | 44.4 m |
| `su57.glb` | Su-57 Felon | 14.0 m |
| `stealth.glb` | B-2 Spirit | 52.4 m |
| `f22.glb` | F-22 Raptor | 13.6 m |

Reload the page after adding a file — the console prints
`[AIR] model ready: <key>` for each one that loads. Verify the whole chain
from the browser console: `__ffaProbe.airModelsCheck()`.
