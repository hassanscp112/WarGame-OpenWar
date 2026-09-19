// ══════════════════════════════════════════════════════════════════════
//  TASK-402 NAVY DEEP PASS — strategy-pattern hull behaviors.
//  Every hull class gets ONE behavior object; Warship.update() dispatches
//  through it instead of an if/else chain. All game-scope dependencies
//  arrive via the ctx contract (lazy getters built in main.js → NAVAL_CTX),
//  so this module imports only the shared data constants.
//
//  ctx contract (see NAVAL_CTX in main.js):
//    getters : frame, selMissile, isOnline, myRole, scene, conquestGrid,
//              conquestCtx, warships, missiles, drones, planes, structs,
//              tanks, transportShips, tradeShips, torpedoes, mineFields,
//              SFX, Missile, Plane, ConquestAttack
//    fns     : fireSAM, launchDrone, logEvent, spawnExp, haversineDist,
//              ownerName, navalSpend, sendAction, renderMode1Territory,
//              _tracer, latLonToVec3, targetLivePos, killTradeShip,
//              missileScatter, newId, buildTorpedoMesh, buildMineModel,
//              puffAt, disposeMesh, pushAttack, fleetStanceIdx,
//              sonarPingFX (TASK-502 — contact/reveal rings)
// ══════════════════════════════════════════════════════════════════════
import { PCFG, MCFG, DCFG, GAME_CONSTANTS } from '../data/constants.js';

// ── AUDIT #20: precompute "missiles aimed at our hulls" ONCE per frame ──
// The old escort check was O(escorts × missiles × warships) with a fresh
// haversine storm per escort. One shared per-frame, per-owner Set.
const _aimedCache = { frame: -1, byOwner: null };
function _aimedAtOwner(ctx, owner) {
    if (_aimedCache.frame !== ctx.frame) { _aimedCache.frame = ctx.frame; _aimedCache.byOwner = new Map(); }
    let set = _aimedCache.byOwner.get(owner);
    if (set) return set;
    set = new Set();
    for (const m of ctx.missiles) {
        if (m.dead || m.isSAM || m.owner === owner) continue;
        for (const w of ctx.warships) {
            if (w.dead || w.owner !== owner) continue;
            if (ctx.haversineDist(m.tlat, m.tlon, w.curLat, w.curLon) < 250) { set.add(m.id); break; }
        }
    }
    _aimedCache.byOwner.set(owner, set);
    return set;
}

