// ═══════════════════════════════════════════════════════════════════════
//  ECONOMY CONSTANTS — TASK-301 depth + TASK-404 deep pass
//  Own file per the Phase-4 refactor plan (coordinate with TASK-407):
//  everything economy reads lives HERE and gets spread into
//  GAME_CONSTANTS by src/data/constants.js — the public API
//  (GAME_CONSTANTS.WAR_UPKEEP_* etc.) is UNCHANGED for all callers.
// ═══════════════════════════════════════════════════════════════════════

export const ECON_CONSTANTS = {
    // ── TASK-301: Economy Depth ──────────────────────────────────────
    // 1) WAR UPKEEP: standing armies above the free threshold drain gold/sec.
    //    Counts home troops + cohorts in the field. Makes booming vs fighting
    //    a real economic trade-off (armies that sit still cost money).
    WAR_UPKEEP_FREE_TROOPS: 25000,   // troops below this cost nothing
    WAR_UPKEEP_PER_K: 0.02,         // gold/sec per 1000 troops above the threshold
    // 2) BLOCKADE: enemy warship parked within this radius of YOUR port seals
    //    it — no trade ships spawn from it while blocked (READ-ONLY scan of
    //    warships[]; the navy agent owns the class).
    BLOCKADE_RADIUS_KM: 350,
    // 3) SYNERGY: adjacency bonuses between structures (shown in selection
    //    panel + income tooltip).
    SYNERGY_RANGE_KM: 420,          // max distance for a synergy link
    SYNERGY_FACTORY_CITY: 0.30,     // factory output +30% per linked city (cap 3)
    SYNERGY_PORT_CITY_INCOME: 0.05, // gold/sec per port↔city link (throughput)

    // ── TASK-404: Economy Deep Pass ──────────────────────────────────
    // 4) FUEL — resource type v1: ONE pooled strategic reserve per nation.
    //    Income = base trickle + ports (oil imports, blockaded ports give
    //    nothing) + factories (refining). Upkeep drains per ACTIVE unit
    //    (aircraft, tank divisions, drones). When the pool runs dry the
    //    world market sells fuel at a PREMIUM (auto-bought from gold —
    //    scarcity hits the treasury) and new deployments are gated.
    ECON_FUEL_START: 500,           // starting reserve
    ECON_FUEL_MAX: 1000,            // storage cap
    ECON_FUEL_INCOME_BASE: 1.0,     // /s national trickle
    ECON_FUEL_PER_PORT: 0.5,        // /s per open (non-blockaded) port
    ECON_FUEL_PER_FACTORY: 0.3,     // /s per factory
    ECON_FUEL_UPKEEP_PLANE: 0.15,   // /s per active aircraft
    ECON_FUEL_UPKEEP_TANK: 0.25,    // /s per tank division
    ECON_FUEL_UPKEEP_DRONE: 0.02,   // /s per drone
    ECON_FUEL_CRISIS_GOLD: 0.08,    // gold per fuel unit auto-bought at 0 fuel
    ECON_FUEL_COST_PLANE: 25,       // deployment fuel cost — new aircraft
    ECON_FUEL_COST_TANK: 40,        // deployment fuel cost — tank division
    ECON_FUEL_COST_DRONE: 10,       // deployment fuel cost — drone squad

    // 5) BLACK MARKET — emergency loans at interest (all sides; bots borrow
    //    when broke so a bad early war doesn't eliminate them).
    ECON_LOAN_AMOUNT: 800,          // gold up front
    ECON_LOAN_INTEREST: 1.30,       // repay amount = loan × 1.30
    ECON_LOAN_REPAY_PS: 4,          // gold/s auto-repayment while solvent
    ECON_LOAN_RESERVE: 100,         // repayment pauses below this treasury floor
    ECON_LOAN_MAX_DEBT: 2000,       // credit limit (outstanding principal)
    // 6) WAR BONDS — interest-free emergency issue, ONLY while fighting a
    //    DEFENSIVE war (enemy cohorts targeting your land / ports blockaded).
    //    Repaid automatically once the war ends.
    ECON_BOND_AMOUNT: 1200,
    ECON_BOND_MAX_PER_WAR: 2,       // issues per defensive war
    ECON_BOND_REPAY_PS: 3,          // gold/s after the war ends
    // 7) SANCTIONS — a nation at war with many others loses trade income.
    ECON_SANCTIONS_MIN_WARS: 3,     // distinct enemies before sanctions bite
    ECON_SANCTIONS_TRADE_MUL: 0.6,  // trade-ship payout multiplier when sanctioned
    // 8) INTEL — pay to reveal every rival structure for a window.
    ECON_INTEL_COST: 300,
    ECON_INTEL_SECONDS: 60,
    // 9) TRADE-LANE visualization (port→port demand arcs; raidable — enemy
    //    warships hunt the shipments that sail these lanes).
    ECON_LANE_TOP_TARGETS: 3,       // arcs drawn per own port
    ECON_LANE_REFRESH_F: 300,       // frames between lane rebuilds
    ECON_LANE_RAID_RISK_KM: 400,    // enemy warship within this of a lane = red
    // 10) TREASURY LOW — warn when gold can't cover the next Ns of upkeep.
    ECON_TREASURY_LOW_S: 10,
    ECON_TREASURY_LOW_TOAST_F: 1800, // min frames between warning toasts

    // 4) MILESTONES (TASK-301): one-time bonuses at territory/army thresholds.
    //    All sides (player + bots) earn them. `cells` uses the conquest grid
    //    in mode 1 (mode 2 falls back to owned cities × 800). Thresholds
    //    calibrated vs real growth curves (army hits ~220k by 2 min, ~450k
    //    by 10 min; cells ~22/s): regional ≈2 min, industry ≈5-6 min,
    //    superpower ≈10 min.
    ECON_MILESTONES: [
        { id:'regional',   icon:'🏙️', name:'قوة إقليمية',  cells:2500,   rewardGold:300,  incomeMul:1.00 },
        { id:'grand_army', icon:'🎖️', name:'جيش عظيم',     troops:300000,  rewardGold:250,  incomeMul:1.00 },
        { id:'industry',   icon:'🏭', name:'ثورة صناعية',  cells:5000,   rewardGold:0,    incomeMul:1.10 },
        { id:'war_econ',   icon:'⚔️', name:'اقتصاد حربي',  troops:450000, rewardGold:0,    incomeMul:1.10 },
        { id:'superpower', icon:'🌍', name:'قوة عظمى',      cells:7000,   rewardGold:1500, incomeMul:1.00 },
    ],
};
