const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

// Replace the build array loop inside rebuildRosters
const targetStr = `        ['launcher','radar','flak','sam','factory','iron_dome','airport','ciws','himars','nuke_plant'].forEach(k => {
            if(!SDEFS[k]) return;
            // Tech gate
            if(TECH_LOCKED_BUILDS.includes(k) && !isTechUnlocked(k, 'build', playerTech)) return;
            let b = document.createElement('div');
            b.className = 'ibtn';
            b.innerHTML = \`<div class="iname">\${SDEFS[k].name}</div><div class="icost">$\${SDEFS[k].cost}</div>\`;
            b.onclick = () => { buildMode = k; document.getElementById('bldMsg').textContent='اختر موقعا (مؤمن ومناسب)'; };
            document.getElementById('buildRow').appendChild(b);
        });`;

const replacementStr = `        ['launcher','radar','flak','sam','factory','iron_dome','airport','ciws','himars','nuke_plant','city','port'].forEach(k => {
            if(!SDEFS[k]) return;
            // Tech gate
            if(TECH_LOCKED_BUILDS.includes(k) && !isTechUnlocked(k, 'build', playerTech)) return;
            
            let cost = SDEFS[k].cost;
            if(k === 'city') cost = Math.floor(GAME_CONSTANTS.CITY_BASE_COST * Math.pow(1.5, pBuiltCities));
            if(k === 'port') cost = Math.floor(GAME_CONSTANTS.PORT_BASE_COST * Math.pow(1.5, pBuiltPorts));
            if(k === 'factory') cost = Math.floor(GAME_CONSTANTS.FACTORY_BASE_COST * Math.pow(1.5, pBuiltFactories));
            
            let b = document.createElement('div');
            b.className = 'ibtn';
            b.innerHTML = \`<div class="iname">\${SDEFS[k].name}</div><div class="icost">$\${cost}</div>\`;
            b.onclick = () => { buildMode = k; document.getElementById('bldMsg').textContent='اختر موقعا (مؤمن ومناسب)'; };
            document.getElementById('buildRow').appendChild(b);
        });`;

// Normalize line endings to do string replace
let normalizedCode = code.replace(/\\r\\n/g, '\\n');
let normalizedTarget = targetStr.replace(/\\r\\n/g, '\\n');
let normalizedReplacement = replacementStr.replace(/\\r\\n/g, '\\n');

if (normalizedCode.includes(normalizedTarget)) {
    normalizedCode = normalizedCode.replace(normalizedTarget, normalizedReplacement);
    fs.writeFileSync('src/main.js', normalizedCode, 'utf8');
    console.log('Successfully updated rebuildRosters in main.js!');
} else {
    // Let's also check if normalizedCode has a similar array
    console.log('Target string not found in main.js!');
    // Output a small part around where it should be to debug
    let lines = normalizedCode.split('\\n');
    let idx = lines.findIndex(l => l.includes("['launcher'"));
    if (idx !== -1) {
        console.log('Found line at index:', idx);
        console.log(lines.slice(idx, idx + 10).join('\\n'));
    }
}
