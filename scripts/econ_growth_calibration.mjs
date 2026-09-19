// TASK-301 live-curve calibration — replays the game's EXACT growth recurrences
// so the balance sim's troopsK/cellsK assumptions match reality:
//   • troopIncreaseRate: T += (10 + T^0.73/4) * (1 - T/max)  every 0.1s (frame%6 @60fps)
//   • calcMaxTroops (mode1): 2*(cells^0.6*1000 + 50000) + cities*25000
//   • conquest rate (measured live, TASK-102 diary): 1k troops→7 cells/s, 100k→120 cells/s
//     → cells/s ≈ 7 * (T/1000)^0.193 (fit through both points), capped by land adjacency.
// Run: node scripts/econ_growth_calibration.mjs
import { GAME_CONSTANTS as C } from '../src/data/constants.js';

// ── exact game recurrences ──
function maxTroops(cells, cities) {
    return 2 * (Math.pow(Math.max(1, cells), 0.6) * 1000 + 50000) + cities * C.CITY_TROOP_INCREASE;
}
function troopStep(T, max) {          // per 0.1s tick
    if (T >= max) return 0;
    let toAdd = 10 + Math.pow(T, 0.73) / 4;
    toAdd *= (1 - T / max);
    return toAdd;
}
const conquestRate = T => 7 * Math.pow(T / 1000, 0.193);   // cells/sec, live-fit

// simulate 15 minutes of "neutral game" growth (player attacks neutral land only)
let T = C.STARTING_TROOPS;
let cells = 900;        // seedCircle(110km) ≈ ~900 cells (π*110²/~42km² per cell)
let cities = 0;
const CITY_SCHEDULE = { 120: 1, 420: 2 };    // city built at 2min, 2nd at 7min
const marks = [];
for (let t = 0; t <= 900; t++) {
    if (CITY_SCHEDULE[t] !== undefined) cities = CITY_SCHEDULE[t];
    // troops: 10 ticks/s
    for (let k = 0; k < 10; k++) T += troopStep(T, maxTroops(cells, cities));
    // conquest: troops committed ~50% → effective rate at half the standing army,
    // and expansion slows as you run out of adjacent neutral land (decay factor)
    const expandCap = Math.max(0, 1 - cells / 9000);        // soft land ceiling
    cells += conquestRate(T * 0.5) * expandCap;
    if (t === 0 || t % 120 === 0) marks.push({ t_min: t / 60, troops: Math.round(T), cells: Math.round(cells) });
}
console.table(marks);

// derive the linear troopsK / cellsK that best match the real curve (for _econSimulateNeutral)
const t10 = marks.find(m => m.t_min === 10), t0 = marks[0];
const troopsK = (t10.troops - t0.troops) / 600;
const mid = marks.find(m => m.t_min === 5) || t10;
const cellsK = mid.cells / (5 * 60);
console.log(`Suggested sim params → troopsK: ${troopsK.toFixed(0)}/s (army@10min=${(t10.troops / 1000).toFixed(0)}k), cellsK: ${cellsK.toFixed(1)}/s`);

// upkeep impact at those army sizes with candidate UPKEEP_PER_K values
for (const perK of [0.02, 0.04, 0.06]) {
    const up5 = Math.max(0, mid.troops - C.WAR_UPKEEP_FREE_TROOPS) / 1000 * perK;
    const up10 = Math.max(0, t10.troops - C.WAR_UPKEEP_FREE_TROOPS) / 1000 * perK;
    console.log(`UPKEEP_PER_K=${perK}: upkeep@5min=${up5.toFixed(2)}/s @10min=${up10.toFixed(2)}/s`);
}
