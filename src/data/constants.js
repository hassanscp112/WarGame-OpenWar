export const MCFG={
 /* SCUD-B: صاروخ باليستي سوفيتي بطيء بدقة ضعيفة جداً - حقيقي */
 scud:       {name:'سكود SCUD-B',      cost:90,  spd:3.8, acc:.06, grav:.10, drag:.002, dmg:70,  rad:80,  col:'#88ff44',trl:'#ccff99',arc:340,type:'ballistic',
               samEvade:.05, civsEvade:.03, piercing:false, spinTrail:true},
 /* SRBM: أسرع وأدق من السكود بمسار باليستي عالٍ */
 ballistic:  {name:'باليستي SRBM',     cost:130, spd:5.5, acc:.14, grav:.075,drag:.001, dmg:95,  rad:82,  col:'#4488ff',trl:'#aaccff',arc:420,type:'ballistic',
               samEvade:.12, civsEvade:.05, piercing:false, spinTrail:false},
 /* BGM-109C: طيران منخفض بطيء لكن دقيق - يتحاشى الرادار */
 cruise:     {name:'كروز BGM-109C',    cost:190, spd:4.8, acc:.35, grav:.015,drag:.004, dmg:90,  rad:60,  col:'#ff9900',trl:'#ffcc77',arc:45, type:'cruise',
               samEvade:.28, civsEvade:.22, piercing:false, hugsGround:true},
 /* CBU-97: انتشار عنقودي واسع - دقة منخفضة لكن تغطية كبيرة */
 cluster:    {name:'عنقودي CBU-97',    cost:240, spd:5.2, acc:.15, grav:.065,drag:.002, dmg:45,  rad:200, col:'#ffaa00',trl:'#ffdd88',arc:280,type:'cluster',
               samEvade:.08, civsEvade:.04, piercing:false, scatterCount:10},
 /* EMP AGM-84H: يشل الإلكترونيات - لا يدمر مادياً */
 emp:        {name:'EMP AGM-86B',      cost:300, spd:4.5, acc:.25, grav:.025,drag:.003, dmg:8,   rad:260, col:'#00ffcc',trl:'#99ffee',arc:180,type:'emp',
               samEvade:.20, civsEvade:.18, piercing:false, empRadius:320},
 /* BGM-109A Tomahawk: أكثر دقة وأسرع من الكروز العادي */
 tomahawk:   {name:'توماهوك BGM-109A', cost:350, spd:5.8, acc:.40, grav:.012,drag:.0045,dmg:120, rad:65,  col:'#00ddff',trl:'#88eeff',arc:38, type:'cruise',
               samEvade:.35, civsEvade:.30, piercing:false, hugsGround:true},
 /* FAE/Thermobaric: بطيء لكن انفجار هائل بموجة ضغط */
 thermobaric:{name:'ثيرموباريك TOS-1', cost:420, spd:3.5, acc:.12, grav:.085,drag:.0012,dmg:240, rad:185, col:'#ff2200',trl:'#ff8866',arc:320,type:'thermobaric',
               samEvade:.04, civsEvade:.03, piercing:false, pressureWave:true},
 /* JASSM-ER: شبحي يراوغ الدفاعات - طيران منخفض */
 stealth_m:  {name:'شبحي JASSM-ER',   cost:480, spd:5.5, acc:.38, grav:.016,drag:.003, dmg:160, rad:65,  col:'#445566',trl:'#556677',arc:48, type:'stealth',
               samEvade:.62, civsEvade:.55, piercing:false, hugsGround:true, stealthRCS:true},
 /* GBU-28: خارق للتحصينات سريع وثقيل */
 bunker_bust:{name:'خارق GBU-28',      cost:560, spd:9.5, acc:.42, grav:.04, drag:.002, dmg:380, rad:48,  col:'#cc4400',trl:'#ff9955',arc:260,type:'ballistic',
               samEvade:.15, civsEvade:.08, piercing:true, pierceDmg:2.2},
 /* Zircon/HGV: فرط صوتي حقيقي - سرعة هائلة لا يمكن اعتراضه */
 hyper:      {name:'فرط صوتي 3M22',    cost:650, spd:22,  acc:.55, grav:.005,drag:.00015,dmg:200,rad:110, col:'#ff22aa',trl:'#ff99ee',arc:200,type:'hyper',
               samEvade:.88, civsEvade:.82, piercing:true, plasmaSheath:true, shockwave:true},
 /* ICBM R-36: عابر قاري ضخم - مسار بالستي عالٍ جداً */
 icbm:       {name:'ICBM R-36M',       cost:1000,spd:12,  acc:.32, grav:.05, drag:.0003,dmg:500, rad:260, col:'#ff8800',trl:'#ffcc88',arc:650,type:'ballistic',
               samEvade:.55, civsEvade:.45, piercing:false, mirv:false, reentryFlash:true},
 /* نووي تكتيكي W80: تدمير شامل + EMP */
 nuke_tac:   {name:'نووي تكتيكي W80',  cost:2000,spd:5.5, acc:.15, grav:.032,drag:.001, dmg:700, rad:360, col:'#ffffff',trl:'#aaffaa',arc:440,type:'nuke',
               samEvade:.72, civsEvade:.65, piercing:true, empRadius:500, nuclearBlast:true},
};

export const MTAGS={
 scud:       ['دقة ضعيفة جداً 1-3كم','مسار باليستي','رخيص وسريع الإطلاق','راداره بسهولة يكشفه'],
 ballistic:  ['دقة متوسطة 50م','مسار عالٍ يصعب اعتراضه','ضرر انفجار متوسط','أسرع من السكود'],
 cruise:     ['دقة عالية 10م','يحلق على 50م من الأرض','يراوغ الرادار','يتحاشى 28% من SAM'],
 cluster:    ['تغطية 200م واسعة','10 قنابل فرعية','فعّال ضد المناطق','دقة منخفضة'],
 emp:        ['يشل الإلكترونيات 350م','لا ضرر مادي تقريباً','يعطل SAM والرادار','يجمّد الطائرات'],
 tomahawk:   ['أدق كروز 10م','مسار منخفض جداً 35م','30% يراوغ SAM','دقيق جداً'],
 thermobaric:['موجة ضغط 185م','يضرب بالتساوي','فعّال داخل المباني','لا ضرر مدرع'],
 stealth_m:  ['RCS منخفض جداً','62% يراوغ SAM','مسار 35م من الأرض','صعب الاكتشاف'],
 bunker_bust:['يخترق 6م من الباطون','ضرر مضاعف ×2.2','سرعة عالية 9.5','حجم اختراق صغير'],
 hyper:      ['22 وحدة سرعة Mach 6+','88% يراوغ كل الدفاعات','بلازما + موجة صدمة','مستحيل الاعتراض'],
 icbm:       ['مدى عابر قاري','ضرر 500 + شظايا','55% يتخطى الدفاعات','مسار 650 عالٍ جداً'],
 nuke_tac:   ['انفجار نووي 360م','EMP 500م + دمار شامل','72% يراوغ الدفاعات','يدمر كل شيء في النطاق'],
};

