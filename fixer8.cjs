const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

// 1. Add global variable startSpawnPhase
let targetGlobals = 'let selectedSourceProvinceIdx=-1;';
let repGlobals = 'let selectedSourceProvinceIdx=-1;\nwindow.startSpawnPhase = false;';

// 2. Click handler intercept
let targetClick = `    let loc = raycastGlobe(e);
    if(!loc) return;

    if(buildMode) {`;

let repClick = `    let loc = raycastGlobe(e);
    if(!loc) return;

    if(window.startSpawnPhase) {
        if(!isLand(loc.lat, loc.lon)) {
            let msg = document.getElementById('bldMsg') || document.getElementById('conqMsg');
            if(msg) msg.textContent = 'يجب اختيار موقع على اليابسة للبدء!';
            return;
        }
        
        let pLoc = { lat: loc.lat, lon: loc.lon };
        
        // Spawn player starting structures
        structs.push(new Structure(pLoc.lat, pLoc.lon, 'base', 'player'));
        structs.push(new Structure(pLoc.lat - 1.2, pLoc.lon + 1.8, 'launcher', 'player'));
        let pa = new Structure(pLoc.lat + 1.2, pLoc.lon + 1.2, 'airport', 'player');
        structs.push(pa);
        planes.push(new Plane(pa.lat, pa.lon, PCFG['fighter'], 'player'));
        planes.push(new Plane(pa.lat, pa.lon, PCFG['stealth'], 'player'));
        
        // Mark player province owned
        let pProvIdx = getProvinceAtLatLon(pLoc.lat, pLoc.lon);
        if(pProvIdx !== -1) {
            window.provinceOwnership[pProvIdx] = 'player';
        }
        
        // Choose enemy starting point (at least 4000km away on land)
        let candidates = cityNodes.filter(c => haversineDist(c.lat, c.lon, pLoc.lat, pLoc.lon) > 4000 && isLand(c.lat, c.lon));
        if(candidates.length === 0) candidates = cityNodes.filter(c => isLand(c.lat, c.lon));
        if(candidates.length === 0) candidates = cityNodes;
        
        let eLoc = candidates[Math.floor(Math.random() * candidates.length)];
        
        // Spawn enemy starting structures
        structs.push(new Structure(eLoc.lat, eLoc.lon, 'base', 'enemy'));
        structs.push(new Structure(eLoc.lat + 1.2, eLoc.lon - 1.8, 'launcher', 'enemy'));
        
        // Mark enemy province owned
        let eProvIdx = getProvinceAtLatLon(eLoc.lat, eLoc.lon);
        if(eProvIdx !== -1) {
            window.provinceOwnership[eProvIdx] = 'enemy';
        }
        
        // Capture starting region city nodes
        cityNodes.forEach(c => {
            let dP = haversineDist(c.lat, c.lon, pLoc.lat, pLoc.lon);
            let dE = haversineDist(c.lat, c.lon, eLoc.lat, eLoc.lon);
            if(dP < 15.0) {
                c.owner = 'player';
                c.originalOwner = 'player';
            } else if(dE < 15.0) {
                c.owner = 'enemy';
                c.originalOwner = 'enemy';
            }
        });
        
        updateTerritoryFromCities(cityNodes);
        updateCityColors();
        
        // Setup resource balances
        if(isOnline) {
            pRes = GAME_CONSTANTS.STARTING_RES_ONLINE;
            eRes = GAME_CONSTANTS.STARTING_RES_ONLINE;
        } else {
            pRes = GAME_CONSTANTS.STARTING_RES_OFFLINE;
            eRes = GAME_CONSTANTS.STARTING_RES_OFFLINE;
        }
        
        window.startSpawnPhase = false;
        
        let msg = document.getElementById('bldMsg') || document.getElementById('conqMsg');
        if(msg) msg.textContent = 'بدأت المعركة! انطلق وقم بتوسيع نفوذك.';
        
        updateHUD();
        return;
    }

    if(buildMode) {`;

// 3. initWorld starting base bypass
let targetBases = `    // Initial Bases - Player
    structs.push(new Structure(pLoc.lat, pLoc.lon, 'base', 'player'));
    structs.push(new Structure(pLoc.lat - 2, pLoc.lon + 5, 'launcher', 'player'));
    let pa = new Structure(pLoc.lat + 2, pLoc.lon + 2, 'airport', 'player'); structs.push(pa);
    
    // Enemy bases
    structs.push(new Structure(eLoc.lat, eLoc.lon, 'base', 'enemy'));
    structs.push(new Structure(eLoc.lat + 2, eLoc.lon - 5, 'launcher', 'enemy'));
    
    // Spawn all world cities as territory nodes
    initCitySprites(pLoc, eLoc);
    
    planes.push(new Plane(pa.lat, pa.lon, PCFG['fighter'], 'player'));
    planes.push(new Plane(pa.lat, pa.lon, PCFG['stealth'], 'player'));`;

let repBases = `    window.startSpawnPhase = true;
    pRes = 0;
    eRes = 0;
    
    // Initialize cities with a mock location so they all start neutral
    initCitySprites({lat: 999, lon: 999}, {lat: 999, lon: 999});
    
    let msg = document.getElementById('bldMsg') || document.getElementById('conqMsg');
    if(msg) msg.textContent = 'اختر موقع البداية لجيشك على اليابسة 🚩';`;

// 4. calcIncome starting spawn check
let targetIncome = `function calcIncome(side) {
    const C = GAME_CONSTANTS;`;

let repIncome = `function calcIncome(side) {
    if(window.startSpawnPhase) return { income: 0, upkeep: 0, net: 0 };
    const C = GAME_CONSTANTS;`;

// 5. runAI starting spawn check
let targetRunAI = `function runAI() {
    if(isOnline) return; // No AI in online mode`;

let repRunAI = `function runAI() {
    if(window.startSpawnPhase) return;
    if(isOnline) return; // No AI in online mode`;

// 6. loop starting spawn check
let targetLoopGrowth = `    // Troop Growth Ticks
    pTroops += troopIncreaseRate('player', pTroops);
    eTroops += troopIncreaseRate('enemy', eTroops);`;

let repLoopGrowth = `    // Troop Growth Ticks
    if(!window.startSpawnPhase) {
        pTroops += troopIncreaseRate('player', pTroops);
        eTroops += troopIncreaseRate('enemy', eTroops);
    }`;

// Normalization & replacement
let normalized = code.replace(/\r\n/g, '\n');

let list = [
    [targetGlobals, repGlobals, 'Globals'],
    [targetClick, repClick, 'Click handler'],
    [targetBases, repBases, 'Initial bases spawning in initWorld'],
    [targetIncome, repIncome, 'calcIncome starting spawn check'],
    [targetRunAI, repRunAI, 'runAI starting spawn check'],
    [targetLoopGrowth, repLoopGrowth, 'loop starting spawn check']
];

list.forEach(([target, replacement, label]) => {
    let normalizedTarget = target.replace(/\r\n/g, '\n');
    let normalizedReplacement = replacement.replace(/\r\n/g, '\n');
    if (normalized.includes(normalizedTarget)) {
        normalized = normalized.replace(normalizedTarget, normalizedReplacement);
        console.log(`Success replacing: ${label}`);
    } else {
        console.log(`Failed finding target for: ${label}`);
    }
});

fs.writeFileSync('src/main.js', normalized, 'utf8');
console.log('Finished updating main.js!');
