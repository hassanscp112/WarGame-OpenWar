// ═══════════════════════════════════════════════════════════════════
// TASK-401: AirCombat module unit tests (Node, no browser).
// The module reads THREE as a page global — install the real three
// package from node_modules before importing, then drive the pure
// logic (veterancy, squadrons, SEAD, tanking, scans, wrecks) with a
// mocked world bridge W.
// Run:  node scripts/test_aircombat.mjs
// ═══════════════════════════════════════════════════════════════════
globalThis.THREE = await import('three');

const { GAME_CONSTANTS } = await import('../src/data/constants.js');
const { AirCombat, AirWreck, ArmShot, AIR_VET_NAMES } = await import('../src/air/aircombat.js');

const C = GAME_CONSTANTS;
const R = 6371;   // EARTH_RADIUS (main.js)
let passed = 0, failed = 0;
function ok(cond, label, extra = '') {
    if (cond) { passed++; console.log(`  ✓ ${label}`); }
    else { failed++; console.error(`  ✗ ${label} ${extra}`); }
}

// ── haversine (same formula as main.js) ──
function hav(lat1, lon1, lat2, lon2) {
    const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    for (const [lat, lon, v] of [[lat1, lon1, p1], [lat2, lon2, p2]]) {
        const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
        v.set(-(Math.sin(phi) * Math.cos(th)), Math.cos(phi), Math.sin(phi) * Math.sin(th));
    }
    return Math.acos(Math.min(1, p1.dot(p2))) * R;
}

// ── mocked world bridge ──
function makeW(over = {}) {
    return Object.assign({
        C,
        frame: 100,
        planes: [],
        structs: [],
        tanks: [],
        drones: [],
        aamMissiles: [],
        myRole: 'player',
        isOnline: true,
        scene: { add() { }, remove() { } },
        conquestGrid: null,
        EARTH_RADIUS: R,
        SFX: null,
        AAM: function () { this.dead = true; },
        airStats: { aamFired: 0, aamHits: 0, gunBursts: 0, flaresUsed: 0, planesDowned: 0, strikeRuns: 0, samAtPlanes: 0, flakHits: 0, burnerPuffs: 0, smokePuffs: 0, fuelTransferred: 0, armShots: 0, armHits: 0, seadKills: 0, seadSuppressions: 0, samLockMisses: 0, droneKills: 0 },
        logEvent() { },
        haversineDist: hav,
        rnd: (a, b) => a + Math.random() * (b - a),
        vec3ToLatLon(v) {
            return { lat: 90 - Math.acos(Math.max(-1, Math.min(1, v.y / v.length()))) * 180 / Math.PI, lon: Math.atan2(v.z, -v.x) * 180 / Math.PI - 180 };
        },
        spawnExp() { },
        airDetectRange: () => 400,
        isBehind: () => true,
        gunTracer() { },
        tankBlast() { },
        puffAt() { },
        createTrail() { },
        getFxMat: () => new THREE.MeshBasicMaterial(),
        recycleMat() { },
        armGeo: () => new THREE.CylinderGeometry(0.26, 0.26, 3.6, 5),
        killMarkGeo: () => new THREE.BoxGeometry(1, 1, 1),
        wreckGeo: () => new THREE.BoxGeometry(2.4, 0.6, 1.1),
    }, over);
}

function fakePlane(over = {}) {
    return Object.assign({
        id: 1, dead: false, parked: false, owner: 'player',
        lat: 30, lon: 30, tlat: 30, tlon: 30, mode: 'patrol',
        hp: 100, cfg: { name: 'T1', role: 'air', turnRate: .15, hp: 100, alt: 50 },
        pos: new THREE.Vector3(R + 50, 0, 0), prevPos: new THREE.Vector3(R + 49, 0, 0),
        xp: 0, kills: 0, vetLevel: 0, _airC: C,
        aaAmmo: 8, gunAmmo: 500, flares: 4,
        airTgt: null, gndTgt: null, fireT: 0, gunT: 0, strikeCd: 0, overshootT: 0,
        squad: null, squadLead: null, squadOff: null,
        mesh: null,
    }, over);
}

// ═══ 1. veterancy ═══
console.log('\n── vetLevel / awardKill ──');
ok(AirCombat.vetLevel(0, C) === 0, 'xp 0 → level 0');
ok(AirCombat.vetLevel(59, C) === 0, 'xp 59 → level 0');
ok(AirCombat.vetLevel(60, C) === 1, 'xp 60 → level 1');
ok(AirCombat.vetLevel(150, C) === 2, 'xp 150 → level 2');
ok(AirCombat.vetLevel(300, C) === 3, 'xp 300 → level 3');
ok(AirCombat.vetLevel(9999, C) === 3, 'xp 9999 → level 3 (cap)');
ok(AIR_VET_NAMES.length === 4, '4 vet tier names exported');

