// Splices src/main.js: replaces STRUCT_MODEL_BUILDERS with richer v2 models.
import { readFileSync, writeFileSync } from 'fs';

const path = 'src/main.js';
const lines = readFileSync(path, 'utf8').split('\n');
const START = 'const STRUCT_MODEL_BUILDERS = {';
const END = '// Build a structure model for a type/owner.';
const startIdx = lines.findIndex(l => l.startsWith(START));
const endIdx = lines.findIndex(l => l.startsWith(END));
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    console.error(`markers not found (${startIdx}, ${endIdx})`); process.exit(1);
}

const REPLACEMENT = `const STRUCT_MODEL_BUILDERS = {
    // ── CITY: platform + 6-tower skyline + antenna + parked car ──
    city(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.6, 0.14, 2.6), _sm(LP.CONCRETE), 0, 0.07);
        _M(g, _box(2.7, 0.05, 0.08), _am(acc), 0, 0.13, 1.28);          // curb line
        _M(g, _box(0.08, 0.05, 2.7), _am(acc), 1.28, 0.13, 0);
        // main cluster (6 towers, varied heights)
        _M(g, _box(0.5, 1.6, 0.5), _sm(LP.LIGHT), -0.85, 0.94, -0.55);
        _M(g, _box(0.46, 2.1, 0.46), _sm(LP.LIGHT), -0.2, 1.19, -0.35);
        _M(g, _box(0.42, 2.5, 0.42), _sm(LP.LIGHT), 0.45, 1.39, -0.6);   // tallest
        _M(g, _box(0.4, 0.9, 0.4), _sm(LP.LIGHT), 0.95, 0.59, 0.1);
        _M(g, _box(0.36, 1.2, 0.36), _sm(LP.LIGHT), -0.9, 0.74, 0.55);
        _M(g, _box(0.34, 0.7, 0.34), _sm(LP.LIGHT), -0.3, 0.49, 0.85);
        // roof caps (accent)
        _M(g, _box(0.52, 0.09, 0.52), _am(acc), -0.85, 1.79, -0.55);
        _M(g, _box(0.48, 0.09, 0.48), _am(acc), -0.2, 2.29, -0.35);
        _M(g, _box(0.44, 0.09, 0.44), _am(acc), 0.45, 2.69, -0.6);
        _M(g, _box(0.42, 0.09, 0.42), _am(acc), 0.95, 1.08, 0.1);
        _M(g, _box(0.38, 0.09, 0.38), _am(acc), -0.9, 1.34, 0.55);
        // antenna + light on tallest
        _M(g, _cyl(0.02, 0.02, 0.7, 6), _sm(LP.DARK), 0.45, 3.05, -0.6);
        _M(g, _sph(0.05, 6, 5), _am(acc), 0.45, 3.44, -0.6);
        // window strips on the tall tower (dark inset lines)
        for (let i = 0; i < 4; i++) _M(g, _box(0.47, 0.05, 0.47), _sm(LP.DARK), 0.45, 0.7 + i * 0.5, -0.6);
        // parked car
        _M(g, _box(0.28, 0.1, 0.14), _am(acc), 0.35, 0.19, 1.05);
        return g;
    },
    // ── PORT: dock + containers + crane + warehouse + bollards ──
    port(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.6, 0.16, 2.6), _sm(LP.CONCRETE), 0, 0.08);
        // warehouse
        _M(g, _box(1.0, 0.55, 0.7), _sm(LP.LIGHT), -0.65, 0.43, -0.75);
        _M(g, _box(1.06, 0.09, 0.76), _am(acc), -0.65, 0.75, -0.75);
        _M(g, _box(0.36, 0.3, 0.02), _sm(LP.DARK), -0.65, 0.31, -0.39);  // door
        // container stacks (3 rows, alternating colors)
        _M(g, _box(0.55, 0.28, 0.3), _sm(LP.DGRAY), 0.85, 0.34, -0.85);
        _M(g, _box(0.55, 0.28, 0.3), _am(acc), 0.85, 0.63, -0.85);
        _M(g, _box(0.55, 0.28, 0.3), _am(acc), 0.85, 0.34, -0.45);
        _M(g, _box(0.55, 0.28, 0.3), _sm(LP.DGRAY), 0.85, 0.63, -0.45);
        // crane (taller, jib out over the water)
        _M(g, _box(0.14, 2.0, 0.14), _sm(LP.METAL), -0.85, 1.16, 0.5);
        _M(g, _box(0.5, 0.1, 0.5), _sm(LP.DGRAY), -0.85, 0.25, 0.5);     // counterweight base
        _M(g, _box(0.35, 0.35, 0.35), _sm(LP.DGRAY), -0.85, 0.5, 0.5);
        _M(g, _box(1.5, 0.1, 0.12), _sm(LP.METAL), -0.15, 2.2, 0.5);     // jib
        _M(g, _box(0.5, 0.12, 0.13), _am(acc), -1.05, 2.2, 0.5);         // machinery house
        _M(g, _cyl(0.012, 0.012, 0.6, 6), _sm(LP.DARK), 0.35, 1.9, 0.5); // hoist
        _M(g, _box(0.2, 0.14, 0.2), _sm(LP.DGRAY), 0.35, 1.53, 0.5);     // spreader
        // bollards along the quay edge
        for (let i = -1; i <= 1; i++) _M(g, _cyl(0.045, 0.05, 0.12, 6), _sm(LP.DARK), i * 0.8, 0.19, 1.25);
        return g;
    },
    // ── FACTORY: hall + sawtooth roof + chimneys + silos + smokestack lights ──
    factory(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.2, 0.8, 1.6), _sm(LP.CONCRETE), 0.1, 0.54);
        // sawtooth roof (4 teeth)
        for (let i = 0; i < 4; i++) {
            _M(g, _box(0.46, 0.42, 1.6), _sm(LP.ROOF), -0.7 + i * 0.54, 1.12, 0, 0, 0, 0.42);
        }
        // chimney stacks with bands
        _M(g, _cyl(0.14, 0.19, 1.6, 8), _sm(LP.DGRAY), -0.9, 1.2, -0.45);
        _M(g, _cyl(0.14, 0.19, 1.15, 8), _sm(LP.DGRAY), -0.9, 0.97, 0.45);
        _M(g, _cyl(0.15, 0.15, 0.14, 8), _am(acc), -0.9, 1.87, -0.45);
        _M(g, _cyl(0.15, 0.15, 0.14, 8), _am(acc), -0.9, 1.43, 0.45);
        // silos
        _M(g, _cyl(0.22, 0.22, 0.85, 10), _sm(LP.LIGHT), 0.85, 0.57, -0.5);
        _M(g, _cyl(0.22, 0.22, 0.85, 10), _sm(LP.LIGHT), 0.85, 0.57, 0.15);
        _M(g, _cone(0.22, 0.18, 10), _am(acc), 0.85, 1.08, -0.5);
        _M(g, _cone(0.22, 0.18, 10), _am(acc), 0.85, 1.08, 0.15);
        // big door
        _M(g, _box(0.6, 0.45, 0.03), _sm(LP.DARK), -0.2, 0.37, 0.81);
        // side office
        _M(g, _box(0.5, 0.35, 0.5), _sm(LP.LIGHT), 0.85, 0.32, 0.65);
        _M(g, _box(0.54, 0.07, 0.54), _am(acc), 0.85, 0.53, 0.65);
        return g;
    },
    // ── AIRPORT: runway + terminal + tower + helipad + taxiway ──
    airport(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.8, 0.08, 0.9), _sm(LP.RUNWAY), 0, 0.1, -0.35);
        for (let i = 0; i < 6; i++) _M(g, _box(0.24, 0.02, 0.08), _sm(LP.WHITE), -1.1 + i * 0.45, 0.15, -0.35);
        _M(g, _box(0.6, 0.06, 0.28), _am(acc), 1.2, 0.13, -0.35);        // threshold marks
        // taxiway + apron
        _M(g, _box(0.9, 0.06, 0.55), _sm(LP.RUNWAY), 0, 0.09, 0.35);
        _M(g, _box(1.6, 0.07, 1.0), _sm(LP.CONCRETE), -0.1, 0.11, 0.75);
        // terminal
        _M(g, _box(1.2, 0.42, 0.55), _sm(LP.LIGHT), -0.35, 0.36, 0.85);
        _M(g, _box(1.28, 0.08, 0.62), _am(acc), -0.35, 0.61, 0.85);      // roof
        _M(g, _box(1.22, 0.2, 0.03), _sm(LP.GLASS), -0.35, 0.32, 1.13);  // glass front
        // control tower (taller, with cab + beacon)
        _M(g, _cyl(0.1, 0.14, 1.1, 8), _sm(LP.CONCRETE), 0.85, 0.72, 0.8);
        _M(g, _box(0.34, 0.22, 0.34), _sm(LP.GLASS), 0.85, 1.36, 0.8);
        _M(g, _box(0.38, 0.06, 0.38), _am(acc), 0.85, 1.5, 0.8);
        _M(g, _sph(0.05, 6, 5), _am(acc), 0.85, 1.57, 0.8);             // beacon
        // helipad
        _M(g, _cyl(0.32, 0.32, 0.04, 12), _sm(LP.RUNWAY), 0.95, 0.13, -0.55);
        _M(g, _box(0.3, 0.02, 0.08), _sm(LP.WHITE), 0.95, 0.16, -0.55);  // H mark
        _M(g, _box(0.08, 0.02, 0.3), _sm(LP.WHITE), 0.95, 0.16, -0.55);
        return g;
    },
    // ── LAUNCHER: pad + gantry + BIG rocket + deflector + fuel tanks ──
    launcher(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.5, 0.16, 2.5), _sm(LP.CONCRETE), 0, 0.08);
        _M(g, _box(0.1, 0.03, 2.5), _am(acc), 0, 0.18, 0);               // center line
        // gantry tower (lattice feel via stacked segments)
        _M(g, _box(0.18, 1.1, 0.18), _sm(LP.METAL), -0.95, 0.71, 0.45);
        _M(g, _box(0.26, 0.08, 0.26), _sm(LP.DGRAY), -0.95, 1.3, 0.45);
        _M(g, _box(0.18, 0.55, 0.18), _sm(LP.METAL), -0.95, 1.62, 0.45);
        _M(g, _box(0.26, 0.08, 0.26), _sm(LP.DGRAY), -0.95, 1.94, 0.45);
        _M(g, _box(0.16, 0.35, 0.16), _am(acc), -0.95, 2.16, 0.45);      // beacon top
        // arm to rocket
        _M(g, _box(0.6, 0.06, 0.1), _sm(LP.METAL), -0.65, 1.35, 0.45);
        _M(g, _box(0.6, 0.06, 0.1), _sm(LP.METAL), -0.65, 1.8, 0.45);
        // rocket (bigger)
        _M(g, _cyl(0.2, 0.2, 1.5, 12), _sm(LP.WHITE), 0.35, 0.98, -0.15);
        _M(g, _cone(0.2, 0.5, 12), _sm(LP.DGRAY), 0.35, 1.98, -0.15);    // nose
        _M(g, _cyl(0.205, 0.205, 0.16, 12), _am(acc), 0.35, 1.45, -0.15);
        _M(g, _cyl(0.205, 0.205, 0.16, 12), _am(acc), 0.35, 0.6, -0.15);
        for (let i = 0; i < 4; i++) {                                    // 4 fins
            const a = i * Math.PI / 2 + Math.PI / 4;
            _M(g, _box(0.05, 0.45, 0.26), _sm(LP.DGRAY),
                0.35 + Math.cos(a) * 0.24, 0.48, -0.15 + Math.sin(a) * 0.24, 0, -a, 0);
        }
        // fuel tanks
        _M(g, _cyl(0.18, 0.18, 0.5, 10), _sm(LP.WHITE), 0.9, 0.41, 0.85);
        _M(g, _cyl(0.18, 0.18, 0.5, 10), _sm(LP.WHITE), 0.5, 0.41, 0.95);
        _M(g, _halfSph(0.18), _am(acc), 0.9, 0.66, 0.85);
        _M(g, _halfSph(0.18), _am(acc), 0.5, 0.66, 0.95);
        return g;
    },
    // ── SAM: platform + rack + 4 missiles + radar dish + power unit ──
    sam(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.1, 0.18, 1.6), _sm(LP.METAL), 0, 0.09);
        _M(g, _cyl(0.24, 0.32, 0.24, 10), _sm(LP.DGRAY), 0, 0.3);
        // outriggers
        for (const sx of [-0.85, 0.85]) _M(g, _box(0.4, 0.1, 0.24), _sm(LP.DGRAY), sx, 0.13, 0.55);
        const rail = new THREE.Group();
        rail.position.set(0, 0.44, 0);
        rail.rotation.x = -0.55;
        rail.name = 'rail';
        g.add(rail);
        _M(rail, _box(1.6, 0.14, 0.66), _sm(LP.DGRAY), 0, 0.32);
        _M(rail, _box(1.6, 0.05, 0.7), _am(acc), 0, 0.41);
        for (let i = -1.5; i <= 1.5; i++) {
            _M(rail, _cyl(0.055, 0.055, 1.1, 8), _sm(LP.WHITE), 0, 0.5, i * 0.17, Math.PI / 2);
            _M(rail, _cone(0.055, 0.2, 8), _sm(LP.DGRAY), 0.65, 0.5, i * 0.17, 0, 0, -Math.PI / 2);
        }
        // small tracking radar at the back
        _M(g, _cyl(0.03, 0.03, 0.4, 6), _sm(LP.METAL), -0.75, 0.5, -0.45);
        _M(g, _box(0.16, 0.2, 0.03), _am(acc), -0.75, 0.75, -0.45, 0.5);
        // power unit
        _M(g, _box(0.4, 0.3, 0.3), _sm(LP.DGRAY), 0.8, 0.33, -0.5);
        return g;
    },
    // ── RADAR: base + guyed mast + BIG rotating dish + equipment hut ──
    radar(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.6, 0.72, 0.22, 12), _sm(LP.CONCRETE), 0, 0.11);
        _M(g, _cyl(0.73, 0.73, 0.04, 12), _am(acc), 0, 0.24);            // ring
        _M(g, _box(0.14, 1.3, 0.14), _sm(LP.METAL), 0, 0.87);
        // guy wires (thin cylinders)
        for (let i = 0; i < 3; i++) {
            const a = i * (Math.PI * 2 / 3);
            _M(g, _cyl(0.012, 0.012, 1.1, 4), _sm(LP.DARK),
                Math.cos(a) * 0.3, 0.85, Math.sin(a) * 0.3, 0.35 * Math.sin(a), 0, 0.35 * Math.cos(a) * -1);
        }
        _M(g, _box(0.22, 0.09, 0.22), _am(acc), 0, 0.56);
        // rotating dish (bigger)
        const dish = new THREE.Group();
        dish.position.set(0, 1.6, 0);
        dish.rotation.x = -0.6;
        dish.name = 'dish';
        g.add(dish);
        const dishCone = new THREE.Mesh(
            _g('dishcone2', () => new THREE.CylinderGeometry(0.07, 0.72, 0.38, 14, 1, true)),
            (() => { const m = new THREE.MeshPhongMaterial({ color: LP.LIGHT, flatShading: true, side: THREE.DoubleSide }); m.userData = m.userData || {}; m.userData.accent = true; return m; })()
        );
        dish.add(dishCone);
        _M(dish, _cyl(0.018, 0.018, 0.55, 6), _sm(LP.DARK), 0, 0.12);
        _M(dish, _box(0.08, 0.08, 0.08), _am(acc), 0, 0.4);
        // equipment hut
        _M(g, _box(0.55, 0.4, 0.45), _sm(LP.LIGHT), 0.8, 0.42, 0.55);
        _M(g, _box(0.59, 0.07, 0.49), _am(acc), 0.8, 0.66, 0.55);
        return g;
    },
    // ── FLAK: sandbag ring + mount + twin barrels + ammo crates + radar ──
    flak(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.68, 0.78, 0.2, 12), _sm(LP.EARTH), 0, 0.1);         // sandbag ring
        _M(g, _cyl(0.69, 0.69, 0.05, 12), _am(acc), 0, 0.22);
        _M(g, _cyl(0.6, 0.6, 0.06, 12), _sm(LP.CONCRETE), 0, 0.23);      // inner pad
        _M(g, _box(0.36, 0.26, 0.36), _sm(LP.DGRAY), 0, 0.38);
        // gunner seat
        _M(g, _box(0.16, 0.2, 0.05), _sm(LP.DARK), -0.2, 0.5, 0.28, -0.3);
        const barrels = new THREE.Group();
        barrels.position.set(0, 0.5, 0);
        barrels.rotation.x = -0.7;
        barrels.name = 'barrels';
        g.add(barrels);
        _M(barrels, _cyl(0.05, 0.05, 1.15, 8), _sm(LP.METAL), 0, 0, -0.1, Math.PI / 2);
        _M(barrels, _cyl(0.05, 0.05, 1.15, 8), _sm(LP.METAL), 0, 0, 0.1, Math.PI / 2);
        _M(barrels, _box(0.13, 0.13, 0.18), _am(acc), 0.55, 0, -0.1);    // muzzle brakes
        _M(barrels, _box(0.13, 0.13, 0.18), _am(acc), 0.55, 0, 0.1);
        _M(barrels, _box(0.16, 0.16, 0.3), _sm(LP.DGRAY), 0, 0, 0);      // breech
        // ammo crates + drum
        _M(g, _box(0.22, 0.16, 0.16), _sm(LP.LIGHT), 0.55, 0.32, 0.45, 0.3);
        _M(g, _cyl(0.14, 0.14, 0.22, 8), _sm(LP.DGRAY), -0.5, 0.35, 0.4);
        // small ranging radar
        _M(g, _cyl(0.02, 0.02, 0.3, 6), _sm(LP.METAL), -0.55, 0.44, -0.5);
        _M(g, _box(0.14, 0.18, 0.03), _am(acc), -0.55, 0.63, -0.5, 0.4);
        return g;
    },
    // ── HIMARS: 6-wheel truck + armored cab + big pod + spare rounds ──
    himars(acc) {
        const g = new THREE.Group();
        for (const wx of [-0.75, -0.2, 0.45]) {
            _M(g, _cyl(0.19, 0.19, 0.14, 10), _sm(LP.TIRE), wx, 0.19, -0.52, 0, 0, Math.PI / 2);
            _M(g, _cyl(0.19, 0.19, 0.14, 10), _sm(LP.TIRE), wx, 0.19, 0.52, 0, 0, Math.PI / 2);
            _M(g, _cyl(0.08, 0.08, 0.15, 8), _sm(LP.METAL), wx, 0.19, -0.52, 0, 0, Math.PI / 2); // hubs
            _M(g, _cyl(0.08, 0.08, 0.15, 8), _sm(LP.METAL), wx, 0.19, 0.52, 0, 0, Math.PI / 2);
        }
        _M(g, _box(2.1, 0.18, 1.0), _sm(LP.DGRAY), -0.05, 0.4);          // chassis
        _M(g, _box(0.62, 0.55, 0.95), _sm(LP.METAL), 0.68, 0.7);         // armored cab
        _M(g, _box(0.5, 0.22, 0.85), _sm(LP.GLASS), 0.82, 0.76);
        _M(g, _box(0.64, 0.08, 0.99), _am(acc), 0.68, 1.01, 0);          // cab roof
        // big rocket pod
        const pod = new THREE.Group();
        pod.position.set(-0.42, 0.68, 0);
        pod.rotation.x = -0.12;
        g.add(pod);
        _M(pod, _box(1.15, 0.46, 0.7), _sm(LP.METAL), 0, 0.22);
        _M(pod, _box(1.15, 0.08, 0.74), _am(acc), 0, 0.49);
        for (let i = -1.5; i <= 1.5; i++) {
            _M(pod, _cyl(0.055, 0.055, 0.18, 8), _sm(LP.WHITE), 0.6, 0.25, i * 0.2, Math.PI / 2);
            _M(pod, _cyl(0.055, 0.055, 0.18, 8), _sm(LP.DGRAY), -0.6, 0.25, i * 0.2, Math.PI / 2);
        }
        // spare rounds in racks behind cab
        _M(g, _box(0.5, 0.12, 0.9), _sm(LP.DGRAY), 0.15, 0.55, 0);
        _M(g, _cyl(0.05, 0.05, 0.5, 8), _sm(LP.WHITE), 0.15, 0.63, -0.25, Math.PI / 2);
        _M(g, _cyl(0.05, 0.05, 0.5, 8), _sm(LP.WHITE), 0.15, 0.63, 0.25, Math.PI / 2);
        return g;
    },
    // ── CIWS: drum + dome + 6-barrel gatling + radar + missile box ──
    ciws(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.6, 0.7, 0.3, 12), _sm(LP.METAL), 0, 0.15);
        _M(g, _halfSph(0.5), _sm(LP.WHITE), 0, 0.3);
        _M(g, _cyl(0.51, 0.51, 0.05, 12), _am(acc), 0, 0.33);
        // gatling cluster
        const barrels = new THREE.Group();
        barrels.position.set(0.48, 0.46, 0);
        barrels.rotation.x = -0.35;
        barrels.name = 'barrels';
        g.add(barrels);
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            _M(barrels, _cyl(0.028, 0.028, 0.85, 6), _sm(LP.DARK), Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09, Math.PI / 2);
        }
        _M(barrels, _cyl(0.055, 0.055, 0.9, 6), _sm(LP.METAL), 0, 0, 0, Math.PI / 2);
        _M(barrels, _cyl(0.12, 0.12, 0.22, 8), _sm(LP.DGRAY), -0.42, 0, 0, Math.PI / 2); // breech
        // radar dome on the back
        _M(g, _cyl(0.03, 0.03, 0.35, 6), _sm(LP.METAL), -0.5, 0.68, -0.35);
        _M(g, _sph(0.13, 8, 6), _am(acc), -0.5, 0.9, -0.35);
        // missile box beside the dome
        _M(g, _box(0.5, 0.3, 0.4), _sm(LP.DGRAY), 0.15, 0.5, -0.55, 0.2);
        _M(g, _box(0.5, 0.06, 0.42), _am(acc), 0.15, 0.68, -0.55, 0.2);
        return g;
    },
    // ── IRON DOME: dome + big tilted launcher + interceptors + radar ──
    iron_dome(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.1, 0.16, 1.6), _sm(LP.CONCRETE), 0, 0.08);
        _M(g, _halfSph(0.55), _sm(LP.DGRAY), -0.45, 0.16);
        _M(g, _cyl(0.56, 0.56, 0.05, 12), _am(acc), -0.45, 0.19);
        // big tilted launcher box
        const box = new THREE.Group();
        box.position.set(0.45, 0.32, 0);
        box.rotation.x = -0.5;
        g.add(box);
        _M(box, _box(1.1, 0.36, 0.7), _sm(LP.METAL), 0, 0.18);
        _M(box, _box(1.1, 0.06, 0.74), _am(acc), 0, 0.42);
        for (let i = -1; i <= 1; i++) {
            _M(box, _cyl(0.065, 0.065, 0.62, 8), _sm(LP.WHITE), 0, 0.4, i * 0.19);
            _M(box, _cone(0.065, 0.22, 8), _sm(LP.DGRAY), 0, 0.81, i * 0.19);
        }
        // radar mast
        _M(g, _cyl(0.025, 0.025, 0.55, 6), _sm(LP.METAL), -0.9, 0.52, 0.6);
        _M(g, _box(0.2, 0.26, 0.03), _am(acc), -0.9, 0.88, 0.6, 0.45);
        return g;
    },
    // ── NUKE PLANT: cooling towers + reactor + turbine hall + fence ──
    nuke_plant(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.6, 0.14, 2.1), _sm(LP.CONCRETE), 0, 0.07);
        // cooling towers (taller, with rim)
        _M(g, _cyl(0.32, 0.5, 1.45, 12), _sm(LP.LIGHT), -0.7, 0.86, -0.35);
        _M(g, _cyl(0.33, 0.33, 0.09, 12), _am(acc), -0.7, 1.56, -0.35);
        _M(g, _cyl(0.32, 0.5, 1.45, 12), _sm(LP.LIGHT), 0.65, 0.86, -0.35);
        _M(g, _cyl(0.33, 0.33, 0.09, 12), _am(acc), 0.65, 1.56, -0.35);
        // reactor dome (bigger) + vents
        _M(g, _halfSph(0.45), _sm(LP.WHITE), 0, 0.14, 0.6);
        _M(g, _cyl(0.46, 0.46, 0.05, 12), _am(acc), 0, 0.17, 0.6);
        _M(g, _cyl(0.022, 0.022, 0.5, 6), _sm(LP.DARK), 0.2, 0.63, 0.75);
        _M(g, _cyl(0.022, 0.022, 0.5, 6), _sm(LP.DARK), -0.2, 0.63, 0.75);
        // turbine hall
        _M(g, _box(1.3, 0.4, 0.55), _sm(LP.LIGHT), 0, 0.34, 1.15);
        _M(g, _box(1.36, 0.08, 0.61), _am(acc), 0, 0.58, 1.15);
        // transformer yard blocks
        _M(g, _box(0.3, 0.25, 0.25), _sm(LP.DGRAY), -0.95, 0.27, 0.75);
        _M(g, _box(0.3, 0.25, 0.25), _sm(LP.DGRAY), -0.6, 0.27, 0.85);
        return g;
    },
    // ── HQ BASE: command building + comms array + FLAG + wall + gate ──
    base(acc) {
        const g = new THREE.Group();
        _M(g, _box(2.5, 0.18, 2.5), _sm(LP.CONCRETE), 0, 0.09);
        // perimeter walls with gate gap
        _M(g, _box(2.5, 0.3, 0.1), _sm(LP.CONCRETE), 0, 0.3, 1.2);
        _M(g, _box(2.5, 0.3, 0.1), _sm(LP.CONCRETE), 0, 0.3, -1.2);
        _M(g, _box(0.1, 0.3, 2.5), _sm(LP.CONCRETE), -1.2, 0.3, 0);
        _M(g, _box(0.1, 0.3, 0.95), _sm(LP.CONCRETE), 1.2, 0.3, -0.75);  // gate side
        _M(g, _box(0.1, 0.3, 0.95), _sm(LP.CONCRETE), 1.2, 0.3, 0.75);
        _M(g, _box(0.12, 0.34, 0.12), _am(acc), 1.2, 0.35, -0.25);       // gate posts
        _M(g, _box(0.12, 0.34, 0.12), _am(acc), 1.2, 0.35, 0.25);
        // command building
        _M(g, _box(1.2, 0.6, 0.9), _sm(LP.LIGHT), -0.1, 0.48, -0.25);
        _M(g, _box(1.28, 0.09, 0.98), _am(acc), -0.1, 0.83, -0.25);
        _M(g, _box(1.22, 0.24, 0.04), _sm(LP.GLASS), -0.1, 0.44, 0.22);  // glass front
        _M(g, _box(0.45, 0.34, 0.45), _sm(LP.LIGHT), -0.85, 0.35, 0.6);  // annex
        _M(g, _box(0.5, 0.07, 0.5), _am(acc), -0.85, 0.56, 0.6);
        // comms array
        _M(g, _cyl(0.035, 0.035, 1.7, 6), _sm(LP.METAL), -1.0, 1.03, -0.9);
        _M(g, _sph(0.1, 8, 6), _sm(LP.GLASS), -1.0, 1.93, -0.9);
        _M(g, _box(0.18, 0.24, 0.03), _am(acc), -0.82, 1.5, -0.9, 0.3);
        // FLAG (big, on a mast)
        _M(g, _cyl(0.035, 0.035, 1.9, 6), _sm(LP.METAL), 0.95, 1.13, -0.85);
        _M(g, _box(0.72, 0.44, 0.03), _am(acc), 1.32, 1.85, -0.85);      // FLAG
        _M(g, _sph(0.05, 6, 5), _am(acc), 0.95, 2.12, -0.85);            // finial
        return g;
    },
    // Fallback: blockhouse
    _default(acc) {
        const g = new THREE.Group();
        _M(g, _box(1.9, 0.95, 1.9), _sm(LP.CONCRETE), 0, 0.47);
        _M(g, _box(1.98, 0.1, 1.98), _am(acc), 0, 1.0);
        return g;
    },
};
`;

const out = [...lines.slice(0, startIdx), ...REPLACEMENT.split('\n'), ...lines.slice(endIdx)].join('\n');
writeFileSync(path, out);
console.log(`spliced builders: removed ${startIdx + 1}..${endIdx}, inserted ${REPLACEMENT.split('\n').length} lines`);