export const PCFG={
 heli: {name:'AH-64 Apache', hp:140,spd:2.8,fuel:900, aaAmmo:4, agAmmo:16, gunAmmo:1200,aamCount:2, flares:10,turnRate:.25, gunCaliber:1, allAspect:false,canards:false,cost:380, col:'#44aa66',role:'heli', trainTime: 180},
 fighter: {name:'F-16 Falcon', hp:90, spd:5.5,fuel:900, aaAmmo:8, agAmmo:0, gunAmmo:500, aamCount:2, flares:6, turnRate:.15, gunCaliber:1, allAspect:false,canards:false,cost:450, col:'#00ff88',role:'air', trainTime: 240},
 bomber: {name:'Su-24 Fencer', hp:120,spd:3.2,fuel:1100,aaAmmo:2, agAmmo:10, gunAmmo:200, aamCount:0, flares:8, turnRate:.07, gunCaliber:.5, allAspect:false,canards:false,cost:500, col:'#ffaa44',role:'ground', trainTime: 300},
 interceptor: {name:'MiG-29 Fulcrum',hp:75, spd:7.5,fuel:700, aaAmmo:12,agAmmo:0, gunAmmo:450, aamCount:3, flares:4, turnRate:.18, gunCaliber:1, allAspect:true, canards:false,cost:570, col:'#88ccff',role:'intercept', trainTime: 240},
 a10: {name:'A-10 Warthog', hp:200,spd:2.5,fuel:1400,aaAmmo:2, agAmmo:30, gunAmmo:1350,aamCount:1, flares:16,turnRate:.08, gunCaliber:4, allAspect:false,canards:false,cost:620, col:'#88bbcc',role:'cas', trainTime: 360},
 gunship: {name:'AC-130 Spectre',hp:150,spd:2.5,fuel:1200,aaAmmo:0, agAmmo:20, gunAmmo:999, aamCount:0, flares:12,turnRate:.05, gunCaliber:3, allAspect:false,canards:false,cost:720, col:'#cc8844',role:'cas', trainTime: 420},
 awacs: {name:'E-3 Sentry', hp:80, spd:3, fuel:2000,aaAmmo:0, agAmmo:0, gunAmmo:0, aamCount:0, flares:6, turnRate:.05, gunCaliber:0, allAspect:false,canards:false,cost:780, col:'#00ffcc',role:'awacs', trainTime: 480},
 su57: {name:'Su-57 Felon', hp:130,spd:8, fuel:1200,aaAmmo:8, agAmmo:4, gunAmmo:500, aamCount:4, flares:8, turnRate:.19, gunCaliber:1.2,allAspect:true, canards:true, cost:920, col:'#aa88ff',role:'air', trainTime: 500},
 stealth: {name:'B-2 Spirit', hp:80,spd:4, fuel:1500,aaAmmo:4, agAmmo:8, gunAmmo:0, aamCount:4, flares:10,turnRate:.09, gunCaliber:0, allAspect:true, canards:false,cost:1000, col:'#667788',role:'stealth', trainTime: 600},
 f22: {name:'F-22 Raptor', hp:120,spd:9, fuel:1100,aaAmmo:10,agAmmo:2, gunAmmo:480, aamCount:4, flares:8, turnRate:.20, gunCaliber:1.2,allAspect:true, canards:false,cost:1100, col:'#aaddff',role:'air', trainTime: 500},
};
export const DCFG={
 nano:    {name:'نانو سرب×10', hp:8,  spd:6,   fuel:400,  dmg:25,  rad:20, cost:80,  col:'#ff44ff',type:'swarm'},
 swarm:   {name:'سرب صغير',    hp:15, spd:5.5, fuel:500,  dmg:50,  rad:38, cost:130, col:'#ff88ff',type:'swarm'},
 kamikaze:{name:'انتحارية',    hp:20, spd:4.5, fuel:800,  dmg:95,  rad:58, cost:190, col:'#ff55ff',type:'kamikaze'},
 recon:   {name:'استطلاع',     hp:25, spd:3.5, fuel:1200, dmg:0,   rad:0,  cost:220, col:'#cc77ff',type:'recon'},
 loiter:  {name:'كامنة HAROP', hp:35, spd:3,   fuel:1800, dmg:110, rad:62, cost:320, col:'#ffcc44',type:'loiter'},
 jammer:  {name:'تشويش EW',    hp:30, spd:3.2, fuel:1400, dmg:0,   rad:0,  cost:380, col:'#44ffdd',type:'jammer'},
 armed:   {name:'MQ-9 Reaper', hp:50, spd:4,   fuel:1600, dmg:75,  rad:45, cost:440, col:'#88ddff',type:'armed'},
 heavy:   {name:'ثقيلة UCAV',  hp:55, spd:3.5, fuel:1000, dmg:160, rad:78, cost:540, col:'#ffaa44',type:'kamikaze'},
};

