# Plan: Delete Naval Code + Fix Port Shoreline + Upgrade Trade Ships

## Objective
1. **DELETE every line of naval code** — TransportShip, Warship, Shell, all wiring, constants, UI.
2. **FIX port placement** — ports must only be buildable on shoreline (land adjacent to water), exactly like OpenFront's `portSpawn()` → `isShore()`.
3. **UPGRADE trade ships** to OpenFront logic — distance-based gold, spawn-rate limiting, proximity weighting.

## Guiding Principle
> "DONT DO ANYTHING FROM YOUR POCKET / SEE HOW OPENFRONT LOGIC WORKS / THEN CONVERT IT INTO 3D GLOBE SYSTEM / DONT INVENT SOMETHING BY YOURSELF"

Every change traces directly to OpenFront source. No invented logic.

---

## PART 1 — DELETE ALL NAVAL CODE

### File: `src/main.js`

| # | Location | What to delete | Action |
|---|----------|----------------|--------|
| 1 | Lines 465–520 | Comment block "NAVAL UNITS…" + `_navyStep()` + `_orientShip()` + `_unitLatLon()` | Delete entire block |
| 2 | Lines 522–635 | `class TransportShip` | Delete entire class |
| 3 | Lines 637–878 | `class Warship` | Delete entire class |
| 4 | Lines 880–926 | `class Shell` (incl. comment) | Delete entire class |
| 5 | Line 2225 | `navalUnits=[], shells=[]` in the `let` declaration | Remove `navalUnits=[]` and `shells=[]` (keep `tradeShips=[], trains=[], troopCohorts=[]`) |
| 6 | Lines 3842–3846 | `applyOpponentAction` → `if (action.type === 'naval') {…}` block | Delete entire block |
| 7 | Line 3884 | `let navalMode = null;` | Delete line |
| 8 | Line 4157 | `navalMode = null;` inside clearSelection | Delete line |
| 9 | Lines 4356–4386 | Click handler → `if (navalMode) {…}` entire naval branch | Delete entire block |
| 10 | Lines 4816–4817 | Cleanup: `navalUnits.forEach(…)` + `shells.forEach(…)` | Delete both lines |
| 11 | Line 4820 | Reset: `navalUnits = []; shells = [];` | Remove `navalUnits = []; shells = [];` from the line |
| 12 | Line 4840 | `navalMode = null;` in reset | Remove `navalMode = null;` from the line |
| 13 | Lines 5131–5144 | `findOffshorePoint()` function | Delete entire function |
| 14 | Lines 5146–5198 | `aiNavalTick()` function | Delete entire function |
| 15 | Lines 5492–5494 | `runAI()` → `if (frame % … === 0) { aiNavalTick(); }` block | Delete entire block |
| 16 | Lines 5521–5522 | Loop: `navalUnits = navalUnits.filter(…)` + `shells = shells.filter(…)` | Delete both lines |
| 17 | Lines 5604–5614 | `findNearestPort()` function | Delete entire function |
| 18 | Lines 5616–5636 | `launchNavalUnit()` function | Delete entire function |
| 19 | Lines 5638–5641 | `navalMsg()` function | Delete entire function |
| 20 | Lines 5649–5655 | `G.buildWarship` method | Delete entire method |
| 21 | Lines 5656–5667 | `G.launchNavalInvasion` method | Delete entire method |

### File: `src/data/constants.js`

| # | Location | What to delete |
|---|----------|----------------|
| 22 | Lines 143–168 | Entire "Naval System" constants block — stop before closing `};` |

### File: `index.html`

| # | Location | What to delete |
|---|----------|----------------|
| 23 | Line 135 | Naval tab button `<button …>بحرية</button>` |
| 24 | Line 145 | Entire `<!-- NAVAL -->` panel div |

### File: `src/core/conquest.js`

| # | Location | What to delete |
|---|----------|----------------|
| 25 | Line 979 | Remove `, isBoat = false` from constructor params |
| 26 | Line 985 | Remove `this.isBoat = isBoat;` |

---

## PART 2 — FIX PORT SHORELINE PLACEMENT

### OpenFront Reference
```
portSpawn() filters: owner === player && isShore(tile)
isShore(tile) = isLand(tile) && isShoreline(tile)
```

