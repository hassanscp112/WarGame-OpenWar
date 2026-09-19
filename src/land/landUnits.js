// ═══════════════════════════════════════════════════════════════════
// TASK-405: LAND WARFARE SHARED UTILITIES
//  • FormationLayout — one source of truth for formation math:
//    vehicle wedge offsets inside a division + the spread offsets used
//    when multiple divisions receive one march order. (Previously the
//    wedge math lived in the Tank constructor and the spread math in
//    the click handler — two places to drift apart.)
//  • TANK_BEHAVIORS — per-class behavior objects (navy HULL_CLASSES
//    pattern): data-driven role knobs the Tank class consults instead
//    of if(key===…) chains.
// Constants (ranges, damage numbers) live in data/constants.js so
// balance passes never touch logic files.
// ═══════════════════════════════════════════════════════════════════

export const FormationLayout = {
    // Wedge: vehicle 0 is the point, pairs trail behind alternating
    // left/right. `spacing` scales lateral separation (vehicle width
    // grows with class scale), rows drop back 3.1 units each.
    wedge(i, spacing = 2.4) {
        if (i === 0) return { x: 0, z: 0 };
        const row = Math.ceil(i / 2);
        const side = i % 2 === 0 ? -1 : 1;
        return { x: side * (spacing + row * 0.35), z: -3.1 * row };
    },
    // Column-abreast spread for N divisions sharing one march order:
    // successive divisions offset perpendicular to the advance so they
    // don't stack on one road. Returns {dLat, dLon} in degrees.
    spread(i) {
        if (i === 0) return { dLat: 0, dLon: 0 };
        const off = (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.2;
        return { dLat: off * 0.45, dLon: -off * 0.45 };
    },
    // Entrenchment ring: positions for N sandbag mounds around a division
    // of radius r (TASK-405). Slight per-mound jitter in r/angle so the
    // ring reads hand-dug, not procedural.
    sandbags(n = 12, r = 8.5) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + (i % 3) * 0.06;
            const rr = r + (i % 4) * 0.35;
            out.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr });
        }
        return out;
    },
};

// Indirect-fire (SPG) ballistic helpers — pure math, no game state.
export const IndirectFire = {
    // Quadratic-bezier control point for an artillery arc: raised above the
    // great-circle midpoint. apexUnits scales with range up to a cap so a
    // 400km shot arcs visibly higher than a 150km one.
    ctrl(from, to, apexUnits) {
        const mid = from.clone().add(to).multiplyScalar(0.5);
        const d = from.distanceTo(to);
        return mid.normalize().multiplyScalar(from.length() + Math.min(apexUnits, 30 + d * 0.16));
    },
    // Point on the arc at parameter t (0=muzzle, 1=impact) — same quadratic
    // bezier the naval shells use, so the two indirect-fire systems read as one family.
    at(from, ctrl, to, t, out) {
        const it = 1 - t;
        return out.set(
            it * it * from.x + 2 * it * t * ctrl.x + t * t * to.x,
            it * it * from.y + 2 * it * t * ctrl.y + t * t * to.y,
            it * it * from.z + 2 * it * t * ctrl.z + t * t * to.z
        );
    },
};

// Per-class behavior knobs. `indirect` classes fire arcing shells at
// SPOTTED targets only (recon drone / scout division / radar / own
// territory); `standoff` classes hold position instead of closing.
export const TANK_BEHAVIORS = {
    light: {
        role: 'scout',      // spots for artillery (sightR feeds _spotting)
        indirect: false,
        standoff: false,
        traverse: 2.6,      // rad/frame hull traverse (scouts swing fast)
        dust: 0.55,         // dust trail intensity multiplier
    },
    medium: {
        role: 'line',
        indirect: false,
        standoff: false,
        traverse: 2.1,
        dust: 1.0,
    },
    heavy: {
        role: 'break',
        indirect: false,
        standoff: false,
        traverse: 1.5,      // Tiger turret: slow, deliberate
        dust: 1.4,
    },
    spg: {
        role: 'fire',       // artillery: standoff indirect fire
        indirect: true,
        standoff: true,
        traverse: 1.0,
        dust: 0.8,
        // SPG target priority is STRUCTURES first (siege role) — handled
        // in Tank._retarget via role check.
    },
};