export const GAME_CONSTANTS = {
  RESOURCE_TICK: 0.2,
  AI_TICK_RATE: 200,
  BASE_SPEED_MULTIPLIER: 0.00015,   // legacy (unused — missiles are distance-aware now)
  // Missile speed = cfg.spd × MISSILE_SPEED_KM_S in km/SECOND; flight time
  // scales with DISTANCE. ballistic 5.5→248km/s (~8s per 2000km), icbm→540km/s.
  // (90 was too fast per playtest — halved so flights are visible.)
  MISSILE_SPEED_KM_S: 45,
  // SAM interceptor speed in km/s — must out-run attackers (≈500km/s) to catch them.
  SAM_INTERCEPT_SPEED_KM_S: 900,
  // Plane speed = cfg.spd × MULTIPLIER in km/FRAME (×60 = km/s).
  // Was 0.005 (fighter 1.65 km/s — slower than conquest frontier!).
  // Now fighter ≈ 50 km/s, F-22 ≈ 81 — planes cross continents in ~1 min.
  PLANE_SPEED_MULTIPLIER: 0.15,
  // ── Air Force system (TASK-201) ──
  // Ranges are GROUND km (planes fly ~22-81 km/s — envelopes must be wide
  // or engagements last a single frame).
  AIR_DETECT_RANGE: 400,       // km — air-to-air acquisition (radar + visual)
  AIR_STEALTH_DETECT: 30,      // km — stealth aircraft (B-2) only lockable this close
  AIR_LOW_OBS_MULT: 0.55,      // Su-57/F-22 detection multiplier against hunters
  AIR_AAM_RANGE: 300,          // km — AAM launch envelope
  AIR_GUN_RANGE: 60,           // km — gun-pass envelope
  AIR_STRIKE_RANGE_DEFAULT: 40,// km — default AGM release range (fighters/heli)
  AIR_STRIKE_RANGE_BOMBER: 60, // km — bomber carpet-release range
  AIR_STRIKE_RANGE_CAS: 45,    // km — A-10/heli precision release range
  AIR_GUNSHIP_ORBIT: 80,       // km — AC-130 standoff orbit radius around aim point
  AIR_BURN_RATE: 0.5,          // fuel/frame airborne (fighter 900 → 30s sortie)
  AIR_RTB_FUEL_PCT: 0.25,      // fuel fraction below which planes force RTB
  AIR_REARM_FUEL_FRAMES: 300,  // parked refuel to full (5s)
  AIR_REARM_AMMO_FRAMES: 420,  // parked rearm to full (7s)
  AIR_FLARE_DECOY: 0.55,       // base decoy chance per flare pop vs AAM/SAM
  AIR_AAM_DMG: 55,             // damage per AAM hit
  AIR_AAM_SPEED: 6.0,          // km/frame — AAM tracer speed (out-runs any jet)
  AIR_GUN_BURST_DMG: 6,        // per-round damage × gunCaliber × alignment
  AIR_FLAK_DMG: 16,            // flak barrage tick damage vs aircraft
  AIR_CIWS_DMG: 11,            // CIWS pulse damage vs aircraft
  AIR_SAM_DMG: 65,             // SAM interceptor damage vs aircraft
  AIR_AI_MAX_PLANES: 6,        // air wing size cap per rival bot
  AIR_BOT_SCRAMBLE_FRAMES: 360,// bot parked-plane auto-launch delay (6s)
  SAM_INTERCEPT_SPEED: 0.004,   // legacy (unused)
  MAX_PARTICLES: 200,
  // Zone of Control
  ZOC_BASE_RADIUS: 180,
  ZOC_PLANE_RADIUS: 100,
  // Building collision
  BUILD_COLLISION_RADIUS: 6.0,  // 2× for the larger v2 models (10× scale)
  // Missile ranges by type
  // Launcher engagement ranges (km) — raised: SRBM-class reaches across a
  // subcontinent, cruise/stealth are intercontinental-strike (real BGM-109
  // ≈ 2500km), hypersonic global-adjacent. icbm/nuke stay unlimited.
  RANGE_CRUISE: 2500,
  RANGE_HYPER: 3500,
  RANGE_DEFAULT: 1200,
  RANGE_UNLIMITED: 9999,
  // Camera
  CAM_JUMP_ALTITUDE: 2000,
  // HUD / Logic intervals (frames)
  HUD_UPDATE_INTERVAL: 30,
  WIN_CHECK_INTERVAL: 60,
  // Selection
  CLICK_SELECT_RADIUS: 3,
  // Starting resources
  STARTING_RES_OFFLINE: 2700,
  STARTING_RES_ONLINE: 1500,
  // Economy: income per frame from each structure type
  INCOME_BASE: 0.15,        // HQ generates steady income
  INCOME_CITY: 0.10,        // Each city generates income
  INCOME_FACTORY: 0.08,     // Factories produce resources
  INCOME_NUKE_PLANT: 0.25,  // Nuclear plants = big late-game income
  INCOME_AIRPORT: 0.03,     // Small income from airports
  // Economy: Factory multiplier to all income
  FACTORY_MULTIPLIER: 0.15, // Each factory adds +15% to total income
  // Upkeep per frame (drain)
  UPKEEP_PLANE: 0.008,      // Each active plane drains resources
  UPKEEP_BUILDING: 0.002,   // Each non-free building drains slightly
  // Economy tick interval (frames between economy calculations)
  ECON_TICK_INTERVAL: 6,    // Calculate every 6 frames for perf
  // City capture
  CAPTURE_RANGE: 25,        // Plane must be within this range to capture
  CAPTURE_TIME: 360,        // Frames to capture (6 seconds at 60fps)
  CAPTURE_CONTEST_RANGE: 30,// Enemy presence within this range blocks capture
  NEUTRAL_CITY_HP: 200,
  NEUTRAL_INCOME: 0.06,     // Neutral cities generate less than player-built cities
  // Territory System
  COUNTRY_CAPTURE_THRESHOLD: 0.5, // 50% of cities needed to capture a country

  // ── OpenFront Troops & Economy System ──
  STARTING_TROOPS: 2500,
  TROOP_GROWTH_FACTOR: 0.73,
  MAX_TROOPS_BASE: 50000,
  CITY_TROOP_INCREASE: 25000,
  TRADE_SHIP_SPAWN_INTERVAL: 300, // check trade ship every 300 ticks (~5s)
  // ── Trade Ships (OpenFront: tradeShipGold + tradeShipSpawnRate) ──
  TRADE_SHIP_MAX_ACTIVE: 24,        // cap on total active trade ships (was 200 = test flood)
  TRADE_SHIP_BASE_GOLD: 150,        // sigmoid max payout (OpenFront: 75_000, scaled to our economy)
  TRADE_SHIP_DIST_GOLD: 0.01,       // linear gold per km traveled (OpenFront: 50/tile ≈ 1/km)
  TRADE_SHIP_SHORT_RANGE_KM: 2000,  // debuff threshold (OpenFront: 300 tiles ≈ 15_000 km, scaled)
  TRADE_SHIP_SIGMOID_STEEPNESS: 0.002, // sigmoid curve steepness
  TRADE_SHIP_MIN_SPAWN_RATE: 2,     // floor on the 1-in-N spawn chance denominator per port check
  FACTORY_RAIL_RANGE: 1200, // max distance (km) for railroad connections
  TRAIN_SPAWN_INTERVAL: 360, // spawn CHECK every 360 ticks (~6s); actual spawn is probabilistic
  TRAIN_MAX_ACTIVE_PER_OWNER: 6, // cap active trains per side (anti-spam)
  TRAIN_PAYOUT: 150,
  CITY_BASE_COST: 500,
  PORT_BASE_COST: 400,
  FACTORY_BASE_COST: 600,
  // ── Transport Ships (naval invasion — OpenFront TransportShip) ──
  TRANSPORT_SHIP_MAX_ACTIVE: 3,     // per side (OpenFront boatMaxNumber)
  TRANSPORT_SHIP_SPEED_KM_S: 100,   // same cruise speed as trade ships
  BEACHHEAD_RADIUS_KM: 8,           // landing zone conquered on arrival (~1-2 cells)
  // ── Warships (OpenFront Warship — patrol/gun-ship unit) ──
  WARSHIP_COST: 800,                // flat (OpenFront: 250k escalating — scaled to our economy)
  WARSHIP_MAX_ACTIVE: 4,            // per side (player + each bot)
  WARSHIP_HP: 1000,                 // OpenFront maxHealth
  WARSHIP_SPEED_KM_S: 140,          // faster than transports (100)
  WARSHIP_SHELL_DAMAGE: 250,        // OpenFront shell base damage (4 shells kill a warship)
  WARSHIP_SHELL_RANGE_KM: 300,      // open fire distance
  WARSHIP_FIRE_RATE_TICKS: 120,     // 2s between shells (OpenFront: 20 ticks @10tps)
  WARSHIP_TARGET_RANGE_KM: 700,     // target search radius (OpenFront: 130 tiles ≈ 650km)
  WARSHIP_PATROL_RADIUS_KM: 350,    // wander radius around the clicked patrol point
  WARSHIP_HEAL_RATE: 4,             // HP/sec repaired near own port
  WARSHIP_HEAL_RANGE_KM: 400,       // 'near own port' distance
  // ── TASK-301: Economy Depth ──
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
  // 4) MILESTONES: one-time bonuses at territory/army thresholds. All sides
  //    (player + bots) earn them. `cells` uses the conquest grid in mode 1
  //    (mode 2 falls back to owned cities × 800). Thresholds calibrated vs
  //    real growth curves (army hits ~220k by 2 min, ~450k by 10 min; cells
  //    ~22/s): regional ≈2 min, industry ≈5-6 min, superpower ≈10 min.
  ECON_MILESTONES: [
    { id:'regional',   icon:'🏙️', name:'قوة إقليمية',  cells:2500,   rewardGold:300,  incomeMul:1.00 },
    { id:'grand_army', icon:'🎖️', name:'جيش عظيم',     troops:300000,  rewardGold:250,  incomeMul:1.00 },
    { id:'industry',   icon:'🏭', name:'ثورة صناعية',  cells:5000,   rewardGold:0,    incomeMul:1.10 },
    { id:'war_econ',   icon:'⚔️', name:'اقتصاد حربي',  troops:450000, rewardGold:0,    incomeMul:1.10 },
    { id:'superpower', icon:'🌍', name:'قوة عظمى',      cells:7000,   rewardGold:1500, incomeMul:1.00 },
  ],
  // ── Win conditions (mode 1) ──
  WIN_LAND_PERCENT: 0.8,            // OpenFront FFA: own 80% of the land → victory
  WIN_TIME_LIMIT_S: 10200,          // 170-minute hard limit → draw (OpenFront)
  // ── Territory economy (mode 1) ──
  TERRITORY_INCOME_PER_CELL: 0.00025, // gold/sec per owned conquest cell
  // ── AI difficulty multipliers (mode 1; 'normal' = previous hardcoded balance) ──
  DIFFICULTY: {
    easy:   { maxTroopsMul: 0.55, growthMul: 0.35, aiIntervalMul: 1.6, aggression: 0.08 },
    normal: { maxTroopsMul: 0.75, growthMul: 0.50, aiIntervalMul: 1.0, aggression: 0.20 },
    hard:   { maxTroopsMul: 1.00, growthMul: 0.75, aiIntervalMul: 0.7, aggression: 0.35 },
    insane: { maxTroopsMul: 1.30, growthMul: 1.00, aiIntervalMul: 0.5, aggression: 0.50 },
  },
  ATTACK_RANGE: 20.0, // max adjacent click distance (degrees) to trigger troop attack
};

