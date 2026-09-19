// TASK-301 standalone balance pre-check — mirrors _econSimulateNeutral()
// math 1:1 (same constants, same schedule) so we can tune before browser test.
// Run: node scripts/econ_sim_check.mjs
import { GAME_CONSTANTS as C } from '../src/data/constants.js';

function econRatesFromSnapshot(snap) {
    const base = (snap.base || 0) * C.INCOME_BASE * 60;
    let factories = 0;
    (snap.factoryLinks || []).forEach(links => {
        factories += C.INCOME_FACTORY * 60 * (1 + Math.min(3, links) * C.SYNERGY_FACTORY_CITY);
    });
    const nuke = (snap.nukePlants || 0) * C.INCOME_NUKE_PLANT * 60;
    const airports = (snap.airports || 0) * C.INCOME_AIRPORT * 60;
    const territory = (snap.cells || 0) * C.TERRITORY_INCOME_PER_CELL;
    const cities = snap.cityIncome || 0;
    const synergy = (snap.portCityLinks || 0) * C.SYNERGY_PORT_CITY_INCOME;
    const subtotal = base + factories + nuke + airports + territory + cities + synergy;
    const factoryMul = 1 + (snap.factoryLinks ? snap.factoryLinks.length : 0) * C.FACTORY_MULTIPLIER;
    const milestoneMul = snap.milestoneMul || 1;
    const income = subtotal * factoryMul * milestoneMul;
    const buildings = (snap.upkeepBuildings || 0) * C.UPKEEP_BUILDING * 60;
    const planes = (snap.planes || 0) * C.UPKEEP_PLANE * 60;
    const armyExcess = Math.max(0, (snap.troops || 0) - C.WAR_UPKEEP_FREE_TROOPS);
    const army = armyExcess / 1000 * C.WAR_UPKEEP_PER_K;
    const upkeep = buildings + planes + army;
    return { income, upkeep, net: income - upkeep,
        parts: { base, factories, nuke, airports, territory, cities, synergy, factoryMul, milestoneMul, buildings, planes, army, armyExcess } };
}

const maxTroopsAt = (cells, cities) =>
    2 * (Math.pow(Math.max(1, cells), 0.6) * 1000 + 50000) + cities * C.CITY_TROOP_INCREASE;

function simulate(o) {
    o = Object.assign({ startGold: C.STARTING_RES_OFFLINE, spendFraction: 0.35,
        cellsK: 22, landCap: 9000, horizonSec: 900 }, o || {});
    const lumps = [
        [30, 180], [60, 300], [120, 500], [180, 400], [240, 450], [300, 600],
        [360, 400], [420, 750], [480, 450], [540, 900], [600, 800], [660, 600],
        [720, 570], [780, 350], [840, 750], [900, 1125],
    ];
    const citiesAt = t => (t >= 120 ? 1 : 0) + (t >= 420 ? 1 : 0);
    const factoriesAt = t => (t >= 300 ? 1 : 0) + (t >= 540 ? 1 : 0);
    const portsAt = t => (t >= 180 ? 1 : 0) + (t >= 660 ? 1 : 0);
    const planesAt = t => 2 + (t >= 480 ? 1 : 0);
    const upkBAt = t => 1 + citiesAt(t) + portsAt(t) + (t >= 240 ? 1 : 0);
    let gold = o.startGold, incomeMul = 1, t3000 = null, tNuke = null;
    const reached = new Set(), marks = [];
    const cellsAtT = t => o.landCap - (o.landCap - 900) * Math.exp(-o.cellsK * t / o.landCap);
    for (let t = 0; t <= o.horizonSec; t++) {
        const cells = cellsAtT(t);
        const troops = maxTroopsAt(cells, citiesAt(t));
        const nCities = citiesAt(t), nFact = factoriesAt(t);
        const factoryLinks = [];
        for (let i = 0; i < nFact; i++) factoryLinks.push(Math.min(3, nCities));
        const r = econRatesFromSnapshot({
            base: 1, nukePlants: 0, airports: 1, factoryLinks, cells, cityIncome: 0,
            portCityLinks: portsAt(t) * nCities, milestoneMul: incomeMul,
            planes: planesAt(t), upkeepBuildings: upkBAt(t), troops,
        });
        let trade = 2.5 * portsAt(t) * (t >= 360 ? 0.85 : 1);
        for (const m of C.ECON_MILESTONES) {
            if (reached.has(m.id)) continue;
            if ((m.cells && cells >= m.cells) || (m.troops && troops >= m.troops)) {
                reached.add(m.id);
                if (m.rewardGold) gold += m.rewardGold;
                if (m.incomeMul) incomeMul *= m.incomeMul;
            }
        }
        const grossNet = r.net + trade;
        gold += grossNet * (1 - o.spendFraction);
        while (lumps.length && lumps[0][0] <= t) gold -= lumps.shift()[1];
        if (gold < 0) gold = 0;
        if (t3000 === null && gold >= 3000) t3000 = t;
        if (tNuke === null && gold >= 4000) tNuke = t;
        if (t === 0 || t === 120 || t === 300 || t === 600 || t === 900) marks.push({ t_min: t / 60, net: +grossNet.toFixed(1), gold: Math.round(gold), army: Math.round(troops / 1000) + 'k' });
    }
    return { t3000, tNuke, marks, milestones: [...reached] };
}

const fm = s => s == null ? 'never' : (s / 60).toFixed(1) + 'min';
console.log('Constants: UPKEEP_PER_K=' + C.WAR_UPKEEP_PER_K + ' FREE=' + C.WAR_UPKEEP_FREE_TROOPS);
const base = simulate();
console.log('DEFAULT   → t3000 @ ' + fm(base.t3000) + ' · tNuke(4000) @ ' + fm(base.tNuke));
console.table(base.marks);
console.log('milestones hit:', base.milestones.join(','));

// sensitivity: spending rate
for (const sf of [0.25, 0.35, 0.45, 0.55]) {
    const r = simulate({ spendFraction: sf });
    console.log(`spendFraction=${sf} → t3000 ${fm(r.t3000)} · tNuke ${fm(r.tNuke)}`);
}
// sensitivity: expansion speed
for (const ck of [10, 22, 35]) {
    const r = simulate({ cellsK: ck });
    console.log(`cellsK=${ck}/s → tNuke ${fm(r.tNuke)}`);
}
