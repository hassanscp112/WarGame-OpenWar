// Splices src/main.js: replaces the pixel-icon block (struct icon system)
// with the low-poly 3D model builders. Idempotent: searches for markers.
import { readFileSync, writeFileSync } from 'fs';

const path = 'src/main.js';
const src = readFileSync(path, 'utf8');
const lines = src.split('\n');

const START_MARKER = '// ── Structure ICON sprites (OpenFront-style PIXEL ART) ──';
const END_MARKER = 'function createLowPolyGeo(role, color) {';

const startIdx = lines.findIndex(l => l.includes(START_MARKER));
const endIdx = lines.findIndex(l => l.includes(END_MARKER));
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    console.error(`markers not found (start=${startIdx}, end=${endIdx})`);
    process.exit(1);
}

const REPLACEMENT = `// ═══════════════════════════════════════════════════════════════════
//  LOW-POLY 3D STRUCTURE MODELS (board-game-piece style)
//  Each building is a COMPOSITE of primitives (boxes/cylinders/cones) with
//  flat shading, neutral concrete/metal tones + OWNER-COLORED ACCENTS
//  (flags, stripes, rings). +Y up, base at y≈0, footprint ~2.4 units.
//  Geometries cached; structural materials shared; only accent materials
//  are per-instance (flagged .accent) so capture-retint and dispose are safe.
// ═══════════════════════════════════════════════════════════════════
const LP = {
    CONCRETE: 0x8d949c, LIGHT: 0xb8c0c8, DGRAY: 0x525c66, METAL: 0x6e7880,
    DARK: 0x333a41, ROOF: 0x3d454d, WHITE: 0xdde3e8, RUNWAY: 0x2b3036,
    TIRE: 0x1d2126, GLASS: 0x9fd8ff, EARTH: 0x7a6a55,
};

// Cached geometry factory (keyed by call signature) — never re-created.
const _modelGeoCache = new Map();
function _g(key, maker) {
    if (_modelGeoCache.has(key)) return _modelGeoCache.get(key);
    const geo = maker();
    geo.userData = geo.userData || {};
    geo.userData.shared = true;   // disposeMeshDeep skips shared resources
    _modelGeoCache.set(key, geo);
    return geo;
}
const _box = (w, h, d) => _g(\`box\${w}\${h}\${d}\`, () => new THREE.BoxGeometry(w, h, d));
const _cyl = (rt, rb, h, s = 10) => _g(\`cyl\${rt}\${rb}\${h}\${s}\`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const _cone = (r, h, s = 10) => _g(\`cone\${r}\${h}\${s}\`, () => new THREE.ConeGeometry(r, h, s));
const _sph = (r, ws = 10, hs = 8) => _g(\`sph\${r}\${ws}\${hs}\`, () => new THREE.SphereGeometry(r, ws, hs));
const _halfSph = (r) => _g(\`half\${r}\`, () => new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2));

// Structural (shared) material — flat shaded.
function _sm(color) { return getSharedMat(color); }
// Accent (per-instance) material — tinted owner color, disposed with the structure.
function _am(color) {
    const m = new THREE.MeshPhongMaterial({ color, flatShading: true });
    m.userData = m.userData || {};
    m.userData.accent = true;
    return m;
}

// Mesh helper: adds to group at position with optional rotation.
function _M(group, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, name) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    if (rz) mesh.rotation.z = rz;
    if (name) mesh.name = name;
    group.add(mesh);
    return mesh;
}

const STRUCT_MODEL_BUILDERS = {
    // ── CITY: platform + skyline cluster + antenna ──
    city(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.4, 0.15, 2.4), _sm(LP.CONCRETE), 0, 0.075);
        _M(g, _box(0.55, 1.4, 0.55), _sm(LP.LIGHT), -0.7, 0.87, -0.5);
        _M(g, _box(0.5, 1.9, 0.5), _sm(LP.LIGHT), 0.05, 1.12, 0.15);
        _M(g, _box(0.45, 1.0, 0.45), _sm(LP.LIGHT), 0.75, 0.65, -0.55);
        _M(g, _box(0.4, 0.7, 0.4), _sm(LP.LIGHT), -0.35, 0.5, 0.7);
        _M(g, _box(0.56, 0.08, 0.56), _am(acc), -0.7, 1.61, -0.5);      // roof caps
        _M(g, _box(0.51, 0.08, 0.51), _am(acc), 0.05, 2.11, 0.15);
        _M(g, _box(0.46, 0.08, 0.46), _am(acc), 0.75, 1.19, -0.55);
        _M(g, _cyl(0.02, 0.02, 0.5, 6), _sm(LP.DARK), 0.05, 2.4, 0.15);  // antenna
        return g;
    },
    // ── PORT: dock + container stacks + crane ──
    port(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.4, 0.14, 2.4), _sm(LP.CONCRETE), 0, 0.07);
        _M(g, _box(0.5, 0.32, 0.42), _sm(LP.DGRAY), 0.65, 0.3, -0.6);
        _M(g, _box(0.5, 0.32, 0.42), _am(acc), 0.65, 0.64, -0.6);
        _M(g, _box(0.5, 0.32, 0.42), _sm(LP.DGRAY), 0.05, 0.3, -0.62);
        // crane
        _M(g, _box(0.12, 1.6, 0.12), _sm(LP.METAL), -0.75, 0.94, 0.35);
        _M(g, _box(1.15, 0.09, 0.12), _sm(LP.METAL), -0.2, 1.7, 0.35);
        _M(g, _box(0.32, 0.09, 0.12), _am(acc), -0.85, 1.7, 0.35);
        _M(g, _cyl(0.01, 0.01, 0.55, 6), _sm(LP.DARK), 0.25, 1.42, 0.35); // hoist line
        _M(g, _box(0.16, 0.12, 0.16), _sm(LP.DGRAY), 0.25, 1.1, 0.35);    // hook block
        return g;
    },
    // ── FACTORY: hall + sawtooth roof + chimneys ──
    factory(acc) {
        const g = new THREE.Group();
        _M(g, _box(1.9, 0.75, 1.5), _sm(LP.CONCRETE), 0.15, 0.52);
        for (let i = 0; i < 3; i++) {
            _M(g, _box(0.56, 0.4, 1.5), _sm(LP.ROOF), -0.55 + i * 0.62, 1.05, 0, 0, 0, 0.42);
        }
        _M(g, _cyl(0.15, 0.19, 1.35, 8), _sm(LP.DGRAY), -0.8, 1.05, -0.4);
        _M(g, _cyl(0.15, 0.19, 1.05, 8), _sm(LP.DGRAY), -0.8, 0.9, 0.42);
        _M(g, _cyl(0.16, 0.16, 0.14, 8), _am(acc), -0.8, 1.6, -0.4);     // chimney band
        _M(g, _cyl(0.16, 0.16, 0.14, 8), _am(acc), -0.8, 1.28, 0.42);
        return g;
    },
    // ── AIRPORT: runway + terminal + control tower ──
    airport(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.5, 0.07, 0.8), _sm(LP.RUNWAY), 0, 0.1, -0.2);
        for (let i = 0; i < 5; i++) {
            _M(g, _box(0.22, 0.02, 0.07), _sm(LP.WHITE), -0.95 + i * 0.48, 0.15, -0.2);
        }
        _M(g, _box(1.0, 0.38, 0.5), _sm(LP.LIGHT), 0, 0.34, 0.85);        // terminal
        _M(g, _box(1.05, 0.07, 0.55), _am(acc), 0, 0.56, 0.85);          // terminal roof
        _M(g, _cyl(0.09, 0.13, 0.85, 8), _sm(LP.CONCRETE), 0.75, 0.57, 0.85); // tower
        _M(g, _box(0.3, 0.2, 0.3), _sm(LP.GLASS), 0.75, 1.08, 0.85);
        _M(g, _box(0.34, 0.05, 0.34), _am(acc), 0.75, 1.2, 0.85);
        return g;
    },
    // ── LAUNCHER: pad + gantry + rocket ──
    launcher(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.2, 0.14, 2.2), _sm(LP.CONCRETE), 0, 0.07);
        _M(g, _box(0.18, 1.9, 0.18), _sm(LP.METAL), -0.8, 1.08, 0.25);   // gantry
        _M(g, _box(0.55, 0.07, 0.09), _sm(LP.METAL), -0.55, 1.0, 0.25);
        _M(g, _box(0.55, 0.07, 0.09), _sm(LP.METAL), -0.55, 1.6, 0.25);
        _M(g, _box(0.14, 0.3, 0.14), _am(acc), -0.8, 2.05, 0.25);        // beacon
        _M(g, _cyl(0.16, 0.16, 1.15, 10), _sm(LP.WHITE), 0.3, 0.85, -0.1); // rocket body
        _M(g, _cone(0.16, 0.38, 10), _sm(LP.DGRAY), 0.3, 1.62, -0.1);     // nose
        _M(g, _cyl(0.165, 0.165, 0.12, 10), _am(acc), 0.3, 1.15, -0.1);   // band
        for (let i = 0; i < 3; i++) {                                     // fins
            const a = i * (Math.PI * 2 / 3);
            _M(g, _box(0.05, 0.3, 0.2), _sm(LP.DGRAY),
                0.3 + Math.cos(a) * 0.19, 0.42, -0.1 + Math.sin(a) * 0.19, 0, -a, 0);
        }
        return g;
    },
    // ── SAM: platform + angled rail with 3 missiles ──
    sam(acc) {
        const g = new THREE.Group();
        _M(g, _box(1.9, 0.16, 1.5), _sm(LP.METAL), 0, 0.08);
        _M(g, _cyl(0.22, 0.3, 0.22, 10), _sm(LP.DGRAY), 0, 0.27);
        const rail = new THREE.Group();
        rail.position.set(0, 0.42, 0);
        rail.rotation.x = -0.55;
        rail.name = 'rail';
        g.add(rail);
        _M(rail, _box(1.5, 0.12, 0.6), _sm(LP.DGRAY), 0, 0.3);
        _M(rail, _box(1.5, 0.05, 0.64), _am(acc), 0, 0.38);
        for (let i = -1; i <= 1; i++) {
            _M(rail, _cyl(0.055, 0.055, 1.0, 8), _sm(LP.WHITE), 0, 0.47, i * 0.18, Math.PI / 2);
            _M(rail, _cone(0.055, 0.18, 8), _sm(LP.DGRAY), 0.59, 0.47, i * 0.18, 0, 0, -Math.PI / 2);
        }
        return g;
    },
    // ── RADAR: base + mast + ROTATING dish ──
    radar(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.55, 0.65, 0.2, 10), _sm(LP.CONCRETE), 0, 0.1);
        _M(g, _box(0.12, 1.15, 0.12), _sm(LP.METAL), 0, 0.77);
        _M(g, _box(0.2, 0.08, 0.2), _am(acc), 0, 0.48);
        const dish = new THREE.Group();
        dish.position.set(0, 1.4, 0);
        dish.rotation.x = -0.6;
        dish.name = 'dish';
        g.add(dish);
        const dishCone = new THREE.Mesh(
            _g('dishcone', () => new THREE.CylinderGeometry(0.06, 0.6, 0.32, 12, 1, true)),
            _sm(LP.LIGHT)
        );
        dishCone.material = new THREE.MeshPhongMaterial({ color: LP.LIGHT, flatShading: true, side: THREE.DoubleSide });
        dishCone.material.userData = dishCone.material.userData || {};
        dishCone.material.userData.accent = true;   // dispose-safe (per-instance)
        dish.add(dishCone);
        _M(dish, _cyl(0.015, 0.015, 0.5, 6), _sm(LP.DARK), 0, 0.1);
        _M(dish, _box(0.07, 0.07, 0.07), _am(acc), 0, 0.35);
        return g;
    },
    // ── FLAK: circular pit + mount + twin barrels ──
    flak(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.62, 0.72, 0.18, 12), _sm(LP.CONCRETE), 0, 0.09);
        _M(g, _cyl(0.63, 0.63, 0.04, 12), _am(acc), 0, 0.19);
        _M(g, _box(0.34, 0.24, 0.34), _sm(LP.DGRAY), 0, 0.34);
        const barrels = new THREE.Group();
        barrels.position.set(0, 0.46, 0);
        barrels.rotation.x = -0.7;
        barrels.name = 'barrels';
        g.add(barrels);
        _M(barrels, _cyl(0.045, 0.045, 1.05, 8), _sm(LP.METAL), 0, 0, -0.09, Math.PI / 2);
        _M(barrels, _cyl(0.045, 0.045, 1.05, 8), _sm(LP.METAL), 0, 0, 0.09, Math.PI / 2);
        _M(barrels, _box(0.12, 0.12, 0.16), _am(acc), 0.52, 0, -0.09);
        _M(barrels, _box(0.12, 0.12, 0.16), _am(acc), 0.52, 0, 0.09);
        _M(g, _cyl(0.14, 0.14, 0.2, 8), _sm(LP.DGRAY), 0.32, 0.3, 0.3); // ammo drum
        return g;
    },
    // ── HIMARS: 6-wheel truck + rocket pod ──
    himars(acc) {
        const g = new THREE.Group();
        for (const wx of [-0.72, -0.18, 0.42]) {
            _M(g, _cyl(0.17, 0.17, 0.12, 10), _sm(LP.TIRE), wx, 0.17, -0.48, 0, 0, Math.PI / 2);
            _M(g, _cyl(0.17, 0.17, 0.12, 10), _sm(LP.TIRE), wx, 0.17, 0.48, 0, 0, Math.PI / 2);
        }
        _M(g, _box(2.0, 0.16, 0.95), _sm(LP.DGRAY), -0.05, 0.36);        // chassis
        _M(g, _box(0.55, 0.45, 0.9), _sm(LP.METAL), 0.62, 0.62);         // cab
        _M(g, _box(0.5, 0.18, 0.8), _sm(LP.GLASS), 0.78, 0.68);
        const pod = new THREE.Group();
        pod.position.set(-0.35, 0.62, 0);
        pod.rotation.x = -0.12;
        g.add(pod);
        _M(pod, _box(1.05, 0.4, 0.62), _sm(LP.METAL), 0, 0.18);
        _M(pod, _box(1.05, 0.07, 0.66), _am(acc), 0, 0.42);
        for (let i = -1; i <= 1; i++) {
            _M(pod, _cyl(0.05, 0.05, 0.16, 8), _sm(LP.WHITE), 0.55, 0.2, i * 0.18, Math.PI / 2);
        }
        return g;
    },
    // ── CIWS: dome + gatling cluster + radar ball ──
    ciws(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.55, 0.65, 0.28, 12), _sm(LP.METAL), 0, 0.14);
        _M(g, _halfSph(0.45), _sm(LP.WHITE), 0, 0.28);
        _M(g, _cyl(0.46, 0.46, 0.05, 12), _am(acc), 0, 0.3);
        const barrels = new THREE.Group();
        barrels.position.set(0.42, 0.42, 0);
        barrels.rotation.x = -0.35;
        barrels.name = 'barrels';
        g.add(barrels);
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            _M(barrels, _cyl(0.025, 0.025, 0.75, 6), _sm(LP.DARK), Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08, Math.PI / 2);
        }
        _M(barrels, _cyl(0.05, 0.05, 0.8, 6), _sm(LP.METAL), 0, 0, 0, Math.PI / 2);
        _M(g, _cyl(0.03, 0.03, 0.3, 6), _sm(LP.METAL), -0.45, 0.62, -0.3);
        _M(g, _sph(0.11, 8, 6), _am(acc), -0.45, 0.82, -0.3);           // radar ball
        return g;
    },
    // ── IRON DOME: dome + tilted launcher box ──
    iron_dome(acc) {
        const g = new THREE.Group();
        _M(g, _box(1.9, 0.14, 1.5), _sm(LP.CONCRETE), 0, 0.07);
        _M(g, _halfSph(0.5), _sm(LP.DGRAY), -0.35, 0.14);
        _M(g, _cyl(0.51, 0.51, 0.05, 12), _am(acc), -0.35, 0.16);
        const box = new THREE.Group();
        box.position.set(0.45, 0.3, 0);
        box.rotation.x = -0.5;
        g.add(box);
        _M(box, _box(1.0, 0.32, 0.62), _sm(LP.METAL), 0, 0.16);
        for (let i = -1; i <= 1; i++) {
            _M(box, _cyl(0.06, 0.06, 0.55, 8), _sm(LP.WHITE), 0, 0.36, i * 0.18);
            _M(box, _cone(0.06, 0.2, 8), _sm(LP.DGRAY), 0, 0.72, i * 0.18);
        }
        return g;
    },
    // ── NUKE PLANT: two cooling towers + reactor dome ──
    nuke_plant(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.4, 0.12, 1.9), _sm(LP.CONCRETE), 0, 0.06);
        _M(g, _cyl(0.3, 0.46, 1.25, 10), _sm(LP.LIGHT), -0.55, 0.74, -0.3);
        _M(g, _cyl(0.3, 0.46, 1.25, 10), _sm(LP.LIGHT), 0.6, 0.74, -0.3);
        _M(g, _cyl(0.31, 0.31, 0.1, 10), _am(acc), -0.55, 1.3, -0.3);
        _M(g, _halfSph(0.38), _sm(LP.WHITE), 0.02, 0.12, 0.55);          // reactor
        _M(g, _cyl(0.39, 0.39, 0.05, 12), _am(acc), 0.02, 0.14, 0.55);
        _M(g, _cyl(0.02, 0.02, 0.42, 6), _sm(LP.DARK), 0.02, 0.52, 0.55);
        return g;
    },
    // ── HQ BASE: command building + comms + OWNER FLAG ──
    base(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.3, 0.16, 2.3), _sm(LP.CONCRETE), 0, 0.08);
        _M(g, _box(1.1, 0.55, 0.85), _sm(LP.LIGHT), 0.15, 0.44, -0.3);
        _M(g, _box(1.16, 0.08, 0.91), _am(acc), 0.15, 0.76, -0.3);      // roof line
        _M(g, _box(0.4, 0.3, 0.4), _sm(LP.LIGHT), -0.75, 0.31, 0.65);   // annex
        _M(g, _cyl(0.03, 0.03, 1.5, 6), _sm(LP.METAL), -0.95, 0.91, -0.85); // flag pole
        _M(g, _box(0.5, 0.3, 0.02), _am(acc), -0.68, 1.42, -0.85);      // FLAG
        _M(g, _cyl(0.015, 0.015, 0.4, 6), _sm(LP.DARK), 0.75, 0.95, 0.7);
        _M(g, _sph(0.09, 8, 6), _sm(LP.GLASS), 0.75, 1.18, 0.7);        // comms
        return g;
    },
    // Fallback: blockhouse
    _default(acc) {
        const g = new THREE.Group();
        _M(g, _box(1.8, 0.9, 1.8), _sm(LP.CONCRETE), 0, 0.45);
        _M(g, _box(1.86, 0.08, 1.86), _am(acc), 0, 0.94);
        return g;
    },
};

// Build a structure model for a type/owner. Returns { group, accents } where
// accents = per-instance materials tinted the owner color (for capture retint).
function buildStructModel(type, owner) {
    const acc = ownerHexColor(owner);
    const builder = STRUCT_MODEL_BUILDERS[type] || STRUCT_MODEL_BUILDERS._default;
    const group = builder(acc);
    group.userData.accents = [];
    group.traverse(o => {
        if (o.isMesh && o.material && o.material.userData && o.material.userData.accent) {
            group.userData.accents.push(o.material);
        }
    });
    return { group, accents: group.userData.accents };
}
`;

const out = [...lines.slice(0, startIdx), ...REPLACEMENT.split('\n'), '', ...lines.slice(endIdx)].join('\n');
writeFileSync(path, out);
console.log(`spliced: removed lines ${startIdx + 1}..${endIdx}, inserted ${REPLACEMENT.split('\n').length} lines`);