// ═══════════════════════════════════════════════════════════════════════
//  BOT NATIONS (mode 1 FFA — OpenFront-style nations)
//  Each bot spawns at its country with its own flag + territory color.
// ═══════════════════════════════════════════════════════════════════════
export const BOT_COUNTRIES = [
  { key: 'russia',  name: 'روسيا',      flag: '🇷🇺', lat: 60, lon: 90,   color: [220, 70, 70] },
  { key: 'china',   name: 'الصين',      flag: '🇨🇳', lat: 35, lon: 105,  color: [240, 150, 40] },
  { key: 'europe',  name: 'أوروبا',     flag: '🇪🇺', lat: 48, lon: 10,   color: [130, 110, 220] },
  { key: 'india',   name: 'الهند',      flag: '🇮🇳', lat: 22, lon: 78,   color: [230, 120, 180] },
  { key: 'brazil',  name: 'البرازيل',   flag: '🇧🇷', lat: -12, lon: -50, color: [90, 190, 90] },
  { key: 'turkey',  name: 'تركيا',      flag: '🇹🇷', lat: 39, lon: 33,   color: [210, 70, 70] },
  { key: 'iran',    name: 'إيران',      flag: '🇮🇷', lat: 32, lon: 53,   color: [120, 200, 120] },
  { key: 'japan',   name: 'اليابان',    flag: '🇯🇵', lat: 37, lon: 139,  color: [235, 105, 90] },
  { key: 'egypt',   name: 'مصر',        flag: '🇪🇬', lat: 27, lon: 30,   color: [200, 180, 70] },
  { key: 'australia', name: 'أستراليا', flag: '🇦🇺', lat: -25, lon: 134, color: [110, 170, 230] },
  { key: 'nigeria', name: 'نيجيريا',    flag: '🇳🇬', lat: 9, lon: 8,     color: [170, 140, 90] },
  { key: 'korea',   name: 'كوريا',      flag: '🇰🇷', lat: 37, lon: 128,  color: [150, 200, 230] },
  { key: 'canada',  name: 'كندا',       flag: '🇨🇦', lat: 56, lon: -100, color: [190, 200, 230] },
  { key: 'argentina', name: 'الأرجنتين', flag: '🇦🇷', lat: -35, lon: -65, color: [130, 220, 190] },
  { key: 'uk',      name: 'بريطانيا',   flag: '🇬🇧', lat: 53, lon: -2,   color: [180, 130, 220] },
  { key: 'indonesia', name: 'إندونيسيا', flag: '🇮🇩', lat: -3, lon: 112, color: [220, 200, 120] },
];
export const BOTS_MAX = 8; // menu allows 0..8 bots

export const WORLD_CITIES = [
  // ── North America ──
  {name:'New York',      lat:40.7,  lon:-74.0},
  {name:'Washington DC', lat:38.9,  lon:-77.0},
  {name:'Chicago',       lat:41.9,  lon:-87.6},
  {name:'Los Angeles',   lat:34.1,  lon:-118.2},
  {name:'Houston',       lat:29.8,  lon:-95.4},
  {name:'Toronto',       lat:43.7,  lon:-79.4},
  {name:'Mexico City',   lat:19.4,  lon:-99.1},
  {name:'Miami',         lat:25.8,  lon:-80.2},
  {name:'Vancouver',     lat:49.3,  lon:-123.1},
  {name:'Havana',        lat:23.1,  lon:-82.4},
  // ── South America ──
  {name:'São Paulo',     lat:-23.5, lon:-46.6},
  {name:'Buenos Aires',  lat:-34.6, lon:-58.4},
  {name:'Lima',          lat:-12.0, lon:-77.0},
  {name:'Bogotá',        lat:4.7,   lon:-74.1},
  {name:'Santiago',      lat:-33.4, lon:-70.7},
  {name:'Rio de Janeiro',lat:-22.9, lon:-43.2},
  // ── Europe ──
  {name:'London',        lat:51.5,  lon:-0.1},
  {name:'Paris',         lat:48.9,  lon:2.3},
  {name:'Berlin',        lat:52.5,  lon:13.4},
  {name:'Rome',          lat:41.9,  lon:12.5},
  {name:'Madrid',        lat:40.4,  lon:-3.7},
  {name:'Warsaw',        lat:52.2,  lon:21.0},
  {name:'Kyiv',          lat:50.5,  lon:30.5},
  {name:'Stockholm',     lat:59.3,  lon:18.1},
  {name:'Athens',        lat:37.9,  lon:23.7},
  {name:'Bucharest',     lat:44.4,  lon:26.1},
  // ── Middle East ──
  {name:'Istanbul',      lat:41.0,  lon:29.0},
  {name:'Dubai',         lat:25.2,  lon:55.3},
  {name:'Riyadh',        lat:24.7,  lon:46.7},
  {name:'Tehran',        lat:35.7,  lon:51.4},
  {name:'Baghdad',       lat:33.3,  lon:44.4},
  {name:'Cairo',         lat:30.0,  lon:31.2},
  {name:'Ankara',        lat:39.9,  lon:32.9},
  {name:'Tel Aviv',      lat:32.1,  lon:34.8},
  {name:'Amman',         lat:31.9,  lon:35.9},
  {name:'Damascus',      lat:33.5,  lon:36.3},
  // ── Africa ──
  {name:'Lagos',         lat:6.5,   lon:3.4},
  {name:'Nairobi',       lat:-1.3,  lon:36.8},
  {name:'Johannesburg',  lat:-26.2, lon:28.0},
  {name:'Addis Ababa',   lat:9.0,   lon:38.7},
  {name:'Casablanca',    lat:33.6,  lon:-7.6},
  {name:'Kinshasa',      lat:-4.3,  lon:15.3},
  {name:'Algiers',       lat:36.8,  lon:3.1},
  {name:'Khartoum',      lat:15.6,  lon:32.5},
  // ── East Asia ──
  {name:'Beijing',       lat:39.9,  lon:116.4},
  {name:'Shanghai',      lat:31.2,  lon:121.5},
  {name:'Tokyo',         lat:35.7,  lon:139.7},
  {name:'Seoul',         lat:37.6,  lon:127.0},
  {name:'Hong Kong',     lat:22.3,  lon:114.2},
  {name:'Taipei',        lat:25.0,  lon:121.5},
  // ── South/SE Asia ──
  {name:'Mumbai',        lat:19.1,  lon:72.9},
  {name:'Delhi',         lat:28.6,  lon:77.2},
  {name:'Bangkok',       lat:13.8,  lon:100.5},
  {name:'Singapore',     lat:1.3,   lon:103.8},
  {name:'Jakarta',       lat:-6.2,  lon:106.8},
  {name:'Manila',        lat:14.6,  lon:121.0},
  {name:'Karachi',       lat:24.9,  lon:67.0},
  // ── Oceania ──
  {name:'Sydney',        lat:-33.9, lon:151.2},
  {name:'Melbourne',     lat:-37.8, lon:145.0},
  {name:'Auckland',      lat:-36.8, lon:174.8},
  // ── Russia/Central Asia ──
  {name:'Novosibirsk',   lat:55.0,  lon:82.9},
  {name:'Almaty',        lat:43.2,  lon:76.9},
];

export const SDEFS={
 launcher:  {name:'منصة إطلاق',  w:28,h:26,hp:130,cost:180,  reload:250},
 radar:     {name:'رادار',        w:18,h:42,hp:70, cost:260,  reload:0, radarRange:700},
 flak:      {name:'مضاد FLAK',    w:26,h:28,hp:80, cost:320,  reload:65, fireRange: 20},
 sam:       {name:'SAM باتريوت',  w:24,h:34,hp:100,cost:450,  reload:180, fireRange: 80},
 factory:   {name:'مصنع حربي',    w:44,h:30,hp:150,cost:600,  reload:0},
 himars:    {name:'HIMARS مضاد',  w:38,h:22,hp:140,cost:750,  reload:170, radarRange:500, mobile:true},
 ciws:      {name:'CIWS ليزر',    w:22,h:32,hp:150,cost:850,  reload:14, fireRange: 15},
 airport:   {name:'مطار عسكري',   w:72,h:22,hp:240,cost:1000, reload:600},
 iron_dome: {name:'قبة حديدية',   w:32,h:36,hp:200,cost:1200, reload:110, fireRange: 60},
 city:      {name:'مدينة',        w:65,h:38,hp:350,cost:500,    reload:0},
 port:      {name:'ميناء ساحلي',   w:34,h:28,hp:180,cost:400,    reload:0},
 base:      {name:'قاعدة رئيسية', w:52,h:28,hp:300,cost:0,    reload:0},
 nuke_plant:{name:'منشأة نووية',  w:58,h:46,hp:400,cost:3000, reload:14400},
  warship:  {name:'مدمرة حربية',   w:0,h:0, hp:1000,cost:800,   reload:0},  // mobile unit (hotbar V) — not a Structure
};