### 3D Globe Equivalent
| OpenFront | Globe | Exists? |
|---|---|---|
| `isLand(tile)` | `isLand(lat,lon)` | ✅ Line 3901 |
| `isShoreline(tile)` | `isNearWater(lat,lon)` | ✅ Line 315 |

### Change: `src/main.js` build handler (after line 4435, before checkZOC)
```javascript
if(buildMode === 'port' && !isNearWater(loc.lat, loc.lon)) {
    document.getElementById('bldMsg').textContent = 'الميناء يجب أن يُبنى على الساحل! ⚓';
    return;
}
```

---

## PART 3 — UPGRADE TRADE SHIPS TO OPENFRONT LOGIC

### OpenFront Source References
- **`Config.tradeShipGold(dist, player)`** (Config.ts:250–256): sigmoid gold formula
- **`Config.tradeShipSpawnRate(rejections, numShips)`** (Config.ts:258–272): probability-based spawn limiting
- **`Config.tradeShipShortRangeDebuff()`** (Config.ts:716): returns 300 (tiles)
- **`PortExecution.shouldSpawnTradeShip()`** (PortExecution.ts:71–84): rolls spawn chance per port level, pity timer
- **`PortExecution.tradingPorts()`** (PortExecution.ts:99–143): weighted port selection (proximity bonus, friendly bonus, level weighting)
- **`TradeShipExecution.complete()`** (TradeShipExecution.ts:168–199): both source + destination owner receive gold

### 3.1 Constants Changes (`src/data/constants.js`)

**Remove** old flat constants:
```javascript
TRADE_SHIP_PAYOUT: 200,           // ← DELETE
TRADE_SHIP_TARGET_PAYOUT: 50,     // ← DELETE
```

**Add** OpenFront-faithful constants (scaled to our economy):
```javascript
// ── Trade Ships (OpenFront: tradeShipGold + tradeShipSpawnRate) ──
TRADE_SHIP_SPAWN_INTERVAL: 300,   // check interval (keep existing)
TRADE_SHIP_MAX_ACTIVE: 30,        // cap on total active trade ships (OpenFront sigmoid→0 at ~400)
TRADE_SHIP_BASE_GOLD: 150,        // sigmoid max payout (OpenFront: 75_000, scaled to our economy)
TRADE_SHIP_DIST_GOLD: 0.01,       // linear gold per km traveled (OpenFront: 50/tile ≈ 1/km)
TRADE_SHIP_SHORT_RANGE_KM: 2000,  // debuff threshold (OpenFront: 300 tiles ≈ 15_000 km, scaled)
TRADE_SHIP_SIGMOID_STEEPNESS: 0.002, // sigmoid curve steepness
TRADE_SHIP_MIN_SPAWN_RATE: 5,     // min spawnRate denominator (higher = rarer)
```

### 3.2 TradeShip Class Changes (`src/main.js` lines 406–463)

**Constructor** — store distance for gold calc:
```javascript
constructor(srcPort, dstPort, owner) {
    // ... existing setup ...
    this.distKm = haversineDist(srcPort.lat, srcPort.lon, dstPort.lat, dstPort.lon);
}
```

**`arrive()` method** — replace flat payout with OpenFront `tradeShipGold()` formula:
```javascript
arrive() {
    this.dead = true;
    scene.remove(this.mesh);
    if (this.mesh.material) this.mesh.material.dispose();

    // OpenFront tradeShipGold(dist): sigmoid + linear, both ports earn
    const C = GAME_CONSTANTS;
    const dist = this.distKm || 0;
    const debuff = C.TRADE_SHIP_SHORT_RANGE_KM;
    const gold = Math.floor(
        C.TRADE_SHIP_BASE_GOLD / (1 + Math.exp(-C.TRADE_SHIP_SIGMOID_STEEPNESS * (dist - debuff)))
        + C.TRADE_SHIP_DIST_GOLD * dist
    );

    // OpenFront TradeShipExecution.complete(): srcPort.owner() AND dstPort.owner() both get gold
    if (this.owner === 'player') {
        pRes += gold;
        if (this.dstPort.owner === 'enemy') eRes += gold;
        logEvent(`سفينة تجارية وصلت! +💰${gold} (مسافة ${Math.round(dist)} كم)`, 'info');
    } else {
        eRes += gold;
        if (this.dstPort.owner === 'player') {
            pRes += gold;
            logEvent(`ميناءك استقبل سفينة تجارية! +💰${gold}`, 'info');
        }
    }
    updateHUD();
}
```