// ══════════════════════════════════════════════════════════════════════
//  AUDIT #6 — FLEET ANTI-AIR. Gun hulls and escorts put up flak barrages
//  vs enemy planes + drones (the fleet-defence mission: before TASK-402
//  aircraft were completely immune to the navy). Nearest-threat law:
//  planes first (strike threat), then drones.
// ══════════════════════════════════════════════════════════════════════
function fleetAA(s, ctx) {
    const hull = s.hull, C = GAME_CONSTANTS;
    if (!hull.aaRange || !hull.aaCd) return;
    if (s.aaCd > 0) return;
    if ((ctx.frame + s.id) % 3 !== 0) return;
    // PLANES — nearest first (stealth shrinks the engagement envelope)
    let best = null, bestD = Infinity;
    for (const p of ctx.planes) {
        if (p.dead || p.parked || p.owner === s.owner) continue;
        let det = hull.aaRange;
        if (p.cfg && p.cfg.role === 'stealth') det = Math.min(det, C.AIR_STEALTH_DETECT * 1.5);
        else if (p.pkey === 'su57' || p.pkey === 'f22') det *= C.AIR_LOW_OBS_MULT;
        const d = ctx.haversineDist(s.curLat, s.curLon, p.lat, p.lon);
        if (d >= det || d >= bestD) continue;
        best = p; bestD = d;
    }
    if (best) { _aaBarrage(s, best, 'plane', ctx); return; }
    // DRONES — slow loiterers, flak shreds them
    best = null; bestD = Infinity;
    for (const d of ctx.drones) {
        if (d.dead || d.owner === s.owner) continue;
        const dd = ctx.haversineDist(s.curLat, s.curLon, d.lat, d.lon);
        if (dd >= hull.aaRange || dd >= bestD) continue;
        best = d; bestD = dd;
    }
    if (best) _aaBarrage(s, best, 'drone', ctx);
}
function _aaBarrage(s, tgt, kind, ctx) {
    const C = GAME_CONSTANTS;
    s.aaCd = s.hull.aaCd;
    s._ciwsSpin = 50;                                  // POLISH: mount spin-up
    s._radarSpin = Math.max(s._radarSpin || 0, 30);
    ctx._tracer(s.pos, tgt.pos, 0xffe066);             // hot-yellow flak line
    ctx.spawnExp(s.curLat, s.curLon, 1.5, '#ffe066');  // muzzle flash off the deck
    const chance = kind === 'plane'
        ? Math.max(C.FLEET_AA_CHANCE_MIN, C.FLEET_AA_CHANCE_BASE - Math.max(0, (tgt.speed || 0) - 2.5) * C.FLEET_AA_CHANCE_SPEED)
        : C.FLEET_AA_DRONE_CHANCE;
    if (Math.random() < chance) {
        if (kind === 'plane') tgt.hit(s.hull.aaDmg, s.owner);   // Plane.hit(dmg, by)
        else tgt.hit(s.hull.aaDmg);                             // Drone.hit(dmg)
        ctx.spawnExp(tgt.lat, tgt.lon, 2.5, '#ffaa44');         // flak burst on the airframe
        if (ctx.SFX && ctx.SFX.gun) ctx.SFX.gun();
    } else {
        // near miss — black puff off the wing
        ctx.spawnExp(tgt.lat + (Math.random() - 0.5) * 0.1, tgt.lon + (Math.random() - 0.5) * 0.1, 1.5, '#9aa7ad');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  ESCORT — point defense (missile interception, audit-#20 cached aimed
//  set) + ASW sonar ping (reveals submerged submarines).
// ══════════════════════════════════════════════════════════════════════
function pointDefense(s, ctx) {
    if (ctx.frame % 2 !== 0 || s.pdCd > 0) return;
    const aimed = _aimedAtOwner(ctx, s.owner);
    let trg = null, bestProg = -1;
    for (const m of ctx.missiles) {
        if (m.dead || m.owner === s.owner || m.isSAM) continue;
        if (m.cfg.type === 'stealth' || m.cfg.type === 'hyper') continue;
        if (!aimed.has(m.id)) continue;                 // ← precomputed set (audit #20)
        if (ctx.haversineDist(s.curLat, s.curLon, m.lat, m.lon) >= s.hull.pdRange) continue;
        if (m.progress > bestProg) { bestProg = m.progress; trg = m; }
    }
    if (trg) {
        ctx.fireSAM(s, trg);
        s.pdCd = s.hull.pdCd;
        s._ciwsSpin = 55;
        ctx.spawnExp(s.curLat, s.curLon, 2, '#88ffcc');
    }
}
function sonarPing(s, ctx) {
    if (!s.hull.sonarRange) return;
    if ((ctx.frame + s.id) % 20 !== 0) return;
    for (const w of ctx.warships) {
        if (w.dead || w.owner === s.owner || !w.submerged) continue;
        if (ctx.haversineDist(s.curLat, s.curLon, w.curLat, w.curLon) < s.hull.sonarRange) {
            // TASK-502 (sub sonar ring visibility): fire the ring only on a
            // FRESH contact (undetected → detected — covers both a cold boat
            // and one already flaming-datum revealed by its own torpedoes) —
            // a continuous glow would be noise. Ping ring at the escort,
            // reveal ring over the boat.
            if (!w.detected && ctx.sonarPingFX) {
                ctx.sonarPingFX(s.curLat, s.curLon, 0x66ccff, 0.8);
                ctx.sonarPingFX(w.curLat, w.curLon, 0x4da6ff, 1.6);
            }
            w._detectedT = GAME_CONSTANTS.SUB_DETECT_FRAMES;
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  CARRIER — CIWS self-defense (missiles + deck-skimming drones) and the
//  deck-based air wing. AUDIT #8: in ONLINE games only the owner's client
//  simulates the wing cycle; the mirror spawn travels as spawn_plane
//  (with shipId so the receiver bases it on the same hull).
// ══════════════════════════════════════════════════════════════════════
function ciws(s, ctx) {
    if (ctx.frame % 2 !== 0 || s.ciwsCd > 0) return;
    for (const m of ctx.missiles) {
        if (m.dead || m.owner === s.owner || m.isSAM) continue;
        if (m.cfg.type === 'stealth' || m.cfg.type === 'hyper') continue;
        if (ctx.haversineDist(s.curLat, s.curLon, m.lat, m.lon) >= s.hull.ciwsRange) continue;
        if (ctx.haversineDist(m.tlat, m.tlon, s.curLat, s.curLon) > 140) continue;  // aimed at me
        ctx.fireSAM(s, m);
        s.ciwsCd = s.hull.ciwsCd;
        s._ciwsSpin = 55;
        return;
    }
    for (const d of ctx.drones) {
        if (d.dead || d.owner === s.owner) continue;
        if (ctx.haversineDist(s.curLat, s.curLon, d.lat, d.lon) < 55) {
            d.hit(45);
            ctx.spawnExp(d.lat, d.lon, 2, '#ffcc44');
            s.ciwsCd = 55; s._ciwsSpin = 55;
            return;
        }
    }
}
function airWing(s, ctx) {
    // AUDIT #8 gate: online → the owner's client drives the cycle, the
    // receiver mirrors spawns via the network (no double-spawned wings).
    if (ctx.isOnline && s.owner !== ctx.myRole) return;
    // TASK-502 OPTIMIZE: was ctx.planes.filter(...) — a fresh array EVERY
    // frame per carrier. Allocation-free counting pass instead.
    let wingN = 0;
    for (const p of ctx.planes) if (!p.dead && p.baseStruct === s) wingN++;
    if (wingN < s.hull.airWing && s.planeCd <= 0) {
        const p = new ctx.Plane(s.curLat, s.curLon, PCFG['fighter'], s.owner, s);
        p.shipDuty = -720;                     // sit on deck ~12s before first launch
        ctx.planes.push(p);
        s.planeCd = s.hull.planeCd;
        if (s.owner === ctx.myRole && ctx.isOnline) {
            ctx.sendAction({ type: 'spawn_plane', lat: s.curLat, lon: s.curLon, ptype: 'fighter', shipId: s.id });
        }
        if (s.owner === ctx.myRole) ctx.logEvent(`🛫 ${s.name}: انضمام مقاتلة لسرب السفينة (${wingN + 1}/${s.hull.airWing})`, 'info');
    }
    for (const p of ctx.planes) {
        if (p.dead || p.baseStruct !== s) continue;
        if (p.parked) {
            if (p.shipDuty < 0) { p.shipDuty++; continue; }   // deck rest countdown
            if (p.shipDuty === 0) {
                const idx = (p.id % 4);
                p.parked = false;
                p.mode = 'patrol';
                p.tlat = s.curLat + (idx % 2 ? 0.9 : -0.9);
                p.tlon = s.curLon + (idx < 2 ? 0.9 : -0.9);
                p.shipDuty = 3600 + Math.floor(Math.random() * 1200);   // ~60-80s duty
            }
        } else {
            p.shipDuty--;
            if (p.mode === 'return') {
                if (ctx.haversineDist(p.lat, p.lon, s.curLat, s.curLon) < 250) {
                    p.parked = true;            // recovered onto the deck
                    p.shipDuty = -600;          // ~10s turnaround
                }
            } else if (p.shipDuty <= 0) {
                p.mode = 'return';              // duty over — recover
                p.shipDuty = 0;
            } else if (ctx.frame % 90 === 0) {
                const idx = (p.id % 4);         // keep the CAP over the moving carrier
                p.tlat = s.curLat + (idx % 2 ? 0.9 : -0.9);
                p.tlon = s.curLon + (idx < 2 ? 0.9 : -0.9);
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  DRONE CARRIER — tether upkeep runs on EVERY client (the swarm must
//  keep station over a sailing hull); fresh launches are owner-driven
//  online (mirrored via drone_launch, TASK-204's existing action).
// ══════════════════════════════════════════════════════════════════════
function droneBay(s, ctx) {
    // TASK-502 OPTIMIZE: was ctx.drones.filter(...) ×2 (roster + kamikaze
    // count) — fresh arrays EVERY frame per bay. One counting pass now;
    // the tether refresh writes are still paced at 1-in-30 frames.
    let bayN = 0, kamCnt = 0;
    for (const d of ctx.drones) {
        if (d.dead || d.home !== s) continue;
        bayN++;
        if (d.cfg.type === 'kamikaze') kamCnt++;
        if (ctx.frame % 30 === (s.id % 30)) { d.homeLat = s.curLat; d.homeLon = s.curLon; }
    }
    // Tether upkeep: the generic Drone patrols a FIXED homeLat/homeLon —
    // refresh so the screen keeps station over a sailing carrier.
    if (ctx.isOnline && s.owner !== ctx.myRole) return;   // AUDIT #8: owner-driven online
    if (bayN >= s.hull.swarmCap || s.droneCd > 0) return;
    const key = (bayN === 0 && kamCnt === 0) ? 'nano'
        : (kamCnt < 2 ? 'kamikaze' : (bayN % 2 ? 'swarm' : 'nano'));
    const squad = ctx.launchDrone(s.owner, key,
        { lat: s.curLat, lon: s.curLon },
        { homeLat: s.curLat, homeLon: s.curLon, engageR: GAME_CONSTANTS.DRONE_ENGAGE_RANGE_KM });
    if (squad) squad.forEach(d => { d.home = s; });   // tether to the bay (sinks with the ship)
    if (s.owner === ctx.myRole && ctx.isOnline) {
        ctx.sendAction({ type: 'drone_launch', key, lat: s.curLat, lon: s.curLon, hlat: s.curLat, hlon: s.curLon, shipId: s.id });
    }
    s.droneCd = s.hull.droneCd;
    s._bayLogN = (s._bayLogN || 0) + 1;
    if (s.owner === ctx.myRole && squad && s._bayLogN % 3 === 1) ctx.logEvent(`🛩️ ${s.name}: أطلقت ${squad.length}× ${DCFG[key].name}`, 'info');
}

// ══════════════════════════════════════════════════════════════════════
//  MISSILE CRUISER — mobile VLS. AUDIT #8: online → owner-driven + the
//  shot mirrors as a 'launch' action (style 'vls'), matching the player
//  missile-fire sync pattern exactly.
// ══════════════════════════════════════════════════════════════════════
function vls(s, ctx) {
    if (s.missileCd > 0) return;
    if (ctx.isOnline && s.owner !== ctx.myRole) return;   // AUDIT #8: owner-driven online
    let trg = null, bestD = s.hull.targetRange;
    for (const w of ctx.warships) {
        if (w.dead || w.owner === s.owner) continue;
        // TASK-402 detection model: a submerged & unlocated submarine is
        // invisible — VLS cells don't waste shots on sonar ghosts.
        if (w.hull.submerged && !w.detected) continue;
        const d = ctx.haversineDist(s.curLat, s.curLon, w.curLat, w.curLon);
        if (d < bestD) { bestD = d; trg = { lat: w.curLat, lon: w.curLon }; }
    }
    if (!trg) {
        bestD = 1400;
        for (const st of ctx.structs) {
            if (st.dead || st.owner === s.owner) continue;
            const d = ctx.haversineDist(s.curLat, s.curLon, st.lat, st.lon);
            if (d < bestD) { bestD = d; trg = { lat: st.lat, lon: st.lon }; }
        }
    }
    if (!trg) return;
    // Player cruisers mirror the R-mode selection, but never auto-fire
    // strategic warheads (nuke/ICBM stay manual-only) — cost-capped.
    const mk = s.owner === ctx.myRole
        ? ((MCFG[ctx.selMissile] && MCFG[ctx.selMissile].cost <= 600) ? ctx.selMissile : 'cruise')
        : (Math.random() < 0.5 ? 'cruise' : 'ballistic');
    const cfg = MCFG[mk];
    if (!cfg) return;
    if (!ctx.navalSpend(s.owner, cfg.cost)) return;   // can't afford → hold fire
    const sc = ctx.missileScatter(cfg);
    const tlat = trg.lat + sc.dx, tlon = trg.lon + sc.dy;
    ctx.missiles.push(new ctx.Missile(s.curLat, s.curLon, tlat, tlon, cfg, s.owner));
    if (s.owner === ctx.myRole && ctx.isOnline) {
        ctx.sendAction({ type: 'launch', lat: s.curLat, lon: s.curLon, tlat, tlon, mtype: mk, style: 'vls' });
    }
    s.missileCd = s.hull.missileReload;
    s._radarSpin = Math.max(s._radarSpin || 0, 45);
    ctx.spawnExp(s.curLat, s.curLon, 2, cfg.trl || '#ffcc66');
}

// ══════════════════════════════════════════════════════════════════════
//  SUBMARINE — passive reveal decay, sonar/heli detection, torpedo combat.
//  Detection model (TASK-402): a submerged boat is invisible to guns,
//  shells and drones until (a) an enemy ASW escort's sonar pings it,
//  (b) an enemy HELI patrols within dipping-sonar range, or (c) it fires
//  — the torpedo track is a flaming datum that reveals it for ~8s.
// ══════════════════════════════════════════════════════════════════════
function subSystems(s, ctx) {
    const C = GAME_CONSTANTS;
    if (s._revealT > 0) s._revealT--;
    if (s._detectedT > 0) s._detectedT--;
    if ((ctx.frame + s.id) % 20 === 0) {
        // enemy ASW escorts
        for (const w of ctx.warships) {
            if (w.dead || w.owner === s.owner || !w.hull.sonarRange) continue;
            if (ctx.haversineDist(s.curLat, s.curLon, w.curLat, w.curLon) < w.hull.sonarRange) {
                s._detectedT = C.SUB_DETECT_FRAMES; break;
            }
        }
        // enemy helis on dipping-sonar patrol
        if (s._detectedT <= 0) for (const p of ctx.planes) {
            if (p.dead || p.parked || p.owner === s.owner) continue;
            if (p.cfg && p.cfg.role === 'heli' &&
                ctx.haversineDist(s.curLat, s.curLon, p.lat, p.lon) < C.SONAR_HELICOPTER_KM) {
                s._detectedT = C.SUB_DETECT_FRAMES; break;
            }
        }
    }
    s.detected = !s.submerged || s._detectedT > 0 || s._revealT > 0;
    if (s.detected && s.owner === ctx.myRole && (!s._warnT || ctx.frame - s._warnT > 600)) {
        s._warnT = ctx.frame;
        ctx.logEvent(`⚠️ ${s.name}: كُشف موقعنا بالسونار — الغوص العميق!`, 'warn');
        // TASK-502: visual companion to the warning — red ring so the player
        // SEES which boat is painted (log lines scroll away fast in combat).
        if (ctx.sonarPingFX) ctx.sonarPingFX(s.curLat, s.curLon, 0xff5a4d, 1.4);
    }
}
function fireTorpedo(s, ctx) {
    const t = s.target;
    if (!t || !t.obj || t.obj.dead) return;
    // Torpedoes are anti-SHIP ordnance: hulls + sprite transports + trade.
    if (t.kind === 'struct' || t.kind === 'tank' || t.kind === 'plane' || t.kind === 'drone') return;
    // AUDIT #8: online → only the owner's client launches (network mirror).
    if (ctx.isOnline && s.owner !== ctx.myRole) return;
    ctx.torpedoes.push(new Torpedo(s.owner, s, { kind: t.kind, obj: t.obj }, ctx));
    if (s.owner === ctx.myRole && ctx.isOnline) {
        ctx.sendAction({ type: 'torpedo', lat: s.curLat, lon: s.curLon, kind: t.kind, tid: t.obj.id, sid: s.id });
    }
    s.fireCd = s.hull.torpedoCd || 170;
    s._revealT = GAME_CONSTANTS.SUB_REVEAL_FRAMES;   // flaming datum
    if (s.owner === ctx.myRole) ctx.logEvent(`🦈 ${s.name}: أطلقت طوربيد!`, 'info');
    ctx.spawnExp(s.curLat, s.curLon, 2, '#bfe8ff');  // launch splash
}

// Torpedo — surface-running wake weapon fired by submarines.
export class Torpedo {
    constructor(owner, shooter, target, ctx) {
        this.id = ctx.newId();
        this.owner = owner;
        this.lat = shooter.curLat; this.lon = shooter.curLon;
        this.target = target;                     // { kind:'warship'|'transport'|'trade', obj }
        this.speed = shooter.hull.torpedoSpeed || 1.7;   // km/frame
        this.dmg = shooter.hull.torpedoDmg || 320;
        this._radius = shooter._radius;
        this.dead = false;
        this._bubbleT = 0;
        this.mesh = ctx.buildTorpedoMesh(owner);
        this.mesh.position.copy(ctx.latLonToVec3(this.lat, this.lon, this._radius));
        ctx.scene.add(this.mesh);
    }
    update(ctx) {
        const t = this.target;
        if (!t || !t.obj || t.obj.dead) { this._fizzle(ctx); return; }
        const p = t.kind === 'warship' ? { lat: t.obj.curLat, lon: t.obj.curLon }
            : ctx.targetLivePos(t.kind, t.obj);
        const cosL = Math.max(0.2, Math.cos(this.lat * Math.PI / 180));
        const kmN = (p.lat - this.lat) * 111, kmE = (p.lon - this.lon) * 111 * cosL;
        const dist = Math.hypot(kmN, kmE);
        if (dist < Math.max(14, this.speed * 2)) { this._detonate(ctx, p); return; }
        const step = Math.min(dist, this.speed);
        this.lat += (kmN / dist) * step / 111;
        this.lon += (kmE / dist) * step / (111 * cosL);
        const tv = ctx.latLonToVec3(p.lat, p.lon, this._radius);
        this.mesh.position.copy(ctx.latLonToVec3(this.lat, this.lon, this._radius));
        this.mesh.up.copy(this.mesh.position).normalize();
        this.mesh.lookAt(tv);
        // wake bubbles
        if (++this._bubbleT % 9 === 0) ctx.puffAt(this.mesh.position, 0xdfeef5, 1.1, null, 14);
    }
    _detonate(ctx, p) {
        const t = this.target, o = t.obj;
        if (t.kind === 'warship') o.hit(this.dmg);
        else if (t.kind === 'transport') o._remove();
        else if (t.kind === 'trade') ctx.killTradeShip(o);
        ctx.spawnExp(p.lat, p.lon, 6, '#ff7744');
        const cg = ctx.conquestGrid;
        if (cg && cg.applyDevastation) cg.applyDevastation(p.lat, p.lon, 40, 0.4);
        if (this.owner === ctx.myRole) ctx.logEvent('🦈 طوربيد أصاب الهدف!', 'info');
        this._fizzle(ctx, true);
    }
    _fizzle(ctx, silent) {
        if (this.dead) return;
        this.dead = true;
        if (!silent) ctx.puffAt(this.mesh.position, 0x9fb4bd, 1.2, null, 16);
        ctx.scene.remove(this.mesh);
        if (this.mesh.userData && this.mesh.userData.accents) this.mesh.userData.accents.forEach(m => m.dispose());
    }
}

// ══════════════════════════════════════════════════════════════════════
//  TRANSPORT — beachhead landing (same flow as TransportShip._landfall:
//  seedCircle + ConquestAttack inland).
// ══════════════════════════════════════════════════════════════════════
// The landing pushes a ConquestAttack into main.js's activeAttacks array —
// reached through the ctx contract (ctx.pushAttack) to keep this module
// free of main-scope references.
function invasionFull(s, ctx) {
    if (!s.invading) return;
    const C = GAME_CONSTANTS;
    const d = ctx.haversineDist(s.curLat, s.curLon, s.invLat, s.invLon);
    if (d > Math.max(20, C.BEACHHEAD_RADIUS_KM)) {
        if (s.waypoints && s.distTraveled >= s.totalLen) s._setCourse(s.invLat, s.invLon, true);
        return;
    }
    s.invading = false;
    s.mode = 'patrol';
    const landed = s.troops;
    s.troops = 0;
    const cg = ctx.conquestGrid, cc = ctx.conquestCtx;
    if (!cg || !cc || !cg._maskReady || landed < 10) return;
    const target = cg.ownerAt(s.invLat, s.invLon);
    if (target === s.owner || target === 'water') return;
    cg.seedCircle(s.invLat, s.invLon, C.BEACHHEAD_RADIUS_KM, s.owner);
    ctx.renderMode1Territory();
    cc.addTroops(s.owner, landed);
    ctx.pushAttack(new ctx.ConquestAttack({
        grid: cg, owner: s.owner, target,
        troops: landed, srcLat: s.invLat, srcLon: s.invLon,
        dstLat: s.invLat, dstLon: s.invLon, ctx: cc,
    }));
    if (s.owner === ctx.myRole) ctx.logEvent('🚢 إنزال بحري! قواتك عسكرت على الساحل.', 'info');
}

// ══════════════════════════════════════════════════════════════════════
//  FLEET FORMATIONS (TASK-402) — line / escort-wedge stances.
//  'free'  : every hull wanders its own patrol (legacy behavior).
//  'line'  : group orders spread the fleet abreast — capitals centered,
//            screens on the flanks. Arrived hulls HOLD station (no wander).
//  'wedge' : screening hulls lead the V, capital ships ride the deep center.
//  Stance cycles on P (main.js); assignFormation runs on group move orders.
// ══════════════════════════════════════════════════════════════════════
export function assignFormation(ctx, owner, dstLat, dstLon, ships) {
    const C = GAME_CONSTANTS;
    const stance = C.FLEET_STANCES[ctx.fleetStanceIdx()] || 'free';
    const live = ships.filter(s => !s.dead);
    if (stance === 'free' || live.length < 2) {
        live.forEach(s => s.setPatrol({ lat: dstLat, lon: dstLon }));
        return stance;
    }
    // heading: fleet centroid → order point (lat-scaled flat space)
    let clat = 0, clon = 0, n = 0;
    for (const s of live) { clat += s.curLat; clon += s.curLon; n++; }
    clat /= n; clon /= n;
    const cosL = Math.max(0.2, Math.cos(clat * Math.PI / 180));
    let fLat = dstLat - clat, fLon = (dstLon - clon) * cosL;
    const len = Math.hypot(fLat, fLon) || 1;
    fLat /= len; fLon /= len;                    // forward unit vector
    const pLat = -fLon, pLon = fLat;              // perpendicular in the same scaled space
    // capitals ride center/back; escorts + gun hulls screen
    const isCap = s => s.hullClass === 'carrier' || s.hullClass === 'missile' || s.hullClass === 'drone';
    const caps = live.filter(isCap), scr = live.filter(s => !isCap(s));
    const order = stance === 'line'
        ? [...scr.slice(0, Math.ceil(scr.length / 2)), ...caps, ...scr.slice(Math.ceil(scr.length / 2))]
        : [...scr, ...caps];                     // wedge: screens at the point, caps in the deep rows
    const SP = C.FORMATION_SPACING_KM || 70;
    order.forEach((s, i) => {
        let offF = 0, offP = 0;
        if (stance === 'line') {
            offP = (i - (order.length - 1) / 2) * SP;
        } else {                                 // wedge — V opening backward from the order point
            const row = Math.ceil((i + 1) / 2), side = (i % 2 === 0) ? 1 : -1;
            offF = -row * SP * 0.8;
            offP = side * row * SP * 0.55;
        }
        const lat = Math.max(-85, Math.min(85, dstLat + (fLat * offF + pLat * offP) / 111));
        const lon = dstLon + (fLon * offF + pLon * offP) / (111 * cosL);
        s.setPatrol({ lat, lon });
    });
    return stance;
}

// ══════════════════════════════════════════════════════════════════════
//  NAVAL MINES (TASK-402) — deployable minefields (Z key, $ per field).
//  A field is a small zone of moored contact mines: after a short arming
//  delay it detonates on the first enemy HULL / invasion transport /
//  trade ship that enters the radius. Each field carries MINE_CHARGES
//  detonations and fades away after MINE_LIFE_FRAMES.
// ══════════════════════════════════════════════════════════════════════
export class NavalMineField {
    constructor(owner, loc, ctx) {
        const C = GAME_CONSTANTS;
        this.id = ctx.newId();
        this.owner = owner;
        this.lat = loc.lat; this.lon = loc.lon;
        this.charges = C.MINE_CHARGES;
        this.armT = C.MINE_ARM_FRAMES;
        this.life = C.MINE_LIFE_FRAMES;
        this.dead = false;
        this.mesh = ctx.buildMineModel(owner);
        this.mesh.position.copy(ctx.latLonToVec3(this.lat, this.lon, 0.8));
        this.mesh.up.copy(this.mesh.position.clone().normalize());
        ctx.scene.add(this.mesh);
    }
    update(ctx) {
        const C = GAME_CONSTANTS;
        if (this.armT > 0) { this.armT--; return; }
        if (--this.life <= 0) { this._expire(ctx, true); return; }
        if ((ctx.frame + this.id) % 6 !== 0) return;
        // enemy hulls — the primary kill mechanism
        for (const w of ctx.warships) {
            if (w.dead || w.owner === this.owner) continue;
            if (w.hull.submerged) continue;                    // a submerged sub slips UNDER moored mines
            if (ctx.haversineDist(this.lat, this.lon, w.curLat, w.curLon) < C.MINE_RADIUS_KM) {
                this._detonate(ctx, w);
                return;
            }
        }
        // sprite invasion transports — a minefield is a cheap invasion breaker
        for (const ts of ctx.transportShips) {
            if (ts.dead || ts.owner === this.owner) continue;
            const p = ctx.targetLivePos('transport', ts);
            if (ctx.haversineDist(this.lat, this.lon, p.lat, p.lon) < C.MINE_RADIUS_KM) {
                this._detonate(ctx, ts, true);
                return;
            }
        }
        // enemy trade shipping — economic warfare
        for (const ts of ctx.tradeShips) {
            if (ts.dead || ts.owner === this.owner) continue;
            const p = ctx.targetLivePos('trade', ts);
            if (ctx.haversineDist(this.lat, this.lon, p.lat, p.lon) < C.MINE_RADIUS_KM) {
                this._detonate(ctx, ts, false, true);
                return;
            }
        }
    }
    _detonate(ctx, obj, isTransport, isTrade) {
        const C = GAME_CONSTANTS;
        const p = isTrade || isTransport ? ctx.targetLivePos(isTrade ? 'trade' : 'transport', obj)
                                         : { lat: obj.curLat, lon: obj.curLon };
        ctx.spawnExp(p.lat, p.lon, 7, '#ff6644');
        if (ctx.SFX && ctx.SFX.exp) ctx.SFX.exp(70);
        if (isTrade) ctx.killTradeShip(obj);
        else if (isTransport) obj._remove();
        else obj.hit(C.MINE_DMG);
        if (--this.charges <= 0) { this._expire(ctx, false); return; }
        if (this.owner === ctx.myRole)
            ctx.logEvent(`💣 حقل ألغام بحري أصاب هدفاً! (${this.charges} شحنات متبقية)`, 'info');
    }
    _expire(ctx, faded) {
        if (this.dead) return;
        this.dead = true;
        if (!faded) ctx.spawnExp(this.lat, this.lon, 3, '#8899aa');
        ctx.scene.remove(this.mesh);
        ctx.disposeMesh(this.mesh);
    }
}

// Deploy one field (cost/cap checks live in the caller — main.js click path).
export function layMineField(ctx, owner, loc) {
    const f = new NavalMineField(owner, loc, ctx);
    ctx.mineFields.push(f);
    return f;
}
export function updateMineFields(ctx) {
    const arr = ctx.mineFields;
    let w = 0;
    for (let r = 0; r < arr.length; r++) {
        const f = arr[r];
        if (!f.dead) { f.update(ctx); if (!f.dead) { if (w !== r) arr[w] = f; w++; } }
    }
    arr.length = w;
}

// ══════════════════════════════════════════════════════════════════════
//  FLEET BEHAVIOR — escorts leash to the nearest capital hull; capital
//  ships (carrier/missile/drone) keep standoff from enemy gun range.
// ══════════════════════════════════════════════════════════════════════
function leashToCapital(s, ctx) {
    if (ctx.frame % 45 !== (s.id % 45)) return;
    if (s.target || s.mode === 'hold') return;
    let cap = null, bestD = Infinity;
    for (const w of ctx.warships) {
        if (w.dead || w.owner !== s.owner || w === s) continue;
        if (w.hullClass !== 'carrier' && w.hullClass !== 'missile' && w.hullClass !== 'drone') continue;
        const d = ctx.haversineDist(s.curLat, s.curLon, w.curLat, w.curLon);
        if (d < bestD) { bestD = d; cap = w; }
    }
    if (cap && bestD > GAME_CONSTANTS.ESCORT_LEASH_KM) {
        const jitter = () => (Math.random() - 0.5) * 1.2;
        s._setCourse(cap.curLat + jitter(), cap.curLon + jitter());
    }
}
function standoff(s, ctx) {
    if (ctx.frame % 45 !== (s.id % 45)) return;
    if (s.target || s.mode === 'hold') return;
    if (!s.hull.standoffKm) return;
    let threat = null, bestD = s.hull.standoffKm;
    for (const w of ctx.warships) {
        if (w.dead || w.owner === s.owner) continue;
        const d = ctx.haversineDist(s.curLat, s.curLon, w.curLat, w.curLon);
        if (d < bestD) { bestD = d; threat = w; }
    }
    if (threat) {
        const dLat = s.curLat - threat.curLat, dLon = s.curLon - threat.curLon;
        const len = Math.max(0.001, Math.hypot(dLat, dLon));
        s._setCourse(
            Math.max(-85, Math.min(85, s.curLat + (dLat / len) * 4)),
            s.curLon + (dLon / len) * 4 / Math.max(0.2, Math.cos(s.curLat * Math.PI / 180))
        );
    }
}

// ══════════════════════════════════════════════════════════════════════
//  THE STRATEGY TABLE — one entry per hull class.
//    updateSystems : per-tick subsystems (AA, PD, CIWS, VLS, bay, sub…)
//    fleetBehavior : formation/station keeping (leash / standoff)
//    fire          : optional weapon-release override (submarine torpedoes
//                    replace the shell _fire() path)
// ══════════════════════════════════════════════════════════════════════
export const NAVAL_HULLS = {
    destroyer: {
        updateSystems: fleetAA,
    },
    escort: {
        updateSystems(s, ctx) { pointDefense(s, ctx); sonarPing(s, ctx); fleetAA(s, ctx); },
        fleetBehavior: leashToCapital,
    },
    submarine: {
        updateSystems: subSystems,
        fire: fireTorpedo,
    },
    missile: {
        updateSystems(s, ctx) { vls(s, ctx); fleetAA(s, ctx); },
        fleetBehavior: standoff,
    },
    drone: {
        updateSystems(s, ctx) { droneBay(s, ctx); fleetAA(s, ctx); },
        fleetBehavior: standoff,
    },
    carrier: {
        updateSystems(s, ctx) { ciws(s, ctx); airWing(s, ctx); fleetAA(s, ctx); },
        fleetBehavior: standoff,
    },
    transport: {
        updateSystems: invasionFull,
    },
};