export const ITEM_ICONS={
  'scud':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww%2Ew3%2Eorg%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C2%2017%2C22%2014%2C26%2011%2C22%22%20fill%3D%22%2388ff44%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%2212.5%22%20y%3D%228%22%20width%3D%223%22%20height%3D%226%22%20fill%3D%22%23ccff99%22%20opacity%3D%22.5%22%2F%3E%3Cpolygon%20points%3D%2211%2C22%2014%2C26%2017%2C22%2014%2C23%22%20fill%3D%22%2344aa22%22%2F%3E%3C%2Fsvg%3E',  'ballistic':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C2%2017%2C20%2014%2C26%2011%2C20%22%20fill%3D%22%234488ff%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%2214%22%20width%3D%226%22%20height%3D%223%22%20fill%3D%22%23aaccff%22%20opacity%3D%22.4%22%2F%3E%3Cpolygon%20points%3D%2210%2C20%2014%2C26%2018%2C20%22%20fill%3D%22%232255cc%22%2F%3E%3C%2Fsvg%3E',
  'cruise':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%226%22%20y%3D%2212%22%20width%3D%2216%22%20height%3D%225%22%20rx%3D%222%22%20fill%3D%22%23ff9900%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%2222%2C14.5%2026%2C12%2026%2C17%22%20fill%3D%22%23ff9900%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%229%22%20width%3D%225%22%20height%3D%223%22%20fill%3D%22%23ffcc77%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%226%22%20y%3D%2217%22%20width%3D%224%22%20height%3D%222%22%20fill%3D%22%23cc7700%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'cluster':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C3%2016%2C16%2014%2C20%2012%2C16%22%20fill%3D%22%23ffaa00%22%20opacity%3D%22.9%22%2F%3E%3Ccircle%20cx%3D%229%22%20cy%3D%2222%22%20r%3D%223%22%20fill%3D%22%23ffaa00%22%20opacity%3D%22.8%22%2F%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%2224%22%20r%3D%223%22%20fill%3D%22%23ffdd44%22%20opacity%3D%22.8%22%2F%3E%3Ccircle%20cx%3D%2219%22%20cy%3D%2222%22%20r%3D%223%22%20fill%3D%22%23ffaa00%22%20opacity%3D%22.8%22%2F%3E%3C%2Fsvg%3E',
  'emp':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%2214%22%20r%3D%229%22%20fill%3D%22none%22%20stroke%3D%22%2300ffcc%22%20stroke-width%3D%221.5%22%20opacity%3D%22.7%22%2F%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%2214%22%20r%3D%225%22%20fill%3D%22none%22%20stroke%3D%22%2300ffcc%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3Cpolygon%20points%3D%2214%2C6%2016%2C13%2014%2C11%2012%2C13%22%20fill%3D%22%2300ffcc%22%20opacity%3D%22.9%22%2F%3E%3Cline%20x1%3D%225%22%20y1%3D%2214%22%20x2%3D%228%22%20y2%3D%2214%22%20stroke%3D%22%2300ffcc%22%20stroke-width%3D%221.5%22%20opacity%3D%22.8%22%2F%3E%3Cline%20x1%3D%2220%22%20y1%3D%2214%22%20x2%3D%2223%22%20y2%3D%2214%22%20stroke%3D%22%2300ffcc%22%20stroke-width%3D%221.5%22%20opacity%3D%22.8%22%2F%3E%3C%2Fsvg%3E',
  'tomahawk':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%225%22%20y%3D%2212.5%22%20width%3D%2218%22%20height%3D%224%22%20rx%3D%222%22%20fill%3D%22%2300ddff%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%2223%2C14.5%2026%2C11%2026%2C18%22%20fill%3D%22%2300ddff%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%229%22%20width%3D%224%22%20height%3D%223.5%22%20fill%3D%22%2388eeff%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%2215.5%22%20width%3D%224%22%20height%3D%223.5%22%20fill%3D%22%2388eeff%22%20opacity%3D%22.4%22%2F%3E%3Ccircle%20cx%3D%227%22%20cy%3D%2214.5%22%20r%3D%222%22%20fill%3D%22%2300aacc%22%20opacity%3D%22.8%22%2F%3E%3C%2Fsvg%3E',
  'thermobaric':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C2%2017%2C19%2014%2C26%2011%2C19%22%20fill%3D%22%23ff2200%22%20opacity%3D%22.9%22%2F%3E%3Cellipse%20cx%3D%2214%22%20cy%3D%2222%22%20rx%3D%226%22%20ry%3D%225%22%20fill%3D%22%23ff5500%22%20opacity%3D%22.4%22%2F%3E%3Cpolygon%20points%3D%228%2C22%2014%2C14%2020%2C22%22%20fill%3D%22%23ff8800%22%20opacity%3D%22.5%22%2F%3E%3C%2Fsvg%3E',
  'stealth_m':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C4%2020%2C22%2014%2C20%208%2C22%22%20fill%3D%22%23334455%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%2214%2C4%2020%2C22%2014%2C18%22%20fill%3D%22%23445566%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%226%22%20y%3D%2220%22%20width%3D%2216%22%20height%3D%222.5%22%20fill%3D%22%23556677%22%20opacity%3D%22.5%22%2F%3E%3C%2Fsvg%3E',
  'bunker_bust':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C2%2016%2C8%2016%2C22%2014%2C26%2012%2C22%2012%2C8%22%20fill%3D%22%23ff5500%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%228%22%20width%3D%228%22%20height%3D%224%22%20fill%3D%22%23ff9955%22%20opacity%3D%22.5%22%2F%3E%3Cpolygon%20points%3D%2210%2C22%2014%2C26%2018%2C22%22%20fill%3D%22%23cc3300%22%2F%3E%3Crect%20x%3D%224%22%20y%3D%2212%22%20width%3D%225%22%20height%3D%223%22%20fill%3D%22%23ff7700%22%20opacity%3D%22.4%22%2F%3E%3Crect%20x%3D%2219%22%20y%3D%2212%22%20width%3D%225%22%20height%3D%223%22%20fill%3D%22%23ff7700%22%20opacity%3D%22.4%22%2F%3E%3C%2Fsvg%3E',
  'hyper':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C2%2016%2C18%2014%2C22%2012%2C18%22%20fill%3D%22%23ff22aa%22%20opacity%3D%22.95%22%2F%3E%3Cpolygon%20points%3D%2212%2C18%2014%2C22%2016%2C18%2019%2C20%2014%2C26%209%2C20%22%20fill%3D%22%23ff66cc%22%20opacity%3D%22.6%22%2F%3E%3Cline%20x1%3D%222%22%20y1%3D%2210%22%20x2%3D%2212%22%20y2%3D%2214%22%20stroke%3D%22%23ff22aa%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3Cline%20x1%3D%2226%22%20y1%3D%2210%22%20x2%3D%2216%22%20y2%3D%2214%22%20stroke%3D%22%23ff22aa%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3C%2Fsvg%3E',
  'icbm':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C1%2017%2C16%2016%2C24%2014%2C26%2012%2C24%2011%2C16%22%20fill%3D%22%23ff8800%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2210%22%20width%3D%228%22%20height%3D%225%22%20fill%3D%22%23ffcc88%22%20opacity%3D%22.3%22%2F%3E%3Crect%20x%3D%227%22%20y%3D%2218%22%20width%3D%224%22%20height%3D%225%22%20fill%3D%22%23ff8800%22%20opacity%3D%22.5%22%2F%3E%3Crect%20x%3D%2217%22%20y%3D%2218%22%20width%3D%224%22%20height%3D%225%22%20fill%3D%22%23ff8800%22%20opacity%3D%22.5%22%2F%3E%3Cpolygon%20points%3D%2211%2C24%2014%2C26%2017%2C24%2016%2C27%2014%2C28%2012%2C27%22%20fill%3D%22%23ffcc44%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
  'nuke_tac':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C1%2017%2C14%2016%2C22%2014%2C26%2012%2C22%2011%2C14%22%20fill%3D%22%23ffffff%22%20opacity%3D%22.95%22%2F%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%2210%22%20r%3D%224%22%20fill%3D%22none%22%20stroke%3D%22%23aaffaa%22%20stroke-width%3D%221%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%226%22%20y%3D%2217%22%20width%3D%225%22%20height%3D%226%22%20fill%3D%22%23ffffff%22%20opacity%3D%22.4%22%2F%3E%3Crect%20x%3D%2217%22%20y%3D%2217%22%20width%3D%225%22%20height%3D%226%22%20fill%3D%22%23ffffff%22%20opacity%3D%22.4%22%2F%3E%3Cpolygon%20points%3D%2211%2C23%2014%2C26%2017%2C23%2016%2C27%2012%2C27%22%20fill%3D%22%23aaffaa%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'heli':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%228%22%20y%3D%2213%22%20width%3D%2214%22%20height%3D%225%22%20rx%3D%222%22%20fill%3D%22%2344aa66%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%224%22%20y%3D%2211%22%20width%3D%2220%22%20height%3D%222.5%22%20rx%3D%221%22%20fill%3D%22%2355bb77%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%224%22%20y%3D%2211%22%20width%3D%2220%22%20height%3D%221%22%20fill%3D%22%2388ddaa%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%2212%22%20y%3D%227%22%20width%3D%224%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%2344aa66%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%2220%22%20y%3D%2216%22%20width%3D%226%22%20height%3D%222%22%20fill%3D%22%2333884f%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'fighter':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C3%2022%2C20%2014%2C17%206%2C20%22%20fill%3D%22%2300ff88%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%226%2C20%2014%2C17%2022%2C20%2020%2C23%208%2C23%22%20fill%3D%22%2300cc66%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%224%2C16%208%2C15%208%2C19%22%20fill%3D%22%2300ff88%22%20opacity%3D%22.5%22%2F%3E%3Cpolygon%20points%3D%2224%2C16%2020%2C15%2020%2C19%22%20fill%3D%22%2300ff88%22%20opacity%3D%22.5%22%2F%3E%3Crect%20x%3D%2212.5%22%20y%3D%2222%22%20width%3D%223%22%20height%3D%224%22%20fill%3D%22%2300aa55%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
  'bomber':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C5%2024%2C18%2020%2C20%2014%2C19%208%2C20%204%2C18%22%20fill%3D%22%23ffaa44%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%224%2C18%208%2C20%208%2C22%204%2C20%22%20fill%3D%22%23cc8833%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%2224%2C18%2020%2C20%2020%2C22%2024%2C20%22%20fill%3D%22%23cc8833%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%2219%22%20width%3D%226%22%20height%3D%226%22%20fill%3D%22%23ff8800%22%20opacity%3D%22.4%22%2F%3E%3C%2Fsvg%3E',
  'interceptor':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C2%2023%2C19%2014%2C16%205%2C19%22%20fill%3D%22%2388ccff%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%225%2C19%2014%2C16%2023%2C19%2021%2C23%207%2C23%22%20fill%3D%22%235599cc%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%223%2C14%207%2C14%207%2C18%22%20fill%3D%22%2388ccff%22%20opacity%3D%22.6%22%2F%3E%3Cpolygon%20points%3D%2225%2C14%2021%2C14%2021%2C18%22%20fill%3D%22%2388ccff%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%2213%22%20y%3D%2222%22%20width%3D%222%22%20height%3D%224%22%20fill%3D%22%233377aa%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
  'a10':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C6%2024%2C17%2020%2C19%2014%2C18%208%2C19%204%2C17%22%20fill%3D%22%2388bbcc%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%223%22%20y%3D%2217%22%20width%3D%225%22%20height%3D%227%22%20rx%3D%221%22%20fill%3D%22%2388bbcc%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%2220%22%20y%3D%2217%22%20width%3D%225%22%20height%3D%227%22%20rx%3D%221%22%20fill%3D%22%2388bbcc%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%2212%22%20y%3D%223%22%20width%3D%224%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%23aaccdd%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
  'gunship':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cellipse%20cx%3D%2214%22%20cy%3D%2214%22%20rx%3D%229%22%20ry%3D%226%22%20fill%3D%22%23cc8844%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%224%22%20y%3D%2210%22%20width%3D%2220%22%20height%3D%223%22%20rx%3D%221%22%20fill%3D%22%23dd9955%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%224%22%20y%3D%2210%22%20width%3D%2220%22%20height%3D%221.5%22%20fill%3D%22%23ffcc88%22%20opacity%3D%22.8%22%2F%3E%3Crect%20x%3D%2222%22%20y%3D%2212%22%20width%3D%225%22%20height%3D%222%22%20fill%3D%22%23cc8844%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'awacs':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cellipse%20cx%3D%2214%22%20cy%3D%2215%22%20rx%3D%229%22%20ry%3D%225%22%20fill%3D%22%2300ffcc%22%20opacity%3D%22.85%22%2F%3E%3Cellipse%20cx%3D%2214%22%20cy%3D%229%22%20rx%3D%2210%22%20ry%3D%223.5%22%20fill%3D%22%2300ddaa%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%224%22%20y%3D%2211%22%20width%3D%2220%22%20height%3D%222%22%20fill%3D%22%2300ffcc%22%20opacity%3D%22.5%22%2F%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%229%22%20r%3D%222%22%20fill%3D%22%2300ffcc%22%20opacity%3D%22.9%22%2F%3E%3C%2Fsvg%3E',
  'su57':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C2%2024%2C17%2020%2C19%2014%2C17%208%2C19%204%2C17%22%20fill%3D%22%23aa88ff%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%224%2C17%208%2C19%209%2C22%205%2C20%22%20fill%3D%22%238866cc%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%2224%2C17%2020%2C19%2019%2C22%2023%2C20%22%20fill%3D%22%238866cc%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%2213%22%20y%3D%2221%22%20width%3D%222%22%20height%3D%225%22%20fill%3D%22%239977dd%22%20opacity%3D%22.5%22%2F%3E%3C%2Fsvg%3E',
  'stealth':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C10%2026%2C20%2014%2C18%202%2C20%22%20fill%3D%22%23667788%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%2214%2C10%2026%2C20%2022%2C22%2014%2C20%206%2C22%202%2C20%22%20fill%3D%22%23445566%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%222%2C20%206%2C22%2014%2C20%22%20fill%3D%22%23334455%22%20opacity%3D%22.9%22%2F%3E%3C%2Fsvg%3E',
  'f22':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C2%2025%2C18%2021%2C20%2014%2C18%207%2C20%203%2C18%22%20fill%3D%22%23aaddff%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%223%2C18%207%2C20%208%2C23%204%2C21%22%20fill%3D%22%2388bbdd%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%2225%2C18%2021%2C20%2020%2C23%2024%2C21%22%20fill%3D%22%2388bbdd%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%2212.5%22%20y%3D%2221%22%20width%3D%223%22%20height%3D%225%22%20fill%3D%22%236699bb%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
  'nano':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ccircle%20cx%3D%229%22%20cy%3D%229%22%20r%3D%223%22%20fill%3D%22%23ff44ff%22%20opacity%3D%22.8%22%2F%3E%3Ccircle%20cx%3D%2219%22%20cy%3D%229%22%20r%3D%223%22%20fill%3D%22%23ff44ff%22%20opacity%3D%22.8%22%2F%3E%3Ccircle%20cx%3D%229%22%20cy%3D%2219%22%20r%3D%223%22%20fill%3D%22%23ff44ff%22%20opacity%3D%22.8%22%2F%3E%3Ccircle%20cx%3D%2219%22%20cy%3D%2219%22%20r%3D%223%22%20fill%3D%22%23ff44ff%22%20opacity%3D%22.8%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%2212%22%20width%3D%226%22%20height%3D%224%22%20rx%3D%221%22%20fill%3D%22%23ff88ff%22%20opacity%3D%22.9%22%2F%3E%3Cline%20x1%3D%229%22%20y1%3D%229%22%20x2%3D%2213%22%20y2%3D%2213%22%20stroke%3D%22%23ff44ff%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3Cline%20x1%3D%2219%22%20y1%3D%229%22%20x2%3D%2215%22%20y2%3D%2213%22%20stroke%3D%22%23ff44ff%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3Cline%20x1%3D%229%22%20y1%3D%2219%22%20x2%3D%2213%22%20y2%3D%2215%22%20stroke%3D%22%23ff44ff%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3Cline%20x1%3D%2219%22%20y1%3D%2219%22%20x2%3D%2215%22%20y2%3D%2215%22%20stroke%3D%22%23ff44ff%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3C%2Fsvg%3E',
  'swarm':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C4%2017%2C14%2014%2C13%2011%2C14%22%20fill%3D%22%23ff88ff%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%224%2C14%2014%2C11%2013%2C14%2014%2C17%22%20fill%3D%22%23ff88ff%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%2224%2C14%2014%2C11%2015%2C14%2014%2C17%22%20fill%3D%22%23ff88ff%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%2214%2C24%2017%2C14%2014%2C15%2011%2C14%22%20fill%3D%22%23ff88ff%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
  'kamikaze':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C3%2022%2C20%2014%2C16%206%2C20%22%20fill%3D%22%23ff55ff%22%20opacity%3D%22.9%22%2F%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%2222%22%20r%3D%224%22%20fill%3D%22%23ff22cc%22%20opacity%3D%22.7%22%2F%3E%3Cline%20x1%3D%2210%22%20y1%3D%2222%22%20x2%3D%2218%22%20y2%3D%2222%22%20stroke%3D%22%23ff88ff%22%20stroke-width%3D%221.5%22%20opacity%3D%22.8%22%2F%3E%3Cline%20x1%3D%2214%22%20y1%3D%2218%22%20x2%3D%2214%22%20y2%3D%2226%22%20stroke%3D%22%23ff88ff%22%20stroke-width%3D%221.5%22%20opacity%3D%22.8%22%2F%3E%3C%2Fsvg%3E',
  'recon':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C5%2022%2C18%2014%2C16%206%2C18%22%20fill%3D%22%23cc77ff%22%20opacity%3D%22.9%22%2F%3E%3Cellipse%20cx%3D%2214%22%20cy%3D%2220%22%20rx%3D%225%22%20ry%3D%222.5%22%20fill%3D%22%23aa55cc%22%20opacity%3D%22.5%22%2F%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%2220%22%20r%3D%222%22%20fill%3D%22%23dd99ff%22%20opacity%3D%22.8%22%2F%3E%3C%2Fsvg%3E',
  'loiter':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C5%2020%2C16%2014%2C14%208%2C16%22%20fill%3D%22%23ffcc44%22%20opacity%3D%22.9%22%2F%3E%3Cellipse%20cx%3D%2214%22%20cy%3D%2219%22%20rx%3D%228%22%20ry%3D%222%22%20fill%3D%22none%22%20stroke%3D%22%23ffcc44%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%2219%22%20r%3D%222.5%22%20fill%3D%22%23ffaa22%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'jammer':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C5%2021%2C17%2014%2C15%207%2C17%22%20fill%3D%22%2344ffdd%22%20opacity%3D%22.9%22%2F%3E%3Cpath%20d%3D%22M8%2C21%20Q14%2C17%2020%2C21%22%20fill%3D%22none%22%20stroke%3D%22%2344ffdd%22%20stroke-width%3D%221.5%22%20opacity%3D%22.7%22%2F%3E%3Cpath%20d%3D%22M5%2C24%20Q14%2C18%2023%2C24%22%20fill%3D%22none%22%20stroke%3D%22%2344ffdd%22%20stroke-width%3D%221%22%20opacity%3D%22.4%22%2F%3E%3C%2Fsvg%3E',
  'armed':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C4%2022%2C18%2014%2C15%206%2C18%22%20fill%3D%22%2388ddff%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%229%22%20y%3D%2218%22%20width%3D%2210%22%20height%3D%223%22%20rx%3D%221%22%20fill%3D%22%2366bbdd%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%225%22%20y%3D%2219%22%20width%3D%225%22%20height%3D%222%22%20fill%3D%22%2388ddff%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%2218%22%20y%3D%2219%22%20width%3D%225%22%20height%3D%222%22%20fill%3D%22%2388ddff%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
  'heavy':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpolygon%20points%3D%2214%2C3%2024%2C18%2020%2C20%2014%2C18%208%2C20%204%2C18%22%20fill%3D%22%23ffaa44%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2218%22%20width%3D%228%22%20height%3D%225%22%20rx%3D%221%22%20fill%3D%22%23ff8822%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%225%22%20y%3D%2217%22%20width%3D%225%22%20height%3D%223%22%20fill%3D%22%23ffaa44%22%20opacity%3D%22.5%22%2F%3E%3Crect%20x%3D%2218%22%20y%3D%2217%22%20width%3D%225%22%20height%3D%223%22%20fill%3D%22%23ffaa44%22%20opacity%3D%22.5%22%2F%3E%3C%2Fsvg%3E',
  'launcher_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%229%22%20y%3D%2220%22%20width%3D%2210%22%20height%3D%225%22%20rx%3D%221%22%20fill%3D%22%2300ff88%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%2214%2C4%2015.5%2C20%2012.5%2C20%22%20fill%3D%22%2300ff88%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%227%22%20y%3D%2222%22%20width%3D%224%22%20height%3D%223%22%20rx%3D%221%22%20fill%3D%22%2300cc66%22%20opacity%3D%22.5%22%2F%3E%3Crect%20x%3D%2217%22%20y%3D%2222%22%20width%3D%224%22%20height%3D%223%22%20rx%3D%221%22%20fill%3D%22%2300cc66%22%20opacity%3D%22.5%22%2F%3E%3C%2Fsvg%3E',
  'radar_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cline%20x1%3D%2214%22%20y1%3D%2220%22%20x2%3D%2214%22%20y2%3D%2227%22%20stroke%3D%22%2300ff88%22%20stroke-width%3D%222%22%2F%3E%3Cellipse%20cx%3D%2214%22%20cy%3D%2210%22%20rx%3D%2210%22%20ry%3D%224%22%20fill%3D%22none%22%20stroke%3D%22%2300ff88%22%20stroke-width%3D%221.5%22%20opacity%3D%22.8%22%2F%3E%3Cline%20x1%3D%2214%22%20y1%3D%2210%22%20x2%3D%2222%22%20y2%3D%226%22%20stroke%3D%22%2300ff88%22%20stroke-width%3D%222%22%20opacity%3D%22.9%22%2F%3E%3C%2Fsvg%3E',
  'flak_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%228%22%20y%3D%2218%22%20width%3D%2212%22%20height%3D%227%22%20rx%3D%221%22%20fill%3D%22%23ffcc00%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2215%22%20width%3D%228%22%20height%3D%225%22%20rx%3D%221%22%20fill%3D%22%23ffdd44%22%20opacity%3D%22.8%22%2F%3E%3Cpolygon%20points%3D%2214%2C4%2016%2C15%2012%2C15%22%20fill%3D%22%23ffcc00%22%20opacity%3D%22.9%22%2F%3E%3C%2Fsvg%3E',
  'sam_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%229%22%20y%3D%2219%22%20width%3D%2210%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%2300aaff%22%20opacity%3D%22.7%22%2F%3E%3Cpolygon%20points%3D%2214%2C3%2016%2C19%2012%2C19%22%20fill%3D%22%2300ddff%22%20opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%226%22%20y%3D%2221%22%20width%3D%224%22%20height%3D%223%22%20rx%3D%221%22%20fill%3D%22%230099dd%22%20opacity%3D%22.5%22%2F%3E%3Crect%20x%3D%2218%22%20y%3D%2221%22%20width%3D%224%22%20height%3D%223%22%20rx%3D%221%22%20fill%3D%22%230099dd%22%20opacity%3D%22.5%22%2F%3E%3C%2Fsvg%3E',
  'bunker_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%223%22%20y%3D%2218%22%20width%3D%2222%22%20height%3D%228%22%20rx%3D%222%22%20fill%3D%22%23887755%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%223%2C18%2014%2C10%2025%2C18%22%20fill%3D%22%23998866%22%20opacity%3D%22.8%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%2219%22%20width%3D%226%22%20height%3D%223%22%20fill%3D%22%23332211%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
  'factory_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%224%22%20y%3D%2214%22%20width%3D%2220%22%20height%3D%2212%22%20rx%3D%221%22%20fill%3D%22%23ff8800%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%226%22%20y%3D%226%22%20width%3D%223%22%20height%3D%228%22%20rx%3D%221%22%20fill%3D%22%23ff8800%22%20opacity%3D%22.8%22%2F%3E%3Crect%20x%3D%2212%22%20y%3D%229%22%20width%3D%223%22%20height%3D%225%22%20rx%3D%221%22%20fill%3D%22%23ff8800%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'himars_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%223%22%20y%3D%2218%22%20width%3D%2222%22%20height%3D%227%22%20rx%3D%222%22%20fill%3D%22%23cc77ff%22%20opacity%3D%22.8%22%2F%3E%3Cpolygon%20points%3D%227%2C13%2010%2C5%2012%2C13%22%20fill%3D%22%23cc77ff%22%20opacity%3D%22.9%22%2F%3E%3Cpolygon%20points%3D%2214%2C13%2017%2C5%2019%2C13%22%20fill%3D%22%23cc77ff%22%20opacity%3D%22.9%22%2F%3E%3Ccircle%20cx%3D%228%22%20cy%3D%2225%22%20r%3D%222.5%22%20fill%3D%22%238833aa%22%20opacity%3D%22.7%22%2F%3E%3Ccircle%20cx%3D%2220%22%20cy%3D%2225%22%20r%3D%222.5%22%20fill%3D%22%238833aa%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'ciws_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%229%22%20y%3D%2218%22%20width%3D%2210%22%20height%3D%228%22%20rx%3D%221%22%20fill%3D%22%23ffcc00%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%2211%22%20y%3D%2212%22%20width%3D%226%22%20height%3D%228%22%20rx%3D%222%22%20fill%3D%22%23ffdd44%22%20opacity%3D%22.8%22%2F%3E%3Crect%20x%3D%2213%22%20y%3D%224%22%20width%3D%222%22%20height%3D%2210%22%20fill%3D%22%23ffcc00%22%20opacity%3D%22.9%22%2F%3E%3C%2Fsvg%3E',
  'airport_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%222%22%20y%3D%2220%22%20width%3D%2224%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%2300ffcc%22%20opacity%3D%22.6%22%2F%3E%3Cpolygon%20points%3D%2214%2C7%2022%2C20%206%2C20%22%20fill%3D%22%2300ddaa%22%20opacity%3D%22.8%22%2F%3E%3Crect%20x%3D%223%22%20y%3D%2221%22%20width%3D%223%22%20height%3D%224%22%20fill%3D%22%23006655%22%20opacity%3D%22.7%22%2F%3E%3Crect%20x%3D%2222%22%20y%3D%2221%22%20width%3D%223%22%20height%3D%224%22%20fill%3D%22%23006655%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'iron_dome_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M4%2C20%20Q14%2C4%2024%2C20%22%20fill%3D%22none%22%20stroke%3D%22%23ffcc00%22%20stroke-width%3D%222%22%20opacity%3D%22.8%22%2F%3E%3Cpath%20d%3D%22M7%2C20%20Q14%2C8%2021%2C20%22%20fill%3D%22none%22%20stroke%3D%22%23ffcc00%22%20stroke-width%3D%221%22%20opacity%3D%22.5%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2219%22%20width%3D%228%22%20height%3D%227%22%20rx%3D%221%22%20fill%3D%22%23cc9900%22%20opacity%3D%22.7%22%2F%3E%3C%2Fsvg%3E',
  'nuke_plant_b':'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2028%2028%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%225%22%20y%3D%2214%22%20width%3D%2218%22%20height%3D%2212%22%20rx%3D%221%22%20fill%3D%22%23ffffff%22%20opacity%3D%22.6%22%2F%3E%3Cellipse%20cx%3D%2214%22%20cy%3D%2214%22%20rx%3D%229%22%20ry%3D%228%22%20fill%3D%22%23eeeeee%22%20opacity%3D%22.4%22%2F%3E%3Ccircle%20cx%3D%2214%22%20cy%3D%2214%22%20r%3D%225%22%20fill%3D%22none%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%221.5%22%20opacity%3D%22.8%22%2F%3E%3Crect%20x%3D%229%22%20y%3D%224%22%20width%3D%224%22%20height%3D%2210%22%20rx%3D%221%22%20fill%3D%22%23aaaaaa%22%20opacity%3D%22.6%22%2F%3E%3Crect%20x%3D%2215%22%20y%3D%224%22%20width%3D%224%22%20height%3D%2210%22%20rx%3D%221%22%20fill%3D%22%23aaaaaa%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E',
};