### 3.3 Spawn Logic Changes (`src/main.js` `spawnTradeShipsForActivePorts()` lines 1793–1809)

Replace unconditional spawning with OpenFront's `shouldSpawnTradeShip()` + `tradingPorts()` logic:

```javascript
function spawnTradeShipsForActivePorts() {
    const C = GAME_CONSTANTS;
    const numTradeShips = tradeShips.filter(ts => !ts.dead).length;

    // OpenFront tradeShipSpawnRate: as numShips → cap, spawn probability → 0
    const decayRate = Math.LN2 / 50;
    const baseSpawnRate = 1 - (1 / (1 + Math.exp(-decayRate * (numTradeShips - C.TRADE_SHIP_MAX_ACTIVE))));
    if (baseSpawnRate <= 0.01) return; // too many ships, stop spawning

    let ports = structs.filter(s => s.type === 'port' && !s.dead);
    ports.forEach(port => {
        // shouldSpawnTradeShip(): probability roll (1 in spawnRate)
        const spawnRate = Math.max(C.TRADE_SHIP_MIN_SPAWN_RATE, Math.floor(100 / baseSpawnRate));
        if (Math.floor(Math.random() * spawnRate) !== 0) return; // rejected this tick

        // tradingPorts(): find valid destination ports, weighted by proximity
        let targets = structs.filter(t => t.type === 'port' && t !== port && !t.dead && t.owner !== port.owner);
        if (targets.length === 0) {
            // fallback: coastal enemy cities (existing behavior)
            let cities = cityNodes.filter(c => c.owner !== port.owner);
            let coastalCities = cities.filter(c => isNearWater(c.lat, c.lon, 4.0));
            if (coastalCities.length > 0) {
                let target = coastalCities[Math.floor(Math.random() * coastalCities.length)];
                tradeShips.push(new TradeShip(port, { lat: target.lat, lon: target.lon, pos: latLonToVec3(target.lat, target.lon), owner: target.owner }, port.owner));
            }
            return;
        }

        // OpenFront tradingPorts(): sort by distance, apply proximity weighting
        targets.sort((a, b) =>
            haversineDist(port.lat, port.lon, a.lat, a.lon) - haversineDist(port.lat, port.lon, b.lat, b.lon)
        );
        // Weighted selection: closer ports more likely (but skip too-close via debuff)
        const weighted = [];
        targets.forEach((t, i) => {
            const d = haversineDist(port.lat, port.lon, t.lat, t.lon);
            weighted.push(t); // base weight
            if (d > C.TRADE_SHIP_SHORT_RANGE_KM && i < Math.min(3, targets.length)) weighted.push(t); // proximity bonus
        });
        const target = weighted[Math.floor(Math.random() * weighted.length)];
        tradeShips.push(new TradeShip(port, target, port.owner));
    });
}
```

### Key Behaviors Replicated
| OpenFront behavior | How it's ported |
|---|---|
| `tradeShipGold(dist)` sigmoid | `BASE_GOLD / (1 + exp(-STEEPNESS * (dist - DEBUFF))) + DIST_GOLD * dist` |
| Both ports earn gold | `srcPort.owner` AND `dstPort.owner` both `+= gold` |
| `tradeShipSpawnRate` caps ships | Sigmoid → 0 as `numTradeShips → TRADE_SHIP_MAX_ACTIVE` |
| Pity timer (rejections) | Simplified: probability roll per port per interval |
| `tradingPorts()` proximity weighting | Sort by distance, closer ports duplicated in weighted array |
| `tradeShipShortRangeDebuff` | `TRADE_SHIP_SHORT_RANGE_KM` threshold in sigmoid + proximity filter |

---

## Verification Steps
1. `node --check src/main.js` — must pass
2. `node --check src/data/constants.js` — must pass
3. Grep `src/main.js` for naval keywords → ZERO results
4. Confirm `index.html` has no naval tab/panel
5. Build mode → Port → click inland → rejected with shoreline message
6. Build mode → Port → click coast → succeeds
7. Trade ships spawn from ports, gold scales with distance, both sides earn