{
    const W = makeW();
    const p = fakePlane();
    AirCombat.awardKill(p, 'plane', W);
    ok(p.kills === 1 && p.xp === C.AIR_KILL_XP_PLANE, `plane kill → +${C.AIR_KILL_XP_PLANE} xp`, `got xp=${p.xp}`);
    ok(p.vetLevel === 1, '60 xp promotes to level 1');
    AirCombat.awardKill(p, 'drone', W);
    ok(p.xp === C.AIR_KILL_XP_PLANE + C.AIR_KILL_XP_DRONE, 'drone kill adds AIR_KILL_XP_DRONE');
    ok(W.airStats.droneKills === 1, 'droneKills stat incremented');
    const dead = fakePlane({ dead: true });
    AirCombat.awardKill(dead, 'plane', W);
    ok(dead.kills === 0, 'dead shooters earn nothing');
    ok(Math.abs(AirCombat.vetDmgMul(fakePlane({ vetLevel: 3 })) - (1 + 3 * C.AIR_VET_DMG_PER_LVL)) < 1e-9, 'vetDmgMul level 3');
}

// ═══ 2. killKind ═══
console.log('\n── killKind (drone vs plane) ──');
ok(AirCombat.killKind({ cfg: {} }) === 'plane', 'PCFG (no patrolR) → plane');
ok(AirCombat.killKind({ cfg: { patrolR: 130 } }) === 'drone', 'DCFG patrolR → drone');
ok(AirCombat.killKind({ cfg: { patrolR: 0 } }) === 'drone', 'DCFG patrolR:0 (kamikaze) → drone (0 !== undefined)');
ok(AirCombat.killKind(null) === 'plane', 'null target tolerated');

// ═══ 3. squadrons ═══
console.log('\n── formSquadron / squadronSteer / leaderDown ──');
{
    const W = makeW();
    const ps = [
        fakePlane({ id: 1, xp: 10 }),
        fakePlane({ id: 2, xp: 200 }),
        fakePlane({ id: 3, xp: 5 }),
        fakePlane({ id: 4, xp: 90 }),
        fakePlane({ id: 5, xp: 1 }),   // beyond AIR_SQ_MAX cap
    ];
    W.planes.push(...ps);   // leaderDown scans W.planes
    const sq = AirCombat.formSquadron(ps, W);
    ok(sq && sq.members.length === C.AIR_SQ_MAX, `squadron capped at ${C.AIR_SQ_MAX}`, `got ${sq && sq.members.length}`);
    ok(sq.leader === ps[1], 'highest-XP plane leads');
    ok(ps[1].squadLead === null && ps[1].squadOff === null, 'leader has no offset');
    ok(ps[0].squadLead === ps[1] && !!ps[0].squadOff, 'wingman 1 tracks leader');
    ok(ps[4].squad === null && ps[4].squadLead === null && ps[4].squadOff === null, 'overflow plane is independent');
    // station-keeping: wingman steers at leader + echelon offset
    ps[1].lat = 31; ps[1].lon = 32;
    const tlat0 = ps[0].tlat, tlon0 = ps[0].tlon;
    AirCombat.squadronSteer(ps[0], W);
    ok(ps[0].tlat !== tlat0 || ps[0].tlon !== tlon0, 'squadronSteer moves wingman target');
    // engaged wingmen keep fighting
    ps[2].airTgt = fakePlane({ owner: 'enemy' });
    AirCombat.squadronSteer(ps[2], W);
    ok(ps[2].tlat === tlat0, 'engaged wingman ignores parade steering');
    // leader dies → succession
    ps[1].dead = true;
    AirCombat.leaderDown(ps[1], W);
    const newLead = [ps[0], ps[2], ps[3]].find(q => q.squadLead === null);
    ok(newLead === ps[3], 'next-highest-XP wingman (90xp) takes command', `got id ${newLead && newLead.id}`);
    ok(ps[0].squadLead === ps[3] || ps[0].squadLead === null, 'wingmen re-pointed');
    // single plane → independent
    const lone = [fakePlane({ id: 9 })];
    ok(AirCombat.formSquadron(lone, W) === null, 'single order stays independent');
}

