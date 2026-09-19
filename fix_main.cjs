const fs = require('fs');
let c = fs.readFileSync('src/main.js', 'utf8');
let changes = 0;

// 1. Fix target marker ring size (too small to see at globe scale)
if (c.includes('RingGeometry(1.5, 2.0, 32)')) {
    c = c.replace('RingGeometry(1.5, 2.0, 32)', 'RingGeometry(30, 42, 32)');
    changes++;
    console.log('[1] Fixed marker ring size: 1.5/2.0 -> 30/42');
}

// 2. Fix pResource -> pRes (undefined variable)
const pResCount = (c.match(/pResource/g) || []).length;
if (pResCount > 0) {
    c = c.replace(/pResource/g, 'pRes');
    changes++;
    console.log(`[2] Fixed pResource -> pRes (${pResCount} occurrences)`);
}

// 3. Add logEvent function before upgradeCityRoads
if (!c.includes('function logEvent(')) {
    c = c.replace(
        'function upgradeCityRoads(idx, cost) {',
        `function logEvent(msg, type) {
    let slog = document.getElementById('slog');
    if(!slog) return;
    let el = document.createElement('div');
    el.className = 'le l' + (type || 'info');
    el.textContent = msg;
    slog.prepend(el);
    while(slog.children.length > 40) slog.lastChild.remove();
}

function upgradeCityRoads(idx, cost) {`
    );
    changes++;
    console.log('[3] Added logEvent function');
}

// 4. Fix marker position elevation and add cursor management + city hover to mousemove
const oldMousemove = `window.addEventListener('mousemove', e => {
    let loc = raycastGlobe(e);
    if(loc && markerMesh) {
        markerMesh.visible = (targetingMode || buildMode);
        let pos = latLonToVec3(loc.lat, loc.lon, EARTH_RADIUS + 5.0);
        markerMesh.position.copy(pos);
        markerMesh.lookAt(new THREE.Vector3(0,0,0));
    } else if(markerMesh) markerMesh.visible = false;
});`;

const newMousemove = `window.addEventListener('mousemove', e => {
    let loc = raycastGlobe(e);
    if(loc && markerMesh) {
        markerMesh.visible = (targetingMode || buildMode);
        let pos = latLonToVec3(loc.lat, loc.lon, EARTH_RADIUS + 50.0);
        markerMesh.position.copy(pos);
        markerMesh.lookAt(new THREE.Vector3(0,0,0));
        // Dynamic marker scale based on camera distance
        let camDist = camera.position.length();
        let markerScale = Math.max(0.3, (camDist - EARTH_RADIUS) / 600);
        markerMesh.scale.setScalar(markerScale);
    } else if(markerMesh) markerMesh.visible = false;

    // Cursor management
    if(renderer && renderer.domElement) {
        if(targetingMode) renderer.domElement.style.cursor = 'crosshair';
        else if(buildMode) renderer.domElement.style.cursor = 'cell';
        else if(isDragging) renderer.domElement.style.cursor = 'grabbing';
        else if(loc) renderer.domElement.style.cursor = 'grab';
        else renderer.domElement.style.cursor = 'default';
    }

    // City hover tooltip
    if(loc) {
        handleCityHover(loc.lat, loc.lon);
        updateTooltipPosition(e.clientX, e.clientY);
    } else {
        handleCityHover(null, null);
    }
});`;

if (c.includes("EARTH_RADIUS + 5.0);")) {
    c = c.replace(oldMousemove, newMousemove);
    changes++;
    console.log('[4] Fixed mousemove: cursor, city hover, marker scale');
}

// 5. Fix rotation speed formula (exponential curve instead of linear)
const oldRotation = `    // Dynamic Rotation Speed based on altitude
    if(camera && controls) {
        let currentDist = camera.position.length();
        let altitude = Math.max(1, currentDist - EARTH_RADIUS);
        // Map altitude to 0.05 (ground) through 1.2 (orbit)
        controls.rotateSpeed = 0.05 + 1.15 * (altitude / (controls.maxDistance - EARTH_RADIUS));
    }`;

const newRotation = `    // Dynamic Rotation Speed + Zoom Speed based on altitude
    if(camera && controls) {
        let currentDist = camera.position.length();
        let altitude = Math.max(1, currentDist - EARTH_RADIUS);
        let maxAlt = controls.maxDistance - EARTH_RADIUS;
        let normalized = Math.min(1, altitude / maxAlt);
        // Exponential curve: very slow rotation when close, normal when far
        controls.rotateSpeed = 0.008 + 0.9 * Math.pow(normalized, 1.8);
        // Dynamic zoom: finer scroll steps when near the surface
        controls.zoomSpeed = 0.15 + 0.85 * Math.pow(normalized, 0.6);
    }`;

if (c.includes('0.05 + 1.15 *')) {
    c = c.replace(oldRotation, newRotation);
    changes++;
    console.log('[5] Fixed rotation speed: exponential curve + dynamic zoom speed');
}

// 6. Add updateCityLabels() call in game loop before renderer.render
if (!c.includes('updateCityLabels();')) {
    c = c.replace(
        '    renderer.render(scene, camera);\n    requestAnimationFrame(loop);\n}',
        '    // Update city labels position/LOD every frame\n    updateCityLabels();\n\n    renderer.render(scene, camera);\n    requestAnimationFrame(loop);\n}'
    );
    changes++;
    console.log('[6] Added updateCityLabels() call in game loop');
}

// 7. Add missing functions and window exports at end of file
if (!c.includes('function toggleProvinceBorders()')) {
    const insertBefore = '\n// Async load GEO_DATA_ROADS';
    const newFunctions = `
window.upgradeCityRoads = upgradeCityRoads;
window.logEvent = logEvent;

// Province border toggle
window.renderProvinceBorders = true;
function toggleProvinceBorders() {
    window.renderProvinceBorders = !window.renderProvinceBorders;
    let btn = document.getElementById('btnBorders');
    if(btn) btn.style.opacity = window.renderProvinceBorders ? '1' : '0.4';
    if(provinceBorderMesh) {
        if(!window.renderProvinceBorders) { provinceBorderMesh.visible = false; }
        else {
            provinceBorderMesh.visible = true;
            if(provinceBorderMesh.material) {
                let alt = camera ? camera.position.length() - EARTH_RADIUS : 999;
                provinceBorderMesh.material.opacity = alt < 300 ? 0.8 : 0.3;
            }
        }
    }
}
window.toggleProvinceBorders = toggleProvinceBorders;

// Mobile tab switcher
function switchTab(idx, btn) {
    document.querySelectorAll('.mTab').forEach(t => t.classList.remove('act'));
    if(btn) btn.classList.add('act');
    for(let i = 0; i < 5; i++) {
        let tc = document.getElementById('mTab' + i);
        if(tc) { if(i === idx) tc.classList.add('act'); else tc.classList.remove('act'); }
    }
}
window.switchTab = switchTab;

// Async load GEO_DATA_ROADS`;

    c = c.replace(insertBefore, newFunctions);
    changes++;
    console.log('[7] Added toggleProvinceBorders, switchTab, window exports');
}

// 8. Fix minDistance to prevent extreme close zoom
if (c.includes('controls.minDistance = EARTH_RADIUS + 100;')) {
    c = c.replace('controls.minDistance = EARTH_RADIUS + 100;', 'controls.minDistance = EARTH_RADIUS + 50;');
    changes++;
    console.log('[8] Adjusted minDistance: 100 -> 50');
}

fs.writeFileSync('src/main.js', c);
console.log(`\nDone! Applied ${changes} fixes.`);
