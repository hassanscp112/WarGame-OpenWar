const fs = require('fs');

let text = fs.readFileSync('src/main.js', 'utf8');

const connect_fix = `let myRole = 'player';
let serverUrl = 'ws://localhost:10294';

function connectWS() {
    const inputUrl = document.getElementById('serverUrl')?.value || 'localhost';
    serverUrl = \`ws://\${inputUrl}:10294\`;
    
    try {
        ws = new WebSocket(serverUrl);
        ws.onopen = () => {
            wsReady = true;
            const status = document.getElementById('onlineStatus');
            if(status) {
                status.textContent = ' متصل السيرفر';
                status.style.color = '#00ff88';
            }
            document.getElementById('btnCreate').disabled = false;
            document.getElementById('btnJoin').disabled = false;
        };
        ws.onclose = () => {`;

text = text.replace("let ws = null, wsReady = false, isOnline = false, roomCode = null;\n            wsReady = false;\n            const status = document.getElementById('onlineStatus');", 
                    "let ws = null, wsReady = false, isOnline = false, roomCode = null;\n" + connect_fix + "\n            wsReady = false;\n            const status = document.getElementById('onlineStatus');");

const ray_fix = `                let radius = c.tier === 'national_capital' ? 250 : c.tier === 'provincial' ? 180 : 100;
                if (haversineDist(lat, lon, c.lat, c.lon) < radius) return true;
            }
        }
    }
    for (let p of planes) {
        if (p.owner === owner && !p.dead && !p.parked) {
            if (haversineDist(lat, lon, p.lat, p.lon) < GAME_CONSTANTS.ZOC_PLANE_RADIUS) return true;
        }
    }
    return false;
}

function checkCollision(lat, lon) {
    for (let s of structs) {
        if (!s.dead && haversineDist(lat, lon, s.lat, s.lon) < GAME_CONSTANTS.BUILD_COLLISION_RADIUS) return true;
    }
    return false;
}

function raycastGlobe(e) {
    if(!camera || !earthMesh) return null;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(earthMesh);
    if(intersects.length > 0) return vec3ToLatLon(intersects[0].point);
    return null;
}

window.addEventListener('mousemove', e => {`;

text = text.replace("                let radius = c.tier === 'national_capital' ? 250 : c.tier === 'provincial' ? 180 : 100;\n                if (haversineDist(lat, lon, c.lat, c.lon) < radius) return true;\n                window.addEventListener('mousemove', e => {", ray_fix);

const swap_fix = `function clearSelection() {
    [...structs, ...planes].forEach(e => e.selected = false);
    document.getElementById('selPan').style.display = 'none';
    attackMoveMode = false;
    document.getElementById('tgtMsg').style.display = 'none';
    if(document.getElementById('bpGlobal')) {
        document.getElementById('bpGlobal').style.display = 'flex';
        document.getElementById('bpAirport').style.display = 'none';
    }
}

function updateSelectionPanel() {
    let sel = getSelectedUnits();
    let total = sel.planes.length + sel.structs.length;
    
    if(document.getElementById('bpGlobal')) {
        if(total === 1 && sel.structs.length === 1 && sel.structs[0].type === 'airport' && sel.structs[0].owner === 'player') {
            document.getElementById('bpGlobal').style.display = 'none';
            document.getElementById('bpAirport').style.display = 'flex';
        } else {
            document.getElementById('bpGlobal').style.display = 'flex';
            document.getElementById('bpAirport').style.display = 'none';
        }
    }
    
    if(total === 0) { document.getElementById('selPan').style.display = 'none'; return; }
    
    document.getElementById('selPan').style.display = 'block';
    
    if(total === 1) {`;

text = text.replace("function clearSelection() {\n    [...structs, ...planes].forEach(e => e.selected = false);\n    document.getElementById('selPan').style.display = 'none';\n    attackMoveMode = false;\n    document.getElementById('tgtMsg').style.display = 'none';\n}\n\nfunction updateSelectionPanel() {\n    let sel = getSelectedUnits();\n    let total = sel.planes.length + sel.structs.length;\n    if(total === 0) { document.getElementById('selPan').style.display = 'none'; return; }\n    \n    document.getElementById('selPan').style.display = 'block';\n    \n    if(total === 1) {", swap_fix);

// ALSO update rebuildRosters inside node script so we finally don't use fuzzy replace.
// we want to wipe the planes.push in rebuildrosters and push to apt.trainQueue
text = text.replace(`            btn.onclick = () => { 
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
                    // Quick update to UI
                    if(apt.trainQueue.length === 1) {
                        document.getElementById('aptQueueText').textContent = \`إنتاج: \${PCFG[k].name} (0%) | طابور: 0 الانتظار\`;
                    }
                } else if(!apt) {
                    alert('يجب تحديد مطار أولاً!');
                } else {
                    alert('لا توجد موارد كافية!');
                }
            };`);

fs.writeFileSync('src/main.js', text);
console.log('Fixed main.js via Node script');