export const TECH_TREE = {
  // ── TIER 1: Basic Research (no prereqs) ──
  adv_radar:      { name: 'رادار متقدم',        tier: 1, cost: 400,  time: 600,   prereq: [],            icon: '📡', desc: 'مدى الرادار +50%',
                    effect: (side, structs) => { structs.filter(s=>s.owner===side).forEach(s=>{ if(s.radarRange) s.radarRange *= 1.5; }); }},
  reinforced:     { name: 'تحصينات معززة',       tier: 1, cost: 350,  time: 500,   prereq: [],            icon: '🛡️', desc: 'HP المباني +40%',
                    effect: (side, structs) => { structs.filter(s=>s.owner===side).forEach(s=>{ s.hp = Math.floor(s.hp * 1.4); s.maxHp = Math.floor(s.maxHp * 1.4); }); }},
  fast_reload:    { name: 'إعادة تعبئة سريعة',  tier: 1, cost: 300,  time: 450,   prereq: [],            icon: '⚡', desc: 'سرعة إعادة تعبئة المدافع +35%',
                    effect: (side, structs) => { structs.filter(s=>s.owner===side && s.maxReload>0).forEach(s=>{ s.maxReload = Math.floor(s.maxReload * 0.65); }); }},
  adv_propulsion: { name: 'دفع محسّن',           tier: 1, cost: 500,  time: 700,   prereq: [],            icon: '🚀', desc: 'سرعة الصواريخ +25%',
                    unlocks_missiles: ['cruise','tomahawk'] },

  // ── TIER 2: Advanced Weapons (need 1 Tier-1) ──
  stealth_tech:   { name: 'تقنية التخفي',        tier: 2, cost: 800,  time: 1200,  prereq: ['adv_radar'], icon: '👻', desc: 'يفتح الصواريخ الشبحية و B-2',
                    unlocks_missiles: ['stealth_m'], unlocks_planes: ['stealth'] },
  hyper_research: { name: 'أبحاث فرط صوتية',    tier: 2, cost: 900,  time: 1400,  prereq: ['adv_propulsion'], icon: '💨', desc: 'يفتح الصاروخ فرط الصوتي',
                    unlocks_missiles: ['hyper'] },
  iron_dome_net:  { name: 'شبكة القبة الحديدية', tier: 2, cost: 700,  time: 1000,  prereq: ['reinforced'],icon: '🛡️', desc: 'يفتح بناء القبة الحديدية و CIWS',
                    unlocks_builds: ['iron_dome','ciws'] },
  adv_airforce:   { name: 'سلاح جو متقدم',      tier: 2, cost: 750,  time: 1100,  prereq: ['fast_reload'], icon: '✈️', desc: 'يفتح F-22 و Su-57',
                    unlocks_planes: ['f22','su57'] },
  bunker_tech:    { name: 'تقنية الاختراق',      tier: 2, cost: 650,  time: 900,   prereq: ['adv_propulsion'], icon: '💥', desc: 'يفتح GBU-28 خارق التحصينات',
                    unlocks_missiles: ['bunker_bust','thermobaric'] },

  // ── TIER 3: Superweapons (need 2 Tier-2) ──
  nuclear_prog:   { name: 'برنامج نووي',         tier: 3, cost: 2000, time: 2400,  prereq: ['hyper_research','bunker_tech'], icon: '☢️', desc: 'يفتح الرأس النووي التكتيكي',
                    unlocks_missiles: ['nuke_tac'], unlocks_builds: ['nuke_plant'] },
  icbm_prog:      { name: 'برنامج ICBM',         tier: 3, cost: 1500, time: 2000,  prereq: ['hyper_research','adv_propulsion'], icon: '🌍', desc: 'يفتح الصاروخين ICBM و EMP',
                    unlocks_missiles: ['icbm','emp'] },
  ai_warfare:     { name: 'حرب ذكية AI',         tier: 3, cost: 1800, time: 2200,  prereq: ['adv_airforce','stealth_tech'], icon: '🤖', desc: 'يفتح المسيّرات المتقدمة و HIMARS',
                    unlocks_builds: ['himars'] },
};