// ═══ 4. SEAD ═══
console.log('\n── SEAD: isEmitter / seadAcquire / ArmShot ──');
{
    const W = makeW();
    ok(AirCombat.isEmitter({ type: 'sam', dead: false, empT: 0 }) === true, 'radiating sam is an emitter');
    ok(AirCombat.isEmitter({ type: 'sam', dead: false, empT: 5 }) === false, 'EMP-suppressed battery is dark');
    ok(AirCombat.isEmitter({ type: 'city', dead: false, empT: 0 }) === false, 'city is not an emitter');
    const near = { type: 'radar', dead: false, empT: 0, owner: 'enemy', lat: 30.5, lon: 30, name: 'R1', pos: new THREE.Vector3(), hit() { } };
    W.structs.push(near);
    const weasel = fakePlane();
    ok(AirCombat.seadAcquire(weasel, W) === near, 'emitter inside acquire envelope found');
    const far = { ...near, lat: 40, lon: 30 };
    W.structs = [far];
    ok(AirCombat.seadAcquire(weasel, W) === null, 'emitter beyond 1.4×SEAD_RANGE not acquired');
    // ArmShot seeker break: target goes dark (EMP) mid-flight → fizzle, no damage
    W.structs = [near];
    const W2 = makeW();
    const em = { type: 'radar', dead: false, empT: 0, owner: 'enemy', lat: 30, lon: 30, pos: new THREE.Vector3(R + 50, 0, 0), hit(d) { this.hitTaken = (this.hitTaken || 0) + d; } };
    W2.structs.push(em);
    const shooter = fakePlane();
    const arm = new ArmShot(shooter, em, W2);
    ok(W2.airStats.armShots === 1, 'armShots stat counted');
    em.empT = 90;   // suppressed between launch and impact
    arm.update();
    ok(arm.dead === true, 'ARM loses lock when emitter goes dark');
    ok(!em.hitTaken, 'dark emitter took no damage');
}

// ═══ 5. dogfight scan ═══
console.log('\n── dogfightScan: roles + squadron concentration + drone hunt ──');
{
    const W = makeW();
    const bandit = fakePlane({ id: 10, owner: 'enemy', lat: 31.2, lon: 30 });   // ~133km: inside 400km detect, outside 60km defensive gun envelope
    W.planes.push(bandit);
    const f = fakePlane({ id: 1, cfg: { name: 'F16', role: 'air', turnRate: .15 } });
    AirCombat.dogfightScan(f, W);
    ok(f.airTgt === bandit, 'aggressive fighter acquires the bandit');
    // non-aggressive (bomber) ignores distant contact
    const b = fakePlane({ id: 2, cfg: { name: 'Su24', role: 'ground', turnRate: .07 } });
    b.airTgt = null;
    AirCombat.dogfightScan(b, W);
    ok(b.airTgt === null, 'bomber presses on (defensive-only)');
    // toothless plane doesn't scan
    const dry = fakePlane({ id: 3, aaAmmo: 0, gunAmmo: 0 });
    W.planes.push(dry);
    AirCombat.dogfightScan(dry, W);
    ok(dry.airTgt === null, 'toothless plane finds no fight');
    // AWACS flees
    const aw = fakePlane({ id: 4, cfg: { name: 'E-3', role: 'awacs' }, mode: 'patrol' });
    AirCombat.dogfightScan(aw, W);
    ok(aw.mode === 'return', 'AWACS flees contact');
    // wingman concentration: leader's bandit becomes the wingman's target
    const lead = fakePlane({ id: 5 });
    const wing = fakePlane({ id: 6, squadLead: lead });
    lead.airTgt = bandit;
    W.planes.push(lead, wing);
    AirCombat.dogfightScan(wing, W);
    ok(wing.airTgt === bandit, 'wingman piles onto the leader\u2019s bandit');
    // drone hunt: no plane target + enemy drone close
    const W3 = makeW();
    const f2 = fakePlane({ id: 7 });
    const drone = { dead: false, owner: 'enemy', lat: 30.2, lon: 30, cfg: { patrolR: 60 } };
    W3.drones.push(drone);
    AirCombat.dogfightScan(f2, W3);
    ok(f2.airTgt === drone, 'fighter hunts a nearby enemy drone');
}

