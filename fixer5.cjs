const fs = require('fs');

let mainLines = fs.readFileSync('src/main.js', 'utf8').split('\n');

let exposeIdx = mainLines.findIndex(l => l.includes('// Expose functions for inline HTML event handlers'));

let netLines = fs.readFileSync('_dead_archive/3d_networking.js', 'utf8').split('\n');
let setMenuIdx = netLines.findIndex(l => l.startsWith('function setMenuStatus'));
let netCode = netLines.slice(setMenuIdx).join('\n');

let loopCode = fs.readFileSync('_dead_archive/3d_loop.js', 'utf8');

// Replace old rebuildRosters with the trainQueue version
loopCode = loopCode.replace(
    `            btn.onclick = () => { 
                let apt = structs.find(s=>s.owner==myRole && s.type==='airport' && !s.dead);
                if(apt && pRes >= PCFG[k].cost) {
                    pRes -= PCFG[k].cost;
                    planes.push(new Plane(apt.lat, apt.lon, PCFG[k], myRole));
                } else if(!apt) {
                    document.getElementById('bldMsg').textContent = 'تحتاج مطار عسكري سليم!';
                } else {
                    document.getElementById('bldMsg').textContent = 'لا توجد موارد كافية!';
                }
            };`,
    `            btn.onclick = () => { 
                let sel = getSelectedUnits();
                let apt = sel.structs.length === 1 && sel.structs[0].type === 'airport' ? sel.structs[0] : null;
                if(apt && apt.owner === myRole && pRes >= PCFG[k].cost) {
                    pRes -= PCFG[k].cost;
                    apt.trainQueue.push({ key: k, type: 'plane', totalTime: PCFG[k].trainTime || 250, timer: PCFG[k].trainTime || 250 });
                    if(apt.trainQueue.length === 1) {
                        document.getElementById('aptQueueText').textContent = \`إنتاج: \${PCFG[k].name} (0%) | طابور: 0 الانتظار\`;
                    }
                } else if(!apt) {
                    alert('يجب تحديد مطار أولاً!');
                } else {
                    alert('لا توجد موارد كافية!');
                }
            };`
);

let combined = netCode + '\n' + loopCode + '\n';
mainLines.splice(exposeIdx, 0, combined);

fs.writeFileSync('src/main.js', mainLines.join('\n'));
console.log('Restored missing code!');
