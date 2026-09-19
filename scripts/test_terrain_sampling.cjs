// Quick sanity test: replicate ConquestGrid.loadTerrainFromBin + buildLandMaskFromTerrain
// against public/data/openfront_terrain_corrected.bin and probe known land/water points.
const { readFileSync } = require('node:fs');

const OF_W = 4108, OF_H = 1948;
const GRID_W = 7200, GRID_H = 3600, CELL_DEG = 0.05;

const buf = readFileSync('public/data/openfront_terrain_corrected.bin');
console.log('binary bytes:', buf.length, 'expected:', OF_W * OF_H);
if (buf.length < OF_W * OF_H) { console.error('TOO SMALL'); process.exit(1); }

// Count land bytes in the raw binary (bit7)
let rawLand = 0;
for (let i = 0; i < OF_W * OF_H; i++) if ((buf[i] & 0x80) !== 0) rawLand++;
console.log('raw land cells in binary:', rawLand, '(' + (100 * rawLand / (OF_W * OF_H)).toFixed(1) + '%)');

// Replicate loadTerrainFromBin: sample binary into a 7200x3600 terrainByte grid.
const N = GRID_W * GRID_H;
const terrainByte = new Uint8Array(N);
const sx = OF_W / GRID_W, sy = OF_H / GRID_H;
for (let row = 0; row < GRID_H; row++) {
  const srcRow = Math.min(OF_H - 1, ((row + 0.5) * sy) | 0);
  const srcRowBase = srcRow * OF_W;
  const rowBase = row * GRID_W;
  for (let col = 0; col < GRID_W; col++) {
    const srcCol = ((col + 0.5) * sx) | 0;
    terrainByte[rowBase + col] = buf[srcRowBase + srcCol];
  }
}

// latLonToCell
const latLonToCell = (lat, lon) => {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  const col = Math.min(GRID_W - 1, Math.max(0, Math.floor((l + 180) / CELL_DEG)));
  const la = Math.min(90, Math.max(-90, lat));
  const row = Math.min(GRID_H - 1, Math.max(0, Math.floor((90 - la) / CELL_DEG)));
  return row * GRID_W + col;
};

const isLand = (lat, lon) => (terrainByte[latLonToCell(lat, lon)] & 0x80) !== 0;

// Probes: [lat, lon, expectedLand]
const probes = [
  [40, -100, true,  'USA Great Plains'],
  [39, 116,  true,  'Beijing China'],
  [35, 105,  true,  'China interior'],
  [48, 2,    true,  'Paris France'],
  [55, 37,   true,  'Moscow Russia'],
  [28, 77,   true,  'New Delhi India'],
  [-23, -46, true,  'Sao Paulo Brazil'],
  [-33, 151, true,  'Sydney Australia'],
  [30, 31,   true,  'Cairo Egypt / Nile'],
  [24, 46,   true,  'Riyadh Saudi Arabia'],
  [0, -30,   false, 'mid-Atlantic Ocean'],
  [0, -150,  false, 'central Pacific'],
  [-20, 80,  false, 'Indian Ocean'],
  [60, -30,  false, 'North Atlantic'],
  [15, -40,  false, 'North Atlantic subtropical'],
  [50, -20,  false, 'Atlantic near Iceland'],
];

let pass = 0, fail = 0;
for (const [lat, lon, exp, name] of probes) {
  const got = isLand(lat, lon);
  const ok = got === exp;
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${lat},${lon}) land=${got} expect=${exp}  ${name}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${probes.length} probes passed, ${fail} failed`);

// Overall land fraction in sampled grid
let landCells = 0;
for (let i = 0; i < N; i++) if ((terrainByte[i] & 0x80) !== 0) landCells++;
console.log('sampled grid land cells:', landCells, '(' + (100 * landCells / N).toFixed(1) + '% of globe)');
