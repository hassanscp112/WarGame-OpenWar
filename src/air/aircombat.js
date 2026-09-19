// ═══════════════════════════════════════════════════════════════════
//  TASK-401: AIR COMBAT MODULE (src/air/)
//  Extracted from the ~1,500-line Plane class in main.js so the air
//  doctrine is readable + testable: dogfight, strike, parked, veterancy,
//  squadrons, SEAD, tanking, VFX. Every function takes (p, W) where W is
//  the live world context bridged from main.js (AIRW) — this module never
//  imports the game directly, so it can't tangle module scope.
//
//  THREE arrives as a page global (CDN script tag) — same convention as
//  main.js. All per-frame math uses module-local scratch vectors.
// ═══════════════════════════════════════════════════════════════════

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
// parked-orbit scratch (replaces main.js _parkV1-6)
const _pv1 = new THREE.Vector3();
const _pv2 = new THREE.Vector3();
const _pv3 = new THREE.Vector3();
const _pv4 = new THREE.Vector3();
const _pv5 = new THREE.Vector3();
const _pv6 = new THREE.Vector3();

let _sqSeq = 0;   // squadron id sequence
const _wrecks = [];   // TASK-401: falling wreckage entities (capped, compacted in tickWrecks)

// Veterancy tier names (Arabic UI): Rookie / Trained / Veteran / Ace
export const AIR_VET_NAMES = ['مبتدئ', 'مدرَّب', 'محارب قديم', 'بطل جوي'];

