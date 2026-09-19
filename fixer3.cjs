const fs = require('fs');
let lines = fs.readFileSync('src/main.js', 'utf8').split('\n');

let startIdx = lines.findIndex(l => l.includes("let p = planes.find(p => p.owner === oS && p.cfg.name === PCFG[action.ptype].name);"));
if (startIdx !== -1) {
    let endIdx = startIdx;
    while(endIdx < lines.length && !lines[endIdx].includes("if(action.type === 'spawn_plane')")) {
        endIdx++;
    }
    // Include spawn plane block until closing brace
    while(endIdx < lines.length && lines[endIdx] !== "}") {
        endIdx++;
    }
    
    const correctCode = `function applyOpponentAction(action) {
    const oS = 'enemy'; // From my perspective, they are always the enemy
    
    if (action.type === 'sync_countries') {
        // Guest receives this
        startOnlineGame(action.pc, action.ec);
    }
    
    if (action.type === 'launch') {
        const cfg = MCFG[action.mtype];
        if (cfg) missiles.push(new Missile(action.lat, action.lon, action.tlat, action.tlon, cfg, oS));
    }
    if (action.type === 'build') {
        structs.push(new Structure(action.lat, action.lon, action.btype, oS));
    }
    if (action.type === 'plane_move') {
        let p = planes.find(p => p.owner === oS && p.cfg.name === PCFG[action.ptype].name);
        if(p) {
            p.tlat = action.tlat;
            p.tlon = action.tlon;
            p.parked = false;
        }
    }
    if(action.type === 'spawn_plane') {
        planes.push(new Plane(action.lat, action.lon, PCFG[action.ptype], oS));
    }
}`;
    
    lines.splice(startIdx, endIdx - startIdx + 1, correctCode);
    fs.writeFileSync('src/main.js', lines.join('\n'));
    console.log('Fixed applyOpponentAction');
} else {
    console.log('Could not find broken block');
}