// ═══ 6. air-to-air refueling ═══
console.log('\n── tickRefuel ──');
{
    const W = makeW();
    const tanker = fakePlane({ id: 2, cfg: { name: 'KC-135', role: 'tanker' }, lat: 30.1, lon: 30 });
    const p = fakePlane({ id: 1, fuel: 100, maxFuel: 900, _rtbForFuel: false });
    W.planes.push(p, tanker);
    W.frame = 29;   // (29 + 1) % 30 === 0 → scan tick runs
    AirCombat.tickRefuel(p, W);
    ok(Math.abs(p.fuel - (100 + C.AIR_TANKER_RATE)) < 1e-9, `tanker boom adds AIR_TANKER_RATE (${C.AIR_TANKER_RATE})`, `fuel=${p.fuel}`);
    ok(Math.abs(W.airStats.fuelTransferred - C.AIR_TANKER_RATE) < 1e-6, 'fuelTransferred stat tracked', `got ${W.airStats.fuelTransferred}`);
    // RTB resume past RESUME_PCT
    const p2 = fakePlane({ id: 4, fuel: 800, maxFuel: 900, mode: 'return', _rtbForFuel: true });
    W.planes = [p2, tanker];
    W.frame = 29 + 30;   // next staggered scan for id=4? (frame+id)%30: (59+4)%30=3 ✗ → pick exact
    W.frame = 26;        // (26+4)%30 = 0 ✓
    AirCombat.tickRefuel(p2, W);
    ok(p2.mode === 'patrol' && p2._rtbForFuel === false, 'tanked past RESUME_PCT resumes the mission');
    // out of envelope → no transfer
    const far = fakePlane({ id: 5, fuel: 100, maxFuel: 900 });
    const tkFar = fakePlane({ id: 6, cfg: { name: 'KC-135', role: 'tanker' }, lat: 45, lon: 30 });
    const W4 = makeW();
    W4.planes.push(far, tkFar);
    W4.frame = 25;   // (25+5)%30=0 ✓
    AirCombat.tickRefuel(far, W4);
    ok(far.fuel === 100, 'no transfer beyond AIR_TANKER_RANGE');
}

// ═══ 7. parked tick ═══
console.log('\n── parkedTick: rearm + orbit ──');
{
    const W = makeW();
    const base = { dead: false, lat: 30, lon: 30, pos: new THREE.Vector3(R, 0, 0) };
    const mesh = {
        position: new THREE.Vector3(), up: new THREE.Vector3(),
        lookAt() { }, rotateY() { }, visible: false,
    };
    const p = fakePlane({
        id: 3, parked: true, fuel: 450, maxFuel: 900,
        aaAmmo: 2, maxAa: 8, agAmmo: 1, maxAg: 10, gunAmmo: 100, maxGun: 500,
        flares: 0, maxFlares: 6, mesh, baseStruct: base, prevPos: null,
    });
    AirCombat.parkedTick(p, W);
    const dFuel = 900 / C.AIR_REARM_FUEL_FRAMES;
    ok(Math.abs(p.fuel - (450 + dFuel)) < 1e-6, 'parked rearm adds fuel each tick', `fuel=${p.fuel}`);
    ok(p.aaAmmo > 2 && p.agAmmo > 1 && p.gunAmmo > 100 && p.flares > 0, 'ammo stores replenish');
    ok(p.rearmedFlag === false, 'not fully rearmed yet');
    ok(mesh.visible === true, 'holding orbit renders the jet');
    ok(p.pos.length() > R, 'orbit positions above the surface');
    // dead base → free patrol
    base.dead = true;
    AirCombat.parkedTick(p, W);
    ok(p.parked === false, 'base destroyed → plane launches into free patrol');
}

// ═══ 8. wreck physics ═══
console.log('\n── AirWreck: falls + impact ──');
{
    const W = makeW();
    const removed = [];
    W.scene = { add() { }, remove(m) { removed.push(m); } };
    const booms = [];
    W.spawnExp = (lat, lon, r) => booms.push(r);
    const p = fakePlane({ id: 2 });
    AirCombat.spawnWreck(p, W);
    ok(AirCombat.wreckCount() === 1, 'spawnWreck registers the hulk');
    const r0 = W.EARTH_RADIUS + 50;
    let minR = Infinity, ticks = 0;
    while (AirCombat.wreckCount() > 0 && ticks < 600) {
        AirCombat.tickWrecks(W);
        ticks++;
    }
    ok(AirCombat.wreckCount() === 0, `wreck resolved within ${ticks} ticks (< AIR_WRECK_LIFE cap satisfied: ${ticks <= C.AIR_WRECK_LIFE + 2})`, `ticks=${ticks} life=${C.AIR_WRECK_LIFE}`);
    ok(booms.length > 0, 'ground impact detonates a boom');
    ok(removed.length === 1, 'wreck mesh removed from the scene');
    AirCombat.spawnWreck(p, W); AirCombat.clearWrecks();
    ok(AirCombat.wreckCount() === 0, 'clearWrecks drains the pool');
}

// ═══ summary ═══
console.log(`\n${'═'.repeat(40)}\nTASK-401 aircombat module: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