export const AirCombat = {
    _sqSeqRef: () => _sqSeq,

    // ═══ VETERANCY ═══════════════════════════════════════════════
    // Kills → XP → levels; levels buy +% damage, −% incoming, +decoy.
    vetLevel(xp, C) {
        let lvl = 0;
        const th = C.AIR_VET_XP;
        for (let i = 1; i < th.length; i++) if (xp >= th[i]) lvl = i;
        return lvl;
    },
    vetDmgMul(p) {
        return 1 + (p.vetLevel || 0) * W_C(p).AIR_VET_DMG_PER_LVL;
    },
    // Distinguish a drone target (DCFG has patrolR) from a manned aircraft
    // (PCFG doesn't) — used for kill credit without instanceof coupling.
    killKind(t) {
        return (t && t.cfg && t.cfg.patrolR !== undefined) ? 'drone' : 'plane';
    },
    awardKill(p, kind, W) {
        if (!p || p.dead) return;
        const C = W.C;
        const xp = kind === 'plane' ? C.AIR_KILL_XP_PLANE
            : kind === 'drone' ? C.AIR_KILL_XP_DRONE
            : kind === 'tank' ? C.AIR_KILL_TANK : C.AIR_KILL_XP_STRUCT;
        p.kills++;
        p.xp += xp;
        if (kind === 'drone' && W.airStats) W.airStats.droneKills++;   // TASK-401 stat
        const nl = this.vetLevel(p.xp, C);
        if (nl > (p.vetLevel || 0)) {
            p.vetLevel = nl;
            if (p.owner === W.myRole) W.logEvent(`⭐ ${p.cfg.name} ترقّى إلى ${AIR_VET_NAMES[nl]}!`, 'info');
        }
        this.applyKillMarkers(p, W);
    },
    // White tally marks on the airframe (up to 10, both fuselage sides).
    applyKillMarkers(p, W) {
        if (!p.mesh) return;
        const old = p.mesh.getObjectByName('airKillmarks');
        if (old) {
            p.mesh.remove(old);
            old.traverse(o => { if (o.isMesh && o.material) o.material.dispose(); });
        }
        if (!p.kills) return;
        const g = new THREE.Group();
        g.name = 'airKillmarks';
        const n = Math.min(p.kills, 10);
        for (let i = 0; i < n; i++) {
            const m = new THREE.Mesh(W.killMarkGeo(), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            const sideX = i < 5 ? -1.15 : 1.15;
            m.position.set(sideX, -0.25, -0.9 + (i % 5) * 0.45);
            m.scale.set(0.08, 0.22, 0.06);
            g.add(m);
        }
        p.mesh.add(g);
    },

    // ═══ SQUADRONS ═══════════════════════════════════════════════
    // Group 3-4 planes: highest-XP leads, wingmen fly echelon formation
    // and concentrate on the leader's bandit.
    formSquadron(list, W) {
        const C = W.C;
        const all = list.filter(q => !q.dead);
        if (all.length < 2) {                     // single order → independent
            all.forEach(q => { q.squad = null; q.squadLead = null; q.squadOff = null; });
            return null;
        }
        const members = all.slice(0, C.AIR_SQ_MAX);
        const id = ++_sqSeq;
        let leader = members[0];
        for (const q of members) if ((q.xp || 0) > (leader.xp || 0)) leader = q;
        members.forEach((q, i) => {
            q.squad = id;
            q.squadIdx = i;
            if (q === leader) {
                q.squadLead = null; q.squadOff = null;
            } else {
                q.squadLead = leader;
                q.squadOff = { dl: -C.AIR_SQ_ECHELON_LAT * i, dn: C.AIR_SQ_ECHELON_LON * i };
            }
        });
        // planes beyond the squadron cap go independent (no stale squad refs)
        for (let i = C.AIR_SQ_MAX; i < all.length; i++) {
            const q = all[i];
            q.squad = null; q.squadLead = null; q.squadOff = null;
        }
        if (leader.owner === W.myRole) W.logEvent(`🎖 تشكيل سرب #${id} (${members.length} طائرات) — القائد: ${leader.cfg.name}`, 'info');
        return { id, leader, members };
    },
    // Wingman station-keeping: steer at the leader's position + echelon
    // offset. Skipped while dogfighting (combat steering wins).
    squadronSteer(p, W) {
        const lead = p.squadLead;
        if (!lead || lead.dead || lead.parked) return;
        if (!p.squadOff) return;
        if (p.airTgt && !p.airTgt.dead) return;   // engaged — fight, don't parade
        p.tlat = lead.lat + p.squadOff.dl;
        p.tlon = lead.lon + p.squadOff.dn;
    },
    // Leader died → the most experienced wingman takes over mid-air.
    leaderDown(p, W) {
        const wing = W.planes.filter(q => !q.dead && q.squadLead === p);
        if (!wing.length) return;
        let next = wing[0];
        for (const q of wing) if ((q.xp || 0) > (next.xp || 0)) next = q;
        next.squadLead = null;
        next.squadOff = null;
        for (const q of wing) if (q !== next) { q.squadLead = next; q.squadIdx = (q.squadIdx || 1); }
        if (next.owner === W.myRole) W.logEvent(`🎖 ${next.cfg.name} يتولى قيادة السرب`, 'info');
    },

    // ═══ SEAD — Suppression of Enemy Air Defenses ═══════════════
    // Anti-radiation missiles home on EMITTING radars (radar/sam/himars
    // with empT === 0). A suppressed (EMP'd) emitter stops radiating and
    // breaks the seeker lock mid-flight — first ARM blinds, follow-ons miss.
    isEmitter(s) {
        return s && !s.dead && (s.type === 'radar' || s.type === 'sam' || s.type === 'himars')
            && (s.empT || 0) <= 0;
    },
    seadAcquire(p, W) {
        const C = W.C;
        let best = null, bestD = C.AIR_SEAD_RANGE * 1.4;   // acquire wide, close in
        for (const s of W.structs) {
            if (s.owner === p.owner || !this.isEmitter(s)) continue;
            const d = W.haversineDist(p.lat, p.lon, s.lat, s.lon);
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    },
    seadStrike(p, em, W) {
        W.aamMissiles.push(new ArmShot(p, em, W));
        p.agAmmo -= 1;
        p.strikeCd = 170;
        p.overshootT = 55;
        W.airStats.strikeRuns++;
        if (p.owner === W.myRole) W.logEvent(`📡 ${p.cfg.name}: إطلاق صاروخ مضاد للإشعاع على ${em.name || em.type}`, 'info');
    },

    // ═══ AIR-TO-AIR REFUELING ════════════════════════════════════
    // Tankers (KC-135) boom-refuel; AWACS buddy-refuel at a slower rate.
    // A bingo-fuel RTB cancels once the tanks are past RESUME_PCT.
    tickRefuel(p, W) {
        const C = W.C;
        // scan staggered per plane (O(planes) every 30f, not every frame)
        if ((W.frame + p.id) % 30 === 0) {
            let best = null, bestD = C.AIR_TANKER_RANGE;
            for (const q of W.planes) {
                if (q === p || q.dead || q.parked || q.owner !== p.owner) continue;
                const r = q.cfg.role;
                if (r !== 'tanker' && r !== 'awacs') continue;
                const d = W.haversineDist(p.lat, p.lon, q.lat, q.lon);
                if (d < bestD) { bestD = d; best = q; }
            }
            p._tankerRef = best;
        }
        const tk = p._tankerRef;
        if (!tk || tk.dead || tk.parked || p.fuel >= p.maxFuel) return;
        const d = W.haversineDist(p.lat, p.lon, tk.lat, tk.lon);
        if (d >= C.AIR_TANKER_RANGE) return;
        const rate = tk.cfg.role === 'tanker' ? C.AIR_TANKER_RATE : C.AIR_AWACS_TANK_RATE;
        const before = p.fuel;
        p.fuel = Math.min(p.maxFuel, p.fuel + rate);
        const got = p.fuel - before;
        if (got > 0) {
            W.airStats.fuelTransferred += got;
            if (p.fuel > p.maxFuel * C.AIR_TANKER_RESUME_PCT && p._rtbForFuel) {
                p._rtbForFuel = false;                 // re-arm the low-fuel warn
                if (p.mode === 'return') p.mode = 'patrol';   // resume the mission
                if (p.owner === W.myRole) W.logEvent(`⛽ ${p.cfg.name}: تزوّد جوياً — استئناف المهمة`, 'info');
            }
        }
    },

    // ═══ DOGFIGHT ════════════════════════════════════════════════
    dogfightScan(p, W) {
        const C = W.C;
        p.airTgt = null;
        // AWACS + tankers never fight — they run for base on any contact
        if (p.cfg.role === 'awacs' || p.cfg.role === 'tanker') {
            for (const q of W.planes) {
                if (q.dead || q.owner === p.owner || q.parked) continue;
                if (W.haversineDist(p.lat, p.lon, q.lat, q.lon) < 250) { p.mode = 'return'; break; }
            }
            return;
        }
        if (p.aaAmmo <= 0 && p.gunAmmo <= 0) return;   // toothless
        // Squadron concentration: wingmen pile onto the leader's bandit
        const lead = p.squadLead;
        if (lead && !lead.dead && !lead.parked && lead.airTgt && !lead.airTgt.dead) {
            const q = lead.airTgt;
            const d = W.haversineDist(p.lat, p.lon, q.lat, q.lon);
            if (d < W.airDetectRange(p, q)) { p.airTgt = q; return; }
        }
        // Fighters/interceptors hunt; everything else defends only when an
        // enemy is right on top of them (bombers press on to the target).
        const aggressive = p.cfg.role === 'air' || p.cfg.role === 'intercept';
        let best = null, bestD = Infinity;
        for (const q of W.planes) {
            if (q.dead || q.owner === p.owner || q.parked) continue;
            const d = W.haversineDist(p.lat, p.lon, q.lat, q.lon);
            const dr = W.airDetectRange(p, q);
            if (d >= dr) continue;                       // stealth gate
            if (!aggressive) {
                const defensiveR = (q.airTgt === p) ? 160 : C.AIR_GUN_RANGE;
                if (d >= defensiveR) continue;
            }
            if (d < bestD) { bestD = d; best = q; }
        }
        p.airTgt = best;
        // TASK-401/403 coordination: fighters also hunt enemy DRONES — slow,
        // low-value air threats cleared with a gun burst or a cheap AAM.
        // (The missiles agent owns the ground-defense acquisition side.)
        if (!p.airTgt && (p.aaAmmo > 0 || p.gunAmmo > 0)) {
            let db = null, dbD = 240;
            for (const d of W.drones) {
                if (d.dead || d.owner === p.owner) continue;
                const dd = W.haversineDist(p.lat, p.lon, d.lat, d.lon);
                if (dd < dbD) { dbD = dd; db = d; }
            }
            p.airTgt = db;
        }
    },

    dogfightWeapons(p, W) {
        const C = W.C;
        const t = p.airTgt;
        if (!t || t.dead) return;
        const d = W.haversineDist(p.lat, p.lon, t.lat, t.lon);
        // AAM launch: within envelope, aspect allows, cooldown ready
        if (d < C.AIR_AAM_RANGE && p.aaAmmo > 0 && p.fireT <= 0) {
            if (p.cfg.allAspect || W.isBehind(p, t) || d < C.AIR_GUN_RANGE) {
                const salvo = Math.max(1, Math.min(p.cfg.aamCount || 1, p.aaAmmo));
                for (let i = 0; i < salvo; i++) W.aamMissiles.push(new W.AAM(p, t));
                p.aaAmmo -= salvo;
                p.fireT = 110;
                if (W.SFX && W.SFX.launch) W.SFX.launch('small');
                return;
            }
        }
        // Gun pass: close + aligned down the shooter's nose
        if (d < C.AIR_GUN_RANGE && p.gunAmmo > 0 && p.gunT <= 0 && p.cfg.gunCaliber > 0) {
            const fwd = _v1.copy(p.pos).sub(p.prevPos || p.pos);
            if (fwd.lengthSq() > 1e-9) {
                fwd.normalize();
                const toT = _v2.copy(t.pos).sub(p.pos).normalize();
                const align = fwd.dot(toT);
                if (align > 0.75) {
                    const burst = Math.min(35, p.gunAmmo);
                    p.gunAmmo -= burst;
                    t.hit(burst * C.AIR_GUN_BURST_DMG * p.cfg.gunCaliber * align / 10 * this.vetDmgMul(p), p.owner);
                    if (t.dead) this.awardKill(p, this.killKind(t), W);
                    W.airStats.gunBursts++;
                    W.gunTracer(p.pos, t.pos);
                    if (W.SFX && W.SFX.gun) W.SFX.gun();
                    p.gunT = 22;
                    p.overshootT = 40;   // fly through, then re-attack
                }
            }
        }
    },

    // ═══ AIR-TO-GROUND ═══════════════════════════════════════════
    // SEAD first (stand-off ARMs at emitting radars), then role runs.
    // Target scans are CACHED per 30 frames per plane (audit #22-adjacent:
    // the structs+tanks sweep was per-4-frame; now it can't run hot).
    strikeTick(p, W) {
        const C = W.C;
        // ── SEAD: armed + capable + an emitter radiating nearby ──
        if (p.cfg.sead && p.agAmmo >= 1) {
            const em = this.seadAcquire(p, W);
            if (em) {
                p.gndTgt = em;
                if (p.overshootT <= 0) { p.tlat = em.lat; p.tlon = em.lon; }
                const d = W.haversineDist(p.lat, p.lon, em.lat, em.lon);
                if (d <= C.AIR_SEAD_RANGE && p.strikeCd <= 0) this.seadStrike(p, em, W);
                return;   // committed to the Weasel pass this tick
            }
        }
        // acquire / validate (cached 30f — steering persists via tlat/tlon)
        if (!p.gndTgt || p.gndTgt.dead) {
            p.gndTgt = null;
            if (W.frame - (p._strikeScanT || 0) < 30) return;
            p._strikeScanT = W.frame;
            let best = null, bestD = 300;
            const _cas = (p.cfg.role === 'cas' || p.cfg.role === 'heli');
            for (const s of W.structs) {
                if (s.dead || s.owner === p.owner) continue;
                const d = W.haversineDist(p.tlat, p.tlon, s.lat, s.lon);
                if (d < bestD) { bestD = d; best = s; }
            }
            // TASK-302: enemy armor is a prime ground target — CAS hunts
            // divisions with a priority multiplier
            for (const t of W.tanks) {
                if (t.dead || t.owner === p.owner) continue;
                let d = W.haversineDist(p.tlat, p.tlon, t.lat, t.lon);
                if (_cas) d *= 0.55;
                if (d < bestD) { bestD = d; best = t; }
            }
            p.gndTgt = best;
            if (!best) { p.mode = 'patrol'; return; }   // nothing to strike here
        }
        const t = p.gndTgt;
        const d = W.haversineDist(p.lat, p.lon, t.lat, t.lon);
        const role = p.cfg.role;

        if (p.pkey === 'gunship') { this.gunshipOrbit(p, t, d, W); return; }

        // pass steering (gunship orbits instead — handled above)
        if (p.overshootT <= 0) { p.tlat = t.lat; p.tlon = t.lon; }

        const releaseRange = role === 'ground' ? C.AIR_STRIKE_RANGE_BOMBER
            : (role === 'cas' || role === 'heli') ? C.AIR_STRIKE_RANGE_CAS
            : C.AIR_STRIKE_RANGE_DEFAULT;
        if (d > releaseRange || p.strikeCd > 0) return;

        if (p.agAmmo >= 1) {
            if (role === 'ground') this.carpetBomb(p, t, W);
            else if (role === 'cas') this.precisionStrike(p, t, W);
            else this.lightStrike(p, t, W);
            p.agAmmo -= 1;
            p.strikeCd = 150;
            p.overshootT = 55;
            p.xp = (p.xp || 0) + C.AIR_STRIKE_XP;   // trigger-time experience
            p.vetLevel = this.vetLevel(p.xp, C);
            W.airStats.strikeRuns++;
        } else if (p.gunAmmo > 0 && p.cfg.gunCaliber > 0 && role !== 'ground') {
            this.gunStrafe(p, t, W);   // dry on ordnance → gun harassment
        } else {
            p.mode = 'return';   // Winchester → RTB to rearm
            if (p.owner === W.myRole) W.logEvent(`🔙 ${p.cfg.name}: نفد الذخيرة — عودة للتسليح`, 'info');
        }
    },

    // Bomber (Su-24): area carpet — a stick of bombs across the footprint.
    carpetBomb(p, aim, W) {
        const C = W.C;
        const mul = this.vetDmgMul(p);
        const R = 28;   // km blast footprint
        for (const s of W.structs) {
            if (s.dead || s.owner === p.owner) continue;
            if (W.haversineDist(aim.lat, aim.lon, s.lat, s.lon) < R) {
                s.hit(90 * mul);
                if (s.dead) this.awardKill(p, 'struct', W);
            }
        }
        W.tankBlast(aim.lat, aim.lon, R, 90 * mul, p.owner);   // armor under the stick
        for (let i = 0; i < 6; i++) {
            W.spawnExp(aim.lat + W.rnd(-0.2, 0.2), aim.lon + W.rnd(-0.25, 0.25), W.rnd(3, 6), '#ffaa44');
        }
        if (W.SFX && W.SFX.exp) W.SFX.exp(50);
        if (W.conquestGrid && W.conquestGrid.applyDevastation) W.conquestGrid.applyDevastation(aim.lat, aim.lon, R, 1.3);
    },

    // A-10 / heli (CAS): anti-armor precision — missiles + the gun.
    precisionStrike(p, t, W) {
        const HARD = { launcher: 1, sam: 1, himars: 1, ciws: 1, iron_dome: 1, nuke_plant: 1 };
        const mul = this.vetDmgMul(p);
        if (t.isTank) {
            t.hit(170 * mul, p.owner);
            if (t.dead) this.awardKill(p, 'tank', W);
        } else {
            t.hit((HARD[t.type] ? 190 : 120) * mul);
            if (t.dead) this.awardKill(p, 'struct', W);
        }
        W.spawnExp(t.lat, t.lon, 4, '#ffcc66');
        if (W.SFX && W.SFX.exp) W.SFX.exp(30);
        if (W.conquestGrid && W.conquestGrid.applyDevastation) W.conquestGrid.applyDevastation(t.lat, t.lon, 12, 0.7);
    },

    // Fighters / multirole: light standoff AGM pop at a single target.
    lightStrike(p, t, W) {
        const mul = this.vetDmgMul(p);
        if (t.isTank) {
            t.hit(45 * mul, p.owner);
            if (t.dead) this.awardKill(p, 'tank', W);
        } else {
            t.hit(55 * mul);
            if (t.dead) this.awardKill(p, 'struct', W);
        }
        W.spawnExp(t.lat, t.lon, 3, '#ffdd88');
        if (W.SFX && W.SFX.exp) W.SFX.exp(20);
        if (W.conquestGrid && W.conquestGrid.applyDevastation) W.conquestGrid.applyDevastation(t.lat, t.lon, 10, 0.5);
    },

    // Dry bomberless gun harassment for aircraft still packing rounds.
    gunStrafe(p, t, W) {
        const C = W.C;
        const burst = Math.min(30, p.gunAmmo);
        p.gunAmmo -= burst;
        t.hit(burst * C.AIR_GUN_BURST_DMG * p.cfg.gunCaliber / 12 * this.vetDmgMul(p));
        if (t.dead && !t.isTank) this.awardKill(p, 'struct', W);
        W.gunTracer(p.pos, t.pos);
        if (W.SFX && W.SFX.gun) W.SFX.gun();
        if (W.conquestGrid && W.conquestGrid.applyDevastation) W.conquestGrid.applyDevastation(t.lat, t.lon, 8, 0.3);
        p.strikeCd = 90;
        W.airStats.strikeRuns++;
    },

    // AC-130 gunship: sustained orbit — pulses damage around the aim point.
    gunshipOrbit(p, t, d, W) {
        const C = W.C;
        const mul = this.vetDmgMul(p);
        if (W.frame % 30 === p.id % 30) {
            const a = W.frame * 0.02 + p.id;
            p.tlat = t.lat + Math.cos(a) * 0.25;
            p.tlon = t.lon + Math.sin(a) * 0.25;
        }
        if (d > C.AIR_GUNSHIP_ORBIT + 15 || p.strikeCd > 0) return;
        if (p.agAmmo >= 0.25) {
            p.agAmmo -= 0.25;
            for (const s of W.structs) {
                if (s.dead || s.owner === p.owner) continue;
                if (W.haversineDist(t.lat, t.lon, s.lat, s.lon) < 26) {
                    s.hit(16 * mul);
                    if (s.dead) this.awardKill(p, 'struct', W);
                }
            }
            W.tankBlast(t.lat, t.lon, 26, 16 * mul, p.owner);
            W.spawnExp(t.lat + W.rnd(-0.08, 0.08), t.lon + W.rnd(-0.1, 0.1), 2.5, '#ffaa55');
            if (W.SFX && W.SFX.gun) W.SFX.gun();
            if (W.conquestGrid && W.conquestGrid.applyDevastation) W.conquestGrid.applyDevastation(t.lat, t.lon, 15, 0.4);
            W.airStats.strikeRuns++;
            p.strikeCd = 40;   // ~0.7s between pulses = sustained rain
            if (p.agAmmo < 0.25) {
                p.mode = 'return';
                if (p.owner === W.myRole) W.logEvent(`🔙 ${p.cfg.name}: نفد الذخيرة — عودة للتسليح`, 'info');
            }
        }
    },

    // ═══ PARKED (ramp) ═══════════════════════════════════════════
    // Rearm + refuel on the deck, bot auto-scramble, holding orbit.
    parkedTick(p, W) {
        const C = W.C;
        const base = p.baseStruct;
        if (!base || base.dead) { p.parked = false; return; }   // base destroyed → free patrol
        // ── rearm + refuel on the ramp ──
        if (p.fuel < p.maxFuel) p.fuel = Math.min(p.maxFuel, p.fuel + p.maxFuel / C.AIR_REARM_FUEL_FRAMES);
        if (p.fuel >= p.maxFuel * 0.9) p._rtbForFuel = false;   // re-arm the one-shot warn after topping up
        if (p.maxAa > 0) p.aaAmmo = Math.min(p.maxAa, p.aaAmmo + p.maxAa / C.AIR_REARM_AMMO_FRAMES);
        if (p.maxAg > 0) p.agAmmo = Math.min(p.maxAg, p.agAmmo + p.maxAg / C.AIR_REARM_AMMO_FRAMES);
        if (p.maxGun > 0) p.gunAmmo = Math.min(p.maxGun, p.gunAmmo + p.maxGun / C.AIR_REARM_AMMO_FRAMES);
        if (p.maxFlares > 0) p.flares = Math.min(p.maxFlares, p.flares + p.maxFlares / C.AIR_REARM_AMMO_FRAMES);
        p.rearmedFlag = p.fuel >= p.maxFuel * 0.99 && p.aaAmmo >= p.maxAa * 0.99 &&
            p.agAmmo >= p.maxAg * 0.99 && p.gunAmmo >= p.maxGun * 0.99 && p.flares >= p.maxFlares * 0.99;
        // AI air wings auto-scramble once fueled/armed (offline bots only)
        if (!W.isOnline && p.owner !== W.myRole && p.rearmedFlag && W.frame >= (p.scrambleAt || 0)) {
            p._botScramble();
            return;
        }
        // holding orbit above the ramp (scratch vectors — zero allocs).
        // TASK-401 doctrine altitudes: helis hold LOW, AWACS/tankers HIGH.
        const alt = p.cfg.alt || 50;
        const bPos = _pv1.copy(base.pos).normalize();
        const angle = (W.frame + (p.id * 100)) * 0.03;
        const right = _pv2.set(0, 1, 0).cross(bPos);
        if (right.lengthSq() < 0.01) right.set(1, 0, 0).cross(bPos);
        right.normalize();
        const up = _pv3.copy(bPos).cross(right).normalize();
        const cosA = Math.cos(angle) * 3, sinA = Math.sin(angle) * 3;
        p.pos.copy(bPos).multiplyScalar(W.EARTH_RADIUS + alt);
        p.pos.add(_pv4.copy(right).multiplyScalar(cosA));
        p.pos.add(_pv5.copy(up).multiplyScalar(sinA));
        p.mesh.position.copy(p.pos);
        p.mesh.up.copy(bPos);
        if (p.prevPos) p.prevPos.copy(p.pos); else p.prevPos = p.pos.clone();
        // ahead point for lookAt orientation
        const aheadAngle = angle + 0.1;
        const cosA2 = Math.cos(aheadAngle) * 3, sinA2 = Math.sin(aheadAngle) * 3;
        _pv6.copy(bPos).multiplyScalar(W.EARTH_RADIUS + alt);
        _pv6.add(_pv4.copy(right).multiplyScalar(cosA2));
        _pv6.add(_pv5.copy(up).multiplyScalar(sinA2));
        p.mesh.lookAt(_pv6);
        if (p.modelSrc === 'obj') p.mesh.rotateY(Math.PI / 2);
        p.mesh.visible = true;
    },

    // ═══ VFX (POLISH) ════════════════════════════════════════════
    // Afterburner on the merge, wingtip contrails when hauling the nose
    // around, black smoke when hurting. All rate-limited + particle-capped.
    vfxTick(p, W) {
        if (p.parked || p.dead || !p.mesh) return;
        const f = W.frame;
        // forward + right basis from the last move (scratch)
        const fwd = _v1.copy(p.pos).sub(p.prevPos || p.pos);
        const moving = fwd.lengthSq() > 1e-9;
        if (moving) fwd.normalize();
        // ── afterburner: engaged in a dogfight (staggered per plane) ──
        if (p.airTgt && !p.airTgt.dead && (f + p.id) % 2 === 0) {
            _v2.copy(p.pos);
            if (moving) _v2.addScaledVector(fwd, -2.4);
            W.puffAt(_v2, (f + p.id) % 4 === 0 ? 0xffaaff : 0xff8844, W.rnd(0.9, 1.5), null, 9);
            W.airStats.burnerPuffs++;
        }
        // ── wingtip contrails: hard maneuvering near the target/waypoint ──
        const dTurn = W.haversineDist(p.lat, p.lon, p.tlat, p.tlon);
        if (moving && dTurn < 250 && (f + p.id) % 3 === 0) {
            _v3.copy(p.pos).normalize();                       // radial up
            _v4.crossVectors(_v3, fwd).normalize();            // right wing
            W.puffAt(_v2.copy(p.pos).addScaledVector(_v4, 2.2), 0xffffff, 0.7, null, 14);
            W.puffAt(_v2.copy(p.pos).addScaledVector(_v4, -2.2), 0xffffff, 0.7, null, 14);
        }
        // ── damage smoke: hp < 40% ──
        if (p.hp < p.cfg.hp * 0.4 && (f + p.id) % 3 === 1) {
            _v2.copy(p.pos);
            if (moving) _v2.addScaledVector(fwd, -1.8);
            W.puffAt(_v2, (f + p.id) % 6 === 1 ? 0x141414 : 0x2a2a30, W.rnd(1.0, 1.8), null, 40);
            W.airStats.smokePuffs++;
        }
    },

    // ═══ WRECKS (POLISH: crash explosion + wreckage timer) ═══════
    // A downed aircraft sheds a tumbling, burning hulk that falls to the
    // ground (impact boom) or burns out after AIR_WRECK_LIFE frames.
    spawnWreck(p, W) {
        if (_wrecks.length >= 24) return;   // particle-budget cap
        const fwd = _v1.copy(p.pos).sub(p.prevPos || p.pos);
        if (fwd.lengthSq() < 1e-9) fwd.set(0.1, 0.2, 0.05);
        const v = fwd.clone().multiplyScalar(0.8);   // one alloc per shootdown — fine
        v.x += W.rnd(-0.3, 0.3); v.y += W.rnd(-0.05, 0.25); v.z += W.rnd(-0.3, 0.3);
        _wrecks.push(new AirWreck(p.pos, v, W));
    },
    tickWrecks(W) {
        let w = 0;
        for (let r = 0; r < _wrecks.length; r++) {
            const k = _wrecks[r];
            k.update();
            if (!k.dead) { if (w !== r) _wrecks[w] = k; w++; }
        }
        _wrecks.length = w;
    },
    clearWrecks() {
        for (const k of _wrecks) {
            k.W.scene.remove(k.mesh);
            if (k.mesh.material) k.W.recycleMat(k.mesh.material);
        }
        _wrecks.length = 0;
    },
    wreckCount: () => _wrecks.length,
};

// tiny indirection so vetDmgMul works without threading C everywhere
function W_C(p) { return p && p._airC ? p._airC : (p && p.cfg ? GAME_C_FALLBACK : { AIR_VET_DMG_PER_LVL: 0.08 }); }
const GAME_C_FALLBACK = { AIR_VET_DMG_PER_LVL: 0.08 };

// ═══════════════════════════════════════════════════════════════════
//  AIR WRECK — tumbling burning hulk of a downed aircraft. Falls under
//  gravity toward the globe, trails black smoke + fire puffs, detonates a
//  small boom on ground impact, and always burns out within AIR_WRECK_LIFE.
// ═══════════════════════════════════════════════════════════════════
export class AirWreck {
    constructor(pos, vel, W) {
        this.W = W;
        this.pos = pos.clone();
        this.vel = vel;
        this.life = W.C.AIR_WRECK_LIFE;
        this.dead = false;
        this.mesh = new THREE.Mesh(W.wreckGeo(), W.getFxMat(0x1c1c20, 1.0));
        this.mesh.position.copy(this.pos);
        this.mesh.rotation.set(W.rnd(0, 3), W.rnd(0, 3), W.rnd(0, 3));
        W.scene.add(this.mesh);
    }
    update() {
        const W = this.W;
        if (this.dead) return;
        this.life--;
        if (this.life <= 0) { this._end(); return; }
        // gravity toward the globe + drag (radial is OUTWARD — pull is negative)
        _v1.copy(this.pos).normalize();
        this.vel.addScaledVector(_v1, -0.35).multiplyScalar(0.985);
        this.pos.add(this.vel);
        // ground impact → crash explosion
        if (this.pos.length() < W.EARTH_RADIUS + 2) {
            const ll = W.vec3ToLatLon(this.pos);
            W.spawnExp(ll.lat, ll.lon, 4, '#ff9944');
            if (W.SFX && W.SFX.exp) W.SFX.exp(35);
            this._end();
            return;
        }
        this.mesh.position.copy(this.pos);
        this.mesh.rotation.x += 0.22; this.mesh.rotation.z += 0.15;
        // black smoke + engine fire
        if (this.life % 4 === 0) W.puffAt(this.pos, this.life % 8 === 0 ? 0x141414 : 0x2a2a30, W.rnd(0.8, 1.4), null, 30);
        if (this.life % 10 === 0) W.puffAt(this.pos, 0xff7733, W.rnd(0.4, 0.8), null, 6);
    }
    _end() {
        const W = this.W;
        this.dead = true;
        W.scene.remove(this.mesh);
        if (this.mesh.material) W.recycleMat(this.mesh.material);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ARM SHOT — anti-radiation missile tracer (SEAD).
//  Pursues an EMITTING structure; loses lock if the emitter goes dark
//  (EMP'd / suppressed by a preceding ARM). Flies like an AAM (reuses the
//  aamMissiles pipeline: compaction + backToMenu disposal).
// ═══════════════════════════════════════════════════════════════════
export class ArmShot {
    constructor(shooter, tgt, W) {
        const C = W.C;
        this.W = W;
        this.owner = shooter.owner;
        this.src = shooter;
        this.tgt = tgt;
        this.dead = false;
        this.pos = shooter.pos.clone();
        this.speed = C.AIR_AAM_SPEED;
        this.life = 150;
        this.willHit = Math.random() < C.AIR_SEAD_PK + AirCombat.vetDmgMul(shooter) - 1;
        this.dmg = C.AIR_SEAD_DMG * AirCombat.vetDmgMul(shooter) * (tgt.type === 'radar' ? 2 : 1);
        this.mesh = new THREE.Mesh(W.armGeo(), W.getFxMat(0xffaa66, 1.0));
        W.scene.add(this.mesh);
        W.airStats.armShots++;
    }
    update() {
        const W = this.W;
        if (this.dead) return;
        // target gone OR went dark (stopped radiating) → the seeker loses it
        if (!this.tgt || this.tgt.dead || (this.tgt.empT || 0) > 0) {
            W.puffAt(this.pos, 0x888888, 1.2, null, 12);
            this._fizzle();
            return;
        }
        this.life--;
        if (this.life <= 0) { this._fizzle(); return; }
        _v1.copy(this.tgt.pos).sub(this.pos);
        const dist = _v1.length();
        const step = this.speed;
        if (dist <= step + 3) { this._resolve(); return; }
        _v1.normalize().multiplyScalar(step);
        this.pos.add(_v1);
        this.mesh.position.copy(this.pos);
        this.mesh.up.copy(this.pos).normalize();
        _v2.copy(this.pos).add(_v1);
        this.mesh.lookAt(_v2);
        if (Math.random() < 0.5) W.createTrail(this.pos);
    }
    _resolve() {
        const W = this.W;
        const t = this.tgt;
        if (this.willHit) {
            t.hit(this.dmg, this.owner);
            W.spawnExp(t.lat, t.lon, 4, '#ffaa44');
            W.airStats.armHits++;
            if (t.dead) {
                AirCombat.awardKill(this.src, 'struct', W);
                W.airStats.seadKills++;
            } else {
                // sensor-kill: the battery survives but is blinded a while
                t.empT = Math.max(t.empT || 0, W.C.AIR_SEAD_SUPPRESS);
                W.airStats.seadSuppressions++;
                if (this.src && this.src.owner === W.myRole) W.logEvent(`📡 ${this.src.cfg.name}: أخمد إشعاع ${t.name || t.type}`, 'info');
            }
        } else {
            W.spawnExp(t.lat + W.rnd(-0.05, 0.05), t.lon + W.rnd(-0.05, 0.05), 2, '#888888');
        }
        this._fizzle();
    }
    _fizzle() {
        const W = this.W;
        this.dead = true;
        W.scene.remove(this.mesh);
        if (this.mesh.material) W.recycleMat(this.mesh.material);
    }
}
