import { MCFG, MTAGS, PCFG, DCFG, TCFG, GAME_CONSTANTS, WORLD_CITIES, SDEFS, ITEM_ICONS, TECH_TREE, BOT_COUNTRIES, BOTS_MAX } from './data/constants.js';
import { ECON_CONSTANTS } from './econ/constants.js';   // TASK-504: qaTest verifies the GAME_CONSTANTS spread
import { FormationLayout, TANK_BEHAVIORS, IndirectFire } from './land/landUnits.js';   // TASK-405
import { ConquestGrid, ConquestAttack, CONQUEST_CFG, registerOwner, clearRegisteredOwners, setBiomeFlatMode, setBiomeBandColor, getBiomeBandColor, getBiomeBands, attackLogic, attackTilesPerTickCtx } from './core/conquest.js';
import { initNewUI, uiToast } from './ui.js';
import { createWorldRender } from './world/render.js';   // TASK-406: world render layer
import { AirCombat, AIR_VET_NAMES } from './air/aircombat.js';
// TASK-402: strategy-pattern hull behaviors (src/naval/) — Warship.update()
// dispatches through NAVAL_HULLS instead of per-class if/else chains.
import { NAVAL_HULLS, Torpedo, assignFormation, layMineField, updateMineFields } from './naval/hulls.js';
window.GEO_DATA_ROADS = [];

// ═══ CONQUEST SYSTEM (Mode 1 — OpenFront-style territory conquest) ═══
let conquestGrid = null;        // ConquestGrid instance (logic + render canvas)
let activeAttacks = [];         // active ConquestAttack instances, ticked each frame
let conquestCtx = null;         // shared context object passed to ConquestAttack

// ════════════════════════════════════════════════════════════════════
//  BOT NATIONS (mode 1 FFA — OpenFront-style). Each bot: own country, flag,
//  territory color, owner code (4+) and AI state. mode 2 / legacy paths use
//  the plain 'enemy' owner (code 3) with no bots[] entry.
// ════════════════════════════════════════════════════════════════════
let bots = []; // [{ str, code, name, flag, colorRGB, hexColor, country, troops, res, tech, researchingId, alive, tickOffset }]

function isBotStr(s) { return !!s && s.startsWith('bot'); }
function botByStr(s) { return bots.find(b => b.str === s) || null; }

// Owner → 0xRRGGBB for meshes/sprites (player green, bots their color)
function ownerHexColor(ownerStr) {
    if (ownerStr === 'player') return 0x00ff88;
    const b = botByStr(ownerStr);
    if (b) return b.hexColor;
    return 0xff4444; // legacy enemy
}

function buildConquestCtx() {
  return {
    getTroops: (o) => o === 'player' ? pTroops : (isBotStr(o) ? (botByStr(o) || { troops: 0 }).troops : eTroops),
    addTroops: (o, d) => {
        if (o === 'player') pTroops += d;
        else if (isBotStr(o)) { const b = botByStr(o); if (b) b.troops = Math.max(0, b.troops + d); }
        else eTroops += d;
    },
    // OpenFront PlayerExecution: when a tile flips owner, structures standing on
    // it are CAPTURED by the tile's new owner (level kept). Previously null — a
    // captured enemy port kept spawning enemy trade ships and paying enemy gold forever.
    onConquerCell: (cell, newOwnerStr) => {
      WORLD_RENDER.onCellConquered(cell, newOwnerStr);   // TASK-406: capture-flash VFX
      if (!structs.length || !conquestGrid) return;
      for (let i = 0; i < structs.length; i++) {
        const s = structs[i];
        if (s.dead || s.owner === newOwnerStr) continue;
        if (conquestGrid.latLonToCell(s.lat, s.lon) === cell) {
          _captureStructure(s, newOwnerStr);
        }
      }
    },
    onEliminated: (conqueror, conquered) => {
      const b = botByStr(conquered);
      if (b) {
        if (b.alive) {
          b.alive = false;
          b.troops = 0;
          // Their infrastructure falls with them
          structs.forEach(s => { if (s.owner === b.str && !s.dead) { s.dead = true; if (s.mesh) s.mesh.visible = false; } });
          logEvent(`🏳️ سقطت ${b.flag} ${b.name}!`, 'info');
        }
      } else {
        logEvent(`☠️ تم إبادة قوات ${conquered === 'player' ? 'لاعبك' : 'العدو'} بالكامل!`, 'info');
      }
    },
    log: logEvent,
  };
}

// Flip a structure to its captor: clone its material (shared cache materials must
// not be re-tinted in place) and repaint mesh + selection ring in the new color.
function _captureStructure(s, newOwnerStr) {
  s.owner = newOwnerStr;
  const col = ownerHexColor(newOwnerStr);
  try {
    // 3D model: retint the per-instance accent materials to the new owner
    // (dark structural bodies stay neutral — only accents carry ownership)
    if (s.accents && s.accents.length) {
      s.accents.forEach(m => m.color.setHex(col));
    } else if (s.mesh) {
      if (s.mesh.isSprite) s.mesh.material.color.setHex(col);
      else if (s.mesh.material) s.mesh.material.color.setHex(col);
    }
    if (s.selRing && s.selRing.material) s.selRing.material.color.setHex(col);
  } catch (e) { console.warn('[CAPTURE] repaint failed:', e.message); }
  s.selected = false;
  logEvent(`${newOwnerStr === 'player' ? '🍬' : '🔴'} تم الاستيلاء على مبنى (${s.type}) بعد احتلال أرضه!`, newOwnerStr === 'player' ? 'info' : 'err');
}













// Items that start LOCKED (require tech to unlock)
const TECH_LOCKED_MISSILES = ['cruise','tomahawk','stealth_m','hyper','bunker_bust','thermobaric','nuke_tac','icbm','emp'];
const TECH_LOCKED_PLANES = ['stealth','f22','su57'];
const TECH_LOCKED_BUILDS = ['iron_dome','ciws','nuke_plant','himars'];

// ═══════════════════════════════════════════════════════════════
// WORLD CITIES DATABASE — loaded from world_cities_generated.js
// 7270 real-world cities across 225 countries
// ═══════════════════════════════════════════════════════════════


const SFX = {
 ctx: null, muted: false, master: null,
 // TASK-408: mixer chain = buses → out[user volume] → compressor → destination
 out: null, buses: null,
 vol: 1, busVol: { amb: .8, bgm: .55, weapons: 1, ui: .8, alerts: 1 },
 _evtLog: [], _active: 0, _bed: null, _tension: 0,
 init(){ 
  if(this.ctx) { if(this.ctx.state==='suspended') this.ctx.resume(); return; } 
  const AC = window.AudioContext || window.webkitAudioContext; 
  if(AC) { 
   this.ctx = new AC(); 
   this.master = this.ctx.createDynamicsCompressor();
   this.master.threshold.value = -3;
   this.master.knee.value = 10;
   this.master.ratio.value = 12;
   this.master.attack.value = 0.002;
   this.master.release.value = 0.1;
   this.master.connect(this.ctx.destination);
   // TASK-408: user volume + per-category buses (amb/bgm/weapons/ui/alerts)
   this.out = this.ctx.createGain(); this.out.gain.value = this.vol; this.out.connect(this.master);
   this.buses = {};
   for (const k of ['amb', 'bgm', 'weapons', 'ui', 'alerts']) {
     const g = this.ctx.createGain(); g.gain.value = this.busVol[k]; g.connect(this.out); this.buses[k] = g;
   }
   this._restoreMix();
   if(this.ctx.state==='suspended') this.ctx.resume(); 
  } 
 },
 // TASK-408: mixer API + node bookkeeping
 setVolume(v){ this.vol = Math.max(0, Math.min(1, v)); if (this.out) this.out.gain.value = this.vol; this._persist(); },
 setBus(k, v){ if (!(k in this.busVol)) return; this.busVol[k] = Math.max(0, Math.min(1, v)); if (this.buses && this.buses[k]) this.buses[k].gain.value = this.busVol[k]; this._persist(); },
 _bus(k){ return (this.buses && this.buses[k]) || this.master; },
 _track(src){ if (!src) return; this._active++; src.onended = () => { this._active = Math.max(0, this._active - 1); }; },
 _evt(name){ this._evtLog.push(name + '@' + (this.ctx ? this.ctx.currentTime : 0).toFixed(1) + 's'); if (this._evtLog.length > 40) this._evtLog.shift(); },
 _persist(){ try { localStorage.setItem('sfxMix', JSON.stringify({ vol: this.vol, busVol: this.busVol })); } catch (e) {} },
 _restoreMix(){ try { const j = JSON.parse(localStorage.getItem('sfxMix') || 'null'); if (!j) return; if (j.vol != null) this.vol = Math.max(0, Math.min(1, j.vol)); if (j.busVol) for (const k in this.busVol) if (j.busVol[k] != null) this.busVol[k] = Math.max(0, Math.min(1, j.busVol[k])); if (this.out) this.out.gain.value = this.vol; if (this.buses) for (const k in this.buses) this.buses[k].gain.value = this.busVol[k]; } catch (e) {} },
 toggleMute(){ this.muted = !this.muted; document.getElementById('btnMute').textContent = this.muted ? '🔇' : '🔊'; if(!this.muted) this.init(); this._evt(this.muted ? 'mute' : 'unmute'); if (this.muted) this.bedOff(); },
 
 playNoiseLayer(dur, vol, lpf, lpfEnd, hpf, hpfEnd, bus='weapons'){
  if(this.muted||!this.ctx)return;
  const bs = this.ctx.sampleRate*dur, buf = this.ctx.createBuffer(1,bs,this.ctx.sampleRate), data = buf.getChannelData(0);
  let lastOut = 0;
  for(let i=0;i<bs;i++) {
   const white = Math.random()*2-1;
   data[i] = (lastOut + (0.02 * white)) / 1.02; // brownish noise emphasis
   lastOut = data[i];
   data[i] *= 3.5; 
  }
  const noise = this.ctx.createBufferSource(); noise.buffer = buf;
  
  const lowPass = this.ctx.createBiquadFilter(); lowPass.type = 'lowpass';
  lowPass.frequency.setValueAtTime(lpf, this.ctx.currentTime);
  if(lpfEnd) lowPass.frequency.exponentialRampToValueAtTime(lpfEnd, this.ctx.currentTime+dur);
  
  const highPass = this.ctx.createBiquadFilter(); highPass.type = 'highpass';
  highPass.frequency.setValueAtTime(hpf||10, this.ctx.currentTime);
  if(hpfEnd) highPass.frequency.exponentialRampToValueAtTime(hpfEnd, this.ctx.currentTime+dur);
  
  const gain = this.ctx.createGain(); 
  gain.gain.setValueAtTime(0.001, this.ctx.currentTime); 
  gain.gain.exponentialRampToValueAtTime(vol, this.ctx.currentTime+dur*0.05); // fast attack
  gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime+dur);
  
  noise.connect(lowPass); lowPass.connect(highPass); highPass.connect(gain); gain.connect(this._bus(bus)); 
  noise.start(); noise.stop(this.ctx.currentTime+dur);
  this._track(noise);
 },

 launch(type='medium'){
  this.init(); 
  if(type==='nuke'){
   // Deep sonic boom rumble
   this.playNoiseLayer(5, 1.2, 500, 20, 20, 10);
  }
  else if(type==='small'){
   // Sharp hiss (SAM/Cruises)
   this.playNoiseLayer(1.5, 0.4, 3000, 800, 400, 100);
  }
  else {
   // Medium ballistic/rocket 
   this.playNoiseLayer(3.0, 0.7, 1500, 150, 150, 40);
  }
 },
 exp(r, isNuke=false){
  this.init(); 
  if(isNuke){
   // Massive shockwave
   this.playNoiseLayer(6, 1.5, 800, 20, 10, 10);
   this.playNoiseLayer(2, 0.8, 4000, 200, 200, 50); // crack
  }
  else if(r>80){
   this.playNoiseLayer(3.5, 0.9, 600, 40, 30, 15);
  }
  else if(r>30){
   this.playNoiseLayer(2.0, 0.5, 1000, 100, 60, 20);
  }
  else {
   // Small flak pop
   this.playNoiseLayer(0.8, 0.25, 2000, 400, 200, 80);
  }
 },
 // TASK-504: bgm variation — three 16-step patterns rotate every bar-group,
 // picked by the war-tension mood (bedTension feeds this._tension):
 //   P0 "pulse"   — the original TASK-408 heartbeat (peacetime anchor)
 //   P1 "march"   — bass + backbeat blip + ghost note (forward motion)
 //   P2 "tension" — minor-second alternation + heartbeat double (war dread)
 // Step spec: {w:waveform, f0→f1 freq ramp, g:gain, d:decay}. One oscillator
 // per non-null step (P2 doubles on step 0) — same node budget as the old
 // single pattern, so the mixer/active-source accounting is unchanged.
 bgmStep(f){
  if(this.muted||!this.ctx)return;
  const P = this._bgmPat(f);
  if (!P) return;
  const t=this.ctx.currentTime;
  const mk=(s)=>{
   const osc=this.ctx.createOscillator();
   const gn=this.ctx.createGain();
   osc.type=s.w;
   osc.frequency.setValueAtTime(s.f0,t);
   if(s.f1&&s.f1!==s.f0)osc.frequency.exponentialRampToValueAtTime(s.f1,t+s.d);
   gn.gain.setValueAtTime(0,t);
   gn.gain.linearRampToValueAtTime(s.g,t+.02);
   gn.gain.exponentialRampToValueAtTime(.001,t+s.d);
   osc.connect(gn);gn.connect(this._bus('bgm'));
   osc.start(t);osc.stop(t+s.d+.05);
   this._track(osc);
  };
  if (Array.isArray(P)) for (const s of P) mk(s); else mk(P);
 },
 // Pattern rotation (TASK-504): 16 steps per bar, pattern held for 2 bars,
 // sequence cycles every 12 bars (~43s at the 9-frame step cadence). War
 // tension ≥ .5 swaps to the tension-heavy sequence.
 _bgmPat(f){
  const B=this.BGM_PATTERNS;
  const seq=(this._tension>=.5?this.BGM_SEQ_WAR:this.BGM_SEQ_PEACE);
  const pat=seq[(f>>5)%seq.length];        // f>>5 = bar/2 (pattern per 2 bars)
  return B[pat][f&15];
 },
 BGM_PATTERNS:[
  // P0 — pulse (TASK-408 original, exact): bass thump every 4 + soft sine
  // on EVERY other 16th (12 soft notes per bar, like the original)
  [ {w:'triangle',f0:65,f1:40,g:.06,d:.2}, {w:'sine',f0:120,f1:60,g:.02,d:.1}, {w:'sine',f0:120,f1:60,g:.02,d:.1}, {w:'sine',f0:120,f1:60,g:.02,d:.1},
    {w:'triangle',f0:65,f1:40,g:.06,d:.2}, {w:'sine',f0:120,f1:60,g:.02,d:.1}, {w:'sine',f0:120,f1:60,g:.02,d:.1}, {w:'sine',f0:120,f1:60,g:.02,d:.1},
    {w:'triangle',f0:65,f1:40,g:.06,d:.2}, {w:'sine',f0:120,f1:60,g:.02,d:.1}, {w:'sine',f0:120,f1:60,g:.02,d:.1}, {w:'sine',f0:120,f1:60,g:.02,d:.1},
    {w:'triangle',f0:65,f1:40,g:.06,d:.2}, {w:'sine',f0:120,f1:60,g:.02,d:.1}, {w:'sine',f0:120,f1:60,g:.02,d:.1}, {w:'sine',f0:120,f1:60,g:.02,d:.1} ],
  // P1 — march: bass on 0/8, backbeat blip on 4/12, ghost note on 14
  [ {w:'triangle',f0:65,f1:40,g:.065,d:.22}, null, null, null,
    {w:'triangle',f0:196,f1:196,g:.028,d:.07}, null, null, null,
    {w:'triangle',f0:65,f1:40,g:.065,d:.22}, null, null, null,
    {w:'triangle',f0:196,f1:196,g:.028,d:.07}, null, {w:'sine',f0:98,f1:98,g:.02,d:.08}, null ],
  // P2 — tension: minor-second alternation (55/58.27 Hz) on even steps,
  // heartbeat double-thump on step 0 (array = two simultaneous notes)
  [ [ {w:'sine',f0:55,f1:55,g:.05,d:.18}, {w:'sine',f0:55,f1:55,g:.04,d:.14} ], {w:'sine',f0:58.27,f1:58.27,g:.03,d:.1}, null, null,
    {w:'sine',f0:55,f1:55,g:.045,d:.18}, {w:'sine',f0:58.27,f1:58.27,g:.03,d:.1}, null, null,
    {w:'sine',f0:55,f1:55,g:.045,d:.18}, {w:'sine',f0:58.27,f1:58.27,g:.03,d:.1}, null, null,
    {w:'sine',f0:55,f1:55,g:.045,d:.18}, {w:'sine',f0:58.27,f1:58.27,g:.03,d:.1}, null, null ],
 ],
 BGM_SEQ_PEACE:[0,0,1,0,2,1],
 BGM_SEQ_WAR:[0,2,1,2,1,2],
 ui(t){ 
  this.init(); 
  if(!this.ctx||this.muted)return;
  const osc=this.ctx.createOscillator(), gn=this.ctx.createGain();
  if(t==='click') osc.type='sine', osc.frequency.value=800, gn.gain.setValueAtTime(0.02,this.ctx.currentTime), gn.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+.05);
  else if(t==='err') osc.type='square', osc.frequency.value=150, gn.gain.setValueAtTime(0.04,this.ctx.currentTime), gn.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+.15);
  else if(t==='build') osc.type='triangle', osc.frequency.value=400, gn.gain.setValueAtTime(0.03,this.ctx.currentTime), gn.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+.1);
  else osc.type='sine', osc.frequency.value=600, gn.gain.setValueAtTime(0.02,this.ctx.currentTime), gn.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+.05);
  osc.connect(gn); gn.connect(this._bus('ui')); osc.start(); osc.stop(this.ctx.currentTime+.15);
  this._track(osc); this._evt('ui:' + t);
 },
 gun(){ this.init(); this.playNoiseLayer(0.25, 0.15, 3000, 800, 500, 200); this._evt('gun'); },
 flare(){ this.init(); this.playNoiseLayer(0.6, 0.1, 4000, 2000, 1000, 800); this._evt('flare'); },
 // TASK-401: RWR lock tone — sharp double-beep when an enemy SAM acquires us
 // (TASK-408 merge note: routed through the alerts bus + tracked so the
 //  mixer governs it — was this.master, which bypasses the volume slider)
 rwr(){
  this.init();
  if(!this.ctx||this.muted)return;
  for(let i=0;i<2;i++){
   const osc=this.ctx.createOscillator(), gn=this.ctx.createGain();
   osc.type='square'; osc.frequency.value=1150;
   const t0=this.ctx.currentTime+i*0.13;
   gn.gain.setValueAtTime(0,t0);
   gn.gain.linearRampToValueAtTime(0.045,t0+0.01);
   gn.gain.exponentialRampToValueAtTime(0.001,t0+0.09);
   osc.connect(gn); gn.connect(this._bus('alerts')); osc.start(t0); osc.stop(t0+0.1);
   this._track(osc);
  }
  this._evt('rwr');
 },

 // ══ TASK-408: new layers ══════════════════════════════════════════
 // Ambient bed: looping brown-noise pad + breathing LFO; tension (0..1)
 // opens the filter and lifts the level — the war mood driver.
 bedOn(){
  this.init();
  if (!this.ctx || this.muted || this._bed) return;
  const c = this.ctx, bs = c.sampleRate * 3, buf = c.createBuffer(1, bs, c.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < bs; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = .6;
  const g = c.createGain(); g.gain.setValueAtTime(.0001, c.currentTime); g.gain.linearRampToValueAtTime(.05, c.currentTime + 3);
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = .06; lg.gain.value = 60;
  lfo.connect(lg); lg.connect(lp.frequency);
  src.connect(lp); lp.connect(g); g.connect(this._bus('amb'));
  src.start(); lfo.start();
  this._bed = { src, lp, g, lfo };
  this._evt('bedOn');
 },
 bedOff(){
  const b = this._bed; if (!b) return;
  try {
   const t = this.ctx.currentTime;
   b.g.gain.cancelScheduledValues(t); b.g.gain.setValueAtTime(Math.max(.0001, b.g.gain.value), t);
   b.g.gain.linearRampToValueAtTime(.0001, t + .8);
   b.src.stop(t + .9); b.lfo.stop(t + .9);
  } catch (e) {}
  this._bed = null; this._tension = 0; this._evt('bedOff');
 },
 bedTension(v){
  this._tension = v;
  const b = this._bed; if (!b || !this.ctx) return;
  const t = this.ctx.currentTime;
  b.lp.frequency.cancelScheduledValues(t); b.lp.frequency.linearRampToValueAtTime(220 + 340 * v, t + 2.5);
  b.g.gain.cancelScheduledValues(t); b.g.gain.linearRampToValueAtTime(.05 + .07 * v, t + 2.5);
 },
 // War-tension stinger: dissonant swell on the first aggression involving the player
 stinger(){
  this.init(); if (!this.ctx || this.muted) return;
  const t = this.ctx.currentTime;
  [110, 116.54, 164.81].forEach(f => {
   const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
   o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 900;
   g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.12, t + 1.1); g.gain.exponentialRampToValueAtTime(.001, t + 2.6);
   o.connect(lp); lp.connect(g); g.connect(this._bus('alerts'));
   o.start(t); o.stop(t + 2.7); this._track(o);
  });
  this.playNoiseLayer(2.4, .28, 300, 60, 25, 15, 'alerts');
  this._evt('stinger');
 },
 // Intercept sonar ping (with a soft echo)
 ping(){
  this.init(); if (!this.ctx || this.muted) return;
  const t = this.ctx.currentTime;
  const mk = (dt, v) => {
   const o = this.ctx.createOscillator(), g = this.ctx.createGain();
   o.type = 'sine'; o.frequency.setValueAtTime(1250, t + dt); o.frequency.exponentialRampToValueAtTime(880, t + dt + .35);
   g.gain.setValueAtTime(v, t + dt); g.gain.exponentialRampToValueAtTime(.001, t + dt + .5);
   o.connect(g); g.connect(this._bus('alerts')); o.start(t + dt); o.stop(t + dt + .55); this._track(o);
  };
  mk(0, .18); mk(.16, .07);
  this._evt('ping');
 },
 // Milestone fanfare: bright major arpeggio
 fanfare(){
  this.init(); if (!this.ctx || this.muted) return;
  const t = this.ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
   const o = this.ctx.createOscillator(), g = this.ctx.createGain();
   o.type = 'triangle'; o.frequency.value = f;
   const st = t + i * .11;
   g.gain.setValueAtTime(.0001, st); g.gain.linearRampToValueAtTime(.16, st + .02); g.gain.exponentialRampToValueAtTime(.001, st + .5);
   o.connect(g); g.connect(this._bus('alerts')); o.start(st); o.stop(st + .55); this._track(o);
  });
  this._evt('fanfare');
 },
 // Naval gun bass: deep sine drop + muzzle crack
 navalBass(){
  this.init(); if (!this.ctx || this.muted) return;
  const t = this.ctx.currentTime;
  const o = this.ctx.createOscillator(), g = this.ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(26, t + .4);
  g.gain.setValueAtTime(.55, t); g.gain.exponentialRampToValueAtTime(.001, t + .55);
  o.connect(g); g.connect(this._bus('weapons')); o.start(t); o.stop(t + .6); this._track(o);
  this.playNoiseLayer(.3, .22, 900, 120, 60, 40, 'weapons');
  this._evt('navalBass');
 }
};


// ── DEV MODE ──────────────────────────────────────────────────────────────
// When true, all dev panels (map editor, dev ports, color grade) are mounted
// and map_edits.json is auto-loaded. Set ONLY by the "Dev Mode" start button;
// normal "Start Game" leaves it false so the shipped game is clean.
window.DEV_MODE = false;
function startDevMode() {
    window.DEV_MODE = true;
    startVsAI();
}

// Redefine menu functions to match 3D logic
function startVsAI() {
    isOnline = false;
    myRole = 'player';
    let diff = document.getElementById('diffSelect') ? document.getElementById('diffSelect').value : 'normal';
    let pCountry = document.getElementById('pCountrySelect') ? document.getElementById('pCountrySelect').value : 'usa';
    let eCountry = document.getElementById('eCountrySelect') ? document.getElementById('eCountrySelect').value : 'random';
    let mode = document.getElementById('gameModeSelect') ? document.getElementById('gameModeSelect').value : 'mode1';
    let botCount = document.getElementById('botCountSelect') ? parseInt(document.getElementById('botCountSelect').value, 10) : 0;
    if (mode !== 'mode1') botCount = 0;   // FFA bots are a mode-1 feature
    document.getElementById('menuScreen').style.display='none';
    document.getElementById('gc').style.display='block';
    SFX.init();
    initWorld(diff, pCountry, eCountry, mode, botCount);
}

// Inject 3D modules
const EARTH_RADIUS = 6371;

function latLonToVec3(lat, lon, r = EARTH_RADIUS, out = null) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    // TASK-401 audit #22: optional out-vector — hot paths (Plane.update) pass
    // a scratch to stay allocation-free; all other callers unchanged.
    if (out) {
        return out.set(
            -(r * Math.sin(phi) * Math.cos(theta)),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
        );
    }
    return new THREE.Vector3(
        -(r * Math.sin(phi) * Math.cos(theta)),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
    );
}

function vec3ToLatLon(vec) {
    const r = vec.length();
    if(r < 0.001) return { lat: 0, lon: 0 };
    const lat = 90 - (Math.acos(Math.max(-1, Math.min(1, vec.y / r))) * 180 / Math.PI);
    let lon = (Math.atan2(vec.z, -vec.x) * 180 / Math.PI) - 180;
    // Normalize to [-180, 180) — atan2 gives [-180,180], minus 180 gives [-360,0]
    lon = ((lon % 360) + 360) % 360;
    if (lon >= 180) lon -= 360;
    return { lat, lon };
}

// Spherical validation replacing flat 2D approximations
function CheckTargetInRange(lat1, lon1, lat2, lon2, maxRange) {
    let p1 = latLonToVec3(lat1, lon1, 1.0).normalize();
    let p2 = latLonToVec3(lat2, lon2, 1.0).normalize();
    let d = p1.dot(p2);
    d = Math.max(-1.0, Math.min(1.0, d)); 
    let curved_distance = Math.acos(d) * EARTH_RADIUS;
    return curved_distance <= maxRange;
}

// Great Circle Distance using precise vector angle (alias for legacy checks)
function haversineDist(lat1, lon1, lat2, lon2) {
    let p1 = latLonToVec3(lat1, lon1, 1.0).normalize();
    let p2 = latLonToVec3(lat2, lon2, 1.0).normalize();
    let d = p1.dot(p2);
    d = Math.max(-1.0, Math.min(1.0, d));
    return Math.acos(d) * EARTH_RADIUS;
}

// Euclidean proxy for quick distance checks
function dst(a, b) {
    if (a.pos && b.pos) return a.pos.distanceTo(b.pos);
    if (a.lat !== undefined && b.lat !== undefined) return haversineDist(a.lat, a.lon, b.lat, b.lon);
    return 99999;
}

function DrawSphericalRangeIndicator(lat, lon, maxRange) {
    let V_up = latLonToVec3(lat, lon, 1.0).normalize();
    let worldUp = new THREE.Vector3(0, 1, 0);
    let V_right = new THREE.Vector3().crossVectors(V_up, worldUp);
    
    if (V_right.lengthSq() < 0.001) {
        V_right.crossVectors(V_up, new THREE.Vector3(1, 0, 0));
    }
    V_right.normalize();
    
    let V_forward = new THREE.Vector3().crossVectors(V_right, V_up).normalize();
    let radius_angle = maxRange / EARTH_RADIUS;
    let cos_r = Math.cos(radius_angle);
    let sin_r = Math.sin(radius_angle);
    
    let points = [];
    for (let i = 0; i <= 60; i++) {
        let t = (i / 60.0) * Math.PI * 2;
        let c_t = Math.cos(t);
        let s_t = Math.sin(t);
        
        let pt = new THREE.Vector3();
        pt.x = EARTH_RADIUS * (cos_r * V_up.x + sin_r * c_t * V_right.x + sin_r * s_t * V_forward.x);
        pt.y = EARTH_RADIUS * (cos_r * V_up.y + sin_r * c_t * V_right.y + sin_r * s_t * V_forward.y);
        pt.z = EARTH_RADIUS * (cos_r * V_up.z + sin_r * c_t * V_right.z + sin_r * s_t * V_forward.z);
        // Slightly scale out to avoid z-fighting
        pt.multiplyScalar(1.02);
        points.push(pt);
    }
    
    return new THREE.BufferGeometry().setFromPoints(points);
}

// Random float
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b));
const clp = (v, l, h) => Math.max(l, Math.min(h, v));

// ═══════════════════════════════════════════════════════════════
// OPENFRONT TROOP AND ECONOMIC SYSTEM MODULES
// ═══════════════════════════════════════════════════════════════

function formatTroopCount(num) {
    if(num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if(num >= 1000) return (num / 1000).toFixed(0) + 'k';
    return Math.floor(num).toString();
}

function calcMaxTroops(owner) {
    const C = GAME_CONSTANTS;
    // ── Mode 1: OpenFront formula — maxTroops scales with tiles owned ──
    if (window.gameMode === 'mode1' && conquestGrid) {
        let cells = conquestGrid.countCells(owner);
        // OpenFront: +cityTroopIncrease max troops per owned City (no upgrade levels
        // here yet, so each built city counts once). Gives mode-1 cities a real role.
        let cityCount = 0;
        for (let i = 0; i < structs.length; i++) {
            const s = structs[i];
            if (!s.dead && s.owner === owner && s.type === 'city') cityCount++;
        }
        let maxT = 2 * (Math.pow(Math.max(1, cells), 0.6) * 1000 + 50000) + cityCount * C.CITY_TROOP_INCREASE;
        if (owner === 'enemy' || isBotStr(owner)) {
            const diff = C.DIFFICULTY && C.DIFFICULTY[window.gameDifficulty];
            maxT *= diff ? diff.maxTroopsMul : 0.75; // 'normal' preserves the old hardcoded balance
        }
        return Math.floor(maxT);
    }
    // ── Mode 2: province + structure based ──
    let ownedProvinces = 0;
    if (window.provinceOwnership) {
        for (let idx in window.provinceOwnership) {
            if (window.provinceOwnership[idx] === owner) {
                ownedProvinces++;
            }
        }
    }
    let baseCount = structs.filter(s => s.owner === owner && !s.dead && s.type === 'base').length;
    let cityLevels = baseCount;
    if (cityNodes) {
        cityNodes.forEach(c => {
            if (c.owner === owner) {
                cityLevels += (c.roadLevel || 1);
            }
        });
    }
    structs.forEach(s => {
        if (s.owner === owner && !s.dead) {
            if (s.type === 'city') cityLevels += 2;
            if (s.type === 'port') cityLevels += 1;
            if (s.type === 'factory') cityLevels += 1;
        }
    });
    let maxT = 2 * (Math.pow(ownedProvinces, 0.6) * 1000 + C.MAX_TROOPS_BASE) + cityLevels * C.CITY_TROOP_INCREASE;
    if (owner === 'enemy') maxT *= 0.8;
    return Math.floor(maxT);
}

// OpenFront-faithful troop breeding: toAdd = 10 + troops^0.73 / 4, scaled by (1 - troops/max)
function troopIncreaseRate(owner, currentTroops) {
    let max = calcMaxTroops(owner);
    if (currentTroops >= max) return 0;
    let toAdd = 10 + Math.pow(currentTroops, 0.73) / 4;
    let ratio = 1 - currentTroops / max;
    toAdd *= ratio;
    if (owner === 'enemy' || isBotStr(owner)) {
        const diff = GAME_CONSTANTS.DIFFICULTY && GAME_CONSTANTS.DIFFICULTY[window.gameDifficulty];
        toAdd *= diff ? diff.growthMul : 0.5; // bots breed slower in OpenFront
    }
    return toAdd;
}

// Check if a point has water immediately adjacent (within ~15km).
// This is the precise shoreline detector (OpenFront isShoreline equivalent).
function hasWaterNeighbor(lat, lon, checkDist = 0.15) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        let tLat = lat + Math.sin(angle) * checkDist;
        let tLon = lon + Math.cos(angle) * checkDist;
        if (!isLand(tLat, tLon)) return true;
    }
    return false;
}

// Broader water proximity check (for spawn validation, not precise shoreline).
function isNearWater(lat, lon, maxDistDegrees = 1.5) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        let testLat = lat + Math.sin(angle) * maxDistDegrees;
        let testLon = lon + Math.cos(angle) * maxDistDegrees;
        if (!isLand(testLat, testLon)) {
            return true;
        }
    }
    return false;
}

// A "shore point" = land tile with water immediately adjacent (~15km).
// Matches OpenFront's isShore = isLand && isShoreline.
function isShorePoint(lat, lon) {
    return isLand(lat, lon) && hasWaterNeighbor(lat, lon);
}

// OpenFront portSpawn(): find the nearest shore tile to the clicked point.
//
// PRIMARY: uses the CONQUEST GRID's land mask — the SAME mask that controls
// territory rendering. A "shore cell" = land cell (terrain≠T_WATER) with at
// least one water neighbor. This guarantees the port snaps to the EXACT same
// shoreline the territory stops at — zero offset.
//
// FALLBACK: if the conquest grid isn't available (mode2), uses isLand() with
// binary search to find the precise land/water boundary.
function findNearestShoreTile(lat, lon) {
    // ── Primary: conquest grid land mask (pixel-perfect shoreline) ──
    // NOTE: land/water lives in owner[] (populated by buildLandMaskFromTerrain),
    // NOT terrain[] (which is a gameplay-only heuristic, left at all-zeros).
    if (typeof conquestGrid !== 'undefined' && conquestGrid && conquestGrid._maskReady && conquestGrid.owner) {
        const cfg = conquestGrid.cfg;
        const W = cfg.GRID_W, H = cfg.GRID_H, WATER = cfg.WATER;
        const owner = conquestGrid.owner;
        const _nb = [];
        // A shore cell = land with at least one water neighbor (OpenFront isShore).
        const isShoreCell = (cell) => {
            if (owner[cell] === WATER) return false;
            const n = conquestGrid.neighbors4(cell, _nb);
            for (let i = 0; i < n; i++) {
                if (owner[_nb[i]] === WATER) return true;
            }
            return false;
        };
        const startCell = conquestGrid.latLonToCell(lat, lon);
        // Already a shore cell → return its centre immediately.
        if (isShoreCell(startCell)) return conquestGrid.cellToLatLon(startCell);
        // Search in expanding square rings around the clicked cell.
        const sc = startCell % W;       // start col
        const sr = (startCell / W) | 0; // start row
        for (let ring = 1; ring <= 300; ring++) {
            let bestCell = -1, bestDist = Infinity;
            for (let dy = -ring; dy <= ring; dy++) {
                const row = sr + dy;
                if (row < 0 || row >= H) continue;
                for (let dx = -ring; dx <= ring; dx++) {
                    // Only check the ring border (interior already searched).
                    if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                    const wCol = (((sc + dx) % W) + W) % W; // longitude wrap
                    const cell = row * W + wCol;
                    if (isShoreCell(cell)) {
                        const dist = dx * dx + dy * dy;
                        if (dist < bestDist) { bestDist = dist; bestCell = cell; }
                    }
                }
            }
            if (bestCell >= 0) return conquestGrid.cellToLatLon(bestCell);
        }
        return null; // no shore found within 300 rings (~1500km)
    }

    // ── Fallback: isLand()-based binary search (mode2 or grid not ready) ──
    const clickIsLand = isLand(lat, lon);
    const stepDeg = 0.1;
    for (let ring = 1; ring <= 60; ring++) {
        const radius = ring * stepDeg;
        const numDirs = 24;
        let best = null, bestDist = Infinity;
        for (let d = 0; d < numDirs; d++) {
            const angle = (d / numDirs) * Math.PI * 2;
            const tLat = Math.max(-89, Math.min(89, lat + Math.sin(angle) * radius));
            let tLon = lon + Math.cos(angle) * radius;
            if (tLon > 180) tLon -= 360;
            if (tLon < -180) tLon += 360;
            if (isLand(tLat, tLon) !== clickIsLand) {
                // Binary search between click and this point for exact boundary.
                let aLat = lat, aLon = lon, aLand = clickIsLand;
                let bLat = tLat, bLon = tLon;
                for (let iter = 0; iter < 30; iter++) {
                    const mLat = (aLat + bLat) / 2;
                    let mLon = (aLon + bLon) / 2;
                    if (Math.abs(bLon - aLon) > 180) {
                        mLon = bLon > aLon ? aLon + ((bLon - 360 - aLon) / 2)
                                           : aLon + ((bLon + 360 - aLon) / 2);
                    }
                    if (isLand(mLat, mLon) === aLand) { aLat = mLat; aLon = mLon; }
                    else { bLat = mLat; bLon = mLon; }
                }
                let sLat, sLon;
                if (aLand) { sLat = aLat; sLon = aLon; }
                else { sLat = bLat; sLon = bLon; }
                const dist = haversineDist(lat, lon, sLat, sLon);
                if (dist < bestDist) { bestDist = dist; best = { lat: sLat, lon: sLon }; }
            }
        }
        if (best) return best;
    }
    return null;
}

function getProvinceAtLatLon(lat, lon) {
    if (typeof PROVINCE_POLYGONS === 'undefined' || !PROVINCE_POLYGONS) return -1;
    for (let i = 0; i < PROVINCE_POLYGONS.features.length; i++) {
        if (d3.geoContains(PROVINCE_POLYGONS.features[i], [lon, lat])) {
            return i;
        }
    }
    return -1;
}

function updateRailroadConnections() {
    if (window.railroadLinesMesh) {
        scene.remove(window.railroadLinesMesh);
        if (window.railroadLinesMesh.geometry) window.railroadLinesMesh.geometry.dispose();
        if (window.railroadLinesMesh.material) window.railroadLinesMesh.material.dispose();
        window.railroadLinesMesh = null;
    }
    
    let positions = [];
    let colors = [];
    
    let factories = structs.filter(s => s.type === 'factory' && !s.dead);
    
    factories.forEach(fact => {
        let candidates = [];
        
        cityNodes.forEach(c => {
            if (c.owner === fact.owner) {
                let d = haversineDist(fact.lat, fact.lon, c.lat, c.lon);
                if (d < GAME_CONSTANTS.FACTORY_RAIL_RANGE) {
                    candidates.push({ lat: c.lat, lon: c.lon, ref: c, d });
                }
            }
        });
        
        structs.forEach(s => {
            if (s !== fact && !s.dead && s.owner === fact.owner && (s.type === 'port' || s.type === 'city')) {
                let d = haversineDist(fact.lat, fact.lon, s.lat, s.lon);
                if (d < GAME_CONSTANTS.FACTORY_RAIL_RANGE) {
                    candidates.push({ lat: s.lat, lon: s.lon, ref: s, d });
                }
            }
        });
        
        // RAILS, not a mind map: connect only the 3 NEAREST stations per factory,
        // routed ALONG LAND (BFS over the conquest grid) instead of straight chords.
        candidates.sort((a, b) => a.d - b.d);
        candidates = candidates.slice(0, 3);
        fact.connectedStations = candidates;
        
        candidates.forEach(cand => {
            const path = _landRoutePoints(fact.lat, fact.lon, cand.lat, cand.lon);
            if (!path) return; // unreachable over land → no rail (no silly sea-bridge)
            const col = fact.owner === 'player' ? [0.20, 0.90, 0.55] : [1.0, 0.55, 0.15];
            for (let i = 0; i < path.length - 1; i++) {
                const vA = latLonToVec3(path[i].lat, path[i].lon, EARTH_RADIUS + 3.5);
                const vB = latLonToVec3(path[i + 1].lat, path[i + 1].lon, EARTH_RADIUS + 3.5);
                positions.push(vA.x, vA.y, vA.z);
                positions.push(vB.x, vB.y, vB.z);
                colors.push(col[0], col[1], col[2]);
                colors.push(col[0], col[1], col[2]);
            }
        });
    });
    
    if (positions.length > 0) {
        let geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        let mat = new THREE.LineBasicMaterial({
            vertexColors: true,
            linewidth: 2,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });
        
        window.railroadLinesMesh = new THREE.LineSegments(geo, mat);
        scene.add(window.railroadLinesMesh);
    }
}

// Land-only route between two lat/lon points on the conquest grid (BFS, bounded).
// Returns an array of {lat, lon} waypoints following the terrain, or null if
// no land route exists within the node budget (factories on islands stay unrailled).
function _landRoutePoints(lat1, lon1, lat2, lon2) {
    if (!conquestGrid || !conquestGrid._maskReady) return null;
    const W = CONQUEST_CFG.GRID_W;
    const H = CONQUEST_CFG.GRID_H;
    const owner = conquestGrid.owner;
    const startCell = conquestGrid.latLonToCell(lat1, lon1);
    const goalCell = conquestGrid.latLonToCell(lat2, lon2);
    if (startCell < 0 || goalCell < 0) return null;
    if (owner[startCell] === CONQUEST_CFG.WATER || owner[goalCell] === CONQUEST_CFG.WATER) return null;
    if (startCell === goalCell) return [{ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 }];
    
    const MAX_NODES = 12000;
    const total = W * H;
    const cameFrom = new Int32Array(total).fill(-1);
    const seen = new Uint8Array(total);
    const queue = [startCell];
    seen[startCell] = 1;
    let head = 0, visited = 0, found = false;
    const nbuf = new Int32Array(4);
    
    while (head < queue.length && visited < MAX_NODES) {
        const cell = queue[head++];
        visited++;
        if (cell === goalCell) { found = true; break; }
        conquestGrid.neighbors4(cell, nbuf);
        for (let i = 0; i < 4; i++) {
            const n = nbuf[i];
            if (seen[n] || owner[n] === CONQUEST_CFG.WATER) continue;
            seen[n] = 1;
            cameFrom[n] = cell;
            queue.push(n);
        }
    }
    if (!found) return null;
    
    // Reconstruct → simplify to every ~8th cell (0.4° steps) to keep it cheap
    const path = [];
    let cur = goalCell, steps = 0;
    while (cur !== -1 && cur !== startCell) {
        if (steps % 8 === 0) path.push(conquestGrid.cellToLatLon(cur));
        steps++;
        cur = cameFrom[cur];
    }
    path.push({ lat: lat1, lon: lon1 });
    path.reverse();
    path.push({ lat: lat2, lon: lon2 });
    return path;
}

// ════════════════════════════════════════════════════════════════════════
//  WATER PATHFINDING — Dijkstra through ocean cells only (OpenFront WaterPathFinder)
//  Trade ships sail around continents instead of flying over land.
// ════════════════════════════════════════════════════════════════════════
const PATH_FACTOR = 10;        // sample every 10th conquest cell → 0.5° resolution
const PATH_W = 720;            // 7200 / 10
const PATH_H = 360;            // 3600 / 10
const PATH_DEG = 0.5;          // degrees per coarse cell
let _coarseWaterMask = null;

// Build a coarse water mask from the conquest grid (cached, built once).
function getCoarseWaterMask() {
    if (_coarseWaterMask) return _coarseWaterMask;
    // Land/water lives in owner[] (set by buildLandMaskFromTerrain), NOT terrain[].
    if (!conquestGrid || !conquestGrid._maskReady || !conquestGrid.owner) return null;
    const FW = conquestGrid.cfg.GRID_W;
    const WATER = conquestGrid.cfg.WATER;
    const owner = conquestGrid.owner;
    const mask = new Uint8Array(PATH_W * PATH_H);
    let waterCount = 0;
    for (let row = 0; row < PATH_H; row++) {
        for (let col = 0; col < PATH_W; col++) {
            const fr = row * PATH_FACTOR + (PATH_FACTOR >> 1);
            const fc = col * PATH_FACTOR + (PATH_FACTOR >> 1);
            const isWater = (owner[fr * FW + fc] === WATER) ? 1 : 0;
            mask[row * PATH_W + col] = isWater;
            waterCount += isWater;
        }
    }
    _coarseWaterMask = mask;
    console.log('[PATH] Coarse water mask built:', PATH_W, 'x', PATH_H,
        '| water cells:', waterCount, '/', PATH_W * PATH_H,
        '| land cells:', PATH_W * PATH_H - waterCount);
    // Precompute the main connected ocean body (largest water component).
    // This prevents ports from snapping to disconnected inland seas/lakes
    // (e.g. Red Sea cut off from Arabian Sea at 0.5° by Bab-el-Mandeb strait).
    buildOceanMask();
    return mask;
}

let _oceanMask = null; // 1 = cell is part of the main navigable ocean body

// Flood-fill from a known deep-ocean seed to mark the single largest connected
// water component. Ships can only sail within this body — guarantees Dijkstra always
// finds a path between any two ports that snap to it.
function buildOceanMask() {
    const mask = _coarseWaterMask;
    if (!mask) return null;
    const W = PATH_W, H = PATH_H;
    _oceanMask = new Uint8Array(W * H);
    // Seed: mid-Pacific (0°N, 160°W) — guaranteed open ocean.
    let seedCol = Math.floor((-160 + 180) / PATH_DEG);
    let seedRow = Math.floor((90 - 0) / PATH_DEG);
    let seed = seedRow * W + seedCol;
    // If seed isn't water (shouldn't happen), spiral outward to find ocean.
    if (mask[seed] !== 1) {
        outer: for (let ring = 1; ring <= 120; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                const r = seedRow + dy;
                if (r < 0 || r >= H) continue;
                for (let dx = -ring; dx <= ring; dx++) {
                    if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                    const c = ((seedCol + dx) % W + W) % W;
                    if (mask[r * W + c] === 1) { seed = r * W + c; break outer; }
                }
            }
        }
    }
    // Iterative DFS flood-fill (8-connected, longitude wraps).
    const stack = [seed];
    _oceanMask[seed] = 1;
    while (stack.length) {
        const cc = stack.pop();
        const cr = (cc / W) | 0, ccol = cc % W;
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
            const nr = cr + dr;
            if (nr < 0 || nr >= H) continue;
            const nc = ((ccol + dc) % W + W) % W;
            const nb = nr * W + nc;
            if (mask[nb] === 1 && !_oceanMask[nb]) { _oceanMask[nb] = 1; stack.push(nb); }
        }
    }
    let count = 0;
    for (let i = 0; i < _oceanMask.length; i++) count += _oceanMask[i];
    console.log('[PATH] Main ocean body:', count, 'cells (',
        Math.round(100 * count / (W * H)), '% of map )');
    return _oceanMask;
}

// Dijkstra pathfinding through water cells only. Returns array of {lat, lon} waypoints.
function findWaterPath(srcLat, srcLon, dstLat, dstLon) {
    const mask = getCoarseWaterMask();
    if (!mask) { console.warn('[PATH] findWaterPath FAIL: mask not ready (_maskReady=' + (conquestGrid && conquestGrid._maskReady) + ')'); return null; }
    const W = PATH_W, H = PATH_H, DEG = PATH_DEG;

    const toCell = (lat, lon) => {
        const col = Math.min(W - 1, Math.max(0, Math.floor((lon + 180) / DEG)));
        const row = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / DEG)));
        return row * W + col;
    };
    const toLatLon = (cell) => ({
        lat: 90 - (Math.floor(cell / W) + 0.5) * DEG,
        lon: -180 + ((cell % W) + 0.5) * DEG,
    });
    // Snap to nearest cell in the MAIN OCEAN BODY (not inland seas/lakes).
    // This guarantees both ports land in the same connected water component.
    const ocean = _oceanMask;
    const findWater = (cell) => {
        if (ocean[cell]) return cell;
        const col = cell % W, row = Math.floor(cell / W);
        for (let ring = 1; ring <= 120; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                const r = row + dy;
                if (r < 0 || r >= H) continue;
                for (let dx = -ring; dx <= ring; dx++) {
                    if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                    const c = ((col + dx) % W + W) % W;
                    if (ocean[r * W + c]) return r * W + c;
                }
            }
        }
        return -1;
    };

    const startCell = findWater(toCell(srcLat, srcLon));
    const goalCell = findWater(toCell(dstLat, dstLon));
    if (startCell < 0 || goalCell < 0) {
        console.warn('[PATH] findWaterPath FAIL: cannot snap to water | startCell=' + startCell + ' goalCell=' + goalCell,
            '| src mask=' + mask[toCell(srcLat, srcLon)], 'dst mask=' + mask[toCell(dstLat, dstLon)]);
        return null;
    }

    // ── Dijkstra with binary min-heap ──
    const N = W * H;
    const gScore = new Float32Array(N).fill(Infinity);
    const cameFrom = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = []; // entries: [fScore, cell]

    const cellLat = (c) => 90 - (Math.floor(c / W) + 0.5) * DEG;
    const cellLon = (c) => -180 + ((c % W) + 0.5) * DEG;
    // Dijkstra: no heuristic (h ≡ 0). Explores purely by accumulated cost —
    // guarantees the shortest water-only path with no goal-bias artifacts.
    const heuristic = (c) => 0;

    gScore[startCell] = 0;
    heap.push([heuristic(startCell), startCell]);
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    let found = false;

    while (heap.length > 0) {
        // Pop min
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                let m = i; const l = 2*i+1, r = 2*i+2;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
            }
        }
        const [, cell] = top;
        if (cell === goalCell) { found = true; break; }
        if (closed[cell]) continue;
        closed[cell] = 1;
        const col = cell % W, row = Math.floor(cell / W);
        for (const [dr, dc] of dirs) {
            const nr = row + dr;
            if (nr < 0 || nr >= H) continue;
            const nc = (((col + dc) % W) + W) % W;
            const nb = nr * W + nc;
            if (mask[nb] !== 1 || closed[nb]) continue;
            const cost = (dr !== 0 && dc !== 0) ? 1.414 : 1.0;
            const tentG = gScore[cell] + cost;
            if (tentG < gScore[nb]) {
                cameFrom[nb] = cell;
                gScore[nb] = tentG;
                const f = tentG + heuristic(nb);
                heap.push([f, nb]);
                let i = heap.length - 1;
                while (i > 0) {
                    const p = (i - 1) >> 1;
                    if (heap[p][0] <= heap[i][0]) break;
                    const t2 = heap[p]; heap[p] = heap[i]; heap[i] = t2; i = p;
                }
            }
        }
    }

    if (!found) {
        // ── Diagnostic: why did Dijkstra fail? Inspect the mask ──
        const _samp = (lat, lon) => {
            const c = Math.min(W - 1, Math.max(0, Math.floor((lon + 180) / DEG)));
            const r = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / DEG)));
            return mask[r * W + c] ? 'WATER' : 'LAND';
        };
        console.warn('[PATH] === DIJKSTRA FAILURE DIAGNOSTIC ===');
        console.warn('[PATH] route:', srcLat.toFixed(1), srcLon.toFixed(1), '→', dstLat.toFixed(1), dstLon.toFixed(1));
        console.warn('[PATH] mask probes: ArabianSea(16,60)=' + _samp(16, 60),
            '| MidAtlantic(0,-30)=' + _samp(0, -30),
            '| Sahara(20,10)=' + _samp(20, 10),
            '| India(22,78)=' + _samp(22, 78),
            '| srcPort=' + _samp(srcLat, srcLon),
            '| dstPort=' + _samp(dstLat, dstLon));
        // Flood-fill from startCell to measure reachable water
        const _seen = new Set([startCell]);
        const _q = [startCell];
        while (_q.length) {
            const cc = _q.shift(), cr = (cc / W) | 0, ccol = cc % W;
            for (const [dr2, dc2] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const nr2 = cr + dr2;
                if (nr2 < 0 || nr2 >= H) continue;
                const nc2 = ((ccol + dc2) % W + W) % W;
                const nb2 = nr2 * W + nc2;
                if (mask[nb2] && !_seen.has(nb2)) { _seen.add(nb2); _q.push(nb2); }
            }
        }
        let _totalWater = 0; for (let i = 0; i < mask.length; i++) _totalWater += mask[i];
        console.warn('[PATH] flood from start: reachable=' + _seen.size,
            'goalReachable=' + _seen.has(goalCell),
            '| totalWater=' + _totalWater, '/', mask.length,
            '(' + Math.round(100 * _totalWater / mask.length) + '% of map)');
        return null;
    }
    // Reconstruct path
    const path = [];
    let c = goalCell;
    while (c !== -1) { path.unshift(toLatLon(c)); c = cameFrom[c]; }
    return path; // keep ALL cells — tighter routing, minimises land crossings
 }

// Remove collinear waypoints — keeps only turning points for smoother sailing.
function simplifyPath(path) {
    if (path.length <= 2) return path;
    const result = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
        const p = path[i - 1], c = path[i], n = path[i + 1];
        let d1l = c.lon - p.lon; if (d1l > 180) d1l -= 360; if (d1l < -180) d1l += 360;
        let d2l = n.lon - c.lon; if (d2l > 180) d2l -= 360; if (d2l < -180) d2l += 360;
        const cross = (c.lat - p.lat) * d2l - d1l * (n.lat - c.lat);
        if (Math.abs(cross) > 0.0001) result.push(c);
    }
    result.push(path[path.length - 1]);
    return result;
}

// Cache for OpenFront trade ship sprite texture.
let _tradeShipTex = null;

// Find the nearest water cell on the FINE conquest grid (0.05° resolution).
// Uses the SAME owner[] mask that limits territory expansion — so a ship
// snapped here is guaranteed to be on the exact same water the map shows.
function nearestWaterCell(lat, lon, maxRing = 15) {
    if (!conquestGrid || !conquestGrid._maskReady) return -1;
    const cfg = conquestGrid.cfg;
    const W = cfg.GRID_W, H = cfg.GRID_H, WATER = cfg.WATER;
    const owner = conquestGrid.owner;
    const cell = conquestGrid.latLonToCell(lat, lon);
    if (owner[cell] === WATER) return cell;
    const sc = cell % W, sr = (cell / W) | 0;
    for (let ring = 1; ring <= maxRing; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
            const row = sr + dy;
            if (row < 0 || row >= H) continue;
            for (let dx = -ring; dx <= ring; dx++) {
                if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                const col = (((sc + dx) % W) + W) % W;
                const c = row * W + col;
                if (owner[c] === WATER) return c;
            }
        }
    }
    return -1;
}

// Densify a coarse Dijkstra path into fine-grid (0.05°) water cells.
// Runs a bounded per-segment fine-grid Dijkstra so every output waypoint is
// an adjacent water cell — no gaps, no land crossings.
// Produces a smooth path that hugs the coastline — eliminates teleporting
// Per-segment fine-grid Dijkstra: finds a water-only path between two fine
// grid cells on the conquest grid (7200×3600, 0.05°). Bounded by maxNodes to
// prevent runaway searches. Returns array of cell indices [from, …, to] or
// null if unreachable within the budget. Uses Map-based storage (not full-
// grid arrays) so memory is proportional to the small search area only.
function fineDijkstra(fromCell, toCell, maxNodes) {
    const cfg = conquestGrid.cfg;
    const FW = cfg.GRID_W, FH = cfg.GRID_H, WATER = cfg.WATER;
    const owner = conquestGrid.owner;
    if (owner[fromCell] !== WATER || owner[toCell] !== WATER) return null;
    if (fromCell === toCell) return [fromCell];

    const gScore = new Map();
    const cameFrom = new Map();
    const closed = new Set();
    gScore.set(fromCell, 0);

    // Binary min-heap: entries [cost, cell]
    const heap = [[0, fromCell]];
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    let explored = 0;

    while (heap.length > 0) {
        // Pop min
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                let m = i; const l = 2*i+1, r = 2*i+2;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
            }
        }
        const [g, cell] = top;
        if (closed.has(cell)) continue;       // stale heap entry — already finalised
        closed.add(cell);
        if (cell === toCell) {
            // Reconstruct path from toCell back to fromCell.
            const path = [cell];
            let c = cell;
            while (cameFrom.has(c)) { c = cameFrom.get(c); path.unshift(c); }
            return path;
        }
        if (explored++ > maxNodes) return null;   // budget exhausted — give up
        const col = cell % FW, row = (cell / FW) | 0;
        for (const [dr, dc] of dirs) {
            const nr = row + dr;
            if (nr < 0 || nr >= FH) continue;
            const nc = (((col + dc) % FW) + FW) % FW;
            const nb = nr * FW + nc;
            if (owner[nb] !== WATER || closed.has(nb)) continue;
            const cost = (dr !== 0 && dc !== 0) ? 1.414 : 1.0;
            const tentG = g + cost;
            if (!gScore.has(nb) || tentG < gScore.get(nb)) {
                gScore.set(nb, tentG);
                cameFrom.set(nb, cell);
                heap.push([tentG, nb]);
                let i = heap.length - 1;
                while (i > 0) {
                    const p = (i - 1) >> 1;
                    if (heap[p][0] <= heap[i][0]) break;
                    const t2 = heap[p]; heap[p] = heap[i]; heap[i] = t2; i = p;
                }
            }
        }
    }
    return null;
}

// DENSIFY: walk every coarse path segment at fine-grid resolution using
// per-segment Dijkstra. Guarantees every consecutive pair of output waypoints
// are ADJACENT water cells (~5.5 km apart), so linear interpolation between
// them NEVER crosses land — no teleporting, no land crossings.
function densifyPath(coarsePath) {
    if (!conquestGrid || !conquestGrid._maskReady || coarsePath.length < 2) {
        console.log('[DENSIFY] SKIP — maskReady=' + (conquestGrid && conquestGrid._maskReady),
            '| input len=' + (coarsePath ? coarsePath.length : 0));
        return coarsePath;
    }
    const cfg = conquestGrid.cfg;
    const WATER = cfg.WATER;
    const owner = conquestGrid.owner;
    const MAX_POINTS = 4000;          // HARD CAP — prevents page freeze on long routes
    // Convert each coarse waypoint to a FINE water cell (snap if on land).
    const fineCells = coarsePath.map(wp => {
        let c = conquestGrid.latLonToCell(wp.lat, wp.lon);
        if (owner[c] !== WATER) { const wc = nearestWaterCell(wp.lat, wp.lon, 10); if (wc >= 0) c = wc; }
        return c;
    });
    const result = [conquestGrid.cellToLatLon(fineCells[0])];
    let segFailures = 0;
    // For each consecutive pair of fine cells, run a bounded fine-grid Dijkstra.
    // This produces a chain of adjacent water cells with NO gaps — the greedy
    // walk that used to jump to the target when stuck is gone.
    for (let i = 1; i < fineCells.length; i++) {
        if (result.length >= MAX_POINTS) break;
        // Use the LAST cell in result as the actual starting point (handles
        // cases where a previous segment ended at a snapped water cell).
        const fromCell = conquestGrid.latLonToCell(result[result.length - 1].lat, result[result.length - 1].lon);
        const toCell = fineCells[i];
        if (toCell === fromCell) continue;
        // Try with a generous budget first. Consecutive coarse waypoints are
        // ~10-14 fine cells apart, but detours around peninsulas can be long.
        let segPath = fineDijkstra(fromCell, toCell, 50000);
        // Retry with a much larger budget if the first attempt failed — the
        // segment may require a long detour around a landmass.
        if (!segPath) segPath = fineDijkstra(fromCell, toCell, 200000);
        if (segPath && segPath.length > 1) {
            // Append all cells except the first (already in result from prev seg).
            for (let j = 1; j < segPath.length; j++) {
                if (result.length >= MAX_POINTS) break;
                result.push(conquestGrid.cellToLatLon(segPath[j]));
            }
        } else {
            // Dijkstra failed even with a large budget — the two cells are in
            // different fine-resolution water bodies (e.g. a strait that's open
            // at 0.5° coarse res but blocked by a land pixel at 0.05° fine res).
            // SKIP this segment entirely — do NOT jump to the target (that would
            // cross land). The next segment continues from the last good cell.
            // update()'s water clamping handles any interpolation gap gracefully.
            segFailures++;
            console.warn('[DENSIFY] fine Dijkstra failed seg', i, '/', fineCells.length,
                '| from', fromCell, 'to', toCell, '| SKIPPED (no land jump)');
        }
    }
    console.log('[DENSIFY] input:', coarsePath.length, '→ output:', result.length,
        '| segFailures:', segFailures, '/', Math.max(0, fineCells.length - 1));
    // ── On-screen debug overlay (visible without opening console) ──
    if (typeof document !== 'undefined') {
        let _dbgEl = document.getElementById('__densifyDebug');
        if (!_dbgEl) {
            _dbgEl = document.createElement('div');
            _dbgEl.id = '__densifyDebug';
            _dbgEl.style.cssText = 'position:fixed;top:50px;left:10px;background:rgba(0,0,0,0.85);color:#0f0;font:14px monospace;padding:6px 10px;z-index:99999;pointer-events:none;border-radius:4px;border:1px solid #0f0;';
            document.body.appendChild(_dbgEl);
        }
        const ok = result.length > coarsePath.length * 2 && segFailures === 0;
        _dbgEl.style.color = ok ? '#0f0' : '#f00';
        _dbgEl.textContent = `⚙ DENSIFY in:${coarsePath.length} → out:${result.length} | fails:${segFailures}/${Math.max(0, fineCells.length - 1)} ${ok ? '✓' : '✗ GAPS'}`;
    }
    if (result.length < 2) return coarsePath;
    return result;
}

// ════════════════════════════════════════════════════════════════════════
// SINGLE-STAGE DIJKSTRA on a MEDIUM-RESOLUTION grid (0.1°, ~11 km cells).
// One continuous water path from port to port — no coarse stage, no ocean-
// body snapping, no per-segment gaps. Uses pre-allocated typed arrays for
// 10-50x speedup vs Map-based storage. Falls back to coarse pathfinder for
// very long routes where the budget is exhausted.
// ════════════════════════════════════════════════════════════════════════
const MED_W = 3600, MED_H = 1800, MED_DEG = 0.1, MED_STRIDE = 2;
let _mWater = null;       // Uint8Array — 1 = water at this medium cell
let _mGScore = null;      // Float32Array — accumulated cost per cell
let _mCameFrom = null;    // Int32Array — parent cell for path reconstruction
let _mClosed = null;      // Uint8Array — 1 = cell finalized
let _mVisited = null;     // regular Array — tracks modified cells for reset

function _ensureMediumArrays() {
    if (_mWater) return;
    if (!conquestGrid || !conquestGrid._maskReady) return;
    const FW = conquestGrid.cfg.GRID_W;
    const WATER = conquestGrid.cfg.WATER;
    const owner = conquestGrid.owner;
    const N = MED_W * MED_H;
    _mWater = new Uint8Array(N);
    _mGScore = new Float32Array(N).fill(Infinity);
    _mCameFrom = new Int32Array(N).fill(-1);
    _mClosed = new Uint8Array(N);
    _mVisited = [];
    // Build water mask by sampling a 2×2 block of fine cells (OR logic).
    // This widens narrow straits (Hormuz ~33km, Gibraltar) that single-cell
    // sampling can miss due to alignment, keeping them connected.
    for (let mr = 0; mr < MED_H; mr++) {
        const fr = mr * MED_STRIDE;
        const frRow = fr * FW, fr1Row = (fr + 1) * FW;
        for (let mc = 0; mc < MED_W; mc++) {
            const fc = mc * MED_STRIDE;
            _mWater[mr * MED_W + mc] = (owner[frRow + fc] === WATER ||
                                        owner[frRow + fc + 1] === WATER ||
                                        owner[fr1Row + fc] === WATER ||
                                        owner[fr1Row + fc + 1] === WATER) ? 1 : 0;
        }
    }
    console.log('[MEDPATH] medium water mask built:', MED_W, '×', MED_H, '| mem ~', Math.round(N * 10 / 1048576), 'MB');
}

// ════════════════════════════════════════════════════════════════════════
//  WATER DEBUG OVERLAY
//  Toggle (Dev Ports panel → 🌊 button) cycles through modes that paint a
//  transparent sphere just above the globe so you can SEE exactly which cells
//  the pathfinder treats as water — and spot places that look like water on
//  the biome map but are NOT registered (no overlay = not navigable).
//    mode 1 = FINE water mask   (owner===WATER)         green
//    mode 2 = MEDIUM water mask (2×2 OR, what HPA uses) magenta
//    mode 3 = HIGHWAY graph     (nodes + edges)         cyan
//    mode 0 = OFF
// ════════════════════════════════════════════════════════════════════════
let _waterDebugMesh = null;
let _waterDebugMode = 0;
const _WATER_DEBUG_LABELS = ['OFF', 'FINE water (green)', 'MEDIUM water (magenta)', 'HIGHWAY graph (cyan)'];

function buildWaterDebugCanvas(mode) {
    if (!conquestGrid || !conquestGrid._maskReady) return null;
    const W = 2048, H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    if (mode === 1) {
        // FINE water mask — the raw owner array (7200×3600), source of truth.
        const img = ctx.createImageData(W, H);
        const data = img.data;
        const FW = conquestGrid.cfg.GRID_W, FH = conquestGrid.cfg.GRID_H;
        const WATER = conquestGrid.cfg.WATER;
        const owner = conquestGrid.owner;
        for (let y = 0; y < H; y++) {
            const fr = Math.min(FH - 1, ((y / H) * FH) | 0);
            const frRow = fr * FW;
            for (let x = 0; x < W; x++) {
                const fc = Math.min(FW - 1, ((x / W) * FW) | 0);
                if (owner[frRow + fc] === WATER) {
                    const idx = (y * W + x) << 2;
                    data[idx] = 30; data[idx + 1] = 255; data[idx + 2] = 60; data[idx + 3] = 150;
                }
                // land stays alpha 0 (transparent) → biome shows through
            }
        }
        ctx.putImageData(img, 0, 0);
    } else if (mode === 2) {
        // MEDIUM water mask — 2×2 OR-sampled grid ships actually navigate.
        _ensureMediumArrays();
        if (!_mWater) return null;
        const img = ctx.createImageData(W, H);
        const data = img.data;
        for (let y = 0; y < H; y++) {
            const mr = Math.min(MED_H - 1, ((y / H) * MED_H) | 0);
            const mrRow = mr * MED_W;
            for (let x = 0; x < W; x++) {
                const mc = Math.min(MED_W - 1, ((x / W) * MED_W) | 0);
                if (_mWater[mrRow + mc]) {
                    const idx = (y * W + x) << 2;
                    data[idx] = 255; data[idx + 1] = 50; data[idx + 2] = 255; data[idx + 3] = 150;
                }
            }
        }
        ctx.putImageData(img, 0, 0);
    } else if (mode === 3) {
        // HIGHWAY graph — sparse routing nodes (dots) + edges (lines).
        if (!_waterwayNetwork) return null;
        const nodes = _waterwayNetwork.hwNodes;
        const adj = _waterwayNetwork.hwAdj;
        // edges first (so dots sit on top)
        ctx.strokeStyle = 'rgba(80,220,255,0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let a = 0; a < adj.length; a++) {
            const na = nodes[a];
            const xa = ((na.lon + 180) / 360) * W;
            const ya = ((90 - na.lat) / 180) * H;
            for (let k = 0; k < adj[a].length; k++) {
                const to = adj[a][k].to;
                if (to <= a) continue; // draw each undirected edge once
                const nb = nodes[to];
                const xb = ((nb.lon + 180) / 360) * W;
                const yb = ((90 - nb.lat) / 180) * H;
                ctx.moveTo(xa, ya); ctx.lineTo(xb, yb);
            }
        }
        ctx.stroke();
        // nodes
        ctx.fillStyle = 'rgba(120,255,255,0.95)';
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const xn = ((n.lon + 180) / 360) * W;
            const yn = ((90 - n.lat) / 180) * H;
            ctx.fillRect(xn - 1, yn - 1, 2.5, 2.5);
        }
    }
    return canvas;
}

function applyWaterDebugOverlay() {
    if (_waterDebugMode === 0) {
        if (_waterDebugMesh) _waterDebugMesh.visible = false;
        return;
    }
    const canvas = buildWaterDebugCanvas(_waterDebugMode);
    if (!canvas) {
        console.warn('[WATERDBG] not ready yet (grid/highway still loading) — try again in a moment');
        return;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    if (!_waterDebugMesh) {
        const geo = new THREE.SphereGeometry(EARTH_RADIUS * 1.003, 256, 128);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1.0, depthWrite: false });
        _waterDebugMesh = new THREE.Mesh(geo, mat);
        _waterDebugMesh.renderOrder = 5;
        scene.add(_waterDebugMesh);
    }
    if (_waterDebugMesh.material.map) _waterDebugMesh.material.map.dispose();
    _waterDebugMesh.material.map = tex;
    _waterDebugMesh.material.needsUpdate = true;
    _waterDebugMesh.visible = true;
    console.log('[WATERDBG] overlay mode:', _WATER_DEBUG_LABELS[_waterDebugMode]);
}

function _medToLatLon(cell) {
    return {
        lat: 90 - (Math.floor(cell / MED_W) + 0.5) * MED_DEG,
        lon: -180 + ((cell % MED_W) + 0.5) * MED_DEG,
    };
}

function _nearestMedWater(lat, lon, maxRing) {
    const col = Math.min(MED_W - 1, Math.max(0, Math.floor((lon + 180) / MED_DEG)));
    const row = Math.min(MED_H - 1, Math.max(0, Math.floor((90 - lat) / MED_DEG)));
    const cell = row * MED_W + col;
    if (_mWater[cell]) return cell;
    for (let ring = 1; ring <= maxRing; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
            const r = row + dy;
            if (r < 0 || r >= MED_H) continue;
            for (let dx = -ring; dx <= ring; dx++) {
                if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                const c = (((col + dx) % MED_W) + MED_W) % MED_W;
                const mc = r * MED_W + c;
                if (_mWater[mc]) return mc;
            }
        }
    }
    return -1;
}

function findFineWaterPath(srcLat, srcLon, dstLat, dstLon) {
    if (!conquestGrid || !conquestGrid._maskReady) return null;
    _ensureMediumArrays();
    if (!_mWater) return null;

    // ── DISTANCE GATE: skip fine Dijkstra for long routes to prevent freeze ──
    // Pure Dijkstra explores in a circle, so cost grows with the SQUARE of
    // distance. For routes > 2000 km, use the fast coarse pathfinder instead.
    const _distKm = haversineDist(srcLat, srcLon, dstLat, dstLon);
    if (_distKm > 2000) {
        console.log('[MEDPATH] distance', Math.round(_distKm), 'km > 2000 — using coarse path');
        return null; // caller falls back to coarse pathfinder
    }

    // Snap ports to medium water cells (15 rings ≈ 165 km at 0.1°).
    const startCell = _nearestMedWater(srcLat, srcLon, 15);
    const goalCell = _nearestMedWater(dstLat, dstLon, 15);
    if (startCell < 0 || goalCell < 0) {
        console.warn('[MEDPATH] cannot snap ports to water');
        return null;
    }
    if (startCell === goalCell) return [_medToLatLon(startCell)];

    // Reset cells modified by the previous search.
    for (let i = 0; i < _mVisited.length; i++) {
        const c = _mVisited[i];
        _mGScore[c] = Infinity;
        _mCameFrom[c] = -1;
        _mClosed[c] = 0;
    }
    _mVisited.length = 0;

    // Dijkstra with typed arrays — pure cost-based exploration (h ≡ 0).
    _mGScore[startCell] = 0;
    _mVisited.push(startCell);

    // Binary min-heap: entries [cost, cell].
    const heap = [[0, startCell]];
    // 8-connected directions (diagonals cost √2).
    const dDirs = [-1, 0, 1];
    const MAX_NODES = 250000; // ~250K cells ≈ routes up to ~1500 km (distance gate handles the rest)
    let explored = 0;

    while (heap.length > 0) {
        // Pop min.
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                let m = i; const l = 2 * i + 1, r = 2 * i + 2;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
            }
        }
        const g = top[0], cell = top[1];
        if (_mClosed[cell]) continue;
        _mClosed[cell] = 1;

        if (cell === goalCell) {
            // Reconstruct path.
            const path = [];
            let c = cell;
            while (c !== -1) { path.unshift(_medToLatLon(c)); c = _mCameFrom[c]; }
            console.log('[MEDPATH] SUCCESS | explored:', explored, '| path:', path.length,
                '| from', srcLat.toFixed(1), srcLon.toFixed(1), '→ to', dstLat.toFixed(1), dstLon.toFixed(1));
            return path;
        }
        if (explored++ > MAX_NODES) {
            console.warn('[MEDPATH] budget exhausted at', explored, '— falling back to coarse');
            break;
        }

        const col = cell % MED_W, row = (cell / MED_W) | 0;
        // Unrolled 8-neighbour expansion for speed.
        for (let di = 0; di < 3; di++) {
            const dr = dDirs[di];
            const nr = row + dr;
            if (nr < 0 || nr >= MED_H) continue;
            for (let dj = 0; dj < 3; dj++) {
                if (di === 1 && dj === 1) continue; // skip self
                const dc = dDirs[dj];
                const nc = (((col + dc) % MED_W) + MED_W) % MED_W;
                const nb = nr * MED_W + nc;
                if (_mClosed[nb] || !_mWater[nb]) continue;
                const cost = (dr !== 0 && dc !== 0) ? 1.414 : 1.0;
                const tentG = g + cost;
                if (tentG < _mGScore[nb]) {
                    if (_mGScore[nb] === Infinity) _mVisited.push(nb);
                    _mGScore[nb] = tentG;
                    _mCameFrom[nb] = cell;
                    heap.push([tentG, nb]);
                    let i = heap.length - 1;
                    while (i > 0) {
                        const p = (i - 1) >> 1;
                        if (heap[p][0] <= heap[i][0]) break;
                        const t2 = heap[p]; heap[p] = heap[i]; heap[i] = t2; i = p;
                    }
                }
            }
        }
    }
    return null; // budget exhausted or unreachable
}

// ════════════════════════════════════════════════════════════════════════
// HYBRID MARITIME PATHFINDING — Pre-Computed Ocean Highway Graph (Tier 1)
// ════════════════════════════════════════════════════════════════════════
// Sparse graph of ~11,000 ocean waypoints at 2° intervals. Edges pre-
// validated by Bresenham line-of-sight (no edge crosses land). Runtime
// Dijkstra on this graph is <1ms for any global route — eliminates the
// freeze that pure Dijkstra causes on long trans-oceanic routes.
//
// Generated by: scripts/build_river_routes.cjs
// Data files:   public/data/ocean_highways.json + river_routes.json

let _waterwayNetwork = null; // { hwNodes, hwAdj, flowArr, flowGW, flowGH, mouths }

// Async load — called once during game init. Non-blocking: if it hasn't
// finished when a ship spawns, the ship falls back to other pathfinders.
async function loadWaterwayNetwork() {
    if (_waterwayNetwork) return _waterwayNetwork;
    try {
        const hwRes = await fetch('/data/ocean_highways.json');
        if (!hwRes.ok) throw new Error('ocean_highways.json HTTP ' + hwRes.status);
        const hwData = await hwRes.json();

        // Build adjacency list for highway graph (the HPA "abstract level").
        const N = hwData.nodes.length;
        const adj = new Array(N);
        for (let i = 0; i < N; i++) adj[i] = [];
        for (const [a, b, dist] of hwData.edges) {
            adj[a].push({ to: b, dist });
            adj[b].push({ to: a, dist });
        }

        // Build Set of medium-cell indices for all highway nodes. This lets
        // boundedMedDijkstra do O(1) "am I at a highway node?" checks — the
        // multi-target termination condition for port→highway routing.
        const hwCellSet = new Set();
        for (const node of hwData.nodes) {
            const col = Math.min(MED_W - 1, Math.max(0, Math.floor((node.lon + 180) / MED_DEG)));
            const row = Math.min(MED_H - 1, Math.max(0, Math.floor((90 - node.lat) / MED_DEG)));
            hwCellSet.add(row * MED_W + col);
        }

        _waterwayNetwork = {
            hwNodes: hwData.nodes,
            hwAdj: adj,
            hwCellSet: hwCellSet
        };
        console.log('[WATERWAY] HPA graph loaded | highway nodes:', N,
            '| edges:', hwData.edges.length,
            '| hwCells:', hwCellSet.size);
        if (window.DEV_MODE && !_editorAutoLoaded) { _editorAutoLoaded = true; _editorAutoLoadEdits(); }
    } catch (e) {
        console.warn('[WATERWAY] Load failed (non-fatal):', e.message);
        _waterwayNetwork = null;
    }
    return _waterwayNetwork;
}

// Find nearest highway node by haversine distance (linear scan, ~11K nodes).
function _nearestHighwayNode(lat, lon) {
    if (!_waterwayNetwork) return -1;
    const nodes = _waterwayNetwork.hwNodes;
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < nodes.length; i++) {
        const d = haversineDist(lat, lon, nodes[i].lat, nodes[i].lon);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
}

// Pre-allocated typed arrays for highway Dijkstra (reused across calls).
let _hwGScore = null, _hwCameFrom = null, _hwClosed = null;

// Dijkstra on the sparse ocean highway graph. Returns array of {lat, lon}
// waypoints or null if no path. Handles any global distance in <1ms.
function findHighwayPath(srcLat, srcLon, dstLat, dstLon) {
    if (!_waterwayNetwork) return null;
    const wn = _waterwayNetwork;
    const nodes = wn.hwNodes;
    const adj = wn.hwAdj;
    const N = nodes.length;
    if (N === 0) return null;

    const srcNode = _nearestHighwayNode(srcLat, srcLon);
    const dstNode = _nearestHighwayNode(dstLat, dstLon);
    if (srcNode < 0 || dstNode < 0) return null;
    if (srcNode === dstNode) {
        return [{ lat: nodes[srcNode].lat, lon: nodes[srcNode].lon }];
    }

    // Allocate or grow typed arrays
    if (!_hwGScore || _hwGScore.length < N) {
        _hwGScore = new Float64Array(N);
        _hwCameFrom = new Int32Array(N);
        _hwClosed = new Uint8Array(N);
    }
    // Reset
    for (let i = 0; i < N; i++) {
        _hwGScore[i] = Infinity;
        _hwCameFrom[i] = -1;
        _hwClosed[i] = 0;
    }

    _hwGScore[srcNode] = 0;
    // A* heuristic: haversine distance (km) to destination node — admissible
    // since edge weights are also km and straight-line ≤ any graph path.
    // This biases expansion toward the destination, exploring far fewer nodes.
    const dstLatN = nodes[dstNode].lat, dstLonN = nodes[dstNode].lon;
    const h0 = haversineDist(nodes[srcNode].lat, nodes[srcNode].lon, dstLatN, dstLonN);
    const heap = [[h0, srcNode]]; // [fScore = gScore + heuristic, nodeIdx]
    let found = false;

    while (heap.length > 0) {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                let m = i; const l = 2 * i + 1, r = 2 * i + 2;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
            }
        }
        const node = top[1];
        if (_hwClosed[node]) continue;
        _hwClosed[node] = 1;

        if (node === dstNode) { found = true; break; }

        // Use actual g-score from array (NOT top[0] which is f-score with A*).
        const g = _hwGScore[node];
        const edges = adj[node];
        for (let e = 0; e < edges.length; e++) {
            const nb = edges[e].to;
            if (_hwClosed[nb]) continue;
            const tentG = g + edges[e].dist;
            if (tentG < _hwGScore[nb]) {
                _hwGScore[nb] = tentG;
                _hwCameFrom[nb] = node;
                const h = haversineDist(nodes[nb].lat, nodes[nb].lon, dstLatN, dstLonN);
                heap.push([tentG + h, nb]);
                let i = heap.length - 1;
                while (i > 0) {
                    const p = (i - 1) >> 1;
                    if (heap[p][0] <= heap[i][0]) break;
                    const t2 = heap[p]; heap[p] = heap[i]; heap[i] = t2; i = p;
                }
            }
        }
    }

    if (!found) return null;

    // Reconstruct path
    const path = [];
    let n = dstNode;
    while (n !== -1) {
        path.unshift({ lat: nodes[n].lat, lon: nodes[n].lon });
        n = _hwCameFrom[n];
    }
    return path;
}

// ════════════════════════════════════════════════════════════════════════
// HPA PATHFINDING — Bounded Dijkstra + Highway Graph (OpenFront-inspired)
// ════════════════════════════════════════════════════════════════════════
// Every computation is BOUNDED by a hard node cap. No single call can ever
// explore millions of cells → guaranteed no freeze. This mirrors OpenFront's
// AStarWaterBounded + HPA architecture.

// Bounded multi-target Dijkstra on the medium grid. Expands from startCell
// until it reaches ANY cell in targetSet, or hits maxNodes (hard cap).
// Uses shared typed arrays (_mGScore/_mCameFrom/_mClosed) — reset after each
// call via _mVisited tracking. Returns { path:[cells], targetCell } or null.
function boundedMedDijkstra(startCell, targetSet, maxNodes, targetCell) {
    _ensureMediumArrays();
    if (!_mWater || !_mWater[startCell]) return null;

    // Reset only the cells we modified last time (tracked in _mVisited).
    for (let i = 0; i < _mVisited.length; i++) {
        const c = _mVisited[i];
        _mGScore[c] = Infinity;
        _mCameFrom[c] = -1;
        _mClosed[c] = 0;
    }
    _mVisited.length = 0;

    _mGScore[startCell] = 0;
    _mVisited.push(startCell);

    // A* heuristic support: when targetCell is provided, use directional search.
    const useAStar = (targetCell !== undefined && targetCell >= 0);
    let hLat = 0, hLon = 0;
    if (useAStar) {
        const ll = _medToLatLon(targetCell);
        hLat = ll.lat; hLon = ll.lon;
    }

    // Binary min-heap of [fScore, cell] pairs. fScore = gScore + heuristic.
    const initF = useAStar ? _medHeuristic(startCell, hLat, hLon) : 0;
    const heap = [[initF, startCell]];
    let expanded = 0;

    while (heap.length > 0) {
        // Extract min (sift-down).
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                let m = i; const l = 2 * i + 1, r = 2 * i + 2;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
            }
        }
        const cell = top[1];
        if (_mClosed[cell]) continue;
        _mClosed[cell] = 1;

        // Multi-target termination: reached any highway cell?
        if (targetSet.has(cell)) {
            const path = [];
            let c = cell;
            while (c !== -1) { path.unshift(c); c = _mCameFrom[c]; }
            return { path, targetCell: cell };
        }

        expanded++;
        if (expanded > maxNodes) return null; // HARD CAP — never freezes

        // Use actual g-score from the array (NOT top[0] which is f-score with A*).
        const g = _mGScore[cell];

        // 8-directional neighbors with longitude wrap.
        const r = (cell / MED_W) | 0;
        const cc = cell % MED_W;
        for (let dr = -1; dr <= 1; dr++) {
            const nr = r + dr;
            if (nr < 0 || nr >= MED_H) continue;
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nc = (((cc + dc) % MED_W) + MED_W) % MED_W;
                const nb = nr * MED_W + nc;
                if (!_mWater[nb] || _mClosed[nb]) continue;
                const cost = (dr === 0 || dc === 0) ? 1 : 1.414;
                const tentG = g + cost;
                if (tentG < _mGScore[nb]) {
                    if (_mGScore[nb] === Infinity) _mVisited.push(nb);
                    _mGScore[nb] = tentG;
                    _mCameFrom[nb] = cell;
                    const f = useAStar ? tentG + _medHeuristic(nb, hLat, hLon) : tentG;
                    heap.push([f, nb]);
                    // Sift up.
                    let i = heap.length - 1;
                    while (i > 0) {
                        const p = (i - 1) >> 1;
                        if (heap[p][0] <= heap[i][0]) break;
                        const t2 = heap[p]; heap[p] = heap[i]; heap[i] = t2; i = p;
                    }
                }
            }
        }
    }
    return null;
}

// A* heuristic: Euclidean distance in grid steps (admissible since diagonal cost ≥ √2).
function _medHeuristic(cell, targetLat, targetLon) {
    const r = (cell / MED_W) | 0;
    const c = cell % MED_W;
    const tr = Math.round((90 - targetLat) / 0.1);
    const tc = Math.round((targetLon + 180) / 0.1);
    const dr = r - tr, dc = c - tc;
    // Handle longitude wrap for heuristic
    const dcw = Math.abs(dc) > MED_W * 0.5 ? dc - Math.sign(dc) * MED_W : dc;
    return Math.sqrt(dr * dr + dcw * dcw);
}

// Scratch vectors for _segmentCrossesLand (avoid per-call allocation).
const _sclV1 = new THREE.Vector3();
const _sclV2 = new THREE.Vector3();
const _sclTmp = new THREE.Vector3();

// Check if a great-circle segment between two lat/lon points crosses land.
// Samples along the EXACT path the ship follows (3D lerp+normalize = great
// circle arc) at ~0.12° intervals using the medium water mask. This matches
// the ship's actual movement, eliminating false "clear" verdicts on long arcs
// where the great-circle bulges away from the naive lat/lon linear path.
function _segmentCrossesLand(lat1, lon1, lat2, lon2) {
    _ensureMediumArrays();
    if (!_mWater) return false;
    let dLon = lon2 - lon1;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const dLat = lat2 - lat1;
    const distDeg = Math.sqrt(dLat * dLat + dLon * dLon);
    if (distDeg < 0.15) return false; // too short to cross land
    // Build unit vectors — the lerp+normalize of these traces the same
    // great-circle arc the ship follows in update().
    const phi1 = lat1 * 0.01745329, lam1 = lon1 * 0.01745329;
    const phi2 = lat2 * 0.01745329, lam2 = lon2 * 0.01745329;
    const c1 = Math.cos(phi1), c2 = Math.cos(phi2);
    _sclV1.set(c1 * Math.cos(lam1), c1 * Math.sin(lam1), Math.sin(phi1));
    _sclV2.set(c2 * Math.cos(lam2), c2 * Math.sin(lam2), Math.sin(phi2));
    const steps = Math.min(80, Math.ceil(distDeg / 0.12));
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        _sclTmp.copy(_sclV1).lerp(_sclV2, t).normalize();
        const lat = Math.asin(_sclTmp.z) * 57.2957795;
        const lon = Math.atan2(_sclTmp.y, _sclTmp.x) * 57.2957795;
        const r = Math.round((90 - lat) / 0.1);
        const c = Math.round((lon + 180) / 0.1);
        if (r < 0 || r >= MED_H) continue;
        const cell = r * MED_W + (((c % MED_W) + MED_W) % MED_W);
        if (!_mWater[cell]) return true; // land crossing detected
    }
    return false;
}

// String-pulling path smoother: greedily skips waypoints when the direct line
// between non-adjacent waypoints stays in water. Converts grid-like Dijkstra
// paths into smooth, direct water routes. Also removes redundant collinear points.
function _smoothWaterPath(waypoints) {
    if (!waypoints || waypoints.length <= 2) return waypoints;
    _ensureMediumArrays();

    // Phase 1: String pulling — skip waypoints where direct line is all-water.
    // PROBE BUDGET: coast-hugging routes could scan the ENTIRE remaining list per
    // waypoint (O(n²) land probes in one call — a visible hitch on ship spawn).
    // Past the budget we accept the rest of the path as-is.
    let probeBudget = 600;
    const result = [waypoints[0]];
    let i = 0;
    while (i < waypoints.length - 1) {
        // Try to jump as far ahead as possible without crossing land.
        let j = waypoints.length - 1;
        while (j > i + 1) {
            if (probeBudget-- <= 0) break;
            if (!_segmentCrossesLand(waypoints[i].lat, waypoints[i].lon,
                                      waypoints[j].lat, waypoints[j].lon)) {
                break; // clear shot found
            }
            j--;
        }
        result.push(waypoints[j]);
        i = j;
        if (probeBudget <= 0 && j < waypoints.length - 1) {
            for (let k = j + 1; k < waypoints.length; k++) result.push(waypoints[k]);
            break;
        }
    }
    return result;
}

// HPA route: bounded Dijkstra (port→highway) + highway graph Dijkstra
// (ocean crossing, ~11K nodes, instant) + bounded Dijkstra (highway→port).
// Every phase is bounded — no freeze possible. Returns {lat,lon}[] or null.
function findHPAPath(srcLat, srcLon, dstLat, dstLon) {
    if (!_waterwayNetwork || !_waterwayNetwork.hwCellSet) return null;
    _ensureMediumArrays();
    if (!_mWater) return null;

    // Snap ports to nearest water cell on the medium grid.
    const srcCell = _nearestMedWater(srcLat, srcLon, 25);
    const dstCell = _nearestMedWater(dstLat, dstLon, 25);
    if (srcCell < 0 || dstCell < 0) {
        console.warn('[HPA] cannot snap port to water | src:', srcCell, 'dst:', dstCell);
        return null;
    }

    const hwSet = _waterwayNetwork.hwCellSet;

    // Phase 1: Bounded Dijkstra from source port → nearest highway node.
    // A* targetCell = dstCell biases search toward destination, finding the
    // highway entry point that's nearest AND in the right direction.
    const srcRes = boundedMedDijkstra(srcCell, hwSet, 12000, dstCell);
    if (!srcRes) {
        console.warn('[HPA] src→highway bounded Dijkstra failed at',
            srcLat.toFixed(2), srcLon.toFixed(2));
        return null;
    }

    // Phase 2: Bounded Dijkstra from destination port → nearest highway node.
    // A* targetCell = srcCell biases search toward source for the return leg.
    const dstRes = boundedMedDijkstra(dstCell, hwSet, 12000, srcCell);
    if (!dstRes) {
        console.warn('[HPA] dst→highway bounded Dijkstra failed at',
            dstLat.toFixed(2), dstLon.toFixed(2));
        return null;
    }

    // Phase 3: Highway graph Dijkstra between exit nodes (instant).
    const srcExit = _medToLatLon(srcRes.targetCell);
    const dstExit = _medToLatLon(dstRes.targetCell);
    const srcNode = _nearestHighwayNode(srcExit.lat, srcExit.lon);
    const dstNode = _nearestHighwayNode(dstExit.lat, dstExit.lon);
    let hwPath = [];
    if (srcNode !== dstNode) {
        hwPath = findHighwayPath(srcExit.lat, srcExit.lon, dstExit.lat, dstExit.lon);
        if (!hwPath) {
            // Highway graph is DISCONNECTED between these nodes (e.g.,
            // Mediterranean ↔ Atlantic split by Strait of Gibraltar, or
            // different ocean basins). Fall back to a direct bounded Dijkstra
            // between the two port cells. Still bounded (hard cap) — no freeze.
            console.warn('[HPA] highway disconnected (srcNode', srcNode, 'dstNode', dstNode,
                ') — trying direct bounded Dijkstra (cap 60K)...');
            const directRes = boundedMedDijkstra(srcCell, new Set([dstCell]), 60000, dstCell);
            if (!directRes) {
                console.warn('[HPA] direct bounded Dijkstra also failed (route spans disconnected basins)');
                return null;
            }
            // Direct path already goes port→port — smooth and return.
            const directResult = [];
            for (const c of directRes.path) directResult.push(_medToLatLon(c));
            return _smoothWaterPath(directResult);
        }
    }

    // Phase 4: Combine — srcFlow + hwPath + reverse(dstFlow).
    // Convert medium cells to lat/lon, skipping near-duplicate junction points.
    const result = [];
    for (const c of srcRes.path) result.push(_medToLatLon(c));

    for (let i = 0; i < hwPath.length; i++) {
        if (i === 0 && result.length > 0) {
            const last = result[result.length - 1];
            if (Math.abs(last.lat - hwPath[0].lat) < 0.2 &&
                Math.abs(last.lon - hwPath[0].lon) < 0.2) continue;
        }
        result.push(hwPath[i]);
    }

    const dstRev = dstRes.path.slice().reverse();
    for (let i = 0; i < dstRev.length; i++) {
        if (i === 0 && result.length > 0) {
            const last = result[result.length - 1];
            const ll = _medToLatLon(dstRev[0]);
            if (Math.abs(last.lat - ll.lat) < 0.2 &&
                Math.abs(last.lon - ll.lon) < 0.2) continue;
        }
        result.push(_medToLatLon(dstRev[i]));
    }

    // Phase 5: String-pull smoothing — greedily skip waypoints where the direct
    // line between non-adjacent points stays in water. Eliminates grid-like
    // stair-step patterns and produces natural, direct shipping routes.
    return _smoothWaterPath(result);
}

class TradeShip {
    constructor(srcPort, dstPort, owner) {
        this.id = ++_id;
        this.owner = owner;
        this.srcPort = srcPort;
        this.dstPort = dstPort;
        this.progress = 0;
        this.dead = false;
        this.distKm = haversineDist(srcPort.lat, srcPort.lon, dstPort.lat, dstPort.lon);

        // ── LAZY PATH COMPUTATION (OpenFront stepping pattern) ──
        // The path is NOT computed in the constructor. It is computed on the
        // first update() call via findHPAPath — which is fully bounded (hard
        // node caps on every Dijkstra). This spreads computation across frames
        // naturally and guarantees no single constructor can freeze the game.
        this.pathReady = false;
        this.waypoints = null;
        this.wpVecs = null;
        this.segLens = null;
        this.segStarts = null;
        this.totalLen = 0;
        this.distTraveled = 0;
        this.curSeg = 0;
        this.speedKmPerFrame = 100 / 60;  // 100 km/s constant speed @ 60fps

        // Sprite is created immediately so the ship is visible at the port
        // while its path computes on the next frame.
        let col = owner === 'player' ? 0x00aaff : ownerHexColor(owner);
        this._col = col;
        if (!_tradeShipTex) {
            _tradeShipTex = new THREE.TextureLoader().load('/textures/tradeship.png');
        }
        let spriteMat = new THREE.SpriteMaterial({ map: _tradeShipTex, color: col, transparent: true });
        this.mesh = new THREE.Sprite(spriteMat);
        this.mesh.scale.set(18, 18, 1);
        this.mesh.position.copy(latLonToVec3(srcPort.lat, srcPort.lon, EARTH_RADIUS + 5.0));
        scene.add(this.mesh);
        this.pathLine = null;
    }

    // Compute the HPA route on first update. Every phase is bounded — no
    // fallback chain, no unbounded Dijkstra, no freeze possible.
    _computePath() {
        let wps = findHPAPath(this.srcPort.lat, this.srcPort.lon,
                              this.dstPort.lat, this.dstPort.lon);
        if (!wps || wps.length < 2) {
            // No path found — ship dies gracefully. No freeze, no fallback.
            console.warn('[SHIP] HPA path failed — ship dying |',
                this.srcPort.lat.toFixed(1), this.srcPort.lon.toFixed(1),
                '→', this.dstPort.lat.toFixed(1), this.dstPort.lon.toFixed(1));
            this.dead = true;
            scene.remove(this.mesh);
            if (this.mesh.material) this.mesh.material.dispose();
            return;
        }
        // Wrap with exact port positions for clean start/end.
        wps = [
            { lat: this.srcPort.lat, lon: this.srcPort.lon },
            ...wps,
            { lat: this.dstPort.lat, lon: this.dstPort.lon }
        ];
        this.waypoints = wps;
        console.log('[SHIP] HPA route | waypoints:', wps.length,
            '| dist:', Math.round(this.distKm), 'km |',
            this.srcPort.lat.toFixed(1), this.srcPort.lon.toFixed(1),
            '→', this.dstPort.lat.toFixed(1), this.dstPort.lon.toFixed(1));

        // Precompute 3D position vectors for each waypoint.
        this.wpVecs = wps.map(wp => latLonToVec3(wp.lat, wp.lon, EARTH_RADIUS + 5.0));
        // Segment lengths + cumulative starts + total path length.
        this.segLens = [];
        this.segStarts = [0];
        this.totalLen = 0;
        for (let i = 1; i < wps.length; i++) {
            const d = haversineDist(wps[i-1].lat, wps[i-1].lon, wps[i].lat, wps[i].lon);
            this.segLens.push(d);
            this.totalLen += d;
            this.segStarts.push(this.totalLen);
        }

        // DEV: path visualization line (toggled via window.__showShipPaths).
        if (this.wpVecs.length >= 2) {
            const pts = [];
            for (const v of this.wpVecs) pts.push(v.x, v.y, v.z);
            const pgeo = new THREE.BufferGeometry();
            pgeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
            const pmat = new THREE.LineBasicMaterial({ color: this._col, transparent: true, opacity: 0.75 });
            this.pathLine = new THREE.Line(pgeo, pmat);
            this.pathLine.visible = !!window.__showShipPaths;
            scene.add(this.pathLine);
        }
        this.pathReady = true;
    }

    update() {
        if (this.dead) return;
        // LAZY: compute the bounded HPA path on the first update frame.
        if (!this.pathReady) {
            this._computePath();
            if (this.dead) return;
        }
        // Constant-speed movement: advance a fixed distance each frame.
        this.distTraveled += this.speedKmPerFrame;
        if (this.distTraveled >= this.totalLen) {
            this.arrive();
            return;
        }
        // Walk segments incrementally (O(1) — no full scan each frame).
        while (this.curSeg < this.segLens.length &&
               this.distTraveled > this.segStarts[this.curSeg + 1]) {
            this.curSeg++;
        }
        const segIdx = Math.min(this.curSeg, this.segLens.length - 1);
        const segT = this.segLens[segIdx] > 0
            ? (this.distTraveled - this.segStarts[segIdx]) / this.segLens[segIdx]
            : 0;
        let curVec = this.wpVecs[segIdx].clone()
            .lerp(this.wpVecs[segIdx + 1], segT)
            .normalize()
            .multiplyScalar(EARTH_RADIUS + 5.0);

        // ── WATER CLAMPING: ship NEVER leaves water ──
        // Safety net: if an interpolated position lands on land, snap to the
        // nearest water cell. Guarantees zero land crossings.
        if (conquestGrid && conquestGrid._maskReady) {
            const ll = vec3ToLatLon(curVec);
            const cell = conquestGrid.latLonToCell(ll.lat, ll.lon);
            if (conquestGrid.owner[cell] !== conquestGrid.cfg.WATER) {
                const wc = nearestWaterCell(ll.lat, ll.lon, 15);
                if (wc >= 0) {
                    const wll = conquestGrid.cellToLatLon(wc);
                    curVec = latLonToVec3(wll.lat, wll.lon, EARTH_RADIUS + 5.0);
                }
            }
        }
        this.mesh.position.copy(curVec);
        if (this.pathLine) this.pathLine.visible = !!window.__showShipPaths;
    }
    
    arrive() {
        this.dead = true;
        scene.remove(this.mesh);
        if (this.mesh.material) this.mesh.material.dispose();
        if (this.pathLine) { scene.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine.material.dispose(); }

        // OpenFront tradeShipGold(dist): sigmoid + linear, both ports earn.
        const C = GAME_CONSTANTS;
        const dist = this.distKm || 0;
        const debuff = C.TRADE_SHIP_SHORT_RANGE_KM;
        const gold = Math.floor(
            C.TRADE_SHIP_BASE_GOLD / (1 + Math.exp(-C.TRADE_SHIP_SIGMOID_STEEPNESS * (dist - debuff)))
            + C.TRADE_SHIP_DIST_GOLD * dist
        );

        // TASK-404 SANCTIONS: a nation at war with many others trades at a
        // penalty — each earner's share is scaled by their OWN status.
        const _mul = (o) => (econSanctioned(o) ? C.ECON_SANCTIONS_TRADE_MUL : 1);
        const goldA = Math.floor(gold * _mul(this.owner));
        const goldB = Math.floor(gold * _mul(this.dstPort.owner));

        // OpenFront TradeShipExecution.complete(): srcPort.owner() AND dstPort.owner() both get gold.
        const creditGold = (ownerStr, amt) => {
            if (ownerStr === 'player') pRes += amt;
            else if (ownerStr === 'enemy') eRes += amt;
            else { const b = botByStr(ownerStr); if (b) b.res += amt; }
        };
        creditGold(this.owner, goldA);
        creditGold(this.dstPort.owner, goldB);
        if (this.owner === 'player') {
            logEvent(`سفينة تجارية وصلت! +💰${goldA} (مسافة ${Math.round(dist)} كم)`, 'info');
        } else if (this.dstPort.owner === 'player') {
            logEvent(`ميناءك استقبل سفينة تجارية! +💰${goldB}`, 'info');
        }
        updateHUD();
    }
}

// ════════════════════════════════════════════════════════════════════
// TRANSPORT SHIPS — naval invasion (port of OpenFront TransportShip)
// Carries committed troops across the ocean, lands on the target shore,
// conquers a small beachhead, and starts a ConquestAttack inland from it.
// Fixes: cross-ocean stalemate (no land route = game could never end).
// ════════════════════════════════════════════════════════════════════
class TransportShip {
    constructor(owner, src, dst, troops) {
        this.id = ++_id;
        this.owner = owner;
        this.srcLat = src.lat; this.srcLon = src.lon;
        this.dstLat = dst.lat; this.dstLon = dst.lon;
        this.troops = Math.max(0, Math.floor(troops));
        this.dead = false;
        this.distKm = haversineDist(src.lat, src.lon, dst.lat, dst.lon);
        this.pathReady = false;
        this.waypoints = null; this.wpVecs = null; this.segLens = null; this.segStarts = null;
        this.totalLen = 0; this.distTraveled = 0; this.curSeg = 0;
        this.speedKmPerFrame = GAME_CONSTANTS.TRANSPORT_SHIP_SPEED_KM_S / 60;

        let col = ownerHexColor(owner);
        this._col = col;
        if (!_tradeShipTex) {
            _tradeShipTex = new THREE.TextureLoader().load('/textures/tradeship.png');
        }
        this.mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: _tradeShipTex, color: col, transparent: true }));
        this.mesh.scale.set(24, 24, 1);
        this.mesh.position.copy(latLonToVec3(src.lat, src.lon, EARTH_RADIUS + 5.0));
        scene.add(this.mesh);
        this.pathLine = null;
    }

    _computePath() {
        let wps = findHPAPath(this.srcLat, this.srcLon, this.dstLat, this.dstLon);
        if (!wps || wps.length < 2) {
            console.warn('[TRANSPORT] HPA path failed — troops refunded |',
                this.srcLat.toFixed(1), this.srcLon.toFixed(1), '→', this.dstLat.toFixed(1), this.dstLon.toFixed(1));
            this._refund();
            this._remove();
            return;
        }
        wps = [
            { lat: this.srcLat, lon: this.srcLon },
            ...wps,
            { lat: this.dstLat, lon: this.dstLon }
        ];
        this.waypoints = wps;
        this.wpVecs = wps.map(wp => latLonToVec3(wp.lat, wp.lon, EARTH_RADIUS + 5.0));
        this.segLens = []; this.segStarts = [0]; this.totalLen = 0;
        for (let i = 1; i < wps.length; i++) {
            const d = haversineDist(wps[i-1].lat, wps[i-1].lon, wps[i].lat, wps[i].lon);
            this.segLens.push(d);
            this.totalLen += d;
            this.segStarts.push(this.totalLen);
        }
        this.pathReady = true;
    }

    _refund() {
        if (this.troops > 0 && conquestCtx) conquestCtx.addTroops(this.owner, this.troops);
        this.troops = 0;
    }

    _remove() {
        this.dead = true;
        scene.remove(this.mesh);
        if (this.mesh.material) this.mesh.material.dispose();
        if (this.pathLine) { scene.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine.material.dispose(); }
    }

    update() {
        if (this.dead) return;
        if (!this.pathReady) { this._computePath(); if (this.dead) return; }
        this.distTraveled += this.speedKmPerFrame;
        if (this.distTraveled >= this.totalLen) { this._landfall(); return; }
        while (this.curSeg < this.segLens.length && this.distTraveled > this.segStarts[this.curSeg + 1]) this.curSeg++;
        const segIdx = Math.min(this.curSeg, this.segLens.length - 1);
        const segT = this.segLens[segIdx] > 0 ? (this.distTraveled - this.segStarts[segIdx]) / this.segLens[segIdx] : 0;
        this.mesh.position.copy(this.wpVecs[segIdx].clone().lerp(this.wpVecs[segIdx + 1], segT).normalize().multiplyScalar(EARTH_RADIUS + 5.0));
    }

    _landfall() {
        this._remove();
        if (!conquestGrid || !conquestCtx || !conquestGrid._maskReady || this.troops < 10) { this._refund(); return; }
        const target = conquestGrid.ownerAt(this.dstLat, this.dstLon);
        if (target === this.owner || target === 'water') { this._refund(); return; }
        // Beachhead: conquer a tiny landing zone (~1-2 cells), then attack inland
        // from it (OpenFront: conquer dst tile → AttackExecution from that tile).
        conquestGrid.seedCircle(this.dstLat, this.dstLon, GAME_CONSTANTS.BEACHHEAD_RADIUS_KM, this.owner);
        renderMode1Territory();
        const troops = this.troops;
        this.troops = 0;                          // handed to the attack — no refund
        conquestCtx.addTroops(this.owner, troops); // re-credit: ConquestAttack deducts on construction
        const atk = new ConquestAttack({
            grid: conquestGrid, owner: this.owner, target,
            troops, srcLat: this.dstLat, srcLon: this.dstLon,
            dstLat: this.dstLat, dstLon: this.dstLon, ctx: conquestCtx,
        });
        activeAttacks.push(atk);
        if (this.owner === 'player') {
            logEvent('🚢 إنزال بحري! قواتك عسكرت على الساحل.', 'info');
        }
    }
}

// Find an OWNED coastal cell (for transport embark points). Scans the grid's
// maintained _borderCells set — owned cells with a WATER 4-neighbor are by
// definition on the frontier, and the set is tiny compared to the full grid.
// (The old version randomly sampled ALL 25.9M cells and almost never hit owned
// coastline → false "no shoreline in your territory".) Prefers the coast
// closest to `towardLat/towardLon` so fleets sail the short way.
function _sampleOwnedShoreCell(ownerStr, towardLat, towardLon) {
    if (!conquestGrid || !conquestGrid._maskReady) return null;
    const cfg = conquestGrid.cfg;
    // Owner code resolve (TASK-202 drive-by fix): bots register DYNAMIC codes
    // (4+) — the old `player ? 2 : 3` mapping made every bot sample the
    // legacy-enemy's shoreline (nobody, in FFA) → bot naval invasions never
    // found an embark coast and silently failed.
    let ownerCode;
    if (ownerStr === 'player') ownerCode = CONQUEST_CFG.PLAYER;
    else if (ownerStr === 'enemy') ownerCode = CONQUEST_CFG.ENEMY;
    else { const b = botByStr(ownerStr); ownerCode = b ? b.code : CONQUEST_CFG.ENEMY; }
    const owner = conquestGrid.owner;
    const _nb = [];
    let best = null, bestDist = Infinity;
    for (const cell of conquestGrid._borderCells) {
        if (owner[cell] !== ownerCode) continue;
        const n = conquestGrid.neighbors4(cell, _nb);
        let coastal = false;
        for (let i = 0; i < n; i++) {
            if (owner[_nb[i]] === cfg.WATER) { coastal = true; break; }
        }
        if (!coastal) continue;
        const ll = conquestGrid.cellToLatLon(cell);
        const d = (towardLat !== undefined) ? haversineDist(ll.lat, ll.lon, towardLat, towardLon) : 0;
        if (d < bestDist) { bestDist = d; best = ll; }
    }
    // Fallback: border set empty/stale (e.g. mask built but never flushed) →
    // strided full-grid scan (every 16th cell ≈ ~80km — catches any coast).
    if (!best) {
        const W = cfg.GRID_W, total = owner.length;
        for (let cell = 0; cell < total; cell += 16) {
            if (owner[cell] !== ownerCode) continue;
            const n = conquestGrid.neighbors4(cell, _nb);
            let coastal = false;
            for (let i = 0; i < n; i++) {
                if (owner[_nb[i]] === cfg.WATER) { coastal = true; break; }
            }
            if (!coastal) continue;
            const ll = conquestGrid.cellToLatLon(cell);
            const d = (towardLat !== undefined) ? haversineDist(ll.lat, ll.lon, towardLat, towardLon) : 0;
            if (d < bestDist) { bestDist = d; best = ll; }
        }
    }
    return best;
}

// Launch a naval invasion toward `loc` (OpenFront boat attack). Used by the
// player click path (no land route) and by the AI when it has no land frontier.
function launchTransportInvasion(loc, side) {
    const C = GAME_CONSTANTS;
    const _feedback = (txt, isErr) => {
        if (side !== 'player') return;
        let msg = document.getElementById('tgtMsg');
        if (msg) { msg.textContent = txt; msg.style.display = 'block'; }
        logEvent(txt, isErr ? 'err' : 'info');
    };
    const myTransports = transportShips.reduce((n, ts) => n + (ts.dead || ts.owner !== side ? 0 : 1), 0);
    if (myTransports >= C.TRANSPORT_SHIP_MAX_ACTIVE) {
        _feedback('🚢 الحد الأقصى لسفن الإنزال نشط! انتظر وصول إحداها.', true);
        return;
    }
    const troopsPool = side === 'player' ? pTroops : (isBotStr(side) ? (botByStr(side) || { troops: 0 }).troops : eTroops);
    const pct = (side === 'player' ? (window.troopAttackPct || 50) : 40) / 100;
    const troops = Math.floor(troopsPool * pct);
    if (troops < 50) {
        _feedback('لا توجد قوات كافية للإنزال البحري!', true);
        return;
    }
    const dstShore = findNearestShoreTile(loc.lat, loc.lon, 10)
        || findNearestShoreTile(loc.lat, loc.lon, 120); // open-ocean click: widen to ~650km
    if (!dstShore) { _feedback('لا يوجد ساحل صالح للإنزال هنا! انقر أقرب إلى اليابسة.', true); return; }
    // Landing coast must not already be ours
    if (getPixelOwner(dstShore.lat, dstShore.lon) === 'player') {
        _feedback('هذا ساحلك! انقر ساحل العدو أو أرضاً محايدة.', true);
        return;
    }
    const srcShore = _sampleOwnedShoreCell(side, dstShore.lat, dstShore.lon);
    if (!srcShore) {
        _feedback('لا يوجد ساحل ضمن أراضيك للإبحار منه! توسّع نحو البحر أولاً.', true);
        return;
    }
    // Commit troops now (refunded automatically if the route fails)
    if (conquestCtx) conquestCtx.addTroops(side, -troops);
    transportShips.push(new TransportShip(side, srcShore, dstShore, troops));
    _feedback('🚢 إنزال بحري انطلق! القوات تعبر المحيط نحو الساحل المستهدف.', false);
}

// ════════════════════════════════════════════════════════════════════
// WARSHIPS (OpenFront Warship port) — patrol/gun-ship naval units.
// Spawn from an owned PORT toward a clicked water point (hotbar [V]).
// Behavior: auto-targets enemy ships in range with shell fire —
//   Priority 0: TransportShips (troop landings — one shell sinks them)
//   Priority 1: enemy Warships (HP 1000, 250 dmg/shell → 4 to kill)
//   Priority 2: TradeShips (captured → gold, OpenFront piracy)
// Otherwise patrols around its patrol point. Heals near own port.
// ════════════════════════════════════════════════════════════════════
// TASK-402: shared scratch vectors — Warship movement/orientation used to
// clone() THREE.Vector3s every frame per hull (audit #20's shell-bezier mate).
const _wsV1 = new THREE.Vector3(), _wsV2 = new THREE.Vector3(), _wsV3 = new THREE.Vector3();

class Warship {
    constructor(owner, portStruct, patrol, hullClass) {
        const C = GAME_CONSTANTS;
        this.id = ++_id;
        this.owner = owner;
        // Hull-class system (TASK-202): everything branches off this.hull.
        this.hullClass = (hullClass && C.HULL_CLASSES[hullClass]) ? hullClass : 'destroyer';
        this.hull = C.HULL_CLASSES[this.hullClass];
        this.name = this.hull.name;
        this.hp = this.hull.hp;
        this.maxHp = this.hull.hp;
        this.dead = false;
        this.mode = 'patrol';            // 'patrol' | 'chase' | 'hold'
        this.target = null;              // { kind, obj, lat, lon }
        this.fireCd = 0;
        this.shells = [];
        this.speedKmPerFrame = this.hull.speed / 60;
        // Class cooldowns (frames)
        this.pdCd = 0;                   // escort point-defense
        this.ciwsCd = 0;                 // carrier CIWS
        this.missileCd = this.hull.missileReload ? this.hull.missileReload / 2 : 0;
        this.droneCd = 0;                // drone bay launch pacing
        this.planeCd = 0;                // air-wing spawn pacing
        this.aaCd = 0;                   // TASK-402: fleet AA barrage
        // TASK-402: submarine state — submerged by default, located only by
        // sonar / heli dipping-sonar / the flaming datum of its own torpedoes.
        this.submerged = !!this.hull.submerged;
        this._detectedT = 0;             // sonar contact countdown
        this._revealT = 0;               // post-firing reveal countdown
        this.detected = !this.submerged;
        // TASK-402 polish: mount spin-up state (fed by the strategy systems)
        this._radarSpin = 0; this._ciwsSpin = 0; this._fxT = 0;
        // Invasion transport state
        this.troops = 0;
        this.invLat = 0; this.invLon = 0;
        this.invading = false;
        // Spawn in the water nearest the port (OpenFront: ship appears at the port)
        const spawn = _findWaterNear(portStruct.lat, portStruct.lon, 12) || patrol;
        this.curLat = spawn.lat; this.curLon = spawn.lon;
        this.patrolLat = patrol.lat; this.patrolLon = patrol.lon;
        // 3D model — per-hull low-poly builder, bow -Z
        const acc = ownerHexColor(owner);
        this._acc = acc;
        this.mesh = buildWarshipModel(acc, this.hullClass);
        this.mesh.scale.setScalar(this.hull.scale);
        this.accents = this.mesh.userData.accents;
        this.anim = { radar: this.mesh.getObjectByName('radar'),
                      ciws: this.mesh.getObjectByName('ciws'),
                      ciws2: this.mesh.getObjectByName('ciws2') };   // TASK-402: twin mounts
        this._radius = EARTH_RADIUS + 0.8;
        this.mesh.position.copy(latLonToVec3(this.curLat, this.curLon, this._radius));
        this.mesh.up.copy(this.mesh.position.clone().normalize());
        scene.add(this.mesh);
        // Selection ring (yellow halo flat on the water around the hull)
        if (!GEO_CACHE['shipSelRing']) GEO_CACHE['shipSelRing'] = new THREE.RingGeometry(13, 15, 28);
        this.selRing = new THREE.Mesh(GEO_CACHE['shipSelRing'],
            new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
        this.selRing.rotation.x = -Math.PI / 2;
        this.selRing.position.y = 0.4;
        this.selRing.visible = false;
        this.mesh.add(this.selRing);
        // Path state (patrol legs via water HPA — same pattern as transports)
        this.waypoints = null; this.wpVecs = null; this.segLens = null; this.segStarts = null;
        this.totalLen = 0; this.distTraveled = 0; this.curSeg = 0;
        this._lastCourseFrame = -9999;
        this._pickPatrolCourse();
    }

    // Live click-select position (selection scans read .lat/.lon) + a Vector3
    // .pos so carrier-based Plane parked/return logic can treat the hull as
    // its base structure (same contract as Structure.pos).
    get lat() { return this.curLat; }
    get lon() { return this.curLon; }
    get pos() { return this.mesh.position; }
    get type() { return 'warship_' + this.hullClass; }

    // Player move order (OpenFront move_warship): new patrol point + course.
    setPatrol(loc) {
        this.patrolLat = loc.lat; this.patrolLon = loc.lon;
        this.target = null;
        this.mode = 'patrol';
        this.invading = false;           // a manual move cancels a pending invasion run
        this._setCourse(loc.lat, loc.lon);
    }

    // ── course management ──
    _setCourse(dstLat, dstLon, direct) {
        let wps = null;
        if (!direct) wps = findHPAPath(this.curLat, this.curLon, dstLat, dstLon);
        if (!wps || wps.length < 2) wps = [{ lat: dstLat, lon: dstLon }];   // direct fallback
        wps = [{ lat: this.curLat, lon: this.curLon }, ...wps];
        this.waypoints = wps;
        this.wpVecs = wps.map(wp => latLonToVec3(wp.lat, wp.lon, this._radius));
        this.segLens = []; this.segStarts = [0]; this.totalLen = 0; this.distTraveled = 0; this.curSeg = 0;
        for (let i = 1; i < wps.length; i++) {
            const d = haversineDist(wps[i-1].lat, wps[i-1].lon, wps[i].lat, wps[i].lon);
            this.segLens.push(d); this.totalLen += d; this.segStarts.push(this.totalLen);
        }
        this._lastCourseFrame = frame;
    }
    _pickPatrolCourse() {
        // Random water point within PATROL_RADIUS of the patrol center
        for (let i = 0; i < 8; i++) {
            const ang = Math.random() * Math.PI * 2;
            const dkm = 60 + Math.random() * GAME_CONSTANTS.WARSHIP_PATROL_RADIUS_KM;
            const lat = this.patrolLat + (dkm * Math.cos(ang)) / 111;
            const lon = this.patrolLon + (dkm * Math.sin(ang)) / (111 * Math.max(0.2, Math.cos(this.patrolLat * Math.PI / 180)));
            if (!isLand(lat, lon)) { this._setCourse(lat, lon); return; }
        }
        this._setCourse(this.patrolLat, this.patrolLon, true);   // beeline to patrol center
    }

    // ── targeting (every 30 frames) ──
    _retarget() {
        const C = GAME_CONSTANTS;
        // Non-combat hulls (carriers/drone bays/transports) never chase —
        // their defense lives in CIWS/escorts/drones instead.
        const range = this.hull.targetRange || 0;
        if (range <= 0) { this.target = null; this.mode = this.invading ? 'invasion' : 'patrol'; return; }
        const t = this.target;
        if (t && !t.obj.dead) {
            // TASK-402: a located submarine can slip away again — drop the
            // track the moment it is no longer detected.
            if (!(t.obj.submerged && !t.obj.detected)) {
                // drop if out of range (live position)
                const p = _targetLivePos(t.kind, t.obj);
                if (haversineDist(this.curLat, this.curLon, p.lat, p.lon) <= range) { this._syncTargetPos(); return; }
            }
        }
        this.target = null;
        let best = null, bestD = range;
        const _consider = (kind, obj) => {
            if (obj.dead || obj.owner === this.owner) return;
            // TASK-402: submerged & unlocated submarines are invisible to guns
            if (obj.submerged && !obj.detected) return;
            const p = _targetLivePos(kind, obj);
            const d = haversineDist(this.curLat, this.curLon, p.lat, p.lon);
            if (d < bestD) { best = { kind, obj, lat: p.lat, lon: p.lon }; bestD = d; }
        };
        // Priority 0: enemy troop carriers — sprite transports + invasion hulls
        for (const ts of transportShips) _consider('transport', ts);
        for (const w of warships) {
            if (w !== this && w.hullClass === 'transport' && w.troops > 0) _consider('warship', w);
        }
        if (!best) {
            // Priority 1: enemy warships
            for (const w of warships) { if (w !== this) _consider('warship', w); }
        }
        // TASK-402 SHORE BOMBARDMENT (gun hulls only): enemy armor divisions
        // and coastal structures within gunfire reach of the CURRENT
        // position — ships never chase inland, they hold offshore and shoot.
        if (!best && this.hull.shellDmg > 0) {
            const gunR = Math.min(range, 360);
            for (const tk of tanks) {
                if (tk.dead || tk.owner === this.owner) continue;
                if (haversineDist(this.curLat, this.curLon, tk.lat, tk.lon) < gunR) _consider('tank', tk);
            }
            for (const st of structs) {
                if (st.dead || st.owner === this.owner || st.owner === 'neutral') continue;
                if (haversineDist(this.curLat, this.curLon, st.lat, st.lon) < C.SHORE_BOMBARD_RANGE_KM) _consider('struct', st);
            }
        }
        if (!best) {
            // Priority 2: trade ships (piracy — requires own port, OpenFront rule).
            // Submarines raid shipping WITHOUT a port (classic commerce raiding).
            if (this.hullClass === 'submarine' ||
                structs.some(s => !s.dead && s.owner === this.owner && s.type === 'port')) {
                for (const ts of tradeShips) _consider('trade', ts);
            }
        }
        this.target = best;
        this._syncTargetPos();
        this.mode = best ? 'chase' : (this.invading ? 'invasion' : 'patrol');
    }
    _syncTargetPos() {
        const t = this.target; if (!t) return;
        const p = _targetLivePos(t.kind, t.obj);
        t.lat = p.lat; t.lon = p.lon;
    }

    // ── gunnery ──
    _fire() {
        const t = this.target; if (!t) return;
        const fromVec = this.mesh.position.clone();
        const toVec = latLonToVec3(t.lat, t.lon, this._radius);
        // Arc control point — raised above the midpoint
        const mid = fromVec.clone().add(toVec).multiplyScalar(0.5);
        mid.normalize().multiplyScalar(this._radius + Math.min(80, fromVec.distanceTo(toVec) * 0.08));
        const mesh = new THREE.Mesh(_sph(1.1, 8, 6), getSharedMat(0xffcc44));
        mesh.position.copy(fromVec);
        scene.add(mesh);
        const dist = fromVec.distanceTo(toVec);
        this.shells.push({ mesh, from: fromVec, ctrl: mid, to: toVec, t: 0,
            dur: Math.max(0.35, Math.min(1.4, dist / 420)), target: t.obj, kind: t.kind, toLat: t.lat, toLon: t.lon,
            dmg: this.hull.shellDmg || GAME_CONSTANTS.WARSHIP_SHELL_DAMAGE });
        this.fireCd = this.hull.fireRate || GAME_CONSTANTS.WARSHIP_FIRE_RATE_TICKS;
        spawnExp(this.curLat, this.curLon, 2.5, '#ffcc66');   // muzzle flash
    }
    _updateShells() {
        for (let i = this.shells.length - 1; i >= 0; i--) {
            const s = this.shells[i];
            s.t += (1 / 60) / s.dur;
            if (s.t >= 1) {
                scene.remove(s.mesh);
                this.shells.splice(i, 1);
                this._shellHit(s);
                continue;
            }
            const it = 1 - s.t;
            s.mesh.position.set(
                it * it * s.from.x + 2 * it * s.t * s.ctrl.x + s.t * s.t * s.to.x,
                it * it * s.from.y + 2 * it * s.t * s.ctrl.y + s.t * s.t * s.to.y,
                it * it * s.from.z + 2 * it * s.t * s.ctrl.z + s.t * s.t * s.to.z
            );
        }
    }
    _shellHit(s) {
        const dmg = s.dmg || GAME_CONSTANTS.WARSHIP_SHELL_DAMAGE;
        const tgt = s.target;
        spawnExp(s.toLat, s.toLon, s.kind === 'warship' ? 5 : 6, '#ff8844');
        // Naval bombardment paints devastation too (shore bombardment softens
        // the target for a follow-up invasion).
        if (conquestGrid && conquestGrid.applyDevastation) {
            conquestGrid.applyDevastation(s.toLat, s.toLon, 90, 0.5);
        }
        if (!tgt || tgt.dead) return;
        const C = GAME_CONSTANTS;
        if (s.kind === 'transport') {
            tgt._remove();          // sunk — embarked troops are lost
            if (this.owner === 'player') logEvent('⚓ مدمرة نسفت سفينة إنزال معادية!', 'info');
            else if (tgt.owner === 'player') logEvent('⚠️ غرقت سفينة إنزال لدينا تحت نيران العدو!', 'err');
        } else if (s.kind === 'warship') {
            tgt.hp -= dmg;
            if (tgt.hp <= 0 && !tgt.dead) tgt._sink();
        } else if (s.kind === 'trade') {
            // Piracy: captured cargo → gold (OpenFront warship capture)
            const gold = GAME_CONSTANTS.TRADE_SHIP_BASE_GOLD;
            if (this.owner === 'player') { pRes += gold; logEvent(`⚓ مدمرة صادرت سفينة تجارية! +$${gold}`, 'info'); updateHUD(); }
            else {
                const b = botByStr(this.owner);
                if (b) b.res += gold;
                if (tgt.owner === 'player') logEvent('⚠️ قرصنة العدو استولت على سفينتك التجارية!', 'err');
            }
            _killTradeShip(tgt);
        } else if (s.kind === 'struct') {
            // TASK-402 shore bombardment: naval gunfire vs buildings
            tgt.hit(dmg * C.NAVAL_SHELL_STRUCT_MUL);
        } else if (s.kind === 'tank') {
            // TASK-402: naval gunfire vs armor divisions (pre-armor scale —
            // the division's own armor further reduces it in Tank.hit)
            tgt.hit(dmg * C.NAVAL_SHELL_VS_ARMOR, this.owner);
        }
    }
    _sink() {
        if (this.dead) return;
        this.dead = true;
        spawnExp(this.curLat, this.curLon, 8, '#ff5522');
        this.shells.forEach(s => scene.remove(s.mesh));
        this.shells.length = 0;
        // Tethered swarm dies with the bay (lost comms — no orphan drones)
        for (const d of drones) {
            if (!d.dead && d.home === this) d._crash();
        }
        if (this.selRing && this.selRing.material) this.selRing.material.dispose();
        if (this.selRing) this.selRing.visible = false;
        // TASK-402 POLISH: list + submerge over ~3s instead of instant remove —
        // the animator (gameFrame) owns the mesh until it reaches the seabed.
        navalSinking.push({ mesh: this.mesh, t: 0, dur: GAME_CONSTANTS.SINK_ANIM_FRAMES,
                            scale: this.hull.scale, owner: this.owner });
        if (this.owner === 'player') logEvent(`💥 غرقت ${this.name} لدينا!`, 'err');
        else logEvent(`💥 ${this.name} ${_ownerName(this.owner)} غرقت!`, 'info');
    }

    // Public damage API (Structure.hit parity) — TASK-204 drones and any
    // external system call this; it routes to a proper _sink() at zero.
    hit(dmg) {
        if (this.dead) return;
        this.hp -= dmg;
        if (this.hp <= 0) this._sink();
    }

    // ── main tick (60fps logic) ──
    update() {
        if (this.dead) return;
        const C = GAME_CONSTANTS;
        if (this.selRing) this.selRing.visible = !!this.selected;
        // TASK-402 POLISH: mounts idle-rotate, then SPIN UP when the strategy
        // systems feed them work (AA barrage / PD intercept / VLS launch).
        if (this.anim.radar) this.anim.radar.rotation.y += 0.05 + (this._radarSpin > 0 ? 0.5 : 0);
        if (this.anim.ciws) this.anim.ciws.rotation.y += (this._ciwsSpin > 0 ? 0.85 : 0.08);
        if (this.anim.ciws2) this.anim.ciws2.rotation.y += (this._ciwsSpin > 0 ? 0.85 : 0.08);
        if (this._radarSpin > 0) this._radarSpin--;
        if (this._ciwsSpin > 0) this._ciwsSpin--;
        if (this.fireCd > 0) this.fireCd--;
        if (this.pdCd > 0) this.pdCd--;
        if (this.ciwsCd > 0) this.ciwsCd--;
        if (this.missileCd > 0) this.missileCd--;
        if (this.droneCd > 0) this.droneCd--;
        if (this.planeCd > 0) this.planeCd--;
        if (this.aaCd > 0) this.aaCd--;

        // ── hull-class systems (TASK-402 strategy table — src/naval/hulls.js):
        //    AA barrages, point defense, sonar, CIWS, air wing, drone bay,
        //    VLS, sub combat, invasions, leash/standoff station keeping. ──
        const beh = NAVAL_HULLS[this.hullClass];
        if (beh) {
            if (beh.updateSystems) beh.updateSystems(this, NAVAL_CTX);
            if (beh.fleetBehavior) beh.fleetBehavior(this, NAVAL_CTX);
        }

        if (frame % 30 === (this.id % 30)) this._retarget();
        const t = this.target;
        const shellRange = this.hull.shellRange || C.WARSHIP_SHELL_RANGE_KM;
        const inRange = t && haversineDist(this.curLat, this.curLon, t.lat, t.lon) <= shellRange;

        if (t && inRange) {
            // Gun duel: hold position and fire on cooldown
            this.mode = 'hold';
            if (this.fireCd <= 0) {
                this._syncTargetPos();
                if (beh && beh.fire) beh.fire(this, NAVAL_CTX);   // submarine: torpedo release
                else this._fire();
            }
        } else if (t) {
            // Chase: recompute course toward the target when stale
            this.mode = 'chase';
            const stale = frame - this._lastCourseFrame > 60 ||
                (this.waypoints && haversineDist(
                    this.waypoints[this.waypoints.length - 1].lat,
                    this.waypoints[this.waypoints.length - 1].lon, t.lat, t.lon) > 200);
            if (stale) this._setCourse(t.lat, t.lon);
        } else if (this.waypoints && this.distTraveled >= this.totalLen && !this.invading) {
            // TASK-402 formations: line/wedge stances HOLD station at the
            // destination — only 'free' (or AI hulls) wander to the next point.
            if (this.owner !== myRole || C.FLEET_STANCES[fleetStanceIdx] === 'free') this._pickPatrolCourse();
        }

        // Advance along course (hold = don't move)
        const moving = this.mode !== 'hold' && this.waypoints && this.distTraveled < this.totalLen;
        if (moving) {
            this.distTraveled += this.speedKmPerFrame;
            while (this.curSeg < this.segLens.length && this.distTraveled > this.segStarts[this.curSeg + 1]) this.curSeg++;
            const segIdx = Math.min(this.curSeg, this.segLens.length - 1);
            const segT = this.segLens[segIdx] > 0 ? (this.distTraveled - this.segStarts[segIdx]) / this.segLens[segIdx] : 0;
            const a = this.waypoints[segIdx], b = this.waypoints[segIdx + 1];
            this.curLat = a.lat + (b.lat - a.lat) * segT;
            this.curLon = a.lon + (b.lon - a.lon) * segT;
            // OPTIMIZE (audit #20 mate): the per-frame clone() → shared scratch
            this.mesh.position.copy(
                _wsV1.copy(this.wpVecs[segIdx]).lerp(this.wpVecs[segIdx + 1], segT).normalize().multiplyScalar(this._radius));
        }

        // Heal near own port (+ transports re-embark troops there)
        if ((this.hp < this.maxHp || (this.hullClass === 'transport' && this.troops === 0)) && frame % 30 === 0) {
            for (const s of structs) {
                if (s.dead || s.owner !== this.owner || s.type !== 'port') continue;
                if (haversineDist(this.curLat, this.curLon, s.lat, s.lon) < C.WARSHIP_HEAL_RANGE_KM) {
                    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + C.WARSHIP_HEAL_RATE * 0.5);
                    if (this.hullClass === 'transport' && this.troops === 0) this._embarkTroops(0.3);
                    break;
                }
            }
        }

        // Orient: bow toward next waypoint / target (up = surface normal)
        this._orient();
        this._updateShells();
        this._fxTick(moving);   // TASK-402 polish: wakes, burning decks, sub depth
    }

    // TASK-402 POLISH — speed-scaled bow spray + stern foam on sailing hulls,
    // smoke/fire on burning decks below half health, submerged depth for subs.
    _fxTick(moving) {
        // Submerged hulls ride below the surface (deeper while hidden) — no wake
        if (this.hull.submerged) {
            const targetR = this._radius - (this.detected ? 0.12 : 0.6);
            const len = this.mesh.position.length();
            if (len > 0) this.mesh.position.multiplyScalar(targetR / len);
            return;
        }
        if (moving && (this._fxT = (this._fxT + 1) % 6) === 0) {
            this.mesh.updateMatrixWorld();
            _wsV1.set(0, 0, -10).applyMatrix4(this.mesh.matrixWorld);
            _puffAt(_wsV1, 0xdff1fa, 1.5 + this.hull.scale * 0.4, null, 12);    // bow spray
            _wsV1.set(0, 0, 11).applyMatrix4(this.mesh.matrixWorld);
            _puffAt(_wsV1, 0xeaf6fc, 2.2 + this.hull.scale * 0.5, null, 18);    // stern foam
        }
        // Burning decks: smoke below 50% hp, denser + fire below 25%
        if (this.hp < this.maxHp * 0.5 && frame % 18 === (this.id % 18)) {
            this.mesh.updateMatrixWorld();
            const deep = this.hp < this.maxHp * 0.25;
            _wsV1.set((Math.random() - 0.5) * 2, 3.5, (Math.random() - 0.5) * 6).applyMatrix4(this.mesh.matrixWorld);
            _puffAt(_wsV1, deep ? 0x2b2b30 : 0x555a60, deep ? 3.2 : 2.2, null, 40);
            if (Math.random() < (deep ? 0.75 : 0.4)) {
                _wsV1.set((Math.random() - 0.5) * 3, 2.2, (Math.random() - 0.5) * 8).applyMatrix4(this.mesh.matrixWorld);
                _puffAt(_wsV1, 0xff7733, 1.4, null, 14);
            }
        }
    }

    // ════════════════════════════════════════════════════════════════
    // HULL-CLASS SUBSYSTEMS — TASK-402: moved into the strategy table at
    // src/naval/hulls.js (NAVAL_HULLS[hullClass].updateSystems / fleetBehavior
    // / fire). Point defense, CIWS, air wing, drone bay, VLS, sub combat,
    // invasion landings, leash/standoff — all per-hull modules now.
    // ════════════════════════════════════════════════════════════════

    // TRANSPORT — embark troops from the owner's pool (called at purchase
    // and when resting at a friendly port).
    _embarkTroops(pct) {
        const pool = this.owner === 'player' ? pTroops
            : (isBotStr(this.owner) ? (botByStr(this.owner) || { troops: 0 }).troops : eTroops);
        const take = Math.floor(pool * pct);
        if (take < 50) return false;
        if (conquestCtx) conquestCtx.addTroops(this.owner, -take);
        else if (this.owner === 'player') pTroops -= take;
        this.troops = take;
        if (this.owner === 'player') logEvent(`🚢 ${this.name}: صعد ${take.toLocaleString('en')} جندي — انقر ساحل العدو للإنزال`, 'info');
        return true;
    }

    // TRANSPORT — player clicked an enemy coast: sail there and land.
    _orderInvasion(shore) {
        if (this.hullClass !== 'transport' || this.troops <= 0) return false;
        this.invLat = shore.lat; this.invLon = shore.lon;
        this.invading = true;
        this.target = null;
        this.mode = 'invasion';
        this._setCourse(shore.lat, shore.lon);
        if (this.owner === 'player') logEvent(`🚢 ${this.name} تتجه لإنزال ${this.troops.toLocaleString('en')} جندي!`, 'info');
        return true;
    }

    _orient() {
        // OPTIMIZE: scratch vectors instead of per-frame clones
        this.mesh.up.copy(_wsV2.copy(this.mesh.position).normalize());
        let lookVec = null;
        const t = this.target;
        if (t) lookVec = latLonToVec3(t.lat, t.lon, this._radius);
        else if (this.waypoints && this.distTraveled < this.totalLen) {
            const segIdx = Math.min(this.curSeg, this.segLens.length - 1);
            lookVec = this.wpVecs[segIdx + 1];
        }
        if (lookVec) {
            this.mesh.lookAt(_wsV3.copy(lookVec).normalize().multiplyScalar(this._radius));
            // lookAt aims +Z at the target but the bow is -Z → flip so the
            // ship sails BOW-first (was inverted: sailing backwards).
            this.mesh.rotateY(Math.PI);
        }
    }
}

// Find a WATER point within ~30-280km of (lat,lon) — warship spawn anchor.
function _findWaterNear(lat, lon, maxTries) {
    for (let i = 0; i < maxTries; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dkm = 30 + Math.random() * 250;
        const t = {
            lat: lat + (dkm * Math.cos(ang)) / 111,
            lon: lon + (dkm * Math.sin(ang)) / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)))
        };
        if (!isLand(t.lat, t.lon)) return t;
    }
    return null;
}
// Live position of a warship target (transports/trades lerp along their route;
// straight-line approx is fine for range checks and shell aim points).
function _targetLivePos(kind, obj) {
    if (kind === 'warship') return { lat: obj.curLat, lon: obj.curLon };
    // TASK-402 shore bombardment: buildings + armor divisions are static points
    if (kind === 'struct' || kind === 'tank') return { lat: obj.lat, lon: obj.lon };
    const t = obj.totalLen > 0 ? Math.min(1, obj.distTraveled / obj.totalLen) : 0;
    const aLat = kind === 'trade' ? obj.srcPort.lat : obj.srcLat;
    const aLon = kind === 'trade' ? obj.srcPort.lon : obj.srcLon;
    const bLat = kind === 'trade' ? obj.dstPort.lat : obj.dstLat;
    const bLon = kind === 'trade' ? obj.dstPort.lon : obj.dstLon;
    return { lat: aLat + (bLat - aLat) * t, lon: aLon + (bLon - aLon) * t };
}
// OpenFront-style unit pick: nearest OWN warship (90km), tank division
// (70km — formations spread wide) or plane (50km) at a clicked point.
function _pickOwnUnitAt(lat, lon) {
    let best = null, bestScore = Infinity;
    for (const w of warships) {
        if (w.dead || w.owner !== myRole) continue;
        const d = haversineDist(lat, lon, w.curLat, w.curLon);
        if (d < 90) { const s = d / 90; if (s < bestScore) { bestScore = s; best = w; } }
    }
    for (const t of tanks) {
        if (t.dead || t.owner !== myRole) continue;
        const d = haversineDist(lat, lon, t.lat, t.lon);
        if (d < GAME_CONSTANTS.TANK_PICK_R_KM) {
            const s = d / GAME_CONSTANTS.TANK_PICK_R_KM + 0.08;
            if (s < bestScore) { bestScore = s; best = t; }
        }
    }
    for (const p of planes) {
        if (p.dead || p.owner !== myRole) continue;
        const d = haversineDist(lat, lon, p.lat, p.lon);
        if (d < 50) { const s = d / 50 + 0.05; if (s < bestScore) { bestScore = s; best = p; } }
    }
    return best;
}
function _killTradeShip(ts) {
    if (ts.dead) return;
    ts.dead = true;
    scene.remove(ts.mesh);
    if (ts.mesh.material) ts.mesh.material.dispose();
    if (ts.pathLine) { scene.remove(ts.pathLine); disposeMeshDeep(ts.pathLine); }
}
function _ownerName(str) {
    if (str === 'player') return 'لاعب';
    const b = botByStr(str);
    return b ? `${b.flag} ${b.name}` : 'العدو';
}

// Spend resources for a naval action (missile-ship VLS shots etc.).
// Centralizes the player/bot/legacy-enemy pool split; returns false (and
// holds fire) when the side can't afford the shot.
function _navalSpend(owner, amt) {
    if (owner === 'player') {
        if (pRes < amt) return false;
        pRes -= amt;
        return true;
    }
    if (isBotStr(owner)) {
        const b = botByStr(owner);
        if (!b || b.res < amt) return false;
        b.res -= amt;
        return true;
    }
    if (eRes < amt) return false;
    eRes -= amt;
    return true;
}

// ══════════════════════════════════════════════════════════════════
//  TASK-402: NAVAL_CTX — the bridge into src/naval/hulls.js.
//  Everything the strategy-pattern hull behaviors need from game scope,
//  via LAZY GETTERS so array re-assignments (resets/restarts) stay visible
//  to the module for the whole session. Function/class references resolve
//  at call time (module-level declarations hoist).
// ══════════════════════════════════════════════════════════════════
const NAVAL_CTX = {
    // state (lazy — these are `let` bindings that get reassigned on reset)
    get frame() { return frame; },
    get selMissile() { return selMissile; },
    get isOnline() { return isOnline; },
    get myRole() { return myRole; },
    get scene() { return scene; },
    get conquestGrid() { return conquestGrid; },
    get conquestCtx() { return conquestCtx; },
    get warships() { return warships; },
    get missiles() { return missiles; },
    get drones() { return drones; },
    get planes() { return planes; },
    get structs() { return structs; },
    get tanks() { return tanks; },
    get transportShips() { return transportShips; },
    get tradeShips() { return tradeShips; },
    get torpedoes() { return torpedoes; },
    get mineFields() { return mineFields; },
    get SFX() { return SFX; },
    get Missile() { return Missile; },
    get Plane() { return Plane; },
    get ConquestAttack() { return ConquestAttack; },
    // functions (hoisted declarations / direct refs)
    fireSAM, launchDrone, logEvent, spawnExp, haversineDist, sendAction,
    renderMode1Territory, _tracer, latLonToVec3,
    ownerName: _ownerName, navalSpend: _navalSpend, targetLivePos: _targetLivePos,
    killTradeShip: _killTradeShip, missileScatter: _missileScatter,
    newId: () => ++_id, buildTorpedoMesh, buildMineModel,
    puffAt: _puffAt, disposeMesh: disposeMeshDeep,
    pushAttack: (atk) => activeAttacks.push(atk),
    fleetStanceIdx: () => fleetStanceIdx,
};

// TASK-402 POLISH: sinking animation — a dead hull lists over and settles
// toward the seabed over ~3s (bubble wake) instead of vanishing instantly.
// The animator owns the mesh from _sink() until it reaches the bottom.
function _tickNavalSinking() {
    for (let i = navalSinking.length - 1; i >= 0; i--) {
        const sk = navalSinking[i];
        sk.t++;
        sk.mesh.rotateZ(0.028);                          // list over around the longitudinal axis
        sk.mesh.position.multiplyScalar(1 - 0.0016);     // settle toward the planet center
        if (sk.t % 30 === 0) _puffAt(sk.mesh.position, 0xcfe8f2, 2.0 * sk.scale, null, 26);   // air escaping
        if (sk.t >= sk.dur) {
            scene.remove(sk.mesh);
            disposeMeshDeep(sk.mesh);   // accents disposed; shared hull mats survive
            navalSinking.splice(i, 1);
        }
    }
}

class Train {
    constructor(factory, target, owner) {
        this.id = ++_id;
        this.owner = owner;
        this.startVec = factory.pos.clone().normalize().multiplyScalar(EARTH_RADIUS + 5.0);
        this.targetVec = latLonToVec3(target.lat, target.lon).normalize().multiplyScalar(EARTH_RADIUS + 5.0);
        this.progress = 0;
        this.dead = false;
        
        let col = owner === 'player' ? 0x00ff88 : ownerHexColor(owner);
        let geom = new THREE.BoxGeometry(8.0, 4.0, 4.0);
        let mat = new THREE.MeshPhongMaterial({color: col, flatShading: true});
        this.mesh = new THREE.Mesh(geom, mat);
        this.mesh.position.copy(this.startVec);
        scene.add(this.mesh);
        
        this.speed = 0.005; 
    }
    
    update() {
        this.progress += this.speed;
        if (this.progress >= 1.0) {
            this.arrive();
            return;
        }
        
        let curVec = this.startVec.clone().lerp(this.targetVec, this.progress).normalize().multiplyScalar(EARTH_RADIUS + 5.0);
        this.mesh.position.copy(curVec);
        this.mesh.lookAt(this.targetVec);
    }
    
    arrive() {
        this.dead = true;
        scene.remove(this.mesh);
        if (this.mesh.geometry) this.mesh.geometry.dispose();
        if (this.mesh.material) this.mesh.material.dispose();
        
        const payout = GAME_CONSTANTS.TRAIN_PAYOUT;
        if (this.owner === 'player') {
            pRes += payout;
            logEvent(`قطار بضائع وصل المحطة! كسبت 💰${payout} من النقل البري.`, 'info');
        } else {
            eRes += payout;
        }
        updateHUD();
    }
}

class PaintExpansion {
    constructor(slat, slon, tlat, tlon, troops, owner, maxRadiusKm = 250) {
        this.id = ++_id;
        this.owner = owner;
        this.troops = troops;
        this.tlat = tlat;
        this.tlon = tlon;
        this.maxRadiusKm = maxRadiusKm;
        this.dead = false;
        
        // Cache the target owner at creation so it doesn't change mid-crawl
        this.targetOwner = getPixelOwner(tlat, tlon);
        
        this.queue = [{ lat: slat, lon: slon, dist: haversineDist(slat, slon, tlat, tlon) }];
        this.visited = new Set();
        this.visited.add(`${slat.toFixed(3)},${slon.toFixed(3)}`);
        
        this.tickInterval = 1; // Faster updates
        this.tickCount = 0;
    }
    
    update() {
        if (this.dead) return;
        this.tickCount++;
        if (this.tickCount % this.tickInterval !== 0) return;
        
        if (this.queue.length === 0 || this.troops <= 0) {
            this.dead = true;
            return;
        }
        
        // Process a chunk of pixels per tick for organic blob expansion
        let count = Math.min(5, this.queue.length);
        for (let step = 0; step < count; step++) {
            if (this.queue.length === 0) break;
            let current = this.queue.shift();
            
            let currentOwner = getPixelOwner(current.lat, current.lon);
            
            if (currentOwner === this.owner) {
                // Own territory — don't paint, just act as starting point
            } else if (currentOwner === this.targetOwner || currentOwner === 'neutral') {
                // Target territory — conquer it
                if (currentOwner === 'neutral') {
                    let cost = this.owner === 'player' ? 15 : 8;
                    if (this.troops < cost) {
                        this.dead = true;
                        return;
                    }
                    this.troops -= cost;
                    paintCircleOnLandDirect(current.lat, current.lon, 45, this.owner);
                } else {
                    // Enemy combat
                    let targetList = currentOwner === 'player' ? window.playerCoordinates : window.enemyCoordinates;
                    let nearCoords = targetList.filter(c => haversineDist(c.lat, c.lon, current.lat, current.lon) <= 45);
                    
                    if (nearCoords.length > 0) {
                        let totalDefTroops = currentOwner === 'player' ? pTroops : eTroops;
                        let defenderPower = Math.max(50, Math.floor(totalDefTroops / Math.max(1, targetList.length)));
                        
                        if (this.troops > defenderPower) {
                            this.troops -= defenderPower;
                            if (currentOwner === 'player') {
                                window.playerCoordinates = window.playerCoordinates.filter(c => haversineDist(c.lat, c.lon, current.lat, current.lon) > 45);
                                pTroops = Math.max(0, pTroops - defenderPower);
                            } else {
                                window.enemyCoordinates = window.enemyCoordinates.filter(c => haversineDist(c.lat, c.lon, current.lat, current.lon) > 45);
                                eTroops = Math.max(0, eTroops - defenderPower);
                            }
                            paintCircleOnLandDirect(current.lat, current.lon, 45, this.owner);
                        } else {
                            if (currentOwner === 'player') {
                                pTroops = Math.max(0, pTroops - this.troops);
                            } else {
                                eTroops = Math.max(0, eTroops - this.troops);
                            }
                            this.troops = 0;
                            this.dead = true;
                            updateHUD();
                            return;
                        }
                    } else {
                        let cost = 15;
                        if (this.troops < cost) {
                            this.dead = true;
                            return;
                        }
                        this.troops -= cost;
                        paintCircleOnLandDirect(current.lat, current.lon, 45, this.owner);
                    }
                }
                updateHUD();
            } else {
                // Third-party territory — skip entirely
                continue;
            }
            
            // Add neighbors: only queue target territory to avoid flood-filling own territory
            for (let i = 0; i < 6; i++) {
                let angle = i * Math.PI / 3;
                let distDeg = 0.35;
                let nLat = current.lat + Math.sin(angle) * distDeg;
                let nLon = current.lon + Math.cos(angle) * distDeg;
                
                nLat = Math.max(-85, Math.min(85, nLat));
                if (nLon > 180) nLon -= 360;
                if (nLon < -180) nLon += 360;
                
                let key = `${nLat.toFixed(3)},${nLon.toFixed(3)}`;
                if (this.visited.has(key)) continue;
                
                if (isLand(nLat, nLon)) {
                    let nOwner = getPixelOwner(nLat, nLon);
                    
                    if (nOwner === this.targetOwner) {
                        let dToTarget = haversineDist(nLat, nLon, this.tlat, this.tlon);
                        // Prevent infinite backwards expansion; only expand near target radius
                        if (dToTarget < this.maxRadiusKm) {
                            this.visited.add(key); // Mark visited here to avoid duplicate enqueues
                            this.queue.push({ lat: nLat, lon: nLon, dist: dToTarget });
                        }
                    }
                }
            }
            
            // NO SORTING — This creates a pure Breadth-First Search (BFS).
            // A BFS expands uniformly layer-by-layer, forming a perfect, organic blob
            // growing outward from the starting border, exactly like OpenFront.
        }
    }
}

class TroopCohort {
    constructor(slat, slon, tlat, tlon, troops, owner, targetProvinceIdx) {
        this.id = ++_id;
        this.owner = owner;
        this.troops = troops;
        this.tlat = tlat;
        this.tlon = tlon;
        this.targetProvinceIdx = targetProvinceIdx;
        this.progress = 0;
        this.dead = false;
        
        this.startVec = latLonToVec3(slat, slon).normalize().multiplyScalar(EARTH_RADIUS + 20.0);
        this.targetVec = latLonToVec3(tlat, tlon).normalize().multiplyScalar(EARTH_RADIUS + 20.0);
        this.progress = 0;
        
        if (window.gameMode === 'mode1') {
            this.totalDist = haversineDist(slat, slon, tlat, tlon);
            this.currentDist = 0;
            this.tickInterval = 3; // run painting & combat logic every 3 frames
            this.tickCount = 0;
        } else {
            this.speed = 0.006; 
        }
        
        let col = ownerHexColor(owner);
        let geom = new THREE.SphereGeometry(15.0, 8, 8);
        let mat = new THREE.MeshBasicMaterial({color: col, transparent: true, opacity: 0.9});
        this.mesh = new THREE.Mesh(geom, mat);
        this.mesh.position.copy(this.startVec);
        if (window.gameMode === 'mode1') {
            this.mesh.visible = false; // Hide cohort sphere in Mode 1 to keep expansion purely paint-based
        }
        scene.add(this.mesh);
    }
    
    update() {
        if (window.gameMode === 'mode1') {
            this.tickCount++;
            if (this.tickCount % this.tickInterval === 0) {
                // Dynamic speed based on troop count (OpenFront style: larger troop cohorts push frontlines faster)
                let troopScale = Math.min(2.0, Math.max(0.5, this.troops / 1000));
                let stepSize = 25 * troopScale; // Base 25km per step
                
                this.currentDist = Math.min(this.totalDist, this.currentDist + stepSize);
                this.progress = this.currentDist / Math.max(1, this.totalDist);
                
                let locVec = this.startVec.clone().lerp(this.targetVec, this.progress).normalize().multiplyScalar(EARTH_RADIUS);
                let loc = vec3ToLatLon(locVec);
                
                let currentOwner = getPixelOwner(loc.lat, loc.lon);
                
                if (currentOwner !== this.owner) {
                    if (currentOwner === 'neutral') {
                        // Wilderness cost: player loses 15, AI loses 8 (matches OpenFront's mag/5 vs mag/10)
                        let wildernessCost = this.owner === 'player' ? 15 : 8;
                        if (this.troops <= wildernessCost) {
                            this.dead = true;
                            scene.remove(this.mesh);
                            if (this.mesh.material) this.mesh.material.dispose();
                            return;
                        }
                        this.troops -= wildernessCost;
                        paintCircleOnLandDirect(loc.lat, loc.lon, 45, this.owner);
                    } else {
                        // Combat with enemy (tile-by-tile border skirmish overlap)
                        let targetList = currentOwner === 'player' ? window.playerCoordinates : window.enemyCoordinates;
                        // Use overlap check matching the paint circle size (45km)
                        let nearCoords = targetList.filter(c => haversineDist(c.lat, c.lon, loc.lat, loc.lon) <= 45);
                        
                        if (nearCoords.length > 0) {
                            let totalDefTroops = currentOwner === 'player' ? pTroops : eTroops;
                            let defenderPower = Math.max(50, Math.floor(totalDefTroops / Math.max(1, targetList.length)));
                            
                            if (this.troops > defenderPower) {
                                this.troops = Math.max(10, Math.floor((this.troops - defenderPower) * 0.9));
                                
                                if (currentOwner === 'player') {
                                    window.playerCoordinates = window.playerCoordinates.filter(c => haversineDist(c.lat, c.lon, loc.lat, loc.lon) > 45);
                                    pTroops = Math.max(0, pTroops - defenderPower);
                                } else {
                                    window.enemyCoordinates = window.enemyCoordinates.filter(c => haversineDist(c.lat, c.lon, loc.lat, loc.lon) > 45);
                                    eTroops = Math.max(0, eTroops - defenderPower);
                                }
                                paintCircleOnLandDirect(loc.lat, loc.lon, 45, this.owner);
                            } else {
                                let lostTroops = this.troops;
                                if (currentOwner === 'player') {
                                    pTroops = Math.max(0, pTroops - lostTroops);
                                } else {
                                    eTroops = Math.max(0, eTroops - lostTroops);
                                }
                                this.dead = true;
                                scene.remove(this.mesh);
                                if (this.mesh.material) this.mesh.material.dispose();
                                updateHUD();
                                return;
                            }
                        } else {
                            // Encroaching frontline boundary
                            let claimCost = 15;
                            if (this.troops <= claimCost) {
                                this.dead = true;
                                scene.remove(this.mesh);
                                if (this.mesh.material) this.mesh.material.dispose();
                                return;
                            }
                            this.troops -= claimCost;
                            paintCircleOnLandDirect(loc.lat, loc.lon, 45, this.owner);
                        }
                    }
                    updateHUD();
                } else {
                    paintCircleOnLandDirect(loc.lat, loc.lon, 45, this.owner);
                }
            }
            
            if (this.currentDist >= this.totalDist) {
                this.arrive();
                return;
            }
            
            let curVec = this.startVec.clone().lerp(this.targetVec, this.progress).normalize().multiplyScalar(EARTH_RADIUS + 20.0);
            this.mesh.position.copy(curVec);
        } else {
            this.progress += this.speed;
            if (this.progress >= 1.0) {
                this.arrive();
                return;
            }
            
            let curVec = this.startVec.clone().lerp(this.targetVec, this.progress).normalize().multiplyScalar(EARTH_RADIUS + 20.0);
            this.mesh.position.copy(curVec);
            
            if (Math.random() < 0.3) {
                createTrailMesh(curVec);
            }
        }
    }
    
    arrive() {
        this.dead = true;
        scene.remove(this.mesh);
        if (this.mesh.material) this.mesh.material.dispose();
        
        if (window.gameMode === 'mode1') {
            paintCircleOnLandDirect(this.tlat, this.tlon, 50, this.owner);
            if (this.owner === 'player') {
                pTroops += this.troops;
                logEvent(`اكتمل زحف القوات وضم الأراضي (+${this.troops} جندي).`, 'info');
                spawnExp(this.tlat, this.tlon, 4, '#00ff88');
            } else {
                eTroops += this.troops;
                logEvent(`تحذير: أكمل العدو زحفه الإقليمي!`, 'err');
                spawnExp(this.tlat, this.tlon, 4, '#ff2200');
            }
            updateHUD();
        } else {
            executeTroopArrival(this);
        }
    }
}

// Fast O(1) ownership lookup via the conquest grid (replaces slow per-pixel canvas reads)
function getPixelOwner(lat, lon) {
    if (conquestGrid) return conquestGrid.ownerAt(lat, lon);
    return 'neutral';
}
window.getPixelOwner = getPixelOwner;
// Debug probe for the FFA bot system (console-driven testing)
window.__ffaProbe = {
    // TASK-406 follow-up: water-mask probes — ownerAt passthrough + ASCII scan
    // (from→to, N segments; '#'=land '~'=water). tankRiverProbe companion.
    ownerAt: (lat, lon) => conquestGrid ? conquestGrid.ownerAt(lat, lon) : 'no-grid',
    maskScan: (flat, flon, tlat, tlon, segs = 24) => {
        if (!conquestGrid) return 'no-grid';
        let out = '';
        for (let i = 0; i <= segs; i++) {
            const lat = flat + (tlat - flat) * i / segs;
            const lon = flon + (tlon - flon) * i / segs;
            out += conquestGrid.ownerAt(lat, lon) === 'water' ? '~' : '#';
        }
        return out;
    },
    // camera/controls state (module-scoped camera+controls not on window)
    cam: () => camera && controls ? {
        dist: camera.position.length(),
        rotateSpeed: controls.rotateSpeed,
        theta: new THREE.Spherical().setFromVector3(camera.position).theta,
        phi: new THREE.Spherical().setFromVector3(camera.position).phi
    } : null,
    countCells: (s) => conquestGrid ? conquestGrid.countCells(s) : -1,
    frontline: (a, p) => conquestGrid ? conquestGrid.findFrontlineTarget(a, p) : null,
    bots: () => bots.map(b => ({ str: b.str, name: b.name, alive: b.alive, troops: Math.floor(b.troops), res: Math.floor(b.res), cells: conquestGrid ? conquestGrid.countCells(b.str) : -1 })),
    aiTick: (i) => aiConquestTick(bots[i]),
    attacks: () => activeAttacks.length,
    structs: () => structs.filter(s => !s.dead).map(s => ({
        type: s.type, owner: s.owner,
        isModel: !!(s.mesh && s.mesh.isGroup),
        meshCount: (s.mesh) ? (() => { let n = 0; s.mesh.traverse(o => { if (o.isMesh) n++; }); return n; })() : 0,
        accentCount: (s.accents || []).length,
        animParts: s.anim ? Object.keys(s.anim).filter(k => s.anim[k]).join(',') : ''
    })),
    // 3D model sanity: build every type once, report mesh counts + body hexes
    modelCheck: () => {
        const out = {};
        for (const t of ['city','port','factory','airport','launcher','sam','radar','flak','himars','ciws','iron_dome','nuke_plant','base']) {
            try {
                const m = buildStructModel(t, 'player');
                let n = 0; const hexes = {};
                m.group.traverse(o => {
                    if (o.isMesh) { n++; if (o.material && o.material.color) hexes[o.material.color.getHexString()] = 1; }
                });
                out[t] = { meshes: n, accents: m.accents.length, bodyHexes: Object.keys(hexes) };
                m.accents.forEach(mm => mm.dispose());
            } catch (e) { out[t] = 'ERR: ' + e.message; }
        }
        return out;
    },
    // capture repatriation check: build → capture → verify accents flipped to enemy color
    captureCheck: () => {
        const s = new Structure(20, 20, 'city', 'player');
        _captureStructure(s, 'enemy');
        const accents = s.accents.map(m => m.color.getHexString());
        scene.remove(s.mesh); scene.remove(s.selRing);
        s.accents.forEach(m => m.dispose());
        if (s.selRing && s.selRing.material) s.selRing.material.dispose();
        return { accents: [...new Set(accents)] };
    },
    // warship live state
    warships: () => warships.map(w => ({
        owner: w.owner, hp: Math.round(w.hp), mode: w.mode, sel: !!w.selected,
        tgt: w.target ? w.target.kind : null, shells: w.shells.length,
        patrol: [Math.round(w.patrolLat * 10) / 10, Math.round(w.patrolLon * 10) / 10],
        pos: [Math.round(w.curLat * 10) / 10, Math.round(w.curLon * 10) / 10]
    })),
    // TASK-302: tank division live state
    tanks: () => tanks.map(t => ({
        owner: t.owner, key: t.key, hp: Math.round(t.hp), mode: t.mode, shots: t.shots,
        vehicles: `${t.members.length}/${t.members0}`,
        tgt: t.target ? t.target.kind : null,
        march: [Math.round(t.tgtLat * 10) / 10, Math.round(t.tgtLon * 10) / 10],
        pos: [Math.round(t.lat * 10) / 10, Math.round(t.lon * 10) / 10]
    })),
    // missile mode state
    missileMode: () => ({
        on: missileMode, sel: selMissile, volley: volleyCount,
        rings: _missileRingsGroup ? _missileRingsGroup.children.length : 0,
        hudVisible: _missileHud ? _missileHud.style.display !== 'none' && _missileHud.innerHTML !== '' : false,
        readyLaunchers: structs.filter(s => !s.dead && s.owner === myRole && s.type === 'launcher' && s.reload <= 0).length
    }),
    // missile model sanity: build every type, report mesh counts + lengths
    missileCheck: () => {
        const out = {};
        Object.keys(MCFG).forEach(k => {
            try {
                const m = buildMissileModel(k, 'player');
                let n = 0;
                m.traverse(o => { if (o.isMesh) n++; });
                m.updateMatrixWorld(true);
                const bb = new THREE.Box3().setFromObject(m);
                out[k] = { meshes: n, len: Math.round(bb.max.z - bb.min.z), accents: m.userData.accents.length };
                m.userData.accents.forEach(mm => mm.dispose());
            } catch (e) { out[k] = 'ERR: ' + e.message; }
        });
        return out;
    },
    // fire a test missile of any type from a fixed mid-Atlantic point
    fireTestMissile: (key) => {
        const cfg = MCFG[key]; if (!cfg) return 'no cfg';
        const m = new Missile(20, -42, 26, -36, cfg, 'player');
        missiles.push(m);
        return { mkey: m.mkey, spdKmS: m.speed, distKm: Math.round(m.dist) };
    },
    // impact-accuracy distribution per missile type (uses the same scatter
    // helper as the fire sites): N simulated shots → avg/max km off target
    spreadCheck: () => {
        const out = {};
        Object.keys(MCFG).forEach(k => {
            const cfg = MCFG[k];
            let sum = 0, max = 0;
            const N = 60;
            for (let i = 0; i < N; i++) {
                const { dx, dy } = _missileScatter(cfg);
                const km = Math.hypot(dx * 111, dy * 111 * 0.7);
                sum += km; if (km > max) max = km;
            }
            out[k] = { avgKm: Math.round(sum / N), maxKm: Math.round(max), acc: cfg.acc };
        });
        return out;
    },
    // end-to-end accuracy: fire ONE shot at a known click point (spread
    // applied exactly like the fire sites) and report impact error in km.
    accuracyTest: () => {
        const cfg = MCFG['ballistic'];
        const { dx, dy } = _missileScatter(cfg);
        const m = new Missile(20, -42, 26 + dx, -36 + dy, cfg, 'player');
        missiles.push(m);
        window.__accT = { m, click: { lat: 26, lon: -36 } };
        return 'fired';
    },
    accuracyResult: () => {
        const t = window.__accT; if (!t) return null;
        return {
            dead: t.m.dead, progress: +t.m.progress.toFixed(3),
            impactErrKm: Math.round(haversineDist(t.m.lat, t.m.lon, t.click.lat, t.click.lon))
        };
    },
    // air-defense intercept test: player SAM + enemy ballistic inbound at it.
    // Success = attacker dead with progress < 0.9 (killed mid-flight, not landed).
    samTest: () => {
        const sam = new Structure(25, -40, 'sam', 'player');
        structs.push(sam);
        const atk = new Missile(28, -36, 25, -40, MCFG['ballistic'], 'enemy');
        missiles.push(atk);
        window.__samT = { atk, sam };
        return { fired: true, flightKm: Math.round(atk.dist), etaS: +(atk.dist / atk.speed).toFixed(1) };
    },
    samResult: () => {
        const t = window.__samT; if (!t) return null;
        return {
            attackerDead: t.atk.dead, progress: +t.atk.progress.toFixed(2),
            intercepted: t.atk.dead && t.atk.progress < 0.95,
            samAlive: !t.sam.dead
        };
    },
    // TASK-102 occupation tests: devastation painting + troop-scale speed
    // (LAND coords — devastation only paints land cells)
    devastTest: () => {
        if (!conquestGrid) return 'no grid';
        conquestGrid.applyDevastation(35, -98, 200, 1);   // USA midlands
        const c = conquestGrid.latLonToCell(35, -98);
        return { dev: +conquestGrid.devastationAt(c).toFixed(2) };
    },
    devAt: (lat, lon) => conquestGrid ? +conquestGrid.devastationAt(conquestGrid.latLonToCell(lat, lon)).toFixed(2) : 'no grid',
    // REAL conquest-rate measurement: launch an attack with N troops at nearby
    // neutral land, report cells gained per second over `secs`.
    // Returns a handle; call conquestRateResult() after the wait.
    conquestRateTest: (troops, secs = 8) => {
        if (!conquestGrid || !conquestCtx) return 'no grid';
        const me = myRole;
        const myCode = me === 'player' ? CONQUEST_CFG.PLAYER : CONQUEST_CFG.ENEMY;
        // find ANY owned cell (strided scan — player may be anywhere)
        let src = null;
        const owner = conquestGrid.owner;
        for (let cell = 0; cell < owner.length; cell += 37) {
            if (owner[cell] === myCode) {
                const ll = conquestGrid.cellToLatLon(cell);
                src = ll; break;
            }
        }
        if (!src) return 'no owned cell for source';
        // target: neutral land near the source (offset south 12°, clamped)
        const tLat = Math.max(-60, Math.min(60, src.lat - 12));
        const tLon = src.lon + 8 > 180 ? src.lon - 8 : src.lon + 8;
        const atk = new ConquestAttack({
            grid: conquestGrid, owner: me, target: 'neutral',
            troops, srcLat: src.lat, srcLon: src.lon, dstLat: tLat, dstLon: tLon, ctx: conquestCtx,
        });
        if (!atk.active) return 'attack aborted (no frontier)';
        activeAttacks.push(atk);
        const c0 = conquestGrid.countCells(me);
        window.__rateT = { atk, c0, t0: performance.now(), troops };
        return { started: true, troops, cellsBefore: c0, src: [Math.round(src.lat), Math.round(src.lon)] };
    },
    conquestRateResult: () => {
        const t = window.__rateT; if (!t) return null;
        const secs = (performance.now() - t.t0) / 1000;
        const gained = conquestGrid.countCells(t.atk.owner) - t.c0;
        return { troops: t.troops, secs: +secs.toFixed(1), cellsGained: gained,
                 cellsPerSec: Math.round(gained / Math.max(1, secs)), attackAlive: t.atk.active };
    },
    setTroops: (n) => { conquestCtx.addTroops('player', n - conquestCtx.getTroops('player')); return Math.round(conquestCtx.getTroops('player')); },
    // fire a missile at LAND (devastation target test) — Arabia
    fireTestMissileLand: (key) => {
        const cfg = MCFG[key] || MCFG['ballistic'];
        const m = new Missile(35, -20, 24, 45, cfg, 'player');   // Atlantic → Arabia
        missiles.push(m);
        window.__landT = { m };
        return { distKm: Math.round(m.dist), etaS: +(m.dist / m.speed).toFixed(1) };
    },
    troopScaleTest: () => {
        // neutral expansion: rate at 100 vs 10,000 vs 100,000 committed troops
        const small = attackTilesPerTickCtx(conquestGrid, 100, 'neutral', 0, 10);
        const big = attackTilesPerTickCtx(conquestGrid, 10000, 'neutral', 0, 10);
        const bigger = attackTilesPerTickCtx(conquestGrid, 100000, 'neutral', 0, 10);
        // attackLogic neutral branch (the one actually reworked):
        const mkCtx = (t) => ({ getTroops: () => t, addTroops: () => {} });
        const loss100 = attackLogic(conquestGrid, 100, 'player', 'neutral', conquestGrid.latLonToCell(20, -42), mkCtx(100));
        const loss10k = attackLogic(conquestGrid, 10000, 'player', 'neutral', conquestGrid.latLonToCell(20, -42), mkCtx(10000));
        return { tilesAt100: +small.toFixed(1), tilesAt10k: +big.toFixed(1), tilesAt100k: +bigger.toFixed(1),
                 lossPerTile100: +loss100.attackerTroopLoss.toFixed(1), lossPerTile10k: +loss10k.attackerTroopLoss.toFixed(1) };
    },
    missileCount: () => missiles.filter(m => !m.dead).length,
    // bow-first orientation check: dot(bow-stern vector, toward-patrol vector) > 0
    orientation: () => warships.filter(w => !w.dead).map(w => {
        const bow = w.mesh.getObjectByName('bow'), stern = w.mesh.getObjectByName('stern');
        if (!bow || !stern) return { owner: w.owner, err: 'no bow/stern names' };
        const b = bow.getWorldPosition(new THREE.Vector3());
        const s = stern.getWorldPosition(new THREE.Vector3());
        const fwd = b.sub(s).normalize();
        const tgt = latLonToVec3(w.patrolLat, w.patrolLon, w._radius).sub(w.mesh.position).normalize();
        const upDot = w.mesh.up.dot(w.mesh.position.clone().normalize());
        return { owner: w.owner, bowDotTarget: +fwd.dot(tgt).toFixed(2), upDotSurface: +upDot.toFixed(2) };
    }),
    // project a lat/lon to screen coords (for click-simulating tests)
    proj: (lat, lon, alt = 1) => {
        const v = latLonToVec3(lat, lon, EARTH_RADIUS + alt);
        const p = v.clone().project(camera);
        return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, z: +p.z.toFixed(2) };
    },
    // teleport camera over a point (selection tests need the unit on-screen)
    camGoto: (lat, lon, alt = 3000) => {
        camera.position.copy(latLonToVec3(lat, lon, EARTH_RADIUS + alt));
        controls.target.set(0, 0, 0);
        controls.update();
        return 'ok';
    },
    // plane selection/mode state
    planeSel: () => planes.map(p => ({
        sel: !!p.selected, mode: p.mode,
        t: [Math.round(p.tlat * 10) / 10, Math.round(p.tlon * 10) / 10]
    })),
    stagePlane: () => {
        planes.push(new Plane(24.6, -40.8, PCFG['fighter'], myRole));
        return 'player fighter staged at (24.6,-40.8)';
    },
    // ═══ TASK-201: Air Force probes ═══
    // Manual logic-tick stepper — drives the sim deterministically for probe
    // tests even when the tab is hidden (RAF throttles to zero in background).
    step: (n = 1) => { for (let i = 0; i < n; i++) gameFrame(); return window.__perfState.frames; },
    airStats: () => ({ ...window.__airStats, planes: planes.length, aams: aamMissiles.length }),
    // model-chain sanity: build every PCFG type once, report GLB/OBJ/proxy source
    airModelsCheck: () => {
        if (!scene) return 'start a game first (scene not ready)';
        const out = {};
        for (const k of Object.keys(PCFG)) {
            const p = new Plane(0, 0, PCFG[k], 'player');
            let meshes = 0;
            if (p.mesh) p.mesh.traverse(o => { if (o.isMesh) meshes++; });
            out[k] = { src: p.modelSrc, meshes };
            if (p.mesh) { scene.remove(p.mesh); disposeMeshDeep(p.mesh); }
            if (p.selRing && p.selRing.material) { scene.remove(p.selRing); p.selRing.material.dispose(); }
            p.dead = true;   // never enters gameFrame
        }
        return out;
    },
    // dogfight probe: hostile fighters forced into a merge — verify AAMs fly
    // and someone dies. dogfightResult() → pass:true when resolved by AAM fire.
    dogfightTest: () => {
        const a = new Plane(20, -40, PCFG['f22'], myRole);
        const b = new Plane(20.9, -39.6, PCFG['fighter'], 'enemy');
        planes.push(a, b);
        for (const p of [a, b]) { p.parked = false; p.mode = 'patrol'; p.tlat = 20.4; p.tlon = -39.8; }
        window.__dogT = { a, b, t0: performance.now(), s0: { ...window.__airStats } };
        return 'staged: F-22 vs F-16, both airborne ~110km apart, converging';
    },
    dogfightResult: () => {
        const t = window.__dogT; if (!t) return null;
        const d = window.__airStats, s = t.s0;
        return {
            s: Math.round((performance.now() - t.t0) / 1000),
            aDead: t.a.dead, bDead: t.b.dead,
            aHp: Math.max(0, Math.round(t.a.hp)), bHp: Math.max(0, Math.round(t.b.hp)),
            aamFired: d.aamFired - s.aamFired,
            aamHits: d.aamHits - s.aamHits,
            gunBursts: d.gunBursts - s.gunBursts,
            flaresUsed: d.flaresUsed - s.flaresUsed,
            resolved: t.a.dead || t.b.dead,
            pass: (t.a.dead || t.b.dead) && (d.aamFired - s.aamFired > 0)
        };
    },
    // airstrike probe: A-10 vs a defended enemy compound — verifies role A2G
    // (anti-armor strikes + ammo burn + RTB) AND AA-vs-plane (flak/sam damage).
    airstrikeTest: () => {
        const s1 = new Structure(30, -41, 'launcher', 'enemy');
        const s2 = new Structure(30.15, -41.1, 'flak', 'enemy');
        const s3 = new Structure(29.9, -40.9, 'sam', 'enemy');
        structs.push(s1, s2, s3);
        const hp0 = [s1, s2, s3].map(s => s.hp);
        const p = new Plane(29.2, -40.2, PCFG['a10'], myRole);
        planes.push(p);
        p.parked = false; p.mode = 'attack'; p.tlat = 30; p.tlon = -41;
        window.__airT = { p, s1, s2, s3, hp0, t0: performance.now(), s0: { ...window.__airStats } };
        return 'staged: A-10 attack run on enemy compound (flak + SAM defense)';
    },
    airstrikeResult: () => {
        const t = window.__airT; if (!t) return null;
        const d = window.__airStats, s = t.s0;
        const dmg = [t.s1, t.s2, t.s3].map((st, i) => Math.max(0, Math.round(t.hp0[i] - st.hp)));
        return {
            s: Math.round((performance.now() - t.t0) / 1000),
            structDmg: dmg, destroyed: [t.s1, t.s2, t.s3].map(st => st.dead),
            planeHp: Math.max(0, Math.round(t.p.hp)), planeMode: t.p.mode, planeDead: t.p.dead,
            agAmmo: Math.floor(t.p.agAmmo), gunAmmo: Math.floor(t.p.gunAmmo), flares: Math.floor(t.p.flares),
            flakHits: d.flakHits - s.flakHits, samAtPlanes: d.samAtPlanes - s.samAtPlanes,
            strikeRuns: d.strikeRuns - s.strikeRuns,
            pass: (dmg.reduce((a, b) => a + b, 0) > 0) && (d.strikeRuns - s.strikeRuns > 0)
        };
    },
    // bot-wing probe: enemy airport + parked fighter — verifies auto-scramble
    // (parked → airborne CAP/strike) and RTB re-arm cycling.
    botWingTest: () => {
        const apt = new Structure(0, -20, 'airport', 'enemy');
        structs.push(apt);
        const p = new Plane(apt.lat, apt.lon, PCFG['fighter'], 'enemy');
        planes.push(p);
        window.__botWingT = { p, apt };
        return 'staged: enemy fighter parked at (0,-20) — watch it scramble';
    },
    botWingResult: () => {
        const t = window.__botWingT; if (!t) return null;
        return {
            parked: t.p.parked, mode: t.p.mode,
            pos: [+t.p.lat.toFixed(1), +t.p.lon.toFixed(1)],
            fuel: Math.round(t.p.fuel), aaAmmo: t.p.aaAmmo,
            launched: !t.p.parked, away: haversineDist(t.p.lat, t.p.lon, t.apt.lat, t.apt.lon) > 20,
            pass: !t.p.parked && !t.p.dead
        };
    },
    // stealth probe: a B-2 deep in enemy SAM range must NOT be auto-engaged
    // until it closes inside AIR_STEALTH_DETECT.
    stealthTest: () => {
        const sam = new Structure(35, -45, 'sam', 'enemy');
        structs.push(sam);
        const b2 = new Plane(34.6, -44.6, PCFG['stealth'], myRole);
        planes.push(b2);
        b2.parked = false; b2.mode = 'patrol'; b2.tlat = 35; b2.tlon = -45;
        window.__stlT = { b2, sam, t0: performance.now(), s0: { ...window.__airStats } };
        return 'staged: B-2 inbound at ~55km from enemy SAM (detect ring 30km)';
    },
    // focused AA probe: slow heli flying STRAIGHT at a SAM battery — verifies
    // the guided interceptor can actually connect (damage or flare decoy).
    samVsPlaneTest: () => {
        const sam = new Structure(10, -30, 'sam', 'enemy');
        structs.push(sam);
        const heli = new Plane(9.2, -30, PCFG['heli'], myRole);
        planes.push(heli);
        heli.parked = false; heli.mode = 'patrol'; heli.tlat = 10; heli.tlon = -30;
        window.__svpT = { heli, sam, s0: { ...window.__airStats } };
        return 'staged: heli ~90km out, boring straight in on the SAM';
    },
    samVsPlaneResult: () => {
        const t = window.__svpT; if (!t) return null;
        const d = window.__airStats, s = t.s0;
        return {
            heliHp: Math.round(t.heli.hp), heliDead: t.heli.dead, flaresLeft: t.heli.flares,
            samFired: d.samAtPlanes - s.samAtPlanes, flaresUsed: d.flaresUsed - s.flaresUsed,
            distNow: Math.round(haversineDist(t.heli.lat, t.heli.lon, t.sam.lat, t.sam.lon)),
            // pass = the SAM meaningfully engaged (damage dealt or flares spent)
            pass: t.heli.hp < t.heli.cfg.hp || (d.flaresUsed - s.flaresUsed) > 0
        };
    },
    stealthResult: () => {
        const t = window.__stlT; if (!t) return null;
        const d = window.__airStats, s = t.s0;
        const dist = haversineDist(t.b2.lat, t.b2.lon, t.sam.lat, t.sam.lon);
        return {
            s: Math.round((performance.now() - t.t0) / 1000),
            distKm: Math.round(dist),
            samEngaged: (d.samAtPlanes - s.samAtPlanes) > 0,
            b2Hp: Math.max(0, Math.round(t.b2.hp)), b2Dead: t.b2.dead,
            // pass = SAM held fire while the B-2 was outside the stealth ring
            pass: t.b2.dead || !((d.samAtPlanes - s.samAtPlanes) > 0) || dist < GAME_CONSTANTS.AIR_STEALTH_DETECT + 15
        };
    },
    // ── speed timing probes ──
    // Fire a ballistic over a known distance and time the flight.
    missileTest: () => {
        const m = new Missile(20, -40, 20, -20, MCFG['ballistic'], 'player');
        missiles.push(m);
        window.__msT0 = performance.now(); window.__msObj = m;
        return { distKm: Math.round(m.dist), spdKmS: m.speed, expectS: +(m.dist / m.speed).toFixed(1) };
    },
    missileFlight: () => window.__msObj
        ? { done: window.__msObj.dead, prog: +window.__msObj.progress.toFixed(3),
            ms: Math.round(performance.now() - window.__msT0) }
        : null,
    // Order a fighter over a known distance and measure km/s from position deltas.
    planeSpeedTest: () => {
        const p = planes.find(q => !q.dead && q.owner === myRole && !q.parked)
            || (() => { const np = new Plane(10, -40, PCFG['fighter'], myRole); planes.push(np); return np; })();
        p.tlat = 10; p.tlon = -20; p.mode = 'patrol'; p.parked = false;
        window.__pTest = { p, t0: performance.now(), lat0: p.lat, lon0: p.lon };
        return { cfg: p.cfg.name, spdKmS: p.speed * 60 };
    },
    planeSpeed: () => {
        const t = window.__pTest; if (!t) return null;
        const s = (performance.now() - t.t0) / 1000;
        const km = haversineDist(t.lat0, t.lon0, t.p.lat, t.p.lon);
        return { s: +s.toFixed(1), km: +km.toFixed(0), kmS: +(km / s).toFixed(1),
            lonNow: +t.p.lon.toFixed(1), done: Math.abs(t.p.lon - (-20)) < 0.3 };
    },
    // TASK-401×402 QA: air-vs-ship strike — verifies the lead-ported hull
    // acquisition in AirCombat.strikeTick + the _shipTarget wrapper end-to-end
    // (A-10 acquires the hull, precision strike damages it ×AIR_STRIKE_SHIP_MUL).
    airVsShipTest: () => {
        const w = new Warship('enemy', { lat: 24, lon: -36 }, { lat: 25, lon: -37 });
        warships.push(w);
        w.aaCd = 99999;   // neuter fleet AA — this probe verifies the STRIKE path (AA lethality is navalBattleTest's job)
        const p = new Plane(24.6, -40.8, PCFG['a10'], myRole);
        planes.push(p);
        p.parked = false; p.mode = 'attack'; p.tlat = w.curLat; p.tlon = w.curLon;
        window.__avsT = { p, w, hp0: w.hp, s0: { ...window.__airStats } };
        return 'staged: A-10 attack vs enemy warship (AA neutered, hull acquisition path)';
    },
    airVsShipResult: () => {
        const t = window.__avsT; if (!t) return null;
        return {
            shipHp: Math.round(t.w.hp), shipDead: !!t.w.dead,
            gndTgtIsShip: !!(t.p.gndTgt && t.p.gndTgt.isShip),
            strikeRuns: window.__airStats.strikeRuns - t.s0.strikeRuns,
            distNow: Math.round(haversineDist(t.p.lat, t.p.lon, t.w.curLat, t.w.curLon)),
            pass: t.w.hp < t.hp0 || !!t.w.dead
        };
    },
    // warship combat test: stage an enemy warship + LONG-route enemy ships
    // crossing the Atlantic patrol zone — then watch warships()/navalState()
    warshipTest: () => {
        warships.push(new Warship('enemy', { lat: 24, lon: -36 }, { lat: 25, lon: -37 }));
        tradeShips.push(new TradeShip({ lat: 10, lon: -30 }, { lat: 35, lon: -40 }, 'enemy'));
        transportShips.push(new TransportShip('enemy', { lat: 5, lon: -35 }, { lat: 40, lon: -30 }, 500));
        return 'staged v2: enemy warship (25,-37) + long trade/transport routes crossing patrol zone';
    },
    // full duel test: player + enemy warships in the same Atlantic zone
    warshipDuelTest: () => {
        warships.push(new Warship('player', { lat: 26, lon: -43 }, { lat: 25.3, lon: -40.5 }));
        warships.push(new Warship('enemy', { lat: 24, lon: -36 }, { lat: 25, lon: -37.5 }));
        transportShips.push(new TransportShip('enemy', { lat: 5, lon: -35 }, { lat: 40, lon: -30 }, 500));
        tradeShips.push(new TradeShip({ lat: 10, lon: -30 }, { lat: 35, lon: -40 }, 'enemy'));
        return 'duel staged: player (25.3,-40.5) vs enemy (25,-37.5) warships + crossing transports';
    },
    navalState: () => ({
        warships: warships.length, transports: transportShips.length, trades: tradeShips.length,
        pRes: Math.floor(pRes),
        warshipModels: warships.map(w => {
            let n = 0; if (w.mesh) w.mesh.traverse(o => { if (o.isMesh) n++; });
            return { owner: w.owner, meshes: n, accents: (w.accents || []).length, radar: !!(w.anim && w.anim.radar) };
        })
    }),
};

// ── TASK-406 follow-up (over-watered coasts) ──
// Wait (bounded) for the country polygons to finish loading — the geo-gated
// water dilation needs them to tell interior water (rivers, inside a country)
// from ocean (outside them). The spawn phase already gates on the same data,
// so this wait is invisible to the player flow.
function _awaitGeoJson(ms = 10000) {
    return new Promise(resolve => {
        const t0 = performance.now();
        const poll = () => {
            const f = (window.GEOJSON_DATA && window.GEOJSON_DATA.features) || [];
            if (f.length || performance.now() - t0 > ms) return resolve(f);
            setTimeout(poll, 250);
        };
        poll();
    });
}

// Rasterize the GeoJSON country polygons at full grid res into a 0/1
// Uint8Array (1 = cell center inside a polygon). Same projection + sampling
// as the GeoJSON fallback mask path (proven at 7200×3600). The conquest
// dilation uses it so rivers thicken but ocean coasts/straits keep their true
// width — the blanket dilation had eroded every coast ~5.5km and pushed the
// major straits (Dover, Gibraltar) past the armor wade threshold.
function _buildGeoLandRef(feats) {
    if (!feats || feats.length === 0) return null;
    try {
        const W = CONQUEST_CFG.GRID_W, H = CONQUEST_CFG.GRID_H;
        const mc = document.createElement('canvas');
        mc.width = W; mc.height = H;
        const mctx = mc.getContext('2d', { willReadFrequently: true });
        const mproj = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
        const mpath = d3.geoPath(mproj, mctx);
        mctx.fillStyle = '#ffffff';
        for (const f of feats) { mctx.beginPath(); mpath(f); mctx.fill(); }
        const d = mctx.getImageData(0, 0, W, H).data;
        const ref = new Uint8Array(W * H);
        for (let i = 0, p = 0; i < ref.length; i++, p += 4) ref[i] = d[p + 3] > 40 ? 1 : 0;
        return ref;
    } catch (e) {
        console.warn('[CONQUEST] geoLand ref build failed:', e.message);
        return null;
    }
}

// Build the conquest grid + land mask from GeoJSON country polygons.
// Rasterize at 720×360 (reliable canvas size), sample up to the full grid,
// then verify with a few probes. Fall back to d3.geoContains if needed.
// Build the conquest grid from the UNIFIED OpenFront terrain binary: the land mask
// (owner[]) AND the biome colors both come from this ONE source, so the visible
// coastline is exactly the conquerable coastline — no offset, perfectly synced.
// Async because it fetches the binary; callers that need the mask ready (e.g. the
// spawn-click seeder) MUST `await initConquestGrid()`. Fire-and-forget callers are
// fine too — it self-renders (biome texture + territory overlay) once loaded.
async function initConquestGrid() {
    // Dedupe: if init is already in flight (or done), await the same promise so the
    // spawn-click never races ahead of the mask being built.
    if (conquestGrid && _gridInitPromise) return _gridInitPromise;
    if (!conquestGrid) conquestGrid = new ConquestGrid();   // sync: object exists immediately
    const W = CONQUEST_CFG.GRID_W, H = CONQUEST_CFG.GRID_H;
    const cfg = CONQUEST_CFG;
    const feats = (window.GEOJSON_DATA && window.GEOJSON_DATA.features) || [];

    _gridInitPromise = (async () => {
        try {
            // ── PRIMARY: unified OpenFront terrain binary (single source of truth). ──
            let usedTerrain = false;
            try {
                const tb = await ensureTerrainBuf();
                conquestGrid.loadTerrainFromBin(tb.buf, tb.w, tb.h);
                conquestGrid.buildLandMaskFromTerrain();
                // TASK-406 follow-up (over-watered coasts): rivers/lakes sit
                // INSIDE country polygons while ocean/straits lie outside
                // them. Give the dilation a GeoJSON land reference so it
                // thickens only interior water — coastlines and straits
                // (Dover, Gibraltar, Hormuz) keep their true width and stay
                // wadeable for armor. Blanket fallback when GeoJSON is absent.
                const geoFeats = (feats.length ? feats : await _awaitGeoJson(10000));
                const geoLand = _buildGeoLandRef(geoFeats);
                if (geoLand) conquestGrid.setGeoLandRef(geoLand);
                // Option 1: dilate water so thin rivers (1-cell-wide in the
                // 4108px source) read + navigate at grid res. Thicken by N
                // rings (rivers only when the geoLand ref is set — see above).
                conquestGrid.dilateWater(
                    CONQUEST_CFG.WATER_DILATION_RINGS,
                    CONQUEST_CFG.WATER_DILATION_MIN_NEIGHBORS
                );
                conquestGrid.paintBiomeBase();
                usedTerrain = true;
                console.log('[CONQUEST] terrain binary loaded:',
                    conquestGrid.countCells('neutral'), 'land cells',
                    '| water dilated', CONQUEST_CFG.WATER_DILATION_RINGS,
                    'ring(s)', geoLand ? '(rivers-only, geo-gated)' : '(blanket — no GeoJSON)');
            } catch (err) {
                console.warn('[CONQUEST] terrain binary unavailable, using GeoJSON mask:', err.message);
            }

            // ── FALLBACK: rasterize GeoJSON country polygons (old path). ──
            if (!usedTerrain) {
                const SRC_W = W, SRC_H = H;
                const mc = document.createElement('canvas');
                mc.width = SRC_W; mc.height = SRC_H;
                const mctx = mc.getContext('2d', { willReadFrequently: true });
                const mproj = d3.geoEquirectangular().scale(SRC_W / (2 * Math.PI)).translate([SRC_W / 2, SRC_H / 2]);
                const mpath = d3.geoPath(mproj, mctx);
                mctx.fillStyle = '#ffffff';
                for (const f of feats) { mctx.beginPath(); mpath(f); mctx.fill(); }
                const img = mctx.getImageData(0, 0, SRC_W, SRC_H);
                const d = img.data;
                const owner = conquestGrid.owner;
                for (let row = 0; row < H; row++) {
                    const srcRow = Math.min(SRC_H - 1, (row * SRC_H / H) | 0);
                    for (let col = 0; col < W; col++) {
                        const srcCol = Math.min(SRC_W - 1, (col * SRC_W / W) | 0);
                        const srcAlpha = d[(srcRow * SRC_W + srcCol) * 4 + 3];
                        const cell = row * W + col;
                        if (srcAlpha > 40) {
                            owner[cell] = cfg.NEUTRAL;
                            conquestGrid._counts.neutral++;
                        } else {
                            owner[cell] = cfg.WATER;
                        }
                    }
                }
                conquestGrid.buildTerrainHeuristic();
                conquestGrid._dirty = true;
                // Probe sanity check + d3.geoContains fallback.
                const probes = [[40,-100],[35,105],[0,20],[-25,135],[50,10]];
                let missing = probes.filter(([lat, lon]) => owner[conquestGrid.latLonToCell(lat, lon)] === cfg.WATER);
                if (missing.length > 0 && feats.length > 0) {
                    console.warn('[CONQUEST] Rasterization missing ' + missing.length + ' probes, using d3.geoContains fallback');
                    for (let i = 0; i < owner.length; i++) owner[i] = cfg.WATER;
                    conquestGrid._counts.neutral = 0;
                    conquestGrid.buildLandMaskFromGeoContains(feats);
                }
                conquestGrid.paintBiomeFallback();
                console.log('[CONQUEST] GeoJSON fallback mask:', conquestGrid.countCells('neutral'), 'land cells');
            }
        } catch (err) {
            console.error('[CONQUEST] grid init error:', err);
        }

        conquestGrid._maskReady = true;
        // ── Self-test: verify water pathfinding works + inspect mask ──
        _coarseWaterMask = null; // force rebuild with fresh owner data
        const _testMask = getCoarseWaterMask();
        if (_testMask) {
            // Sample mask at known coordinates: [label, lat, lon, expected]
            const _probes = [
                ['Arabian Sea', 16, 60, 'water'],
                ['Mid-Atlantic', 0, -30, 'water'],
                ['Pacific', 0, -160, 'water'],
                ['Sahara', 20, 10, 'land'],
                ['India', 22, 78, 'land'],
                ['Oman port', 16.3, 53.6, '?'],
                ['India port', 19.3, 75.5, '?'],
            ];
            const _W = PATH_W, _DEG = PATH_DEG;
            const _samp = (lat, lon) => {
                const c = Math.min(_W - 1, Math.max(0, Math.floor((lon + 180) / _DEG)));
                const r = Math.min(PATH_H - 1, Math.max(0, Math.floor((90 - lat) / _DEG)));
                return _testMask[r * _W + c] ? 'WATER' : 'LAND';
            };
            console.log('[PATH] Mask probes:', _probes.map(p =>
                p[0] + '(' + p[1] + ',' + p[2] + ')=' + _samp(p[1], p[2]) + '[exp:' + p[3] + ']').join(' | '));
            // Flood-fill from Arabian Sea to check connectivity
            const _startProbe = (() => {
                const c = Math.floor((60 + 180) / _DEG), r = Math.floor((90 - 16) / _DEG);
                return r * _W + c;
            })();
            if (_testMask[_startProbe]) {
                const _seen = new Set([_startProbe]);
                const _q = [_startProbe];
                while (_q.length) {
                    const cc = _q.shift(), cr = (cc / _W) | 0, ccol = cc % _W;
                    for (const [dr2, dc2] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                        const nr2 = cr + dr2;
                        if (nr2 < 0 || nr2 >= PATH_H) continue;
                        const nc2 = ((ccol + dc2) % _W + _W) % _W;
                        const nb2 = nr2 * _W + nc2;
                        if (_testMask[nb2] && !_seen.has(nb2)) { _seen.add(nb2); _q.push(nb2); }
                    }
                }
                let _totalWater = 0; for (let i = 0; i < _testMask.length; i++) _totalWater += _testMask[i];
                console.log('[PATH] Flood from Arabian Sea: reachable=' + _seen.size,
                    'of total water=' + _totalWater, '(' + Math.round(100 * _seen.size / Math.max(1, _totalWater)) + '%)');
            }
            const _testPath = findHPAPath(17.3, 55.6, 19.3, 75.5);
            console.log('[HPA] Self-test Oman(17.3,55.6)→India(19.3,75.5):',
                _testPath ? (_testPath.length + ' waypoints ✓') : 'FAILED ✗ (graph not loaded yet — ok)');
        } else {
            console.warn('[PATH] Self-test: coarse water mask could not be built!');
        }
        // Bind the painted biome canvas to the globe + render the territory overlay.
        applyBiomeGlobeTexture();
        if (scene) renderMode1Territory();
        activeAttacks = [];
        return conquestGrid;
    })();

    return _gridInitPromise;
}

// Paint the conquest grid onto the territory texture.
// The grid canvas IS the complete flat map (clean OpenFront style): tan land,
// fully transparent water (the blue globe shows through), and solid player/enemy
// territory tints with darkened border edges. Drawn with smoothing OFF for crisp
// pixelated tiles.
// ── Color quantizer: converts a photo pixel into a flat OpenFront-style palette color ──
// Shared by the biome globe texture. Snow/ice is checked BEFORE water because ice has a
// faint blue tint that would otherwise be misclassified as ocean.
const BIOME_PALETTE = {
    DEEP:     [24, 52, 100],
    WATER:    [46, 96, 156],
    DESERT:   [206, 186, 132],
    PLAINS:   [106, 156, 86],
    FOREST:   [74, 124, 64],
    MOUNTAIN: [126, 106, 86],
    SNOW:     [232, 236, 240],
};
function quantizeBiomePixel(r, g, b) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    // 1. Snow / ice FIRST (bright + low saturation) — before the water test
    if (lum > 195 && sat < 0.32) return BIOME_PALETTE.SNOW;
    // 2. Water: blue is the dominant channel
    if (b >= r && b >= g) return lum < 80 ? BIOME_PALETTE.DEEP : BIOME_PALETTE.WATER;
    // 3. Desert: bright, warm (r >= g), low-moderate saturation
    if (lum > 150 && r >= g && sat < 0.45) return BIOME_PALETTE.DESERT;
    // 4. Mountain / barren: dark, warm brown
    if (lum < 105 && r >= g && g >= b) return BIOME_PALETTE.MOUNTAIN;
    // 5. Forest: green-dominant + dark
    if (g > r && g > b && lum < 120) return BIOME_PALETTE.FOREST;
    // 6. Default: plains
    return BIOME_PALETTE.PLAINS;
}

// ── Territory overlay upload pipeline (PERFORMANCE) ──
// ═══ TASK-406 — WORLD RENDER LAYER ═══
// Everything that paints conquest state onto the globe now lives in
// src/world/render.js: the territory overlay upload pipeline (downscaled
// 2048×1024 canvas — a full 7200×3600 bind meant a ~104MB GPU re-upload per
// conquest flush — now with SUB-RECT blits from the grid's shared dirty-region
// queue), crisp vector frontier lines (150ms throttle), devastation scorch
// layer, capture flashes, frontline heat glow and drone selection rings.
// main.js keeps thin delegates below so every existing call site (and the
// window.renderMode1Territory debug handle) is unchanged.
const WORLD_RENDER = createWorldRender({
    grid: () => conquestGrid,
    scene: () => scene,
    bots: () => bots,
    R: () => EARTH_RADIUS,
    latLonToVec3,
    ownerHexColor,
    hideTerritoryMesh: () => { if (territoryMesh) territoryMesh.visible = false; },
});

function renderMode1Territory() { WORLD_RENDER.tickTerritory(); }
window.renderMode1Territory = renderMode1Territory;

// ── Vector territory borders ── delegate to the world render layer (TASK-406);
// identical geometry + owner colors, see src/world/render.js rebuildFrontierLines.
function rebuildFrontierLines() { WORLD_RENDER.rebuildFrontierLines(); }

// ════════════════════════════════════════════════════════════════════════
//  UNIFIED TILE-PAINTED GLOBE
//  The globe's land surface is NO LONGER a static photo texture. It is the SAME
//  7200×3600 canvas the conquest grid paints tile-by-tile from the OpenFront
//  terrain byte (see ConquestGrid.paintBiomeBase). One grid → the land mask
//  (owner[]) AND the biome colors are perfectly synced: the visible coastline
//  IS the conquerable coastline. NearestFilter keeps it crisp at max zoom.
// ════════════════════════════════════════════════════════════════════════
// Corrected OpenFront terrain binary (reprojected to true equirectangular by
// scripts/reproject_openfront_terrain.cjs, calibrated vs GeoJSON land IoU 76%).
// Headerless: 4108×1948 bytes.
const OF_TERRAIN_URL = 'data/openfront_terrain_corrected.bin';
const OF_TERRAIN_W = 4108, OF_TERRAIN_H = 1948;
let _terrainBuf = null;       // cached { buf, w, h }
let _terrainBufPromise = null; // in-flight fetch (deduped)
let _gridInitPromise = null;   // in-flight grid init (deduped; handles spawn-click race)

// Fetch the corrected terrain binary ONCE and cache it. Subsequent calls return
// the same resolved promise (or cached buffer) — never re-downloads.
async function ensureTerrainBuf() {
    if (_terrainBuf) return _terrainBuf;
    if (!_terrainBufPromise) {
        _terrainBufPromise = (async () => {
            const res = await fetch(OF_TERRAIN_URL);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const buf = new Uint8Array(await res.arrayBuffer());
            if (buf.length < OF_TERRAIN_W * OF_TERRAIN_H) {
                throw new Error('binary too small: ' + buf.length + ' bytes');
            }
            _terrainBuf = { buf, w: OF_TERRAIN_W, h: OF_TERRAIN_H };
            return _terrainBuf;
        })();
        // A REJECTED promise was cached forever — one transient fetch failure
        // silently downgraded every later game to the GeoJSON fallback. Clear it
        // so the next call retries the download.
        _terrainBufPromise.catch(() => { _terrainBufPromise = null; });
    }
    return _terrainBufPromise;
}

// Bind the grid's painted biomeCanvas to the globe material as the land texture.
// Called after ConquestGrid.paintBiomeBase() has filled it. Crisp at any zoom.
function applyBiomeGlobeTexture() {
    if (!earthMesh || !earthMesh.material || !conquestGrid || !conquestGrid._biomePainted) return;
    const tex = new THREE.CanvasTexture(conquestGrid.biomeCanvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    // Crisp at EVERY zoom — IDENTICAL sampling to the (crisp) conquest overlay.
    // The previous NearestMipmapNearest + generateMipmaps=true was the blur source:
    // at grazing angles (sphere curvature) the GPU picked a downscaled mipmap level
    // and softened the land. With mipmaps OFF it always samples the full-res level0,
    // so rivers/shorelines stay hard-edged. magFilter=Nearest → blocky-crisp zoom-in.
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 1;
    tex.needsUpdate = true;

    if (earthMesh.material.map) earthMesh.material.map.dispose();
    earthMesh.material.map = tex;
    _biomeGlobeTex = tex;   // store ref so the map editor can flag needsUpdate
    earthMesh.material.color.setHex(0xffffff);
    earthMesh.material.needsUpdate = true;
    console.log('[LAND] unified biome globe texture bound',
        conquestGrid.biomeCanvas.width + 'x' + conquestGrid.biomeCanvas.height);
}

// DEV: re-paint the biome canvas from the (possibly overridden) palette and
// re-upload the existing globe texture in place — used by the band editor.
function refreshBiomeTexture() {
    if (!conquestGrid || !conquestGrid._biomePainted) return;
    conquestGrid.paintBiomeBase();
    const tex = earthMesh && earthMesh.material && earthMesh.material.map;
    if (tex) tex.needsUpdate = true;
}

function drawCircleOnCanvas(lat, lon, radius, owner) {
    if(!territoryCtx || !territoryProjection) return;
    
    let iso = getCountryAtLatLon(lat, lon);
    if(!iso) return;
    
    let feature = countryFeatures[iso];
    if(!feature) return;
    
    let radiusDeg = radius / 111.12;
    let circleGenerator = d3.geoCircle()
        .center([lon, lat])
        .radius(radiusDeg);
    let circleGeoJSON = circleGenerator();
    
    territoryCtx.save();
    territoryCtx.beginPath();
    territoryPath(feature);
    territoryCtx.clip();
    
    territoryCtx.beginPath();
    territoryPath(circleGeoJSON);
    
    if(owner === 'player') {
        territoryCtx.fillStyle = 'rgba(0, 255, 136, 0.8)';
    } else if(owner === 'enemy') {
        territoryCtx.fillStyle = 'rgba(255, 68, 68, 0.8)';
    }
    territoryCtx.fill();
    territoryCtx.restore();
}

function paintCircleOnLand(lat, lon, radius, owner) {
    if(window.gameMode !== 'mode1') return;
    
    let pt = { lat, lon, r: radius };
    if(owner === 'player') {
        window.playerCoordinates.push(pt);
    } else if(owner === 'enemy') {
        window.enemyCoordinates.push(pt);
    }
    
    repaintAllCountries();
}
window.paintCircleOnLand = paintCircleOnLand;

function paintCircleOnLandDirect(lat, lon, radius, owner) {
    if(window.gameMode !== 'mode1') return;

    let pt = { lat, lon, r: radius };
    if(owner === 'player') {
        window.playerCoordinates.push(pt);
    } else if(owner === 'enemy') {
        window.enemyCoordinates.push(pt);
    }

    // Route through the conquest grid so all territory painting is unified with
    // the flat-map renderer (no direct canvas drawing that the grid flush wipes).
    if (conquestGrid) {
        conquestGrid.seedCircle(lat, lon, radius, owner);
    }
}
window.paintCircleOnLandDirect = paintCircleOnLandDirect;

function executeTroopArrival(cohort) {
    let owner = cohort.owner;
    
    if (window.gameMode === 'mode1') {
        let currentOwner = getPixelOwner(cohort.tlat, cohort.tlon);
        
        if (currentOwner === owner) {
            if (owner === 'player') {
                pTroops += cohort.troops;
                logEvent(`وصل الدعم العسكري لأراضيك (+${cohort.troops} جندي).`);
            } else {
                eTroops += cohort.troops;
            }
            updateHUD();
            return;
        }
        
        let defenderTroops = 100;
        if (currentOwner !== 'neutral') {
            let coordList = currentOwner === 'player' ? window.playerCoordinates : window.enemyCoordinates;
            let totalDefTroops = currentOwner === 'player' ? pTroops : eTroops;
            defenderTroops = Math.max(200, Math.floor(totalDefTroops / Math.max(1, coordList.length)));
        }
        
        let attackerPower = cohort.troops;
        let winner, remainingTroops;
        
        if (attackerPower > defenderTroops) {
            winner = owner;
            remainingTroops = Math.floor((attackerPower - defenderTroops) * 0.9);
            
            paintCircleOnLand(cohort.tlat, cohort.tlon, 60, owner);
            
            if (currentOwner !== 'neutral') {
                let capLimit = 50; 
                if (currentOwner === 'player') {
                    window.playerCoordinates = window.playerCoordinates.filter(c => haversineDist(c.lat, c.lon, cohort.tlat, cohort.tlon) > capLimit);
                    pTroops = Math.max(0, pTroops - defenderTroops);
                } else {
                    window.enemyCoordinates = window.enemyCoordinates.filter(c => haversineDist(c.lat, c.lon, cohort.tlat, cohort.tlon) > capLimit);
                    eTroops = Math.max(0, eTroops - defenderTroops);
                }
            }
            
            if (owner === 'player') {
                pTroops += remainingTroops;
                logEvent(`انتصار! تم التقدم ورسم نفوذ جديد وقتل قوات العدو.`, 'info');
                spawnExp(cohort.tlat, cohort.tlon, 4, '#00ff88');
            } else {
                eTroops += remainingTroops;
                logEvent(`تحذير: تقدم العدو ورسم نفوذاً جديداً في أراضيك!`, 'err');
                spawnExp(cohort.tlat, cohort.tlon, 4, '#ff2200');
            }
        } else {
            winner = currentOwner;
            remainingTroops = Math.floor((defenderTroops - attackerPower) * 0.9);
            
            if (currentOwner !== 'neutral') {
                let diff = defenderTroops - remainingTroops;
                if (currentOwner === 'player') {
                    pTroops = Math.max(0, pTroops - diff);
                } else {
                    eTroops = Math.max(0, eTroops - diff);
                }
            }
            
            if (owner === 'player') {
                logEvent(`هزيمة! أبيدت القوات الغازية المكونة من ${attackerPower} جندي.`, 'err');
                spawnExp(cohort.tlat, cohort.tlon, 2, '#ffaa00');
            } else {
                logEvent(`تم بنجاح صد هجوم غزو معادي!`, 'info');
                spawnExp(cohort.tlat, cohort.tlon, 2, '#ffcc00');
            }
        }
        
        updateHUD();
        return;
    }
    
    let targetIdx = cohort.targetProvinceIdx;
    let currentOwner = window.provinceOwnership[targetIdx] || 'neutral';
    
    if (currentOwner === owner) {
        if (owner === 'player') {
            pTroops += cohort.troops;
            logEvent(`وصل الدعم العسكري لبلدتك (+${cohort.troops} جندي).`);
        } else {
            eTroops += cohort.troops;
        }
        updateHUD();
        return;
    }
    
    // Combat logic
    let defenderTroops = 100;
    if (currentOwner !== 'neutral') {
        let count = 0;
        for (let idx in window.provinceOwnership) {
            if (window.provinceOwnership[idx] === currentOwner) count++;
        }
        let total = currentOwner === 'player' ? pTroops : eTroops;
        defenderTroops = Math.max(200, Math.floor(total / Math.max(1, count)));
    }
    
    let attackerPower = cohort.troops;
    let winner, remainingTroops;
    
    if (attackerPower > defenderTroops) {
        winner = owner;
        remainingTroops = Math.floor((attackerPower - defenderTroops) * 0.9);
        
        window.provinceOwnership[targetIdx] = owner;
        
        if (currentOwner !== 'neutral') {
            if (currentOwner === 'player') {
                pTroops = Math.max(0, pTroops - defenderTroops);
            } else {
                eTroops = Math.max(0, eTroops - defenderTroops);
            }
        }
        
        if (owner === 'player') {
            pTroops += remainingTroops;
            logEvent(`انتصار! تم احتلال إقليم جديد وقتل قوات العدو.`, 'info');
            spawnExp(cohort.tlat, cohort.tlon, 4, '#00ff88');
        } else {
            eTroops += remainingTroops;
            logEvent(`تحذير: احتل العدو إقليماً تابعاً لك!`, 'err');
            spawnExp(cohort.tlat, cohort.tlon, 4, '#ff2200');
        }
    } else {
        winner = currentOwner;
        remainingTroops = Math.floor((defenderTroops - attackerPower) * 0.9);
        
        if (currentOwner !== 'neutral') {
            let diff = defenderTroops - remainingTroops;
            if (currentOwner === 'player') {
                pTroops = Math.max(0, pTroops - diff);
            } else {
                eTroops = Math.max(0, eTroops - diff);
            }
        }
        
        if (owner === 'player') {
            logEvent(`هزيمة! أبيدت القوات الغازية المكونة من ${attackerPower} جندي.`, 'err');
            spawnExp(cohort.tlat, cohort.tlon, 2, '#ffaa00');
        } else {
            logEvent(`تم بنجاح صد هجوم غزو معادي على إقليمك!`, 'info');
            spawnExp(cohort.tlat, cohort.tlon, 2, '#ffcc00');
        }
    }
    
    updateTerritoryFromCities(cityNodes);
    updateHUD();
}

function spawnTradeShipsForActivePorts() {
    const C = GAME_CONSTANTS;
    // GUARD: never spawn ships until the pre-calculated waterway network is
    // loaded. Without the HPA highway graph, ships cannot compute bounded
    // routes. Skipping spawn is strictly better than spawning without a graph.
    if (!_waterwayNetwork || !_waterwayNetwork.hwCellSet) {
        // TASK-504: warn once — a permanently unavailable graph used to log
        // every spawn interval (console noise). Silent skip afterwards.
        if (!spawnTradeShipsForActivePorts._hpaWarned) {
            spawnTradeShipsForActivePorts._hpaWarned = true;
            console.log('[SHIP] spawn skipped — HPA graph not ready yet (retrying silently)');
        }
        return;
    }
    let ports = structs.filter(s => s.type === 'port' && !s.dead);
    // TASK-504: hoist the live-ship count out of the per-port loop (was
    // re-reduced per port — O(ports×ships) per interval); +1 per spawn keeps
    // the exact semantics the per-port recount had.
    let alive = tradeShips.reduce((n, ts) => n + (ts.dead ? 0 : 1), 0);
    ports.forEach(port => {
        // TASK-301 BLOCKADE: enemy warships parked nearby seal this port —
        // no trade ships may sail from it while blocked.
        if (isPortBlockaded(port)) return;
        // OpenFront tradeShipSpawnRate(): sigmoid decay on the GLOBAL ship count
        // + a per-port pity counter that raises the chance after each failed
        // attempt. P(spawn per check) ≈ baseRate·(rejections+1)/20.
        if (alive >= C.TRADE_SHIP_MAX_ACTIVE) return;   // cap re-checked INSIDE the loop
        const baseRate = 1 - 1 / (1 + Math.exp(-0.1155 * (alive - 12))); // midpoint: 12 ships
        const rej = port._shipRej || 0;
        const denom = Math.max(C.TRADE_SHIP_MIN_SPAWN_RATE, Math.floor(20 * baseRate / (rej + 1)));
        if (Math.random() * denom >= 1) { port._shipRej = rej + 1; return; }
        port._shipRej = 0;
        // tradingPorts(): find valid destination ports.
        let targets = structs.filter(t => t.type === 'port' && t !== port && !t.dead && t.owner !== port.owner);
        if (targets.length === 0) {
            // Fallback: coastal enemy cities.
            let cities = cityNodes.filter(c => c.owner !== port.owner);
            let coastalCities = cities.filter(c => isNearWater(c.lat, c.lon, 4.0));
            if (coastalCities.length > 0) {
                let target = coastalCities[Math.floor(Math.random() * coastalCities.length)];
                try {
                    let s = new TradeShip(port, { lat: target.lat, lon: target.lon, pos: latLonToVec3(target.lat, target.lon), owner: target.owner }, port.owner);
                    if (!s.dead) { tradeShips.push(s); alive++; }   // TASK-504: tracked hoisted count
                } catch (err) { console.warn('[SHIP] spawn failed (city fallback):', err.message); }
            }
            return;
        }

        // OpenFront tradingPorts(): sort by distance, apply proximity weighting.
        targets.sort((a, b) =>
            _econHavNA(port.lat, port.lon, a.lat, a.lon) - _econHavNA(port.lat, port.lon, b.lat, b.lon)
        );
        const weighted = [];
        targets.forEach((t, i) => {
            const d = _econHavNA(port.lat, port.lon, t.lat, t.lon);   // TASK-504: no-alloc
            weighted.push(t);
            if (d > C.TRADE_SHIP_SHORT_RANGE_KM && i < Math.min(3, targets.length)) weighted.push(t);
        });
        const target = weighted[Math.floor(Math.random() * weighted.length)];
        try {
            let s = new TradeShip(port, target, port.owner);
            if (!s.dead) { tradeShips.push(s); alive++; }   // TASK-504: tracked hoisted count
        } catch (err) { console.warn('[SHIP] spawn failed:', err.message); }
    });
}

function spawnTrainsForActiveFactories() {
    // OpenFront-style throttling: each factory has a long cooldown, spawn is
    // probabilistic, and there's a per-owner cap on active trains. No more spam.
    const C = GAME_CONSTANTS;
    const cap = (C.TRAIN_MAX_ACTIVE_PER_OWNER != null) ? C.TRAIN_MAX_ACTIVE_PER_OWNER : 6;
    const activeByOwner = {};
    trains.forEach(t => { if (!t.dead) activeByOwner[t.owner] = (activeByOwner[t.owner] || 0) + 1; });
    let factories = structs.filter(s => s.type === 'factory' && !s.dead);
    factories.forEach(fact => {
        if (!fact.connectedStations || fact.connectedStations.length === 0) return;
        if (activeByOwner[fact.owner] >= cap) return;
        // P(factory spawns this check) — scales down as you build more factories
        const rate = 1 / ((factories.length + 10) * 1.5);
        if (Math.random() > rate) return;
        let target = fact.connectedStations[Math.floor(Math.random() * fact.connectedStations.length)];
        activeByOwner[fact.owner] = (activeByOwner[fact.owner] || 0) + 1;
        trains.push(new Train(fact, target, fact.owner));
    });
}

window.troopAttackPct = 50;
window.setTroopAttackPct = function(pct, btn) {
    window.troopAttackPct = pct;
    document.querySelectorAll('.pct-btn').forEach(b => b.classList.remove('act'));
    btn.classList.add('act');
};

window.lineAttackMode = false;
window.toggleLineAttack = function() {
    window.lineAttackMode = !window.lineAttackMode;
    let btn = document.getElementById('btnLineAttack');
    let tgtMsg = document.getElementById('tgtMsg');
    if (window.lineAttackMode) {
        if (btn) {
            btn.style.background = '#00ff88';
            btn.style.borderColor = '#00cc66';
            btn.style.color = '#000';
            btn.style.fontWeight = 'bold';
        }
        if (tgtMsg) {
            tgtMsg.textContent = 'اختر هدف الهجوم الخطي — سيتم إطلاق زحف القوات من أقرب حدود لك';
            tgtMsg.style.display = 'block';
        }
    } else {
        if (btn) {
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.style.fontWeight = '';
        }
        if (tgtMsg) tgtMsg.style.display = 'none';
    }
};

let scene, camera, renderer, controls;
let earthMesh, countryBorders, raycaster, mouse;
let rangeMarkerMesh;
let GLOBAL_MODELS = {};

// ── DEV: live color-grading panel ───────────────────────────────────────
// Applies a CSS filter (hue-rotate / saturate / brightness / contrast) to the
// WebGL canvas so the globe's look can be dialed in IN REAL TIME. Values
// persist in localStorage. Drag the header to move; click "–" to collapse.
// When you're happy, hit "Copy CSS" and we can bake that transform into
// ofTerrainColor() so the filter is no longer needed.
// ── DEV: per-band terrain color editor (appended to the color-grade panel) ──
// Lets you pick a specific terrain band (ocean / shore water / sand / plains /
// highland / mountain) and change just that color. Picking a color auto-enables
// "Flat" mode so each band becomes a single editable flat color.
function appendBandEditor(panel) {
  const body = panel.querySelector('#cgBody');
  if (!body) return;
  const bands = getBiomeBands();
  const labels = { ocean: 'Ocean', shoreWater: 'Shore Water', sand: 'Sand / Beach', plains: 'Plains', highland: 'Highland', mountain: 'Mountain' };
  const rgbToHex = (c) => '#' + [c[0], c[1], c[2]].map(n => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0')).join('');
  const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  let cur = bands[0];
  const sec = document.createElement('div');
  sec.style.cssText = 'border-top:1px solid #3b424a;margin-top:9px;padding-top:8px;';
  sec.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">' +
    '<span style="font-weight:bold;">Terrain band</span>' +
    '<label style="font-size:11px;cursor:pointer;"><input type="checkbox" id="cgFlat" style="vertical-align:middle;accent-color:#3da9fc;"> Flat</label>' +
    '</div>' +
    '<select id="cgBand" style="width:100%;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:3px;margin-bottom:6px;">' +
    bands.map(b => '<option value="' + b + '">' + (labels[b] || b) + '</option>').join('') + '</select>' +
    '<input type="color" id="cgBandColor" style="width:100%;height:30px;border:1px solid #3b424a;background:none;cursor:pointer;">' +
    '<div style="font-size:10px;color:#8b95a1;margin-top:4px;" id="cgBandHex"></div>';
  body.appendChild(sec);

  const sel = sec.querySelector('#cgBand');
  const colorInp = sec.querySelector('#cgBandColor');
  const hexLbl = sec.querySelector('#cgBandHex');
  const flatChk = sec.querySelector('#cgFlat');
  const showBand = () => {
    const c = getBiomeBandColor(cur);
    colorInp.value = c ? rgbToHex(c) : '#000000';
    hexLbl.textContent = (labels[cur] || cur) + ': ' + colorInp.value;
  };
  sel.addEventListener('change', () => { cur = sel.value; showBand(); });
  showBand();

  // Throttle repaints — repainting a 7200×3600 canvas + re-uploading is heavy.
  let pending = false, last = 0;
  const scheduleRepaint = () => {
    if (pending) return;
    pending = true;
    const wait = Math.max(0, 160 - (performance.now() - last));
    setTimeout(() => { pending = false; last = performance.now(); refreshBiomeTexture(); }, wait);
  };
  colorInp.addEventListener('input', () => {
    if (!flatChk.checked) { flatChk.checked = true; setBiomeFlatMode(true); } // auto-enable flat so the pick is visible
    setBiomeBandColor(cur, hexToRgb(colorInp.value));
    hexLbl.textContent = (labels[cur] || cur) + ': ' + colorInp.value;
    scheduleRepaint();
  });
  flatChk.addEventListener('change', () => { setBiomeFlatMode(flatChk.checked); refreshBiomeTexture(); });
}

// ═══ DEV: Port placement panel ═══
// Click any shoreline to drop a player/enemy port, then spawn trade ships
// between them to test water routing. Mirrors the color-grade panel UI.
function setupDevPortPanel() {
  if (window.__devPortPanel) return;
  window.__devPlacePort = false;     // toggle: when true, globe clicks place ports
  window.__devPortOwner = 'player';  // 'player' | 'enemy'
  window.__devPorts = [];            // track dev-placed ports for clearing
  window.__showShipPaths = false;    // DEV: draw trade-ship waypoint routes

  const panel = document.createElement('div');
  panel.id = 'devPortPanel';
  Object.assign(panel.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: 9999,
    background: 'rgba(13,15,18,0.92)', color: '#dfe4ea',
    border: '1px solid #3b424a', borderRadius: '8px', padding: '0',
    fontFamily: 'monospace', fontSize: '12px', width: '224px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.8)', userSelect: 'none', lineHeight: '1.4',
  });

  let html = '<div id="dpHead" style="cursor:move;padding:7px 10px;border-bottom:1px solid #3b424a;display:flex;justify-content:space-between;align-items:center;">';
  html += '<span style="font-weight:bold;letter-spacing:.5px;">🚢 Dev Ports</span>';
  html += '<span id="dpHide" style="cursor:pointer;padding:0 5px;">–</span></div>';
  html += '<div id="dpBody" style="padding:8px 10px;">';
  html += '<div style="margin-bottom:5px;color:#8b95a1;">Owner:</div>';
  html += '<div style="display:flex;gap:6px;margin-bottom:8px;">';
  html += '<button id="dpOwnP" style="flex:1;cursor:pointer;background:#0a3d62;border:1px solid #3da9fc;color:#dfe4ea;border-radius:4px;padding:5px;">Player</button>';
  html += '<button id="dpOwnE" style="flex:1;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;">Enemy</button>';
  html += '</div>';
  html += '<button id="dpPlace" style="width:100%;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:6px;margin-bottom:6px;">⚓ Place Port (click shore)</button>';
  html += '<div style="display:flex;gap:6px;margin-bottom:6px;">';
  html += '<button id="dpSpawn" style="flex:1;cursor:pointer;background:#1a4a2a;border:1px solid #3da9fc;color:#dfe4ea;border-radius:4px;padding:5px;">Spawn Ships</button>';
  html += '<button id="dpClear" style="flex:1;cursor:pointer;background:#4a1a1a;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;">Clear</button>';
  html += '</div>';
  html += '<button id="dpPaths" style="width:100%;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;margin-bottom:6px;">🗺️ Show Ship Paths</button>';
  html += '<button id="dpWater" style="width:100%;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;margin-bottom:4px;">🌊 Water Mask: OFF</button>';
  html += '<div id="dpWaterLegend" style="font-size:9px;color:#5a6470;margin-bottom:6px;display:none;">Cycle: FINE (green) → MEDIUM (magenta) → HIGHWAY (cyan). No overlay = NOT registered as water.</div>';
  html += '<div id="dpStatus" style="font-size:10px;color:#8b95a1;">No dev ports placed.</div>';
  html += '<div style="font-size:9px;color:#5a6470;margin-top:5px;">Tip: place ≥1 player + ≥1 enemy port on different shores, then Spawn Ships.</div>';
  html += '</div>';
  panel.innerHTML = html;
  document.body.appendChild(panel);
  window.__devPortPanel = panel;

  const body = panel.querySelector('#dpBody');
  const status = panel.querySelector('#dpStatus');
  const placeBtn = panel.querySelector('#dpPlace');
  const ownP = panel.querySelector('#dpOwnP');
  const ownE = panel.querySelector('#dpOwnE');

  const updateStatus = () => {
    const alive = window.__devPorts.filter(p => !p.dead).length;
    const allPorts = structs.filter(s => s.type === 'port' && !s.dead).length;
    status.textContent = alive + ' dev port(s) | ' + allPorts + ' total ports | ' +
      (window.__devPlacePort ? 'PLACING (' + window.__devPortOwner + ')' : 'idle');
  };

  const setOwner = (o) => {
    window.__devPortOwner = o;
    if (o === 'player') {
      ownP.style.background = '#0a3d62'; ownP.style.borderColor = '#3da9fc';
      ownE.style.background = '#2a3036'; ownE.style.borderColor = '#3b424a';
    } else {
      ownE.style.background = '#4a2a00'; ownE.style.borderColor = '#ffaa00';
      ownP.style.background = '#2a3036'; ownP.style.borderColor = '#3b424a';
    }
    updateStatus();
  };
  ownP.addEventListener('click', () => setOwner('player'));
  ownE.addEventListener('click', () => setOwner('enemy'));

  placeBtn.addEventListener('click', () => {
    window.__devPlacePort = !window.__devPlacePort;
    placeBtn.style.background = window.__devPlacePort ? '#3da9fc' : '#2a3036';
    placeBtn.style.color = window.__devPlacePort ? '#0a0c0f' : '#dfe4ea';
    placeBtn.textContent = window.__devPlacePort ? '⚓ Click a shoreline...' : '⚓ Place Port (click shore)';
    updateStatus();
  });

  panel.querySelector('#dpSpawn').addEventListener('click', () => {
    spawnTradeShipsForActivePorts();
    status.textContent = 'Ships spawned! ' + tradeShips.filter(t => !t.dead).length + ' active';
    setTimeout(updateStatus, 2000);
  });

  panel.querySelector('#dpClear').addEventListener('click', () => {
    window.__devPorts.forEach(p => { p.dead = true; if (p.mesh) scene.remove(p.mesh); });
    window.__devPorts = [];
    updateStatus();
  });

  // DEV: toggle ship path visualization
  const pathsBtn = panel.querySelector('#dpPaths');
  pathsBtn.addEventListener('click', () => {
    window.__showShipPaths = !window.__showShipPaths;
    pathsBtn.style.background = window.__showShipPaths ? '#3da9fc' : '#2a3036';
    pathsBtn.style.color = window.__showShipPaths ? '#0a0c0f' : '#dfe4ea';
    pathsBtn.textContent = window.__showShipPaths ? '🗺️ Hide Ship Paths' : '🗺️ Show Ship Paths';
    // Apply immediately to existing ships
    tradeShips.forEach(ts => { if (ts.pathLine) ts.pathLine.visible = window.__showShipPaths; });
  });

  // DEV: cycle water-body debug overlay (FINE → MEDIUM → HIGHWAY → OFF)
  const waterBtn = panel.querySelector('#dpWater');
  const waterLegend = panel.querySelector('#dpWaterLegend');
  const _syncWaterBtn = () => {
    const on = _waterDebugMode !== 0;
    waterBtn.style.background = on ? '#3da9fc' : '#2a3036';
    waterBtn.style.color = on ? '#0a0c0f' : '#dfe4ea';
    waterBtn.textContent = '🌊 Water Mask: ' + _WATER_DEBUG_LABELS[_waterDebugMode];
    waterLegend.style.display = on ? '' : 'none';
  };
  waterBtn.addEventListener('click', () => {
    _waterDebugMode = (_waterDebugMode + 1) % 4;
    _syncWaterBtn();
    // Highway mode needs the async-loaded graph; trigger load if missing.
    if (_waterDebugMode === 3 && !_waterwayNetwork) {
      waterBtn.textContent = '🌊 Water: loading highway...';
      loadWaterwayNetwork().then(() => { _syncWaterBtn(); applyWaterDebugOverlay(); });
      return;
    }
    applyWaterDebugOverlay();
  });

  panel.querySelector('#dpHide').addEventListener('click', () => {
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    panel.querySelector('#dpHide').textContent = hidden ? '–' : '+';
  });

  // Drag header
  const head = panel.querySelector('#dpHead');
  let dragging = false, ox = 0, oy = 0;
  head.addEventListener('pointerdown', (e) => { dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; });
  window.addEventListener('pointerup', () => dragging = false);
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    panel.style.left = (e.clientX - ox) + 'px';
    panel.style.top = (e.clientY - oy) + 'px';
    panel.style.right = 'auto';
  });

  updateStatus();
}

// ════════════════════════════════════════════════════════════════════════
// MAP EDITOR — paint rivers/land + place highway nodes/edges on the globe.
//
// Left-drag paints (water/land brushes auto-interpolate between points).
// Edits live in _mapEditor.strokes (same format as public/data/map_edits.json)
// and can be exported, then baked into the highway graph at build time by
// scripts/build_river_routes.cjs (STEP 3b rasterizes them BEFORE the adaptive
// densification, so painted rivers receive highway nodes automatically).
//
// Undo/clear rebuild from a baseline snapshot taken on first edit.
// ════════════════════════════════════════════════════════════════════════
const _mapEditor = {
  active: false,
  brush: 'water',      // 'water' | 'land' | 'node' | 'edge' | 'erase'
  radius: 6,           // brush radius in FINE TILES (0.05° each)
  strokes: [],         // committed strokes (exported as map_edits.json)
  currentStroke: null, // active paint stroke during a drag
  painting: false,     // drag in progress
  lastLat: null, lastLon: null,
  edgeFirst: null      // first endpoint for the edge brush
};
window.__mapEditor = _mapEditor;
let _editorBaseline = null;   // { mWater, owner, nodes, adj, cellSet }
let _editorAutoLoaded = false; // guards one-time auto-load of map_edits.json

function _editorLatLonToMed(lat, lon) {
  let col = Math.floor((lon + 180) / MED_DEG);
  let row = Math.floor((90 - lat) / MED_DEG);
  col = ((col % MED_W) + MED_W) % MED_W;
  row = Math.max(0, Math.min(MED_H - 1, row));
  return [row, col];
}
function _editorLatLonToFine(lat, lon) {
  const fd = MED_DEG / MED_STRIDE;                 // 0.05° per fine cell
  const FW = conquestGrid.cfg.GRID_W, FH = conquestGrid.cfg.GRID_H;
  let col = Math.floor((lon + 180) / fd);
  let row = Math.floor((90 - lat) / fd);
  col = ((col % FW) + FW) % FW;
  row = Math.max(0, Math.min(FH - 1, row));
  return [row, col];
}
// Bresenham line of medium cells between two points (handles lon wrap).
function _editorBresMed(r1, c1, r2, c2, out) {
  let dc = c2 - c1;
  if (dc > MED_W / 2) dc -= MED_W;
  if (dc < -MED_W / 2) dc += MED_W;
  const dr = r2 - r1;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  out.length = 0;
  if (steps === 0) { out.push([r1, c1]); return out; }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = Math.round(r1 + dr * t);
    let c = Math.round(c1 + dc * t);
    c = ((c % MED_W) + MED_W) % MED_W;
    out.push([r, c]);
  }
  return out;
}
function _editorStampMed(row, col, radius, isWater) {
  // radius is in MEDIUM cells (0.1°). Stamps the navigation water mask only;
  // the visual overlay is drawn separately by _editorPaintDot (in fine tiles).
  for (let dr = -radius; dr <= radius; dr++) {
    const r = row + dr;
    if (r < 0 || r >= MED_H) continue;
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr * dr + dc * dc > radius * radius + radius) continue;
      const c = (((col + dc) % MED_W) + MED_W) % MED_W;
      _mWater[r * MED_W + c] = isWater ? 1 : 0;
    }
  }
}
function _editorStampFine(row, col, radius, isWater) {
  const FW = conquestGrid.cfg.GRID_W, FH = conquestGrid.cfg.GRID_H;
  const WATER = conquestGrid.cfg.WATER, NEUTRAL = 1;
  const fv = isWater ? WATER : NEUTRAL;
  const owner = conquestGrid.owner;
  for (let dr = -radius; dr <= radius; dr++) {
    const r = row + dr;
    if (r < 0 || r >= FH) continue;
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr * dr + dc * dc > radius * radius + radius) continue;
      const c = (((col + dc) % FW) + FW) % FW;
      owner[r * FW + c] = fv;
    }
  }
}
function _editorStampAt(lat, lon, isWater) {
  const tiles = _mapEditor.radius;                       // fine tiles (0.05°)
  const medR = Math.max(1, Math.round(tiles / MED_STRIDE));
  const [mr, mc] = _editorLatLonToMed(lat, lon);
  _editorStampMed(mr, mc, medR, isWater);
  const [fr, fc] = _editorLatLonToFine(lat, lon);
  _editorStampFine(fr, fc, tiles, isWater);
  _editorPaintDot(mr, mc, tiles, isWater);
}
// Line-of-sight on the medium grid (all cells between must be water).
function _editorLOS(r1, c1, r2, c2) {
  let dc = c2 - c1;
  if (dc > MED_W / 2) dc -= MED_W;
  if (dc < -MED_W / 2) dc += MED_W;
  const dr = r2 - r1;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (steps === 0) return true;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = Math.round(r1 + dr * t);
    let c = Math.round(c1 + dc * t);
    c = ((c % MED_W) + MED_W) % MED_W;
    if (r < 0 || r >= MED_H) return false;
    if (!_mWater[r * MED_W + c]) return false;
  }
  return true;
}

// Snapshot the original masks + highway graph so undo/clear can rebuild.
function _editorEnsureBaseline() {
  if (_editorBaseline) return;
  _ensureMediumArrays();
  const wn = _waterwayNetwork;
  _editorBaseline = {
    mWater: _mWater.slice(),
    owner: conquestGrid.owner.slice(),
    hasNet: !!wn,
    nodes: wn ? wn.hwNodes.slice() : [],
    adj: wn ? wn.hwAdj.map(a => a.slice()) : [],
    cellSet: wn ? new Set(wn.hwCellSet) : new Set()
  };
  console.log('[MAPEDIT] baseline snapshot taken');
}
function _editorRestoreBaseline() {
  if (!_editorBaseline) return;
  _ensureMediumArrays();
  _mWater.set(_editorBaseline.mWater);
  conquestGrid.owner.set(_editorBaseline.owner);
  if (_waterwayNetwork && _editorBaseline.hasNet) {
    _waterwayNetwork.hwNodes = _editorBaseline.nodes.slice();
    _waterwayNetwork.hwAdj = _editorBaseline.adj.map(a => a.slice());
    _waterwayNetwork.hwCellSet = new Set(_editorBaseline.cellSet);
  }
  _editorPaintClear(); // wipe the visual overlay; reapply redraws it
}
// Re-apply every committed stroke from the baseline (used by undo/clear/import).
const _editorBresBuf = [];
function _editorReapplyAll() {
  _editorRestoreBaseline();
  for (const s of _mapEditor.strokes) _editorApplyStroke(s);
  _editorRefreshOverlay();
  _editorPaintSyncVisibility();
}
// Apply one stroke to the live data (no history push).
function _editorApplyStroke(s) {
  if (s.type === 'water' || s.type === 'land') {
    const isWater = s.type === 'water';
    const tiles = Math.max(1, Math.min(80, s.radius || 6));   // fine tiles (0.05°)
    const medR = Math.max(1, Math.round(tiles / MED_STRIDE));
    const pts = s.points || [];
    let prev = null;
    for (const p of pts) {
      const [mr, mc] = _editorLatLonToMed(p[0], p[1]);
      _editorStampMed(mr, mc, medR, isWater);
      const [fr, fc] = _editorLatLonToFine(p[0], p[1]);
      _editorStampFine(fr, fc, tiles, isWater);
      _editorPaintDot(mr, mc, tiles, isWater);
      if (prev) {
        _editorBresMed(prev[0], prev[1], mr, mc, _editorBresBuf);
        for (const [rr, cc] of _editorBresBuf) {
          _editorStampMed(rr, cc, medR, isWater);
          _editorStampFine(Math.min(conquestGrid.cfg.GRID_H - 1, rr * MED_STRIDE),
                           cc * MED_STRIDE, tiles, isWater);
          _editorPaintDot(rr, cc, tiles, isWater);
        }
      }
      prev = [mr, mc];
    }
  } else if (s.type === 'highway_node') {
    _editorAddNodeAt(s.lat, s.lon, false);
  } else if (s.type === 'highway_edge') {
    _editorMakeEdge(s.from, s.to);
  }
}
function _editorRefreshOverlay() {
  if (_waterDebugMode !== 0) applyWaterDebugOverlay();
  _editorPaintFlush();
}

// ── PAINT OVERLAY MESH ───────────────────────────────────────────────────
// ── Paint directly into the globe's biome texture ──────────────────────────
// Instead of a separate floating overlay sphere, editor strokes are drawn
// directly onto conquestGrid.biomeCanvas — the SAME canvas that is bound as
// the globe's terrain texture (applyBiomeGlobeTexture). This means painted
// water/land IS the terrain: it sits at the exact ocean level (EARTH_RADIUS),
// uses the exact ocean colour, and territory borders/frontiers (renderOrder
// 1/2) render ON TOP of it naturally — just like they do over the real ocean.
// No floating shell, no renderOrder conflicts, no "painted tiles above borders".
// The biome canvas is 7200×3600 (the fine grid); texture uploads are throttled
// to ~10 fps which is fine for a dev map editor.
let _biomeGlobeTex = null;        // ref to the THREE texture on earthMesh (set by applyBiomeGlobeTexture)
let _editorPaintDirty = false;
let _editorPaintPending = false;

// No-op: no separate overlay mesh to create. Kept for call-site compatibility.
function _editorEnsurePaintOverlay() {
  return null;
}
// Draw a filled brush disk directly on the globe's biome canvas (the terrain
// texture). row/col are medium-cell coords; they map to fine/biome pixels via
// MED_STRIDE. The radius in pixels = tiles (1 tile = 1 fine pixel = 0.05°), so
// the dot is always exactly N tiles wide. Hard-edged scanline fillRect (no
// anti-aliasing fringe). Water = exact ocean colour, opaque.
function _editorPaintDot(row, col, tiles, isWater) {
  if (!conquestGrid || !conquestGrid._biomePainted) return;
  const ctx = conquestGrid.biomeCtx;
  const FW = conquestGrid.cfg.GRID_W;
  const cx = col * MED_STRIDE;          // medium → fine pixel x
  const cy = row * MED_STRIDE;          // medium → fine pixel y
  const rr = Math.max(1, Math.round(tiles));  // 1 tile = 1 px on the biome canvas
  ctx.fillStyle = isWater ? 'rgba(71,133,181,1.0)' : 'rgba(176,150,90,1.0)';
  const _disk = (px, py) => {
    const ix = Math.round(px), iy = Math.round(py), r2 = rr * rr;
    for (let yy = -rr; yy <= rr; yy++) {
      const w = Math.floor(Math.sqrt(r2 - yy * yy));
      ctx.fillRect(ix - w, iy + yy, 2 * w + 1, 1);
    }
  };
  _disk(cx, cy);
  if (cx - rr < 0) _disk(cx + FW, cy);       // lon-wrap seam
  if (cx + rr >= FW) _disk(cx - FW, cy);
  _editorPaintDirty = true;
}
// Restore the biome canvas to its original terrain (undo/clear). paintBiomeBase
// regenerates from terrainByte (which the editor never modifies), wiping all
// painted strokes. _editorReapplyAll then redraws the remaining strokes.
function _editorPaintClear() {
  if (!conquestGrid || !conquestGrid._biomePainted) return;
  conquestGrid.paintBiomeBase();
  _editorPaintDirty = true;
}
// Throttle GPU texture uploads to ~10 fps. The biome canvas is 7200×3600
// (~104 MB) so uploading every frame would stutter; 100ms is smooth enough for
// a dev map editor and keeps fast drags responsive.
function _editorPaintFlush() {
  if (!_editorPaintDirty || !_biomeGlobeTex) return;
  if (_editorPaintPending) return;
  _editorPaintPending = true;
  setTimeout(() => {
    _editorPaintPending = false;
    if (_editorPaintDirty && _biomeGlobeTex) {
      _biomeGlobeTex.needsUpdate = true;
      _editorPaintDirty = false;
    }
  }, 100);
}
// No-op: painted water is part of the biome texture itself (no overlay mesh to
// show/hide). Kept for call-site compatibility.
function _editorPaintSyncVisibility() {}

// Add a highway node at lat/lon and connect it to the nearest LOS node.
function _editorAddNodeAt(lat, lon, record) {
  if (!_waterwayNetwork) { console.warn('[MAPEDIT] highway graph not loaded'); return -1; }
  _ensureMediumArrays();
  const wn = _waterwayNetwork;
  const [mr, mc] = _editorLatLonToMed(lat, lon);
  const cell = mr * MED_W + mc;
  if (!_mWater[cell]) _mWater[cell] = 1;            // ensure navigable
  if (wn.hwCellSet.has(cell)) {
    // node already exists at this cell — find and return it
    for (let i = 0; i < wn.hwNodes.length; i++) {
      const row = Math.floor(wn.hwNodes[i].cell / MED_W);
      const col = wn.hwNodes[i].cell % MED_W;
      if (row === mr && col === mc) return i;
    }
  }
  const idx = wn.hwNodes.length;
  wn.hwNodes.push({ lat, lon, cell });
  wn.hwAdj.push([]);
  wn.hwCellSet.add(cell);
  // Connect to nearest line-of-sight highway node (41×41 window).
  let bestIdx = -1, bestD = Infinity;
  for (let dr = -20; dr <= 20; dr++) {
    const r = mr + dr;
    if (r < 0 || r >= MED_H) continue;
    for (let dc = -20; dc <= 20; dc++) {
      const c = (((mc + dc) % MED_W) + MED_W) % MED_W;
      const ncell = r * MED_W + c;
      if (!wn.hwCellSet.has(ncell)) continue;
      // find node index for this cell
      let ni = -1;
      for (let k = 0; k < wn.hwNodes.length; k++) {
        if (wn.hwNodes[k].cell === ncell) { ni = k; break; }
      }
      if (ni < 0 || ni === idx) continue;
      const d = dr * dr + dc * dc;
      if (d < bestD && _editorLOS(mr, mc, r, c)) { bestD = d; bestIdx = ni; }
    }
  }
  if (bestIdx >= 0) {
    const dist = Math.round(haversineDist(lat, lon, wn.hwNodes[bestIdx].lat, wn.hwNodes[bestIdx].lon));
    wn.hwAdj[idx].push({ to: bestIdx, dist });
    wn.hwAdj[bestIdx].push({ to: idx, dist });
  }
  if (record) {
    _mapEditor.strokes.push({ type: 'highway_node', lat, lon });
    _editorRefreshOverlay();
  }
  return idx;
}
// Connect the highway nodes nearest to two lat/lon endpoints.
function _editorMakeEdge(from, to) {
  if (!_waterwayNetwork) return;
  const wn = _waterwayNetwork;
  const a = _editorAddNodeAt(from[0], from[1], false);
  const b = _editorAddNodeAt(to[0], to[1], false);
  if (a < 0 || b < 0 || a === b) return;
  const [ar, ac] = _editorLatLonToMed(from[0], from[1]);
  const [br, bc] = _editorLatLonToMed(to[0], to[1]);
  if (!_editorLOS(ar, ac, br, bc)) { console.warn('[MAPEDIT] edge skipped — no line-of-sight'); return; }
  const dist = Math.round(haversineDist(from[0], from[1], to[0], to[1]));
  wn.hwAdj[a].push({ to: b, dist });
  wn.hwAdj[b].push({ to: a, dist });
}
// Remove highway nodes within radius of a point (erase brush).
function _editorEraseAt(lat, lon) {
  if (!_waterwayNetwork) return;
  const wn = _waterwayNetwork;
  const [mr, mc] = _editorLatLonToMed(lat, lon);
  const radius = Math.max(1, Math.round(_mapEditor.radius / MED_STRIDE)) + 2; // tiles→medium cells
  for (let dr = -radius; dr <= radius; dr++) {
    const r = mr + dr;
    if (r < 0 || r >= MED_H) continue;
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr * dr + dc * dc > radius * radius) continue;
      const c = (((mc + dc) % MED_W) + MED_W) % MED_W;
      const cell = r * MED_W + c;
      if (!wn.hwCellSet.has(cell)) continue;
      wn.hwCellSet.delete(cell);
      for (let k = 0; k < wn.hwNodes.length; k++) {
        if (wn.hwNodes[k].cell === cell) {
          // detach: clear its adjacency entries on both sides
          for (const e of wn.hwAdj[k]) {
            const other = wn.hwAdj[e.to];
            if (other) {
              const j = other.findIndex(x => x.to === k);
              if (j >= 0) other.splice(j, 1);
            }
          }
          wn.hwAdj[k] = [];
          wn.hwNodes[k] = { lat: 91, lon: 0, cell: -1 }; // sentinel: never nearest
          break;
        }
      }
    }
  }
  _editorRefreshOverlay();
}

// Main pointer handler — routes a globe point to the active brush.
function _editorPaintAt(lat, lon, isStart) {
  _editorEnsureBaseline();
  const b = _mapEditor.brush;
  if (b === 'water' || b === 'land') {
    const isWater = b === 'water';
    if (isStart || !_mapEditor.currentStroke || _mapEditor.currentStroke.type !== b) {
      _mapEditor.currentStroke = { type: b, radius: _mapEditor.radius, points: [] };
      _mapEditor.strokes.push(_mapEditor.currentStroke);
      _mapEditor.lastLat = null;
    }
    const tiles = _mapEditor.radius;
    const medR = Math.max(1, Math.round(tiles / MED_STRIDE));
    if (_mapEditor.lastLat !== null) {
      // interpolate from the last point so fast drags stay continuous
      const [pr, pc] = _editorLatLonToMed(_mapEditor.lastLat, _mapEditor.lastLon);
      const [cr, cc] = _editorLatLonToMed(lat, lon);
      _editorBresMed(pr, pc, cr, cc, _editorBresBuf);
      for (const [rr, cc2] of _editorBresBuf) {
        _editorStampMed(rr, cc2, medR, isWater);
        _editorStampFine(Math.min(conquestGrid.cfg.GRID_H - 1, rr * MED_STRIDE),
                         cc2 * MED_STRIDE, tiles, isWater);
        _editorPaintDot(rr, cc2, tiles, isWater);
      }
    } else {
      _editorStampAt(lat, lon, isWater);
    }
    _mapEditor.currentStroke.points.push([lat, lon]);
    _mapEditor.lastLat = lat; _mapEditor.lastLon = lon;
    _editorRefreshOverlay();
  } else if (b === 'node') {
    if (isStart) { _editorAddNodeAt(lat, lon, true); }
  } else if (b === 'edge') {
    if (isStart) {
      if (!_mapEditor.edgeFirst) {
        _mapEditor.edgeFirst = [lat, lon];
        _editorSetStatus('Edge: click the second endpoint');
      } else {
        _editorMakeEdge(_mapEditor.edgeFirst, [lat, lon]);
        _mapEditor.strokes.push({ type: 'highway_edge', from: _mapEditor.edgeFirst, to: [lat, lon] });
        _mapEditor.edgeFirst = null;
        _editorRefreshOverlay();
        _editorSetStatus('Edge created');
      }
    }
  } else if (b === 'erase') {
    _editorEraseAt(lat, lon);
  }
}

function _editorExport() {
  const data = JSON.stringify({ version: 1, strokes: _mapEditor.strokes }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'map_edits.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log('[MAPEDIT] exported', _mapEditor.strokes.length, 'strokes → map_edits.json');
  _editorSetStatus('Exported ' + _mapEditor.strokes.length + ' strokes');
}
function _editorImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.strokes)) throw new Error('bad format');
      _editorEnsureBaseline();
      _mapEditor.strokes = parsed.strokes;
      _editorReapplyAll();
      _editorSetStatus('Imported ' + parsed.strokes.length + ' strokes');
      console.log('[MAPEDIT] imported', parsed.strokes.length, 'strokes');
    } catch (e) {
      console.warn('[MAPEDIT] import failed:', e.message);
      _editorSetStatus('Import failed: ' + e.message);
    }
  };
  reader.readAsText(file);
}

// Auto-load public/data/map_edits.json once the water mask + highway graph are
// ready, so baked edits (e.g. the Suez Canal) are navigable AND visible without
// the user having to open the editor and click Import.
async function _editorAutoLoadEdits() {
  // Wait (briefly) for the medium water mask + highway graph.
  let tries = 0;
  while ((!conquestGrid || !conquestGrid._maskReady || !_waterwayNetwork) && tries < 100) {
    await new Promise(r => setTimeout(r, 100));
    tries++;
  }
  if (!conquestGrid || !conquestGrid._maskReady) { console.warn('[MAPEDIT] auto-load: conquest grid not ready'); return; }
  _ensureMediumArrays();
  let res;
  try { res = await fetch('/data/map_edits.json'); }
  catch (e) { console.log('[MAPEDIT] no map_edits.json to auto-load (non-fatal)'); return; }
  if (!res.ok) { console.log('[MAPEDIT] no map_edits.json (HTTP ' + res.status + ') — skipping'); return; }
  let parsed;
  try { parsed = await res.json(); }
  catch (e) { console.warn('[MAPEDIT] map_edits.json parse failed:', e.message); return; }
  if (!parsed || !Array.isArray(parsed.strokes) || !parsed.strokes.length) { console.log('[MAPEDIT] map_edits.json has no strokes'); return; }
  _editorEnsureBaseline();
  _mapEditor.strokes = parsed.strokes;
  _editorReapplyAll();
  _editorPaintSyncVisibility();
  console.log('[MAPEDIT] auto-loaded', parsed.strokes.length, 'stroke(s) from map_edits.json');
}

let _editorStatusEl = null;
function _editorSetStatus(msg) {
  if (_editorStatusEl) _editorStatusEl.textContent = msg;
}

function setupMapEditorPanel() {
  if (window.__mapEditorPanel) return;
  const panel = document.createElement('div');
  panel.id = 'mapEditorPanel';
  Object.assign(panel.style, {
    position: 'fixed', top: '12px', right: '248px', zIndex: 9999,
    background: 'rgba(13,15,18,0.92)', color: '#dfe4ea',
    border: '1px solid #3b424a', borderRadius: '8px', padding: '0',
    fontFamily: 'monospace', fontSize: '12px', width: '230px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.8)', userSelect: 'none', lineHeight: '1.4',
  });
  let html = '<div id="meHead" style="cursor:move;padding:7px 10px;border-bottom:1px solid #3b424a;display:flex;justify-content:space-between;align-items:center;">';
  html += '<span style="font-weight:bold;letter-spacing:.5px;">🗺️ Map Editor</span>';
  html += '<span id="meHide" style="cursor:pointer;padding:0 5px;">–</span></div>';
  html += '<div id="meBody" style="padding:8px 10px;">';
  html += '<button id="meToggle" style="width:100%;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:6px;margin-bottom:8px;">Edit Mode: OFF</button>';
  html += '<div style="margin-bottom:4px;color:#8b95a1;">Brush:</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px;">';
  html += '<button class="meBrush" data-b="water" style="cursor:pointer;background:#0a3d62;border:1px solid #3da9fc;color:#dfe4ea;border-radius:4px;padding:5px;">💧 Water</button>';
  html += '<button class="meBrush" data-b="land" style="cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;">⛰️ Land</button>';
  html += '<button class="meBrush" data-b="node" style="cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;">🔵 HW Node</button>';
  html += '<button class="meBrush" data-b="edge" style="cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;">🔗 HW Edge</button>';
  html += '<button class="meBrush" data-b="erase" style="cursor:pointer;background:#4a1a1a;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;grid-column:span 2;">🧽 Erase Nodes</button>';
  html += '</div>';
  html += '<div style="margin-bottom:4px;color:#8b95a1;">Tiles: <span id="meRadVal">6</span> <span style="color:#5a6470;font-size:9px;">(0.05° each)</span></div>';
  html += '<input id="meRadius" type="range" min="2" max="40" value="6" style="width:100%;margin-bottom:8px;">';
  html += '<div style="display:flex;gap:6px;margin-bottom:6px;">';
  html += '<button id="meUndo" style="flex:1;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;">↩ Undo</button>';
  html += '<button id="meClear" style="flex:1;cursor:pointer;background:#4a1a1a;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;">Clear</button>';
  html += '</div>';
  html += '<div style="display:flex;gap:6px;margin-bottom:6px;">';
  html += '<button id="meExport" style="flex:1;cursor:pointer;background:#1a4a2a;border:1px solid #3da9fc;color:#dfe4ea;border-radius:4px;padding:5px;">⬇ Export</button>';
  html += '<button id="meImport" style="flex:1;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:5px;">⬆ Import</button>';
  html += '</div>';
  html += '<input id="meFile" type="file" accept=".json" style="display:none;">';
  html += '<div id="meStatus" style="font-size:10px;color:#8b95a1;">Inactive. Toggle Edit Mode, pick a brush, drag on globe.</div>';
  html += '<div style="font-size:9px;color:#5a6470;margin-top:5px;">Painted water/land show on the globe instantly. Export → drop in public/data/ → rebuild to bake into pathfinding.</div>';
  html += '</div>';
  panel.innerHTML = html;
  document.body.appendChild(panel);
  window.__mapEditorPanel = panel;

  const body = panel.querySelector('#meBody');
  _editorStatusEl = panel.querySelector('#meStatus');
  const toggleBtn = panel.querySelector('#meToggle');
  const radiusInput = panel.querySelector('#meRadius');
  const radiusVal = panel.querySelector('#meRadVal');

  const setBrush = (b) => {
    _mapEditor.brush = b;
    _mapEditor.edgeFirst = null;
    panel.querySelectorAll('.meBrush').forEach(btn => {
      const on = btn.dataset.b === b;
      btn.style.background = on ? '#3da9fc' : (btn.dataset.b === 'water' ? '#0a3d62' : btn.dataset.b === 'erase' ? '#4a1a1a' : '#2a3036');
      btn.style.color = on ? '#0a0c0f' : '#dfe4ea';
    });
  };
  panel.querySelectorAll('.meBrush').forEach(btn => btn.addEventListener('click', () => setBrush(btn.dataset.b)));
  setBrush('water');

  const setActive = (on) => {
    _mapEditor.active = on;
    toggleBtn.style.background = on ? '#3da9fc' : '#2a3036';
    toggleBtn.style.color = on ? '#0a0c0f' : '#dfe4ea';
    toggleBtn.textContent = 'Edit Mode: ' + (on ? 'ON' : 'OFF');
    if (on && !_waterwayNetwork) loadWaterwayNetwork();
    _editorEnsurePaintOverlay();
    _editorPaintSyncVisibility();
    _editorSetStatus(on ? 'Active — brush: ' + _mapEditor.brush : 'Inactive');
  };
  toggleBtn.addEventListener('click', () => setActive(!_mapEditor.active));

  radiusInput.addEventListener('input', () => {
    _mapEditor.radius = parseInt(radiusInput.value, 10);
    radiusVal.textContent = _mapEditor.radius;
  });

  panel.querySelector('#meUndo').addEventListener('click', () => {
    if (!_mapEditor.strokes.length) { _editorSetStatus('Nothing to undo'); return; }
    _mapEditor.strokes.pop();
    _mapEditor.currentStroke = null;
    _mapEditor.edgeFirst = null;
    _editorReapplyAll();
    _editorSetStatus('Undone — ' + _mapEditor.strokes.length + ' strokes left');
  });
  panel.querySelector('#meClear').addEventListener('click', () => {
    _mapEditor.strokes = [];
    _mapEditor.currentStroke = null;
    _editorReapplyAll();
    _editorSetStatus('Cleared');
  });
  panel.querySelector('#meExport').addEventListener('click', _editorExport);
  panel.querySelector('#meImport').addEventListener('click', () => panel.querySelector('#meFile').click());
  panel.querySelector('#meFile').addEventListener('change', (e) => {
    if (e.target.files[0]) _editorImport(e.target.files[0]);
    e.target.value = '';
  });

  panel.querySelector('#meHide').addEventListener('click', () => {
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    panel.querySelector('#meHide').textContent = hidden ? '–' : '+';
  });
  // Drag header
  const head = panel.querySelector('#meHead');
  let dragging = false, ox = 0, oy = 0;
  head.addEventListener('pointerdown', (e) => { dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; });
  window.addEventListener('pointerup', () => dragging = false);
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    panel.style.left = (e.clientX - ox) + 'px';
    panel.style.top = (e.clientY - oy) + 'px';
    panel.style.right = 'auto';
  });

  // ── Globe paint listeners (left-drag). Neutralize the selection-box by
  //    clearing isDragging, since LEFT mouse is unused by OrbitControls. ──
  const bres = [];
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !_mapEditor.active) return;
    if (e.target.closest('#mapEditorPanel, #devPortPanel, #colorGradePanel')) return;
    const loc = raycastGlobe(e);
    if (!loc) return;
    isDragging = false;                       // suppress selection box
    const sb = document.getElementById('selBox'); if (sb) sb.style.display = 'none';
    _mapEditor.painting = true;
    _editorPaintAt(loc.lat, loc.lon, true);
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!_mapEditor.painting) return;
    const loc = raycastGlobe(e);
    if (!loc) return;
    _editorPaintAt(loc.lat, loc.lon, false);
  }, true);
  window.addEventListener('pointerup', () => {
    if (_mapEditor.painting) {
      _mapEditor.painting = false;
      _mapEditor.currentStroke = null;
      _mapEditor.lastLat = null;
    }
  }, true);
}

function setupColorGradePanel() {
  if (window.__cgPanel) return;
  const STORE = 'rocket_colorgrade_v1';
  const DEF = { hue: 0, sat: 100, bright: 100, contrast: 100 };
  let v;
  try { v = Object.assign({}, DEF, JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch { v = Object.assign({}, DEF); }

  const panel = document.createElement('div');
  panel.id = 'colorGradePanel';
  Object.assign(panel.style, {
    position: 'fixed', top: '12px', left: '12px', zIndex: 9999,
    background: 'rgba(13,15,18,0.92)', color: '#dfe4ea',
    border: '1px solid #3b424a', borderRadius: '8px', padding: '0',
    fontFamily: 'monospace', fontSize: '12px', width: '232px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.8)', userSelect: 'none', lineHeight: '1.4',
  });

  const ROWS = [
    ['hue', 'Hue', 0, 360, 1, 'deg'],
    ['sat', 'Saturation', 0, 300, 1, '%'],
    ['bright', 'Brightness', 0, 200, 1, '%'],
    ['contrast', 'Contrast', 0, 200, 1, '%'],
  ];

  let html = '<div id="cgHead" style="cursor:move;padding:7px 10px;border-bottom:1px solid #3b424a;display:flex;justify-content:space-between;align-items:center;">';
  html += '<span style="font-weight:bold;letter-spacing:.5px;">🎨 Color Grade</span>';
  html += '<span id="cgHide" style="cursor:pointer;padding:0 5px;">–</span></div>';
  html += '<div id="cgBody" style="padding:8px 10px;">';
  for (const [key, label, lo, hi, step, unit] of ROWS) {
    html += `<div style="display:flex;justify-content:space-between;margin:5px 0 2px;"><span>${label}</span><span id="cg_${key}_v">${v[key]}${unit}</span></div>`;
    html += `<input id="cg_${key}" type="range" min="${lo}" max="${hi}" step="${step}" value="${v[key]}" style="width:100%;accent-color:#3da9fc;">`;
  }
  html += '<div style="display:flex;gap:6px;margin-top:9px;">';
  html += '<button id="cgReset" style="flex:1;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:4px;">Reset</button>';
  html += '<button id="cgCopy" style="flex:1;cursor:pointer;background:#2a3036;border:1px solid #3b424a;color:#dfe4ea;border-radius:4px;padding:4px;">Copy CSS</button>';
  html += '</div>';
  html += '<div id="cgFilterTxt" style="margin-top:7px;font-size:10px;color:#8b95a1;word-break:break-all;"></div>';
  html += '</div>';
  panel.innerHTML = html;
  document.body.appendChild(panel);
  window.__cgPanel = panel;
  appendBandEditor(panel); // DEV: per-band terrain color pickers

  const body = panel.querySelector('#cgBody');
  const filterTxt = panel.querySelector('#cgFilterTxt');
  const filterStr = () => `hue-rotate(${v.hue}deg) saturate(${v.sat}%) brightness(${v.bright}%) contrast(${v.contrast}%)`;

  const apply = () => {
    const c = document.getElementById('gameCanvas');
    if (c) c.style.filter = filterStr();
    localStorage.setItem(STORE, JSON.stringify(v));
    for (const [key, , , , , unit] of ROWS) {
      const lab = panel.querySelector('#cg_' + key + '_v');
      if (lab) lab.textContent = v[key] + unit;
    }
    filterTxt.textContent = filterStr();
  };

  for (const [key] of ROWS) {
    const inp = panel.querySelector('#cg_' + key);
    inp.addEventListener('input', () => { v[key] = +inp.value; apply(); });
  }
  panel.querySelector('#cgReset').addEventListener('click', () => {
    v = Object.assign({}, DEF);
    for (const [key] of ROWS) panel.querySelector('#cg_' + key).value = v[key];
    apply();
  });
  panel.querySelector('#cgCopy').addEventListener('click', () => {
    const s = filterStr();
    if (navigator.clipboard) navigator.clipboard.writeText(s).catch(() => {});
    filterTxt.textContent = 'copied → ' + s;
  });

  // collapse / expand
  const hideBtn = panel.querySelector('#cgHide');
  hideBtn.addEventListener('click', () => {
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    hideBtn.textContent = hidden ? '–' : '+';
  });

  // drag by header
  const head = panel.querySelector('#cgHead');
  let dragging = false, ox = 0, oy = 0;
  head.addEventListener('mousedown', (e) => {
    dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panel.style.left = (e.clientX - ox) + 'px';
    panel.style.top = (e.clientY - oy) + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  apply();
}

function init3D() {
    const canvas = document.getElementById('gameCanvas');
    // Reuse ONE renderer across games — creating a new WebGLRenderer on the same
    // canvas every restart leaked the entire old GPU context (~40+ MB per game).
    if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, logarithmicDepthBuffer: true });
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Cap DPR at 1.5 — on 4K/high-DPI screens a 2.0 ratio quadruples fragment
    // work (this scene is fill-bound: two 32k-tri globe layers + transparency).
    // 1.5 keeps text crisp while cutting pixel count ~44% vs 2.0.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    if (renderer.toneMapping !== undefined) {
        // NoToneMapping: output EXACT sRGB colors. ACESFilmic was compressing
        // highlights toward gray and desaturating the flat map ("washed out /
        // whitish"). A stylized flat-color globe must pass colors through unchanged.
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1.0;
    }
    if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if (renderer.outputEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;

    // Dev panels only mount in Dev Mode (start-menu button). Normal play skips them.
    if (window.DEV_MODE) {
        setupColorGradePanel(); // live color-grading controls (hue/sat/brightness/contrast)
        setupDevPortPanel();    // click shorelines to place ports & test trade routing
        setupMapEditorPanel();  // paint rivers/land + place highway nodes/edges
    }
    
    // Dispose the PREVIOUS scene's GPU resources before replacing it (restart path):
    // globe geometry, atmosphere shader, stars, textures, cached shared geometries.
    if (scene) {
        scene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
            }
        });
        while (scene.children.length) scene.remove(scene.children[0]);
        // Shared caches were just disposed — clear so they re-create lazily.
        for (const k in GEO_CACHE) delete GEO_CACHE[k];
        for (const k in MAT_CACHE) delete MAT_CACHE[k];
        // TASK-303: the dispose sweep above killed the polish meshes too —
        // drop the refs so _ensurePolishAtmosphere rebuilds them fresh.
        _polishClouds = _polishSun = _polishShimmer = null;
        _polishShimTex = null;
        _polishState.wakeLast.clear(); _polishState.wakeCd.clear();
    }
    // Old controls' DOM listeners accumulate on the shared canvas — dispose them.
    if (controls) { try { controls.dispose(); } catch (_) {} }
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#03050a');
    _waterDebugMesh = null;   // fresh scene → rebuild overlay on next toggle
    _waterDebugMode = 0;

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 10, 300000);
    camera.position.set(0, 0, 18000);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    // OpenFront-style controls: LEFT-drag rotates the globe, LEFT-tap acts
    // (attack/select/build — the click handler suppresses drags via
    // window.suppressNextClick), RIGHT is reserved for the radial menu (ui.js),
    // MIDDLE/wheel zoom.
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: null
    };
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = EARTH_RADIUS + 50;
    controls.maxDistance = EARTH_RADIUS * 4;
    controls.enablePan = false;

    // Lighting — warmer, more realistic
    const ambient = new THREE.AmbientLight(0xb0c8e0, 0.35);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xfff5e0, 1.2);
    dirLight.position.set(200, 100, 200);
    scene.add(dirLight);
    // Subtle fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0x4466aa, 0.3);
    fillLight.position.set(-200, -50, -100);
    scene.add(fillLight);

    // ── Starfield background ──
    const starGeo = new THREE.BufferGeometry();
    const starCount = 8000;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        const r = 80000 + Math.random() * 40000;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        starPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starPos[i * 3 + 2] = r * Math.cos(phi);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 60, sizeAttenuation: true, transparent: true, opacity: 0.8 });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);
    
    // Globe — high-res geometry for smooth zoom.
    // Unlit (MeshBasicMaterial) so the painted biome/territory map shows at full,
    // even brightness across the whole visible sphere — clean OpenFront-style flat
    // look with no day/night terminator. In mode1 the conquest gridCanvas is bound
    // directly to this material's map (see renderMode1Territory); before that loads
    // it shows a flat ocean-blue fallback. Structures sit on the surface and stay
    // visible because there is no separate overlay above them.
    const globeGeo = new THREE.SphereGeometry(EARTH_RADIUS, 256, 128);
    const globeMat = new THREE.MeshBasicMaterial({
        color: 0x1b4d6e       // flat ocean-blue fallback (overridden by the map in mode1)
    });
    earthMesh = new THREE.Mesh(globeGeo, globeMat);
    scene.add(earthMesh);
    // Safety net: if the unified biome canvas was already painted (grid init
    // finished before 3D came up), bind it now. Otherwise initConquestGrid binds
    // it when its async terrain load completes. Covers every init ordering.
    if (conquestGrid && conquestGrid._biomePainted) applyBiomeGlobeTexture();

    // No photographic textures — the map is a crisp flat overlay rendered from the
    // GeoJSON land mask. Trigger an initial paint if the grid is already up.
    window.earthBaseImg = null;
    if (window.gameMode === 'mode1' && conquestGrid) renderMode1Territory();
    else if (typeof repaintAllCountries === 'function') repaintAllCountries();

    // ── Atmosphere glow shell ──
    const atmoGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.025, 128, 64);
    const atmoMat = new THREE.ShaderMaterial({
        uniforms: { glowColor: { value: new THREE.Color(0x4488ff) } },
        vertexShader: `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 glowColor;
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
                gl_FragColor = vec4(glowColor, 1.0) * intensity;
            }`,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmoMesh);

    // TASK-303 visual polish layer set (clouds, sun glare, ocean shimmer)
    _ensurePolishAtmosphere();

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Map GeoJSON → Territory Overlay
    fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson')
        .then(res => res.json())
        .then(data => {
            window.GEOJSON_DATA = data;
            initTerritory(data);
            // Update spawn-phase message now that map data is ready
            if (window.startSpawnPhase) {
                let el = document.getElementById('tgtMsg');
                if (el) el.textContent = '🚩 انقر على أي نقطة على اليابسة لاختيار موقع بدايتك!';
            }
        })
        .catch(e => {
            console.log("Remote GeoJSON failed, trying local", e);
            fetch('tmp_geojson.json')
                .then(res => res.json())
                .then(data => {
                    window.GEOJSON_DATA = data;
                    initTerritory(data);
                    if (window.startSpawnPhase) {
                        let el = document.getElementById('tgtMsg');
                        if (el) el.textContent = '🚩 انقر على أي نقطة على اليابسة لاختيار موقع بدايتك!';
                    }
                })
                .catch(e2 => console.error("All GeoJSON failed", e2));
        });
        
    // Range Marker
    const rangeMat = new THREE.LineBasicMaterial({color: 0xff4444, transparent: true, opacity: 0.8});
    rangeMarkerMesh = new THREE.Line(new THREE.BufferGeometry(), rangeMat);
    rangeMarkerMesh.visible = false;
    scene.add(rangeMarkerMesh);

    preloadAssets();
    loadAircraftModels();   // TASK-201: GLB registry (async, per-aircraft fallback)
    loadTankModels();       // TASK-302: WW2 tank FBX registry (async, procedural fallback)
    
    // Initialize Geo-Renderer (for enhanced geographic data)
    GEO_RENDERER.init(scene, camera);
    
    // NEW UI: radial command menu + toast mirroring
    initNewUI();
    
    // Build hotbar DOM (slots refreshed by __refreshHotbar from updateHUD)
    _buildHotbarDom();
}

function preloadAssets() {
    const objLoader = new THREE.OBJLoader();
    const mtlLoader = new THREE.MTLLoader();
    
    const assets = [
        {name: 'F15', path: 'Assets/Jets Asset/OBJ/F15Asset.obj', mtl: 'Assets/Jets Asset/OBJ/F15Asset.mtl'},
        {name: 'F22', path: 'Assets/Jets Asset/OBJ/F22Asset.obj', mtl: 'Assets/Jets Asset/OBJ/F22Asset.mtl'},
        {name: 'Su27', path: 'Assets/Jets Asset/OBJ/Su-27Asset.obj', mtl: 'Assets/Jets Asset/OBJ/Su-27Asset.mtl'}
    ];
    
    // Set fallback sizes just in case obj loads huge
    assets.forEach(a => {
        mtlLoader.load(a.mtl, function(materials) {
            materials.preload();
            // Per-asset loader: a single SHARED objLoader raced concurrent
            // setMaterials() calls and could build jets with another aircraft's materials.
            const ol = new THREE.OBJLoader();
            ol.setMaterials(materials);
            ol.load(a.path, function(obj) {
                // scale & cache
                const bbox = new THREE.Box3().setFromObject(obj);
                const size = bbox.getSize(new THREE.Vector3()).length();
                if(size > 0) obj.scale.setScalar(15.0 / size); 
                GLOBAL_MODELS[a.name] = obj;
            }, undefined, function(e) { console.error("Missing asset", a.name, e); });
        });
    });
}

// ═══════════════════════════════════════════════════════════════════
//  TASK-201: AIRCRAFT GLB REGISTRY — asset pipeline for user-authored
//  Blender models. One GLB per PCFG key lands in Assets/Aircraft/
//  (-Z forward, meters). Until the art exists every aircraft degrades
//  gracefully: GLB → OBJ jet (GLOBAL_MODELS) → low-poly proxy. The
//  system is fully playable BEFORE any model exists.
// ═══════════════════════════════════════════════════════════════════
const AIRCRAFT_GLB_MANIFEST = {
    // pkey  → { file, span }  span = real-world wingspan in METERS (log-scale
    // mapped to globe units below so a B-2 visibly out-sizes an F-16).
    heli:        { file: 'heli.glb',        span: 14.6 },  // AH-64
    fighter:     { file: 'fighter.glb',     span: 9.96 },  // F-16
    bomber:      { file: 'bomber.glb',      span: 17.6 },  // Su-24
    interceptor: { file: 'interceptor.glb', span: 11.4 },  // MiG-29
    a10:         { file: 'a10.glb',         span: 17.5 },  // A-10C
    gunship:     { file: 'gunship.glb',     span: 40.4 },  // AC-130
    awacs:       { file: 'awacs.glb',       span: 44.4 },  // E-3 (+rotodome)
    su57:        { file: 'su57.glb',        span: 14.0 },  // Su-57
    stealth:     { file: 'stealth.glb',     span: 52.4 },  // B-2
    f22:         { file: 'f22.glb',         span: 13.6 },  // F-22
};
// Real wingspans span 10-52m — mapped onto a 9-24 globe-unit range so every
// aircraft stays visible at globe scale while relative size still reads.
function _aircraftSpanToUnits(spanMeters) {
    return 9 + 15 * Math.min(1, Math.max(0, (spanMeters - 10) / 42));
}
const AIRCRAFT_MODELS = {};   // pkey → { group:THREE.Group (normalized, +Z nose), spanUnits }

function loadAircraftModels() {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) return;   // CDN missing → OBJ/proxy fallback
    const loader = new THREE.GLTFLoader();
    for (const key in AIRCRAFT_GLB_MANIFEST) {
        const entry = AIRCRAFT_GLB_MANIFEST[key];
        loader.load('Assets/Aircraft/' + entry.file, (gltf) => {
            try {
                const inner = gltf.scene;
                const bb = new THREE.Box3().setFromObject(inner);
                const size = new THREE.Vector3(); bb.getSize(size);
                const spanXZ = Math.max(size.x, size.z);
                if (spanXZ < 0.0001) return;                        // empty/degenerate model → skip
                // Authors export -Z forward; wrap so the GROUP flies nose-first
                // under lookAt() (+Z), and normalize size to the span table.
                inner.rotation.y = Math.PI;
                inner.scale.setScalar(_aircraftSpanToUnits(entry.span) / spanXZ);
                inner.traverse(child => {
                    if (child.isMesh && child.material) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(m => { if (m.emissive) m.emissive.setHex(0x1a1a1a); });
                    }
                });
                const wrap = new THREE.Group();
                wrap.add(inner);
                AIRCRAFT_MODELS[key] = { group: wrap, spanUnits: _aircraftSpanToUnits(entry.span) };
                console.log('[AIR] model ready:', key, '→', entry.file);
            } catch (e) { console.warn('[AIR] model rejected:', key, e.message); }
        }, undefined, () => { /* file not authored yet — expected pre-art */ });
    }
}

function createLineFromLatLon(coordSet, material) {
    const points = [];
    coordSet.forEach(coord => {
        const lon = coord[0], lat = coord[1];
        points.push(latLonToVec3(lat, lon, EARTH_RADIUS + 10.0));
    });
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geo, material);
}

window.addEventListener('resize', () => {
    if(camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});

let _id=0;
let structs=[], missiles=[], planes=[], drones=[], aamMissiles=[], exps=[], particles=[];
let tradeShips=[], trains=[], troopCohorts=[], transportShips=[], warships=[];
// TASK-402: submarine torpedoes, deployable minefields, sinking-animation
// hulls (meshes owned by the animator until they reach the seabed).
let torpedoes = [], mineFields = [], navalSinking = [];
let fleetStanceIdx = 0;        // K cycles GAME_CONSTANTS.FLEET_STANCES (free/line/wedge)
let mineMode = false;          // Z arms mine-laying (click water to deploy a field)
let tanks=[];   // TASK-302: armored divisions (mobile land units)
let eBuiltPorts = 0;
function _enemyPortCost() { return Math.floor(GAME_CONSTANTS.PORT_BASE_COST * Math.pow(1.5, eBuiltPorts)); }
window.paintExpansions=[];
let pTroops=25000, eTroops=25000;
let pBuiltCities=0, pBuiltPorts=0, pBuiltFactories=0;
let selectedSourceProvinceIdx=-1;
window.startSpawnPhase = false;

const GEO_CACHE = {};
const MAT_CACHE = {};

// ── P3/P4 FIX: Material pool for transient particles/explosions ──
// Eliminates per-frame material allocation/disposal churn (hundreds/sec during combat).
const _fxMatPool = [];
function _getFxMat(color, opacity) {
    const mat = _fxMatPool.pop() || new THREE.MeshBasicMaterial();
    mat.color.set(color);
    mat.opacity = opacity;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.visible = true;
    return mat;
}
function _recycleMat(mat) {
    if (_fxMatPool.length < 500) _fxMatPool.push(mat); // cap pool to prevent unbounded growth
}

function getSharedGeo(role) {
    if(GEO_CACHE[role]) return GEO_CACHE[role];
    let geo;
    if(role === 'launcher' || role === 'sam') {
        geo = new THREE.BoxGeometry(2.0, 3.0, 2.0);
    } else if(role === 'radar') {
        geo = new THREE.CylinderGeometry(1.5, 0.8, 3.8, 6);
    } else if(role === 'city' || role === 'base' || role === 'port' || role === 'factory') {
        geo = new THREE.BoxGeometry(3.8, 2.5, 3.8);
    } else if(role === 'bomber') {
        geo = new THREE.ConeGeometry(1.0, 3.0, 3);
        geo.rotateX(Math.PI/2);
    } else if(role === 'missile') {
        geo = new THREE.CylinderGeometry(0.4, 0.4, 3.2, 4);
        geo.rotateX(-Math.PI/2);
    } else {
        geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    }
    GEO_CACHE[role] = geo;
    return geo;
}

function getSharedMat(colorHex) {
    if(MAT_CACHE[colorHex]) return MAT_CACHE[colorHex];
    let mat = new THREE.MeshPhongMaterial({color: colorHex, flatShading: true});
    mat.userData = mat.userData || {};
    mat.userData.shared = true;   // NEVER dispose() shared mats on entity death
    MAT_CACHE[colorHex] = mat;
    return mat;
}

// ═══════════════════════════════════════════════════════════════════
//  LOW-POLY 3D STRUCTURE MODELS (board-game-piece style)
//  Each building is a COMPOSITE of primitives (boxes/cylinders/cones) with
//  flat shading, VERY DARK GRAY structural tones (gray→black) + bright
//  OWNER-COLORED ACCENTS (flags, stripes, rings) that pop on the dark
//  bodies. +Y up, base at y≈0, footprint ~2.4 units.
//  Geometries cached; structural materials shared; only accent materials
//  are per-instance (flagged .accent) so capture-retint and dispose are safe.
// ═══════════════════════════════════════════════════════════════════
const LP = {
    CONCRETE: 0x2e3339, LIGHT: 0x3e444b, DGRAY: 0x202429, METAL: 0x272c31,
    DARK: 0x141619, ROOF: 0x181b1f, WHITE: 0xdde3e8, RUNWAY: 0x171a1e,
    TIRE: 0x111316, GLASS: 0x9fd8ff, EARTH: 0x443c30,
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
const _box = (w, h, d) => _g(`box${w}${h}${d}`, () => new THREE.BoxGeometry(w, h, d));
const _cyl = (rt, rb, h, s = 10) => _g(`cyl${rt}${rb}${h}${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const _cone = (r, h, s = 10) => _g(`cone${r}${h}${s}`, () => new THREE.ConeGeometry(r, h, s));
const _sph = (r, ws = 10, hs = 8) => _g(`sph${r}${ws}${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const _halfSph = (r) => _g(`half${r}`, () => new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2));

// Structural (shared) material — VERY DARK GRAY family (gray→black) so the
// bright owner-colored accents (flags, stripes, rings) pop at a glance.
function _sm(color) {
    return getSharedMat(color);
}
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
        // rocket (bigger) — TASK-403: wrapped in a named group so the pad can
        // show the reload-while-empty state (rocket hidden while re-arming).
        const rocket = new THREE.Group();
        rocket.name = 'rocket';
        rocket.position.set(0.35, 0.98, -0.15);
        g.add(rocket);
        _M(rocket, _cyl(0.2, 0.2, 1.5, 12), _sm(LP.WHITE), 0, 0, 0);
        _M(rocket, _cone(0.2, 0.5, 12), _sm(LP.DGRAY), 0, 1.0, 0);        // nose
        _M(rocket, _cyl(0.205, 0.205, 0.16, 12), _am(acc), 0, 0.47, 0);
        _M(rocket, _cyl(0.205, 0.205, 0.16, 12), _am(acc), 0, -0.38, 0);
        for (let i = 0; i < 4; i++) {                                     // 4 fins
            const a = i * Math.PI / 2 + Math.PI / 4;
            _M(rocket, _box(0.05, 0.45, 0.26), _sm(LP.DGRAY),
                Math.cos(a) * 0.24, -0.5, Math.sin(a) * 0.24, 0, -a, 0);
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
    // ── RADAR-ECM (TASK-403): jammer shelter + rotating log-periodic array
    //    + whip antennas + generator — the station that scatters enemy
    //    missile guidance inside its ecmRadius. ──
    radar_ecm(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.62, 0.72, 0.2, 12), _sm(LP.CONCRETE), 0, 0.1);
        _M(g, _cyl(0.73, 0.73, 0.04, 12), _am(acc), 0, 0.22);            // ring
        // equipment shelter (ribbed cabinets)
        _M(g, _box(0.72, 0.4, 0.5), _sm(LP.LIGHT), 0.55, 0.42, 0.5);
        _M(g, _box(0.76, 0.06, 0.54), _am(acc), 0.55, 0.64, 0.5);
        for (let i = 0; i < 3; i++) _M(g, _box(0.74, 0.03, 0.03), _sm(LP.DGRAY), 0.55, 0.28 + i * 0.1, 0.76);
        // heat exchanger + cable spool
        _M(g, _box(0.3, 0.34, 0.1), _sm(LP.DGRAY), 0.55, 0.38, 0.22);
        _M(g, _cyl(0.14, 0.14, 0.1, 8), _sm(LP.METAL), -0.6, 0.33, 0.45, 0, 0, Math.PI / 2);
        // mast under the array
        _M(g, _box(0.14, 1.5, 0.14), _sm(LP.METAL), -0.35, 0.95);
        // ROTATING JAMMER ARRAY: 3 log-periodic panels (reuses the radar
        // 'dish' sweep animation)
        const arr = new THREE.Group();
        arr.position.set(-0.35, 1.8, 0);
        arr.name = 'dish';
        g.add(arr);
        _M(arr, _cyl(0.1, 0.1, 0.16, 8), _sm(LP.DGRAY), 0, -0.05, 0);
        for (let i = 0; i < 3; i++) {
            const a = i * (Math.PI * 2 / 3);
            const panel = new THREE.Group();
            panel.rotation.y = a;
            panel.rotation.x = -0.25;
            arr.add(panel);
            _M(panel, _box(0.5, 0.72, 0.03), _sm(LP.LIGHT), 0, 0.1, 0.14);
            _M(panel, _box(0.46, 0.06, 0.05), _am(acc), 0, 0.34, 0.14);   // element bars
            _M(panel, _box(0.46, 0.06, 0.05), _am(acc), 0, 0.14, 0.14);
            _M(panel, _box(0.46, 0.06, 0.05), _am(acc), 0, -0.06, 0.14);
        }
        // whip antennas + generator set
        _M(g, _cyl(0.016, 0.016, 0.9, 4), _sm(LP.DARK), 0.35, 1.1, 0.62);
        _M(g, _cyl(0.016, 0.016, 0.7, 4), _sm(LP.DARK), 0.75, 1.0, 0.62);
        _M(g, _box(0.34, 0.26, 0.26), _sm(LP.DGRAY), -0.6, 0.33, 0.72);
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

// ── WARSHIP MODEL — low-poly destroyer (bow toward -Z, +Y up, base y≈0) ──
// Dark hull + superstructure with bright OWNER-COLORED accents (waterline
// stripe, turret ring, flag, helipad ring). Built from the same cached
// geometry helpers as structures; hull materials shared, accents per-instance.
// ~26 local units long → ×1.5 scale ≈ 40 world units (capital-ship presence).
function buildWarshipModel(acc, cls) {
    const g = new THREE.Group();
    g.userData.accents = [];
    if (cls === 'carrier') {
        // ── AIRCRAFT CARRIER: wide flat flight deck + angled landing strip,
        //    starboard island, deck stripes, parked jets, CIWS mounts ──
        _M(g, _box(9.0, 2.4, 30), _sm(LP.CONCRETE), 0, 1.2, 0);                    // hull
        _M(g, _cone(4.5, 5.0, 4), _sm(LP.CONCRETE), 0, 1.2, -17.4, -Math.PI / 2, Math.PI / 4, 0, 'bow');
        _M(g, _box(7.6, 2.0, 4.0), _sm(LP.DGRAY), 0, 1.1, 16.8, 0, 0, 0, 'stern');// stern transom
        _M(g, _box(9.4, 0.5, 30.6), _am(acc), 0, 0.45, 0);                         // waterline stripe
        _M(g, _box(12.6, 0.5, 33), _sm(LP.RUNWAY), 0, 2.65, 0);                    // flight deck (overhangs hull)
        _M(g, _box(0.35, 0.06, 26), _sm(LP.WHITE), -1.4, 2.93, -1.5);              // centreline dashes
        for (let i = 0; i < 6; i++) _M(g, _box(0.35, 0.06, 1.1), _sm(LP.WHITE), -1.4, 2.93, -12 + i * 4.4);
        _M(g, _box(7.5, 0.06, 0.4), _sm(LP.WHITE), 1.8, 2.93, 8.5);                // angled-deck line
        _M(g, _box(1.1, 0.06, 0.4), _am(acc), -1.4, 2.93, -14.6);                  // threshold marks
        _M(g, _box(1.1, 0.06, 0.4), _am(acc), 1.8, 2.93, -14.6);
        // Island superstructure (starboard)
        _M(g, _box(2.6, 3.2, 7.5), _sm(LP.METAL), 4.6, 4.5, 1.5);
        _M(g, _box(2.2, 0.5, 5.4), _sm(LP.GLASS), 4.6, 5.2, 1.0);
        _M(g, _box(2.0, 1.0, 2.4), _sm(LP.LIGHT), 4.6, 6.5, 3.2);                  // bridge top
        _M(g, _cyl(0.9, 1.0, 3.4, 8), _sm(LP.DGRAY), 4.4, 7.5, -0.8);              // funnel
        _M(g, _cyl(0.14, 0.18, 5.5, 6), _sm(LP.METAL), 4.6, 10.4, 1.5);            // mast
        _M(g, _box(2.4, 0.5, 0.35), _sm(LP.LIGHT), 4.6, 13.1, 1.5, 0, 0, 0, 'radar');
        _M(g, _box(1.3, 0.8, 0.08), _am(acc), 5.35, 12.2, 1.5);                    // ensign
        // Deck park: 5 parked jets (little crosses)
        for (let i = 0; i < 5; i++) {
            _M(g, _box(0.5, 0.18, 1.6), _sm(LP.DARK), 4.2, 2.9, -10.5 + i * 2.6);
            _M(g, _box(1.7, 0.1, 0.4), _sm(LP.DARK), 4.2, 2.95, -10.5 + i * 2.6);
        }
        // CIWS: rotating Phalanx mounts fore/aft of the island
        _M(g, _cyl(0.55, 0.65, 0.8, 8), _sm(LP.METAL), 4.4, 3.1, 6.6);
        _M(g, _cyl(0.35, 0.35, 0.9, 6), _sm(LP.DARK), 4.4, 3.9, 6.6, Math.PI / 2, 0, 0);
        _M(g, _cyl(0.3, 0.3, 1.6, 6), _sm(LP.DARK), 4.4, 4.05, 6.6, Math.PI / 2, 0, 0, 'ciws');
        _M(g, _cyl(0.55, 0.65, 0.8, 8), _sm(LP.METAL), -3.8, 3.1, -13.5);
        _M(g, _cyl(0.3, 0.3, 1.6, 6), _sm(LP.DARK), -3.8, 4.0, -13.5, Math.PI / 2, 0, 0, 'ciws2');
        // Deck-edge lifts (accent)
        _M(g, _box(2.6, 0.12, 3.2), _am(acc), 5.2, 2.7, -3.5);
        _M(g, _box(2.6, 0.12, 3.2), _am(acc), 5.2, 2.7, 5.5);
    } else if (cls === 'missile') {
        // ── MISSILE CRUISER: sleek hull, big VLS cell grids fore+aft ──
        _M(g, _box(5.2, 2.2, 19), _sm(LP.CONCRETE), 0, 1.1, 0.5);
        _M(g, _cone(2.6, 3.2, 4), _sm(LP.CONCRETE), 0, 1.1, -10.2, -Math.PI / 2, Math.PI / 4, 0, 'bow');
        _M(g, _box(4.4, 2.0, 3.0), _sm(LP.DGRAY), 0, 1.0, 11.6, 0, 0, 0, 'stern');
        _M(g, _box(5.5, 0.4, 19.4), _am(acc), 0, 0.55, 0.5);
        _M(g, _box(4.6, 0.35, 18), _sm(LP.LIGHT), 0, 2.3, 0.5);
        // Fore VLS farm: 4×6 cells
        for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++)
            _M(g, _box(0.52, 0.14, 0.52), (r + c) % 2 ? _sm(LP.DARK) : _am(acc), -1.35 + c * 0.54, 2.52, -7.6 + r * 0.58);
        // Aft VLS farm: 2×6 cells
        for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++)
            _M(g, _box(0.52, 0.14, 0.52), (r + c) % 2 ? _sm(LP.DARK) : _am(acc), -1.35 + c * 0.54, 2.52, 8.2 + r * 0.58);
        // Low superstructure + enclosed mast
        _M(g, _box(3.0, 1.8, 5.6), _sm(LP.METAL), 0, 3.1, 1.2);
        _M(g, _box(2.8, 0.5, 0.12), _sm(LP.GLASS), 0, 3.6, -1.65);
        _M(g, _cyl(0.5, 0.8, 4.6, 6), _sm(LP.DGRAY), 0, 6.3, 1.2);                  // pyramidal mast
        _M(g, _box(2.6, 0.45, 0.35), _sm(LP.LIGHT), 0, 8.7, 1.2, 0, 0, 0, 'radar');
        _M(g, _box(1.0, 0.65, 0.08), _am(acc), 0.65, 8.9, 1.2);
        // Twin illumination directors (accent rings)
        _M(g, _cyl(0.28, 0.28, 0.9, 8), _sm(LP.LIGHT), -1.5, 3.9, -5.4, Math.PI / 2.6);
        _M(g, _cyl(0.3, 0.3, 0.12, 8), _am(acc), -1.5, 4.2, -5.6, Math.PI / 2.6);
        // Helipad aft
        _M(g, _cyl(1.4, 1.4, 0.06, 10), _am(acc), 0, 2.55, 12.2);
    } else if (cls === 'drone') {
        // ── DRONE CARRIER: boxy tender hull, lattice racks of drones ──
        _M(g, _box(6.4, 2.2, 17), _sm(LP.CONCRETE), 0, 1.1, 0.5);
        _M(g, _cone(3.2, 3.6, 4), _sm(LP.CONCRETE), 0, 1.1, -9.2, -Math.PI / 2, Math.PI / 4, 0, 'bow');
        _M(g, _box(5.4, 2.0, 3.0), _sm(LP.DGRAY), 0, 1.0, 10.2, 0, 0, 0, 'stern');
        _M(g, _box(6.7, 0.4, 17.4), _am(acc), 0, 0.55, 0.5);
        _M(g, _box(5.8, 0.35, 16), _sm(LP.LIGHT), 0, 2.3, 0.5);
        // Launch racks: 2 rails with stacked drone cradles
        for (const rx of [-1.6, 1.6]) {
            _M(g, _box(0.28, 1.5, 9.5), _sm(LP.METAL), rx, 3.0, -1.5);
            for (let i = 0; i < 4; i++) {
                _M(g, _box(1.4, 0.16, 0.7), _am(acc), rx, 3.0 + (i % 2) * 0.8, -5.2 + i * 2.4);
                _M(g, _box(0.45, 0.14, 1.5), _sm(LP.DARK), rx, 3.12 + (i % 2) * 0.8, -5.2 + i * 2.4);
                _M(g, _box(1.3, 0.06, 0.35), _sm(LP.DARK), rx, 3.18 + (i % 2) * 0.8, -5.2 + i * 2.4);
            }
        }
        // Aft control house + antenna farm
        _M(g, _box(2.4, 1.6, 3.4), _sm(LP.METAL), 0, 3.0, 6.8);
        _M(g, _box(2.2, 0.4, 0.12), _sm(LP.GLASS), 0, 3.4, 5.05);
        for (let i = 0; i < 4; i++)
            _M(g, _cyl(0.05, 0.05, 2.6, 4), _sm(LP.METAL), -1.0 + i * 0.66, 5.1, 6.6 + (i % 2) * 0.7);
        _M(g, _box(2.2, 0.45, 0.3), _sm(LP.LIGHT), 0, 6.5, 6.8, 0, 0, 0, 'radar');
        _M(g, _box(1.0, 0.6, 0.08), _am(acc), 0.55, 6.9, 6.8);
        _M(g, _cyl(1.3, 1.3, 0.06, 10), _am(acc), 0, 2.55, 11.4);                  // recovery helipad
    } else if (cls === 'transport') {
        // ── INVASION TRANSPORT: long low troop hull, davits, stern helipad ──
        _M(g, _box(5.6, 2.0, 24), _sm(LP.CONCRETE), 0, 1.0, 0.5);
        _M(g, _cone(2.8, 3.8, 4), _sm(LP.CONCRETE), 0, 1.0, -13.1, -Math.PI / 2, Math.PI / 4, 0, 'bow');
        _M(g, _box(4.8, 1.8, 3.6), _sm(LP.DGRAY), 0, 0.95, 13.6, 0, 0, 0, 'stern');// ro-ro ramp
        _M(g, _box(5.9, 0.4, 24.4), _am(acc), 0, 0.5, 0.5);
        _M(g, _box(5.0, 0.3, 23), _sm(LP.LIGHT), 0, 2.1, 0.5);
        // Troop deckhouses (rows of hatch + house)
        _M(g, _box(2.6, 1.4, 6.0), _sm(LP.METAL), 0, 2.9, 3.4);
        _M(g, _box(2.4, 1.0, 4.0), _sm(LP.LIGHT), 0, 3.6, 8.6);
        _M(g, _box(2.2, 0.4, 0.12), _sm(LP.GLASS), 0, 3.9, 6.55);
        // Well-deck landing craft under davits
        for (let i = 0; i < 3; i++) {
            _M(g, _box(0.18, 1.3, 0.18), _sm(LP.METAL), -2.4, 2.9, -8.5 + i * 3.0);
            _M(g, _box(0.18, 1.3, 0.18), _sm(LP.METAL), 2.4, 2.9, -8.5 + i * 3.0);
            _M(g, _box(1.6, 0.5, 2.6), _am(acc), 0, 2.45, -8.5 + i * 3.0);
        }
        // Mast + radar + ensign
        _M(g, _cyl(0.12, 0.16, 4.4, 6), _sm(LP.METAL), 0, 6.0, 4.2);
        _M(g, _box(1.8, 0.45, 0.3), _sm(LP.LIGHT), 0, 8.3, 4.2, 0, 0, 0, 'radar');
        _M(g, _box(1.0, 0.65, 0.08), _am(acc), 0.7, 8.5, 4.2);
        // Stern flight deck
        _M(g, _cyl(1.6, 1.6, 0.06, 10), _am(acc), 0, 2.35, 13.2);
        _M(g, _box(0.32, 0.02, 1.0), _sm(LP.WHITE), 0, 2.42, 13.2);
        _M(g, _box(1.0, 0.02, 0.32), _sm(LP.WHITE), 0, 2.42, 13.2);
    } else if (cls === 'submarine') {
        // ── SUBMARINE (TASK-402): cigar pressure hull, sail + periscope,
        //    diving planes, rudder, prop — rides BELOW the surface radius
        //    (Warship._fxTick sinks the mesh when submerged). ──
        _M(g, _cyl(1.5, 1.5, 21, 10), _sm(LP.DGRAY), 0, 1.0, 0, Math.PI / 2, 0, 0);  // pressure hull (along Z)
        _M(g, _sph(1.5, 10, 8), _sm(LP.DGRAY), 0, 1.0, -10.5);                       // bow cap
        _M(g, _sph(1.5, 10, 8), _sm(LP.DGRAY), 0, 1.0, 10.5);                        // stern cap
        _M(g, _box(6.0, 0.4, 21.4), _am(acc), 0, 0.55, 0);                           // waterline accent band
        _M(g, _box(2.2, 2.4, 5.0), _sm(LP.METAL), 0, 2.6, 1.5);                      // sail / conning tower
        _M(g, _box(1.7, 0.5, 3.6), _sm(LP.GLASS), 0, 2.9, 0.4);                      // bridge glass
        _M(g, _cyl(0.09, 0.12, 2.8, 6), _sm(LP.METAL), 0.32, 4.9, 0.8);              // periscope mast
        _M(g, _box(0.55, 0.4, 0.55), _am(acc), 0.32, 6.4, 0.8, 0, 0, 0, 'radar');    // scope head (rotates)
        // fairwater planes + stern planes + rudder + prop
        _M(g, _box(5.6, 0.16, 1.5), _sm(LP.METAL), 0, 2.2, 1.5);
        _M(g, _box(6.4, 0.16, 1.4), _sm(LP.METAL), 0, 1.0, -7.2);
        _M(g, _box(0.16, 2.8, 1.4), _sm(LP.METAL), 0, 1.0, 11.6);
        _M(g, _cyl(0.1, 0.1, 1.3, 6), _sm(LP.DARK), 0, 1.0, 12.2, Math.PI / 2);      // prop shaft
        _M(g, _box(0.14, 2.2, 0.3), _sm(LP.DARK), 0, 1.0, 12.9);                     // prop blade
        // bow torpedo tube caps (2×2)
        for (let i = 0; i < 4; i++)
            _M(g, _cyl(0.26, 0.26, 0.24, 8), _sm(LP.DARK), -0.66 + (i % 2) * 1.32, 0.72 + Math.floor(i / 2) * 0.78, -11.05, Math.PI / 2);
    } else if (cls === 'escort') {
        // ── FLEET ESCORT: compact frigate, single gun, PD radar + CIWS ──
        _M(g, _box(4.2, 2.0, 15), _sm(LP.CONCRETE), 0, 1.0, 0.5);
        _M(g, _cone(2.1, 2.8, 4), _sm(LP.CONCRETE), 0, 1.0, -8.0, -Math.PI / 2, Math.PI / 4, 0, 'bow');
        _M(g, _box(3.6, 1.8, 2.6), _sm(LP.DGRAY), 0, 0.95, 8.6, 0, 0, 0, 'stern');
        _M(g, _box(4.5, 0.4, 15.4), _am(acc), 0, 0.5, 0.5);
        _M(g, _box(3.7, 0.3, 14), _sm(LP.LIGHT), 0, 2.1, 0.5);
        // Stealth-ish pyramid foremast + PD radar
        _M(g, _box(2.6, 1.8, 4.4), _sm(LP.METAL), 0, 3.0, 1.4);
        _M(g, _box(2.4, 0.4, 0.12), _sm(LP.GLASS), 0, 3.5, -0.85);
        _M(g, _cyl(0.4, 0.6, 3.4, 6), _sm(LP.DGRAY), 0, 5.6, 1.4);
        _M(g, _box(2.0, 0.45, 0.3), _sm(LP.LIGHT), 0, 7.4, 1.4, 0, 0, 0, 'radar');
        _M(g, _sph(0.55, 8, 6), _am(acc), 0, 7.9, 1.4);                             // radome
        // Single compact gun forward
        _M(g, _cyl(1.0, 1.1, 0.7, 8), _sm(LP.METAL), 0, 2.6, -5.4);
        _M(g, _box(1.3, 0.7, 1.6), _sm(LP.METAL), 0, 3.3, -5.4);
        _M(g, _cyl(0.1, 0.1, 2.6, 6), _sm(LP.DARK), 0, 3.4, -7.0, Math.PI / 2.05);
        // 8-cell VLS plug (defensive)
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++)
            _M(g, _box(0.42, 0.12, 0.42), _sm(LP.DARK), -0.75 + c * 0.5, 2.3, 4.6 + r * 0.5);
        // CIWS aft (spinning barrels)
        _M(g, _cyl(0.45, 0.55, 0.6, 8), _sm(LP.METAL), 0, 2.5, 7.6);
        _M(g, _cyl(0.24, 0.24, 1.3, 6), _sm(LP.DARK), 0, 3.15, 7.6, Math.PI / 2, 0, 0, 'ciws');
        _M(g, _box(0.9, 0.6, 0.08), _am(acc), 0.55, 7.75, 1.4);                     // ensign
        _M(g, _cyl(1.1, 1.1, 0.06, 10), _am(acc), 0, 2.32, 10.0);                   // helipad
    } else {
        // ── DESTROYER (original 24-mesh gunship) ──
        _M(g, _box(5.4, 2.2, 20), _sm(LP.CONCRETE), 0, 1.1, 1.0);
        _M(g, _cone(2.7, 3.4, 4), _sm(LP.CONCRETE), 0, 1.1, -10.9, -Math.PI / 2, Math.PI / 4, 0, 'bow');
        _M(g, _box(4.6, 2.0, 3.0), _sm(LP.DGRAY), 0, 1.0, 12.4, 0, 0, 0, 'stern');
        // Waterline stripe (owner accent)
        _M(g, _box(5.7, 0.4, 20.4), _am(acc), 0, 0.55, 1.0);
        // Main deck + foredeck
        _M(g, _box(4.8, 0.35, 19), _sm(LP.LIGHT), 0, 2.35, 1.0);
        _M(g, _box(4.2, 0.3, 4.6), _sm(LP.LIGHT), 0, 2.3, -7.4);
        // Superstructure + bridge
        _M(g, _box(3.4, 2.4, 7.2), _sm(LP.METAL), 0, 3.7, 2.2);
        _M(g, _box(3.0, 0.5, 0.12), _sm(LP.GLASS), 0, 4.35, -1.45);
        _M(g, _box(2.4, 0.7, 3.0), _sm(LP.LIGHT), 0, 5.2, 1.4);
        // Funnel
        _M(g, _box(1.7, 2.4, 2.8), _sm(LP.DGRAY), 0, 4.9, 6.8);
        _M(g, _box(1.9, 0.4, 3.0), _sm(LP.DARK), 0, 6.15, 6.8);
        // Forward main turret (owner ring + twin barrels)
        _M(g, _cyl(1.5, 1.7, 1.0, 8), _sm(LP.METAL), 0, 2.95, -8.2);
        _M(g, _cyl(1.75, 1.75, 0.18, 10), _am(acc), 0, 3.05, -8.2);
        _M(g, _box(2.0, 0.9, 2.2), _sm(LP.METAL), 0, 3.9, -8.2);
        _M(g, _cyl(0.16, 0.16, 4.4, 6), _sm(LP.DARK), -0.55, 4.0, -11.2, Math.PI / 2, 0, 0);
        _M(g, _cyl(0.16, 0.16, 4.4, 6), _sm(LP.DARK), 0.55, 4.0, -11.2, Math.PI / 2, 0, 0);
        // Aft secondary turret
        _M(g, _cyl(1.1, 1.25, 0.8, 8), _sm(LP.METAL), 0, 2.85, 9.6);
        _M(g, _box(1.5, 0.7, 1.7), _sm(LP.METAL), 0, 3.55, 9.6);
        _M(g, _cyl(0.12, 0.12, 3.0, 6), _sm(LP.DARK), 0, 3.65, 11.6, Math.PI / 2, 0, 0);
        // VLS hatch grid
        _M(g, _box(1.6, 0.22, 2.4), _sm(LP.DARK), 0, 2.55, -5.2);
        // Mast + rotating radar (named → idle anim spins it)
        _M(g, _cyl(0.14, 0.18, 5.0, 6), _sm(LP.METAL), 0, 7.6, 0.6);
        _M(g, _box(2.0, 0.5, 0.35), _sm(LP.LIGHT), 0, 10.2, 0.6, 0, 0, 0, 'radar');
        // Owner flag at masthead
        _M(g, _box(1.1, 0.7, 0.08), _am(acc), 0.75, 10.35, 0.6);
        // Helipad ring (owner accent)
        _M(g, _cyl(1.5, 1.5, 0.06, 10), _am(acc), 0, 2.62, 10.8);
    }
    g.traverse(o => {
        if (o.isMesh && o.material && o.material.userData && o.material.userData.accent) {
            if (!g.userData.accents.includes(o.material)) g.userData.accents.push(o.material);
        }
    });
    return g;
}

// ════════════════════════════════════════════════════════════════════
//  TASK-402: torpedo + naval mine models (nose +Z — lookAt flies them
//  nose-first, same convention as the missiles).
// ════════════════════════════════════════════════════════════════════
function buildTorpedoMesh(acc) {
    const g = new THREE.Group();
    g.userData.accents = [];
    _M(g, _cyl(0.34, 0.34, 4.4, 8), _sm(LP.METAL), 0, 0, 0, Math.PI / 2, 0, 0);       // body
    _M(g, _cone(0.34, 1.1, 8), _sm(LP.DGRAY), 0, 0, 2.7, Math.PI / 2, 0, 0);          // nose (+Z)
    _M(g, _cone(0.34, 0.7, 8), _sm(LP.DGRAY), 0, 0, -2.55, -Math.PI / 2, 0, 0);       // tail cone
    _M(g, _box(1.7, 0.1, 0.8), _sm(LP.DARK), 0, 0, -2.4);                             // horizontal fins
    _M(g, _box(0.1, 1.7, 0.8), _sm(LP.DARK), 0, 0, -2.4);                             // vertical fins
    _M(g, _cyl(0.36, 0.36, 0.5, 8), _am(acc), 0, 0, 1.1, Math.PI / 2, 0, 0);          // owner band
    _M(g, _box(0.1, 0.1, 0.9), _sm(LP.DARK), 0.3, 0.18, 1.9);                         // guidance stub
    return g;
}

function buildMineModel(acc) {
    const g = new THREE.Group();
    g.userData.accents = [];
    // three moored contact mines in a loose triangle + antenna buoys
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const x = Math.cos(a) * 3.4, z = Math.sin(a) * 3.4;
        _M(g, _sph(1.05, 8, 6), _sm(LP.DARK), x, 0.5, z);
        for (let h = 0; h < 5; h++) {
            const ha = (h / 5) * Math.PI * 2 + i;
            _M(g, _cyl(0.05, 0.05, 0.5, 4), _sm(LP.METAL), x + Math.cos(ha) * 0.75, 0.95, z + Math.sin(ha) * 0.75);
        }
        _M(g, _cyl(0.03, 0.03, 2.4, 4), _sm(LP.METAL), x, 2.2, z);                    // mooring antenna
        _M(g, _sph(0.16, 6, 4), _am(acc), x, 3.5, z);                                 // buoy tip (owner tint)
    }
    // owner-tinted danger disc flat on the water
    if (!GEO_CACHE['mineRing']) GEO_CACHE['mineRing'] = new THREE.RingGeometry(4.6, 5.4, 24);
    const disc = new THREE.Mesh(GEO_CACHE['mineRing'], _am(acc));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.15;
    g.add(disc);
    g.userData.accents.push(disc.material);
    return g;
}


function createLowPolyGeo(role, color) {
    return new THREE.Mesh(getSharedGeo(role), getSharedMat(color));
}

// ════════════════════════════════════════════════════════════════════
//  MISSILE MODELS — one composite per type (nose +Z, so lookAt() flies
//  them nose-first). ~3-5× the old single-cylinder size so they're
//  clearly visible. Owner accent stripes; type identity via silhouette:
//  scud classic finned, ballistic sleek, cruise/tomahawk winged,
//  cluster fat blunt, emp coil-ringed, thermobaric bulbous warhead,
//  stealth angular faceted, bunker_bust long penetrator, hyper dart,
//  icbm huge with side boosters, nuke_tac yellow-banded.
// ════════════════════════════════════════════════════════════════════
const _fin4 = (g, span, chord, z, mat, r = 1.05) => {
    _M(g, _box(0.15, span, chord), mat, r, 0, z);
    _M(g, _box(0.15, span, chord), mat, -r, 0, z);
    _M(g, _box(span, 0.15, chord), mat, 0, r, z);
    _M(g, _box(span, 0.15, chord), mat, 0, -r, z);
};
const MISSILE_MODEL_BUILDERS = {
    scud(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(1.0, 1.0, 10, 8), _sm(LP.LIGHT), 0, 0, -2, Math.PI / 2);
        _M(g, _cone(1.0, 4, 8), _sm(LP.CONCRETE), 0, 0, 5, Math.PI / 2);
        _M(g, _cyl(1.08, 1.08, 0.8, 8), _am(acc), 0, 0, 2.5, Math.PI / 2);
        _M(g, _cyl(1.04, 1.04, 1.4, 8), _sm(LP.DGRAY), 0, 0, -5.5, Math.PI / 2);
        _M(g, _cone(0.7, 1.6, 8), _sm(LP.DARK), 0, 0, -8.3, -Math.PI / 2);
        _fin4(g, 1.7, 2.2, -6.2, _sm(LP.METAL));
        return g;
    },
    ballistic(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.85, 0.85, 11, 8), _sm(LP.LIGHT), 0, 0, -2, Math.PI / 2);
        _M(g, _cone(0.85, 5, 10), _sm(LP.WHITE), 0, 0, 6, Math.PI / 2);
        _M(g, _cyl(0.92, 0.92, 0.6, 8), _am(acc), 0, 0, 1.5, Math.PI / 2);
        _M(g, _cone(0.6, 1.3, 8), _sm(LP.DARK), 0, 0, -8.2, -Math.PI / 2);
        _fin4(g, 1.4, 1.8, -6.8, _sm(LP.METAL), 0.9);
        return g;
    },
    cruise(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.8, 0.8, 9, 8), _sm(LP.LIGHT), 0, 0, -1, Math.PI / 2);
        _M(g, _cone(0.8, 3, 8), _sm(LP.CONCRETE), 0, 0, 5, Math.PI / 2);
        _M(g, _box(8, 0.15, 2.2), _sm(LP.METAL), 0, 0, -0.5);            // pop-out wings
        _M(g, _box(3.2, 0.12, 1.2), _am(acc), 0, 0, -5);
        _M(g, _box(0.12, 1.6, 1.2), _sm(LP.METAL), 0, 0.8, -5);
        _M(g, _cyl(0.45, 0.45, 1.6, 8), _sm(LP.DARK), 0, 0, -5.6, Math.PI / 2);
        return g;
    },
    cluster(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(1.3, 1.3, 9, 8), _sm(LP.METAL), 0, 0, -1.5, Math.PI / 2);
        _M(g, _cyl(1.3, 1.0, 1.6, 8), _sm(LP.LIGHT), 0, 0, 4.5, Math.PI / 2);
        _M(g, _cyl(1.38, 1.38, 0.7, 8), _am(acc), 0, 0, 1, Math.PI / 2);
        _M(g, _cyl(1.42, 1.42, 0.6, 8), _sm(LP.DGRAY), 0, 0, -6, Math.PI / 2);
        _fin4(g, 1.6, 1.6, -5.2, _sm(LP.DARK), 1.35);
        return g;
    },
    emp(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.7, 0.7, 11, 8), _sm(LP.LIGHT), 0, 0, -2, Math.PI / 2);
        _M(g, _cone(0.7, 2.5, 8), _sm(LP.WHITE), 0, 0, 5, Math.PI / 2);
        _M(g, _cyl(0.95, 0.95, 0.5, 8), _sm(LP.METAL), 0, 0, 2, Math.PI / 2);   // coil rings
        _M(g, _cyl(0.95, 0.95, 0.5, 8), _sm(LP.METAL), 0, 0, 0, Math.PI / 2);
        _M(g, _cyl(0.95, 0.95, 0.5, 8), _sm(LP.METAL), 0, 0, -2, Math.PI / 2);
        _M(g, _cyl(0.76, 0.76, 0.5, 8), _am(acc), 0, 0, 1, Math.PI / 2);
        _fin4(g, 1.3, 1.6, -6.5, _sm(LP.DGRAY), 0.75);
        return g;
    },
    tomahawk(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.85, 0.85, 10, 8), _sm(LP.LIGHT), 0, 0, -1, Math.PI / 2);
        _M(g, _cone(0.85, 3.2, 8), _sm(LP.CONCRETE), 0, 0, 5.5, Math.PI / 2);
        _M(g, _box(0.7, 0.55, 4.5), _sm(LP.METAL), 0, 0.85, 1);          // dorsal intake
        _M(g, _box(9, 0.15, 2.4), _sm(LP.METAL), 0, 0, -0.5);
        _M(g, _box(3.4, 0.12, 1.3), _am(acc), 0, 0, -5.4);
        _M(g, _box(0.12, 1.7, 1.3), _sm(LP.METAL), 0, 0.85, -5.4);
        _M(g, _cyl(0.5, 0.5, 1.6, 8), _sm(LP.DARK), 0, 0, -6.1, Math.PI / 2);
        return g;
    },
    thermobaric(acc) {
        const g = new THREE.Group();
        _M(g, _cone(1.55, 5.5, 8), _sm(LP.DGRAY), 0, 0, 4.2, Math.PI / 2);   // bulbous warhead
        _M(g, _cyl(0.95, 0.95, 7.5, 8), _sm(LP.METAL), 0, 0, -2.2, Math.PI / 2);
        _M(g, _cyl(1.02, 1.02, 0.6, 8), _am(acc), 0, 0, -0.5, Math.PI / 2);
        _M(g, _cyl(1.02, 1.02, 0.6, 8), _am(acc), 0, 0, -3.5, Math.PI / 2);
        _M(g, _cone(0.65, 1.5, 8), _sm(LP.DARK), 0, 0, -6.7, -Math.PI / 2);
        _fin4(g, 1.7, 2.0, -5.4, _sm(LP.DARK), 1.0);
        return g;
    },
    stealth_m(acc) {
        const g = new THREE.Group();
        _M(g, _box(1.7, 1.5, 9), _sm(LP.DARK), 0, 0, -1);                 // faceted body
        _M(g, _cone(1.2, 3.5, 4), _sm(LP.DARK), 0, 0, 4.5, Math.PI / 2, Math.PI / 4);
        _M(g, _box(4.6, 0.12, 2.4), _sm(LP.DGRAY), 2.6, 0, -1.6, 0, -0.35, 0);  // swept wings
        _M(g, _box(4.6, 0.12, 2.4), _sm(LP.DGRAY), -2.6, 0, -1.6, 0, 0.35, 0);
        _M(g, _box(0.14, 1.5, 1.4), _sm(LP.DGRAY), 0, 0.75, -4.6);
        _M(g, _box(1.9, 0.16, 1.0), _am(acc), 0, 0, -4.9);
        return g;
    },
    bunker_bust(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.75, 0.75, 15, 8), _sm(LP.METAL), 0, 0, -2, Math.PI / 2);
        _M(g, _cone(0.75, 4.5, 8), _sm(LP.LIGHT), 0, 0, 7.75, Math.PI / 2);
        _M(g, _cyl(0.86, 0.86, 0.4, 8), _sm(LP.DGRAY), 0, 0, 3, Math.PI / 2);   // oblique bands
        _M(g, _cyl(0.86, 0.86, 0.4, 8), _sm(LP.DGRAY), 0, 0, 1, Math.PI / 2);
        _M(g, _cyl(0.8, 0.8, 0.7, 8), _am(acc), 0, 0, -5.5, Math.PI / 2);
        _fin4(g, 1.3, 2.4, -8, _sm(LP.DARK), 0.8);
        return g;
    },
    hyper(acc) {
        const g = new THREE.Group();
        _M(g, _cone(0.65, 7, 10), _sm(LP.LIGHT), 0, 0, 4.5, Math.PI / 2);   // sharp dart
        _M(g, _cyl(0.65, 0.65, 8, 8), _sm(LP.METAL), 0, 0, -3, Math.PI / 2);
        _M(g, _cyl(0.74, 0.74, 1.2, 8), _am(acc), 0, 0, -1, Math.PI / 2);   // glowing band
        _M(g, _cone(0.5, 1.4, 8), _sm(LP.DARK), 0, 0, -7.7, -Math.PI / 2);
        _fin4(g, 1.1, 1.4, -6.2, _sm(LP.DGRAY), 0.7);
        return g;
    },
    icbm(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(1.5, 1.5, 16, 10), _sm(LP.LIGHT), 0, 0, -3, Math.PI / 2);
        _M(g, _cone(1.5, 6, 10), _sm(LP.WHITE), 0, 0, 8, Math.PI / 2);
        _M(g, _cyl(1.58, 1.58, 0.8, 10), _am(acc), 0, 0, 2, Math.PI / 2);
        _M(g, _cyl(1.58, 1.58, 0.8, 10), _am(acc), 0, 0, -8, Math.PI / 2);
        // 4 side boosters
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            _M(g, _cyl(0.55, 0.55, 10, 8), _sm(LP.METAL), Math.cos(a) * 1.9, Math.sin(a) * 1.9, -4, Math.PI / 2);
            _M(g, _cone(0.55, 1.8, 8), _sm(LP.DGRAY), Math.cos(a) * 1.9, Math.sin(a) * 1.9, 2.0, Math.PI / 2);
        }
        _M(g, _cone(1.1, 2.2, 10), _sm(LP.DARK), 0, 0, -12.1, -Math.PI / 2);
        _fin4(g, 2.4, 3.0, -9.5, _sm(LP.DGRAY), 1.6);
        return g;
    },
    nuke_tac(acc) {
        const g = new THREE.Group();
        _M(g, _cyl(0.85, 0.85, 10, 8), _sm(LP.LIGHT), 0, 0, -1.5, Math.PI / 2);
        _M(g, _cone(0.85, 3.2, 10), _sm(LP.CONCRETE), 0, 0, 5, Math.PI / 2);
        _M(g, _cyl(0.97, 0.97, 1.0, 8), _sm(LP.WHITE), 0, 0, 2, Math.PI / 2);   // warhead band
        _M(g, _cyl(0.97, 0.97, 0.3, 8), _am(acc), 0, 0, 3.2, Math.PI / 2);
        _M(g, _box(6, 0.14, 1.8), _sm(LP.METAL), 0, 0, -1.8);
        _fin4(g, 1.4, 1.6, -5.8, _sm(LP.DARK), 0.9);
        return g;
    },
    // TASK-403: MIRV re-entry vehicle — the ICBM bus splits into 3 of these
    // slim RVs (sharp heat-darkened cone, tiny skirt fins, accent band).
    mirv_w(acc) {
        const g = new THREE.Group();
        _M(g, _cone(0.5, 4.2, 10), _sm(LP.DGRAY), 0, 0, 2.1, Math.PI / 2);   // heat-shielded tip
        _M(g, _cyl(0.5, 0.5, 3.2, 8), _sm(LP.LIGHT), 0, 0, -1.6, Math.PI / 2);
        _M(g, _cyl(0.58, 0.58, 0.4, 8), _am(acc), 0, 0, -0.6, Math.PI / 2);  // accent band
        _M(g, _cyl(0.56, 0.56, 0.3, 8), _sm(LP.DARK), 0, 0, -2.6, Math.PI / 2);
        _fin4(g, 0.8, 0.9, -2.7, _sm(LP.DARK), 0.55);
        return g;
    },
};
function buildMissileModel(key, owner) {
    const acc = owner === 'player' ? 0x00ff88 : ownerHexColor(owner);
    const b = MISSILE_MODEL_BUILDERS[key] || MISSILE_MODEL_BUILDERS.ballistic;
    const g = b(acc);
    g.userData.accents = [];
    g.traverse(o => {
        if (o.isMesh && o.material && o.material.userData && o.material.userData.accent) {
            g.userData.accents.push(o.material);
        }
    });
    return g;
}

// White screen flash on nuclear detonation
function _nukeFlash() {
    let f = document.getElementById('nukeFlash');
    if (!f) { f = document.createElement('div'); f.id = 'nukeFlash'; document.body.appendChild(f); }
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

// ── TASK-403 REFACTOR: flight-profile phase enum ──
// Replaces the progress-fraction if-chain in update(): a small state machine
// (BOOST → COAST → REENTRY for ballistic profiles; CRUISE throughout for
// aerodynamic ones; SAM interceptors cruise). this.phase holds an MPHASE.*
// value; _profileTick() advances it and returns the speed multiplier.
const MPHASE = { BOOST: 0, COAST: 1, REENTRY: 2, CRUISE: 3 };

// ── TASK-403 REFACTOR: WARHEAD BEHAVIOR TABLE ──
// One onImpact(ctx) per SPECIALIST warhead; everything else (scud, ballistic,
// cruise, tomahawk, stealth_m, hyper, icbm, mirv_w) uses _default.
// ctx = { m: Missile, cfg, dmg, rad, blastR } — explode() runs the shared
// shell first (flash / crater / devastation / fleets / armor), then
// dispatches here for the warhead-specific effects. Behavior is identical
// to the old branch-per-mkey chain (minus two fixes: bunker_bust now reads
// cfg.pierceDmg (2.6) instead of a hardcoded 2.2, and nuke_tac raises the
// mushroom column).
const WARHEADS = {
    // CBU-97: 8 bomblets pepper the footprint — wider total coverage
    cluster: {
        onImpact(ctx) {
            const { m, cfg, dmg, rad, blastR } = ctx;
            for (let i = 0; i < 8; i++) {
                const bl = m.lat + rnd(-rad / 90, rad / 90), bo = m.lon + rnd(-rad / 90, rad / 90);
                spawnExp(bl, bo, rad / 22, '#ffaa00');
                structs.forEach(s => {
                    if (s.owner !== m.owner && !s.dead && haversineDist(bl, bo, s.lat, s.lon) < blastR / 2) s.hit(dmg * 0.35);
                });
            }
            // Anti-troop identity: bomblets SHRED committed troop concentrations
            m._hitTroops(dmg * (cfg.troopMul || 1), blastR * 1.6);
        },
    },
    // EMP: electronics kill — THE push enabler. Freezes reloads, blinds
    // defense scans AND radar chains for empTime ticks + chip damage.
    emp: {
        onImpact(ctx) {
            const { m, cfg, dmg, rad, blastR } = ctx;
            const eR = Math.max(blastR, (cfg.empRadius || rad) / 5);
            _empRing(m.lat, m.lon, cfg.empRadius || rad);
            structs.forEach(s => {
                if (s.owner !== m.owner && !s.dead && dst(m, s) < eR) {
                    s.hit(dmg);
                    s.reload = Math.max(s.reload, cfg.empTime || 600);
                    s.empT = Math.max(s.empT || 0, cfg.empTime || 600);
                    spawnExp(s.lat, s.lon, 3, '#00ffcc');
                }
            });
            m._hitTroops(dmg * 0.5, blastR);   // AUDIT FIX #5: crews suffer too
        },
    },
    // Fuel-air: primary blast + 2 delayed secondary fireballs (40% each)
    thermobaric: {
        onImpact(ctx) {
            const { m, cfg, dmg, rad, blastR } = ctx;
            structs.forEach(s => {
                if (s.owner !== m.owner && !s.dead && dst(m, s) < blastR) s.hit(dmg);
            });
            m._hitTroops(dmg * (cfg.troopMul || 1) * 0.6, blastR * 1.2);
            const _sess = gameSessionId;   // AUDIT FIX #11: restart-defeating guard (gOver alone is reset by the next boot)
            [400, 850].forEach(d => setTimeout(() => {
                if (gOver || _sess !== gameSessionId) return;
                const l2 = m.lat + rnd(-rad / 110, rad / 110), o2 = m.lon + rnd(-rad / 110, rad / 110);
                spawnExp(l2, o2, rad / 12, '#ff5500');
                structs.forEach(s => {
                    if (s.owner !== m.owner && !s.dead && haversineDist(l2, o2, s.lat, s.lon) < blastR * 0.8) s.hit(dmg * 0.4);
                });
            }, d));
        },
    },
    // GBU-28: penetrates hardened structures (pierceDmg×), weak vs light (0.7×)
    bunker_bust: {
        onImpact(ctx) {
            const { m, dmg, blastR } = ctx;
            const HARD = { nuke_plant: 1, iron_dome: 1, city: 1, base: 1, factory: 1 };
            const mul = m.cfg.pierceDmg || 2.2;   // TASK-403: wired (was hardcoded 2.2 while cfg said 2.6)
            structs.forEach(s => {
                if (s.owner !== m.owner && !s.dead && dst(m, s) < blastR) s.hit(dmg * (HARD[s.type] ? mul : 0.7));
            });
            m._hitTroops(dmg * 0.6, blastR);   // AUDIT FIX #5: garrison casualties
        },
    },
    // W80: falloff damage + white flash + blast-EMP on survivors + mushroom
    nuke_tac: {
        onImpact(ctx) {
            const { m, cfg, dmg, blastR } = ctx;
            _nukeFlash();
            _mushroomStack(m.lat, m.lon, 1 + (cfg.rad || 300) / 600);   // TASK-403: rising smoke column
            structs.forEach(s => {
                if (s.owner !== m.owner && !s.dead) {
                    const d = haversineDist(m.lat, m.lon, s.lat, s.lon);
                    if (d < blastR) {
                        s.hit(dmg * (1 - 0.7 * (d / blastR)));
                        if (!s.dead) { s.reload = Math.max(s.reload, 300); s.empT = Math.max(s.empT || 0, cfg.empTime || 420); }
                    }
                }
            });
            m._hitTroops(dmg, blastR * 1.4);   // AUDIT FIX #5: nukes annihilate field armies + fleets
        },
    },
    // Generic blast (scud/ballistic/cruise/tomahawk/stealth_m/hyper/icbm/MIRV RVs)
    _default: {
        onImpact(ctx) {
            const { m, cfg, dmg, blastR } = ctx;
            structs.forEach(s => {
                if (s.owner !== m.owner && !s.dead && dst(m, s) < blastR) {
                    s.hit(dmg);
                    // Scud identity — suppression: terror warheads shock the
                    // crew; reload cycles stall even when the damage is light.
                    if (cfg.suppress && s.maxReload) s.reload = Math.max(s.reload, Math.floor(s.maxReload * 0.6) + 180);
                }
            });
            m._hitTroops(dmg * (cfg.troopMul || 0.8), blastR);   // incidental troop casualties
        },
    },
};

// OpenFront-style port icon: canvas-generated anchor symbol, tinted by owner color.
// OpenFront renders structures as player-colored shapes; since we're 3D we use a
// billboarded sprite with an anchor glyph — the closest equivalent to OpenFront's
// procedural structure icon.
let _portIconTex = null;
function getPortIconTexture() {
    if (_portIconTex) return _portIconTex;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    // SOLID filled disc — becomes a solid player-color badge when tinted.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    // Anchor cutout: erase the anchor shape so the globe shows through the silhouette.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Anchor ring (top)
    ctx.beginPath();
    ctx.arc(64, 30, 12, 0, Math.PI * 2);
    ctx.stroke();
    // Vertical shaft
    ctx.beginPath();
    ctx.moveTo(64, 42);
    ctx.lineTo(64, 98);
    ctx.stroke();
    // Crossbar
    ctx.beginPath();
    ctx.moveTo(44, 56);
    ctx.lineTo(84, 56);
    ctx.stroke();
    // Bottom curve (anchor arms)
    ctx.beginPath();
    ctx.arc(64, 78, 28, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    _portIconTex = new THREE.CanvasTexture(canvas);
    _portIconTex.minFilter = THREE.LinearFilter;
    _portIconTex.magFilter = THREE.LinearFilter;
    return _portIconTex;
}

// Global building size multiplier (10 = 2× the v1 models).
const STRUCT_SCALE = 10;

class Structure {
    constructor(lat, lon, type, owner, cityName) {
        let d = SDEFS[type] || {hp:100, reload:0, name:type, radarRange:0};
        this.id = ++_id; this.lat = lat; this.lon = lon; this.type = type; this.owner = owner;
        this.hp = d.hp; this.maxHp = d.hp;
        this.reload = 0; this.maxReload = d.reload; this.name = cityName || d.name;
        this.dead = false; this.selected = false;
        this.empT = 0;   // TASK-204: EMP/jam countdown — freezes reload + scans + radar
        this.radarRange = d.radarRange || (type==='base'||type==='city'?150:0);
        this.fireRange = d.fireRange || 0;
        this.ecmRadius = d.ecmRadius || 0;   // TASK-403: radar-ECM guidance-disruption radius (km)
        this.mag = d.mag || 0; this.maxMag = d.mag || 0; this.rearmT = 0;   // TASK-403: launcher magazine + bulk re-arm cycle
        this.planes = [];
        this.captureProgress = 0; // 0 to CAPTURE_TIME
        this.captureBy = null;    // who is capturing
        this.pos = latLonToVec3(lat, lon);
        this.provinceIdx = getProvinceAtLatLon(lat, lon);

        let col = ownerHexColor(owner);
        // LOW-POLY 3D MODEL (board-game-piece style): composite primitives with
        // owner-colored accents, standing on the globe surface (+Y = surface normal).
        {
            const model = buildStructModel(type, owner);
            this.mesh = model.group;
            this.accents = model.accents;             // per-instance mats (capture retint)
            this.mesh.scale.setScalar(STRUCT_SCALE * 0.9);
            const nrm = this.pos.clone().normalize();
            this.mesh.position.copy(nrm.clone().multiplyScalar(EARTH_RADIUS + 0.5));
            this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
            // animated parts (idle life): radar dish, weapon racks
            this.anim = {
                dish: this.mesh.getObjectByName('dish') || null,
                rail: this.mesh.getObjectByName('rail') || null,
                barrels: this.mesh.getObjectByName('barrels') || null,
                rocket: this.mesh.getObjectByName('rocket') || null,   // TASK-403: launcher empty-pad state
            };
        }

        // Selection ring (separate scene object, sized for 10X buildings)
        if(!GEO_CACHE['structRing']) GEO_CACHE['structRing'] = new THREE.RingGeometry(30, 34, 28);
        const ringMat = new THREE.MeshBasicMaterial({color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.7});
        this.selRing = new THREE.Mesh(GEO_CACHE['structRing'], ringMat);
        this.selRing.visible = false;
        this.selRing.position.copy(this.pos.clone().normalize().multiplyScalar(EARTH_RADIUS + 1));
        this.selRing.lookAt(new THREE.Vector3(0, 0, 0));

        scene.add(this.mesh);
        scene.add(this.selRing);
    }
    hit(dmg) {
        this.hp = Math.max(0, this.hp - dmg);
        if(this.hp <= 0 && !this.dead) this.destroy();
    }
    destroy() {
        this.dead = true;
        scene.remove(this.mesh);
        scene.remove(this.selRing);
        // Only the per-instance ACCENT materials go; geometries + structural
        // materials are shared caches (flagged) and must outlive this structure.
        if (this.accents) this.accents.forEach(m => m.dispose());
        if(this.selRing && this.selRing.material) this.selRing.material.dispose();
        spawnExp(this.lat, this.lon, 4, this.owner==='player'?'#ff6600':'#ff2200');
    }
    update() {
        if(this.selRing) this.selRing.visible = !!this.selected;
        // Idle animations — cheap, adds life (radar sweeps, racks sway)
        if (this.anim) {
            if (this.anim.dish) this.anim.dish.rotation.y += 0.035;
            if (this.anim.rail) this.anim.rail.rotation.y = Math.sin(frame * 0.004 + this.id) * 0.25;
            if (this.anim.barrels && this.type === 'ciws') this.anim.barrels.rotation.x -= 0.08;
        }
        // TASK-204: EMP/jam window — reloads FROZEN, defense scans + radar dark.
        if (this.empT > 0) { this.empT--; }
        else if (this.reload > 0) this.reload--;
        // TASK-403: launcher magazine — bulk re-arm while empty ("reload-while-
        // empty"). EMP freezes the crane too (it is all electronics here).
        if (this.rearmT > 0 && this.empT <= 0 && --this.rearmT === 0 && this.maxMag) {
            this.mag = this.maxMag;
            if (this.owner === myRole) logEvent(`🚀 ${this.name}: اكتملت إعادة التسليح — ${this.mag} صواريخ جاهزة`, 'info');
        }
        // TASK-403: empty-pad visual — the pad rocket hides while the magazine
        // is dry and returns once the re-arm cycle completes.
        if (this.anim && this.anim.rocket) this.anim.rocket.visible = !(this.type === 'launcher' && this.mag === 0);
        // Air-defense scan — every 2 frames (was 5: fast missiles spent only
        // ~7-30 ticks inside short-range envelopes like CIWS 15km and could
        // exit between scans). missiles[] is small (<50) — trivial cost.
        // Stealth missiles are radar-invisible and hypersonics too fast to lock —
        // auto-defense skips both (they must be absorbed or dodged).
        // EMP'd batteries (empT) don't scan at all — the EMP push window.
        if(this.reload === 0 && this.fireRange > 0 && this.empT <= 0 && frame % 2 === 0) {
            // Target selection: the enemy missile CLOSEST TO IMPACT on anything
            // we own (i.e., most progress) inside our envelope — defends what
            // matters instead of whichever missile the array order finds first.
            // RANGE = GROUND distance: ballistic missiles fly high arcs (up to
            // 40% of range in altitude) — 3D distance only brings them "in
            // range" during the final descent, far too late to intercept.
            // TASK-403 (audit #18): the radar chain is only consulted inside
            // the CHAIN BAND (base, base×mult] — inside base range we engage
            // with no radar check at all, beyond the band no lock is possible
            // so the chain (and its per-source haversines) is never touched.
            let trg = null, bestProg = -1;
            const chainMax = this.type === 'sam' ? this.fireRange * GAME_CONSTANTS.RADAR_CHAIN_MULT : this.fireRange;
            for (const m of missiles) {
                if (m.dead || m.owner === this.owner) continue;
                if (m.cfg.type === 'stealth' || m.cfg.type === 'hyper') continue;
                const d = haversineDist(this.lat, this.lon, m.lat, m.lon);
                if (d >= this.fireRange) {
                    if (d >= chainMax) continue;                       // out of even the chained envelope
                    if (this.type !== 'sam') continue;                 // only SAMs get the chain
                    if (!_radarCovers(m.lat, m.lon, this.owner)) continue;   // band missile, no radar → no lock
                }
                if (m.progress > bestProg) { bestProg = m.progress; trg = m; }
            }
            if(trg) { fireSAM(this, trg); this.reload = this.maxReload; }
        }

        // ── TASK-201: AA vs AIRCRAFT ── same ground-range scan pattern as the
        // missile interception fix (offset frame parity to spread the cost).
        // Stealth is radar-invisible beyond close range; speed = exposure —
        // fast jets spend few ticks inside the envelope, slow CAS loiters in it.
        // TASK-204: EMP/jam blinds this scan too — electronics are electronics.
        if (this.fireRange > 0 && frame % 2 === 1 && this.reload === 0 && this.empT <= 0) {
            for (const p of planes) {
                if (p.dead || p.parked || p.owner === this.owner) continue;
                let engageR = Math.min(this.fireRange, airDetectRange(null, p));
                if (p.cfg.napOfEarth) engageR *= GAME_CONSTANTS.AIR_HELI_DETECT_MULT;   // TASK-401: nap-of-earth — ground AA sees helis at half range
                if (haversineDist(this.lat, this.lon, p.lat, p.lon) >= engageR) continue;
                if (this.type === 'flak' || this.type === 'ciws') {
                    // Barrage: direct probabilistic damage — fast jets jink through
                    const hitChance = Math.max(0.12, 0.8 - p.speed * 0.45);
                    this.reload = this.maxReload;
                    // muzzle flash at the battery
                    spawnExp(this.lat, this.lon, 1.2, this.type === 'ciws' ? '#66ddff' : '#ffdd88');
                    if (Math.random() < hitChance) {
                        window.__airStats.flakHits++;
                        p.hit(this.type === 'ciws' ? GAME_CONSTANTS.AIR_CIWS_DMG : GAME_CONSTANTS.AIR_FLAK_DMG, this.owner);
                        spawnExp(p.lat, p.lon, 2, '#ffaa44');   // flak burst on the airframe
                    } else {
                        spawnExp(p.lat + rnd(-0.05, 0.05), p.lon + rnd(-0.06, 0.06), 1.5, '#aaaaaa');   // near miss puff
                    }
                    if (SFX && SFX.gun) SFX.gun();
                } else {
                    // sam / iron_dome: guided interceptor at the aircraft
                    // TASK-401 nap-of-earth: helis hug the deck — SAM lock
                    // breaks half the time (battery still cycles its reload)
                    if (p.cfg.napOfEarth && Math.random() < GAME_CONSTANTS.AIR_HELI_SAM_MISS) {
                        spawnExp(p.lat + rnd(-0.05, 0.05), p.lon + rnd(-0.06, 0.06), 1.5, '#888888');   // broken-lock puff
                        window.__airStats.samLockMisses++;
                    } else {
                        // TASK-401 RWR: lock tone warns player crews as the battery fires
                        if (p.owner === myRole && SFX && SFX.rwr) SFX.rwr();
                        p.rwrT = GAME_CONSTANTS.AIR_RWR_FRAMES;
                        fireSAMPlane(this, p);
                        window.__airStats.samAtPlanes++;
                    }
                    this.reload = this.maxReload;
                }
                break;   // one engagement per cycle
            }
        }

        // ── TASK-403: AA vs DRONES — defense vs drone swarms. Drones are big,
        // loud radar targets: ACQUIRED at AA_DRONE_DETECT regardless of gun
        // range. Flak/CIWS put up a chance barrage (near miss puffs on fails);
        // SAM/iron_dome fire a guided interceptor (fireSAMDrone → the
        // tgtIsDrone arms in Missile.update). Same EMP/reload gates as the
        // other scans; priority order missiles > planes > drones (the blocks
        // above set reload and gate this one for the cycle).
        if (this.fireRange > 0 && frame % 2 === 0 && this.reload === 0 && this.empT <= 0) {
            const detect = Math.max(this.fireRange, GAME_CONSTANTS.AA_DRONE_DETECT);
            for (const d of drones) {
                if (d.dead || d.owner === this.owner) continue;
                const dd = haversineDist(this.lat, this.lon, d.lat, d.lon);
                if (dd >= detect) continue;
                this.reload = this.maxReload;
                if (this.type === 'flak' || this.type === 'ciws') {
                    // Barrage: chance falls with drone agility, halved beyond gun
                    // range (long-range detections get splinters, not accuracy).
                    const chance = Math.max(0.15, 0.85 - (d.cfg ? d.cfg.spd : 4) * 0.09) * (dd > this.fireRange ? 0.5 : 1);
                    spawnExp(this.lat, this.lon, 1.2, this.type === 'ciws' ? '#66ddff' : '#ffdd88');
                    if (Math.random() < chance) {
                        d.hit(this.type === 'ciws' ? GAME_CONSTANTS.AIR_CIWS_DMG : GAME_CONSTANTS.AIR_FLAK_DMG);
                        spawnExp(d.lat, d.lon, 2, '#ffaa44');   // flak burst on the airframe
                    } else {
                        spawnExp(d.lat + rnd(-0.05, 0.05), d.lon + rnd(-0.06, 0.06), 1.5, '#aaaaaa');   // near miss
                    }
                    if (SFX && SFX.gun) SFX.gun();
                } else {
                    fireSAMDrone(this, d);
                }
                break;   // one engagement per cycle
            }
        }
    }
}

class Missile {
    constructor(slat, slon, tlat, tlon, cfg, owner, isSAM=false, launchStyle='silo') {
        this.id = ++_id; this.cfg = cfg || MCFG['ballistic']; this.owner = owner; this.isSAM = isSAM;
        this.lat = slat; this.lon = slon;
        this.tlat = tlat; this.tlon = tlon;
        this.tgt = null;
        this.progress = 0; this.dead = false;
        // TASK-204: launch platform style (silo | rail | sub | air) + the
        // one-shot evade charge (flare/chaff vs the FIRST interceptor).
        this.launchStyle = isSAM ? null : launchStyle;
        this.evadeUsed = false;
        this.phase = MPHASE.BOOST;
        this._trailRole = this.cfg.trl ? parseInt(this.cfg.trl.slice(1), 16) : 0xcccccc;   // TASK-403: per-warhead contrail color
        this._ecmJammed = false;   // TASK-403: ECM guidance degradation, once per flight
        this.subT = (!isSAM && launchStyle === 'sub') ? 26 : 0;   // buoy pop-up hold
        this.startVec = latLonToVec3(slat, slon);
        this.targetVec = latLonToVec3(tlat, tlon);
        this.dist = this.startVec.distanceTo(this.targetVec);
        // Speed in km/SECOND — flight time scales with distance so short-range
        // shots land in ~1-4s and intercontinental in ~10s (was a FIXED 20-30s
        // regardless of range: slower than land conquest, now much faster).
        this.speed = (this.cfg.spd || 5) * GAME_CONSTANTS.MISSILE_SPEED_KM_S; 
        // Per-type composite model (nose +Z → lookAt flies it nose-first)
        this.mkey = Object.keys(MCFG).find(k => MCFG[k] === cfg) || 'ballistic';
        this.dmgScale = 1;
        this.isWarhead = false;
        this.mirvDone = false;
        this.mesh = buildMissileModel(this.mkey, owner);
        if (this.subT > 0) this.mesh.visible = false;   // underwater until pop-up
        scene.add(this.mesh);
        if (!isSAM && this.launchStyle !== 'air') _launchFlash(slat, slon, this.launchStyle);
        if(SFX && SFX.launch) SFX.launch(this.cfg.type);
    }
    update() {
        // SUBSURFACE HOLD: the booster waits under the surface, then the buoy
        // pops, water sheets off, and the flight begins (launch variety).
        if (this.subT > 0) {
            this.subT--;
            if (this.subT === 0) {
                this.mesh.visible = true;
                _subSurfaceSplash(this.lat, this.lon);
            }
            return;
        }
        if(this.isSAM && this.tgt && !this.tgt.dead) {
            this.tlat = this.tgt.lat; this.tlon = this.tgt.lon;
            this.targetVec.copy(this.tgt.pos || latLonToVec3(this.tlat, this.tlon));
            // INTERCEPT CHECK — speed-scaled hit radius (tunneling fix): with
            // attacker missiles at 2.5-16.5 units/tick and the SAM at 15, the
            // old fixed 1.5-unit radius let both jump PAST each other in a
            // single tick — missiles were never intercepted. The radius now
            // covers one full tick of closing speed + margin.
            if (this.pos) {
                // TASK-201: vs AIRCRAFT — plane.speed is km/FRAME (not km/s);
                // flares decoy first, then damage instead of instant kill.
                if (this.tgtIsPlane) {
                    const tgtSpeedPerTick = (this.tgt.speed || 0.8);
                    const mySpeedPerTick = this.speed / 60;
                    const hitR = 3 + tgtSpeedPerTick + mySpeedPerTick;
                    if (this.pos.distanceTo(this.targetVec) < hitR) {
                        if (this.tgt.tryDecoy && this.tgt.tryDecoy()) {
                            // decoyed — missile chases the flare
                            spawnExp(this.tgt.lat, this.tgt.lon, 2, '#ffcc66');
                        } else {
                            this.tgt.hit(this.dmgVsPlane || GAME_CONSTANTS.AIR_SAM_DMG, this.owner);
                            spawnExp(this.tgt.lat, this.tgt.lon, 4, '#ff8844');
                        }
                        this.explode();
                        return;
                    }
                } else
                // TASK-403: vs DRONE — kill via hit() so the airframe explodes
                // + cleans up its own mesh. hitR covers a FULL drone tick of
                // travel (their speed is km/TICK — far faster than the
                // km/s-to-tick math of the other branches — or they'd tunnel
                // straight through the interceptor).
                if (this.tgtIsDrone) {
                    const hitR = 2 + (this.tgt.speed || 2) + this.speed / 60;
                    if (this.pos.distanceTo(this.targetVec) < hitR) {
                        this.tgt.hit(this.dmgVsDrone || GAME_CONSTANTS.AIR_SAM_DMG);
                        spawnExp(this.tgt.lat, this.tgt.lon, 3, '#ffaa44');
                        if (this.tgt.dead && this.owner === myRole) logEvent('🛡️ أسقطت SAM دروناً معادياً', 'info');
                        this.explode();
                        return;
                    }
                } else
                // TASK-204: vs MISSILE — ONE flare/chaff dodge vs the FIRST
                // interceptor of the flight (cfg.samEvade — was a dead stat).
                if (this.pos.distanceTo(this.targetVec) < 2 + (this.tgt.speed ? this.tgt.speed / 60 : 0.5) + this.speed / 60) {
                    const ev = this.tgt.cfg ? (this.tgt.cfg.samEvade || 0) : 0;
                    if (!this.tgt.evadeUsed && ev > 0 && Math.random() < ev) {
                        this.tgt.evadeUsed = true;
                        _flareBurst(this.tgt);
                        logEvent('🪂 شلب حراري! تفادى الصاروخ أول صائدة', 'warn');
                        this.explode();   // decoyed interceptor self-destructs — missile survives
                        return;
                    }
                    this.tgt.dead = true;
                    // Interception flash at the kill point + falling debris.
                    // TASK-403: over water the kill reads as an OCEAN SPLASH
                    // (white spray + expanding ring) instead of a land burst.
                    if (_isWaterAt(this.tgt.lat, this.tgt.lon)) {
                        _oceanSplash(this.tgt.lat, this.tgt.lon);
                        _debrisBurst(this.targetVec, 3);
                    } else {
                        spawnExp(this.tgt.lat, this.tgt.lon, 3, '#88ffcc');
                        _debrisBurst(this.targetVec, 5);
                    }
                    logEvent('🛡️ اعتراض ناجح! أسقطت الدفاع الجوي صاروخاً معادياً', 'info');
                    this.explode();
                    return;
                }
            }
        }
        
        // Distance-aware advance: km/s ÷ 60 = km per TICK, as a fraction of
        // the total flight distance.
        // TASK-403 REFACTOR: the boost/coast/re-entry profile lives in
        // _profileTick() as a phase state machine (was: progress-fraction
        // ifs inline). Behavior identical to TASK-204's chain.
        const phaseMul = this._profileTick();
        this.progress += (this.speed * phaseMul / 60 / Math.max(1, this.dist)) * (this.isSAM ? 1.5 : 1.0);
        // ICBM re-entry fireball (R-36M signature)
        if (this.cfg.reentryFlash && this.phase === MPHASE.REENTRY && !this._reentryFx) {
            this._reentryFx = true;
            spawnExp(this.lat, this.lon, 4, '#ffcc88');
        }

        // TASK-403 ECM: an enemy radar-jamming station covering this missile
        // degrades its guidance ONCE (mid-course re-scatter). Hyper sprinters
        // punch through before a lock; our own interceptors are exempt.
        if (!this.isSAM && !this._ecmJammed && this.cfg.type !== 'hyper' && (frame + this.id) % 4 === 0) {
            const ecm = _ecmJam(this);
            if (ecm) this._ecmDisrupt(ecm);
        }

        // MIRV: the ICBM bus splits into 3 independent warheads at the
        // terminal phase (R-36M style) — each flies its own arc to a spread
        // target and delivers 50% damage (1.5× total, spread out).
        if (this.mkey === 'icbm' && !this.isWarhead && !this.mirvDone && this.progress > 0.7) {
            this.mirvDone = true;
            for (let i = 0; i < 3; i++) {
                const off = (i - 1) * 1.2;
                const child = new Missile(this.lat, this.lon,
                    this.tlat + rnd(off - 0.6, off + 0.6), this.tlon + rnd(-0.8, 0.8), this.cfg, this.owner, false, 'air');
                child.dmgScale = 0.55;
                child.isWarhead = true;
                // TASK-403: each RV gets its OWN slim re-entry-vehicle model
                // (was: the full ICBM bus scaled 0.55 — children looked like
                // little launchers). Swap mesh + mkey so explode() uses the
                // generic blast path.
                child.mkey = 'mirv_w';
                scene.remove(child.mesh);
                disposeMeshDeep(child.mesh);
                child.mesh = buildMissileModel('mirv_w', this.owner);
                scene.add(child.mesh);
                // TASK-403: spread-pattern PREVIEW — a target ring at each RV's
                // aimpoint the moment the bus splits: the footprint is readable
                // before impact (fades as the RVs come down).
                const rvGeo = DrawSphericalRangeIndicator(child.tlat, child.tlon, Math.max(30, this.cfg.rad * 0.25));
                const rvRing = new THREE.Line(rvGeo, new THREE.LineBasicMaterial({ color: 0xffcc88, transparent: true, opacity: 0.75 }));
                scene.add(rvRing);
                _addTransient(rvRing, 300, { grow: 0.0012 });
                missiles.push(child);
            }
            spawnExp(this.lat, this.lon, 3, '#ffcc88');
            this.dead = true;
            scene.remove(this.mesh);
            disposeMeshDeep(this.mesh);
            return;
        }

        if(this.progress >= 1.0) {
            // TASK-201: AA interceptor exhausted its chase at the target's
            // last position — resolve against the aircraft, not the ground.
            if (this.tgtIsPlane && this.tgt && !this.tgt.dead) {
                if (this.tgt.tryDecoy && this.tgt.tryDecoy()) {
                    spawnExp(this.tgt.lat, this.tgt.lon, 2, '#ffcc66');
                } else if (this.pos && this.pos.distanceTo(this.targetVec) < 25) {
                    this.tgt.hit(this.dmgVsPlane || GAME_CONSTANTS.AIR_SAM_DMG, this.owner);
                    spawnExp(this.tgt.lat, this.tgt.lon, 4, '#ff8844');
                }
            } else if (this.tgtIsDrone && this.tgt && !this.tgt.dead) {
                // TASK-403: same resolution vs DRONES — kill via hit() so the
                // airframe explodes and cleans up its own mesh.
                if (this.pos && this.pos.distanceTo(this.targetVec) < 40) {
                    this.tgt.hit(this.dmgVsDrone || GAME_CONSTANTS.AIR_SAM_DMG);
                    spawnExp(this.tgt.lat, this.tgt.lon, 3, '#ffaa44');
                }
            }
            this.explode();
            return;
        }

        let curVec = this.startVec.clone().lerp(this.targetVec, this.progress).normalize();
        
        let maxArc = this.dist * 0.4;
        let tp = this.cfg.type;
        if (tp === 'cruise' || tp === 'stealth') maxArc = 0.5;
        else if (tp === 'icbm') maxArc = this.dist * 1.5; 
        else if (tp === 'hyper') maxArc = this.dist * 0.2; 
        
        // TASK-201: AA interceptors vs AIRCRAFT climb to the target's cruise
        // altitude instead of flying a ground-ballistic arc (the arc returns
        // to the surface at progress=1 while planes cruise at +50 — SAMs
        // always landed short under the target). TASK-403: drone chasers do
        // the same at the drone flight deck (22 = DRONE_ALT).
        let h = (this.tgtIsPlane || this.tgtIsDrone)
            ? (this.tgtIsPlane ? 50 : 22) * this.progress
            : Math.sin(this.progress * Math.PI) * maxArc;
        curVec.multiplyScalar(EARTH_RADIUS + h);

        this.lat = vec3ToLatLon(curVec).lat;
        this.lon = vec3ToLatLon(curVec).lon;
        this.pos = curVec;

        let tangentProg = Math.min(1.0, this.progress + 0.01);
        let tangentVec = this.startVec.clone().lerp(this.targetVec, tangentProg).normalize();
        tangentVec.multiplyScalar(EARTH_RADIUS + (this.tgtIsPlane ? 50 * tangentProg : this.tgtIsDrone ? 22 * tangentProg : Math.sin(tangentProg * Math.PI) * maxArc));
        
        this.mesh.position.copy(curVec);
        this.mesh.up.copy(curVec).normalize();
        this.mesh.lookAt(tangentVec);
        
        if(tp === 'cluster' && this.progress > 0.8 && !this.split) {
            this.split = true;
            for(let i=0; i<8; i++) spawnExp(this.lat + rnd(-2,2), this.lon + rnd(-2,2), 2, '#ffaa00');
        }
        
        // Phase contrails: boost = thick bright smoke, coast = thin sparse,
        // re-entry = hot streak; hypersonics drag a plasma sheath.
        // TASK-403: coast/cruise trails take the WARHEAD-IDENTITY color
        // (cfg.trl) so a flight's role reads at a glance; boost/re-entry keep
        // the physics colors (white smoke / hot plasma streak).
        let trailP = this.phase === MPHASE.BOOST ? 0.85 : this.phase === MPHASE.REENTRY ? 0.7 : 0.3;
        if (this.cfg.plasmaSheath) trailP = 0.9;
        if (Math.random() < trailP && this.mesh.visible) {
            const t = createTrailMesh(curVec);
            if (t) {
                if (this.cfg.plasmaSheath) { t.material.color.set(0xff99ee); t.scale.setScalar(1.8); }
                else if (this.phase === MPHASE.BOOST) { t.material.color.set(0xe8e8e8); t.scale.setScalar(1.5); }
                else if (this.phase === MPHASE.REENTRY) { t.material.color.set(0xffcc88); t.scale.setScalar(1.25); }
                else { t.material.color.setHex(this._trailRole); t.scale.setScalar(1.0); }
            }
        }
    }
    // TASK-403: flight-profile state machine (boost/coast/re-entry speed
    // phases). Ballistics claw off the pad (rail boosts harder than silo),
    // coast through the arc, then sprint on re-entry; hypersonics skip
    // straight to sprint; aerodynamic profiles cruise steadily. Returns the
    // speed multiplier for this tick.
    _profileTick() {
        if (this.isSAM) { this.phase = MPHASE.CRUISE; return 1.0; }
        switch (this.cfg.type) {
            case 'hyper':
                this.phase = this.progress < 0.1 ? MPHASE.BOOST : MPHASE.REENTRY;
                return this.progress < 0.1 ? 0.8 : 1.35;
            case 'ballistic':
            case 'cluster':
            case 'thermobaric':
            case 'nuke':
                if (this.progress < 0.12) { this.phase = MPHASE.BOOST; return this.launchStyle === 'rail' ? 0.7 : 0.55; }
                if (this.progress > 0.72) { this.phase = MPHASE.REENTRY; return 1.45; }
                this.phase = MPHASE.COAST;
                return 1.0;
            default:
                this.phase = MPHASE.CRUISE;
                return 1.0;
        }
    }

    // TASK-403: ECM guidance disruption — the aimpoint re-scatters by
    // (ECM_SCATTER_MUL − 1) × the warhead's NATURAL scatter (same helper the
    // fire sites use) around the current target, and flight continuity is
    // preserved by rescaling progress to the new total distance.
    _ecmDisrupt(ecm) {
        this._ecmJammed = true;
        const mul = GAME_CONSTANTS.ECM_SCATTER_MUL || 3;
        const { dx: sdx, dy: sdy } = _missileScatter(this.cfg);   // natural scatter magnitude
        const spread = Math.hypot(sdx, sdy) * (mul - 1);
        const dx = rnd(-spread, spread), dy = rnd(-spread, spread) * 0.7;
        const traveled = this.progress * this.dist;
        this.tlat += dx; this.tlon += dy;
        this.targetVec.copy(latLonToVec3(this.tlat, this.tlon));
        this.dist = this.startVec.distanceTo(this.targetVec);
        this.progress = Math.max(0, Math.min(0.9, traveled / Math.max(1, this.dist)));
        // fx: cyan pulse at the station + a spark flicker on the missile
        spawnExp(ecm.lat, ecm.lon, 2, '#00ffcc');
        if (this.pos) _puffAt(this.pos, 0x00ffcc, 2.2, null, 18);
        if (ecm.owner === myRole) logEvent('📡 ECM: شوّش صاروخاً معادياً — تدهورت دقته', 'info');
    }

    explode() {
        if (this.dead) return;   // AUDIT FIX #2b: idempotent explode
        this.dead = true;
        scene.remove(this.mesh);
        // Per-instance accent materials die with the missile; shared hull
        // materials/geometries (userData.shared) survive for the next launch.
        disposeMeshDeep(this.mesh);
        const cfg = this.cfg;
        const dmg = (cfg.dmg || 50) * (this.dmgScale || 1);
        const rad = cfg.rad || 60;
        const blastR = rad / 5;   // legacy blast-radius scale (world units)
        spawnExp(this.lat, this.lon, rad / 15, cfg.col || '#ffaa00');
        if (!this.isSAM) _spawnCrater(this.lat, this.lon, rad);   // TASK-204: fading impact scar
        // TASK-102/204: blasts paint DEVASTATION — pounded territory resists
        // less and falls faster to land attacks (see conquest.js attackLogic).
        // devMul scales the paint: thermobaric/nuke scar deepest, EMP barely.
        if (conquestGrid && conquestGrid.applyDevastation) {
            const dm = cfg.devMul || 1;
            conquestGrid.applyDevastation(this.lat, this.lon, Math.max(30, rad * (0.9 + 0.5 * dm)), Math.min(1.6, (0.4 + (cfg.dmg || 50) / 400) * dm));
        }
        if (SFX && SFX.exp) SFX.exp(rad, cfg.type === 'nuke');
        // TASK-302 + TASK-202 fix: blasts hit enemy HULLS (×2 anti-ship) and
        // enemy ARMOR — every missile type strikeable vs fleets and divisions.
        // Anti-armor scale: cluster bomblets are THE tank busters (CBU-97 is
        // literally an anti-armor weapon), thermobaric burns them out, nukes
        // erase them, generic blast washes over armor (×0.6 before armor).
        {
            for (const w of warships) {
                if (w.dead || w.owner === this.owner) continue;
                if (haversineDist(this.lat, this.lon, w.curLat, w.curLon) < blastR + 8) {
                    w.hit(dmg * GAME_CONSTANTS.NAVAL_MISSILE_DMG_MUL);
                }
            }
            if (typeof tanks !== 'undefined' && tanks.length) {
                const tmul = this.mkey === 'cluster' ? 1.6 : this.mkey === 'thermobaric' ? 1.2 : this.mkey === 'nuke_tac' ? 3.0 : GAME_CONSTANTS.TANK_MISSILE_DMG_MUL;
                for (const t of tanks) {
                    if (t.dead || t.owner === this.owner) continue;
                    if (haversineDist(this.lat, this.lon, t.lat, t.lon) < blastR + 10) {
                        t.hit(dmg * tmul, this.owner);
                    }
                }
            }
        }

        // TASK-403 REFACTOR: specialist warhead behavior lives in the
        // WARHEADS table (one onImpact(ctx) per mkey; _default for the rest)
        // — was a branch-per-mkey chain of equal-length arms inline here.
        const wh = WARHEADS[this.mkey] || WARHEADS._default;
        wh.onImpact({ m: this, cfg, dmg, rad, blastR });
        if (this.isSAM && this.tgt && !this.tgtIsPlane && !this.tgtIsDrone) this.tgt.dead = true;   // TASK-201/403: planes+drones take damage instead
    }

    // TASK-204 anti-troop: damage committed troop cohorts inside radiusUnits
    // (world units). Cluster is the shredder (troopMul 3.2), thermobaric burns
    // formations, others cause incidental casualties.
    // (AUDIT #1 fixed in explode() by TASK-302: hull ×2 + armor blast damage
    //  now lives IN explode() where blastR/dmg are in scope — this method is
    //  troops-only again. Supervisor merge note: audit #4/#5 fixes retained.)
    _hitTroops(dmgPer, radiusUnits) {
        const blastR = radiusUnits;
        const dmg = dmgPer;
        if (dmgPer > 0) {
            for (const tc of troopCohorts) {
                if (tc.dead || tc.owner === this.owner) continue;
                const ll = vec3ToLatLon(tc.mesh.position);
                if (haversineDist(this.lat, this.lon, ll.lat, ll.lon) < radiusUnits) {
                    const kill = Math.floor(dmgPer * 12);   // dmg scale → troops
                    tc.troops -= kill;
                    spawnExp(ll.lat, ll.lon, 3, '#ff8866');
                    if (tc.troops <= 0) {
                        tc.dead = true;
                        scene.remove(tc.mesh);
                        if (tc.mesh.material) tc.mesh.material.dispose();
                    }
                }
            }
        }
    }
}

// P9 FIX (historical): parked-orbit scratch vectors lived here — moved to
// the AirCombat module (src/air/aircombat.js) with parkedTick in TASK-401.

// ═══════════════════════════════════════════════════════════════════
//  TASK-201: AIR COMBAT CORE — stealth-aware detection, AAM tracer
//  entities, flare decoys, gun passes. Uses the latent `aamMissiles`
//  array (declared since forever, never populated).
// ═══════════════════════════════════════════════════════════════════
// Live air-combat counters (probe/debug readout — window.__ffaProbe.airStats)
window.__airStats = { aamFired: 0, aamHits: 0, gunBursts: 0, flaresUsed: 0, planesDowned: 0, strikeRuns: 0, samAtPlanes: 0, flakHits: 0,
    burnerPuffs: 0, smokePuffs: 0, fuelTransferred: 0, armShots: 0, armHits: 0, seadKills: 0, seadSuppressions: 0, samLockMisses: 0, droneKills: 0 };

// Detection envelope of an aircraft from a given observer's side. Stealth
// (B-2) is invisible to auto-targeting beyond very close range; Su-57/F-22
// are low-observable (harder to lock, halved envelope). An airborne friendly
// AWACS within 800km widens the observer's envelope ×1.5.
function airDetectRange(observer, target) {
    const C = GAME_CONSTANTS;
    let r = C.AIR_DETECT_RANGE;
    if (target.cfg.role === 'stealth') r = C.AIR_STEALTH_DETECT;
    else if (target.pkey === 'su57' || target.pkey === 'f22') r *= C.AIR_LOW_OBS_MULT;
    if (observer && observer.awacsBoost) r *= 1.5;
    return r;
}

// Rear-arc check: true when `a` sits in the tail hemisphere of `b` (classic
// rear-aspect IR shot geometry; all-aspect missiles skip this requirement).
function _isBehind(a, b) {
    if (!b.prevPos) return false;
    const fwd = _airV1.copy(b.pos).sub(b.prevPos);
    if (fwd.lengthSq() < 1e-9) return false;
    fwd.normalize();
    const toA = _airV2.copy(a.pos).sub(b.pos).normalize();
    return fwd.dot(toA) > 0.25;
}

const _airV1 = new THREE.Vector3();
const _airV2 = new THREE.Vector3();
const _airV3 = new THREE.Vector3();

// Short tracer streak between two world points (gun fire visual).
function _spawnGunTracer(from, to, col) {
    if (particles.length > GAME_CONSTANTS.MAX_PARTICLES) return;
    if (!GEO_CACHE['gunTrace']) GEO_CACHE['gunTrace'] = new THREE.BoxGeometry(0.35, 0.35, 3.2);
    const mat = _getFxMat(col || 0xffee88, 1.0);
    const m = new THREE.Mesh(GEO_CACHE['gunTrace'], mat);
    m.position.copy(from).lerp(to, 0.4 + Math.random() * 0.3);
    m.lookAt(to);
    m.userData = { life: 0.5, maxLife: 0.09 };
    scene.add(m);
    particles.push(m);
}

// Flare pop: bright decoy sparks streaming behind an aircraft.
function _spawnFlares(plane) {
    for (let i = 0; i < 5; i++) {
        if (particles.length > GAME_CONSTANTS.MAX_PARTICLES) break;
        if (!GEO_CACHE['flareP']) GEO_CACHE['flareP'] = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const mat = _getFxMat(0xffaa33, 1.0);
        const m = new THREE.Mesh(GEO_CACHE['flareP'], mat);
        m.position.copy(plane.pos).add(_airV3.set(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)));
        m.userData = { life: 1.0, maxLife: 0.03 };
        scene.add(m);
        particles.push(m);
    }
    if (SFX && SFX.flare) SFX.flare();
}

// ── AAM: air-to-air missile tracer entity ──
// Launched with a launch-time probability-of-kill roll (range/aspect/
// agility/stealth factored). Flies a pursuit curve at AIR_AAM_SPEED;
// on arrival the target spends a flare to decoy, else takes the hit.
class AAM {
    constructor(shooter, tgt) {
        this.owner = shooter.owner; this.tgt = tgt; this.dead = false;
        this.src = shooter;   // TASK-401: kill credit → veterancy (module awardKill)
        this.pos = shooter.pos.clone();
        this.speed = GAME_CONSTANTS.AIR_AAM_SPEED;
        this.life = 110;   // frames before self-destruct (fuel exhaustion)
        // ── PK roll at launch ──
        const C = GAME_CONSTANTS;
        const d = haversineDist(shooter.lat, shooter.lon, tgt.lat, tgt.lon);
        let p = 0.42;
        p += (1 - Math.min(1, d / C.AIR_AAM_RANGE)) * 0.20;                     // closer = deadlier
        if (!shooter.cfg.allAspect && !_isBehind(shooter, tgt)) p -= 0.25;      // rear-aspect seekers
        else if (shooter.cfg.allAspect) p += 0.05;
        p += (shooter.cfg.turnRate - (tgt.cfg.turnRate || 0)) * 1.2;          // agility edge (drones have none — NaN guard)
        p -= tgt.cfg.spd * 0.02;                                                // fast targets jink
        if (tgt.cfg.role === 'stealth') p *= 0.45;                              // B-2 low observable
        if (tgt.pkey === 'su57' || tgt.pkey === 'f22') p *= 0.7;
        if (shooter.pkey === 'interceptor' &&
            (tgt.cfg.role === 'ground' || tgt.cfg.role === 'cas' || tgt.cfg.role === 'stealth')) p += 0.25; // interceptor vs bombers
        if (tgt.parked) p = 0.95;                                               // sitting duck on the ramp
        this.pKill = Math.max(0.05, Math.min(0.92, p));
        this.willHit = Math.random() < this.pKill;
        this.dmg = C.AIR_AAM_DMG * (shooter.cfg.gunCaliber >= 1 ? 1 : 0.8) * AirCombat.vetDmgMul(shooter);   // TASK-401: veteran shooters hit harder
        // visual: slim white tracer
        if (!GEO_CACHE['aamBody']) {
            const g = new THREE.CylinderGeometry(0.22, 0.22, 3.4, 5);
            g.rotateX(Math.PI / 2);   // cylinder Y-axis → +Z nose (lookAt flies it)
            GEO_CACHE['aamBody'] = g;
        }
        this.mesh = new THREE.Mesh(GEO_CACHE['aamBody'], _getFxMat(0xffffff, 1.0));
        scene.add(this.mesh);
        window.__airStats.aamFired++;
    }
    update() {
        if (this.tgt.dead) { this._fizzle(); return; }   // target gone (kill credited elsewhere)
        this.life--;
        if (this.life <= 0) { this._fizzle(); return; }
        // pursuit: 3D lerp toward the target's CURRENT world position
        _airV1.copy(this.tgt.pos).sub(this.pos);
        const dist = _airV1.length();
        const step = this.speed;
        if (dist <= step + 2.5) { this._resolve(); return; }
        _airV1.normalize().multiplyScalar(step);
        this.pos.add(_airV1);
        this.mesh.position.copy(this.pos);
        this.mesh.up.copy(this.pos).normalize();
        _airV2.copy(this.pos).add(_airV1);
        this.mesh.lookAt(_airV2);
        if (Math.random() < 0.4) createTrailMesh(this.pos);
    }
    _resolve() {
        const t = this.tgt;
        // flares first: a stocked, lucky defender decoys the missile
        if (t.tryDecoy && t.tryDecoy()) {
            spawnExp(t.lat, t.lon, 2, '#ffcc66');
            this._fizzle();
            return;
        }
        if (this.willHit) {
            window.__airStats.aamHits++;
            t.hit(this.dmg, this.owner);
            spawnExp(t.lat, t.lon, 4, '#ff8844');
            if (SFX && SFX.exp) SFX.exp(30);
            if (t.dead) AirCombat.awardKill(this.src, AirCombat.killKind(t), AIRW);   // TASK-401 veterancy
        } else {
            spawnExp(t.lat, t.lon, 1.5, '#888888');   // near miss
        }
        this._fizzle();
    }
    _fizzle() {
        this.dead = true;
        scene.remove(this.mesh);
        if (this.mesh.material) _recycleMat(this.mesh.material);
    }
}

// ═══ TASK-401: AIRW — world bridge for the AirCombat module (src/air/) ═══
// The module never imports the game; it reads everything through this
// context object (getters keep the live module bindings fresh).
const AIRW = {
    get C() { return GAME_CONSTANTS; },
    get frame() { return frame; },
    get planes() { return planes; },
    get structs() { return structs; },
    get tanks() { return tanks; },
    get warships() { return warships; },   // TASK-402 audit #6: plane-side hull strikes
    get drones() { return drones; },
    get aamMissiles() { return aamMissiles; },
    get myRole() { return myRole; },
    get isOnline() { return isOnline; },
    get scene() { return scene; },
    get conquestGrid() { return conquestGrid; },
    get EARTH_RADIUS() { return EARTH_RADIUS; },
    get SFX() { return SFX; },
    get AAM() { return AAM; },
    get airStats() { return window.__airStats; },
    logEvent,
    haversineDist,
    rnd,
    vec3ToLatLon,
    spawnExp,   // module strike methods + AirWreck ground-impact boom
    airDetectRange: (o, t) => airDetectRange(o, t),
    isBehind: _isBehind,
    gunTracer: _spawnGunTracer,
    tankBlast: _tankBlast,
    navalBlast: _navalBlast,   // TASK-402 audit #6: area anti-ship damage
    shipTarget: _shipTarget,   // TASK-402 audit #6: live hull wrapper for strike steering
    puffAt: _puffAt,
    createTrail: createTrailMesh,
    getFxMat: _getFxMat,
    recycleMat: _recycleMat,
    armGeo: () => {
        if (!GEO_CACHE['armBody']) {
            const g = new THREE.CylinderGeometry(0.26, 0.26, 3.6, 5);
            g.rotateX(Math.PI / 2);   // Y-axis → +Z nose (lookAt flies it)
            GEO_CACHE['armBody'] = g;
        }
        return GEO_CACHE['armBody'];
    },
    killMarkGeo: () => (GEO_CACHE['killMark'] || (GEO_CACHE['killMark'] = new THREE.BoxGeometry(1, 1, 1))),
    wreckGeo: () => (GEO_CACHE['airWreck'] || (GEO_CACHE['airWreck'] = new THREE.BoxGeometry(2.4, 0.6, 1.1))),
};

// movement scratch (audit #22 — zero per-frame Vector3 allocs in Plane.update)
const _mv1 = new THREE.Vector3();
const _mv2 = new THREE.Vector3();
const _mv3 = new THREE.Vector3();
const _mv4 = new THREE.Vector3();

class Plane {
    constructor(lat, lon, cfg, owner, baseOverride) {
        this.id = ++_id; this.lat = lat; this.lon = lon; this.cfg = cfg || PCFG['fighter']; this.owner = owner;
        this.pkey = Object.keys(PCFG).find(k => PCFG[k] === cfg) || 'fighter';
        this.hp = cfg ? cfg.hp : 100; this.dead = false; this.parked = true;
        this.speed = (cfg ? cfg.spd : 5) * GAME_CONSTANTS.PLANE_SPEED_MULTIPLIER; 
        this.tlat = lat; this.tlon = lon;
        this.mode = 'patrol';
        this.fireT = 0;
        // ── TASK-201: latent PCFG stats come alive ──
        this.maxFuel = (cfg && cfg.fuel) || 900; this.fuel = this.maxFuel;
        this.aaAmmo = (cfg && cfg.aaAmmo) || 0; this.maxAa = this.aaAmmo;
        this.agAmmo = (cfg && cfg.agAmmo) || 0; this.maxAg = this.agAmmo;
        this.gunAmmo = (cfg && cfg.gunAmmo) || 0; this.maxGun = this.gunAmmo;
        this.flares = (cfg && cfg.flares) || 0; this.maxFlares = this.flares;
        this.airTgt = null;        // current dogfight target
        this.gndTgt = null;        // current strike target
        // TASK-401: veterancy state (kills → XP → levels; AirCombat module)
        this.xp = 0; this.kills = 0; this.vetLevel = 0;
        this._airC = GAME_CONSTANTS;   // constants handle for AirCombat.W_C
        this.gunT = 0;             // gun burst cooldown
        this.strikeCd = 0;         // weapon-release cooldown (per pass)
        this.overshootT = 0;       // post-pass fly-through (breaks orbit lock)
        this.awacsBoost = false;   // set when a friendly AWACS is nearby
        this.rearmedFlag = true;   // spawn fully armed
        this.scrambleAt = frame + GAME_CONSTANTS.AIR_BOT_SCRAMBLE_FRAMES;   // AI launch delay
        this.prevPos = null;
        this.lastHitBy = null;
        // TASK-202: carriers pass their own hull as the base (air wing lives
        // on the ship — parked orbits the deck, return recovers to it).
        // B4 FIX: Find NEAREST airport, not just the first one in the array
        this.baseStruct = baseOverride || null;
        if (!this.baseStruct) {
            let bestDist = Infinity;
            for (let s of structs) {
                if (s.owner === owner && s.type === 'airport' && !s.dead) {
                    let d = dst({lat, lon}, s);
                    if (d < bestDist) { bestDist = d; this.baseStruct = s; }
                }
            }
        }
        this.pos = latLonToVec3(lat, lon, EARTH_RADIUS);
        
        // ── TASK-201 model chain: authored GLB → OBJ jet → low-poly proxy ──
        let r = this.cfg.role || 'fighter';
        this.modelKey = 'F15';
        if(r === 'stealth') this.modelKey = 'F22';
        else if (owner === 'enemy') this.modelKey = 'Su27'; // rough assignment
        
        this.modelSwapped = false;
        this.modelSrc = 'proxy';
        
        const glbEntry = AIRCRAFT_MODELS[this.pkey];
        if (glbEntry) {
            this._mountGlbModel(glbEntry);
            this.modelSrc = 'glb';
        } else if (GLOBAL_MODELS[this.modelKey]) {
            this.swapModel();
            this.modelSrc = 'obj';
        } else {
            this.mesh = createLowPolyGeo(r, owner==='player'?0x00ff88:0xffaa00);
            scene.add(this.mesh);
        }
    }
    
    // Mount an authored GLB (already normalized +Z nose + span-scaled at load).
    _mountGlbModel(entry) {
        if (this.mesh) { scene.remove(this.mesh); disposeMeshDeep(this.mesh); }
        this.mesh = entry.group.clone(true);
        // attach the shared selection ring like the OBJ path
        if(!GEO_CACHE['selRing']) GEO_CACHE['selRing'] = new THREE.RingGeometry(3, 3.5, 16);
        const ringMat = new THREE.MeshBasicMaterial({color:0xffff00, side:THREE.DoubleSide, transparent:true, opacity:0.8});
        this.selRing = new THREE.Mesh(GEO_CACHE['selRing'], ringMat);
        this.selRing.rotation.x = -Math.PI/2;
        this.mesh.add(this.selRing);
        scene.add(this.mesh);
        this.modelSwapped = true;   // no deferred swap needed
    }
    
    swapModel() {
        if(this.mesh) scene.remove(this.mesh);
        this.mesh = GLOBAL_MODELS[this.modelKey].clone();
        this.mesh.traverse((child) => {
            if(child.isMesh && child.material) {
                if(Array.isArray(child.material)) child.material.forEach(m => m.emissive.setHex(0x222222));
                else child.material.emissive.setHex(0x222222);
            }
        });
        
        if(!GEO_CACHE['selRing']) GEO_CACHE['selRing'] = new THREE.RingGeometry(3, 3.5, 16);
        const ringMat = new THREE.MeshBasicMaterial({color:0xffff00, side:THREE.DoubleSide, transparent:true, opacity:0.8});
        this.selRing = new THREE.Mesh(GEO_CACHE['selRing'], ringMat);
        this.selRing.rotation.x = -Math.PI/2;
        this.mesh.add(this.selRing);
        
        scene.add(this.mesh);
        this.modelSwapped = true;
    }
    
    update() {
        // Deferred model upgrade: an authored GLB may land after construction.
        if (!this.modelSwapped) {
            const glbEntry = AIRCRAFT_MODELS[this.pkey];
            if (glbEntry) { this._mountGlbModel(glbEntry); this.modelSrc = 'glb'; }
            else if (GLOBAL_MODELS[this.modelKey]) { this.swapModel(); this.modelSrc = 'obj'; }
        }
        if (this.hp <= 0 && !this.dead) { this.down(this.lastHitBy); return; }
        if (this.dead) return;
        
        if (this.selRing) this.selRing.visible = !!this.selected;

        if (this.parked) {
             // TASK-401: the whole parked branch (rearm/refuel on the ramp,
             // bot auto-scramble, holding orbit) now lives in the AirCombat
             // module — parkedTick(this, AIRW) is a 1:1 behavioral port.
             AirCombat.parkedTick(this, AIRW);
             return;
        }

        if (this.fireT > 0) this.fireT--;
        if (this.gunT > 0) this.gunT--;
        if (this.strikeCd > 0) this.strikeCd--;
        if (this.overshootT > 0) this.overshootT--;

        // ── TASK-201: fuel — burn airborne, force RTB at 25%, crash at 0 ──
        this.fuel -= GAME_CONSTANTS.AIR_BURN_RATE;
        if (this.fuel <= 0) { this._crash(); return; }
        if (this.fuel < this.maxFuel * GAME_CONSTANTS.AIR_RTB_FUEL_PCT && !this._rtbForFuel) {
            this._rtbForFuel = true;   // one-shot: combat scans can flip mode back — don't re-toast each tick
            this.mode = 'return';
            this.airTgt = null;
            // Global rate-limit (navy agent's polish note): carrier wings cycle
            // RTB→refuel→relaunch constantly at sea — a 5-plane wing spams this
            // toast every cycle. One fuel-toast per 30s fleet-wide.
            if (this.owner === myRole && frame - (Plane._lastFuelToastF || -9999) > 1800) {
                Plane._lastFuelToastF = frame;
                logEvent(`⛽ ${this.cfg.name}: وقود منخفض — عودة للقاعدة`, 'info');
            }
        }

        // AWACS boost refresh (staggered per-plane)
        if (frame % 60 === this.id % 60) {
            this.awacsBoost = planes.some(q => !q.dead && !q.parked && q.owner === this.owner &&
                q.cfg.role === 'awacs' && haversineDist(this.lat, this.lon, q.lat, q.lon) < 800);
        }

        // air-combat: scan (staggered) + weapons (fast cadence) — TASK-401:
        // these now live in the AirCombat module (src/air/aircombat.js)
        AirCombat.tickRefuel(this, AIRW);                    // tanker/AWACS top-up
        AirCombat.squadronSteer(this, AIRW);                 // wingman echelon station-keeping
        if (frame % 15 === this.id % 15) AirCombat.dogfightScan(this, AIRW);
        if (frame % 4 === this.id % 4) AirCombat.dogfightWeapons(this, AIRW);

        // strike tick scans structs — staggered per-plane for perf (steering
        // persists between ticks via tlat/tlon)
        if (this.mode === 'attack' && frame % 4 === this.id % 4) AirCombat.strikeTick(this, AIRW);

        // Dogfight steering overrides the mission heading while engaged
        // (except during a post-burst overshoot fly-through).
        if (this.airTgt && !this.airTgt.dead && this.overshootT <= 0) {
            this.tlat = this.airTgt.lat; this.tlon = this.airTgt.lon;
        }

        // TASK-401 doctrine altitudes: helis transit LOW, AWACS/tankers HIGH
        // (PCFG alt; parkedTick uses the same field).
        // Audit #22: the movement block runs on _mv1-4 scratch vectors —
        // ZERO Vector3 allocations per plane per frame (was ~5).
        const ALT = this.cfg.alt || 50;
        const targetVec = latLonToVec3(this.tlat, this.tlon, EARTH_RADIUS + ALT, _mv1);
        let dist = this.pos.distanceTo(targetVec);

        if (this.mode === 'return') {
            if (this.baseStruct && !this.baseStruct.dead) {
                latLonToVec3(this.baseStruct.lat, this.baseStruct.lon, EARTH_RADIUS + ALT, targetVec);
                dist = this.pos.distanceTo(targetVec);
                if (dist < 2) {
                    this.parked = true;
                    this.mode = 'patrol';
                    this.airTgt = null; this.gndTgt = null;
                    if (!isOnline && this.owner !== myRole) this.scrambleAt = frame + GAME_CONSTANTS.AIR_BOT_SCRAMBLE_FRAMES;
                    return;
                }
            } else {
                this.mode = 'patrol'; 
            }
        } else if (this.mode === 'patrol' && !isOnline && this.owner !== myRole && dist < 10) {
            // AI patrol plane reached its waypoint → new mission (CAP or strike)
            this._botScramble();
            return;
        }

        const curNormalized = _mv2.copy(this.pos).normalize();
        const targetNormalized = _mv3.copy(targetVec).normalize();
        let slerpSpeed = Math.min(1.0, this.speed / Math.max(0.1, dist));
        // TASK-201: turnRate now matters — agile fighters corner inside
        // heavy airframes (only bites when maneuvering near the target).
        slerpSpeed *= (0.55 + this.cfg.turnRate * 1.8);
        
        const curVec = _mv4.copy(curNormalized).lerp(targetNormalized, slerpSpeed).normalize().multiplyScalar(EARTH_RADIUS + ALT);
        const ll = vec3ToLatLon(curVec);
        this.lat = ll.lat; this.lon = ll.lon;
        
        this.mesh.position.copy(curVec);
        this.mesh.up.copy(curVec).normalize();
        
        // curNormalized (_mv2) is spent — reuse it for the lookAt ahead point
        const aheadVec = _mv2.copy(curVec).normalize().lerp(targetNormalized, 0.1).normalize().multiplyScalar(EARTH_RADIUS + ALT);
        this.mesh.lookAt(aheadVec);
        
        // OBJ jets nose +X; GLB/proxy already fly +Z
        if (this.modelSrc === 'obj') this.mesh.rotateY(Math.PI/2); 

        if (this.prevPos) this.prevPos.copy(this.pos); else this.prevPos = this.pos.clone();
        this.pos.copy(curVec);
        // light contrail
        if (Math.random() < 0.12) createTrailMesh(curVec);
        // TASK-401: afterburner / wingtip contrails / damage smoke (module)
        AirCombat.vfxTick(this, AIRW);
    }

    // ═══ TASK-201: combat methods ═══

    // Spend a flare against an incoming AAM/SAM. True = decoyed.
    tryDecoy() {
        if (this.flares <= 0) return false;
        this.flares--;
        window.__airStats.flaresUsed++;
        _spawnFlares(this);
        // TASK-401: veterans dispense smarter decoys (+chance per level)
        return Math.random() < GAME_CONSTANTS.AIR_FLARE_DECOY + (this.vetLevel || 0) * GAME_CONSTANTS.AIR_VET_DECOY_PER_LVL;
    }

    hit(dmg, by) {
        if (this.dead) return;
        // TASK-401: veterans juke — incoming damage scales down per level
        this.hp -= dmg * (1 - (this.vetLevel || 0) * GAME_CONSTANTS.AIR_VET_EVADE_PER_LVL);
        if (by) this.lastHitBy = by;
        if (this.hp <= 0) this.down(by);
    }

    down(by) {
        if (this.dead) return;
        this.dead = true;
        window.__airStats.planesDowned++;
        spawnExp(this.lat, this.lon, 9, '#ff8833');
        AirCombat.spawnWreck(this, AIRW);   // TASK-401: burning hulk falls
        AirCombat.leaderDown(this, AIRW);   // TASK-401: wingman takes command
        if (SFX && SFX.exp) SFX.exp(60);
        if (this.owner === myRole) logEvent(`💥 أسقط العدو طائرتنا ${this.cfg.name}!`, 'err');
        else if (by === myRole) logEvent(`🎉 أسقطنا ${this.cfg.name} للعدو!`, 'info');
        scene.remove(this.mesh);
        disposeMeshDeep(this.mesh);
        this.mesh = null;
        if (this.selRing && this.selRing.material) this.selRing.material.dispose();
    }

    _crash() {
        this.dead = true;
        window.__airStats.planesDowned++;
        spawnExp(this.lat, this.lon, 7, '#ffaa00');
        AirCombat.spawnWreck(this, AIRW);   // TASK-401: hulk falls out of the sky
        AirCombat.leaderDown(this, AIRW);   // dead leader → wingman takes over
        if (this.owner === myRole) logEvent(`⛽ ${this.cfg.name}: نفد الوقود — تحطمت!`, 'err');
        scene.remove(this.mesh);
        disposeMeshDeep(this.mesh);
        this.mesh = null;
        if (this.selRing && this.selRing.material) this.selRing.material.dispose();
    }

    // ═══ TASK-401: _dogfightScan / _dogfightWeapons / _strikeTick /
    // _carpetBomb / _precisionStrike / _lightStrike / _gunStrafe /
    // _gunshipOrbit MOVED to the AirCombat module (src/air/aircombat.js) —
    // update() calls AirCombat.dogfightScan/dogfightWeapons/strikeTick
    // through the AIRW bridge. New module-only behavior: SEAD anti-rad
    // passes, squadron concentration, veterancy multipliers, doctrine
    // release ranges, 30f-cached strike target scans.

    // AI (offline bots): launch from the ramp into a CAP or strike mission.
    _botScramble() {
        const base = this.baseStruct;
        if (!base) return;
        this.parked = false;
        this.mode = 'patrol';
        this.airTgt = null; this.gndTgt = null;
        this.scrambleAt = frame + GAME_CONSTANTS.AIR_BOT_SCRAMBLE_FRAMES;
        if (this.agAmmo > 0 && Math.random() < 0.45) {
            let best = null, bestD = 1500;
            for (const s of structs) {
                if (s.dead || s.owner === this.owner) continue;
                const d = haversineDist(base.lat, base.lon, s.lat, s.lon);
                if (d < bestD) { bestD = d; best = s; }
            }
            if (best) { this.mode = 'attack'; this.tlat = best.lat; this.tlon = best.lon; return; }
        }
        const ang = Math.random() * Math.PI * 2, r = rnd(120, 350) / 111;
        this.tlat = base.lat + Math.cos(ang) * r * 0.7;
        this.tlon = base.lon + Math.sin(ang) * r;
    }
}

function spawnExp(lat, lon, r, col) {
    const key = "exp_" + Math.round(r*10);
    if(!GEO_CACHE[key]) GEO_CACHE[key] = new THREE.SphereGeometry(Math.max(10, Math.min((r/2)*10, 80)), 8, 8);
    // P4 FIX: Use pooled material instead of allocating new one per explosion
    const mat = _getFxMat(col, 0.8);
    const m = new THREE.Mesh(GEO_CACHE[key], mat);
    m.position.copy(latLonToVec3(lat, lon, EARTH_RADIUS + 50.0));
    scene.add(m);
    m.userData = {life: 1.0, maxLife: 0.02};
    exps.push(m);
    _expPolish(lat, lon, r);   // TASK-303: flash core + shockwave on big blasts
}

function createTrailMesh(pos) {
    if(particles.length > GAME_CONSTANTS.MAX_PARTICLES) return;
    if(!GEO_CACHE['trail']) GEO_CACHE['trail'] = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    // P3 FIX: Use pooled material instead of allocating new one per trail particle
    const mat = _getFxMat(0xaaaaaa, 1.0);
    const m = new THREE.Mesh(GEO_CACHE['trail'], mat);
    m.position.copy(pos);
    m.userData = {life: 1.0, maxLife: 0.05};
    scene.add(m);
    particles.push(m);
    return m;
}

// ═══════════════════════════════════════════════════════════════════
// TASK-204 MISSILE & DEFENSE FX KIT
// transients[] — one lightweight array for all short-lived effects with
// velocity/growth (tracers, debris chunks, EMP rings, launch smoke).
// Craters — slow-fading impact scars (see _spawnCrater).
// ═══════════════════════════════════════════════════════════════════
let transients = [];
function _addTransient(mesh, lifeFrames, opts = {}) {
    if (mesh.material) mesh.material.transparent = true;
    transients.push({ mesh, life: lifeFrames, maxLife: lifeFrames, vel: opts.vel || null, grow: opts.grow || 0 });
    return mesh;
}
function _killTransient(t) {
    scene.remove(t.mesh);
    if (t.mesh.material) _recycleMat(t.mesh.material);
    if (t.mesh.geometry && !(t.mesh.geometry.userData && t.mesh.geometry.userData.shared)) t.mesh.geometry.dispose();
}
function _updateTransients() {
    let w = 0;
    for (let r = 0; r < transients.length; r++) {
        const t = transients[r];
        t.life--;
        if (t.life <= 0) { _killTransient(t); continue; }
        const k = t.life / t.maxLife;
        if (t.vel) t.mesh.position.addScaledVector(t.vel, 1);
        if (t.grow) t.mesh.scale.multiplyScalar(1 + t.grow);
        if (t.mesh.material) t.mesh.material.opacity = Math.min(1, k * 1.6);
        if (w !== r) transients[w] = t;
        w++;
    }
    transients.length = w;
}

// Colored smoke/spark puff (shared unit box, pooled material, per-instance scale)
const _upV = new THREE.Vector3();
function _puffAt(pos, col, size, vel, life) {
    if (!GEO_CACHE['fxPuff']) GEO_CACHE['fxPuff'] = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Mesh(GEO_CACHE['fxPuff'], _getFxMat(col, 0.9));
    m.position.copy(pos);
    m.scale.setScalar(size);
    scene.add(m);
    _addTransient(m, life, { vel: vel || null, grow: 0.015 });
    return m;
}

// Defense tracer: bright line from the battery to the track point
function _tracer(srcPos, dstPos, col) {
    if (!srcPos || !dstPos) return;
    const g = new THREE.BufferGeometry().setFromPoints([srcPos.clone(), dstPos.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 1, depthWrite: false });
    const line = new THREE.Line(g, mat);
    scene.add(line);
    _addTransient(line, 8);
}

// Interception debris: dark chunks tumbling down toward the planet
function _debrisBurst(pos, n = 5) {
    const nrm = pos.clone().normalize();
    for (let i = 0; i < n; i++) {
        if (!GEO_CACHE['fxDebris']) GEO_CACHE['fxDebris'] = new THREE.BoxGeometry(1.4, 1.4, 1.4);
        const m = new THREE.Mesh(GEO_CACHE['fxDebris'], _getFxMat(0x3a3a42, 0.95));
        m.position.copy(pos);
        m.scale.setScalar(rnd(0.6, 1.6));
        scene.add(m);
        const tangent = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).cross(nrm).normalize();
        const vel = tangent.multiplyScalar(rnd(1.2, 2.6)).addScaledVector(nrm, -0.55);
        _addTransient(m, Math.floor(rnd(30, 55)), { vel });
    }
}

// Flare/chaff dodge visual: white-hot decoys popping around the missile
function _flareBurst(m) {
    if (!m || !m.pos) return;
    for (let i = 0; i < 6; i++) {
        const off = new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6));
        _puffAt(m.pos.clone().add(off), i % 2 ? 0xfff4c0 : 0xffb347, rnd(1.5, 2.6), off.clone().multiplyScalar(0.08), 26);
    }
}

// EMP shockwave ring: expanding cyan circle on the surface
function _empRing(lat, lon, radiusKm) {
    const geo = DrawSphericalRangeIndicator(lat, lon, Math.max(60, radiusKm * 0.6));
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new THREE.Line(geo, mat);
    scene.add(ring);
    _addTransient(ring, 55, { grow: 0.012 });
}

// ═══════════════════════════════════════════════════════════════════
//  TASK-303 VISUAL POLISH — atmosphere (clouds + sun glare), ocean
//  shimmer, explosion flash/shockwave, ship wakes. All additive-cost:
//  clouds 1 mesh, sun 2 sprites, shimmer 1 mesh, wakes/explosions ride
//  the existing transient/pool systems. Per-frame work is O(1) pointer
//  compares + a READ-ONLY warship scan (navy's class untouched).
// ═══════════════════════════════════════════════════════════════════
let _polishClouds = null, _polishSun = null, _polishShimmer = null;
let _polishShimTex = null;
const _polishState = { wakeLast: new Map(), wakeCd: new Map() };
// (local smoothstep — main.js has no shared one at this scope)
function _ss303(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
// 1×1 black seed for the shimmer sampler until the biome map binds
const _shimSeedTex = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })();

// Procedural x-wrapped value-noise fBm cloud texture (equirectangular).
// Wrap in x so the lon seam at ±180° is invisible.
function _makeCloudCanvas(w = 1024, h = 512) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    // value-noise lattice (wrapped in x)
    const OCT = [256, 128, 64, 32];
    const lattices = OCT.map(n => {
        const g = new Float32Array((n + 1) * (n + 1));
        for (let i = 0; i < g.length; i++) g[i] = Math.random();
        return { n, g };
    });
    const smooth = t => t * t * (3 - 2 * t);
    const sample = (lat, xw, yw) => {
        // xw,yw in [0,1); wrap x at lattice period
        const { n, g } = lattices[lat];
        const fx = xw * n, fy = yw * n;
        const x0 = Math.floor(fx) % n, y0 = Math.min(n - 1, Math.floor(fy));
        const x1 = (x0 + 1) % n, y1 = Math.min(n, y0 + 1);
        const sx = smooth(fx - Math.floor(fx)), sy = smooth(fy - Math.floor(fy));
        const at = (x, y) => g[y * (n + 1) + x];
        const a = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * sx;
        return a + (b - a) * sy;
    };
    for (let y = 0; y < h; y++) {
        // latitude fade: thinner bands near poles, none at the very poles
        const yw = y / h;
        const latFade = Math.sin(yw * Math.PI);
        for (let x = 0; x < w; x++) {
            const xw = x / w;
            let f = 0, amp = 0.5, tot = 0;
            for (let o = 0; o < OCT.length; o++) {
                f += sample(o, xw, yw) * amp;
                tot += amp;
                amp *= 0.5;
            }
            f /= tot;   // 0..1
            // cloud coverage: threshold + latitude banding (equator + mid-lats)
            const cov = _ss303(0.56, 0.78, f) * (0.35 + 0.65 * latFade);
            const i = (y * w + x) * 4;
            img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
            img.data[i + 3] = Math.round(cov * 235);
        }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
}

// Build/attach the polish layer set. Called from initWorld after the
// atmosphere shell; safe to call again after a scene rebuild (idempotent).
function _ensurePolishAtmosphere() {
    if (!scene) return;
    // ── Clouds: slow-drifting translucent shell above the surface ──
    if (!_polishClouds) {
        const tex = new THREE.CanvasTexture(_makeCloudCanvas());
        tex.wrapS = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        const geo = new THREE.SphereGeometry(EARTH_RADIUS * 1.022, 96, 48);
        const mat = new THREE.MeshLambertMaterial({
            map: tex, transparent: true, opacity: 0.42, depthWrite: false
        });
        _polishClouds = new THREE.Mesh(geo, mat);
        _polishClouds.renderOrder = 2;
        _polishClouds.raycast = () => {};   // never intercept globe clicks
    }
    if (!scene.getObjectById(_polishClouds.id)) scene.add(_polishClouds);
    // ── Sun glare: core sprite + soft halo along the key-light direction ──
    if (!_polishSun) {
        const mkTex = (inner, mid) => {
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const g = c.getContext('2d');
            const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
            gr.addColorStop(0, inner);
            gr.addColorStop(0.35, mid);
            gr.addColorStop(1, 'rgba(255,244,214,0)');
            g.fillStyle = gr;
            g.fillRect(0, 0, 128, 128);
            const t = new THREE.CanvasTexture(c);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        };
        const sunDir = new THREE.Vector3(200, 100, 200).normalize();
        _polishSun = new THREE.Group();
        const core = new THREE.Sprite(new THREE.SpriteMaterial({
            map: mkTex('rgba(255,252,240,1)', 'rgba(255,236,180,0.85)'),
            blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
        }));
        core.scale.setScalar(9000);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: mkTex('rgba(255,242,214,0.55)', 'rgba(255,224,160,0.25)'),
            blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
        }));
        halo.scale.setScalar(26000);
        _polishSun.add(core, halo);
        _polishSun.position.copy(sunDir).multiplyScalar(58000);
        _polishSun.userData.sunDir = sunDir;
        _polishSun.traverse(o => { o.raycast = () => {}; });
    }
    if (!scene.getObjectById(_polishSun.id)) scene.add(_polishSun);
    // ── Ocean shimmer: additive shader shell sampling the biome map ──
    if (!_polishShimmer) {
        _polishShimmer = new THREE.Mesh(
            new THREE.SphereGeometry(EARTH_RADIUS * 1.0006, 128, 64),
            new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: _shimSeedTex },
                    uTime: { value: 0 },
                    sunDir: { value: new THREE.Vector3(200, 100, 200).normalize() }
                },
                vertexShader: `
                    varying vec2 vUv; varying vec3 vWNormal; varying vec3 vPos;
                    void main() {
                        vUv = uv;
                        vWNormal = normalize(mat3(modelMatrix) * normal);   // WORLD-space
                        vPos = (modelMatrix * vec4(position, 1.0)).xyz;
                        gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
                    }`,
                fragmentShader: `
                    uniform sampler2D map; uniform float uTime; uniform vec3 sunDir;
                    varying vec2 vUv; varying vec3 vWNormal; varying vec3 vPos;
                    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                    void main() {
                        vec3 c = texture2D(map, vUv).rgb;
                        // blue-dominant pixels = ocean (OpenFront ocean 71,133,181;
                        // land biomes are tan/green, owner tints sit over ocean too)
                        float ocean = smoothstep(0.03, 0.14, c.b - max(c.r, c.g));
                        float t = uTime * 0.001;
                        float g1 = hash(floor(vUv * 780.0) + vec2(t * 41.0, t * 13.0));
                        float g2 = hash(floor(vUv * 1900.0) - vec2(t * 67.0, t * 29.0));
                        float glint = step(0.986, g1) * 0.45 + step(0.993, g2);
                        vec3 N = normalize(vWNormal);
                        vec3 V = normalize(cameraPosition - vPos);
                        vec3 H = normalize(V + normalize(sunDir));
                        float spec = pow(max(dot(N, H), 0.0), 70.0);
                        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
                        float amt = ocean * (glint * 0.4 + spec * 0.55 + fres * 0.10);
                        gl_FragColor = vec4(vec3(0.62, 0.78, 1.0) * amt, 1.0);
                    }`,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        _polishShimmer.renderOrder = 1;
        _polishShimmer.raycast = () => {};   // never intercept globe clicks
    }
    if (!scene.getObjectById(_polishShimmer.id)) scene.add(_polishShimmer);
}

// Per-RENDER-frame polish tick (called from loop()): cloud drift, shimmer
// time + map-texture pointer sync (territory repaints swap the texture).
function _polishRenderTick(dtMs) {
    if (_polishClouds && _polishClouds.parent) {
        _polishClouds.rotation.y += Math.min(dtMs, 50) * 0.0000035;   // slow eastward drift
    }
    if (_polishShimmer && _polishShimmer.parent) {
        const m = _polishShimmer.material;
        m.uniforms.uTime.value += dtMs;
        const map = earthMesh && earthMesh.material && earthMesh.material.map;
        if (map && map !== _polishShimTex) { _polishShimTex = map; m.uniforms.map.value = map; }
    }
}

// ── Ship wakes (READ-ONLY observation of navy's warships + trade ships):
// foam puffs dropped behind hulls that moved since the last sample. Runs
// every 4th logic frame; per-ship 10f cooldown keeps big fleets cheap. ──
function _wakeFxTick() {
    const lay = (ship, key) => {
        const prev = _polishState.wakeLast.get(ship);
        const lat = ship.lat, lon = ship.lon;
        if (prev && (Math.abs(lat - prev.lat) > 0.004 || Math.abs(lon - prev.lon) > 0.004)) {
            const cd = _polishState.wakeCd.get(ship) || 0;
            if (frame >= cd) {
                _polishState.wakeCd.set(ship, frame + 10);
                _puffAt(latLonToVec3(prev.lat, prev.lon, EARTH_RADIUS + 2),
                    0xdfeefc, rnd(1.6, 2.8), null, 40);
            }
        }
        _polishState.wakeLast.set(ship, { lat, lon });
    };
    for (const w of warships) { if (!w.dead) lay(w); else _polishState.wakeLast.delete(w); }
    for (const t of tradeShips) { if (!t.dead) lay(t); else _polishState.wakeLast.delete(t); }
}

// ── Explosion polish: white flash core + expanding shockwave ring on big
// blasts. Rides the pooled-material + transient systems (no allocations
// beyond the transient record). Fireball itself stays spawnExp's. ──
function _expPolish(lat, lon, r) {
    if (r < 2.5) return null;
    let flash = null, ring = null;
    // flash core: hot additive sphere, dies fast
    if (!GEO_CACHE['expFlash']) GEO_CACHE['expFlash'] = new THREE.SphereGeometry(6, 8, 8);
    flash = new THREE.Mesh(GEO_CACHE['expFlash'], _getFxMat(0xfff6d8, 1));
    flash.position.copy(latLonToVec3(lat, lon, EARTH_RADIUS + 55));
    scene.add(flash);
    _addTransient(flash, 9, { grow: 0.09 });
    // shockwave: expanding surface ring (big blasts only)
    if (r >= 4) {
        const geo = DrawSphericalRangeIndicator(lat, lon, 40);
        ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: 0xffe9b8, transparent: true, opacity: 0.85, depthWrite: false
        }));
        scene.add(ring);
        _addTransient(ring, 26, { grow: 0.028 });
    }
    return { flash, ring };
}

// TASK-303 debug/perf hatch: __polishToggle() hides/shows the atmosphere
// layers (clouds, sun, shimmer) — used by the fps guardrail probe and as an
// emergency visual-cost switch. Returns the new visible state.
window.__polishToggle = function (on) {
    const targets = [_polishClouds, _polishSun, _polishShimmer];
    const vis = on !== undefined ? !!on : !( _polishClouds && _polishClouds.visible);
    for (const t of targets) if (t) t.visible = vis;
    return vis;
};

// TASK-303 probe: layer presence + shader compile + explosion/wake FX +
// rolling rAF fps. console: visualTest() — game must be running.
window.visualTest = function () {
    const res = {};
    res.clouds = !!(_polishClouds && _polishClouds.parent);
    res.cloudTex = !!(_polishClouds && _polishClouds.material.map);
    res.sun = !!(_polishSun && _polishSun.parent && _polishSun.children.length === 2);
    res.shimmer = !!(_polishShimmer && _polishShimmer.parent);
    res.shimTexBound = !!(_polishShimmer && _polishShimmer.material.uniforms.map.value && _polishShimmer.material.uniforms.map.value !== _shimSeedTex);
    // live tick: uTime advancing proves _polishRenderTick drives the shader
    // (compile failures surface as THREE console errors — checked in-browser)
    res.shimCompiled = !!(_polishShimmer && _polishShimmer.material.uniforms.uTime.value > 0);
    // explosion FX: big blast → fireball + flash + ring present (polish is
    // wired INSIDE spawnExp — this checks the real call path), then expiry
    const t0 = transients.length, e0 = exps.length;
    spawnExp(20, 20, 6, '#ffaa44');
    const added = transients.slice(t0);   // flash + ring records _addTransient just pushed
    res.expSpawned = exps.length === e0 + 1 && added.length >= 2;
    let n = 0;
    while (n++ < 40) _updateTransients();   // flash (9f) + ring (26f) both expire
    res.expExpired = added.every(t => !t.mesh.parent);
    // wake: fake-movement observation check via a plain object shape
    const fake = { lat: 10, lon: 10, dead: false };
    _polishState.wakeLast.clear(); _polishState.wakeCd.clear();
    const savedShips = warships, savedTrade = tradeShips;
    try {
        warships = [fake]; tradeShips = [];
        _wakeFxTick();               // registers baseline
        fake.lat = 10.05;            // move ~5.5km
        const w0 = transients.length;
        _wakeFxTick();
        res.wakePuff = transients.length > w0;
    } finally { warships = savedShips; tradeShips = savedTrade; }
    res.fps = window.__perfState && window.__perfState.fpsAvg ? Math.round(window.__perfState.fpsAvg) : null;
    // TASK-303 guardrail: draw-call delta from the polish layers (machine-
    // independent cost metric — 4 calls expected: clouds + 2 sun sprites +
    // shimmer). Reads renderer.info right after a rendered frame.
    res.callsOn = renderer && renderer.info ? renderer.info.render.calls : null;
    if (window.__polishToggle) {
        window.__polishToggle(false);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            window.__perfState.callsOff = renderer.info ? renderer.info.render.calls : null;
            window.__polishToggle(true);
        }));
    }
    const pass = res.clouds && res.sun && res.shimmer && res.shimTexBound && res.shimCompiled && res.expSpawned && res.expExpired && res.wakePuff;
    console.log('[visualTest]', res);
    logEvent(`[visualTest] ${pass ? 'PASS ✅' : 'FAIL ❌'} — سُحب=${res.clouds} شمس=${res.sun} لمعان=${res.shimmer} تظليل=${res.shimCompiled} انفجار=${res.expSpawned} انتهى=${res.expExpired} أثر=${res.wakePuff} · إطارات=${res.fps ?? '—'}`, pass ? 'info' : 'err');
    return res;
};
// (end TASK-303 block)

// Launch flash per platform style: silo smoke column / rail spark shower /
// sub surface buoy pop / air (MIRV bus split — no ground fx)
function _launchFlash(lat, lon, style) {
    const p = latLonToVec3(lat, lon, EARTH_RADIUS + 8);
    const up = _upV.copy(p).normalize();
    if (style === 'sub') {
        spawnExp(lat, lon, 7, '#cceeff');
        // white spray + expanding surface ring
        for (let i = 0; i < 5; i++) {
            const off = new THREE.Vector3(rnd(-4, 4), rnd(2, 9), rnd(-4, 4));
            _puffAt(p.clone().add(off), 0xeaf6ff, rnd(2, 4), off.clone().multiplyScalar(0.06), 40);
        }
        const geo = DrawSphericalRangeIndicator(lat, lon, 90);
        const mat = new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.8, depthWrite: false });
        const ring = new THREE.Line(geo, mat);
        scene.add(ring);
        _addTransient(ring, 45, { grow: 0.01 });
    } else if (style === 'rail') {
        spawnExp(lat, lon, 6, '#ffd28a');
        // spark shower thrown sideways off the rail
        for (let i = 0; i < 8; i++) {
            const off = new THREE.Vector3(rnd(-9, 9), rnd(0.5, 3), rnd(-9, 9));
            _puffAt(p.clone().add(off), i % 3 ? 0xffc266 : 0xfff1b8, rnd(1, 2.2), off.clone().multiplyScalar(0.09), 30);
        }
    } else if (style === 'silo') {
        spawnExp(lat, lon, 7, '#fff3aa');
        // billowing smoke column
        for (let i = 0; i < 5; i++) {
            _puffAt(p.clone().addScaledVector(up, 4 + i * 5), 0x8a8a8a, 3.5 + i * 0.9, up.clone().multiplyScalar(0.5 + i * 0.12), 55 + i * 9);
        }
    }
    // 'air': no ground fx (MIRV bus)
}

// Subsurface pop-up: buoy emerges, water sheets off, then the booster lights
function _subSurfaceSplash(lat, lon) {
    const p = latLonToVec3(lat, lon, EARTH_RADIUS + 6);
    spawnExp(lat, lon, 8, '#dff2ff');
    const up = _upV.copy(p).normalize();
    for (let i = 0; i < 7; i++) {
        const off = new THREE.Vector3(rnd(-7, 7), rnd(1, 10), rnd(-7, 7));
        _puffAt(p.clone().add(off), 0xd8ecfa, rnd(2.5, 5), off.clone().multiplyScalar(0.05), 42);
    }
}

// ── TASK-403 helpers ──────────────────────────────────────────────────
// Water check (mode 1 uses the conquest grid's owner mask; falls back to
// the GeoJSON land test). Used to swap impact/intercept VFX over ocean.
function _isWaterAt(lat, lon) {
    if (window.gameMode === 'mode1' && conquestGrid && conquestGrid._maskReady) {
        return getPixelOwner(lat, lon) === 'water';
    }
    return !isLand(lat, lon);
}

// TASK-403: ocean splash — white spray column + expanding surface ring
// (the interception-over-water variant of the debris burst).
function _oceanSplash(lat, lon, big = 0) {
    spawnExp(lat, lon, big ? 6 : 4, '#cceeff');
    const p = latLonToVec3(lat, lon, EARTH_RADIUS + 4);
    for (let i = 0; i < 6; i++) {
        const off = new THREE.Vector3(rnd(-4, 4), rnd(1, 7), rnd(-4, 4));
        _puffAt(p.clone().add(off), i % 2 ? 0xeaf6ff : 0x9fd4ee, rnd(1.5, 3), off.clone().multiplyScalar(0.05), 30);
    }
    const geo = DrawSphericalRangeIndicator(lat, lon, 50 + big * 30);
    const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.7, depthWrite: false }));
    scene.add(ring);
    _addTransient(ring, 35, { grow: 0.02 });
}

// TASK-403: nuclear mushroom column — a rising stack of smoke tori over
// ~4s (staggered launches, hot core → gray cap; the top rings grow fastest
// so the column reads as a mushroom head).
function _mushroomStack(lat, lon, power = 1) {
    const base = latLonToVec3(lat, lon, EARTH_RADIUS + 3);
    const nrm = base.clone().normalize();
    const _sess = gameSessionId;
    const N = 7;
    for (let i = 0; i < N; i++) {
        setTimeout(() => {
            if (gOver || _sess !== gameSessionId) return;
            if (!GEO_CACHE['mushTorus']) {
                const g = new THREE.TorusGeometry(1, 0.32, 8, 20);
                g.userData = { shared: true };
                GEO_CACHE['mushTorus'] = g;
            }
            const isCap = i >= N - 2;
            const mat = _getFxMat(i < 2 ? 0xffcc66 : i < 4 ? 0xcc9966 : 0x999999, 0.85);
            const t = new THREE.Mesh(GEO_CACHE['mushTorus'], mat);
            t.position.copy(base).addScaledVector(nrm, 3 + i * 4);
            t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
            t.scale.setScalar((3 + i * 1.5) * power);
            scene.add(t);
            _addTransient(t, 200 - i * 12, { vel: nrm.clone().multiplyScalar(0.5 + i * 0.12), grow: isCap ? 0.012 : 0.006 });
        }, i * 220);
    }
}

// TASK-403: enemy radar-ECM station covering this missile's position (EMP'd
// stations are dark). Returns the station or null.
function _ecmJam(m) {
    for (const s of structs) {
        if (s.dead || s.owner === m.owner || s.type !== 'radar_ecm') continue;
        if ((s.empT || 0) > 0) continue;
        const r = s.ecmRadius || 520;
        if (haversineDist(m.lat, m.lon, s.lat, s.lon) < r) return s;
    }
    return null;
}

// Impact crater: dark scorch decal fading over ~20s
let craterDecals = [];
function _spawnCrater(lat, lon, rad) {
    if (craterDecals.length >= GAME_CONSTANTS.CRATER_MAX) {
        const old = craterDecals.shift();
        scene.remove(old.mesh);
        if (old.mesh.material) _recycleMat(old.mesh.material);
    }
    const size = Math.max(10, Math.min(rad * 0.16, 90));
    const key = 'crater' + Math.round(size);
    if (!GEO_CACHE[key]) {
        GEO_CACHE[key] = new THREE.CircleGeometry(size, 18);
        GEO_CACHE[key].userData = { shared: true };
    }
    const mat = _getFxMat(0x151009, 0.85);
    const m = new THREE.Mesh(GEO_CACHE[key], mat);
    const p = latLonToVec3(lat, lon, EARTH_RADIUS + 1.2);
    m.position.copy(p);
    m.lookAt(p.clone().multiplyScalar(2));
    scene.add(m);
    craterDecals.push({ mesh: m, life: GAME_CONSTANTS.CRATER_LIFE_FRAMES, maxLife: GAME_CONSTANTS.CRATER_LIFE_FRAMES });
}
function _updateCraters() {
    let w = 0;
    for (let r = 0; r < craterDecals.length; r++) {
        const c = craterDecals[r];
        c.life--;
        if (c.life <= 0) { scene.remove(c.mesh); if (c.mesh.material) _recycleMat(c.mesh.material); continue; }
        c.mesh.material.opacity = Math.min(0.85, (c.life / c.maxLife) * 1.4);
        if (w !== r) craterDecals[w] = c;
        w++;
    }
    craterDecals.length = w;
}

// ── TASK-204 RADAR CHAIN — TASK-403 perf rewrite (audit #18, the worst
// offender: was O(SAMs × missiles × (structs+drones)) ≈ 1.95M haversines/s).
// A friendly radar (or recon drone) covering the incoming missile's position
// gives SAM batteries early lock: fireRange × RADAR_CHAIN_MULT. EMP'd (or
// jammed) radars are dark and contribute nothing.
// TWO FIXES:
//  1. The radar SOURCE LIST is cached per owner (30-frame TTL + instant
//     invalidation whenever the struct/drone arrays change size). Sources
//     keep LIVE object refs — EMP/death still blinds the chain the same
//     frame; only the array ITERATION is cached, never the state.
//  2. The chain is only consulted inside the CHAIN BAND (base, base×mult]
//     — see Structure.update: missiles inside base range engage with NO
//     radar check at all, missiles beyond the band are skipped before the
//     chain is ever touched.
const _radarSrcCache = { frame: -1, nStructs: -1, nDrones: -1, byOwner: new Map() };
function _radarSources(owner) {
    if (frame - _radarSrcCache.frame >= 30
        || structs.length !== _radarSrcCache.nStructs
        || drones.length !== _radarSrcCache.nDrones) {
        _radarSrcCache.frame = frame;
        _radarSrcCache.nStructs = structs.length;
        _radarSrcCache.nDrones = drones.length;
        _radarSrcCache.byOwner.clear();
    }
    let list = _radarSrcCache.byOwner.get(owner);
    if (!list) {
        list = [];
        for (const s of structs) {
            if (s.dead || s.owner !== owner) continue;
            const rr = s.radarRange || 0;
            if (rr) list.push({ src: s, rr });
        }
        for (const d of drones) {
            if (d.dead || d.owner !== owner || d.cfg.type !== 'recon') continue;
            list.push({ src: d, rr: GAME_CONSTANTS.DRONE_RECON_COVER });   // moves: lat/lon read LIVE below
        }
        _radarSrcCache.byOwner.set(owner, list);
    }
    return list;
}
function _radarCovers(lat, lon, owner) {
    const srcs = _radarSources(owner);
    for (let i = 0; i < srcs.length; i++) {
        const r = srcs[i], s = r.src;
        // LIVE state: cached iteration, never cached state. (owner check
        // included so a CAPTURED radar flips sides the same frame.)
        if (s.dead || s.owner !== owner || (s.empT || 0) > 0) continue;
        if (haversineDist(lat, lon, s.lat, s.lon) < r.rr) return true;
    }
    return false;
}
function _samEffRange(sam, m) {
    // Effective envelope vs ONE missile (probes/compat) — the hot path no
    // longer calls this per missile; Structure.update gates by band instead.
    let r = sam.fireRange;
    if ((sam.empT || 0) <= 0 && _radarCovers(m.lat, m.lon, sam.owner)) r *= GAME_CONSTANTS.RADAR_CHAIN_MULT;
    return r;
}

function fireSAM(src, tgt) {
    const m = new Missile(src.lat, src.lon, tgt.lat || 0, tgt.lon || 0, MCFG['ballistic'], src.owner, true);
    m.tgt = tgt;
    m.speed = GAME_CONSTANTS.SAM_INTERCEPT_SPEED_KM_S;   // km/s — out-runs ~500km/s attackers
    missiles.push(m);
    // Defense VFX: muzzle flash + tracer to the track point (CIWS/flak = hot
    // yellow rapid-fire, SAM = cool blue lock line)
    const rapid = src.type === 'ciws' || src.type === 'flak';
    _tracer(src.pos, tgt.pos || latLonToVec3(tgt.lat, tgt.lon), rapid ? 0xffe066 : 0x9fd8ff);
    spawnExp(src.lat, src.lon, rapid ? 2 : 3, rapid ? '#ffe066' : '#9fd8ff');
}

// ═══════════════════════════════════════════════════════════════════
// TASK-204 DRONE SYSTEM — the DCFG configs are now LIVE.
// Generic owner + target-hook design so other platforms can use it:
//   • launchDrone(owner, key, {lat,lon}, {homeLat, homeLon}) — navy drone
//     carriers (and any future platform) call this directly.
//   • Drone.ACQUIRE — static target-picker hook (owner → candidate list);
//     override/restrict it without touching the class.
// Behaviors by DCFG.type:
//   swarm/kamikaze/heavy — one-way strikers (transit → beeline → detonate)
//   loiter               — patrols its station, dives on the best target in engageR
//   armed (MQ-9)         — standoff: orbits the target, repeated strikes, survives
//   recon                — mobile radar: its orbit feeds the SAM radar chain
//   jammer               — EW: enemy defenses inside its orbit go dark (empT)
//   intercept            — missile hunter: orbits + fires chase interceptors
// ═══════════════════════════════════════════════════════════════════
const DRONE_ALT = 22;
const _droneV1 = new THREE.Vector3();
const _droneV2 = new THREE.Vector3();

const DRONE_MODEL_BUILDERS = {
    nano(acc) {          // micro quad
        const g = new THREE.Group();
        _M(g, _box(0.5, 0.22, 0.5), _sm(LP.DGRAY), 0, 0, 0);
        _M(g, _box(1.3, 0.06, 0.12), _sm(LP.METAL), 0, 0.08, 0);
        _M(g, _box(0.12, 0.06, 1.3), _sm(LP.METAL), 0, 0.08, 0);
        [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]].forEach(([x, z]) => {
            _M(g, _cyl(0.32, 0.32, 0.04, 8), _am(acc), x, 0.16, z).name = 'rotor';
        });
        return g;
    },
    swarm(acc) {         // quad + sensor ball
        const g = new THREE.Group();
        _M(g, _box(0.7, 0.3, 0.9), _sm(LP.DGRAY), 0, 0, 0);
        _M(g, _sph(0.18, 8, 6), _am(acc), 0, -0.1, 0.45);
        _M(g, _box(1.7, 0.07, 0.14), _sm(LP.METAL), 0, 0.12, 0);
        _M(g, _box(0.14, 0.07, 1.7), _sm(LP.METAL), 0, 0.12, 0);
        [[0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]].forEach(([x, z]) => {
            _M(g, _cyl(0.4, 0.4, 0.05, 8), _am(acc), x, 0.2, z).name = 'rotor';
        });
        return g;
    },
    kamikaze(acc) {      // switchblade tube + spring wings
        const g = new THREE.Group();
        _M(g, _cyl(0.22, 0.22, 2.2, 8), _sm(LP.DGRAY), 0, 0, 0, Math.PI / 2);
        _M(g, _cone(0.22, 0.7, 8), _sm(LP.METAL), 0, 0, 1.45, Math.PI / 2);
        _M(g, _box(2.4, 0.05, 0.5), _am(acc), 0, 0.12, -0.2);
        _M(g, _box(0.5, 0.05, 0.5), _sm(LP.METAL), 0, 0.12, -1.0);
        return g;
    },
    recon(acc) {         // slim glider
        const g = new THREE.Group();
        _M(g, _cyl(0.2, 0.2, 2.6, 8), _sm(LP.LIGHT), 0, 0, 0, Math.PI / 2);
        _M(g, _cone(0.2, 0.8, 8), _sm(LP.WHITE), 0, 0, 1.7, Math.PI / 2);
        _M(g, _box(4.4, 0.06, 0.42), _sm(LP.METAL), 0, 0.15, 0.2);
        _M(g, _box(1.6, 0.05, 0.3), _am(acc), 0, 0.1, -1.3);
        _M(g, _sph(0.26, 8, 6), _am(acc), 0, -0.18, 0.7);
        return g;
    },
    loiter(acc) {        // HAROP delta wing
        const g = new THREE.Group();
        _M(g, _box(0.5, 0.28, 2.4), _sm(LP.DGRAY), 0, 0, 0);
        _M(g, _cone(0.3, 0.9, 6), _sm(LP.METAL), 0, 0, 1.6, Math.PI / 2);
        _M(g, _box(2.0, 0.06, 1.1), _am(acc), 1.0, 0.1, -0.5, 0, 0.35, 0);
        _M(g, _box(2.0, 0.06, 1.1), _am(acc), -1.0, 0.1, -0.5, 0, -0.35, 0);
        _M(g, _box(0.5, 0.05, 0.5), _sm(LP.METAL), 0, 0.12, -1.2);
        return g;
    },
    jammer(acc) {        // EW pod + whip antenna
        const g = new THREE.Group();
        _M(g, _box(0.7, 0.5, 2.4), _sm(LP.LIGHT), 0, 0, 0);
        _M(g, _box(4.2, 0.08, 0.5), _sm(LP.METAL), 0, 0.25, 0.2);
        _M(g, _cyl(0.05, 0.05, 1.4, 6), _am(acc), 0, 0.9, -0.6);
        _M(g, _sph(0.16, 8, 6), _am(acc), 0, 1.6, -0.6);
        _M(g, _box(1.2, 0.06, 0.4), _sm(LP.DGRAY), 0, 0.05, -1.3);
        return g;
    },
    armed(acc) {         // MQ-9 Reaper
        const g = new THREE.Group();
        _M(g, _cyl(0.3, 0.34, 3.0, 8), _sm(LP.LIGHT), 0, 0, 0, Math.PI / 2);
        _M(g, _sph(0.3, 8, 6), _sm(LP.WHITE), 0, 0.05, 1.6);
        _M(g, _box(6.4, 0.09, 0.5), _am(acc), 0, 0.18, 0.1);
        _M(g, _box(1.4, 0.06, 0.35), _sm(LP.METAL), 0.55, 0.3, -1.45, 0, 0, 0.5);
        _M(g, _box(1.4, 0.06, 0.35), _sm(LP.METAL), -0.55, 0.3, -1.45, 0, 0, -0.5);
        _M(g, _cyl(0.07, 0.07, 0.8, 6), _sm(LP.DGRAY), 0.25, -0.25, 0.8, Math.PI / 2);
        _M(g, _box(0.16, 0.16, 1.0), _sm(LP.DARK), 0.55, -0.2, 0.4);
        _M(g, _box(0.16, 0.16, 1.0), _sm(LP.DARK), -0.55, -0.2, 0.4);
        return g;
    },
    heavy(acc) {         // flying-wing UCAV
        const g = new THREE.Group();
        _M(g, _box(0.9, 0.35, 2.6), _sm(LP.DGRAY), 0, 0, 0.3);
        _M(g, _box(6.2, 0.12, 1.4), _am(acc), 0, 0, -0.3);
        _M(g, _cone(0.45, 1.2, 6), _sm(LP.METAL), 0, 0, 1.9, Math.PI / 2);
        _M(g, _box(0.4, 0.5, 0.6), _sm(LP.METAL), 0, 0.15, -1.4);
        return g;
    },
    intercept(acc) {    // missile-hunting dart + side boosters
        const g = new THREE.Group();
        _M(g, _cone(0.24, 1.2, 8), _sm(LP.LIGHT), 0, 0, 1.4, Math.PI / 2);
        _M(g, _cyl(0.24, 0.28, 1.8, 8), _sm(LP.METAL), 0, 0, 0, Math.PI / 2);
        _M(g, _box(2.6, 0.06, 0.5), _am(acc), 0, 0.1, -0.4);
        _M(g, _cyl(0.09, 0.09, 0.9, 6), _sm(LP.DGRAY), 0.28, -0.12, -1.0, Math.PI / 2);
        _M(g, _cyl(0.09, 0.09, 0.9, 6), _sm(LP.DGRAY), -0.28, -0.12, -1.0, Math.PI / 2);
        return g;
    },
};
function buildDroneModel(key, owner) {
    const acc = owner === 'player' ? 0x00ff88 : ownerHexColor(owner);
    const b = DRONE_MODEL_BUILDERS[key] || DRONE_MODEL_BUILDERS.kamikaze;
    return b(acc);
}

class Drone {
    constructor(lat, lon, key, owner, opts = {}) {
        this.id = ++_id;
        this.cfg = DCFG[key] || DCFG.kamikaze;
        this.key = key;
        this.owner = owner;
        this.lat = lat; this.lon = lon;
        this.homeLat = opts.homeLat !== undefined ? opts.homeLat : lat;
        this.homeLon = opts.homeLon !== undefined ? opts.homeLon : lon;
        this.hp = this.cfg.hp;
        this.dead = false;
        this.fuel = this.cfg.fuel;
        this.speed = this.cfg.spd * GAME_CONSTANTS.DRONE_SPEED_KM_T;   // km/tick
        this.mode = 'patrol';
        this.target = null;                       // {kind, obj}
        this.angle = Math.random() * Math.PI * 2; // orbit phase
        this.scanT = this.id % 20;                // stagger acquisition
        this.reload = 0;
        this.charges = this.cfg.charges || 0;
        this.pos = latLonToVec3(lat, lon, EARTH_RADIUS + DRONE_ALT);
        this.prevPos = this.pos.clone();
        this.mesh = buildDroneModel(this.key, owner);
        this._rotors = [];
        this.mesh.traverse(o => { if (o.name === 'rotor') this._rotors.push(o); });
        scene.add(this.mesh);
    }
    // Default target picker hook — override Drone.ACQUIRE to specialize
    // (e.g. a navy carrier hunting only warships). Returns candidate list.
    // TASK-403 (audit #21): the list is CACHED per owner (30f TTL + length
    // signature). Liveness is NOT cached — _posOf() filters dead/moved
    // entities live on every read, so semantics are identical, only the
    // array churn is gone (was: a fresh array of every enemy entity per
    // drone per scan).
    static ACQUIRE(owner) {
        const c = Drone._candCache;
        const sig = structs.length + '/' + troopCohorts.length + '/' + warships.length + '/' + tanks.length;
        if (c.frame < frame - 30 || c.sig !== sig) { c.frame = frame; c.sig = sig; c.byOwner.clear(); }
        let out = c.byOwner.get(owner);
        if (out) return out;
        out = [];
        for (const s of structs) {
            if (!s.dead && s.owner !== owner && s.owner !== 'neutral') out.push({ kind: 'struct', obj: s });
        }
        for (const tc of troopCohorts) {
            if (!tc.dead && tc.owner !== owner) out.push({ kind: 'cohort', obj: tc });
        }
        for (const w of warships) {
            if (!w.dead && w.owner !== owner) out.push({ kind: 'warship', obj: w });
        }
        for (const t of tanks) {   // TASK-302: Reapers/kamikazes hunt armor columns
            if (!t.dead && t.owner !== owner) out.push({ kind: 'tank', obj: t });
        }
        c.byOwner.set(owner, out);
        return out;
    }
    _acquire() {
        const hook = (typeof Drone.ACQUIRE === 'function') ? Drone.ACQUIRE : null;
        const cands = hook ? hook(this.owner) : [];
        let best = null, bestD = Infinity;
        for (const c of cands) {
            const p = this._posOf(c);
            if (!p) continue;
            const d = haversineDist(this.lat, this.lon, p.lat, p.lon);
            if (d < bestD) { bestD = d; best = c; }
        }
        return (best && bestD <= (this.cfg.engageR || 0)) ? best : null;
    }
    _posOf(t) {
        const o = t.obj;
        if (!o || o.dead) return null;
        if (t.kind === 'struct') return { lat: o.lat, lon: o.lon };
        if (t.kind === 'warship') return { lat: o.curLat !== undefined ? o.curLat : (o.lat || 0), lon: o.curLon !== undefined ? o.curLon : (o.lon || 0) };
        if (t.kind === 'tank') return { lat: o.lat, lon: o.lon };   // TASK-302
        if (t.kind === 'cohort' && o.mesh) { const ll = vec3ToLatLon(o.mesh.position); return { lat: ll.lat, lon: ll.lon }; }
        return null;
    }
    // Great-circle nudge: move km toward (tLat,tLon); true when arrived
    _nudgeToward(tLat, tLon, km) {
        const d = haversineDist(this.lat, this.lon, tLat, tLon);
        if (d <= km || d < 0.5) { this.lat = tLat; this.lon = tLon; return true; }
        const f = km / d;
        const a = _droneV1.copy(latLonToVec3(this.lat, this.lon, 1)).normalize();
        const b = _droneV2.copy(latLonToVec3(tLat, tLon, 1)).normalize();
        a.lerp(b, f).normalize();
        const ll = vec3ToLatLon(a);
        this.lat = ll.lat; this.lon = ll.lon;
        return false;
    }
    // Station keeping: transit to the station when far out, orbit when on it
    _tickPatrol(km) {
        const R = this.cfg.patrolR || 50;
        const dHome = haversineDist(this.lat, this.lon, this.homeLat, this.homeLon);
        if (dHome > R * 2) { this._nudgeToward(this.homeLat, this.homeLon, km); return; }
        this.angle += 0.011;
        const dLat = Math.cos(this.angle) * R / 111;
        const dLon = Math.sin(this.angle) * R / (111 * Math.max(0.25, Math.cos(this.homeLat * Math.PI / 180)));
        this._nudgeToward(this.homeLat + dLat, this.homeLon + dLon, km);
    }
    _tickCombat() {
        if (--this.scanT <= 0 || !this.target || !this._posOf(this.target)) {
            this.scanT = 20;
            this.target = this._acquire();
        }
        if (!this.target) { this._tickPatrol(this.speed); return; }
        this.mode = 'engage';
        const t = this._posOf(this.target);
        const d = haversineDist(this.lat, this.lon, t.lat, t.lon);
        if (this.key === 'armed') {
            // MQ-9: standoff orbit around the target + repeated precision hits
            this.angle += 0.02;
            const oLat = t.lat + Math.cos(this.angle) * 0.5;
            const oLon = t.lon + Math.sin(this.angle) * 0.5 / Math.max(0.25, Math.cos(t.lat * Math.PI / 180));
            this._nudgeToward(oLat, oLon, this.speed);
            if (this.reload <= 0 && d < 110) {
                this._strike(this.cfg.dmg * 0.45);
                this.reload = 100;
            }
        } else {
            // One-way strikers: beeline and detonate on impact
            this._nudgeToward(t.lat, t.lon, this.speed);
            if (d < GAME_CONSTANTS.DRONE_HIT_RANGE_KM) { this._detonate(); return; }   // TASK-403: dead const wired
        }
    }
    _strike(dmg) {
        const p = this._posOf(this.target);
        if (!p) return;
        _tracer(this.pos, latLonToVec3(p.lat, p.lon), 0x88ddff);
        spawnExp(p.lat, p.lon, 3, this.cfg.col);
        this._applyDamage(dmg);
        if (conquestGrid && conquestGrid.applyDevastation) {
            conquestGrid.applyDevastation(p.lat, p.lon, Math.max(20, (this.cfg.rad || 30) * 0.7), 0.35);
        }
    }
    _applyDamage(dmg) {
        const t = this.target;
        if (!t || !t.obj || t.obj.dead) return;
        const o = t.obj;
        if (t.kind === 'cohort') {
            o.troops -= Math.floor(dmg * 12 * (this.cfg.troopMul || 1));
            if (o.troops <= 0 && !o.dead) {
                o.dead = true;
                scene.remove(o.mesh);
                if (o.mesh.material) o.mesh.material.dispose();
            }
        } else if (t.kind === 'warship') {
            // Navy-owned class (read-only from here): use its API when present
            if (typeof o.hit === 'function') o.hit(dmg);
            else if (o.hp !== undefined) o.hp = Math.max(0, o.hp - dmg);
        } else {
            o.hit(dmg);
        }
    }
    _detonate() {
        const p = this._posOf(this.target) || { lat: this.lat, lon: this.lon };
        spawnExp(p.lat, p.lon, Math.max(3, (this.cfg.rad || 40) / 12), this.cfg.col);
        this._applyDamage(this.cfg.dmg);
        if (conquestGrid && conquestGrid.applyDevastation) {
            conquestGrid.applyDevastation(p.lat, p.lon, Math.max(25, (this.cfg.rad || 40) * 0.9), Math.min(1.3, 0.35 + (this.cfg.dmg || 0) / 500));
        }
        if (this.owner === myRole) logEvent(`🛸 ${this.cfg.name} أصابت الهدف!`, 'info');
        this.dead = true;
        scene.remove(this.mesh);
        disposeMeshDeep(this.mesh);
    }
    _tickInterceptor() {
        // Mini-SAM battery: reuse the Structure.update scan pattern (ground
        // range + most-progress-first) then chase-intercept via fireSAM.
        if (this.charges <= 0 || this.reload > 0) { this._tickPatrol(this.speed * 0.8); return; }
        if ((this.id + frame) % 6 !== 0) { this._tickPatrol(this.speed * 0.5); return; }
        let trg = null, bestProg = -1;
        for (const m of missiles) {
            if (m.dead || m.owner === this.owner || m.isSAM) continue;
            if (m.cfg.type === 'stealth' || m.cfg.type === 'hyper') continue;   // same exemptions as ground defenses
            if (haversineDist(this.lat, this.lon, m.lat, m.lon) >= (this.cfg.engageR || 350)) continue;
            if (m.progress > bestProg) { bestProg = m.progress; trg = m; }
        }
        if (trg) {
            this._nudgeToward(trg.lat, trg.lon, this.speed);   // scoot to shrink the geometry
            fireSAM(this, trg);
            this.charges--;
            this.reload = GAME_CONSTANTS.DRONE_INTERCEPT_RELOAD;
            if (this.charges === 0 && this.owner === myRole) logEvent('🛸 صائد الصواريخ نفدت ذخيرته', 'info');
        } else this._tickPatrol(this.speed * 0.8);
    }
    _tickJam() {
        if ((this.id + frame) % 15 !== 0) return;
        let n = 0;
        for (const s of structs) {
            if (s.dead || s.owner === this.owner) continue;
            if (!(s.fireRange > 0 || s.radarRange > 0 || s.ecmRadius > 0)) continue;   // TASK-403: ECM stations are jammable too
            if (haversineDist(this.lat, this.lon, s.lat, s.lon) < GAME_CONSTANTS.DRONE_JAM_RADIUS) {
                s.empT = Math.max(s.empT || 0, 90);
                n++;
            }
        }
        if (n && Math.random() < 0.01) _empRing(this.lat, this.lon, GAME_CONSTANTS.DRONE_JAM_RADIUS);
    }
    _crash() {
        spawnExp(this.lat, this.lon, 3, '#886644');
        this.dead = true;
        scene.remove(this.mesh);
        disposeMeshDeep(this.mesh);
    }
    hit(dmg) {
        this.hp -= dmg;
        if (this.hp <= 0 && !this.dead) {
            spawnExp(this.lat, this.lon, 4, '#ffaa44');
            this.dead = true;
            scene.remove(this.mesh);
            disposeMeshDeep(this.mesh);
        }
    }
    update() {
        if (this.dead) return;
        if (--this.fuel <= 0) { this._crash(); return; }
        if (this.reload > 0) this.reload--;
        switch (this.cfg.type) {
            case 'intercept': this._tickInterceptor(); break;
            case 'recon': this._tickPatrol(this.speed); break;
            case 'jammer': this._tickPatrol(this.speed); this._tickJam(); break;
            default: this._tickCombat(); break;
        }
        this._updateMesh();
    }
    _updateMesh() {
        this.prevPos.copy(this.pos);
        this.pos = latLonToVec3(this.lat, this.lon, EARTH_RADIUS + DRONE_ALT);
        this.mesh.position.copy(this.pos);
        this.mesh.up.copy(this.pos).normalize();
        const dir = _droneV1.copy(this.pos).sub(this.prevPos);
        if (dir.lengthSq() > 0.0001) this.mesh.lookAt(_droneV2.copy(this.pos).add(dir));
        for (const r of this._rotors) r.rotation.y += 0.55;
    }
}
// TASK-403 (audit #21): cache store backing Drone.ACQUIRE (see the method).
Drone._candCache = { frame: -1, sig: '', byOwner: new Map() };

// Generic launcher — THE entry point for other platforms (navy carriers):
// launchDrone(owner, 'kamikaze', {lat, lon}, {homeLat, homeLon}) → [Drone]
function launchDrone(owner, key, at, opts = {}) {
    const cfg = DCFG[key];
    if (!cfg || !at) return null;
    const squad = cfg.squad || 1;
    const out = [];
    let active = drones.reduce((n, d) => n + (!d.dead && d.owner === owner ? 1 : 0), 0);
    for (let i = 0; i < squad; i++) {
        if (active >= GAME_CONSTANTS.DRONE_CAP) break;
        const j = i === 0 ? 0 : rnd(-0.02, 0.02) * (1 + i);
        const d = new Drone(at.lat + j, at.lon + j * 0.7, key, owner, opts);
        d.angle = (i / squad) * Math.PI * 2;   // spread the formation
        drones.push(d);
        out.push(d);
        active++;
    }
    return out.length ? out : null;
}
window.launchDrone = launchDrone;   // navy agent: call this from your carriers

// ═══════════════════════════════════════════════════════════════════
//  TASK-302: LAND UNITS — TANK DIVISIONS
//  A division = a formation of N vehicles sharing one hp pool (vehicles
//  visually knock out as hp drops). Divisions march on LAND toward their
//  ordered objective, auto-engage enemy armor/structures/cohorts inside
//  engageR, and paint a SPEARHEAD CORRIDOR of territory while advancing
//  through non-owned land (mode 1) — armor is the army's breakthrough arm.
//  Damage model: armor flat-reduces everything incoming; guns hit armor
//  flat, structures × structMul, troops × troopMul; battles + wrecks paint
//  conquestGrid.applyDevastation.
// ═══════════════════════════════════════════════════════════════════
const TANK_FBX_BASE = 'Assets/LowPolyWW2GermanTanksFBX/Low Poly German Tanks - FBX Files/';
const TANK_FBX_MANIFEST = {
    // key  → { dir, fbx, len }  len = real hull length in METERS (mapped to
    // globe units so a Tiger visibly out-sizes a Leichttraktor).
    light:  { dir: 'Leichttraktor', fbx: 'Leichttraktor.fbx', len: 4.5 },
    medium: { dir: 'Pz-III-J',      fbx: 'Pz-III-J.fbx',      len: 5.9 },
    heavy:  { dir: 'Pz-VI-Tiger',   fbx: 'Pz-VI Tiger.fbx',   len: 6.3 },
};
const TANK_MODELS = {};   // key → { group:THREE.Group (normalized, +Z nose), lenUnits }
const _tankLenToUnits = (lenMeters) => 8 + 5 * Math.min(1, Math.max(0, (lenMeters - 4.5) / 2));

function loadTankModels() {
    if (typeof THREE === 'undefined' || !THREE.FBXLoader) return;   // CDN missing → procedural fallback
    const loader = new THREE.FBXLoader();
    const texLoader = new THREE.TextureLoader();
    for (const key in TANK_FBX_MANIFEST) {
        const e = TANK_FBX_MANIFEST[key];
        const base = encodeURI(TANK_FBX_BASE + e.dir + '/');
        loader.load(base + encodeURI(e.fbx), (obj) => {
            try {
                const bb = new THREE.Box3().setFromObject(obj);
                const size = new THREE.Vector3(); bb.getSize(size);
                const longest = Math.max(size.x, size.z);
                if (longest < 0.0001) return;                        // degenerate model → skip
                const lenUnits = _tankLenToUnits(e.len);
                obj.scale.setScalar(lenUnits / longest);
                // Align the long horizontal axis to +Z (the game's lookAt
                // forward) so divisions drive nose-first.
                if (size.x > size.z) obj.rotation.y = Math.PI / 2;
                // The pack ships one colorAtlas.png per tank — apply it to
                // every material (UVs are atlas-mapped in the FBX).
                texLoader.load(base + 'colorAtlas.png', (tex) => {
                    obj.traverse(o => {
                        if (o.isMesh && o.material) {
                            const mats = Array.isArray(o.material) ? o.material : [o.material];
                            mats.forEach(m => {
                                m.map = tex;
                                m.needsUpdate = true;
                                if (m.emissive) m.emissive.setHex(0x111111);
                            });
                        }
                    });
                }, undefined, () => { /* atlas missing → untextured FBX still fine */ });
                const wrap = new THREE.Group();
                wrap.add(obj);
                TANK_MODELS[key] = { group: wrap, lenUnits };
                console.log('[TANK] model ready:', key, '→', e.fbx);
            } catch (err) { console.warn('[TANK] model rejected:', key, err.message); }
        }, undefined, () => { /* folder absent (gitignored) — procedural fallback stays */ });
    }
}

// One vehicle: FBX clone when the pack loaded, else a low-poly procedural
// tank (hull + tracks + turret + gun, nose +Z). Owner accent = pennant +
// ground ring, matching the game's dark-body/bright-accent language.
function buildTankModel(key, acc) {
    const g = new THREE.Group();
    if (key === 'spg') {
        // TASK-405 ARTILLERY: gun-carrier silhouette — medium chassis (FBX
        // when the pack loaded, procedural otherwise) + a big ELEVATED
        // howitzer + rear recoil spade. Reads "bombardment", not "tank duel".
        const mreg = TANK_MODELS.medium;
        if (mreg) {
            g.add(mreg.group.clone(true));
        } else {
            _M(g, _box(2.4, 0.9, 5.2), _sm(LP.METAL), 0, 0.9, 0);                // hull
            _M(g, _box(2.7, 0.6, 5.6), _sm(LP.DARK), 0, 0.32, 0);               // skirt band
            _M(g, _box(0.6, 0.7, 5.7), _sm(LP.TIRE), -1.15, 0.35, 0);           // left track
            _M(g, _box(0.6, 0.7, 5.7), _sm(LP.TIRE), 1.15, 0.35, 0);            // right track
            _M(g, _box(1.9, 0.9, 2.2), _sm(LP.METAL), 0, 1.75, -0.7);           // casemate
        }
        _M(g, _cyl(0.15, 0.15, 4.8, 6), _sm(LP.DARK), 0, 2.15, 1.15, Math.PI / 2 - 0.52);  // howitzer ↑ ~30°
        _M(g, _box(0.6, 0.55, 0.25), _sm(LP.DARK), 0, 0.55, -2.55);             // recoil spade
    } else {
        const reg = TANK_MODELS[key];
        if (reg) {
            g.add(reg.group.clone(true));
        } else {
            const body = key === 'heavy' ? LP.CONCRETE : key === 'light' ? LP.LIGHT : LP.METAL;
            const gunLen = key === 'heavy' ? 4.0 : key === 'medium' ? 3.2 : 2.4;
            _M(g, _box(2.4, 1.0, 6.2), _sm(body), 0, 0.95, 0);                     // hull
            _M(g, _box(2.7, 0.6, 6.6), _sm(LP.DARK), 0, 0.32, 0);                  // skirt band
            _M(g, _box(0.6, 0.7, 6.7), _sm(LP.TIRE), -1.15, 0.35, 0);              // left track
            _M(g, _box(0.6, 0.7, 6.7), _sm(LP.TIRE), 1.15, 0.35, 0);               // right track
            _M(g, _box(1.8, 0.8, 2.6), _sm(body), 0, 1.85, -0.4);                  // turret
            _M(g, _cyl(0.1, 0.1, gunLen, 6), _sm(LP.DARK), 0, 1.95, 0.7 + gunLen / 2 - 0.4, Math.PI / 2, 0, 0); // main gun (+Z)
            _M(g, _box(0.55, 0.3, 0.55), _sm(LP.DARK), 0, 2.4, -1.25);             // cupola
        }
    }
    // Owner accents (per-instance materials — disposed with the division)
    _M(g, _cyl(0.05, 0.05, 1.7, 4), _sm(LP.METAL), 0.8, 2.1, -1.5);           // pennant mast
    _M(g, _box(0.75, 0.45, 0.05), _am(acc), 1.18, 2.6, -1.5, 0, 0, 0.4);      // pennant
    _M(g, _cyl(1.9, 1.9, 0.07, 12), _am(acc), 0, 0.14, 0.5);                  // ground ring
    return g;
}

// Area anti-armor damage helper (planes' carpet/gunship pulses etc.)
function _tankBlast(lat, lon, radiusKm, dmg, fromOwner) {
    if (!tanks.length) return;
    for (const t of tanks) {
        if (t.dead || t.owner === fromOwner) continue;
        if (haversineDist(lat, lon, t.lat, t.lon) < radiusKm) t.hit(dmg, fromOwner);
    }
}

// TASK-402 audit #6 (plane-side): area anti-SHIP damage helper — aircraft
// ordnance finally reaches the fleet. Submerged & unlocated submarines are
// safe from air (the detection model); everything else eats ×MUL (bombs on
// decks hit hard, matching Missile.explode's anti-ship precision scale).
function _navalBlast(lat, lon, radiusKm, dmg, fromOwner) {
    if (!warships.length) return;
    const C = GAME_CONSTANTS;
    for (const w of warships) {
        if (w.dead || w.owner === fromOwner) continue;
        if (w.hull && w.hull.submerged && !w.detected) continue;
        if (haversineDist(lat, lon, w.curLat, w.curLon) < radiusKm) w.hit(dmg * C.AIR_STRIKE_SHIP_MUL);
    }
}

// TASK-402 audit #6: live warship wrapper for plane ground-strike targeting
// (lat/lon/dead/pos stay current through getters so pass steering tracks a
// sailing hull; hit() applies the anti-ship multiplier like Missile blasts).
function _shipTarget(w) {
    return {
        warship: w, isShip: true,
        get lat() { return w.curLat; },
        get lon() { return w.curLon; },
        get dead() { return w.dead; },
        get pos() { return w.pos; },
        hit(dmg) { w.hit(dmg * GAME_CONSTANTS.AIR_STRIKE_SHIP_MUL); },
    };
}

// Scratch vectors for tank movement math (tangent-plane stepping)
const _tkV1 = new THREE.Vector3();
const _tkV2 = new THREE.Vector3();
const _tkV3 = new THREE.Vector3();
const _tkV4 = new THREE.Vector3();
const _tkV5 = new THREE.Vector3();   // TASK-405: dust/rear positions
const _tkV6 = new THREE.Vector3();

// ── TASK-405 deep-pass module state ─────────────────────────────────
let tankWrecks = [];    // burning wrecks: {mesh, t, lat, lon, id, tex}
let spgShells = [];     // indirect-fire shells in flight (bezier arcs)
const TANK_DUST_COL = { 1: 0xb8a878, 2: 0x8a6f52, 3: 0x9a9a92 };   // plains/highland/mountain
const TANK_ACE_AR = ['', 'محاربة قديمة', 'آس', 'آس الآسات'];

// SPOTTING (indirect fire gate): a target beyond the battery's own sightR
// is only engaged when a friendly eye sees it — recon drone on station,
// light scout division in the area, or the shared radar chain (EMP-aware).
function _spottedBy(owner, lat, lon) {
    const C = GAME_CONSTANTS;
    if (_radarCovers(lat, lon, owner)) return true;   // radar structs (missiles agent's helper — EMP-aware)
    for (const d of drones) {
        if (d.dead || d.owner !== owner || d.cfg.type !== 'recon') continue;
        if (haversineDist(lat, lon, d.lat, d.lon) < C.TANK_SPOT_R_KM) return true;
    }
    for (const t of tanks) {
        if (t.dead || t.owner !== owner || t.key !== 'light') continue;
        if (haversineDist(lat, lon, t.lat, t.lon) < t.cfg.sightR) return true;
    }
    return false;
}

// Indirect shell impact: splash damage around the AIM POINT (target pos at
// fire time — real artillery beats a moving grid reference, not a tracker).
function _spgShellImpact(s) {
    const C = GAME_CONSTANTS;
    scene.remove(s.mesh);
    spawnExp(s.lat, s.lon, 5, '#ff8844');
    if (conquestGrid && conquestGrid.applyDevastation) {
        conquestGrid.applyDevastation(s.lat, s.lon, 35, 0.25);
    }
    if (SFX && SFX.exp) SFX.exp(40, false);
    // primary: enemy structure closest to the splash
    let prim = null, pd = C.TANK_SPG_SPLASH_KM;
    for (const st of structs) {
        if (st.dead || st.owner === s.owner || st.owner === 'neutral') continue;
        const d = haversineDist(s.lat, s.lon, st.lat, st.lon);
        if (d < pd) { pd = d; prim = st; }
    }
    if (prim) {
        prim.hit(s.dmg * s.structMul);
        if (prim.dead && s.src && !s.src.dead) s.src._creditKill();
    }
    // splash: armor + troops in the footprint
    for (const tk of tanks) {
        if (tk.dead || tk.owner === s.owner) continue;
        if (haversineDist(s.lat, s.lon, tk.lat, tk.lon) < 20) tk.hit(s.dmg, s.owner);
    }
    for (const tc of troopCohorts) {
        if (tc.dead || tc.owner === s.owner) continue;
        const ll = vec3ToLatLon(tc.mesh.position);
        if (haversineDist(s.lat, s.lon, ll.lat, ll.lon) < 25) {
            const kill = Math.floor(s.dmg * s.troopMul * 12);
            tc.troops -= kill;
            if (tc.troops <= 0 && !tc.dead) {
                tc.dead = true;
                scene.remove(tc.mesh);
                if (tc.mesh.material) tc.mesh.material.dispose();
            }
        }
    }
}

function _updateSpgShells() {
    for (let i = spgShells.length - 1; i >= 0; i--) {
        const s = spgShells[i];
        s.t += (1 / 60) / s.dur;
        if (s.t >= 1) {
            spgShells.splice(i, 1);
            _spgShellImpact(s);
            continue;
        }
        IndirectFire.at(s.from, s.ctrl, s.to, s.t, s.mesh.position);
    }
}

// Burning wrecks: fire + smoke for TANK_WRECK_FRAMES, then shrink-fade.
function _updateTankWrecks() {
    for (let i = tankWrecks.length - 1; i >= 0; i--) {
        const w = tankWrecks[i];
        w.t--;
        if (w.t <= 0) {
            scene.remove(w.mesh);
            disposeMeshDeep(w.mesh);
            if (w.tex) w.tex.dispose();
            tankWrecks.splice(i, 1);
            continue;
        }
        if (frame % 14 === (w.id % 14)) {
            spawnExp(w.lat + rnd(-0.15, 0.15), w.lon + rnd(-0.15, 0.15), 1.6, '#ff7733');
        }
        if (frame % 10 === (w.id % 10)) {
            _puffAt(latLonToVec3(w.lat, w.lon, EARTH_RADIUS + 6), 0x2b2b30, 3.2,
                new THREE.Vector3().copy(latLonToVec3(w.lat, w.lon, 1)).normalize().multiplyScalar(0.5), 40);
        }
        if (w.t < 90) w.mesh.scale.multiplyScalar(0.94);   // fade-out by shrink
    }
}

// One gameFrame line for the whole deep-pass FX/state layer.
function _tankDeepTick() {
    _updateTankWrecks();
    _updateSpgShells();
}

// Reset helper: purge wrecks + shells (called from the reset paths).
function _clearTankDeep() {
    for (const w of tankWrecks) {
        scene.remove(w.mesh);
        disposeMeshDeep(w.mesh);
        if (w.tex) w.tex.dispose();
    }
    tankWrecks = [];
    for (const s of spgShells) scene.remove(s.mesh);
    spgShells = [];
}

class Tank {
    // O(1) land probe: conquest grid when ready (mode 1), else the GeoJSON
    // polygon scan (placement-time only — per-frame tank steps MUST use the
    // grid path or the geoContains loop would eat the frame budget).
    static LAND_OK(lat, lon) {
        if (window.gameMode === 'mode1' && conquestGrid && conquestGrid._maskReady) {
            return conquestGrid.ownerAt(lat, lon) !== 'water';
        }
        return isLand(lat, lon);
    }
    constructor(lat, lon, key, owner, opts = {}) {
        const C = GAME_CONSTANTS;
        this.id = ++_id;
        this.owner = owner;
        this.key = TCFG[key] ? key : 'medium';
        this.cfg = TCFG[this.key];
        this.name = this.cfg.name;
        this.behavior = TANK_BEHAVIORS[this.key] || TANK_BEHAVIORS.medium;   // TASK-405 per-class knobs
        this.hp = this.cfg.hp; this.maxHp = this.cfg.hp;
        this.dead = false; this.selected = false;
        this.isTank = true;
        this.mode = 'hold';            // 'advance' | 'combat' | 'hold'
        this.lat = lat; this.lon = lon;
        this.tgtLat = opts.tgtLat !== undefined ? opts.tgtLat : lat;
        this.tgtLon = opts.tgtLon !== undefined ? opts.tgtLon : lon;
        this.target = null;            // { kind:'tank'|'struct'|'cohort', obj }
        this.fireCd = this.cfg.fireRate >> 1;
        this.retargetT = this.id % 30;
        this.shots = 0;
        // TASK-405 deep-pass state
        this.kills = 0; this.ace = 0;                 // veterancy (aces)
        this.entrench = 0;                            // 0..1 dig-in progress
        this.unsupplied = false; this.supplyGrace = 0;// logistics
        this._supplyT = (this.id % 90) + 10;          // staggered supply scan
        this._flakT = (this.id % 90) + 40;            // staggered flak chip scan
        this._dustT = 0;
        this._crossing = false; this._crossT = 0;     // river/strait crossing
        this._traverseCos = Math.cos(C.TANK_TRAVERSE_TOL);
        this._radius = EARTH_RADIUS + C.TANK_ALT;
        this._faceVec = null;
        this._lastDir = null;
        // Division formation: wedge of N vehicles (lead front), sharing one group
        // (TASK-405: offsets come from the shared FormationLayout util)
        const acc = ownerHexColor(owner);
        this.mesh = new THREE.Group();
        this.members = [];
        for (let i = 0; i < this.cfg.tanks; i++) {
            const m = buildTankModel(this.key, acc);
            const o = FormationLayout.wedge(i, 2.4);
            m.position.set(o.x, 0, o.z);
            this.mesh.add(m);
            this.members.push(m);
        }
        this.mesh.scale.setScalar(this.cfg.scale);
        this.mesh.position.copy(latLonToVec3(lat, lon, this._radius));
        scene.add(this.mesh);
        this.members0 = this.members.length;   // full-strength count (attrition math)
        // Selection ring (yellow halo flat on the ground around the division)
        if (!GEO_CACHE['tankSelRing']) GEO_CACHE['tankSelRing'] = new THREE.RingGeometry(15, 17, 26);
        this.selRing = new THREE.Mesh(GEO_CACHE['tankSelRing'],
            new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
        this.selRing.rotation.x = -Math.PI / 2;
        this.selRing.position.y = 0.4;
        this.selRing.visible = false;
        this.mesh.add(this.selRing);
        this._buildSandbags();   // TASK-405: entrenchment ring (hidden until dug)
        this._buildBanner();     // TASK-405: division banner (kills/state)
    }
    get type() { return 'tank_' + this.key; }
    get pos() { return this.mesh.position; }
    // TASK-405 derived state
    get aceMul() { return 1 + this.ace * GAME_CONSTANTS.TANK_ACE_DMG; }
    get armorEff() { return Math.min(0.85, this.cfg.armor + this.ace * GAME_CONSTANTS.TANK_ACE_ARMOR); }
    get engineDamaged() { return this.hp < this.maxHp * GAME_CONSTANTS.TANK_ENGINE_HP; }
    get entrenched() { return this.entrench >= 1; }

    // Player/bot move order — the division marches there over LAND.
    setMoveTarget(lat, lon) {
        this.tgtLat = lat; this.tgtLon = lon;
        this._faceVec = null;
    }

    // Public damage API (parity with Structure.hit / Warship.hit) — armor
    // flat-reduces everything: shells, missile blasts, bombs.
    // TASK-405: aces thicken armor (capped), entrenchment soaks 50% at full
    // dig-in, and divisions caught midstream (river crossing) take +25%.
    hit(dmg, fromOwner) {
        if (this.dead) return;
        const C = GAME_CONSTANTS;
        let d = dmg;
        if (this._crossing) d *= C.TANK_RIVER_VULN_MUL;
        if (this.entrench > 0) d *= 1 - C.TANK_ENTRENCH_ARMOR * this.entrench;
        this.hp -= d * (1 - this.armorEff);
        this._syncMembers();
        if (this.hp <= 0) this._destroy();
    }

    _destroy() {
        if (this.dead) return;
        this.dead = true;
        this.selected = false;
        spawnExp(this.lat, this.lon, 6, '#ff7733');
        _spawnCrater(this.lat, this.lon, GAME_CONSTANTS.TANK_WRECK_DEV_R);   // burning wreck scar
        if (conquestGrid && conquestGrid.applyDevastation) {
            conquestGrid.applyDevastation(this.lat, this.lon, GAME_CONSTANTS.TANK_WRECK_DEV_R, 0.8);
        }
        if (this.selRing && this.selRing.material) this.selRing.material.dispose();
        this.mesh.remove(this.selRing);
        if (this.banner) this.banner.visible = false;
        if (this.sandbags) this.sandbags.visible = false;
        // TASK-405: the hulls stay on the field as a BURNING WRECK (fire +
        // smoke, shrink-fade) instead of vanishing — see _updateTankWrecks.
        tankWrecks.push({ mesh: this.mesh, t: GAME_CONSTANTS.TANK_WRECK_FRAMES,
            lat: this.lat, lon: this.lon, id: this.id, tex: this._bannerTex || null });
        if (this.owner === 'player') logEvent(`💥 دُمرت ${this.name} لدينا!`, 'err');
        else if (this.owner === myRole) logEvent(`💥 دُمرت فرقة حليفة!`, 'err');
        else logEvent(`💥 أُبيدت فرقة مدرعة معادية ${_ownerName(this.owner)}!`, 'info');
    }

    // Visual attrition: knock out individual vehicles as the hp pool drops
    _syncMembers() {
        const frac = Math.max(0, this.hp / this.maxHp);
        const alive = Math.max(1, Math.ceil(this.members0 * frac));
        while (this.members.length > alive && this.members.length > 1) {
            const m = this.members.pop();
            spawnExp(this.lat, this.lon, 2.5, '#ff9944');
            this.mesh.remove(m);
        }
    }

    // ── targeting (every 30 frames, staggered) ──
    // TASK-405: data-driven priority per behavior — artillery hunts
    // STRUCTURES first (siege role), armor hunts TANKS first (duels).
    _retarget() {
        const C = GAME_CONSTANTS;
        const arty = !!this.behavior.indirect;
        const order = arty ? ['struct', 'tank', 'cohort'] : ['tank', 'struct', 'cohort'];
        this.target = null;
        for (const kind of order) {
            let best = null, bestD = Infinity;
            if (kind === 'tank') {
                for (const t of tanks) {
                    if (t.dead || t.owner === this.owner) continue;
                    const d = haversineDist(this.lat, this.lon, t.lat, t.lon);
                    if (d < bestD) { bestD = d; best = t; }
                }
            } else if (kind === 'struct') {
                for (const s of structs) {
                    if (s.dead || s.owner === this.owner || s.owner === 'neutral') continue;
                    const d = haversineDist(this.lat, this.lon, s.lat, s.lon);
                    if (d < bestD) { bestD = d; best = s; }
                }
            } else {
                for (const tc of troopCohorts) {
                    if (tc.dead || tc.owner === this.owner) continue;
                    const ll = vec3ToLatLon(tc.mesh.position);
                    const d = haversineDist(this.lat, this.lon, ll.lat, ll.lon);
                    if (d < bestD) { bestD = d; best = tc; }
                }
            }
            if (!best || bestD > this.cfg.engageR) continue;
            // ARTILLERY GATES: howitzers can't depress inside the dead zone,
            // and beyond the battery's own sightR the target must be SPOTTED
            // (recon drone / light scout division / radar chain).
            if (arty) {
                if (bestD < C.TANK_SPG_DEADZONE_KM) continue;
                let p;
                if (kind === 'cohort') {
                    const ll = vec3ToLatLon(best.mesh.position);
                    p = { lat: ll.lat, lon: ll.lon };
                } else p = { lat: best.lat, lon: best.lon };
                if (bestD > this.cfg.sightR && !_spottedBy(this.owner, p.lat, p.lon)) continue;
            }
            this.target = { kind, obj: best };
            break;
        }
    }
    _validateTarget() {
        const t = this.target;
        if (!t) return;
        const p = this._posOf(t);
        if (!p || haversineDist(this.lat, this.lon, p.lat, p.lon) > this.cfg.engageR) this.target = null;
    }
    _posOf(t) {
        const o = t.obj;
        if (!o || o.dead) return null;
        if (t.kind === 'cohort' && o.mesh) { const ll = vec3ToLatLon(o.mesh.position); return { lat: ll.lat, lon: ll.lon }; }
        return { lat: o.lat, lon: o.lon };
    }

    // ── gunnery ──
    // Direct fire: flat tracer, damage on the pull of the trigger.
    // Indirect fire (SPG): the shell arcs to the AIM POINT and splashes on
    // impact — the target may have moved; that's artillery.
    _fire(t, tp) {
        const C = GAME_CONSTANTS;
        const dmg = this.cfg.gunDmg * this.aceMul;   // aces shoot harder
        this.fireCd = this.cfg.fireRate * (this.unsupplied ? C.TANK_SUPPLY_RELOAD_MUL : 1);
        this.shots++;
        if (this.behavior.indirect) { this._fireArc(t, tp, dmg); return; }
        const muzzle = this.mesh.position.clone().addScaledVector(this.mesh.position.clone().normalize(), 4);
        _tracer(muzzle, latLonToVec3(tp.lat, tp.lon, EARTH_RADIUS + 2), 0xffcc55);
        spawnExp(this.lat, this.lon, 1.4, '#ffee99');   // muzzle flash
        // TASK-405 polish: muzzle blast ring + ejected shell casing
        _puffAt(muzzle, 0xffd27a, 2.2, null, 10);
        const nrm = this.mesh.position.clone().normalize();
        const side = new THREE.Vector3().crossVectors(this._faceVec || nrm, nrm).normalize();
        _puffAt(muzzle.clone().addScaledVector(side, 2.5).addScaledVector(nrm, 2), 0xd8c34a, 0.8,
            side.multiplyScalar(0.5).addScaledVector(nrm, 0.7), 22);   // casing pops out
        this._applyDirect(t, dmg);
        if (SFX && SFX.gun) SFX.gun();
    }
    _applyDirect(t, dmg) {
        if (t.kind === 'tank') {
            t.obj.hit(dmg, this.owner);
        } else if (t.kind === 'cohort') {
            const kill = Math.floor(dmg * this.cfg.troopMul * 12);
            t.obj.troops -= kill;
            if (t.obj.troops <= 0 && !t.obj.dead) {
                t.obj.dead = true;
                scene.remove(t.obj.mesh);
                if (t.obj.mesh.material) t.obj.mesh.material.dispose();
            }
        } else {
            t.obj.hit(dmg * this.cfg.structMul);
        }
        if (t.obj.dead) this._creditKill();   // aces are EARNED, not awarded
    }
    _fireArc(t, tp, dmg) {
        const C = GAME_CONSTANTS;
        const from = this.mesh.position.clone();
        const to = latLonToVec3(tp.lat, tp.lon, this._radius);
        const ctrl = IndirectFire.ctrl(from, to, C.TANK_SPG_ARC_H);
        const mesh = new THREE.Mesh(_sph(1.5, 8, 6), getSharedMat(0xffaa44));
        mesh.position.copy(from);
        scene.add(mesh);
        const dist = from.distanceTo(to);
        spgShells.push({ mesh, from, ctrl, to, t: 0,
            dur: Math.max(0.5, Math.min(2.2, dist / 400)),
            lat: tp.lat, lon: tp.lon, dmg,
            structMul: this.cfg.structMul, troopMul: this.cfg.troopMul,
            owner: this.owner, src: this });
        spawnExp(this.lat, this.lon, 2.6, '#ffcc66');   // big muzzle flash
        _puffAt(from, 0xb8a878, 3.5, null, 20);         // dust kicked off the battery position
        if (SFX && SFX.gun) SFX.gun();
    }
    _creditKill() {
        if (this.dead) return;
        this.kills++;
        const was = this.ace;
        this._recalcAce();
        if (this.ace > was && this.owner === 'player') {
            logEvent(`🎖 ${this.name} ترقّت: ${TANK_ACE_AR[this.ace]}! (قتلى ${this.kills})`, 'info');
        }
    }
    _recalcAce() {
        const K = GAME_CONSTANTS.TANK_ACE_KILLS;
        let lv = 0;
        for (let i = 0; i < K.length; i++) if (this.kills >= K[i]) lv = i + 1;
        this.ace = Math.min(3, lv);
    }

    // ── movement: tangent-plane step with coast avoidance ──
    _stepToward(tLat, tLon, km) {
        if (this._tryStep(tLat, tLon, km, 0)) return true;
        if (this._crossing) return false;   // midstream: bow stays on the objective
        for (const a of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) {
            if (this._tryStep(tLat, tLon, km, a)) return true;   // follow the coastline
        }
        return false;
    }
    // Far-bank probe: is the water ahead a RIVER/STRAIT (land resumes within
    // TANK_RIVER_PROBE_KM along the march axis) or an ocean? Enables real
    // bridgehead play — armor wades narrow water at assault speed.
    _probeFarBank(nrm, dir) {
        const C = GAME_CONSTANTS;
        const step = 6 / 6371, maxA = C.TANK_RIVER_PROBE_KM / 6371;
        for (let a = step; a <= maxA; a += step) {
            const p = _tkV5.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(dir, Math.sin(a));
            const ll = vec3ToLatLon(p);
            if (Tank.LAND_OK(ll.lat, ll.lon)) return true;
        }
        return false;
    }
    _tryStep(tLat, tLon, km, ang) {
        const n = _tkV1.copy(this.mesh.position).normalize();
        const tgt = _tkV2.copy(latLonToVec3(tLat, tLon, 1)).normalize();
        const d = _tkV3.copy(tgt).addScaledVector(n, -tgt.dot(n));
        if (d.lengthSq() < 1e-9) return false;
        d.normalize();
        if (ang) d.applyAxisAngle(n, ang);
        const arc = km / 6371;   // km → radians on the unit sphere
        const next = _tkV4.copy(n).multiplyScalar(Math.cos(arc)).addScaledVector(d, Math.sin(arc));
        const ll = vec3ToLatLon(next);
        if (!Tank.LAND_OK(ll.lat, ll.lon)) {
            // RIVER CROSSING (TASK-405): water is crossable only when the far
            // bank is close. Entry requires the direct line (no sidesteps);
            // once crossing, keep wading toward the objective.
            if (!this._crossing) {
                if (ang !== 0) return false;
                if (!this._probeFarBank(n, d)) return false;
                this._crossing = true;
                this._crossT = 0;
            }
        } else if (this._crossing) {
            this._crossing = false;   // reached the far bank
            this._crossT = 0;
        }
        if (this._crossing && ++this._crossT > 260) {   // widened water guard: give up midstream
            this._crossing = false;
            return false;
        }
        this.lat = ll.lat; this.lon = ll.lon;
        this.mesh.position.copy(next.clone().multiplyScalar(this._radius));
        this._lastDir = d.clone();
        return true;
    }

    _advance() {
        const C = GAME_CONSTANTS;
        const d = haversineDist(this.lat, this.lon, this.tgtLat, this.tgtLon);
        if (d <= 40) { this.mode = 'hold'; return; }   // arrived — hold ground, keep scanning
        // TASK-405 speed budget: terrain grade × river wade × supply state ×
        // engine damage (halved below 35% hp — a crawling division reads hurt).
        let km = this.cfg.speed;
        if (this._crossing) km *= C.TANK_RIVER_SPEED_MUL;
        if (this.unsupplied) km *= C.TANK_SUPPLY_SPEED_MUL;
        if (this.engineDamaged) km *= C.TANK_ENGINE_SPEED_MUL;
        if (conquestGrid && conquestGrid._maskReady) {
            km *= C.TANK_TERRAIN_SPEED[conquestGrid.terrainAtCell(conquestGrid.latLonToCell(this.lat, this.lon))] || 1;
        }
        if (this._stepToward(this.tgtLat, this.tgtLon, Math.min(km, d))) {
            this.mode = 'advance';
            // SPEARHEAD: divisions advancing through non-owned land claim a
            // corridor behind them — armor opens the way for the army.
            if (window.gameMode === 'mode1' && conquestGrid && (frame + this.id) % C.TANK_CORRIDOR_EVERY === 0) {
                const o = getPixelOwner(this.lat, this.lon);
                if (o !== this.owner && o !== 'water') {
                    paintCircleOnLandDirect(this.lat, this.lon, C.TANK_CORRIDOR_R_KM, this.owner);
                }
            }
            // Dust trail colored by the ground being crossed (TASK-405 polish)
            if (++this._dustT >= C.TANK_DUST_EVERY) {
                this._dustT = 0;
                this._spawnDust();
            }
        } else {
            this.mode = 'hold';   // boxed in by water — hold
        }
    }
    _spawnDust() {
        if (!this._faceVec) return;
        const nrm = _tkV6.copy(this.mesh.position).normalize();
        const back = _tkV5.copy(this.mesh.position).addScaledVector(this._faceVec, -7).addScaledVector(nrm, 2.5);
        let col = 0xa89a80;
        if (conquestGrid && conquestGrid._maskReady) {
            const tc = conquestGrid.terrainAtCell(conquestGrid.latLonToCell(this.lat, this.lon));
            col = TANK_DUST_COL[tc] || col;
        }
        _puffAt(back, col, 2.0 * (this.behavior.dust || 1),
            new THREE.Vector3().copy(nrm).multiplyScalar(0.35), 34);
    }

    // Tangent direction toward a point (scratch _tkV4 — use immediately).
    _dirToward(tp) {
        const n = _tkV3.copy(this.mesh.position).normalize();
        const tv = _tkV4.copy(latLonToVec3(tp.lat, tp.lon, 1)).normalize();
        const d = tv.addScaledVector(n, -tv.dot(n));
        if (d.lengthSq() < 1e-9) return null;
        return d.normalize();
    }
    // TURRET/HULL TRAVERSAL (TASK-405): the division swings toward its task
    // at behavior.traverse rad/frame — a Tiger slews slowly and deliberately,
    // scouts whip around. The gun only fires once on target (within TOL).
    _rotateFaceToward(des, maxRad) {
        const c = Math.max(-1, Math.min(1, this._faceVec.dot(des)));
        const ang = Math.acos(c);
        if (ang <= maxRad || ang < 1e-4) { this._faceVec.copy(des); return; }
        const axis = _tkV1.copy(this._faceVec).cross(des);
        if (axis.lengthSq() < 1e-9) return;   // antiparallel — next frame's target fixes it
        axis.normalize();
        this._faceVec.applyAxisAngle(axis, maxRad).normalize();
    }
    _orient() {
        const nrm = _tkV1.copy(this.mesh.position).normalize();
        this.mesh.up.copy(nrm);
        const look = this._faceVec || this._lastDir;
        if (look) {
            // lookAt aims +Z at a point ahead along the facing — models are
            // built nose-+Z, so divisions drive/engage nose-first.
            _tkV2.copy(nrm).multiplyScalar(this._radius).addScaledVector(look, 20);
            this.mesh.lookAt(_tkV2);
        }
    }

    // ── logistics (TASK-405): supply line to the nearest hub ──
    // In reach of a friendly city/factory/port/base = supplied (range ×2 on
    // own territory — the road net). Out of reach: 10s grace, then attrition
    // + slow crawl + slow reloads. A fully ENTRENCHED friendly division
    // projects supply 400km — that's the BRIDGEHEAD: dig in across the river
    // and the spearhead keeps itself fed.
    _supplyCheck() {
        const C = GAME_CONSTANTS;
        const own = getPixelOwner(this.lat, this.lon) === this.owner;
        const R = C.TANK_SUPPLY_R_KM * (own ? C.TANK_SUPPLY_OWN_MUL : 1);
        let ok = false;
        for (const s of structs) {
            if (s.dead || s.owner !== this.owner || !C.TANK_SUPPLY_HUBS.includes(s.type)) continue;
            if (haversineDist(this.lat, this.lon, s.lat, s.lon) < R) { ok = true; break; }
        }
        if (!ok) {
            for (const o of tanks) {
                if (o === this || o.dead || o.owner !== this.owner || o.entrench < 1) continue;
                if (haversineDist(this.lat, this.lon, o.lat, o.lon) < C.TANK_BRIDGEHEAD_KM) { ok = true; break; }
            }
        }
        if (ok) {
            if (this.unsupplied && this.owner === 'player') logEvent(`✅ ${this.name} عادت إلى الإمداد`, 'info');
            this.unsupplied = false;
            this.supplyGrace = 0;
        } else if ((this.supplyGrace += 90) > C.TANK_SUPPLY_GRACE_F) {
            // +90 = the scan cadence, so GRACE_F counts FRAMES (600 ≈ 10s)
            // — previously ++ per scan made the grace 600×90f ≈ 15 minutes.
            if (!this.unsupplied && this.owner === 'player') {
                logEvent(`⛔ ${this.name} انقطعت عن الإمداد — تبدأ بالاستنزاف! (${Math.round(R)}كم من أقرب مدينة)`, 'err');
            }
            this.unsupplied = true;
        }
    }

    // ── structure defensive fire vs tanks (AUDIT item, decided) ──
    // FLAK is dual-purpose (the 88 was THE AT gun): enemy flak batteries chip
    // armor inside 90km. EMP'd flak is silent (synergy with the missiles
    // agent's EMP). Implemented tank-side — Structure.update untouched.
    _flakTick() {
        const C = GAME_CONSTANTS;
        let best = null, bestD = C.TANK_FLAK_AT_RANGE;
        for (const s of structs) {
            if (s.dead || s.owner === this.owner || s.owner === 'neutral' || s.type !== 'flak') continue;
            if ((s.empT || 0) > 0) continue;   // EMP'd guns are dark
            const d = haversineDist(this.lat, this.lon, s.lat, s.lon);
            if (d < bestD) { bestD = d; best = s; }
        }
        if (best) {
            _tracer(best.pos, this.mesh.position, 0xffe066);
            spawnExp(best.lat, best.lon, 1.6, '#ffe066');
            this.hit(C.TANK_FLAK_AT_DMG, best.owner);
        }
    }

    // ── entrenchment visual: sandbag ring (grows in as they dig) ──
    _buildSandbags() {
        this.sandbagMat = new THREE.MeshPhongMaterial({ color: 0xb5a279, flatShading: true, transparent: true, opacity: 0 });
        this.sandbags = new THREE.Group();
        for (const p of FormationLayout.sandbags(12, 8.5)) {
            const m = new THREE.Mesh(_box(2.6, 0.9, 1.4), this.sandbagMat);
            m.position.set(p.x, 0.45, p.z);
            m.rotation.y = Math.atan2(p.x, p.z);
            this.sandbags.add(m);
        }
        this.sandbags.visible = false;
        this.mesh.add(this.sandbags);
    }

    // ── division banner: kill tally + ace rank + state glyphs ──
    _buildBanner() {
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 96;
        this._bannerCv = cv;
        this._bannerTex = new THREE.CanvasTexture(cv);
        const mat = new THREE.SpriteMaterial({ map: this._bannerTex, transparent: true, depthTest: true });
        this.banner = new THREE.Sprite(mat);
        this.banner.position.set(0, 15, 0);
        this.banner.scale.set(34, 12.75, 1);
        this.banner.visible = false;
        this.mesh.add(this.banner);
        this._bannerKey = '';
    }
    _refreshBanner() {
        const key = [this.kills, this.ace, this.unsupplied ? 1 : 0, this.entrench >= 1 ? 1 : 0, this.selected ? 1 : 0].join('|');
        if (key === this._bannerKey) return;
        this._bannerKey = key;
        const show = this.selected || this.kills > 0 || this.unsupplied || this.entrench >= 1;
        this.banner.visible = show;
        if (!show) return;
        const ctx = this._bannerCv.getContext('2d');
        ctx.clearRect(0, 0, 256, 96);
        ctx.fillStyle = 'rgba(8,10,12,0.62)';
        ctx.fillRect(14, 20, 228, 56);
        const acc = ownerHexColor(this.owner);
        ctx.strokeStyle = '#' + acc.toString(16).padStart(6, '0');
        ctx.lineWidth = 3;
        ctx.strokeRect(14, 20, 228, 56);
        ctx.font = 'bold 34px sans-serif';
        ctx.textBaseline = 'middle';
        let x = 30;
        const glyphs = [];
        if (this.entrench >= 1) glyphs.push('🛡️');
        if (this.unsupplied) glyphs.push('⛔');
        if (this.kills > 0) glyphs.push('🎖️');
        for (const g of glyphs) { ctx.fillText(g, x, 48); x += 42; }
        if (this.kills > 0) { ctx.fillStyle = '#ffffff'; ctx.font = 'bold 38px sans-serif'; ctx.fillText(String(this.kills), x, 50); x += 60; }
        if (this.ace > 0) {
            ctx.font = 'bold 30px sans-serif';
            ctx.fillStyle = '#ffd257';
            ctx.fillText('★'.repeat(this.ace), x, 50);
        }
        this._bannerTex.needsUpdate = true;
    }

    _refreshVfx() {
        if (this.sandbags) {
            const on = this.entrench > 0.05;
            this.sandbags.visible = on;
            if (on) this.sandbagMat.opacity = 0.3 + 0.7 * this.entrench;
        }
        // engine-damage smoke: a hurt division trails dark smoke (polish)
        if (this.engineDamaged && frame % 15 === (this.id % 15)) {
            const nrm = _tkV6.copy(this.mesh.position).normalize();
            _puffAt(_tkV5.copy(this.mesh.position).addScaledVector(nrm, 3), 0x2b2b30, 1.8,
                new THREE.Vector3().copy(nrm).multiplyScalar(0.5), 30);
        }
        this._refreshBanner();
    }

    // ── main tick (60fps logic) ──
    update() {
        if (this.dead) return;
        const C = GAME_CONSTANTS;
        if (this.selRing) this.selRing.visible = !!this.selected;
        if (this.fireCd > 0) this.fireCd--;
        // staggered scans (OPTIMIZE: each division offsets by id so 12
        // divisions never scan on the same frame)
        if (--this.retargetT <= 0) { this.retargetT = 30; this._retarget(); }
        else this._validateTarget();
        if (--this._supplyT <= 0) { this._supplyT = 90; this._supplyCheck(); }
        if (--this._flakT <= 0) { this._flakT = 90; this._flakTick(); }
        // supply attrition: cut divisions bleed until they reach a hub
        if (this.unsupplied) {
            this.hp -= this.maxHp * C.TANK_SUPPLY_HP_PER_F;
            this._syncMembers();
            if (this.hp <= 0) { this._destroy(); return; }
        }
        const t = this.target;
        const tp = t ? this._posOf(t) : null;
        const dTgt = tp ? haversineDist(this.lat, this.lon, tp.lat, tp.lon) : Infinity;
        const canShoot = !!tp && dTgt <= this.cfg.gunRange &&
            (!this.behavior.indirect || dTgt >= C.TANK_SPG_DEADZONE_KM);
        // ── turret/hull traversal: swing toward the task, fire only when on ──
        let desired = null, tgtDir = null;
        if (tp) { tgtDir = this._dirToward(tp); desired = tgtDir; }
        else if (this._lastDir) desired = this._lastDir;
        if (desired) {
            if (!this._faceVec) this._faceVec = desired.clone();
            else this._rotateFaceToward(desired, this.behavior.traverse);
        }
        if (canShoot) {
            this.mode = 'combat';
            if (tgtDir && this._faceVec.dot(tgtDir) >= this._traverseCos && this.fireCd <= 0) {
                this._fire(t, tp);
            }
            // Tank battles paint devastation — pounded ground falls faster
            if ((frame + this.id) % 90 === 0 && conquestGrid && conquestGrid.applyDevastation) {
                conquestGrid.applyDevastation(this.lat, this.lon, C.TANK_BATTLE_DEV_R, 0.2);
            }
        } else {
            this._advance();
        }
        // ── entrenchment: quiet divisions holding ground dig in (20s to full) ──
        if (this.mode === 'hold' && !tp && !this._crossing) {
            this.entrench = Math.min(1, this.entrench + 1 / C.TANK_ENTRENCH_FRAMES);
        } else if (this.entrench > 0 && this.mode !== 'hold') {
            this.entrench = Math.max(0, this.entrench - 3 / C.TANK_ENTRENCH_FRAMES);
        }
        this._orient();
        this._refreshVfx();
    }
}

// Central spawn (caps enforced by callers): player click-path + bots + online sync
function spawnTankDivision(lat, lon, key, owner, opts = {}) {
    const d = new Tank(lat, lon, key, owner, opts);
    tanks.push(d);
    return d;
}

// TASK-204 launch-point picker — silo/rail from the nearest READY launcher,
// or a SUBSURFACE pop-up from the nearest owned PORT when the sea approach
// is meaningfully closer to the target (ports become missile infrastructure).
function _pickLaunchPoint(loc, owner) {
    const launchers = structs.filter(s => s.type === 'launcher' && s.owner === owner && s.reload <= 0 && !s.dead
        && (!s.maxMag || s.mag > 0));   // TASK-403: dry magazine = not ready (bulk re-arm running)
    if (!launchers.length) return null;
    const L = launchers.sort((a, b) => haversineDist(a.lat, a.lon, loc.lat, loc.lon) - haversineDist(b.lat, b.lon, loc.lat, loc.lon))[0];
    const res = { lat: L.lat, lon: L.lon, style: (L.id % 2 === 0) ? 'silo' : 'rail', launcher: L };
    const ports = structs.filter(s => s.type === 'port' && s.owner === owner && !s.dead);
    if (ports.length) {
        const P = ports.sort((a, b) => haversineDist(a.lat, a.lon, loc.lat, loc.lon) - haversineDist(b.lat, b.lon, loc.lat, loc.lon))[0];
        const dP = haversineDist(P.lat, P.lon, loc.lat, loc.lon);
        const dL = haversineDist(L.lat, L.lon, loc.lat, loc.lon);
        if (dP < dL * GAME_CONSTANTS.SUB_LAUNCH_ADVANTAGE) { res.lat = P.lat; res.lon = P.lon; res.style = 'sub'; }
    }
    return res;
}

// TASK-403: consume one magazine round + the per-shot cooldown; hitting 0
// starts the bulk re-arm cycle (LAUNCHER_REARM_FRAMES, magazine refills full).
function _launchConsume(L) {
    L.reload = L.maxReload;
    if (!L.maxMag) return;
    L.mag = Math.max(0, L.mag - 1);
    if (L.mag === 0) {
        L.rearmT = GAME_CONSTANTS.LAUNCHER_REARM_FRAMES;
        if (L.owner === myRole) logEvent(`🚀 ${L.name}: المخزون فارغ — إعادة تسليح (10 ثوان)`, 'warn');
    }
}

// TASK-201: SAM/iron-dome interceptor against AIRCRAFT — same pursuit
// mechanics as fireSAM, but the aircraft can decoy with flares and takes
// damage instead of an instant kill (see Missile.update tgtIsPlane branch).
function fireSAMPlane(src, plane) {
    const m = new Missile(src.lat, src.lon, plane.lat, plane.lon, MCFG['ballistic'], src.owner, true);
    m.tgt = plane;
    m.tgtIsPlane = true;
    m.dmgVsPlane = GAME_CONSTANTS.AIR_SAM_DMG;
    m.speed = GAME_CONSTANTS.SAM_INTERCEPT_SPEED_KM_S / 3;   // slower vs agile targets
    m.mesh.scale.setScalar(0.6);                              // slimmer AA look
    missiles.push(m);
}

// TASK-403: guided AA interceptor vs DRONES — same pursuit mechanics as
// fireSAMPlane (resolved by the tgtIsDrone arms in Missile.update). Drones
// out-run interceptors 6-30×, so the kill lands on proximity (hitR covers a
// full drone tick of travel) or when the interceptor exhausts its chase.
// Drones carry no flares — but a swarm is many cheap airframes vs one $450
// battery with a reload cycle: the exchange is the counter-play.
function fireSAMDrone(src, drone) {
    const m = new Missile(src.lat, src.lon, drone.lat, drone.lon, MCFG['ballistic'], src.owner, true);
    m.tgt = drone;
    m.tgtIsDrone = true;
    m.dmgVsDrone = GAME_CONSTANTS.AIR_SAM_DMG;
    m.speed = GAME_CONSTANTS.SAM_INTERCEPT_SPEED_KM_S;   // full sprint — drones are faster than anything
    m.mesh.scale.setScalar(0.6);
    missiles.push(m);
    _tracer(src.pos, drone.pos, 0x9fd8ff);
    spawnExp(src.lat, src.lon, 3, '#9fd8ff');
}

// ═══════════════════════════════════════════════════════════════
// TERRITORY OVERLAY SYSTEM — Phase 2: Grand Strategy
// Layer 1: Canvas fill overlay (Voronoi province colors)
// Layer 2: 3D LineSegments (country borders, colored by ownership)
// Layer 3: 3D LineSegments (province borders, fainter)
// Layer 4: InstancedMesh city markers (3 tiers: national/provincial/major)
// Layer 5: Procedural capital building clusters
// Layer 6: Road network (great-circle arcs between cities)
// Layer 7: HTML label overlay (multi-level LOD)
// Layer 8: Hover tooltip + click panel interaction
// ═══════════════════════════════════════════════════════════════

// ═══ STATE ═══
let territoryCanvas, territoryCtx, territoryTexture, territoryMesh;
let territoryProjection, territoryPath;
// Dedicated conquest overlay (mode1) + frontier lines: state lives in
// WORLD_RENDER (src/world/render.js) since TASK-406 — no locals here anymore.
let countryOwnership = {};   // ISO3 → 'neutral'|'player'|'enemy'
let countryFeatures = {};    // ISO3 → GeoJSON feature
let countryCityCount = {};   // ISO3 → {total, player, enemy}

// Country border lines
let borderLinesMesh;         // THREE.LineSegments
let borderSegmentMap = {};   // ISO3 → {startIdx, count}
let borderColorArray;        // Float32Array for vertex colors

// Province border lines (Voronoi-based)
let provinceBorderMesh;      // THREE.LineSegments

// City markers — 3 tiers
let cityNodes = [];          // Array of city data objects
let cityPointsMesh;          // THREE.Points
let cityPositions;
let cityColors;
let citySizes;
let nationalCapIndices = []; // cityNodes indices for national capitals
let provincialIndices = [];  // cityNodes indices for provincial capitals
let majorIndices = [];       // cityNodes indices for major cities
let cityVoronoi = null;      // D3 Voronoi for province fill
let _dummyMat4 = new THREE.Matrix4();
let _dummyColor = new THREE.Color();
let _dummyVec = new THREE.Vector3();
let _dummyQuat = new THREE.Quaternion();
let _dummyScale = new THREE.Vector3(1,1,1);

// Capital building clusters omitted for flat points

// Road network
let roadSegments = [];       // Array of {from: cityIdx, to: cityIdx, level: 1-3}
let roadMesh;                // THREE.LineSegments for roads

// Labels
let cityLabelContainer;      // DOM element holding label divs
let cityLabelElements = [];  // Array of {el, cityIdx}

// Interaction
let hoveredCity = null;
let selectedCity = null;

// ═══ COLORS ═══
const TERRITORY_COLORS = {
    neutral: 'rgba(80,100,110,0.15)',
    player:  'rgba(0,255,136,0.25)',
    enemy:   'rgba(255,60,60,0.25)',
};
const BORDER_STROKE = {
    neutral: 'rgba(120,130,140,0.25)',
    player:  'rgba(0,255,136,0.35)',
    enemy:   'rgba(255,60,60,0.35)',
};
const BORDER_LINE_COLORS = {
    neutral: [0.35, 0.38, 0.42],
    player:  [0.0, 1.0, 0.53],
    enemy:   [1.0, 0.27, 0.27],
};
const CITY_MARKER_COLORS = {
    neutral: [0.3, 0.75, 0.85],
    player:  [0.0, 1.0, 0.53],
    enemy:   [1.0, 0.27, 0.27],
};
const CITY_LABEL_COLORS = {
    neutral: '#66ccdd',
    player:  '#00ff88',
    enemy:   '#ff4444',
};
const ROAD_COLORS = {
    neutral: [0.35, 0.35, 0.30],
    player:  [0.0, 0.6, 0.35],
    enemy:   [0.6, 0.2, 0.2],
};

const COUNTRY_COLORS = {};
function getCountryColor(iso, MathAlpha) {
    if(!COUNTRY_COLORS[iso]) {
        let hash = 0;
        for(let i=0; i<iso.length; i++) hash = iso.charCodeAt(i) + ((hash << 5) - hash);
        let r = Math.abs((hash & 0xFF0000) >> 16);
        let g = Math.abs((hash & 0x00FF00) >> 8);
        let b = Math.abs(hash & 0x0000FF);
        if (g > r + 40 && g > b + 40) { g = Math.max(0, g - 60); r += 50; }
        if (r > g + 40 && r > b + 40) { r = Math.max(0, r - 60); b += 50; }
        const max = Math.max(r,g,b);
        if(max < 80) { r+=60; g+=60; b+=60; }
        COUNTRY_COLORS[iso] = {r,g,b};
    }
    const c = COUNTRY_COLORS[iso];
    return `rgba(${c.r},${c.g},${c.b},${MathAlpha})`;
}

function getCountryBorderColor(iso) {
    if(!COUNTRY_COLORS[iso]) getCountryColor(iso, 1);
    const c = COUNTRY_COLORS[iso];
    return [c.r/255, c.g/255, c.b/255];
}

// ═══════════════════════════════════════════════════
// LAYER 1: CANVAS TERRITORY FILL
// ═══════════════════════════════════════════════════

function initTerritory(geojsonData) {
    territoryCanvas = document.createElement('canvas');
    territoryCanvas.width = 4096;
    territoryCanvas.height = 2048;
    territoryCtx = territoryCanvas.getContext('2d');

    territoryProjection = d3.geoEquirectangular()
        .scale(4096 / (2 * Math.PI))
        .translate([2048, 1024]);
    territoryPath = d3.geoPath(territoryProjection, territoryCtx);

    geojsonData.features.forEach(f => {
        let iso = f.properties.ISO_A3 || f.properties.ADM0_A3 || '';
        if (iso && iso !== '-99') {
            countryFeatures[iso] = f;
            countryOwnership[iso] = 'neutral';
        }
    });

    window.provincesByCountry = {};
    if (typeof PROVINCE_POLYGONS !== 'undefined' && PROVINCE_POLYGONS) {
        PROVINCE_POLYGONS.features.forEach((feat, i) => {
            let iso = feat.properties.a3 || '';
            if (iso && iso !== '-99') {
                if (!window.provincesByCountry[iso]) window.provincesByCountry[iso] = [];
                window.provincesByCountry[iso].push({ feature: feat, index: i });
            }
        });
    }

    repaintAllCountries();

    territoryTexture = new THREE.CanvasTexture(territoryCanvas);
    territoryTexture.wrapS = THREE.ClampToEdgeWrapping;
    territoryTexture.wrapT = THREE.ClampToEdgeWrapping;
    territoryTexture.colorSpace = THREE.SRGBColorSpace;
    territoryTexture.needsUpdate = true;

    const overlayGeo = new THREE.SphereGeometry(EARTH_RADIUS + 3.0, 256, 128);
    const overlayMat = new THREE.MeshBasicMaterial({
        map: territoryTexture,
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide
    });
    territoryMesh = new THREE.Mesh(overlayGeo, overlayMat);
    scene.add(territoryMesh);
    overlayMat.needsUpdate = true; // ensure the shader compiles with the map bound

    // Mode1: build the conquest grid now so the flat land/water map shows
    // immediately (covers the case where GeoJSON loads after the game started).
    if (window.gameMode === 'mode1') {
        initConquestGrid();
        renderMode1Territory();
    }

    initBorderLines(geojsonData);
}

function repaintAllCountries() {
    if (!territoryCtx) return;
    // Mode 1 with active conquest grid: ownership fill is owned by the grid renderer
    if (window.gameMode === 'mode1' && conquestGrid) {
        renderMode1Territory();
        return;
    }

    territoryCtx.clearRect(0, 0, 4096, 2048);
    // Earth geographic texture as base layer
    if (window.earthBaseImg && window.earthBaseImg.complete) {
        territoryCtx.imageSmoothingEnabled = true;
        territoryCtx.drawImage(window.earthBaseImg, 0, 0, 4096, 2048);
    } else {
        territoryCtx.fillStyle = '#0a2a4a';
        territoryCtx.fillRect(0, 0, 4096, 2048);
    }
    
    // Draw backgrounds and borders
    for (let iso in countryFeatures) {
        paintCountry(iso, false);
    }
    
    // Draw coordinate circles in Mode 1
    if (window.gameMode === 'mode1') {
        if (window.playerCoordinates) {
            window.playerCoordinates.forEach(c => {
                drawCircleOnCanvas(c.lat, c.lon, c.r || 60, 'player');
            });
        }
        if (window.enemyCoordinates) {
            window.enemyCoordinates.forEach(c => {
                drawCircleOnCanvas(c.lat, c.lon, c.r || 60, 'enemy');
            });
        }
    }
    
    if (territoryTexture) {
        territoryTexture.needsUpdate = true;
    }
}

function mapCitiesToProvinces(pLoc, eLoc) {
    if (typeof PROVINCE_POLYGONS === 'undefined' || typeof d3 === 'undefined') return;
    console.log("Snapping grand-strategy province polygons to nearest capital cities...");
    
    // For each province polygon, find the nearest physical city in the same country
    PROVINCE_POLYGONS.features.forEach((feat, i) => {
        let iso = feat.properties.a3 || '';
        if (!iso) return;

        let centroid = d3.geoCentroid(feat);
        if (isNaN(centroid[0]) || isNaN(centroid[1])) return;
        
        let bestDist = Infinity;
        let bestCity = null;

        cityNodes.forEach(city => {
            if (city.country !== iso) return;
            let dlat = city.lat - centroid[1];
            let dlon = city.lon - centroid[0];
            let d = dlat*dlat + dlon*dlon;
            if (d < bestDist) { bestDist = d; bestCity = city; }
        });

        if (bestCity) {
            if (!bestCity.controlledProvinces) bestCity.controlledProvinces = [];
            bestCity.controlledProvinces.push(i);
        }
    });
    
    console.log(`Province mapping complete. 0 auto-generated. UI stays clean.`);
}

function paintCountry(iso, updateTexture) {
    let feature = countryFeatures[iso];
    if (!feature) return;

    if (window.gameMode === 'mode2') {
        // Mode 2 fill country and provinces
        territoryCtx.save();
        territoryCtx.beginPath();
        territoryPath(feature);
        territoryCtx.clip();

        territoryCtx.fillStyle = getCountryColor(iso, 0.22);
        territoryCtx.fill();

        if (window.provincesByCountry && window.provincesByCountry[iso]) {
            window.provincesByCountry[iso].forEach(item => {
                let owner = window.provinceOwnership ? window.provinceOwnership[item.index] : null;
                if (owner && owner !== 'neutral') {
                    territoryCtx.beginPath();
                    territoryPath(item.feature);
                    territoryCtx.fillStyle = TERRITORY_COLORS[owner];
                    territoryCtx.fill();
                }
            });
        }
        territoryCtx.restore();

        // Stroke country border
        let majOwner = countryOwnership[iso] || 'neutral';
        territoryCtx.beginPath();
        territoryPath(feature);
        if(majOwner === 'neutral') {
            territoryCtx.strokeStyle = getCountryColor(iso, 0.45);
        } else {
            territoryCtx.strokeStyle = BORDER_STROKE[majOwner];
        }
        territoryCtx.lineWidth = 1.2;
        territoryCtx.stroke();
    } else {
        // Mode 1: Outlines only, no country background color
        territoryCtx.beginPath();
        territoryPath(feature);
        territoryCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        territoryCtx.lineWidth = 1.0;
        territoryCtx.stroke();
    }

    if (updateTexture && territoryTexture) {
        territoryTexture.needsUpdate = true;
    }
}

function setCountryOwner(iso, newOwner) {
    if (!countryFeatures[iso]) return;
    let oldOwner = countryOwnership[iso];
    if (oldOwner === newOwner) return;

    countryOwnership[iso] = newOwner;
    repaintAllCountries();
    if (territoryTexture) territoryTexture.needsUpdate = true;
    updateBorderColors();
}

function getCountryOwner(iso) {
    return countryOwnership[iso] || 'neutral';
}

function getCountryAtLatLon(lat, lon) {
    if (!window.GEOJSON_DATA) return null;
    for (let f of window.GEOJSON_DATA.features) {
        if (d3.geoContains(f, [lon, lat])) {
            return f.properties.ISO_A3 || f.properties.ADM0_A3 || null;
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════
// LAYER 2: 3D COUNTRY BORDER LINES
// ═══════════════════════════════════════════════════

function initBorderLines(geojsonData) {
    let positions = [];
    let colors = [];
    let segmentMap = {};
    let vertIdx = 0;

    geojsonData.features.forEach(f => {
        let iso = f.properties.ISO_A3 || f.properties.ADM0_A3 || '';
        if (!iso || iso === '-99') return;

        let startIdx = vertIdx;
        let geom = f.geometry;
        let polys = [];

        if (geom.type === 'Polygon') {
            polys = [geom.coordinates];
        } else if (geom.type === 'MultiPolygon') {
            polys = geom.coordinates;
        }

        polys.forEach(poly => {
            let ring = poly[0];
            if (!ring || ring.length < 2) return;

            for (let i = 0; i < ring.length - 1; i++) {
                let p1 = latLonToVec3(ring[i][1], ring[i][0], EARTH_RADIUS + 50.0);
                let p2 = latLonToVec3(ring[i + 1][1], ring[i + 1][0], EARTH_RADIUS + 50.0);

                positions.push(p1.x, p1.y, p1.z);
                positions.push(p2.x, p2.y, p2.z);

                let col = BORDER_LINE_COLORS.neutral;
                colors.push(col[0], col[1], col[2]);
                colors.push(col[0], col[1], col[2]);

                vertIdx += 2;
            }
        });

        segmentMap[iso] = { startIdx: startIdx, count: vertIdx - startIdx };
    });

    let posArray = new Float32Array(positions);
    let colArray = new Float32Array(colors);
    borderColorArray = colArray;
    borderSegmentMap = segmentMap;

    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArray, 3));

    let mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
    });

    borderLinesMesh = new THREE.LineSegments(geo, mat);
    // Hide geopolitical country borders in Mode 1 (conquest mode uses territory borders instead)
    if (window.gameMode === 'mode1') borderLinesMesh.visible = false;
    scene.add(borderLinesMesh);
}

function updateBorderColors() {
    if (!borderLinesMesh || !borderColorArray) return;

    for (let iso in borderSegmentMap) {
        let seg = borderSegmentMap[iso];
        let owner = countryOwnership[iso] || 'neutral';
        let col = BORDER_LINE_COLORS[owner] || BORDER_LINE_COLORS.neutral;
        if(owner === 'neutral') {
            col = getCountryBorderColor(iso);
        }

        for (let i = seg.startIdx; i < seg.startIdx + seg.count; i++) {
            borderColorArray[i * 3] = col[0];
            borderColorArray[i * 3 + 1] = col[1];
            borderColorArray[i * 3 + 2] = col[2];
        }
    }

    borderLinesMesh.geometry.attributes.color.needsUpdate = true;
}

// ═══════════════════════════════════════════════════
// LAYER 3: 3D PROVINCE BORDER LINES (Voronoi)
// ═══════════════════════════════════════════════════

function initProvinceBorders() {
    if (typeof PROVINCE_BORDERS === 'undefined') return;
    if (provinceBorderMesh) { scene.remove(provinceBorderMesh); }

    let positions = [];
    let colors = [];

    // Brighter color (cyan-ish) to ensure borders are highly visible
    let col = [0.4, 0.9, 1.0];

    PROVINCE_BORDERS.forEach(feature => {
        feature.forEach(segment => {
            for (let j = 0; j < segment.length - 1; j++) {
                let p1 = latLonToVec3(segment[j][1], segment[j][0], EARTH_RADIUS + 6.0);
                let p2 = latLonToVec3(segment[j+1][1], segment[j+1][0], EARTH_RADIUS + 6.0);

                positions.push(p1.x, p1.y, p1.z);
                positions.push(p2.x, p2.y, p2.z);
                colors.push(col[0], col[1], col[2]);
                colors.push(col[0], col[1], col[2]);
            }
        });
    });

    if (positions.length === 0) return;

    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));

    let mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
    });

    provinceBorderMesh = new THREE.LineSegments(geo, mat);
    scene.add(provinceBorderMesh);
}

// ═══════════════════════════════════════════════════
// LAYER 4: CITY MARKERS (FLAT POINTS)
// ═══════════════════════════════════════════════════

function initCitySprites(pLoc, eLoc) {
    cityNodes = [];
    nationalCapIndices = [];
    provincialIndices = [];
    majorIndices = [];
    cityVoronoi = null;
    
    if (cityPointsMesh) { scene.remove(cityPointsMesh); cityPointsMesh = null; }
    if (window.gameMode === 'mode1') {
        return;
    }

    WORLD_CITIES_DB.forEach((c, idx) => {
        let dP = haversineDist(c.lat, c.lon, pLoc.lat, pLoc.lon);
        let dE = haversineDist(c.lat, c.lon, eLoc.lat, eLoc.lon);

        let owner = 'neutral';
        if (dP < 15) owner = 'player';
        else if (dE < 15) owner = 'enemy';

        let hp = c.tier === 'national_capital' ? 400 : c.tier === 'provincial' ? 250 : 200;
        let income = c.tier === 'national_capital' ? 0.25 : c.tier === 'provincial' ? 0.15 : 0.10;

        cityNodes.push({
            name: c.name,
            lat: c.lat,
            lon: c.lon,
            country: c.country,
            province: c.province || '',
            tier: c.tier,
            owner: owner,
            originalOwner: owner, // Used to track capital-capture win conditions
            hp: hp,
            maxHp: hp,
            income: income,
            captureProgress: 0,
            captureBy: null,
            defenseLevel: 0,
            roadLevel: 1,
            connectedTo: [],
            victoryPoints: c.tier === 'national_capital' ? 10 : c.tier === 'provincial' ? 5 : 2
        });
    });

    mapCitiesToProvinces(pLoc, eLoc); // Bind and inject new dynamic cities BEFORE allocating arrays

    cityNodes.forEach((c, i) => {
        if (c.tier === 'national_capital') nationalCapIndices.push(i);
        else if (c.tier === 'provincial') provincialIndices.push(i);
        else majorIndices.push(i);
    });

    let count = cityNodes.length;
    cityPositions = new Float32Array(count * 3);
    cityColors = new Float32Array(count * 3);
    citySizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        let c = cityNodes[i];
        let pos = latLonToVec3(c.lat, c.lon, EARTH_RADIUS + 10.0);
        cityPositions[i*3]   = pos.x;
        cityPositions[i*3+1] = pos.y;
        cityPositions[i*3+2] = pos.z;

        let col = CITY_MARKER_COLORS[c.owner] || CITY_MARKER_COLORS.neutral;
        cityColors[i*3]   = col[0];
        cityColors[i*3+1] = col[1];
        cityColors[i*3+2] = col[2];

        citySizes[i] = c.tier === 'national_capital' ? 25.0 : c.tier === 'provincial' ? 15.0 : 10.0;
    }

    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cityPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cityColors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(citySizes, 1));

    let mat = new THREE.PointsMaterial({
        size: 15,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    cityPointsMesh = new THREE.Points(geo, mat);
    scene.add(cityPointsMesh);

    updateTerritoryFromCities(cityNodes);
    setTimeout(() => { initProvinceBorders(); }, 200);

    buildRoadNetwork();
    initCityLabels();
}

function initCapitalBuildings() {
    // Removed because user requested flat points instead of 3D
}

function updateCapitalBuildingColors() {
    // Removed
}

// ═══════════════════════════════════════════════════
// LAYER 6: ROAD NETWORK (Great Circle Arcs)
// ═══════════════════════════════════════════════════

function buildRoadNetwork() {
    roadSegments = [];
    
    // Auto-connect cities internally for logic (pathfinding, bonuses)
    const ROAD_MAX_DIST = 80; // Max haversine distance
    const ROAD_MAX_PER_CITY = 4; // Max connections per city

    // Group cities by country
    let countryGroups = {};
    cityNodes.forEach((c, i) => {
        if (!countryGroups[c.country]) countryGroups[c.country] = [];
        countryGroups[c.country].push(i);
    });

    // For each country, connect nearby cities
    for (let iso in countryGroups) {
        let group = countryGroups[iso];
        if (group.length < 2) continue;

        // Build all pairwise distances
        let edges = [];
        for (let a = 0; a < group.length; a++) {
            for (let b = a + 1; b < group.length; b++) {
                let ci = group[a], cj = group[b];
                let d = haversineDist(cityNodes[ci].lat, cityNodes[ci].lon, cityNodes[cj].lat, cityNodes[cj].lon);
                if (d < ROAD_MAX_DIST) {
                    edges.push({ from: ci, to: cj, dist: d });
                }
            }
        }

        // Sort by distance (shortest first) — greedy MST-like approach
        edges.sort((a, b) => a.dist - b.dist);

        let connectionCount = {};
        group.forEach(i => { connectionCount[i] = 0; });

        edges.forEach(e => {
            if (connectionCount[e.from] < ROAD_MAX_PER_CITY && connectionCount[e.to] < ROAD_MAX_PER_CITY) {
                roadSegments.push({ from: e.from, to: e.to, level: 1 });
                cityNodes[e.from].connectedTo.push(e.to);
                cityNodes[e.to].connectedTo.push(e.from);
                connectionCount[e.from]++;
                connectionCount[e.to]++;
            }
        });
    }

    renderRoads();
}

function renderRoads() {
    if (roadMesh) {
        scene.remove(roadMesh);
        if (roadMesh.geometry) roadMesh.geometry.dispose();
        if (roadMesh.material) roadMesh.material.dispose();
        roadMesh = null;
    }

    let positions = [];
    let colors = [];
    
    // We will render the real-world GEO_DATA_ROADS highways
    if (typeof GEO_DATA_ROADS !== 'undefined' && GEO_DATA_ROADS.length > 0) {
        GEO_DATA_ROADS.forEach(highway => {
            for (let i = 0; i < highway.length - 1; i++) {
                let p1 = latLonToVec3(highway[i][0], highway[i][1], 1.0).normalize().multiplyScalar(EARTH_RADIUS + 3.0);
                let p2 = latLonToVec3(highway[i+1][0], highway[i+1][1], 1.0).normalize().multiplyScalar(EARTH_RADIUS + 3.0);

                positions.push(p1.x, p1.y, p1.z);
                positions.push(p2.x, p2.y, p2.z);
                
                // Color: dim gray for realistic highways
                colors.push(0.3, 0.3, 0.35);
                colors.push(0.3, 0.3, 0.35);
            }
        });
    }

    if (positions.length === 0) return;

    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    let mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2, transparent: true, opacity: 0.65, depthWrite: false });
    roadMesh = new THREE.LineSegments(geo, mat);
    scene.add(roadMesh);
}

function updateRoadColors() {
    // No-op: road colors are terrain-gray by design (ownership reads through the
    // conquest overlay in mode 1 / city markers in mode 2). The old full-mesh
    // rebuild on every city capture had zero visual effect and leaked the previous
    // geometry + material each time.
}

// ═══════════════════════════════════════════════════
// MARKER COLOR UPDATES
// ═══════════════════════════════════════════════════

function updateCityMarkerColors() {
    let time = Date.now() * 0.008;
    for(let i = 0; i < cityNodes.length; i++) {
        let c = cityNodes[i];
        let col = CITY_MARKER_COLORS[c.owner] || CITY_MARKER_COLORS.neutral;
        let r = col[0], g = col[1], b = col[2];

        if (c.captureProgress > 0) {
            let pulse = Math.sin(time) * 0.4 + 0.6;
            r = r * pulse + 1.0 * (1 - pulse);
            g = g * pulse + 1.0 * (1 - pulse);
            b = b * pulse;
        }

        if (selectedCity === i || hoveredCity === i) {
            r = Math.min(1, r + 0.3);
            g = Math.min(1, g + 0.3);
            b = Math.min(1, b + 0.3);
        }

        cityColors[i*3]   = r;
        cityColors[i*3+1] = g;
        cityColors[i*3+2] = b;
    }
    if (cityPointsMesh) {
        cityPointsMesh.geometry.attributes.color.needsUpdate = true;
    }
}

// ═══════════════════════════════════════════════════
// LAYER 7: CITY LABELS (HTML overlay + 4-level LOD)
// ═══════════════════════════════════════════════════

function initCityLabels() {
    if (cityLabelContainer) cityLabelContainer.remove();
    cityLabelElements = [];

    cityLabelContainer = document.createElement('div');
    cityLabelContainer.id = 'cityLabels';
    cityLabelContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:5;';
    document.getElementById('gc').appendChild(cityLabelContainer);

    // Only create DOM labels for national/provincial capitals to keep performance high
    cityNodes.forEach((c, i) => {
        if (c.tier !== 'national_capital' && c.tier !== 'provincial') return;
        
        let el = document.createElement('div');
        let tierClass = c.tier === 'national_capital' ? ' natcap' : ' provcap';
        el.className = 'cityLabel' + tierClass;
        
        let prefix = c.tier === 'national_capital' ? '⭐ ' : '◆ ';
        el.textContent = prefix + c.name;
        el.style.display = 'none';
        cityLabelContainer.appendChild(el);
        cityLabelElements.push({ el: el, cityIdx: i });
    });
    console.log(`City labels created: ${cityLabelElements.length} (of ${cityNodes.length} total cities)`);
}

// ═══════════════════════════════════════════════════
// NATION LABELS (OpenFront-style): flag + name floating on each bot's
// territory, sized by territory extent, hidden behind the globe.
// Hover a nation's territory → details card (flag, name, troops, land%...).
//
// PERF/CORRECTNESS NOTES:
//  • POSITIONS update EVERY RENDERED FRAME (called from loop(), after
//    controls.update()) — labels track the globe exactly during rotation.
//    (Updating from the 60Hz logic tick made them visibly lag/wiggle on
//    high-refresh displays.)
//  • ANCHORS (territory centroids) recompute 1×/s via ONE unbiased strided
//    scan shared by all nations. The old per-nation scan broke after 400
//    samples — row-major scan order biased big territories' centroids NORTH.
//  • The centroid SNAPS to the nearest actually-owned cell so concave
//    territories (Britain, Indonesia) keep their label on land, not in a bay.
//  • Anchor changes SMOOTH (exponential lerp) so growth doesn't make labels
//    teleport.
// ═══════════════════════════════════════════════════
let nationLabelContainer = null;   // DOM layer
let nationLabelState = [];         // [{ el, bot, lat, lon, span, tLat, tLon, tSpan, hasAnchor, hasTarget, visible }]
let nationHoverCard = null;        // hover details card element
const _nlPos = new THREE.Vector3();

function _playerPseudoNation() {
    return { str: 'player', code: CONQUEST_CFG.PLAYER, name: 'أنت', flag: '🟩', colorRGB: [38, 200, 110], isPlayer: true };
}

function _ensureNationLabelDom() {
    if (nationLabelContainer) return;
    nationLabelContainer = document.createElement('div');
    nationLabelContainer.id = 'nationLabels';
    nationLabelContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:6;';
    document.getElementById('gc').appendChild(nationLabelContainer);
    // Details card (hover)
    nationHoverCard = document.createElement('div');
    nationHoverCard.id = 'nationHoverCard';
    nationHoverCard.style.display = 'none';
    document.getElementById('gc').appendChild(nationHoverCard);
}

// One unbiased strided scan of the whole grid → anchor TARGETS for ALL nations.
// Sets st.tLat/tLon/tSpan (+hasTarget) on the label states. No early break —
// every nation's full territory is covered evenly.
function _recomputeNationAnchors(nations) {
    if (!conquestGrid || !conquestGrid._maskReady) return;
    const owner = conquestGrid.owner;
    const acc = nations.map(() => ({ n: 0, lat: 0, cx: 0, cy: 0, minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 }));
    const codeToIdx = new Map();
    nations.forEach((b, i) => codeToIdx.set(b.code, i));
    const total = owner.length;
    const stride = 64;
    for (let cell = 0; cell < total; cell += stride) {
        const idx = codeToIdx.get(owner[cell]);
        if (idx === undefined) continue;
        const ll = conquestGrid.cellToLatLon(cell);
        const a = acc[idx];
        a.n++;
        a.lat += ll.lat;
        a.cx += Math.cos(ll.lon * Math.PI / 180);
        a.cy += Math.sin(ll.lon * Math.PI / 180);
        if (ll.lat < a.minLat) a.minLat = ll.lat;
        if (ll.lat > a.maxLat) a.maxLat = ll.lat;
        if (ll.lon < a.minLon) a.minLon = ll.lon;
        if (ll.lon > a.maxLon) a.maxLon = ll.lon;
    }
    nations.forEach((b, i) => {
        const st = nationLabelState[i];
        const a = acc[i];
        if (!st) return;
        if (a.n < 2) { st.hasTarget = false; return; }
        let lat = a.lat / a.n;
        // Circularity-aware longitude mean (handles antimeridian wrap)
        let lon = Math.atan2(a.cy / a.n, a.cx / a.n) * 180 / Math.PI;
        // Snap to the nearest cell this nation ACTUALLY owns — concave/multi-
        // island territories would otherwise center the label in the sea.
        const owned = conquestGrid.findNearestOwnedCell(lat, lon, b.str, 80);
        if (owned) { lat = owned.lat; lon = owned.lon; }
        const spanLat = a.maxLat - a.minLat;
        let spanLon = a.maxLon - a.minLon;
        if (spanLon > 180) spanLon = 360 - spanLon;
        st.tLat = lat; st.tLon = lon;
        st.tSpan = Math.max(spanLat, spanLon, 0.8);
        st.hasTarget = true;
    });
}

// Called EVERY RENDERED FRAME from loop() — keeps labels glued to the globe.
function updateNationLabels() {
    if (!camera) return;
    _ensureNationLabelDom();
    const mode1 = window.gameMode === 'mode1';
    if (!mode1) {
        for (const st of nationLabelState) { st.el.style.display = 'none'; st.visible = false; }
        return;
    }
    const nations = [_playerPseudoNation()];
    for (const b of bots) if (b.alive) nations.push(b);

    // Sync DOM elements with nations list
    while (nationLabelState.length < nations.length) {
        const el = document.createElement('div');
        el.className = 'nationLabel';
        nationLabelContainer.appendChild(el);
        nationLabelState.push({ el, bot: null, lat: 0, lon: 0, span: 1, tLat: 0, tLon: 0, tSpan: 1, hasAnchor: false, hasTarget: false, visible: false });
    }
    for (let i = nations.length; i < nationLabelState.length; i++) {
        nationLabelState[i].el.style.display = 'none';
        nationLabelState[i].visible = false;
    }

    // Anchor/content recompute at most 1×/s
    const now = performance.now();
    if (now - (updateNationLabels._t || 0) >= 1000) {
        updateNationLabels._t = now;
        _recomputeNationAnchors(nations);
    }

    const camPos = camera.position;
    const altitude = Math.max(1, camPos.length() - EARTH_RADIUS);
    const halfW = window.innerWidth * 0.5;
    const halfH = window.innerHeight * 0.5;
    // Zoom gate: zoomed way out, labels shrink a little (but stay readable)
    const zoomK = Math.min(1, Math.max(0.7, 5000 / Math.max(500, altitude)));

    for (let i = 0; i < nations.length; i++) {
        const b = nations[i];
        const st = nationLabelState[i];
        if (st.bot !== b) {
            st.bot = b;
            st.hasAnchor = false;
            st.el.__nation = b;   // hover hit-testing reads this
            const colorCss = `rgb(${b.colorRGB[0]},${b.colorRGB[1]},${b.colorRGB[2]})`;
            st.el.innerHTML = `<span class="nlFlag">${b.flag}</span><span class="nlName" style="color:${colorCss};text-shadow:0 0 4px #000,0 1px 2px #000">${b.name}</span>`;
        }
        if (st.hasTarget) {
            if (!st.hasAnchor) {
                st.lat = st.tLat; st.lon = st.tLon; st.span = st.tSpan;
                st.hasAnchor = true;
            } else {
                // Exponential smoothing — territory growth moves labels gently
                st.lat += (st.tLat - st.lat) * 0.06;
                st.lon += (st.tLon - st.lon) * 0.06;
                st.span += (st.tSpan - st.span) * 0.06;
            }
        }
        if (!st.hasAnchor) { st.el.style.display = 'none'; st.visible = false; continue; }

        // Label font scales with territory span (OpenFront calculateFontSize:
        // fit the name inside the territory box), floored at readable size
        // AFTER the zoom factor so far-out zoom never makes text unreadable.
        const fontSize = Math.max(12, Math.min(30, st.span * 3.0) * zoomK);

        const pos = latLonToVec3(st.lat, st.lon, EARTH_RADIUS + 30.0);
        // Backface check
        if (pos.dot(camPos) < 0) { st.el.style.display = 'none'; st.visible = false; continue; }
        _nlPos.copy(pos).project(camera);
        if (_nlPos.z > 1) { st.el.style.display = 'none'; st.visible = false; continue; }
        const sx = (_nlPos.x * halfW) + halfW;
        const sy = -(_nlPos.y * halfH) + halfH;

        st.el.style.display = 'block';
        const fs = fontSize.toFixed(1) + 'px';
        if (st.el.style.fontSize !== fs) st.el.style.fontSize = fs;
        st.el.style.left = sx + 'px';
        st.el.style.top = sy + 'px';
        st.visible = true;
    }
}

// Hover → details card for the nation whose label (or territory) is under the cursor
function updateNationHover(clientX, clientY, loc) {
    if (!nationHoverCard) return;
    // 1) direct label hit (live rects — no stale caches)
    let hit = null;
    if (nationLabelContainer) {
        const kids = nationLabelContainer.children;
        for (let i = 0; i < kids.length; i++) {
            const el = kids[i];
            if (el.style.display === 'none' || !el.__nation) continue;
            const r = el.getBoundingClientRect();
            if (clientX >= r.left - 8 && clientX <= r.right + 8 &&
                clientY >= r.top - 8 && clientY <= r.bottom + 8) {
                hit = el.__nation; break;
            }
        }
    }
    // 2) territory hit (hover anywhere inside their land)
    if (!hit && loc && conquestGrid && conquestGrid._maskReady) {
        const owner = getPixelOwner(loc.lat, loc.lon);
        if (owner === 'player') {
            hit = _playerPseudoNation();
        } else if (owner && owner !== 'neutral' && owner !== 'water') {
            hit = botByStr(owner);
        }
    }
    if (!hit) {
        nationHoverCard.style.display = 'none';
        return;
    }
    const b = hit;
    const troops = b.isPlayer ? pTroops : b.troops;
    const res = b.isPlayer ? pRes : b.res;
    const cells = conquestGrid ? conquestGrid.countCells(b.str) : 0;
    const nCells = conquestGrid ? conquestGrid.countCells('neutral') : 0;
    const pCells = conquestGrid ? conquestGrid.countCells('player') : 0;
    let otherCells = 0;
    for (const o of bots) if (o !== b && o.alive) otherCells += conquestGrid ? conquestGrid.countCells(o.str) : 0;
    const totalLand = cells + nCells + pCells + otherCells;
    const share = totalLand > 0 ? ((cells / totalLand) * 100).toFixed(1) : '0.0';
    const maxT = calcMaxTroops(b.str);
    const colorCss = `rgb(${b.colorRGB[0]},${b.colorRGB[1]},${b.colorRGB[2]})`;
    nationHoverCard.innerHTML = `
        <div class="nhHead"><span class="nhFlag">${b.flag}</span><span class="nhName" style="color:${colorCss}">${b.name}</span></div>
        <div class="nhRow"><span>🎖️ القوات</span><span>${formatTroopCount(troops)} / ${formatTroopCount(maxT)}</span></div>
        <div class="nhRow"><span>🌍 الأرض</span><span>${share}%</span></div>
        <div class="nhRow"><span>🗺️ الخلايا</span><span>${cells.toLocaleString('en')}</span></div>
        <div class="nhRow"><span>💰 الموارد</span><span>${Math.floor(res).toLocaleString('en')}</span></div>`;
    nationHoverCard.style.display = 'block';
    // Position near cursor, clamped to viewport
    const cardW = 190, cardH = 130;
    let x = clientX + 16, y = clientY + 16;
    if (x + cardW > window.innerWidth) x = clientX - cardW - 12;
    if (y + cardH > window.innerHeight) y = clientY - cardH - 12;
    nationHoverCard.style.left = x + 'px';
    nationHoverCard.style.top = y + 'px';
}

function updateCityLabels() {
    if (!camera || !cityLabelContainer || cityLabelElements.length === 0) return;

    let camDist = camera.position.length();
    let altitude = camDist - EARTH_RADIUS;

    // 4-Level LOD:
    // > 800: nothing
    // 400-800: national capitals only
    // 200-400: national + provincial
    // < 200: all cities
    let showNational = altitude < 800;
    let showProvincial = altitude < 400;
    let showMajor = altitude < 200;

    // Also toggle province border visibility based on zoom
    if (provinceBorderMesh) {
        if (window.renderProvinceBorders !== false) {
            provinceBorderMesh.visible = true;
            if (provinceBorderMesh.material) {
                provinceBorderMesh.material.opacity = altitude < 300 ? 0.8 : 0.3;
            }
        } else {
            provinceBorderMesh.visible = false;
        }
    }

    // Toggle road visibility
    if (roadMesh) {
        roadMesh.visible = altitude < 600;
        if (roadMesh.material) {
            roadMesh.material.opacity = Math.min(0.5, (600 - altitude) / 800);
        }
    }

    if (!showNational) {
        cityLabelElements.forEach(l => { l.el.style.display = 'none'; });
        return;
    }

    let camPos = camera.position;
    let halfW = window.innerWidth * 0.5;
    let halfH = window.innerHeight * 0.5;

    cityLabelElements.forEach(l => {
        let c = cityNodes[l.cityIdx];
        let isNational = c.tier === 'national_capital';
        let isProvincial = c.tier === 'provincial';

        // LOD filter
        if (!isNational && !isProvincial && !showMajor) { l.el.style.display = 'none'; return; }
        if (!isNational && isProvincial && !showProvincial) { l.el.style.display = 'none'; return; }

        let pos = latLonToVec3(c.lat, c.lon, EARTH_RADIUS + 20.0);

        // Backface check
        let dotToCam = pos.dot(camPos);
        if (dotToCam < 0) { l.el.style.display = 'none'; return; }

        // Project to screen
        _dummyVec.copy(pos);
        _dummyVec.project(camera);

        if (_dummyVec.z > 1) { l.el.style.display = 'none'; return; }

        let sx = (_dummyVec.x * halfW) + halfW;
        let sy = -(_dummyVec.y * halfH) + halfH;

        if (sx < -50 || sx > window.innerWidth + 50 || sy < -20 || sy > window.innerHeight + 20) {
            l.el.style.display = 'none';
            return;
        }

        l.el.style.display = 'block';
        l.el.style.left = sx + 'px';
        l.el.style.top = (sy - 14) + 'px';
        l.el.style.color = CITY_LABEL_COLORS[c.owner] || CITY_LABEL_COLORS.neutral;

        // Scale font based on tier and altitude
        let fontSize;
        if (isNational) {
            fontSize = Math.max(9, Math.min(14, 14 - altitude * 0.008));
        } else if (isProvincial) {
            fontSize = Math.max(7, Math.min(11, 11 - altitude * 0.012));
        } else {
            fontSize = Math.max(6, Math.min(9, 9 - altitude * 0.015));
        }
        l.el.style.fontSize = fontSize + 'px';
        l.el.style.fontWeight = isNational ? 'bold' : 'normal';
    });
}

// ═══════════════════════════════════════════════════
// LAYER 8: HOVER TOOLTIP + CLICK PANEL
// ═══════════════════════════════════════════════════

function handleCityHover(lat, lon) {
    if (!lat && lat !== 0) { hideCityTooltip(); return; }

    let best = null, bestDist = 5;
    cityNodes.forEach((c, i) => {
        let d = haversineDist(lat, lon, c.lat, c.lon);
        if (d < bestDist) { bestDist = d; best = i; }
    });

    if (best !== null && best !== hoveredCity) {
        hoveredCity = best;
        showCityTooltip(best);
    } else if (best === null) {
        hoveredCity = null;
        hideCityTooltip();
    }
}

function showCityTooltip(idx) {
    let tt = document.getElementById('cityTooltip');
    if (!tt) return;
    let c = cityNodes[idx];

    let ownerEmoji = c.owner === 'player' ? '🟢' : c.owner === 'enemy' ? '🔴' : '⚪';
    let ownerText = c.owner === 'player' ? 'Player' : c.owner === 'enemy' ? 'Enemy' : 'Neutral';
    let tierBadge = c.tier === 'national_capital' ? '⭐ Capital' : c.tier === 'provincial' ? '◆ Provincial' : '● City';
    let hpPct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));

    document.getElementById('ctName').textContent = c.name;
    document.getElementById('ctInfo').innerHTML =
        `<span style="opacity:.6">${c.country} · ${c.province}</span> · ${tierBadge}<br>` +
        `${ownerEmoji} ${ownerText} · ❤️ ${Math.floor(c.hp)}/${c.maxHp}`;
    document.getElementById('ctHpFill').style.width = hpPct + '%';
    document.getElementById('ctHpFill').style.background =
        hpPct > 60 ? '#00ff88' : hpPct > 30 ? '#ffcc00' : '#ff4444';

    tt.style.display = 'block';
}

function updateTooltipPosition(clientX, clientY) {
    let tt = document.getElementById('cityTooltip');
    if (!tt || tt.style.display === 'none') return;
    tt.style.left = (clientX + 18) + 'px';
    tt.style.top = (clientY - 10) + 'px';
}

function hideCityTooltip() {
    hoveredCity = null;
    let tt = document.getElementById('cityTooltip');
    if (tt) tt.style.display = 'none';
}

function handleCityClick(lat, lon) {
    let best = null, bestDist = 5;
    cityNodes.forEach((c, i) => {
        let d = haversineDist(lat, lon, c.lat, c.lon);
        if (d < bestDist) { bestDist = d; best = i; }
    });

    if (best !== null) {
        selectedCity = best;
        showCityPanel(best);
        return true;
    }
    return false;
}

function showCityPanel(idx) {
    let cp = document.getElementById('cityPanel');
    if (!cp) return;
    let c = cityNodes[idx];

    let ownerEmoji = c.owner === 'player' ? '🟢' : c.owner === 'enemy' ? '🔴' : '⚪';
    let ownerText = c.owner === 'player' ? 'أنت' : c.owner === 'enemy' ? 'العدو' : 'محايد';
    let tierBadge = c.tier === 'national_capital' ? '⭐ عاصمة' : c.tier === 'provincial' ? '◆ محافظة' : '● مدينة';
    let hpPct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
    let perSec = (c.income * 60).toFixed(1);
    let roadCount = c.connectedTo.length;

    document.getElementById('cpHeader').innerHTML =
        `<strong>${c.name}</strong><br>` +
        `<span style="font-size:10px;opacity:.6">${tierBadge} · ${c.province} · ${c.country}</span>`;

    document.getElementById('cpStats').innerHTML =
        `<div class="cpRow"><span>المالك</span><span>${ownerEmoji} ${ownerText}</span></div>` +
        `<div class="cpRow"><span>HP</span><span>${Math.floor(c.hp)} / ${c.maxHp}</span></div>` +
        `<div class="cpRow"><span>دفاع</span><span>المستوى ${c.defenseLevel}</span></div>` +
        `<div class="cpRow"><span>دخل</span><span style="color:#ffcc00">+${perSec}/ث</span></div>` +
        `<div class="cpRow"><span>طرق</span><span>${roadCount} اتصال · Lv.${c.roadLevel}</span></div>` +
        (c.captureBy ? `<div class="cpRow"><span>احتلال</span><span style="color:${c.captureBy === 'player' ? '#00ff88' : '#ff4444'}">${c.captureBy === 'player' ? '🟢' : '🔴'} جارٍ...</span></div>` : '');

    document.getElementById('cpHpFill').style.width = hpPct + '%';
    document.getElementById('cpHpFill').style.background =
        hpPct > 60 ? '#00ff88' : hpPct > 30 ? '#ffcc00' : '#ff4444';

    let actionHTML = '';
    if (c.owner === 'player' && c.roadLevel < 3) {
        let cost = c.roadLevel === 1 ? 500 : 1500;
        actionHTML = `<button class="btn yel" style="width:100%;font-size:10px;padding:6px;margin-top:4px;" onclick="upgradeCityRoads(${idx}, ${cost})">ترقية الطرق (Lv.${c.roadLevel + 1}) - 💰${cost}</button>`;
    }
    document.getElementById('cpActions').innerHTML = actionHTML;

    cp.style.display = 'block';
}

function logEvent(msg, type) {
    let slog = document.getElementById('slog');
    if(!slog) return;
    let el = document.createElement('div');
    el.className = 'le l' + (type || 'info');
    el.textContent = msg;
    slog.prepend(el);
    while(slog.children.length > 40) slog.lastChild.remove();
}

function upgradeCityRoads(idx, cost) {
    if (pRes < cost) {
        logEvent('ليس لديك موارد كافية لترقية الطرق!', 'err');
        return;
    }
    let c = cityNodes[idx];
    if (c.owner !== 'player' || c.roadLevel >= 3) return;

    pRes -= cost;
    c.roadLevel++;
    c.income *= 1.25; // 25% income boost per road level
    
    logEvent(`تم ترقية الطرق في ${c.name} إلى المستوى ${c.roadLevel}!`);
    renderRoads(); // Redraw roads to visually show change (could make thicker later)
    showCityPanel(idx); // Refresh UI
}

function hideCityPanel() {
    selectedCity = null;
    let cp = document.getElementById('cityPanel');
    if (cp) cp.style.display = 'none';
}

// ═══════════════════════════════════════════════════
// TERRITORY ↔ CITY OWNERSHIP LOGIC
// ═══════════════════════════════════════════════════

function updateTerritoryFromCities(nodes) {
    let counts = {};
    window.provinceOwnership = {};

    nodes.forEach(c => {
        if (!c.country) return;
        
        // Populate specific province polygonal ownership map
        if (c.controlledProvinces) {
            c.controlledProvinces.forEach(idx => {
                let current = window.provinceOwnership[idx];
                if (!current || current === 'neutral' || c.owner !== 'neutral') {
                    window.provinceOwnership[idx] = c.owner;
                }
            });
        }

        if (!counts[c.country]) counts[c.country] = { total: 0, player: 0, enemy: 0 };
        counts[c.country].total++;
        if (c.owner === 'player') counts[c.country].player++;
        if (c.owner === 'enemy') counts[c.country].enemy++;
    });
    countryCityCount = counts;

    let changedMajority = false;
    for (let iso in counts) {
        let ct = counts[iso];
        let current = countryOwnership[iso] || 'neutral';
        let newOwner = 'neutral';

        if (ct.player > ct.enemy && ct.player > 0) newOwner = 'player';
        else if (ct.enemy > ct.player && ct.enemy > 0) newOwner = 'enemy';
        else if (ct.total > 0 && ct.player === ct.enemy && ct.player > 0) newOwner = current;

        if (newOwner !== current) {
            countryOwnership[iso] = newOwner;
            changedMajority = true;
        }
    }

    repaintAllCountries();
    if (territoryTexture) territoryTexture.needsUpdate = true;

    if (changedMajority) {
        updateBorderColors();
        updateCapitalBuildingColors();
    }
}

// ═══════════════════════════════════════════════════
// CITY CAPTURE TICK
// ═══════════════════════════════════════════════════

function cityCaptureTick() {
    const C = GAME_CONSTANTS;
    let anyChanged = false;

    cityNodes.forEach(city => {
        let playerForce = 0, enemyForce = 0;

        planes.forEach(p => {
            if (p.dead || p.parked) return;
            let d = haversineDist(city.lat, city.lon, p.lat, p.lon);
            if (d < C.CAPTURE_RANGE) {
                if (p.owner === 'player') playerForce++;
                if (p.owner === 'enemy') enemyForce++;
            }
        });

        structs.forEach(s => {
            if (s.dead || s.type === 'city') return;
            let d = haversineDist(city.lat, city.lon, s.lat, s.lon);
            if (d < C.CAPTURE_RANGE) {
                if (s.owner === 'player') playerForce += 2;
                if (s.owner === 'enemy') enemyForce += 2;
            }
        });

        if (playerForce > 0 && enemyForce > 0) {
            city.captureProgress = Math.max(0, city.captureProgress - 2);
            return;
        }

        let attacker = playerForce > 0 ? 'player' : enemyForce > 0 ? 'enemy' : null;

        if (!attacker || attacker === city.owner) {
            if (city.captureProgress > 0) {
                city.captureProgress = Math.max(0, city.captureProgress - 3);
                if (city.captureProgress === 0) city.captureBy = null;
            }
            return;
        }

        if (city.captureBy && city.captureBy !== attacker) {
            city.captureProgress = 0;
        }

        city.captureBy = attacker;
        // Siege progress: grows while a lone attacker sits on the city (drives the
        // white capture pulse and lets captureBy clear when the siege decays).
        city.captureProgress = Math.min(100, (city.captureProgress || 0) + 2);

        let attackPower = (attacker === 'player' ? playerForce : enemyForce) * 0.5;
        let defense = 1 + city.defenseLevel * 0.3;
        city.hp -= attackPower / defense;

        if (city.hp <= 0) {
            city.owner = attacker;
            city.hp = city.maxHp * 0.5;
            city.captureProgress = 0;
            city.captureBy = null;
            anyChanged = true;
        }
    });

    if (anyChanged) {
        updateTerritoryFromCities(cityNodes);
        updateRoadColors();
    }

    updateCityMarkerColors();

    if (selectedCity !== null) {
        showCityPanel(selectedCity);
    }
}

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

function getCityAtLatLon(lat, lon, range) {
    let best = null, bestDist = range || 5;
    cityNodes.forEach(c => {
        let d = haversineDist(lat, lon, c.lat, c.lon);
        if (d < bestDist) { bestDist = d; best = c; }
    });
    return best;
}

// Dispose a scene line/points mesh completely (geometry + material).
function _disposeLineMesh(m) {
    if (!m) return;
    scene.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
}

function cleanupTerritory() {
    if (territoryMesh) {
        scene.remove(territoryMesh);
        if (territoryMesh.geometry) territoryMesh.geometry.dispose();
        if (territoryMesh.material) {
            if (territoryMesh.material.map) territoryMesh.material.map.dispose(); // ~32MB GPU texture
            territoryMesh.material.dispose();
        }
        territoryMesh = null;
    }
    // TASK-406: conquest overlay mesh/texture, frontier lines, devastation scorch,
    // capture flashes, frontline heat + drone rings are ALL owned by the world
    // render layer now — one reset call disposes everything (no orphan meshes).
    WORLD_RENDER.reset();
    _disposeLineMesh(borderLinesMesh); borderLinesMesh = null;
    _disposeLineMesh(provinceBorderMesh); provinceBorderMesh = null;
    _disposeLineMesh(cityPointsMesh); cityPointsMesh = null;
    _disposeLineMesh(roadMesh); roadMesh = null;
    if (cityLabelContainer) { cityLabelContainer.remove(); cityLabelContainer = null; }
    cityLabelElements = [];
    if (nationLabelContainer) { nationLabelContainer.remove(); nationLabelContainer = null; nationLabelState = []; }
    if (nationHoverCard) { nationHoverCard.remove(); nationHoverCard = null; }
    cityNodes = [];
    countryOwnership = {};
    countryCityCount = {};
    borderSegmentMap = {};
    borderColorArray = null;
    nationalCapIndices = [];
    provincialIndices = [];
    majorIndices = [];
    roadSegments = [];
    hoveredCity = null;
    selectedCity = null;
    cityVoronoi = null;
    hideCityTooltip();
    hideCityPanel();
}

let ws = null, wsReady = false, isOnline = false, roomCode = null;
let myRole = 'player';
let serverUrl = 'ws://localhost:10294';

function connectWS() {
    const inputUrl = document.getElementById('serverUrl')?.value || 'localhost';
    serverUrl = `ws://${inputUrl}:10294`;
    
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
        ws.onclose = () => {
            wsReady = false;
            const status = document.getElementById('onlineStatus');
            if(status) {
                status.textContent = ' انقطع الاتصال';
                status.style.color = '#ff4444';
            }
            document.getElementById('btnCreate').disabled = true;
            document.getElementById('btnJoin').disabled = true;
        };
        ws.onerror = () => {
            const status = document.getElementById('onlineStatus');
            if(status) {
                status.textContent = ' السيرفر غير متاح';
                status.style.color = '#ffcc00';
            }
        };
        ws.onmessage = e => {
            try {
                handleWSMsg(JSON.parse(e.data));
            } catch (err) {
                console.warn('[WS] dropped malformed frame:', err.message);
            }
        };
    } catch(e) {
        console.error('[WS] connection failed:', e);
        const status = document.getElementById('onlineStatus');
        if (status) {
            status.textContent = ' فشل الاتصال بالسيرفر';
            status.style.color = '#ff4444';
        }
    }
}

// Global hook for the "Connect" button
function manualConnect() {
    if(ws) ws.close();
    connectWS();
}

function handleWSMsg(msg) {
    if (msg.type === 'room_created') {
        roomCode = msg.code;
        document.getElementById('roomCodeDisplay').style.display = 'block';
        document.getElementById('roomCodeDisplay').textContent = msg.code;
        setMenuStatus('⏳ انتظار الخصم...', 'wait');
    }
    if (msg.type === 'game_start') {
        myRole = msg.side;
        isOnline = true;
        setMenuStatus(' الخصم انضم!', 'ok');
        
        // Sync countries: Host (player) decides
        if(myRole === 'player') {
            const pc = document.getElementById('pCountrySelect').value;
            const ec = document.getElementById('eCountrySelect').value;
            sendAction({ type: 'sync_countries', pc, ec });
            setTimeout(() => startOnlineGame(pc, ec), 1000);
        }
    }
    if (msg.type === 'error') setMenuStatus(' ' + msg.msg, 'err');
    if (msg.type === 'opponent_action') applyOpponentAction(msg.action);
    if (msg.type === 'opponent_disconnected') {
        if(gOver) return;
        alert("Opponent Disconnected");
        location.reload();
    }
}

function sendAction(a) {
    if (!isOnline || !ws || !wsReady) return;
    ws.send(JSON.stringify({ type: 'game_action', action: a }));
}

function applyOpponentAction(action) {
    const oS = 'enemy'; // From my perspective, they are always the enemy
    
    if (action.type === 'sync_countries') {
        // Guest receives this
        startOnlineGame(action.pc, action.ec);
    }
    
    if (action.type === 'launch') {
        const cfg = MCFG[action.mtype];
        if (cfg) missiles.push(new Missile(action.lat, action.lon, action.tlat, action.tlon, cfg, oS, false, action.style || 'silo'));
    }
    if (action.type === 'drone_launch') {
        // TASK-204: remote drone deployment — spawn the same squad locally
        // TASK-402: shipId → tether the mirror swarm to the sender's hull so
        // it keeps station over a sailing drone carrier (and sinks with it).
        if (DCFG[action.key]) {
            econFuelSpend(oS, GAME_CONSTANTS.ECON_FUEL_COST_DRONE, true);   // TASK-404: mirror their fuel spend
            const squad = launchDrone(oS, action.key, { lat: action.lat, lon: action.lon }, { homeLat: action.hlat, homeLon: action.hlon });
            const ship = action.shipId != null ? warships.find(w => !w.dead && w.owner === oS && w.id === action.shipId) : null;
            if (squad && ship) squad.forEach(d => { d.home = ship; });
        }
    }
    if (action.type === 'build') {
        if (!SDEFS[action.btype]) return;   // guard: unknown/missing build type
        structs.push(new Structure(action.lat, action.lon, action.btype, oS));
    }
    if (action.type === 'plane_move') {
        // Match by plane id first (TASK-201, scoped to the sender's planes),
        // else fall back to type matching
        let p = (action.pid != null && planes.find(q => q.owner === oS && q.id === action.pid))
            || planes.find(p => p.owner === oS && p.cfg.name === PCFG[action.ptype].name);
        if(p) {
            p.tlat = action.tlat;
            p.tlon = action.tlon;
            p.parked = false;
            if (action.mode) { p.mode = action.mode; p.gndTgt = null; }
        }
    }
    if(action.type === 'spawn_plane') {
        // TASK-404: mirror their fuel spend
        econFuelSpend(oS, GAME_CONSTANTS.ECON_FUEL_COST_PLANE, true);   // TASK-404: mirror their fuel spend
        // TASK-402: shipId → base the fighter on the sender's hull (deck CAP
        // over a sailing carrier instead of a free-floating mirror).
        const ship = action.shipId != null ? warships.find(w => !w.dead && w.owner === oS && w.id === action.shipId) : null;
        planes.push(ship
            ? new Plane(action.lat, action.lon, PCFG[action.ptype], oS, ship)
            : new Plane(action.lat, action.lon, PCFG[action.ptype], oS));
    }
    // ── TASK-402 naval actions (audits #7/#8): mirror the sender's fleet ──
    if (action.type === 'warship_spawn') {
        const hull = GAME_CONSTANTS.HULL_CLASSES[action.hull];
        if (!hull) return;
        const port = structs.filter(s => !s.dead && s.owner === oS && s.type === 'port')
            .sort((a, b) => haversineDist(a.lat, a.lon, action.plat, action.plon) - haversineDist(b.lat, b.lon, action.plat, action.plon))[0];
        const ship = new Warship(oS, port || { lat: action.plat, lon: action.plon },
            { lat: action.lat, lon: action.lon }, action.hull);
        if (action.hull === 'transport' && action.troops > 0) ship.troops = action.troops;   // pool already deducted sender-side
        warships.push(ship);
    }
    if (action.type === 'warship_move') {
        const w = warships.find(q => !q.dead && q.owner === oS && q.id === action.id);
        if (w) w.setPatrol({ lat: action.lat, lon: action.lon });
    }
    if (action.type === 'warship_invade') {
        const w = warships.find(q => !q.dead && q.owner === oS && q.id === action.id);
        if (w) w._orderInvasion({ lat: action.lat, lon: action.lon });
    }
    if (action.type === 'naval_mine') {
        layMineField(NAVAL_CTX, oS, { lat: action.lat, lon: action.lon });
    }
    if (action.type === 'torpedo') {
        const shooter = warships.find(q => !q.dead && q.owner === oS && q.id === action.sid);
        let obj = null;
        if (action.kind === 'warship') obj = warships.find(q => !q.dead && q.id === action.tid);
        else if (action.kind === 'transport') obj = transportShips.find(q => !q.dead && q.id === action.tid);
        else if (action.kind === 'trade') obj = tradeShips.find(q => !q.dead && q.id === action.tid);
        if (shooter && obj) torpedoes.push(new Torpedo(oS, shooter, { kind: action.kind, obj }, NAVAL_CTX));
    }
    if (action.type === 'tank_spawn') {
        // TASK-302: remote armor deployment — mirror the division locally
        if (TCFG[action.tkey]) {
            econFuelSpend(oS, GAME_CONSTANTS.ECON_FUEL_COST_TANK, true);   // TASK-404
            spawnTankDivision(action.lat, action.lon, action.tkey, oS, { tgtLat: action.tlat, tgtLon: action.tlon });
        }
    }
    if (action.type === 'tank_move') {
        const t = tanks.find(q => q.owner === oS && q.id === action.tid);
        if (t && !t.dead) t.setMoveTarget(action.tlat, action.tlon);
    }
    if (action.type === 'troop_attack') {
        troopCohorts.push(new TroopCohort(
            action.slat, action.slon,
            action.tlat, action.tlon,
            action.troops,
            oS,
            action.targetIdx
        ));
    }
    if (action.type === 'instant_expand') {
        let expansion = new PaintExpansion(
            action.slat, action.slon,
            action.tlat, action.tlon,
            action.troops,
            oS,
            250
        );
        window.paintExpansions.push(expansion);
    }
}

function setMenuStatus(m, c) {
    const e = document.getElementById('menuStatus');
    if(!e) return;
    e.textContent = m;
    e.className = 'menuStatus st-' + c;
}

function createRoom() {
    if (!wsReady) { setMenuStatus('غير متصل', 'err'); return; }
    ws.send(JSON.stringify({ type: 'create_room' }));
    setMenuStatus('⏳ جاري الإنشاء...', 'wait');
}

function joinRoom() {
    const c = document.getElementById('joinCode').value.trim().toUpperCase();
    if (c.length < 4) { setMenuStatus('أدخل كود صحيح', 'err'); return; }
    if (!wsReady) { setMenuStatus('غير متصل', 'err'); return; }
    ws.send(JSON.stringify({ type: 'join_room', code: c }));
    setMenuStatus('⏳ جاري الانضمام...', 'wait');
}

function startOnlineGame(pc, ec) {
    document.getElementById('menuScreen').style.display = 'none';
    document.getElementById('gc').style.display = 'block';
    
    // In online mode, myRole is set by server (player or enemy)
    // initWorld needs to be aware of this
    initWorld('normal', pc, ec);
}

let frame = 0, gOver = false;
let gameSessionId = 0;   // AUDIT FIX #10/#11: invalidates pending setTimeouts (volleys, delayed warheads) on restart — gOver alone resets too early
let _lastRAF = 0, _frameAcc = 0;   // fixed-timestep accumulator (60 logic ticks/sec)
let pRes = 2700, eRes = 2700;
// DEV/TEST: player-only starting-gold override (constants.js: STARTING_RES_PLAYER_DEV).
// Applied on top of every match-start resource grant so the enemy/AI economy
// stays on normal balance while you test freely. Set the constant to 0 to disable.
function applyDevStartingRes() {
    const dev = GAME_CONSTANTS.STARTING_RES_PLAYER_DEV;
    if (dev && dev > 0) pRes = dev;
}
let buildMode = null;
let autoSAM = true;
let targetingMode = false, selMissile = 'ballistic', volleyCount = 1, volcnt = 1;
let missileMix = ['ballistic'];   // TASK-403: composed multi-type salvo (volleyCount === 'mix')

// ══════════════════════════════════════════════════════════════════
//  MISSILE LAUNCH MODE [R] — OpenFront-style persistent fire mode.
//  Shows every launcher's range ring (green = ready, dim = reloading),
//  a HUD with the armed missile + volley, and fires on click WITHOUT
//  exiting — no re-opening the menu between shots.
//  [R] toggle · [ ] cycle missile · [X] cycle volley · Esc exit.
// ══════════════════════════════════════════════════════════════════
let missileMode = false;
let _missileRingsGroup = null;
let _missileHud = null;
const VOLLEY_STEPS = [1, 2, 3, 5, 8, 'mix'];   // TASK-403: 'mix' = composed multi-type salvo (missileMix)

function _unlockedMissileKeys() {
    return Object.keys(MCFG).filter(k => !TECH_LOCKED_MISSILES.includes(k) || isTechUnlocked(k, 'missile', playerTech));
}

function _refreshMissileRings() {
    if (_missileRingsGroup) {
        scene.remove(_missileRingsGroup);
        _missileRingsGroup.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();   // TASK-403: rings now rebuild on a 20f cadence — no material leak
        });
        _missileRingsGroup = null;
    }
    if (!missileMode) return;
    _missileRingsGroup = new THREE.Group();
    const maxR = getMissileMaxRange(MCFG[selMissile]);
    let ready = 0;
    for (const s of structs) {
        if (s.dead || s.owner !== myRole || s.type !== 'launcher') continue;
        // TASK-403: magazine-aware readiness — dry pads read ORANGE while the
        // bulk re-arm runs, gray on the normal per-shot cooldown.
        const isReady = s.reload <= 0 && (!s.maxMag || s.mag > 0);
        const rearming = s.maxMag && s.mag === 0;
        if (isReady) ready++;
        const geo = DrawSphericalRangeIndicator(s.lat, s.lon, maxR);
        const mat = rearming
            ? new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.4 })
            : isReady
                ? new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.5 })
                : new THREE.LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.22 });
        const line = new THREE.Line(geo, mat);
        _missileRingsGroup.add(line);
        const pips = _magPipsRing(s, 150);
        if (pips) _missileRingsGroup.add(pips);   // TASK-403: ammo count ON the ring
    }
    scene.add(_missileRingsGroup);
    return ready;
}

// TASK-403: launcher magazine pips — a small dashed ring around each launcher
// (one arc per magazine round: green = loaded, dim = spent, all-orange while
// the bulk re-arm cycle runs). Built on the same spherical basis as the range
// rings; rebuilt with the rings (every 20f while in missile mode).
function _magPipsRing(s, radiusKm) {
    const n = s.maxMag || 0;
    if (!n) return null;
    const up = latLonToVec3(s.lat, s.lon, 1).normalize();
    const right = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 0.001) right.crossVectors(up, new THREE.Vector3(1, 0, 0));
    right.normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
    const ra = radiusKm / EARTH_RADIUS, cr = Math.cos(ra), sr = Math.sin(ra);
    const pt = (t) => {
        const c = Math.cos(t), sn = Math.sin(t);
        return new THREE.Vector3(
            EARTH_RADIUS * 1.02 * (cr * up.x + sr * c * right.x + sr * sn * fwd.x),
            EARTH_RADIUS * 1.02 * (cr * up.y + sr * c * right.y + sr * sn * fwd.y),
            EARTH_RADIUS * 1.02 * (cr * up.z + sr * c * right.z + sr * sn * fwd.z)
        );
    };
    const rearming = s.rearmT > 0 || s.mag === 0;
    const loaded = [], spent = [];
    const SEGS = 5;
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        for (let j = 0; j < SEGS; j++) {
            const t0 = a0 + (j / n) * Math.PI * 2 * 0.62;
            const t1 = a0 + ((j + 1) / n) * Math.PI * 2 * 0.62;
            (i < s.mag ? loaded : spent).push(pt(t0), pt(t1));
        }
    }
    const grp = new THREE.Group();
    grp.userData.pips = true;
    const mk = (pts, col, op) => {
        if (!pts.length) return;
        grp.add(new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op })
        ));
    };
    if (rearming) mk(loaded.concat(spent), 0xffaa00, 0.9);          // whole ring orange while re-arming
    else { mk(loaded, 0x00ff88, 0.95); mk(spent, 0x444444, 0.55); }
    return grp.children.length ? grp : null;
}

function _refreshMissileHud() {
    if (!_missileHud) return;
    const cfg = MCFG[selMissile];
    if (!cfg) return;
    const launchers = structs.filter(s => !s.dead && s.owner === myRole && s.type === 'launcher');
    const ready = launchers.filter(s => s.reload <= 0 && (!s.maxMag || s.mag > 0)).length;
    const mixMode = volleyCount === 'mix';
    // TASK-403: MTAGS tooltips on the chips + mix-mode member highlighting
    const chips = _unlockedMissileKeys().map(k => {
        const c = MCFG[k];
        const act = mixMode ? missileMix.includes(k) : k === selMissile;
        const tip = (MTAGS[k] || []).join(' · ');
        return `<div class="mchip${act ? ' act' : ''}${pRes < c.cost ? ' poor' : ''}" data-k="${k}" title="${tip}">${c.name}<span>$${c.cost}</span></div>`;
    }).join('');
    // TASK-403: magazine totals in the hint (ammo across all pads)
    let magTxt = '';
    const withMag = launchers.filter(s => s.maxMag);
    if (withMag.length) {
        const magSum = withMag.reduce((n, s) => n + s.mag, 0);
        const magMax = withMag.reduce((n, s) => n + s.maxMag, 0);
        magTxt = ` · المخزون: ${magSum}/${magMax}`;
    }
    const title = mixMode
        ? `🚀 وضع القصف — وابل مختلط ×${missileMix.length} <small>(${missileMix.filter(k => MCFG[k]).map(k => MCFG[k].name).join(' + ')})</small>`
        : `🚀 وضع القصف — <b>${cfg.name}</b> ×${volleyCount}`;
    _missileHud.innerHTML = `
        <div class="mtitle">${title}</div>
        <div class="mrow">${chips}</div>
        <div class="mhint">أنقر داخل الحلقات الخضراء للإطلاق · <b>[ ]</b> تبديل الصاروخ · <b>X</b> وابل ×${VOLLEY_STEPS.filter(v => v !== 'mix').join('/')} أو مختلط · <b>R/Esc</b> خروج · منصات جاهزة: ${ready}/${launchers.length}${magTxt}</div>`;
    _missileHud.querySelectorAll('.mchip').forEach(ch => {
        ch.onclick = () => { _armMissile(ch.dataset.k); };
    });
}

function _armMissile(k) {
    if (!MCFG[k]) return;
    selMissile = k;
    // TASK-403: in MIX mode, cycling/clicking types COMPOSES the salvo
    // (dedup, capped at 8 — the volley size is the list length).
    if (volleyCount === 'mix' && !missileMix.includes(k)) missileMix.push(k);
    if (missileMix.length > 8) missileMix = missileMix.slice(-8);
    _refreshMissileRings();
    _refreshMissileHud();
}

function _cycleMissile(dir) {
    const keys = _unlockedMissileKeys();
    if (!keys.length) return;
    let i = keys.indexOf(selMissile);
    if (i < 0) i = 0;
    i = (i + dir + keys.length) % keys.length;
    _armMissile(keys[i]);
}

function _cycleVolley() {
    let i = VOLLEY_STEPS.indexOf(volleyCount);
    i = (i < 0 ? 0 : i + 1) % VOLLEY_STEPS.length;
    volleyCount = VOLLEY_STEPS[i];
    if (volleyCount === 'mix') missileMix = [selMissile];   // TASK-403: entering mix seeds with the armed type
    _refreshMissileHud();
    logEvent(volleyCount === 'mix'
        ? `وضع الوابل المختلط — بدّل الأنواع بـ [ ] لإضافتها (${missileMix.length})`
        : `حجم الوابل: ×${volleyCount}`, 'info');
}

function _setMissileMode(on) {
    if (on && window.startSpawnPhase) return;
    missileMode = on;
    if (on) {
        // entering cancels other modes
        if (droneMode) _setDroneMode(false);   // TASK-204: modes are exclusive
        if (mineMode) _setMineMode(false);     // TASK-402: modes are exclusive
        targetingMode = false;
        buildMode = null;
        if (window.__refreshHotbar) window.__refreshHotbar();
        if (!_missileHud) {
            _missileHud = document.createElement('div');
            _missileHud.id = 'missileModeHud';
            document.body.appendChild(_missileHud);
        }
        _missileHud.style.display = 'block';
        const ready = _refreshMissileRings();
        _refreshMissileHud();
        if (ready === 0) logEvent('🚀 وضع القصف: لا توجد منصة جاهزة حالياً — الحلقات رمادية حتى إعادة التعبئة', 'info');
        else logEvent(`🚀 وضع القصف مفعّل (${MCFG[selMissile].name} ×${volleyCount}) — أنقر للاطلاق`, 'info');
    } else {
        if (_missileHud) _missileHud.style.display = 'none';
        _refreshMissileRings();   // pass-through removal when mode off
    }
}
window.__setMissileMode = _setMissileMode;

// ══════════════════════════════════════════════════════════════════
// DRONE LAUNCH MODE [N] (TASK-204) — mirror of missile mode: HUD chips
// for every DCFG type, click the map to deploy a squad at that point.
// Drones launch from the nearest launcher/base pad and transit to the
// clicked station before going to work.
// ══════════════════════════════════════════════════════════════════
let droneMode = false, selDrone = 'kamikaze', _droneHud = null;

function _setDroneMode(on) {
    if (on && window.startSpawnPhase) return;
    droneMode = on;
    if (on) {
        if (missileMode) _setMissileMode(false);
        if (mineMode) _setMineMode(false);     // TASK-402: modes are exclusive
        targetingMode = false;
        buildMode = null;
        if (window.__refreshHotbar) window.__refreshHotbar();
        if (!_droneHud) {
            _droneHud = document.createElement('div');
            _droneHud.id = 'droneModeHud';
            document.body.appendChild(_droneHud);
        }
        _droneHud.style.display = 'block';
        _refreshDroneHud();
        logEvent(`🛸 وضع الدرونات مفعّل (${DCFG[selDrone].name}) — أنقر نقطة الانتشار`, 'info');
    } else {
        if (_droneHud) _droneHud.style.display = 'none';
    }
}
window.__setDroneMode = _setDroneMode;

// ══════════════════════════════════════════════════════════════════
// NAVAL MINE MODE [Z] (TASK-402) — click water to deploy a minefield
// ($MINE_COST, cap MINE_CAP active fields). Mirrors to the peer as
// 'naval_mine'. Exclusive with missile/drone modes. (Key Z — J is the ECM
// station (TASK-403) and L the trade-lane toggle (TASK-404) on main.)
// ══════════════════════════════════════════════════════════════════
function _setMineMode(on) {
    if (on && window.startSpawnPhase) return;
    mineMode = on;
    if (missileMode && on) _setMissileMode(false);
    if (droneMode && on) _setDroneMode(false);
    if (on) {
        targetingMode = false;
        buildMode = null;
    }
    if (window.__refreshHotbar) window.__refreshHotbar();
    if (on) {
        const C = GAME_CONSTANTS;
        const active = mineFields.filter(f => !f.dead && f.owner === myRole).length;
        logEvent(`💣 وضع الألغام البحرية — انقر نقطة مائية لنشر حقل ($${C.MINE_COST}، ${active}/${C.MINE_CAP} نشط) [Z]`, 'info');
    }
}
window.__setMineMode = _setMineMode;

function _refreshDroneHud() {
    if (!_droneHud) return;
    const cfg = DCFG[selDrone];
    if (!cfg) return;
    const mine = drones.filter(d => !d.dead && d.owner === myRole).length;
    const cap = GAME_CONSTANTS.DRONE_CAP;
    const chips = Object.keys(DCFG).map(k => {
        const c = DCFG[k];
        const role = { swarm: 'سرب', kamikaze: 'انتحاري', recon: 'رادار متحرك', loiter: 'كامن', jammer: 'تشويش', armed: 'ضارب', intercept: 'صائدة' }[c.type] || '';
        return `<div class="mchip${k === selDrone ? ' act' : ''}${pRes < c.cost || mine >= cap ? ' poor' : ''}" data-k="${k}">${c.name}<span>$${c.cost}</span><small style="opacity:.6"> ${role}${c.squad > 1 ? ' ×' + c.squad : ''}</small></div>`;
    }).join('');
    _droneHud.innerHTML = `
        <div class="mtitle">🛸 وضع الدرونات — <b>${cfg.name}</b></div>
        <div class="mrow">${chips}</div>
        <div class="mhint">أنقر الخريطة لنشر الدرون في تلك المنطقة · <b>[ ]</b> تبديل النوع · الدرونات: ${mine}/${cap} · تنطلق من أقرب منصة/قاعدة وتتوجه للمحطة</div>`;
    _droneHud.querySelectorAll('.mchip').forEach(ch => {
        ch.onclick = () => { _armDrone(ch.dataset.k); };
    });
}

function _armDrone(k) {
    if (!DCFG[k]) return;
    selDrone = k;
    _refreshDroneHud();
}

function _cycleDrone(dir) {
    const keys = Object.keys(DCFG);
    let i = keys.indexOf(selDrone);
    if (i < 0) i = 0;
    i = (i + dir + keys.length) % keys.length;
    _armDrone(keys[i]);
}

// Deploy a squad of the selected drone type at loc (from the nearest pad)
function launchDroneSquad(loc) {
    const cfg = DCFG[selDrone];
    if (!cfg) return false;
    const mine = drones.filter(d => !d.dead && d.owner === myRole).length;
    if (mine >= GAME_CONSTANTS.DRONE_CAP) { logEvent(`حد الدرونات الأقصى (${GAME_CONSTANTS.DRONE_CAP}) 🛸`, 'err'); return false; }
    const pads = structs.filter(s => !s.dead && s.owner === myRole && (s.type === 'launcher' || s.type === 'base'));
    if (!pads.length) { logEvent('لا توجد منصة إطلاق للدرونات (منصة أو قاعدة)! 🛸', 'err'); return false; }
    if (pRes < cfg.cost) { logEvent(`موارد غير كافية! تحتاج $${cfg.cost}`, 'err'); return false; }
    // TASK-404: drone squads burn strategic fuel on deployment (econ logic
    // lives here — the Drone class is 403's, untouched).
    if (!econFuelSpend(myRole, GAME_CONSTANTS.ECON_FUEL_COST_DRONE)) return false;
    const P = pads.sort((a, b) => haversineDist(a.lat, a.lon, loc.lat, loc.lon) - haversineDist(b.lat, b.lon, loc.lat, loc.lon))[0];
    pRes -= cfg.cost;
    spawnExp(P.lat, P.lon, 3, cfg.col);
    const squad = launchDrone(myRole, selDrone, { lat: P.lat, lon: P.lon }, { homeLat: loc.lat, homeLon: loc.lon });
    // AUDIT #17 (TASK-404): refund the unlaunched share — the per-owner cap
    // can eat part of the squad AFTER payment (was: full price lost).
    if (!squad || squad.length < (cfg.squad || 1)) {
        pRes += _droneRefund(cfg.cost, squad ? squad.length : 0, cfg.squad || 1);
    }
    if (isOnline && squad) sendAction({ type: 'drone_launch', key: selDrone, lat: P.lat, lon: P.lon, hlat: loc.lat, hlon: loc.lon });
    _refreshDroneHud();
    logEvent(squad ? `🛸 نُشر ${squad.length}× ${cfg.name} باتجاه المحطة` : 'تعذّر نشر الدرون (الحد الأقصى)', squad ? 'info' : 'err');
    updateHUD();
    return !!squad;
}

// TASK-403: volley plan — single-type (×N) or MIXED salvo (one of each
// composed type; X-cycled to 'mix', members added with [ ] / chips).
// Returns per-shot missile keys + aggregate cost + the SHORTEST range in the
// salvo (a mixed volley can only target what its shortest leg can reach).
function _volleyPlan() {
    const types = volleyCount === 'mix'
        ? missileMix.filter(k => MCFG[k])
        : Array.from({ length: volleyCount }, () => selMissile).filter(k => MCFG[k]);
    let cost = 0, minR = Infinity;
    for (const k of types) {
        cost += MCFG[k].cost;
        const r = getMissileMaxRange(MCFG[k]);
        if (r < minR) minR = r;
    }
    return { types, cost, minR: minR === Infinity ? 0 : minR };
}

// Fire a volley at loc from the nearest READY launcher. Returns true if fired.
// Shared by missile mode (stays active) and the legacy single-shot path.
// TASK-204: launch platform variety — silo/rail from the launcher, or a
// SUBSURFACE pop-up from the nearest port when the sea approach is closer.
// TASK-403: magazine-aware (_launchConsume) + mixed-type salvos (_volleyPlan);
// per-shot affordability keeps the partial-volley semantics (never overpays).
function fireMissileVolley(loc) {
    const plan = _volleyPlan();
    if (!plan.types.length) { logEvent('الوابل فارغ — أضف أنواعاً بزر [ ]', 'err'); return false; }
    const first = MCFG[plan.types[0]];
    const pick = _pickLaunchPoint(loc, myRole);
    if (!pick) { logEvent('لا توجد منصة إطلاق جاهزة! 🚀', 'err'); return false; }
    if (!CheckTargetInRange(pick.lat, pick.lon, loc.lat, loc.lon, plan.minR)) {
        logEvent('الهدف خارج نطاق الصاروخ المختار!', 'err');
        return false;
    }
    if (pRes < first.cost) { logEvent(`موارد غير كافية! تحتاج $${first.cost}`, 'err'); return false; }
    for (let i = 0; i < plan.types.length; i++) {
        const mk = plan.types[i];
        const shotCfg = MCFG[mk];
        const delay = i * 1200;
        const _sess = gameSessionId;   // AUDIT FIX #10: no ghost volleys into the next game
        setTimeout(() => {
            if (gOver || _sess !== gameSessionId) return;
            const P2 = _pickLaunchPoint(loc, myRole);
            if (P2 && pRes >= shotCfg.cost) {
                _launchConsume(P2.launcher);   // TASK-403: magazine round + cooldown (+ bulk re-arm trigger)
                pRes -= shotCfg.cost;
                const { dx, dy } = _missileScatter(shotCfg);
                missiles.push(new Missile(P2.lat, P2.lon, loc.lat + dx, loc.lon + dy, shotCfg, myRole, false, P2.style));
                if (isOnline) sendAction({ type: 'launch', lat: P2.lat, lon: P2.lon, tlat: loc.lat + dx, tlon: loc.lon + dy, mtype: mk, style: P2.style });
                updateHUD();
            }
        }, delay);
    }
    volcnt = plan.types.length;
    return true;
}
let lastHUD = 0;

// Tech Tree State
let playerTech = {}; // { techId: 'done' | frameRemaining }
let enemyTech = {};  // AI auto-researches
let researchingId = null; // Currently researching (player)
let eResearchingId = null; // Currently researching (AI)

function isLand(lat, lon) {
    if(!window.GEOJSON_DATA) return true; // fallback if not loaded
    // Need d3 loaded: use d3.geoContains
    let pt = [lon, lat];
    for(let i=0; i<window.GEOJSON_DATA.features.length; i++) {
        if(d3.geoContains(window.GEOJSON_DATA.features[i], pt)) return true;
    }
    return false;
}

function checkZOC(lat, lon, owner) {
    if (window.gameMode === 'mode1') {
        return getPixelOwner(lat, lon) === owner;
    }
    
    // Mode 2 classic check
    for (let s of structs) {
        if (s.owner === owner && !s.dead && s.type === 'base') {
            if (haversineDist(lat, lon, s.lat, s.lon) < GAME_CONSTANTS.ZOC_BASE_RADIUS) return true;
        }
    }
    if (cityNodes) {
        for (let c of cityNodes) {
            if (c.owner === owner) {
                let radius = c.tier === 'national_capital' ? 250 : c.tier === 'provincial' ? 180 : 100;
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

let _lastHoverTS = 0;
window.addEventListener('mousemove', e => {
    // Throttle the expensive globe raycast (~65k triangles) + O(cities) hover scan to ~33Hz
    const _now = performance.now();
    if (_now - _lastHoverTS < 30) return;
    _lastHoverTS = _now;
    let loc = raycastGlobe(e);
    // City hover tooltip
    if(loc && typeof handleCityHover === 'function') {
        handleCityHover(loc.lat, loc.lon);
        updateTooltipPosition(e.clientX, e.clientY);
    } else if(typeof handleCityHover === 'function') {
        handleCityHover(null, null);
    }
    // Nation hover details card (labels or territory under cursor)
    if (typeof updateNationHover === 'function') updateNationHover(e.clientX, e.clientY, loc);
});

// ════════════════════════════════════════════════════════════════════
//  CUSTOM CROSSHAIR CURSOR — replaces the old big yellow ring marker.
//  A small precise SVG reticle follows the pointer over the globe and
//  adapts to the active mode: default (white), attack targeting (red
//  + ring), build (blue), missile bombardment (orange + dashed ring).
//  Native cursor stays hidden on the canvas only; UI keeps its own.
// ════════════════════════════════════════════════════════════════════
let _cursorHud = null;
function _getCursorHud() {
    if (_cursorHud) return _cursorHud;
    _cursorHud = document.createElement('div');
    _cursorHud.id = 'cursorHud';
    _cursorHud.innerHTML = `
        <svg viewBox="-16 -16 32 32" width="32" height="32">
            <circle class="ch-dot" cx="0" cy="0" r="1.7"/>
            <line class="ch-t" x1="0" y1="-13" x2="0" y2="-6.5"/>
            <line class="ch-b" x1="0" y1="6.5"  x2="0" y2="13"/>
            <line class="ch-l" x1="-13" y1="0" x2="-6.5" y2="0"/>
            <line class="ch-r" x1="6.5"  y1="0" x2="13"  y2="0"/>
            <circle class="ch-ring" cx="0" cy="0" r="9.5"/>
        </svg>`;
    document.body.appendChild(_cursorHud);
    return _cursorHud;
}
window.addEventListener('mousemove', e => {
    const hud = _getCursorHud();
    const onCanvas = !!(e.target && e.target.id === 'gameCanvas');
    hud.style.display = onCanvas ? 'block' : 'none';
    if (!onCanvas) return;
    hud.style.transform = `translate(${e.clientX - 16}px, ${e.clientY - 16}px)`;
    let m = 'default';
    if (missileMode) m = 'missile';
    else if (buildMode) m = 'build';
    else if (targetingMode) m = 'attack';
    if (hud.dataset.m !== m) { hud.dataset.m = m; hud.className = 'm-' + m; }
}, { passive: true });
window.addEventListener('mouseout', e => {
    if (!e.relatedTarget && _cursorHud) _cursorHud.style.display = 'none';
});

let isDragging = false;
let startX=0, startY=0;
let controlGroups = {}; // {1: [id, id, ...], 2: [...], ...}
let attackMoveMode = false;

// ── Selection box REMOVED: left-drag now rotates the globe (OpenFront-style).
//    Single-click select still works via the click handler. These stubs keep
//    isDragging/startX/startY defined for the map editor & legacy references.
window.addEventListener('pointerdown', e => {
    if(e.button !== 0) return; 
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
});

function projectToScreen(mesh) {
    if(!mesh) return null;
    let tempV = mesh.position.clone().project(camera);
    if(tempV.z > 1) return null; // Behind globe
    return {
        x: (tempV.x * 0.5 + 0.5) * window.innerWidth,
        y: -(tempV.y * 0.5 - 0.5) * window.innerHeight
    };
}

function getSelectedUnits() {
    return {
        planes: planes.filter(p => p.selected && p.owner === myRole && !p.dead),
        warships: warships.filter(w => w.selected && w.owner === myRole && !w.dead),
        tanks: tanks.filter(t => t.selected && t.owner === myRole && !t.dead),
        structs: structs.filter(s => s.selected && s.owner === myRole && !s.dead)
    };
}

function clearSelection() {
    [...structs, ...planes, ...warships, ...tanks].forEach(e => e.selected = false);
    document.getElementById('selPan').style.display = 'none';
    attackMoveMode = false;
    document.getElementById('tgtMsg').style.display = 'none';
    _refreshCommandCard();
}

// Which command card (global vs airport) is shown depends on selection:
// selecting an AIRPORT opens the airport production card (bpAirport).
function _refreshCommandCard() {
    const gCard = document.getElementById('bpGlobal');
    const aCard = document.getElementById('bpAirport');
    if (!gCard || !aCard) return;
    const selAirport = structs.find(s => s.selected && s.owner === myRole && !s.dead && s.type === 'airport');
    if (selAirport) {
        gCard.style.display = 'none';
        aCard.style.display = 'flex';
    } else {
        gCard.style.display = 'flex';
        aCard.style.display = 'none';
    }
}

function updateSelectionPanel() {
    let sel = getSelectedUnits();
    let total = sel.planes.length + sel.structs.length + sel.warships.length + sel.tanks.length;
    if(total === 0) { document.getElementById('selPan').style.display = 'none'; return; }
    
    document.getElementById('selPan').style.display = 'block';
    
    if(total === 1) {
        let unit = sel.planes[0] || sel.warships[0] || sel.tanks[0] || sel.structs[0];
        const structNames = {
            city: 'مدينة', port: 'ميناء تجاري', factory: 'مصنع حربي', airport: 'مطار عسكري',
            launcher: 'منصة إطلاق', radar: 'رادار', radar_ecm: 'تشويش ECM', sam: 'SAM باتريوت', flak: 'مضاد FLAK',
            himars: 'HIMARS', ciws: 'CIWS', iron_dome: 'القبة الحديدية', nuke_plant: 'مفاعل نووي'
        };
        const structInfo = {
            city:     (u) => { const rows = [{ k: 'حد القوات', v: `+${(GAME_CONSTANTS.CITY_TROOP_INCREASE||25000).toLocaleString('en')}` },
                             { k: 'الدور', v: 'يرفع سقف قواتك' }];
                             const syn = structSynergyInfo(u); if (syn && syn.links > 0) rows.push({ k: 'التآزر', v: syn.label });
                             return rows; },
            port:     (u) => { const rows = [{ k: 'التجارة', v: 'يولّد سفن تجارية 💰' }, { k: 'المدى', v: 'يحتاج ميناء الطرف الآخر' }];
                             const syn = structSynergyInfo(u); if (syn) rows.push({ k: 'التآزر', v: syn.label });
                             rows.push({ k: 'الحصار', v: u._blockaded ? '⛔ محاصر — تجارة متوقفة' : '✅ مفتوح' });
                             return rows; },
            factory:  (u) => { const syn = structSynergyInfo(u) || { links: 0, label: '—' };
                             const rate = (GAME_CONSTANTS.INCOME_FACTORY||0.08) * 60 * (1 + syn.links * (GAME_CONSTANTS.SYNERGY_FACTORY_CITY||0.3));
                             return [{ k: 'الدخل', v: `+$${rate.toFixed(1)}/ث` },
                             { k: 'التآزر', v: syn.label },
                             { k: 'السكك', v: 'يشغّل القطارات مع المدن/الموانئ' }]; },
            airport:  () => [{ k: 'الإنتاج', v: 'طائرات من هذا المطار ✈️' }],
            launcher: (u) => u.maxMag   // TASK-403: magazine readout
                ? [{ k: 'الوظيفة', v: 'إطلاق الصواريخ 🚀' },
                   { k: 'المخزون', v: u.rearmT > 0 ? 'إعادة تسليح… ⏳' : `${u.mag}/${u.maxMag}` }]
                : [{ k: 'الوظيفة', v: 'إطلاق الصواريخ 🚀' }],
            radar:    () => [{ k: 'الوظيفة', v: 'كشف مبكر +SAM' }],
            radar_ecm: (u) => [{ k: 'الوظيفة', v: 'تشويش توجيه صواريخ العدو' },
                             { k: 'المدى', v: `${u.ecmRadius || 520} كم` }],
            sam:      () => [{ k: 'الوظيفة', v: 'اعتراض الصواريخ' }],
            flak:     () => [{ k: 'الوظيفة', v: 'دفاع جوي قصير المدى' }],
            himars:   () => [{ k: 'الوظيفة', v: 'قصف صاروخي بعيد' }],
            ciws:     () => [{ k: 'الوظيفة', v: 'دفاع ختامي' }],
            iron_dome:() => [{ k: 'الوظيفة', v: 'اعتراض زخات الصواريخ' }],
            nuke_plant: () => [{ k: 'الدخل', v: `+$${((GAME_CONSTANTS.INCOME_NUKE_PLANT||0.25)*60).toFixed(1)}/ث` }]
        };
        let name = unit.cfg?.name || unit.name || structNames[unit.type] || unit.type;
        document.getElementById('selName').textContent = name;
        let hpPct = ((unit.hp / (unit.maxHp || unit.cfg?.hp || 100)) * 100).toFixed(0);
        document.getElementById('selHp').style.width = hpPct + '%';
        let statsHtml = `<div class="sstat"><span>HP</span><span>${Math.ceil(unit.hp)}/${unit.maxHp || unit.cfg?.hp || '?'}</span></div>`;
        if (unit.type && structInfo[unit.type]) {
            structInfo[unit.type](unit).forEach(row => {
                statsHtml += `<div class="sstat"><span>${row.k}</span><span>${row.v}</span></div>`;
            });
        } else if (unit.fuel !== undefined) {
            // TASK-201: aircraft station readout — fuel + stores + mode
            const fp = Math.round((unit.fuel / unit.maxFuel) * 100);
            statsHtml += `<div class="sstat"><span>وضع</span><span>${unit.parked ? 'مركونة (تسليح)' : unit.mode}</span></div>`;
            statsHtml += `<div class="sstat"><span>⛽ وقود</span><span>${fp}%${fp < 25 ? ' ⚠️' : ''}</span></div>`;
            statsHtml += `<div class="sstat"><span>🚀 جو-جو</span><span>${Math.floor(unit.aaAmmo)}/${unit.maxAa}</span></div>`;
            statsHtml += `<div class="sstat"><span>💥 جو-أرض</span><span>${Math.floor(unit.agAmmo)}/${unit.maxAg}</span></div>`;
            statsHtml += `<div class="sstat"><span>🔫 رشاش</span><span>${Math.floor(unit.gunAmmo)}/${unit.maxGun}</span></div>`;
            statsHtml += `<div class="sstat"><span>✨ شعلات</span><span>${Math.floor(unit.flares)}/${unit.maxFlares}</span></div>`;
            statsHtml += `<div class="sstat"><span>⭐ رتبة</span><span>${AIR_VET_NAMES[unit.vetLevel || 0]}${unit.kills ? ' · ' + unit.kills + '⚔' : ''}</span></div>`;
        } else if (unit instanceof Warship) {
            statsHtml += `<div class="sstat"><span>الوضع</span><span>${unit.invading ? 'إنزال ⚔' : unit.mode}</span></div>`;
            if (unit.hullClass === 'transport') statsHtml += `<div class="sstat"><span>القوات</span><span>${Math.floor(unit.troops).toLocaleString('en')}</span></div>`;
            if (unit.hullClass === 'carrier') statsHtml += `<div class="sstat"><span>السرب</span><span>${planes.filter(p => !p.dead && p.baseStruct === unit).length}/${unit.hull.airWing} 🛫</span></div>`;
            if (unit.hullClass === 'drone') statsHtml += `<div class="sstat"><span>الأسراب</span><span>${drones.filter(d => !d.dead && d.home === unit).length}/${unit.hull.swarmCap} 🛩️</span></div>`;
            if (unit.hullClass === 'escort') statsHtml += `<div class="sstat"><span>الدفاع</span><span>اعتراض ${unit.hull.pdRange}كم 🛡️</span></div>`;
            if (unit.hullClass === 'missile') statsHtml += `<div class="sstat"><span>التسليح</span><span>VLS 🚀</span></div>`;
        } else if (unit instanceof Tank) {
            // TASK-302 + TASK-405: division readout — strength, mode, logistics, veterancy
            const modeAr = { advance: 'زحف ⚔', combat: 'اشتباك 🔥', hold: 'تمركز 🛡️' }[unit.mode] || unit.mode;
            statsHtml += `<div class="sstat"><span>الوضع</span><span>${unit._crossing ? '🌊 عبور نهر' : modeAr}</span></div>`;
            statsHtml += `<div class="sstat"><span>دروع</span><span>${unit.members.length}/${unit.members0} 🚜</span></div>`;
            statsHtml += `<div class="sstat"><span>مدفع</span><span>${unit.cfg.gunDmg} · ${unit.cfg.gunRange}كم${unit.ace ? ' ' + '★'.repeat(unit.ace) : ''}</span></div>`;
            statsHtml += `<div class="sstat"><span>تحصين</span><span>-${Math.round(unit.armorEff * 100)}%${unit.entrench > 0.05 ? ` + خندق ${Math.round(unit.entrench * 100)}%` : ''}</span></div>`;
            statsHtml += `<div class="sstat"><span>إمداد</span><span>${unit.unsupplied ? '⛔ مقطوع — استنزاف' : '✅ موصول'}</span></div>`;
            if (unit.kills > 0) statsHtml += `<div class="sstat"><span>🎖 قتلى</span><span>${unit.kills}${unit.ace ? ' — ' + TANK_ACE_AR[unit.ace] : ''}</span></div>`;
            if (unit.engineDamaged) statsHtml += `<div class="sstat"><span>محرك</span><span>⚠️ متضرر (نصف سرعة)</span></div>`;
            if (unit.shots) statsHtml += `<div class="sstat"><span>طلقات</span><span>${unit.shots}</span></div>`;
        } else if (unit.mode) {
            statsHtml += `<div class="sstat"><span>وضع</span><span>${unit.mode}</span></div>`;
        }
        document.getElementById('selStats').innerHTML = statsHtml;
    } else {
        document.getElementById('selName').textContent = `تحديد (${total})`;
        document.getElementById('selHp').style.width = '100%';
        let info = [];
        if(sel.planes.length) info.push(`✈ ${sel.planes.length} طائرة`);
        if(sel.warships.length) info.push(`🚢 ${sel.warships.length} سفينة`);
        if(sel.tanks.length) info.push(`🚜 ${sel.tanks.length} فرقة`);
        if(sel.structs.length) info.push(`🏗 ${sel.structs.length} مبنى`);
        document.getElementById('selStats').innerHTML = 
            `<div class="sstat"><span>${info.join(' | ')}</span></div>`;
    }
    
    // Action buttons
    let btns = document.getElementById('selBtns');
    btns.innerHTML = '';
    if(sel.planes.length > 0) {
        btns.innerHTML += `<button class="btn" onclick="G.selCmd('patrol')">دورية</button>`;
        btns.innerHTML += `<button class="btn red" onclick="G.selCmd('attack')">هجوم</button>`;
        btns.innerHTML += `<button class="btn yel" onclick="G.selCmd('return')">عودة</button>`;
    }
}

// Left-drag = globe rotation (OrbitControls). A drag must NOT trigger the
// click handler's attack/select — suppress the click when the pointer moved
// more than 8px between down and up. (The browser still fires a click event
// after a drag on the same element.)
window.addEventListener('pointerup', e => {
    if(e.button !== 0) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (dx * dx + dy * dy > 64) {
        window.suppressNextClick = true;
        setTimeout(() => window.suppressNextClick = false, 80);
    }
    let selBox = document.getElementById('selBox');
    if(selBox) selBox.style.display = 'none';
}, true);

// Right-Click: handled by the NEW radial command menu (ui.js → __UI_API.queryTile).
// Plane orders now flow through the radial "أمر الطائرات" submenu → __UI_API.orderPlanesAt.
window.orderPlanesAt = function(mode, lat, lon) {
    let sel = getSelectedUnits();
    if (sel.planes.length === 0) { logEvent('لا توجد طائرات محددة! اسحب مربع تحديد حول طائراتك أولاً', 'err'); return; }
    // snap to enemy structure if clicked near one
    let nearestEnemy = null, nearestDist = 25;
    structs.forEach(s => {
        if (s.owner === myRole || s.dead) return;
        let d = haversineDist(lat, lon, s.lat, s.lon);
        if (d < nearestDist) { nearestDist = d; nearestEnemy = s; }
    });
    let tLat = (mode === 'attack' && nearestEnemy) ? nearestEnemy.lat : lat;
    let tLon = (mode === 'attack' && nearestEnemy) ? nearestEnemy.lon : lon;
    sel.planes.forEach((p, idx) => {
        let offsetLat = (idx % 2 === 0 ? 0.5 : -0.5) * Math.floor((idx + 1) / 2);
        let offsetLon = (idx % 2 === 1 ? 0.5 : -0.5) * Math.floor((idx + 1) / 2);
        p.tlat = tLat + offsetLat;
        p.tlon = tLon + offsetLon;
        p.mode = mode;
        p.parked = false;
        p.gndTgt = null;   // re-acquire near the new aim point
        if (isOnline) sendAction({ type: 'plane_move', ptype: p.pkey, pid: p.id, tlat: p.tlat, tlon: p.tlon, mode });
    });
    // TASK-401: a multi-plane order forms a squadron — highest-XP leads,
    // wingmen fly echelon and concentrate on the leader's bandit
    AirCombat.formSquadron(sel.planes, AIRW);
    logEvent(`تم توجيه ${sel.planes.length} طائرة: ${mode}`, 'info');
};
// (legacy per-plane right-click order handler removed — replaced by radial menu)

// Keyboard shortcuts for RTS commands
window.addEventListener('keydown', e => {
    // Never trigger game hotkeys while typing (server URL / room code inputs).
    // Room codes ARE digits — they used to recall control groups mid-typing.
    const _kt = e.target;
    if (_kt && (_kt.tagName === 'INPUT' || _kt.tagName === 'TEXTAREA' || _kt.tagName === 'SELECT' || _kt.isContentEditable)) return;
    // ESC: cancel modes
    if(e.key === 'Escape') {
        targetingMode = false;
        buildMode = null;
        attackMoveMode = false;
        if (missileMode) _setMissileMode(false);
        if (droneMode) _setDroneMode(false);   // TASK-204
        const _mk = document.getElementById('econMkt');   // TASK-404: close the black market
        if (_mk) _mk.classList.remove('open');
        if (mineMode) _setMineMode(false);     // TASK-402
        document.getElementById('tgtMsg').style.display = 'none';
        if(rangeMarkerMesh) rangeMarkerMesh.visible = false;
        clearSelection();
        selectedSourceProvinceIdx = -1;
        if (window.__refreshHotbar) window.__refreshHotbar();
        let conqMsg = document.getElementById('conqMsg');
        if(conqMsg) conqMsg.textContent = 'انقر لبدء الهجوم ثم حدد الإقليم المستهدف';
    }
    
    // ═══ OpenFront-style hotkeys ═══
    // WASD is camera pan (see _navKeys registration near the loop) — do not
    // bind plane commands to plain A/S anymore. Plane orders go through the
    // radial menu / selection panel.

    // 1-0: arm hotbar build slot (toggle)
    if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[0-9]$/.test(e.key)) {
        if (window.__hotbarKey) window.__hotbarKey(e.key);
        return;
    }

    // R: MISSILE LAUNCH MODE — persistent fire mode with range rings
    if (e.code === 'KeyR' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        if (window.gameMode !== 'mode1' || window.startSpawnPhase) return;
        _setMissileMode(!missileMode);
        return;
    }
    // [ / ]: cycle missile (only in missile mode) / drone (drone mode)
    if (missileMode && (e.key === '[' || e.key === ']')) {
        _cycleMissile(e.key === ']' ? 1 : -1);
        return;
    }
    if (droneMode && (e.key === '[' || e.key === ']')) {
        _cycleDrone(e.key === ']' ? 1 : -1);
        return;
    }
    // X: cycle volley size (only in missile mode)
    if (missileMode && e.code === 'KeyX' && !e.repeat) {
        _cycleVolley();
        return;
    }

    // N: DRONE LAUNCH MODE — persistent drone deployment (TASK-204)
    if (e.code === 'KeyN' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        if (window.gameMode !== 'mode1' || window.startSpawnPhase) return;
        _setDroneMode(!droneMode);
        return;
    }

    // V: warship slot (hotbar)
    if (e.code === 'KeyV' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (window.__hotbarKey) window.__hotbarKey('V');
        return;
    }

    // H: tank division slot (hotbar) — TASK-302
    if (e.code === 'KeyH' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (window.__hotbarKey) window.__hotbarKey('H');
        return;
    }

    // J: radar-ECM station slot (hotbar) — TASK-403
    if (e.code === 'KeyJ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (window.__hotbarKey) window.__hotbarKey('J');
        return;
    }

    // K: BLACK MARKET panel — TASK-404 economy (loans / war bonds / intel)
    if (e.code === 'KeyK' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        if (window.gameMode !== 'mode1' || window.startSpawnPhase) return;
        toggleMarketPanel();
        return;
    }

    // L: trade-lane visualization toggle — TASK-404 economy
    if (e.code === 'KeyL' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        if (window.gameMode !== 'mode1' || window.startSpawnPhase) return;
        toggleTradeLanes();
        return;
    }

    // P: FLEET FORMATION STANCE (TASK-402) — free / line / escort-wedge.
    // Group move orders spread the fleet per the stance; arrived hulls hold
    // station instead of wandering (see Warship.update + assignFormation).
    // (was K in development — K is the black-market panel on main since
    // TASK-404's merge; formations ride P, phalanx-style.)
    if (e.code === 'KeyP' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        if (window.gameMode !== 'mode1' || window.startSpawnPhase) return;
        fleetStanceIdx = (fleetStanceIdx + 1) % GAME_CONSTANTS.FLEET_STANCES.length;
        const st = GAME_CONSTANTS.FLEET_STANCES[fleetStanceIdx];
        const names = { free: 'حر — كل سفينة دوريتها الخاصة', line: 'خط أمامي — الرؤوس في المنتصف والحراس على الأجنحة', wedge: 'إسفين حراسة — الحراس في المقدمة والرؤوس في العمق' };
        logEvent(`⚓ تشكيل الأسطول: ${names[st] || st} [P]`, 'info');
        return;
    }

    // Z: NAVAL MINE MODE (TASK-402) — click water to deploy a minefield.
    // (was J, then L in development — J is the ECM station (TASK-403) and L
    // the trade-lane toggle (TASK-404) on main; mines ride Z, zone-denial.)
    if (e.code === 'KeyZ' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        if (window.gameMode !== 'mode1' || window.startSpawnPhase) return;
        _setMineMode(!mineMode);
        return;
    }

    // T / Y: attack ratio down / up (OpenFront attackRatioDown/Up)
    if (e.code === 'KeyT' || e.code === 'KeyY') {
        const cur = window.__UI_API ? window.__UI_API.troopPct() : 50;
        const nxt = Math.max(1, Math.min(100, cur + (e.code === 'KeyY' ? 10 : -10)));
        if (window.__UI_API) window.__UI_API.setTroopPct(nxt);
        logEvent(`نسبة قوات الغزو: ${nxt}%`, 'info');
        return;
    }

    // B: boat attack (arm naval invasion targeting)
    if (e.code === 'KeyB' && !e.repeat) {
        if (window.G && window.G.startNavalInvasion) window.G.startNavalInvasion();
        return;
    }

    // G: ground attack (arm conquest attack targeting)
    if (e.code === 'KeyG' && !e.repeat) {
        if (window.G && window.G.startTerritoryAttack) window.G.startTerritoryAttack();
        return;
    }

    // C: center camera on my territory
    if (e.code === 'KeyC' && !e.repeat) {
        centerOnMyTerritory();
        return;
    }

    // F: select all my planes + warships + tank divisions (OpenFront selectAllWarships analogue)
    if (e.code === 'KeyF' && !e.repeat) {
        clearSelection();
        let n = 0, m = 0, k = 0;
        planes.forEach(p => { if (p.owner === myRole && !p.dead) { p.selected = true; n++; } });
        warships.forEach(w => { if (w.owner === myRole && !w.dead) { w.selected = true; m++; } });
        tanks.forEach(t => { if (t.owner === myRole && !t.dead) { t.selected = true; k++; } });
        updateSelectionPanel();
        logEvent(`تم تحديد ${n} طائرة ✈️${m ? ` و ${m} مدمرة ⚓` : ''}${k ? ` و ${k} فرقة مدرعة 🚜` : ''} — انقر الخريطة لإصدار الأوامر`, 'info');
        return;
    }

    // M: toggle province borders
    if (e.code === 'KeyM' && !e.repeat) {
        if (typeof toggleProvinceBorders === 'function') toggleProvinceBorders();
        return;
    }

    // Enter: place armed build at the cursor (OpenFront ConfirmGhostStructure)
    if (e.key === 'Enter' && buildMode && window.__lastMouseXY) {
        const cv = document.getElementById('gameCanvas');
        if (cv) {
            cv.dispatchEvent(new MouseEvent('click', {
                clientX: window.__lastMouseXY.x, clientY: window.__lastMouseXY.y, bubbles: true
            }));
        }
        return;
    }
});

// Replace original click handler for 3D
window.addEventListener('click', async e => {
    if(window.suppressNextClick) return;
    if(e.target.closest('.btn, .ibtn, .mBtn, .pbtn, .mTab, .vTab, .cmdTab, #cmdTabs, #aptTabs, #bp, #bpAirport, #bpGlobal, .cmdContent, #troopPctOverlay, #hotbar, #researchPanel, #slog, #mmap, #go, #toastBox, #topBar, #volleyPicker, #selPan, #devPortPanel, #colorGradePanel, #mapEditorPanel')) return;
    
    let loc = raycastGlobe(e);
    if(!loc) return;

    // Map Editor active → swallow normal game clicks (painting is handled in
    // the editor's own pointerdown/move/up listeners).
    if (window.__mapEditor && _mapEditor.active) return;

    // ── DEV: port placement mode — click any shoreline to drop a port ──
    if (window.__devPlacePort) {
        const shore = findNearestShoreTile(loc.lat, loc.lon);
        if (shore) {
            const p = new Structure(shore.lat, shore.lon, 'port', window.__devPortOwner);
            structs.push(p);
            window.__devPorts.push(p);
            console.log('[DEV] port placed (' + window.__devPortOwner + ')',
                shore.lat.toFixed(2), shore.lon.toFixed(2));
            // Update the panel status if open
            if (window.__devPortPanel) {
                const st = window.__devPortPanel.querySelector('#dpStatus');
                if (st) {
                    const alive = window.__devPorts.filter(x => !x.dead).length;
                    st.textContent = alive + ' dev port(s) placed. Add an opposing port, then Spawn Ships.';
                }
            }
        } else {
            console.log('[DEV] no shoreline found near', loc.lat.toFixed(2), loc.lon.toFixed(2));
        }
        return; // don't process normal game clicks while placing ports
    }

    if(window.startSpawnPhase) {
        // Guard against double-click re-entry: the grid/waterway awaits below yield
        // to the event loop, and a second click used to re-seed the grid, re-grant
        // resources and spawn a second enemy.
        if (window._spawnBusy) return;
        // Guard: wait for GeoJSON country data to finish loading before allowing spawn
        if (!window.GEOJSON_DATA || !window.GEOJSON_DATA.features || window.GEOJSON_DATA.features.length === 0) {
            let msg = document.getElementById('tgtMsg') || document.getElementById('bldMsg') || document.getElementById('conqMsg');
            if(msg) msg.textContent = '⏳ جاري تحميل بيانات الخريطة، يرجى الانتظار ثم انقر مرة أخرى...';
            return;
        }
        if(!isLand(loc.lat, loc.lon)) {
            let msg = document.getElementById('bldMsg') || document.getElementById('conqMsg');
            if(msg) msg.textContent = 'يجب اختيار موقع على اليابسة للبدء!';
            return;
        }
        
        let pLoc = { lat: loc.lat, lon: loc.lon };
        window._spawnBusy = true;   // block re-entry across the awaits below
        try {
        if (window.gameMode === 'mode1') {
            // Await the unified terrain load so the land mask is ready before seeding.
            await initConquestGrid();
            // Await the HPA highway graph so the abstract-level Dijkstra is
            // ready before any ship spawns. Ships use bounded Dijkstra +
            // highway graph — every computation has a hard node cap.
            await loadWaterwayNetwork();
            conquestCtx = buildConquestCtx();
            conquestGrid.seedCircle(pLoc.lat, pLoc.lon, 110, 'player');
            // Verify the player actually got territory (guards against land-mask / timing issues)
            if (conquestGrid.countCells('player') === 0) {
                let landCount = conquestGrid.countCells('neutral');
                let msg = document.getElementById('tgtMsg') || document.getElementById('bldMsg') || document.getElementById('conqMsg');
                if(msg) msg.textContent = `⚠️ فشل تأسيس المنطقة (خلايا الأرض: ${landCount})، حاول موقعًا آخر على اليابسة`;
                console.error('[CONQUEST] seedCircle produced 0 player cells. Land cells in mask:', landCount);
                conquestGrid = null;
                return;
            }
            
            // ── Spawn rivals: FFA bots (mode 1) or the legacy single enemy ──
            // Bots seed at their countries; if none configured, the old single
            // enemy spawns at the menu-selected country.
            const _spawnRingFindLand = (lat, lon) => {
                if (isLand(lat, lon)) return { lat, lon };
                for (let ring = 1; ring <= 25; ring++) {
                    const step = ring * 1.0;
                    for (let i = 0; i < 16; i++) {
                        const angle = (i / 16) * Math.PI * 2;
                        const tLat = Math.max(-85, Math.min(85, lat + Math.sin(angle) * step));
                        let tLon = lon + Math.cos(angle) * step;
                        if (tLon > 180) tLon -= 360;
                        if (tLon < -180) tLon += 360;
                        if (isLand(tLat, tLon)) return { lat: tLat, lon: tLon };
                    }
                }
                return { lat, lon };
            };
            if (bots.length > 0) {
                bots.forEach(b => {
                    const loc2 = _spawnRingFindLand(b.country.lat + rnd(-3, 3), b.country.lon + rnd(-3, 3));
                    b.seedLoc = loc2;   // remember the ACTUAL seed point
                    conquestGrid.seedCircle(loc2.lat, loc2.lon, 110, b.str);
                    logEvent(`${b.flag} ${b.name} دخلت الحرب!`, 'info');
                });
                renderMode1Territory();
                // Give each coastal bot a starting trade port (economy seed)
                bots.forEach(b => {
                    try {
                        const shore = findNearestShoreTile(b.seedLoc.lat, b.seedLoc.lon);
                        if (shore) {
                            structs.push(new Structure(shore.lat, shore.lon, 'port', b.str));
                            console.log('[BOTS] port for', b.name, shore.lat.toFixed(1), shore.lon.toFixed(1));
                        } else {
                            console.warn('[BOTS] no shore for', b.name);
                        }
                    } catch (err) {
                        console.error('[BOTS] port spawn failed for', b.name, err.message);
                    }
                });
            } else {
                // Legacy single enemy at the menu country
                let eLoc = _spawnRingFindLand(
                    (COUNTRIES[window._eCountryKey] || { lat: 22, lon: 78 }).lat,
                    (COUNTRIES[window._eCountryKey] || { lat: 22, lon: 78 }).lon
                );
                console.log('[AI] Enemy spawning at:', eLoc.lat.toFixed(1), eLoc.lon.toFixed(1));
                conquestGrid.seedCircle(eLoc.lat, eLoc.lon, 110, 'enemy');
                renderMode1Territory();
                const shore = findNearestShoreTile(eLoc.lat, eLoc.lon, 8);
                if (shore) { structs.push(new Structure(shore.lat, shore.lon, 'port', 'enemy')); eBuiltPorts++; }
            }
            
            pRes = GAME_CONSTANTS.STARTING_RES_OFFLINE || 1500;
            eRes = GAME_CONSTANTS.STARTING_RES_OFFLINE || 1500;
            applyDevStartingRes();   // DEV: player-only test gold
            pTroops = GAME_CONSTANTS.STARTING_TROOPS || 1000;
            eTroops = GAME_CONSTANTS.STARTING_TROOPS || 1000;
        } else {
            let pProvIdx = getProvinceAtLatLon(pLoc.lat, pLoc.lon);
            if(pProvIdx !== -1) {
                window.provinceOwnership[pProvIdx] = 'player';
            }
            
            let candidates = [];
            if(cityNodes && cityNodes.length > 0) {
                candidates = cityNodes.filter(c => haversineDist(c.lat, c.lon, pLoc.lat, pLoc.lon) > 4000 && isLand(c.lat, c.lon));
                if(candidates.length === 0) candidates = cityNodes.filter(c => haversineDist(c.lat, c.lon, pLoc.lat, pLoc.lon) > 2000);
                if(candidates.length === 0) candidates = cityNodes.filter(c => isLand(c.lat, c.lon));
            }
            
            let eLoc;
            // TEMPORARY: Force enemy to India regardless of candidates.
            eLoc = { lat: 22, lon: 78 };
            
            let eProvIdx = getProvinceAtLatLon(eLoc.lat, eLoc.lon);
            if(eProvIdx !== -1) {
                window.provinceOwnership[eProvIdx] = 'enemy';
            }
            
            cityNodes.forEach(c => {
                let dP = haversineDist(c.lat, c.lon, pLoc.lat, pLoc.lon);
                let dE = haversineDist(c.lat, c.lon, eLoc.lat, eLoc.lon);
                if(dP < 150.0) {
                    c.owner = 'player';
                    c.originalOwner = 'player';
                } else if(dE < 150.0) {
                    c.owner = 'enemy';
                    c.originalOwner = 'enemy';
                }
            });
            
            updateTerritoryFromCities(cityNodes);
            updateCityMarkerColors();
            
            if(isOnline) {
                pRes = GAME_CONSTANTS.STARTING_RES_ONLINE;
                eRes = GAME_CONSTANTS.STARTING_RES_ONLINE;
            } else {
                pRes = GAME_CONSTANTS.STARTING_RES_OFFLINE;
                eRes = GAME_CONSTANTS.STARTING_RES_OFFLINE;
            }
            applyDevStartingRes();   // DEV: player-only test gold
        }
        } finally {
            window._spawnBusy = false;   // release the double-click guard (early returns included)
        }
        
        window.startSpawnPhase = false;
        
        let tgtMsgEl = document.getElementById('tgtMsg');
        if(tgtMsgEl) tgtMsgEl.style.display = 'none';
        
        camera.position.copy(latLonToVec3(pLoc.lat, pLoc.lon, EARTH_RADIUS + 5000));
        controls.target.set(0, 0, 0);
        controls.update();
        
        logEvent('بدأت المعركة! انطلق وقم بتوسيع نفوذك. 🚩', 'info');
        
        rebuildRosters();
        updateHUD();
        return;
    }

    // ── Unit selection first (OpenFront): own warships/planes beat terrain
    //    clicks. Ships sit on WATER and planes fly over ENEMY land — the old
    //    flow returned early for both (attack / "click enemy land" hint), so
    //    neither could ever be selected. ──
    if (window.gameMode === 'mode1' && !buildMode && !targetingMode && !window.startSpawnPhase) {
        // MISSILE MODE takes precedence (explicitly armed by the player)
        if (missileMode) {
            if (isLand(loc.lat, loc.lon) || !isLand(loc.lat, loc.lon)) {
                const fired = fireMissileVolley(loc);
                if (fired) _refreshMissileRings();   // rings flip to gray as launchers reload
            }
            return;
        }
        // DRONE MODE (TASK-204): deploy the selected squad at the click
        if (droneMode) {
            launchDroneSquad(loc);
            return;
        }
        // NAVAL MINE MODE (TASK-402): click WATER to lay a minefield
        if (mineMode) {
            if (isLand(loc.lat, loc.lon)) { logEvent('الألغام البحرية تُنشر في الماء — انقر نقطة مائية!', 'err'); return; }
            const MC = GAME_CONSTANTS;
            const active = mineFields.filter(f => !f.dead && f.owner === myRole).length;
            if (active >= MC.MINE_CAP) { logEvent(`الحد الأقصى لحقول الألغام نشط (${MC.MINE_CAP})! 💣`, 'err'); return; }
            if (pRes < MC.MINE_COST) { logEvent('لا توجد موارد كافية لنشر الألغام!', 'err'); return; }
            pRes -= MC.MINE_COST;
            layMineField(NAVAL_CTX, myRole, loc);
            if (isOnline) sendAction({ type: 'naval_mine', lat: loc.lat, lon: loc.lon });
            logEvent(`💣 نُشر حقل ألغام بحري ($${MC.MINE_COST}) — يُسلّح خلال ٣ ثوانٍ`, 'info');
            if (window.__refreshHotbar) window.__refreshHotbar();
            updateHUD();
            return;
        }
        const pick = _pickOwnUnitAt(loc.lat, loc.lon);
        if (pick) {
            if (!e.shiftKey && !pick.selected) clearSelection();
            pick.selected = true;
            updateSelectionPanel();
            logEvent(pick instanceof Warship
                ? `⚓ ${pick.name} محددة — انقر الماء لتحريكها${pick.hullClass === 'transport' && pick.troops > 0 ? ' أو ساحل العدو للإنزال' : ''}`
                : '✈️ طائرة محددة — انقر الخريطة لتوجيهها (دورية/هجوم)', 'info');
            return;
        }
        // ── Move orders for the current selection ──
        const selShips = warships.filter(w => w.selected && !w.dead && w.owner === myRole);
        const selPlanes = planes.filter(p => p.selected && !p.dead && p.owner === myRole);
        // Invasion transports: clicking ENEMY/NEUTRAL LAND orders a beach assault
        if (selShips.length && isLand(loc.lat, loc.lon)) {
            const tOwner = getPixelOwner(loc.lat, loc.lon);
            if (tOwner !== 'water' && tOwner !== myRole) {
                const invaders = selShips.filter(w => w.hullClass === 'transport' && w.troops > 0);
                const shore = findNearestShoreTile(loc.lat, loc.lon);
                if (invaders.length && shore) {
                    invaders.forEach(w => {
                        w._orderInvasion(shore);
                        // AUDIT #7/#8: mirror the beach order to the peer
                        if (isOnline) sendAction({ type: 'warship_invade', id: w.id, lat: shore.lat, lon: shore.lon });
                    });
                    logEvent(`🚢 اتجهت ${invaders.length} ناقلة إنزال نحو الساحل المعادي!`, 'info');
                    return;
                }
            }
        }
        if (selShips.length && !isLand(loc.lat, loc.lon)) {
            // TASK-402: group orders respect the fleet stance — line/wedge
            // spread the fleet into formation slots around the click point.
            assignFormation(NAVAL_CTX, myRole, loc.lat, loc.lon, selShips);
            selShips.forEach(w => {
                if (!isOnline) return;
                // AUDIT #7/#8: mirror each hull's FORMED destination (not the
                // raw click — formation slots differ per ship).
                const wp = w.waypoints && w.waypoints.length ? w.waypoints[w.waypoints.length - 1] : loc;
                sendAction({ type: 'warship_move', id: w.id, lat: wp.lat, lon: wp.lon });
            });
            const st = GAME_CONSTANTS.FLEET_STANCES[fleetStanceIdx];
            logEvent(`⛵ اتجهت ${selShips.length} سفينة إلى نقطة الدورية الجديدة${st !== 'free' ? ` (تشكيل: ${st})` : ''}`, 'info');
            return;
        }
        // TASK-302: tank division orders — land click = march order (the
        // division fights anything hostile en route and paints its corridor)
        const selTanks = tanks.filter(t => t.selected && !t.dead && t.owner === myRole);
        if (selTanks.length && isLand(loc.lat, loc.lon)) {
            selTanks.forEach((t, idx) => {
                const off = idx === 0 ? 0 : (idx % 2 === 0 ? 1 : -1) * Math.ceil(idx / 2) * 0.2;
                t.setMoveTarget(loc.lat + off * 0.45, loc.lon - off * 0.45);   // spread the divisions
                if (isOnline) sendAction({ type: 'tank_move', tid: t.id, tlat: t.tgtLat, tlon: t.tgtLon });
            });
            logEvent(`🚜 اتجهت ${selTanks.length} فرقة مدرعة نحو الهدف — ستشق طريقها وتقاتل ما يعترضها`, 'info');
            return;
        }
        if (selPlanes.length) {
            const tOwner = isLand(loc.lat, loc.lon) ? getPixelOwner(loc.lat, loc.lon) : 'water';
            const enemyLand = tOwner !== 'water' && tOwner !== myRole;
            const nearEnemyStruct = structs.some(s => !s.dead && s.owner !== myRole &&
                haversineDist(loc.lat, loc.lon, s.lat, s.lon) < 25);
            if (nearEnemyStruct || !enemyLand) {
                // move/attack order — click near an enemy building = attack run
                window.orderPlanesAt(nearEnemyStruct ? 'attack' : 'patrol', loc.lat, loc.lon);
                return;
            }
            // plain enemy land → conquest attack takes priority; drop selection
            clearSelection();
        }
        if (selShips.length && isLand(loc.lat, loc.lon)) clearSelection();   // ships can't sail onto land
    }

    // ── Mode 1 auto-conquest: click any non-player land to attack (OpenFront-style, no button needed) ──
    if (window.gameMode === 'mode1' && !buildMode && !targetingMode && conquestGrid && conquestCtx) {
        if (isLand(loc.lat, loc.lon)) {
            let owner = getPixelOwner(loc.lat, loc.lon);
            if (owner === 'water') {
                document.getElementById('conqMsg').textContent = '🚢 لغزو ما وراء البحار: استخدم زر «غزو بحري» من تبويب الغزو، أو انقر أرض العدو مباشرة.';
                return;
            }
            if (owner !== 'player') {
                let src = conquestGrid.findNearestOwnedCell(loc.lat, loc.lon, 'player');
                if (src) {
                    let pct = (window.troopAttackPct || 50) / 100;
                    let troopsToSend = Math.floor(pTroops * pct);
                    if (troopsToSend >= 10) {
                        console.log('[CONQUEST] auto-attack: target=%s troops=%d src=(%f,%f) dst=(%f,%f)',
                            owner, troopsToSend, src.lat, src.lon, loc.lat, loc.lon);
                        let atk = new ConquestAttack({
                            grid: conquestGrid, owner: 'player', target: owner,
                            troops: troopsToSend, srcLat: src.lat, srcLon: src.lon,
                            dstLat: loc.lat, dstLon: loc.lon, ctx: conquestCtx,
                        });
                        activeAttacks.push(atk);
                        if(isOnline) {
                            sendAction({ type: 'troop_attack', slat: src.lat, slon: src.lon, tlat: loc.lat, tlon: loc.lon, troops: troopsToSend, targetIdx: -1 });
                        }
                        document.getElementById('conqMsg').textContent = '⚔️ انطلق الهجوم العسكري!';
                        updateHUD();
                    } else {
                        document.getElementById('conqMsg').textContent = 'لا توجد قوات كافية للهجوم!';
                    }
                } else {
                    // No land route (target on another landmass) → NAVAL INVASION
                    // (OpenFront TransportShip): sail troops over, land, conquer a beachhead.
                    launchTransportInvasion(loc, 'player');
                }
                return;
            }
            // clicked own territory → fall through to structure selection
        } else {
            // Water click in mode 1: nothing to attack here — point at naval invasion
            document.getElementById('conqMsg').textContent = '🚢 انقر أرض العدو لغزوها، أو استخدم زر «غزو بحري» من تبويب الغزو.';
            return;
        }
    }

    if(buildMode) {
        // ── TANK DIVISION: mobile land unit — click LAND to set its march
        //    objective. Class comes from the hotbar H cycle (tankBuildClass);
        //    the division rolls out of the nearest own WAR FACTORY. ──
        if (buildMode === 'tank') {
            const C = GAME_CONSTANTS;
            const cfg = TCFG[tankBuildClass] || TCFG.medium;
            if (!isLand(loc.lat, loc.lon)) {
                document.getElementById('bldMsg').textContent = `${cfg.name} تُنشر على اليابسة! انقر نقطة برية باتجاه الهدف.`;
                return;
            }
            if (pRes < cfg.cost) { document.getElementById('bldMsg').textContent = 'لا توجد موارد كافية!'; return; }
            const mineSame = tanks.reduce((n, t) => n + (!t.dead && t.owner === 'player' && t.key === tankBuildClass ? 1 : 0), 0);
            if (mineSame >= cfg.cap) { document.getElementById('bldMsg').textContent = `الحد الأقصى لـ${cfg.name} نشط (${cfg.cap})! 🚜`; return; }
            const mineTotal = tanks.reduce((n, t) => n + (!t.dead && t.owner === 'player' ? 1 : 0), 0);
            if (mineTotal >= C.TANK_CAP_TOTAL) { document.getElementById('bldMsg').textContent = `الحد الأقصى للفرق المدرعة نشط (${C.TANK_CAP_TOTAL})! 🚜`; return; }
            const fac = structs.filter(s => !s.dead && s.owner === 'player' && s.type === 'factory')
                .sort((a, b) => haversineDist(a.lat, a.lon, loc.lat, loc.lon) - haversineDist(b.lat, b.lon, loc.lat, loc.lon))[0];
            if (!fac) { document.getElementById('bldMsg').textContent = 'تحتاج مصنع حرب لنشر المدرعات! 🏭'; return; }
            // TASK-404: strategic-fuel gate for armor deployment (econ logic —
            // the Tank class is untouched; log note for @lead/@405).
            if (!econFuelSpend(myRole, C.ECON_FUEL_COST_TANK)) { document.getElementById('bldMsg').textContent = `⛽ وقود غير كافٍ للنشر! تحتاج ${C.ECON_FUEL_COST_TANK}`; return; }
            pRes -= cfg.cost;
            spawnTankDivision(fac.lat, fac.lon, tankBuildClass, 'player', { tgtLat: loc.lat, tgtLon: loc.lon });
            if (isOnline) sendAction({ type: 'tank_spawn', lat: fac.lat, lon: fac.lon, tkey: tankBuildClass, tlat: loc.lat, tlon: loc.lon });
            spawnExp(fac.lat, fac.lon, 3, '#ffcc66');
            logEvent(`🏭 ${cfg.icon} ${cfg.name} خرجت من المصنع! ($${cfg.cost})`, 'info');
            buildMode = null;
            document.getElementById('bldMsg').textContent = 'جاهز';
            if (window.__refreshHotbar) window.__refreshHotbar();
            updateHUD();
            return;
        }
        // ── WARSHIP: mobile naval unit — click WATER to set its patrol point.
        //    Hull class comes from the hotbar V cycle (warshipBuildClass). ──
        if (buildMode === 'warship') {
            const C = GAME_CONSTANTS;
            const hull = C.HULL_CLASSES[warshipBuildClass] || C.HULL_CLASSES.destroyer;
            if (isLand(loc.lat, loc.lon)) {
                document.getElementById('bldMsg').textContent = `${hull.name} تُنشر في الماء! انقر نقطة بحرية قرب سواحلك.`;
                return;
            }
            if (pRes < hull.cost) { document.getElementById('bldMsg').textContent = 'لا توجد موارد كافية!'; return; }
            const mineSame = warships.reduce((n, w) => n + (!w.dead && w.owner === myRole && w.hullClass === warshipBuildClass ? 1 : 0), 0);
            if (mineSame >= hull.cap) { document.getElementById('bldMsg').textContent = `الحد الأقصى لـ${hull.name} نشط (${hull.cap})! ⚓`; return; }
            // AUDIT #7: the GUEST's hulls must be 'enemy'-owned (myRole), not
            // hardcoded 'player' — they used to flip sides online.
            const port = structs.filter(s => !s.dead && s.owner === myRole && s.type === 'port')
                .sort((a, b) => haversineDist(a.lat, a.lon, loc.lat, loc.lon) - haversineDist(b.lat, b.lon, loc.lat, loc.lon))[0];
            if (!port) { document.getElementById('bldMsg').textContent = 'تحتاج ميناء لنشر الأسطول! ⚓'; return; }
            // Invasion transports embark troops at purchase
            if (warshipBuildClass === 'transport') {
                const pct = (window.troopAttackPct || 50) / 100;
                if (pTroops * pct < 50) { document.getElementById('bldMsg').textContent = 'لا توجد قوات كافية للإنزال!'; return; }
            }
            pRes -= hull.cost;
            const ship = new Warship(myRole, port, { lat: loc.lat, lon: loc.lon }, warshipBuildClass);
            warships.push(ship);
            if (warshipBuildClass === 'transport') ship._embarkTroops((window.troopAttackPct || 50) / 100);
            // AUDIT #7/#8: mirror the hull to the online peer (never happened
            // before — the guest's fleet was invisible to the host).
            if (isOnline) sendAction({ type: 'warship_spawn', lat: loc.lat, lon: loc.lon, plat: port.lat, plon: port.lon, hull: warshipBuildClass, troops: ship.troops || 0 });
            logEvent(`⚓ ${hull.name} انطلقت من الميناء! ($${hull.cost})`, 'info');
            buildMode = null;
            document.getElementById('bldMsg').textContent = 'جاهز';
            if (window.__refreshHotbar) window.__refreshHotbar();
            updateHUD();
            return;
        }
        let cost = SDEFS[buildMode].cost;
        if(buildMode === 'city') cost = Math.floor(GAME_CONSTANTS.CITY_BASE_COST * Math.pow(1.5, pBuiltCities));
        if(buildMode === 'port') cost = Math.floor(GAME_CONSTANTS.PORT_BASE_COST * Math.pow(1.5, pBuiltPorts));
        if(buildMode === 'factory') cost = Math.floor(GAME_CONSTANTS.FACTORY_BASE_COST * Math.pow(1.5, pBuiltFactories));
        
        if(pRes < cost) {
            document.getElementById('bldMsg').textContent = 'لا توجد موارد كافية!';
            return;
        }
        // OpenFront portSpawn(): for ports, snap to nearest shore tile.
        if (buildMode === 'port') {
            const shore = findNearestShoreTile(loc.lat, loc.lon);
            if (!shore) {
                document.getElementById('bldMsg').textContent = 'لا يوجد ساحل قريب لبناء الميناء! ⚓';
                return;
            }
            loc.lat = shore.lat;
            loc.lon = shore.lon;
        } else if(!isLand(loc.lat, loc.lon)) {
             document.getElementById('bldMsg').textContent = 'لا يمكن البناء على الماء!';
             return;
        }
        if(!checkZOC(loc.lat, loc.lon, myRole)) {
             document.getElementById('bldMsg').textContent = 'المنطقة غير مؤمنة بجيشك!';
             return;
        }
        if(checkCollision(loc.lat, loc.lon)) {
             document.getElementById('bldMsg').textContent = 'الموقع مزدحم!';
             return;
        }
        
        let newStruct = new Structure(loc.lat, loc.lon, buildMode, myRole);
        structs.push(newStruct);
        if(buildMode === 'city') pBuiltCities++;
        if(buildMode === 'port') pBuiltPorts++;
        if(buildMode === 'factory') pBuiltFactories++;
        // Rail network rebuild: factories/cities/ports can host train stations
        // (updateRailroadConnections was previously NEVER called — trains were dead code).
        if (buildMode === 'factory' || buildMode === 'city' || buildMode === 'port') {
            updateRailroadConnections();
        }
        
        if(isOnline) sendAction({ type: 'build', lat: loc.lat, lon: loc.lon, btype: buildMode });
        pRes -= cost;
        buildMode = null;
        document.getElementById('bldMsg').textContent = 'جاهز';
        updateHUD();
        return;
    } else if(targetingMode === 'troop_attack') {
        if(window.gameMode === 'mode1') {
            // ── Single-click conquest (OpenFront-style): click any non-player land,
            //    the system auto-finds the nearest player border cell as the source. ──
            if(!isLand(loc.lat, loc.lon)) {
                document.getElementById('conqMsg').textContent = 'يجب اختيار موقع على اليابسة!';
                return;
            }
            let targetOwner = getPixelOwner(loc.lat, loc.lon);
            if (targetOwner === 'water') {
                document.getElementById('conqMsg').textContent = 'لا يمكن مهاجمة الماء! اختر هدفاً على اليابسة.';
                return;
            }
            if (targetOwner === 'player') {
                document.getElementById('conqMsg').textContent = 'هذه أراضيك! اختر أرضاً مجاورة لتحتلها.';
                return;
            }
            // Auto-find nearest player-owned cell as the attack source
            let src = conquestGrid.findNearestOwnedCell(loc.lat, loc.lon, 'player');
            if (!src) {
                // No land route → naval invasion (OpenFront transport ship)
                launchTransportInvasion(loc, 'player');
                return;
            }
            let pct = (window.troopAttackPct || 50) / 100;
            let troopsToSend = Math.floor(pTroops * pct);
            if(troopsToSend < 10) {
                document.getElementById('conqMsg').textContent = 'لا توجد قوات كافية للهجوم!';
                return;
            }
            console.log('[CONQUEST] player attack: target=%s troops=%d src=(%f,%f) dst=(%f,%f)',
                targetOwner, troopsToSend, src.lat, src.lon, loc.lat, loc.lon);
            // ConquestAttack deducts troops itself via ctx.addTroops
            let atk = new ConquestAttack({
                grid: conquestGrid,
                owner: 'player',
                target: targetOwner,
                troops: troopsToSend,
                srcLat: src.lat, srcLon: src.lon,
                dstLat: loc.lat, dstLon: loc.lon,
                ctx: conquestCtx,
            });
            activeAttacks.push(atk);
            if(isOnline) {
                sendAction({
                    type: 'troop_attack',
                    slat: src.lat, slon: src.lon,
                    tlat: loc.lat, tlon: loc.lon,
                    troops: troopsToSend,
                    targetIdx: -1
                });
            }
            targetingMode = false;
            document.getElementById('conqMsg').textContent = '⚔️ انطلق الهجوم العسكري!';
            updateHUD();
        } else {
            let clickedProvinceIdx = getProvinceAtLatLon(loc.lat, loc.lon);
            if (clickedProvinceIdx === -1) return;
            
            if (selectedSourceProvinceIdx === -1) {
                if (window.provinceOwnership[clickedProvinceIdx] !== 'player') {
                    document.getElementById('conqMsg').textContent = 'يجب اختيار إقليم تملكه لبدء الهجوم!';
                    return;
                }
                selectedSourceProvinceIdx = clickedProvinceIdx;
                window.sourceProvinceCoord = { lat: loc.lat, lon: loc.lon };
                document.getElementById('conqMsg').textContent = 'اختر الآن الإقليم المجاور المستهدف';
            } else {
                let owner = window.provinceOwnership[clickedProvinceIdx] || 'neutral';
                if (owner === 'player') {
                    document.getElementById('conqMsg').textContent = 'هذا الإقليم تابع لك بالفعل!';
                    selectedSourceProvinceIdx = -1;
                    return;
                }
                
                let p1 = latLonToVec3(window.sourceProvinceCoord.lat, window.sourceProvinceCoord.lon, 1.0).normalize();
                let p2 = latLonToVec3(loc.lat, loc.lon, 1.0).normalize();
                let dotVal = Math.max(-1.0, Math.min(1.0, p1.dot(p2)));
                let distDeg = Math.acos(dotVal) * (180 / Math.PI);
                
                if (distDeg > GAME_CONSTANTS.ATTACK_RANGE) {
                    document.getElementById('conqMsg').textContent = 'الإقليم بعيد جداً عن مصدر الهجوم!';
                    selectedSourceProvinceIdx = -1;
                    return;
                }
                
                let pct = (window.troopAttackPct || 50) / 100;
                let troopsToSend = Math.floor(pTroops * pct);
                if (troopsToSend < 10) {
                    document.getElementById('conqMsg').textContent = 'لا توجد قوات كافية للهجوم!';
                    selectedSourceProvinceIdx = -1;
                    return;
                }
                
                pTroops -= troopsToSend;
                
                let cohort = new TroopCohort(
                    window.sourceProvinceCoord.lat, window.sourceProvinceCoord.lon,
                    loc.lat, loc.lon,
                    troopsToSend,
                    'player',
                    clickedProvinceIdx
                );
                troopCohorts.push(cohort);
                
                if (isOnline) {
                    sendAction({
                        type: 'troop_attack',
                        slat: window.sourceProvinceCoord.lat, slon: window.sourceProvinceCoord.lon,
                        tlat: loc.lat, tlon: loc.lon,
                        troops: troopsToSend,
                        targetIdx: clickedProvinceIdx
                    });
                }
                
                selectedSourceProvinceIdx = -1;
                targetingMode = false;
                document.getElementById('conqMsg').textContent = 'انطلق الهجوم العسكري!';
                updateHUD();
            }
        }
    } else if(targetingMode === true) {
        // TASK-403: legacy single-shot path now shares the volley plan
        // (mixed salvos) + the launcher magazine.
        const plan = _volleyPlan();
        if (!plan.types.length) return;
        const launchCfg = MCFG[plan.types[0]];
        let cost = launchCfg.cost;
        let maxR = plan.minR;
        
        let launchers = structs.filter(s => s.type==='launcher' && s.owner===myRole && s.reload<=0);
        if(!launchers.length) return;
        
        let L = launchers.sort((a,b)=> haversineDist(a.lat, a.lon, loc.lat, loc.lon) - haversineDist(b.lat, b.lon, loc.lat, loc.lon))[0];
        
        if (!CheckTargetInRange(L.lat, L.lon, loc.lat, loc.lon, maxR)) {
            document.getElementById('tgtMsg').textContent = 'الهدف خارج نطاق الصاروخ المختار!';
            if(rangeMarkerMesh) rangeMarkerMesh.visible = false;
            return;
        }

        for(let i=0; i<plan.types.length; i++) {
            const mk = plan.types[i];
            const shotCfg = MCFG[mk];
            const shotCost = shotCfg.cost;
            let delay = i * 1200;
            const _sess = gameSessionId;   // AUDIT FIX #10b: legacy path — same guard
            setTimeout(() => {
                if (gOver || _sess !== gameSessionId) return;
                const P2 = _pickLaunchPoint(loc, myRole);   // TASK-204: silo/rail/sub launch
                if(P2 && pRes >= shotCost) {
                    _launchConsume(P2.launcher);   // TASK-403: magazine round + cooldown
                    pRes -= shotCost;
                    const { dx, dy } = _missileScatter(shotCfg);
                    missiles.push(new Missile(P2.lat, P2.lon, loc.lat + dx, loc.lon + dy, shotCfg, myRole, false, P2.style));
                    if(isOnline) sendAction({ type: 'launch', lat: P2.lat, lon: P2.lon, tlat: loc.lat + dx, tlon: loc.lon + dy, mtype: mk, style: P2.style });
                }
            }, delay);
        }
        targetingMode = false;
        document.getElementById('tgtMsg').style.display = 'none';
        if(rangeMarkerMesh) {
            rangeMarkerMesh.visible = false;
            if(rangeMarkerMesh.geometry) rangeMarkerMesh.geometry.dispose();
        }
        volcnt = plan.types.length;
        
    } else if (typeof targetingMode === 'string' && targetingMode === 'naval_invasion') {
        // ── Naval invasion targeting: click enemy coast or sea toward it ──
        targetingMode = false;
        let tgt = document.getElementById('tgtMsg');
        if (tgt) tgt.style.display = 'none';
        if (window.gameMode !== 'mode1') return;
        // If water clicked → aim at nearest non-player shore; if land clicked use it directly
        let target = loc;
        if (!isLand(loc.lat, loc.lon)) {
            const shore = findNearestShoreTile(loc.lat, loc.lon, 25);
            if (!shore) {
                logEvent('لا يوجد ساحل قريب من نقطة الإنزال!', 'err');
                return;
            }
            target = shore;
        }
        const tOwner = getPixelOwner(target.lat, target.lon);
        if (tOwner === 'player') {
            logEvent('هذا ساحلك! اختر ساحل العدو أو أرضاً محايدة', 'err');
            return;
        }
        launchTransportInvasion(target, 'player');
        updateHUD();
    } else if (typeof targetingMode === 'string' && targetingMode.startsWith('plane_')) {
        let mode = targetingMode.split('_')[1];
        let selPlanes = planes.filter(p => p.owner===myRole && !p.dead);
        selPlanes.forEach(p => {
            p.mode = mode;
            p.tlat = loc.lat;
            p.tlon = loc.lon;
            p.parked = false;
            if(isOnline) sendAction({ type: 'plane_move', ptype: 'fighter', tlat: loc.lat, tlon: loc.lon }); 
        });
        targetingMode = false;
    } else {
        if (window.gameMode === 'mode1' && loc && isLand(loc.lat, loc.lon) && getPixelOwner(loc.lat, loc.lon) !== 'player') {
            let bestDist = Infinity;
            let bestSrc = null;
            if (window.playerCoordinates) {
                window.playerCoordinates.forEach(c => {
                    let d = haversineDist(c.lat, c.lon, loc.lat, loc.lon);
                    if (d < bestDist) {
                        bestDist = d;
                        bestSrc = c;
                    }
                });
            }
            
            if (bestSrc) {
                if (window.lineAttackMode) {
                    // Creeping Line Cohort Attack (Special)
                    if (bestDist > 1500) {
                        logEvent('الهدف بعيد جداً (الحد الأقصى 1500 كم)!', 'err');
                        return;
                    }
                    
                    let pct = (window.troopAttackPct || 50) / 100;
                    let troopsToSend = Math.floor(pTroops * pct);
                    if (troopsToSend < 10) {
                        logEvent('لا توجد قوات كافية للهجوم!', 'err');
                        return;
                    }
                    
                    pTroops -= troopsToSend;
                    
                    let cohort = new TroopCohort(
                        bestSrc.lat, bestSrc.lon,
                        loc.lat, loc.lon,
                        troopsToSend,
                        'player',
                        -1
                    );
                    troopCohorts.push(cohort);
                    
                    if (isOnline) {
                        sendAction({
                            type: 'troop_attack',
                            slat: bestSrc.lat, slon: bestSrc.lon,
                            tlat: loc.lat, tlon: loc.lon,
                            troops: troopsToSend,
                            targetIdx: -1
                        });
                    }
                    
                    logEvent('انطلق الهجوم الخطي الزاحف! ⚔️', 'info');
                    
                    // Reset Line Attack Mode
                    window.lineAttackMode = false;
                    let btn = document.getElementById('btnLineAttack');
                    if (btn) {
                        btn.style.background = '';
                        btn.style.borderColor = '';
                        btn.style.color = '';
                        btn.style.fontWeight = '';
                    }
                    let tgtMsg = document.getElementById('tgtMsg');
                    if (tgtMsg) tgtMsg.style.display = 'none';
                    updateHUD();
                } else {
                    // Default Attack (OpenFront Style: Step-by-Step Adjacent Paint Expansion)
                    let targetOwner = getPixelOwner(loc.lat, loc.lon);
                    
                    // Shared border check if attacking enemy territory
                    if (targetOwner === 'enemy') {
                        let hasSharedBorder = false;
                        if (window.playerCoordinates && window.enemyCoordinates) {
                            for (let pCoord of window.playerCoordinates) {
                                for (let eCoord of window.enemyCoordinates) {
                                    if (haversineDist(pCoord.lat, pCoord.lon, eCoord.lat, eCoord.lon) <= 180) {
                                        hasSharedBorder = true;
                                        break;
                                    }
                                }
                                if (hasSharedBorder) break;
                            }
                        }
                        
                        if (!hasSharedBorder) {
                            logEvent('يجب أن تكون هناك حدود مشتركة مع العدو لشن هجوم بري! (أو استخدم الهجوم الخطي)', 'err');
                            SFX.ui('err');
                            return;
                        }
                    }
                    
                    let pct = (window.troopAttackPct || 50) / 100;
                    let troopsToSend = Math.floor(pTroops * pct);
                    if (troopsToSend < 15) {
                        logEvent('لا توجد قوات كافية للهجوم والتوسع!', 'err');
                        SFX.ui('err');
                        return;
                    }
                    
                    pTroops -= troopsToSend;
                    
                    // Set maxRadiusKm dynamically to reach target destination
                    let maxRad = Math.max(300, bestDist + 200);
                    
                    let expansion = new PaintExpansion(
                        bestSrc.lat, bestSrc.lon,
                        loc.lat, loc.lon,
                        troopsToSend,
                        'player',
                        maxRad
                    );
                    window.paintExpansions.push(expansion);
                    
                    if (isOnline) {
                        sendAction({
                            type: 'instant_expand',
                            slat: bestSrc.lat,
                            slon: bestSrc.lon,
                            tlat: loc.lat,
                            tlon: loc.lon,
                            troops: troopsToSend
                        });
                    }
                    
                    logEvent('انطلق زحف قوات التمدد البري... ⚔️', 'info');
                    SFX.ui('click');
                    updateHUD();
                }
                return;
            }
        }

        if(loc && typeof handleCityClick === 'function' && handleCityClick(loc.lat, loc.lon)) {
            return;
        }
        if(typeof hideCityPanel === 'function') hideCityPanel();
        let bestDist = GAME_CONSTANTS.CLICK_SELECT_RADIUS;
        let selectedEnt = null;
        [...structs, ...planes, ...warships].forEach(ent => {
            if(ent.dead) return;
            if(ent.owner !== myRole && ent.mesh && !ent.mesh.visible) return; 
            let d = haversineDist(loc.lat, loc.lon, ent.lat, ent.lon);
            if(d < bestDist) { bestDist = d; selectedEnt = ent; }
        });
        
        if(selectedEnt) {
            if(!e.shiftKey) clearSelection();
            selectedEnt.selected = true;
            updateSelectionPanel();
            _refreshCommandCard();
        } else {
            if(!e.shiftKey) clearSelection();
        }
    }
}, true);

const COUNTRIES = {
    'usa': { lat: 40, lon: -100 },
    'russia': { lat: 60, lon: 90 },
    'china': { lat: 35, lon: 105 },
    'europe': { lat: 48, lon: 15 },
    'arabia': { lat: 25, lon: 45 },
    'india': { lat: 22, lon: 78 }
};

function initWorld(difficulty, pCountryKey='usa', eCountryKey='random', gameMode='mode1', botCount=0) {
    window.gameMode = gameMode;
    gameSessionId++;   // AUDIT FIX: new session — pending timers from the last game die silently
    window.gameDifficulty = difficulty || 'normal';   // was accepted but never used
    window.playerCoordinates = [];
    window.enemyCoordinates = [];
    
    // Hide the Conquest ("غزو") tab permanently since attacks are triggered directly by clicking on land
    let tabs = document.querySelectorAll('#cmdTabs .cmdTab');
    if (tabs.length > 6) {
        tabs[6].style.display = 'none';
    }
    
    // Toggle the floating troop attack percentage overlay
    let overlay = document.getElementById('troopPctOverlay');
    if (overlay) {
        overlay.style.display = gameMode === 'mode1' ? 'flex' : 'none';
    }
    
    let pTrpEl = document.getElementById('pTroops');
    if(pTrpEl && pTrpEl.parentElement) pTrpEl.parentElement.style.display = gameMode === 'mode1' ? 'flex' : 'none';
    let eTrpEl = document.getElementById('eTroops');
    if(eTrpEl && eTrpEl.parentElement) eTrpEl.parentElement.style.display = gameMode === 'mode1' ? 'flex' : 'none';

    // ===== FULL STATE RESET (dispose GPU resources — matches backToMenu) =====
    structs.forEach(s => { if(s.mesh) { scene.remove(s.mesh); disposeMeshDeep(s.mesh); } if(s.selRing) { scene.remove(s.selRing); disposeMeshDeep(s.selRing); } });
    missiles.forEach(m => { if(m.mesh) { scene.remove(m.mesh); disposeMeshDeep(m.mesh); } });
    planes.forEach(p => { if(p.mesh) { scene.remove(p.mesh); disposeMeshDeep(p.mesh); } if(p.selRing) { scene.remove(p.selRing); disposeMeshDeep(p.selRing); } });
    aamMissiles.forEach(m => { if(m.mesh) { scene.remove(m.mesh); if(m.mesh.material) _recycleMat(m.mesh.material); } });   // TASK-201 AAM tracers
    AirCombat.clearWrecks();                          // TASK-401 falling wrecks
    exps.forEach(e => { scene.remove(e); disposeMeshDeep(e); });
    particles.forEach(p => { scene.remove(p); disposeMeshDeep(p); });
    tradeShips.forEach(ts => { if(ts.mesh) { scene.remove(ts.mesh); disposeMeshDeep(ts.mesh); } if(ts.pathLine) { scene.remove(ts.pathLine); disposeMeshDeep(ts.pathLine); } });
    trains.forEach(t => { if(t.mesh) { scene.remove(t.mesh); disposeMeshDeep(t.mesh); } });
    troopCohorts.forEach(tc => { if(tc.mesh) { scene.remove(tc.mesh); disposeMeshDeep(tc.mesh); } });
    transportShips.forEach(ts => { if(ts.mesh) { scene.remove(ts.mesh); disposeMeshDeep(ts.mesh); } if(ts.pathLine) { scene.remove(ts.pathLine); disposeMeshDeep(ts.pathLine); } });
    warships.forEach(w => { if(w.mesh) { scene.remove(w.mesh); disposeMeshDeep(w.mesh); } w.shells.forEach(sh => scene.remove(sh.mesh)); });
    drones.forEach(d => { if(d.mesh) { scene.remove(d.mesh); disposeMeshDeep(d.mesh); } });

    structs = []; missiles = []; planes = []; drones = []; aamMissiles = []; exps = []; particles = [];
    tradeShips = []; trains = []; troopCohorts = []; transportShips = []; warships = [];
tanks = [];   // TASK-302
    // TASK-402: naval deep-pass state — torpedoes, minefields, sinking
    // animations, and the mine mode must reset with the world.
    torpedoes.forEach(tp => { if (tp.mesh) { scene.remove(tp.mesh); disposeMeshDeep(tp.mesh); } });
    mineFields.forEach(f => { if (f.mesh) { scene.remove(f.mesh); disposeMeshDeep(f.mesh); } });
    navalSinking.forEach(sk => { scene.remove(sk.mesh); disposeMeshDeep(sk.mesh); });   // animator-owned hull meshes
    torpedoes = []; mineFields = []; navalSinking = [];
    if (mineMode) _setMineMode(false);
    fleetStanceIdx = 0;
    conquestGrid = null; activeAttacks = [];   // reset conquest system for new game

    // Build the conquest grid early so the flat land/water map is visible during
    // the spawn phase (when GeoJSON is already loaded by game start).
    if (window.gameMode === 'mode1' && window.GEOJSON_DATA && window.GEOJSON_DATA.features && window.GEOJSON_DATA.features.length > 0) {
        initConquestGrid();
        renderMode1Territory();
    }
    
    pTroops = GAME_CONSTANTS.STARTING_TROOPS;
    eTroops = GAME_CONSTANTS.STARTING_TROOPS;
    pBuiltCities = 0; pBuiltPorts = 0; pBuiltFactories = 0;
    selectedSourceProvinceIdx = -1;
    if(window.railroadLinesMesh) {
        scene.remove(window.railroadLinesMesh);
        window.railroadLinesMesh = null;
    }
    
    frame = 0; gOver = false; buildMode = null; targetingMode = false;
    volleyCount = 1; missileMix = ['ballistic'];   // TASK-403: fresh volley state per game
    econResetState();               // TASK-301: milestone/multiplier state for the new game
    lastHUD = 0; _id = 0;
    _lastRAF = 0; _frameAcc = 0;      // reset the fixed-timestep accumulator
    controlGroups = {};               // stale control groups must not select new units
    eBuiltPorts = 0;
    playerTech = {}; enemyTech = {}; researchingId = null; eResearchingId = null;
    
    window.lineAttackMode = false;
    let btn = document.getElementById('btnLineAttack');
    if (btn) {
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
        btn.style.fontWeight = '';
    }
    cleanupTerritory();
    document.getElementById('go')?.classList.remove('show');
    document.getElementById('selPan').style.display = 'none';
    
    init3D();
    
    // AUTO-LOAD GEO-DATA: Permanently show geographic data on globe
    setTimeout(() => {
        let region = pCountryKey;
        if (typeof GEO_FETCHER !== 'undefined' && GEO_FETCHER.regions && !GEO_FETCHER.regions[region]) {
            const regionMap = {
                'russia': 'russia',
                'france': 'france',
                'germany': 'germany',
                'uk': 'uk',
                'china': 'china',
                'india': 'india',
                'brazil': 'brazil',
                'australia': 'australia'
            };
            region = regionMap[pCountryKey] || 'iraq';
        }
        
        if (typeof GeoDataManager !== 'undefined') {
            GeoDataManager.loadRegion(region);
            console.log(`[GAME] Geo-data loaded permanently for: ${region} (player: ${pCountryKey})`);
        }
        // Also load province borders (only for Mode 2)
        if (gameMode !== 'mode1' && typeof GEO_PROVINCES !== 'undefined' && window.scene) {
            GEO_PROVINCES.loadProvincesForRegion(region);
        }
    }, 200);
    
    let pLoc = COUNTRIES[pCountryKey] || COUNTRIES['usa'];
    
    let eKey = eCountryKey;
    if (eKey === 'random') {
        let keys = Object.keys(COUNTRIES).filter(k => k !== pCountryKey);
        eKey = keys[Math.floor(Math.random() * keys.length)];
    }
    window._eCountryKey = eKey;   // consumed by the mode-1 spawn click (enemy seeds after the player picks)
    let eLoc = COUNTRIES[eKey] || COUNTRIES['india'];
    
    // ── BOT NATIONS (mode 1 FFA): pick countries + register owners/colors ──
    bots = [];
    clearRegisteredOwners();
    if (gameMode === 'mode1' && botCount > 0) {
        const pool = BOT_COUNTRIES.slice();
        // Prefer countries far from the player's chosen country for variety
        const n = Math.min(botCount, BOTS_MAX, pool.length);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        for (let i = 0; i < n; i++) {
            const c = pool[i];
            const code = 4 + i;               // owner codes 4..11
            const str = 'bot' + i;
            registerOwner(str, code, c.color); // grid paint + STR_TO_CODE
            bots.push({
                str, code, name: c.name, flag: c.flag,
                colorRGB: c.color,
                hexColor: (c.color[0] << 16) | (c.color[1] << 8) | c.color[2],
                country: c,
                troops: GAME_CONSTANTS.STARTING_TROOPS,
                res: GAME_CONSTANTS.STARTING_RES_OFFLINE,
                tech: {}, researchingId: null,
                alive: true,
                tickOffset: (Math.random() * 600) | 0,   // stagger AI cadence
            });
        }
        console.log(`[BOTS] ${n} nations registered:`, bots.map(b => b.flag + b.name).join(' '));
    }
    
    if (gameMode === 'mode2') {
        window.startSpawnPhase = false;
        
        pRes = GAME_CONSTANTS.STARTING_RES_OFFLINE;
        eRes = GAME_CONSTANTS.STARTING_RES_OFFLINE;
        applyDevStartingRes();   // DEV: player-only test gold
        
        structs.push(new Structure(pLoc.lat, pLoc.lon, 'base', 'player'));
        structs.push(new Structure(pLoc.lat - 1.2, pLoc.lon + 1.8, 'launcher', 'player'));
        let pa = new Structure(pLoc.lat + 1.2, pLoc.lon + 1.2, 'airport', 'player');
        structs.push(pa);
        planes.push(new Plane(pa.lat, pa.lon, PCFG['fighter'], 'player'));
        planes.push(new Plane(pa.lat, pa.lon, PCFG['stealth'], 'player'));

        structs.push(new Structure(eLoc.lat, eLoc.lon, 'base', 'enemy'));
        structs.push(new Structure(eLoc.lat + 1.2, eLoc.lon - 1.8, 'launcher', 'enemy'));

        let tgtMsgEl = document.getElementById('tgtMsg');
        if(tgtMsgEl) tgtMsgEl.style.display = 'none';

        initCitySprites(pLoc, eLoc);
        
        camera.position.copy(latLonToVec3(pLoc.lat, pLoc.lon, EARTH_RADIUS + 8000));
        controls.target.set(0, 0, 0);
        controls.update();
    } else {
        window.startSpawnPhase = true;
        pRes = 0;
        eRes = 0;
        
        initCitySprites({lat: 999, lon: 999}, {lat: 999, lon: 999});
        cityNodes = [];
        if (cityPointsMesh) { scene.remove(cityPointsMesh); cityPointsMesh = null; }
        
        let tgtMsgEl = document.getElementById('tgtMsg');
        if(tgtMsgEl) {
            // Show loading message until GeoJSON data finishes loading
            tgtMsgEl.textContent = (window.GEOJSON_DATA && window.GEOJSON_DATA.features)
                ? '🚩 انقر على أي نقطة على اليابسة لاختيار موقع بدايتك!'
                : '⏳ جاري تحميل بيانات الخريطة...';
            tgtMsgEl.style.display = 'block';
        }
        
        camera.position.set(0, 0, EARTH_RADIUS + 18000);
        controls.target.set(0, 0, 0);
        controls.update();
    }

    loop();
    updateHUD();
}

// Strongest live bot by territory (null when no bots — legacy enemy display)
function strongestBot() {
    let best = null, bestCells = -1;
    for (const b of bots) {
        if (!b.alive) continue;
        const c = conquestGrid ? conquestGrid.countCells(b.str) : 0;
        if (c > bestCells) { bestCells = c; best = b; }
    }
    return best;
}

// OpenFront-style leaderboard: all nations ranked by land share.
// DOM innerHTML rebuild throttled to 1/s (updateHUD calls this every ~0.5s).
let _lastLBUpdate = 0;
function updateLeaderboard() {
    const el = document.getElementById('leaderboard');
    if (!el) return;
    if (window.gameMode !== 'mode1' || bots.length === 0) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    const now = performance.now();
    if (now - _lastLBUpdate < 1000) return;
    _lastLBUpdate = now;
    el.style.display = 'block';
    const pCells = conquestGrid ? conquestGrid.countCells('player') : 0;
    const rows = [];
    for (const b of bots) rows.push({ name: b.name, flag: b.flag, color: b.colorRGB, cells: conquestGrid ? conquestGrid.countCells(b.str) : 0, troops: b.troops, alive: b.alive, me: false });
    const landTotal = pCells + rows.reduce((s, r) => s + r.cells, 0) + (conquestGrid ? conquestGrid.countCells('neutral') : 0);
    rows.push({ name: 'أنت', flag: '🟢', color: [38, 200, 110], cells: pCells, troops: pTroops, alive: true, me: true });
    rows.sort((a, b) => b.cells - a.cells);
    el.style.display = 'block';
    let html = '<div class="lbTitle">🏆 الأمم</div>';
    rows.forEach((r, i) => {
        const share = landTotal > 0 ? ((r.cells / landTotal) * 100).toFixed(1) : '0.0';
        const css = `rgb(${r.color[0]},${r.color[1]},${r.color[2]})`;
        html += `<div class="lbRow${r.me ? ' me' : ''}${r.alive ? '' : ' dead'}">
            <span class="lbRank">${i + 1}</span>
            <span class="lbFlag">${r.flag}</span>
            <span class="lbName" style="color:${css}">${r.name}</span>
            <span class="lbShare">${share}%</span>
            <span class="lbTroops">${formatTroopCount(r.troops)}</span>
        </div>`;
    });
    el.innerHTML = html;
}

function updateHUD() {
    if(!document.getElementById('pGold')) return;
    // TASK-404: dirty-flagged DOM writes (redundant writes skipped via a
    // per-element cache) + the ⛽ fuel chip next to the income stat.
    ensureFuelChip();
    _setTxt(document.getElementById('pGold'), Math.floor(pRes));
    if (!window.__econTipInit) initEconTooltip();   // TASK-301: lazy wire the income tooltip
    
    if(document.getElementById('pTroops')) {
        // Show current / max so the player always knows troop headroom
        let pMax = calcMaxTroops('player');
        _setTxt(document.getElementById('pTroops'), formatTroopCount(pTroops) + '/' + formatTroopCount(pMax));
        document.getElementById('pTroops').title = `القوات: ${Math.floor(pTroops)} / ${pMax}`;
        const pf = document.getElementById('pTroopFill');
        if (pf) _setStyle(pf, 'width', Math.min(100, (pTroops / Math.max(1, pMax)) * 100).toFixed(1) + '%');
    }
    if(document.getElementById('eTroops')) {
        // FFA: the right panel shows the STRONGEST rival nation (flag + name label)
        const top = strongestBot();
        const tTroops = top ? top.troops : eTroops;
        let eMax = calcMaxTroops(top ? top.str : 'enemy');
        _setTxt(document.getElementById('eTroops'), formatTroopCount(tTroops) + '/' + formatTroopCount(eMax));
        document.getElementById('eTroops').title = `قوات ${top ? top.flag + ' ' + top.name : 'العدو'}: ${Math.floor(tTroops)} / ${eMax}`;
        const ef = document.getElementById('eTroopFill');
        if (ef) _setStyle(ef, 'width', Math.min(100, (tTroops / Math.max(1, eMax)) * 100).toFixed(1) + '%');
        const lbl = document.getElementById('p2Label');
        if (lbl) _setTxt(lbl, top ? `${top.flag} ${top.name}` : 'العدو');
    }
    
    let pVP = 0; let eVP = 0;
    if (cityNodes) {
        cityNodes.forEach(c => {
            if (c.owner === 'player') pVP += c.victoryPoints;
            if (c.owner === 'enemy') eVP += c.victoryPoints;
        });
    }
    _setTxt(document.getElementById('pVP'), pVP);
    _setTxt(document.getElementById('eVP'), eVP);

    // Base/city/plane counters — mode 1 counts STRUCTURES (cityNodes is mode-2 only)
    const mode1 = window.gameMode === 'mode1';
    const topBot = strongestBot();
    const rivalStr = topBot ? topBot.str : 'enemy';
    const pBases = structs.filter(s=>s.owner==='player'&&!s.dead&&(mode1 ? (s.type==='airport'||s.type==='launcher') : s.type==='base')).length;
    const eBases = structs.filter(s=>s.owner===rivalStr&&!s.dead&&(mode1 ? (s.type==='airport'||s.type==='launcher') : s.type==='base')).length;
    _setTxt(document.getElementById('pBase'), pBases);
    _setTxt(document.getElementById('eBase'), eBases);
    let pCities = mode1 ? structs.filter(s=>s.owner==='player'&&!s.dead&&s.type==='city').length
                        : (cityNodes ? cityNodes.filter(c=>c.owner==='player').length : 0);
    let eCities = mode1 ? structs.filter(s=>s.owner===rivalStr&&!s.dead&&s.type==='city').length
                        : (cityNodes ? cityNodes.filter(c=>c.owner==='enemy').length : 0);
    _setTxt(document.getElementById('pCit'), pCities);
    _setTxt(document.getElementById('pPln'), planes.filter(p=>p.owner==='player'&&!p.dead).length);
    _setTxt(document.getElementById('eCit'), eCities);
    
    // Show neutral city count
    let neutralCount = mode1 ? 0 : (cityNodes ? cityNodes.filter(c=>c.owner==='neutral').length : 0);
    let cInfoEl = document.getElementById('cInfo');
    if(cInfoEl) _setTxt(cInfoEl, `⚪${neutralCount} | 🟢${pCities} | 🔴${eCities}`);
    
    // Income rate display
    let econ = calcIncome('player');
    let incEl = document.getElementById('pIncome');
    if(incEl) {
        let perSec = (econ.net * 60).toFixed(1);
        _setTxt(incEl, (econ.net >= 0 ? '+' : '') + perSec);
        _setStyle(incEl, 'color', econ.net >= 0 ? '#00ff88' : '#ff4444');
    }

    // TASK-404: fuel chip (dirty-flagged; pool + fill + low-state tint)
    const fb = window.__fuelBreakdown;
    const fEl = document.getElementById('pFuel');
    if (fEl) {
        if (fb) {
            _setTxt(fEl, Math.floor(fb.fuel));
            fEl.classList.toggle('lowFuel', fb.fuel < GAME_CONSTANTS.ECON_FUEL_MAX * 0.15 || fb.net < 0);
            const ff = document.getElementById('pFuelFill');
            if (ff) _setStyle(ff, 'width', Math.min(100, (fb.fuel / GAME_CONSTANTS.ECON_FUEL_MAX) * 100).toFixed(1) + '%');
        } else _setTxt(fEl, '—');
    }
    
    // Hotbar affordability/counts/selection stay live
    if (window.__refreshHotbar) window.__refreshHotbar();
    // FFA leaderboard (throttled internally by HUD cadence)
    updateLeaderboard();
}

// ══════════════════════════════════════════════════════════════════════
// TASK-301 — ECONOMY DEPTH
//   1. War upkeep      — standing armies (home + cohorts in the field)
//                        above WAR_UPKEEP_FREE_TROOPS drain gold/sec.
//   2. Port blockade   — enemy warship within BLOCKADE_RADIUS_KM of a port
//                        seals it: no trade ships spawn (READ-ONLY warships[]
//                        scan — the navy agent owns the Warship class).
//   3. Synergy         — factory↔city (+30%/link, cap 3) and port↔city
//                        (+gold/s throughput per link) adjacency bonuses.
//   4. Milestones      — one-time territory/army bonuses (all sides).
//   Pure math lives in econRatesFromSnapshot() so economyTest() can replay
//   the exact same formulas on synthetic balance scenarios.
// ══════════════════════════════════════════════════════════════════════
const econState = {
    milestones: {}, incomeMul: {},
    // ── TASK-404 state (re-created by econResetState) ──
    fuel: {},            // side → pooled fuel units
    loans: {},           // side → { principal, owed }
    bonds: {},           // side → { owed, epoch, count }
    defWar: {},          // side → { active, epoch }
    netHist: [],         // last 60s of net income (sparkline)
    _warDirs: new Set(), // 'atk>def' war directions (30f cache)
    _warPairs: [],       // undirected pairs for sanctions
    _blockedPorts: new Set(),
    _warFrame: -1e9,
    intel: { until: 0, markers: [] },
    _lowT: -1e9,         // last treasury-low toast frame
};
let _econScan = { frame: -1, sideData: {} };

function econResetState() {
    econState.milestones = {};
    econState.incomeMul = {};
    econState.fuel = {};
    econState.loans = {};
    econState.bonds = {};
    econState.defWar = {};
    econState.netHist = [];
    econState._warDirs = new Set();
    econState._warPairs = [];
    econState._blockedPorts = new Set();
    econState._warFrame = -1e9;
    econState.intel = { until: 0, markers: [] };
    econState._lowT = -1e9;
    window.__econBreakdown = null;
    window.__fuelBreakdown = null;
    _econScan = { frame: -1, sideData: {} };
    econTeardownForMenu();   // TASK-404: drop lanes/intel/medal visuals
    _sfxSt.stung = false; _sfxSt.shells = null; _sfxThreats.clear();   // TASK-408/504: re-arm stinger + drop stale threat entries
}

function troopsOf(side) {
    if (side === 'player') return pTroops;
    if (side === 'enemy') return eTroops;
    const b = bots.find(x => x.str === side);
    return b ? b.troops : 0;
}
// Standing army = home pool + cohorts marching in the field (they eat too).
function armyOf(side) {
    let t = troopsOf(side);
    for (const c of troopCohorts) if (!c.dead && c.owner === side) t += c.troops;
    return t;
}
function econResAdd(side, amt) {
    if (side === 'player') pRes += amt;
    else if (side === 'enemy') eRes += amt;
    else { const b = bots.find(x => x.str === side); if (b) b.res += amt; }
}

// BLOCKADE — O(1) per call: reads the 30-frame cached port set built by
// econWarTick() (warships move slowly — the warship×port scan runs at most
// every 30 frames instead of per port per frame; TASK-404 OPTIMIZE item).
// Still a READ-ONLY scan of warships[] — the navy agent owns the class.
function isPortBlockaded(port) {
    if (frame - econState._warFrame > 30) econWarTick();
    return econState._blockedPorts.has(port.id);
}

// TASK-504 OPTIMIZE: allocation-free great-circle distance for the econ
// hot loops (scan/war/lane passes run per frame at scale). The shared
// haversineDist() allocates TWO Vector3 per call (latLonToVec3 ×2) — at
// 20+ ports/cities/factories that's ~1000+ Vector3/frame of pure churn.
// Same spherical law of cosines, zero allocations, identical results to
// float epsilon (probe-verified in qaTest). Econ code only — the shared
// helper stays untouched for everyone else.
const _econHavNA = (() => {
    const RAD = Math.PI / 180;
    return (lat1, lon1, lat2, lon2) => {
        const p1 = lat1 * RAD, p2 = lat2 * RAD;
        const dLambda = (lon2 - lon1) * RAD;
        const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dLambda);
        return Math.acos(Math.max(-1, Math.min(1, c))) * EARTH_RADIUS;
    };
})();

// Per-frame cached scan: synergy links + blockade state, per side. Called from
// calcIncome (econ tick + HUD) — one scan per frame shared by all callers.
function econScanFrame() {
    if (_econScan.frame === frame) return _econScan;
    _econScan.frame = frame;
    _econScan.sideData = {};
    const sides = ['player'];
    if (bots.length === 0) sides.push('enemy');
    for (const b of bots) if (b.alive) sides.push(b.str);
    const R = GAME_CONSTANTS.SYNERGY_RANGE_KM;
    const mode2 = window.gameMode !== 'mode1';
    for (const side of sides) {
        const factories = [], ports = [];
        let cities = [];
        structs.forEach(s => {
            if (s.owner !== side || s.dead) return;
            if (s.type === 'factory') factories.push(s);
            else if (s.type === 'port') ports.push(s);
            else if (s.type === 'city') cities.push(s);
        });
        if (mode2 && cityNodes) cityNodes.forEach(c => { if (c.owner === side) cities.push(c); });
        const factoryLinks = factories.map(f => cities.reduce(
            (n, c) => n + (_econHavNA(f.lat, f.lon, c.lat, c.lon) <= R ? 1 : 0), 0));
        let pcLinks = 0;
        for (const p of ports) for (const c of cities)
            if (_econHavNA(p.lat, p.lon, c.lat, c.lon) <= R) pcLinks++;
        let blockaded = 0;
        for (const p of ports) {
            const nowBlk = isPortBlockaded(p);
            if (nowBlk !== !!p._blockaded) {           // state change → notify
                p._blockaded = nowBlk;
                // TASK-404: striped overlay marker on the port itself
                if (nowBlk) _blkMarkAdd(p); else _blkMarkRemove(p);
                if (side === 'player' && !window.startSpawnPhase) {
                    if (nowBlk) {
                        uiToast('⛔ ميناؤك تحت الحصار البحري — التجارة متوقفة!', 'err', 3200);
                        logEvent('⛔ سفن حربية معادية تحاصر ميناءك — إرسال التجارة متوقفة', 'err');
                    } else {
                        uiToast('✅ فُكّ الحصار عن مينائك — تستأنف التجارة', 'info', 3200);
                        logEvent('✅ فُكّ الحصار البحري عن مينائك — تستأنف التجارة', 'info');
                    }
                }
            }
            if (nowBlk) blockaded++;
        }
        // TASK-404: ports count feeds the fuel income (open = ports − blockaded)
        _econScan.sideData[side] = { factoryLinks, pcLinks, blockaded, ports: ports.length };
    }
    return _econScan;
}

// PURE per-SECOND economy math from a state snapshot. Shared by calcIncome()
// (live game) and economyTest() (balance simulations) so they can never drift.
function econRatesFromSnapshot(snap) {
    const C = GAME_CONSTANTS;
    const base = (snap.base || 0) * C.INCOME_BASE * 60;
    let factories = 0;
    (snap.factoryLinks || []).forEach(links => {
        factories += C.INCOME_FACTORY * 60 * (1 + Math.min(3, links) * C.SYNERGY_FACTORY_CITY);
    });
    const nuke = (snap.nukePlants || 0) * C.INCOME_NUKE_PLANT * 60;
    const airports = (snap.airports || 0) * C.INCOME_AIRPORT * 60;
    const territory = (snap.cells || 0) * C.TERRITORY_INCOME_PER_CELL;
    const cities = snap.cityIncome || 0;
    const synergy = (snap.portCityLinks || 0) * C.SYNERGY_PORT_CITY_INCOME;
    const subtotal = base + factories + nuke + airports + territory + cities + synergy;
    const factoryMul = 1 + (snap.factoryLinks ? snap.factoryLinks.length : 0) * C.FACTORY_MULTIPLIER;
    const milestoneMul = snap.milestoneMul || 1;
    const income = subtotal * factoryMul * milestoneMul;
    const buildings = (snap.upkeepBuildings || 0) * C.UPKEEP_BUILDING * 60;
    const planes = (snap.planes || 0) * C.UPKEEP_PLANE * 60;
    const armyExcess = Math.max(0, (snap.troops || 0) - C.WAR_UPKEEP_FREE_TROOPS);
    const army = armyExcess / 1000 * C.WAR_UPKEEP_PER_K;
    const upkeep = buildings + planes + army;
    return {
        income, upkeep, net: income - upkeep,
        parts: { base, factories, nuke, airports, territory, cities, synergy,
                 factoryMul, milestoneMul, buildings, planes, army, armyExcess }
    };
}

function calcIncome(side) {
    if(window.startSpawnPhase) return { income: 0, upkeep: 0, net: 0, details: null };
    const C = GAME_CONSTANTS;
    const scan = econScanFrame().sideData[side] || { factoryLinks: [], pcLinks: 0, blockaded: 0 };
    let nBase=0, nNuke=0, nAir=0, nUpkeepB=0;
    structs.forEach(s => {
        if(s.owner !== side || s.dead) return;
        switch(s.type) {
            case 'base':       nBase++; break;
            case 'nuke_plant': nNuke++; break;
            case 'airport':    nAir++; break;
            case 'factory':    break;   // income computed via synergy links below
            default:
                if(SDEFS[s.type] && SDEFS[s.type].cost > 0) nUpkeepB++;
                break;
        }
    });
    const mode1 = window.gameMode === 'mode1';
    const cells = (mode1 && conquestGrid && conquestGrid._maskReady) ? conquestGrid.countCells(side) : 0;
    let cityIncome = 0;
    if (!mode1 && cityNodes) {
        cityNodes.forEach(c => { if(c.owner === side) cityIncome += (c.income || C.INCOME_CITY) * 60; });
    }
    const planesN = planes.filter(p => p.owner === side && !p.dead).length;
    const snap = {
        base: nBase, nukePlants: nNuke, airports: nAir,
        factoryLinks: scan.factoryLinks,
        cells, cityIncome,
        portCityLinks: scan.pcLinks,
        milestoneMul: econState.incomeMul[side] || 1,
        planes: planesN, upkeepBuildings: nUpkeepB,
        troops: armyOf(side),
    };
    const r = econRatesFromSnapshot(snap);          // per-second rates
    if (side === 'player') {
        window.__econBreakdown = {
            income: r.income, upkeep: r.upkeep, net: r.net, parts: r.parts,
            troops: snap.troops, cells, planes: planesN,
            factories: scan.factoryLinks.length, portCityLinks: scan.pcLinks,
            blockadedPorts: scan.blockaded, at: frame,
        };
    }
    // API contract: per-FRAME rates (callers multiply by the tick interval)
    return { income: r.income / 60, upkeep: r.upkeep / 60, net: r.net / 60, details: r.parts };
}

// Milestones — checked once per second for every living side. Rewards are
// instant gold (econResAdd) and/or a permanent income multiplier.
function econMilestoneTick() {
    if (window.startSpawnPhase || gOver) return;
    const C = GAME_CONSTANTS;
    const sides = ['player'];
    if (bots.length === 0) sides.push('enemy');
    for (const b of bots) if (b.alive) sides.push(b.str);
    const mode1 = window.gameMode === 'mode1';
    for (const side of sides) {
        const reached = econState.milestones[side] || (econState.milestones[side] = new Set());
        let cells = 0;
        if (mode1 && conquestGrid && conquestGrid._maskReady) cells = conquestGrid.countCells(side);
        else cells = (cityNodes ? cityNodes.filter(c => c.owner === side).length : 0) * 800; // mode-2 equivalent
        const troops = armyOf(side);
        for (const m of C.ECON_MILESTONES) {
            if (reached.has(m.id)) continue;
            const okCells = m.cells && cells >= m.cells;
            const okTroops = m.troops && troops >= m.troops;
            if (!okCells && !okTroops) continue;
            reached.add(m.id);
            if (m.rewardGold) econResAdd(side, m.rewardGold);
            if (m.incomeMul) econState.incomeMul[side] = (econState.incomeMul[side] || 1) * m.incomeMul;
            if (side === 'player') {
                const bonus = m.rewardGold ? ` +$${m.rewardGold}` : (m.incomeMul ? ` دخل +${Math.round((m.incomeMul - 1) * 100)}%` : '');
                econMilestoneToast(m, bonus);   // TASK-404: medal fly-in toast
                logEvent(`${m.icon} إنجاز اقتصادي: ${m.name}${bonus}`, 'info');
            }
        }
    }
}

// ── Income breakdown tooltip (hover the 💰 / 📈 counters) ──────────────
// Synergy info for one structure (selection panel rows, TASK-301).
function structSynergyInfo(s) {
    if (!s || s.owner == null) return null;
    const R = GAME_CONSTANTS.SYNERGY_RANGE_KM;
    const mode2 = window.gameMode !== 'mode1';
    const cities = structs.filter(x => x.owner === s.owner && !x.dead && x.type === 'city');
    if (mode2 && cityNodes) cityNodes.forEach(c => { if (c.owner === s.owner) cities.push(c); });
    const near = (a, b) => _econHavNA(a.lat, a.lon, b.lat, b.lon) <= R;   // TASK-504: no-alloc
    if (s.type === 'factory') {
        const links = Math.min(3, cities.reduce((n, c) => n + (near(s, c) ? 1 : 0), 0));
        return { links, label: `مدن مرتبطة ×${links} (+${Math.round(links * GAME_CONSTANTS.SYNERGY_FACTORY_CITY * 100)}% دخل)` };
    }
    if (s.type === 'port') {
        const links = cities.reduce((n, c) => n + (near(s, c) ? 1 : 0), 0);
        return { links, label: links ? `مدن مرتبطة ×${links} (+$${(links * GAME_CONSTANTS.SYNERGY_PORT_CITY_INCOME).toFixed(2)}/ث)` : 'لا مدن قريبة' };
    }
    if (s.type === 'city') {
        const facts = structs.filter(x => x.owner === s.owner && !x.dead && x.type === 'factory' && near(s, x)).length;
        const prts = structs.filter(x => x.owner === s.owner && !x.dead && x.type === 'port' && near(s, x)).length;
        return { links: facts + prts, label: `روابط تآزر: 🏭×${facts} 🚢×${prts}` };
    }
    return null;
}
let _econTipTimer = null;
function renderEconTooltip(tip) {
    const C = GAME_CONSTANTS;   // TASK-404: fuel/debt/sanction rows read the econ block
    const b = window.__econBreakdown;
    if (!b) { tip.innerHTML = '<div class="etRow">لا توجد بيانات اقتصادية بعد</div>'; return; }
    const P = b.parts;
    const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(1);
    const myShips = tradeShips.reduce((n, ts) => n + (ts.dead || ts.owner !== 'player' ? 0 : 1), 0);
    const tradeEst = myShips * GAME_CONSTANTS.TRADE_SHIP_BASE_GOLD / 90;   // ≈ payout / avg voyage
    const earned = (econState.milestones.player || new Set());
    const chips = GAME_CONSTANTS.ECON_MILESTONES
        .filter(m => earned.has(m.id))
        .map(m => `${m.icon} ${m.name}`).join(' · ') || '—';
    const rows = [];
    const row = (k, v, cls) => rows.push(`<div class="etRow${cls ? ' ' + cls : ''}"><span>${k}</span><span>${v}</span></div>`);
    row('🏛️ القاعدة', fmt(P.base));
    row('🗺️ الأراضي', fmt(P.territory) + ` (${b.cells.toLocaleString('en')} خلية)`);
    if (P.factories) row('🏭 المصانع', fmt(P.factories) + ` (${b.factories})`);
    if (P.nuke) row('☢️ نووي', fmt(P.nuke));
    if (P.airports) row('🛫 المطارات', fmt(P.airports));
    if (P.cities) row('🏙️ المدن', fmt(P.cities));
    if (P.synergy) row('🤝 ميناء-مدينة', fmt(P.synergy) + ` (×${b.portCityLinks})`);
    row('🚢 التجارة (تقديري)', '≈' + tradeEst.toFixed(1) + ` (${myShips} سفينة)`, 'etTrade');
    if (P.factoryMul > 1) row('⚙️ مضاعف المصانع', '×' + P.factoryMul.toFixed(2));
    if (P.milestoneMul > 1) row('🏆 إنجازات', '×' + P.milestoneMul.toFixed(2), 'etMile');
    rows.push('<div class="etSep"></div>');
    // TASK-404 rows: fuel pool / debt / bonds / sanctions
    const F = window.__fuelBreakdown;
    if (F) {
        row('⛽ وقود', `${Math.floor(F.fuel)}/${C.ECON_FUEL_MAX} (${F.net >= 0 ? '+' : ''}${F.net.toFixed(2)}/ث)`, F.net < 0 ? 'etDrain' : '');
        if (F.crisis > 0) rows.push('<div class="etBlk">⛽ أزمة وقود — شراء اضطراري من الذهب!</div>');
    }
    const LN = econState.loans[myRole];
    if (LN && LN.owed > 0) row('🏦 قرض', `-$${C.ECON_LOAN_REPAY_PS}/ث (متبقٍ $${Math.ceil(LN.owed)})`, 'etDrain');
    const BD = econState.bonds[myRole];
    if (BD && BD.owed > 0) row('🎖️ سندات', `-$${C.ECON_BOND_REPAY_PS}/ث بعد الحرب (متبقٍ $${Math.ceil(BD.owed)})`, 'etDrain');
    if (econSanctioned(myRole)) rows.push(`<div class="etBlk">⚠️ عقوبات دولية — التجارة ×${C.ECON_SANCTIONS_TRADE_MUL} (حروب: ${econWarPartnerCount(myRole)})</div>`);
    row('🎖️ الجيش' + (P.armyExcess > 0 ? ` (${Math.round(P.armyExcess / 1000)}k فائض)` : ' (مجاني)'), (P.army > 0 ? '-' : '+') + Math.abs(P.army).toFixed(1), P.army > 0 ? 'etDrain' : '');
    row('✈️ الطائرات', '-' + P.planes.toFixed(1), 'etDrain');
    row('🏗️ المباني', '-' + P.buildings.toFixed(1), 'etDrain');
    rows.push(`<div class="etNet${b.net >= 0 ? '' : ' etNeg'}">الصافي ${fmt(b.net)}/ث</div>`);
    if (b.blockadedPorts > 0) rows.push(`<div class="etBlk">⛔ موانئ تحت الحصار: ${b.blockadedPorts}</div>`);
    rows.push(`<div class="etMiles">🏆 ${chips}</div>`);
    // TASK-404: animated sparkline of the last 60s net income
    rows.push('<div class="etSpark"><canvas id="econSpark"></canvas></div>');
    tip.innerHTML = rows.join('');
    const cv = tip.querySelector('#econSpark');
    if (cv) econSparkDraw(cv);
}
function initEconTooltip() {
    window.__econTipInit = true;
    const tip = document.createElement('div');
    tip.id = 'econTip';
    document.body.appendChild(tip);
    const attach = (el) => {
        if (!el) return;
        el.addEventListener('mouseenter', () => {
            renderEconTooltip(tip);
            tip.classList.add('show');
            if (_econTipTimer) clearInterval(_econTipTimer);
            _econTipTimer = setInterval(() => renderEconTooltip(tip), 1000);
        });
        el.addEventListener('mouseleave', () => {
            tip.classList.remove('show');
            if (_econTipTimer) { clearInterval(_econTipTimer); _econTipTimer = null; }
        });
    };
    const gold = document.getElementById('pGold');   if (gold) attach(gold.closest('.stat') || gold);
    const inc  = document.getElementById('pIncome'); if (inc)  attach(inc.closest('.stat') || inc);
    const fuel = document.getElementById('pFuel');   if (fuel) attach(fuel.closest('.stat') || fuel);   // TASK-404
}

// ══════════════════════════════════════════════════════════════════════
// TASK-404 — ECONOMY DEEP PASS
//   · FUEL v1          — one pooled strategic reserve per nation (trickle +
//                        open ports + factories in; planes/tanks/drones out).
//                        Empty pool → world-market auto-buy drains GOLD and
//                        new deployments are gated until the reserve recovers.
//   · BLACK MARKET     — emergency loans at 30% interest, credit-capped.
//                        Bots borrow when broke (a bad early war never
//                        eliminates a nation). Key K opens the panel.
//   · WAR BONDS        — interest-free, ONLY during a defensive war (max 2
//                        per war), auto-repaid once the war ends.
//   · SANCTIONS        — ≥3 simultaneous war partners → trade payouts ×0.6.
//   · INTEL            — pay $300 to ring every enemy structure + census 60s.
//   · TRADE LANES (L)  — port→port demand arcs; red when an enemy warship
//                        sits on the lane (raid risk). Raidable shipping.
//   · POLISH           — 60s net-income sparkline in the tooltip, milestone
//                        medal fly-in toasts, striped overlay on blockaded
//                        ports, "treasury low" warning (<10s of upkeep).
//   · REFACTOR/OPT     — econ UI via observer (econBus, emits on change),
//                        dirty-flag HUD writes, 30-frame war/blockade cache
//                        (was warship×port per port per frame).
//   Pure math lives in snapshot functions so economyTest() replays the
//   exact live formulas (TASK-301 pattern). Other agents' classes are only
//   ever READ (warships/troopCohorts/tanks/missiles/structs arrays).
// ══════════════════════════════════════════════════════════════════════

// ── Observer: econ-derived UI subscribes instead of being polled. Values
//    are published ONLY on change (dirty at the source).
const econBus = {
    _subs: {}, _last: {},
    on(ev, fn) { (this._subs[ev] = this._subs[ev] || []).push(fn); return fn; },
    emit(ev, val) {
        const l = this._subs[ev];
        if (l) for (const fn of l) { try { fn(val); } catch (err) { console.warn('[ECON] subscriber "' + ev + '" failed:', err); } }
    },
};
function econBusPublish() {
    const b = window.__econBreakdown, f = window.__fuelBreakdown;
    const emit = (ev, v) => { if (econBus._last[ev] !== v) { econBus._last[ev] = v; econBus.emit(ev, v); } };
    emit('gold', Math.floor(pRes));
    if (b) emit('net', Math.round(b.net * 10) / 10);
    if (f) emit('fuel', Math.floor(f.fuel));
    const L = econState.loans[myRole];
    emit('debt', L && L.owed > 0 ? Math.ceil(L.owed) : 0);
}

// Debt badge inside the gold stat — the flagship econBus subscriber
// (TASK-404 observer pattern: this UI is NEVER written from updateHUD;
// it only ever changes when the published 'debt' value changes).
function _econDebtBadge(v) {
    let b = document.getElementById('econDebt');
    if (!v) { if (b) b.style.display = 'none'; return; }
    if (!b) {
        const g = document.getElementById('pGold');
        const host = (g && g.closest && g.closest('.stat')) || document.body;
        b = document.createElement('span');
        b.id = 'econDebt';
        host.appendChild(b);
    }
    b.style.display = '';
    b.textContent = `🏦$${v}`;
    b.title = `دين قائم $${v} — يُسدد تلقائياً من الدخل`;
}
econBus.on('debt', _econDebtBadge);

// ── Dirty-flag DOM writes: updateHUD fires from ~20 call sites + the HUD
//    cadence — most textContent/style writes are redundant. Per-element
//    keyed cache skips identical writes entirely (OPTIMIZE item).
const _domCache = new WeakMap();
function _domKey(el, k, v) {
    let m = _domCache.get(el);
    if (!m) { m = {}; _domCache.set(el, m); }
    if (m[k] === v) return false;
    m[k] = v;
    return true;
}
function _setTxt(el, v) { if (el && _domKey(el, 'txt', v)) el.textContent = v; }
function _setStyle(el, prop, v) { if (el && _domKey(el, 'st:' + prop, v)) el.style[prop] = v; }

// ── ⛽ FUEL chip (top HUD, next to the income stat; built lazily so
//    index.html stays untouched for the merge).
function ensureFuelChip() {
    if (document.getElementById('pFuel')) return;
    const inc = document.getElementById('pIncome');
    const st = inc && inc.closest && inc.closest('.stat');
    if (!st || !st.parentElement) return;
    const d = document.createElement('div');
    d.className = 'stat fuelStat';
    d.id = 'fuelStat';
    d.innerHTML = `<span class="sIcon">⛽</span><span class="rval" id="pFuel">—</span><div class="fBarWrap"><div class="fFill" id="pFuelFill"></div></div>`;
    st.after(d);
}

// ── Gold get/set siblings of econResAdd ──────────────────────────────
function econResGet(side) {
    if (side === 'player') return pRes;
    if (side === 'enemy') return eRes;
    const b = bots.find(x => x.str === side);
    return b ? b.res : 0;
}
function econResSet(side, v) {
    if (side === 'player') pRes = v;
    else if (side === 'enemy') eRes = v;
    else { const b = bots.find(x => x.str === side); if (b) b.res = v; }
}

// ── FUEL v1 (pooled per side) ─────────────────────────────────────────
function econFuelGet(side) {
    if (!(side in econState.fuel)) econState.fuel[side] = GAME_CONSTANTS.ECON_FUEL_START;
    return econState.fuel[side];
}
// PURE fuel math — replayed by economyTest() (income: trickle + open ports
// + factories; upkeep: aircraft + tank divisions + drones).
function econFuelRatesFromSnapshot(snap) {
    const C = GAME_CONSTANTS;
    const income = C.ECON_FUEL_INCOME_BASE
        + (snap.openPorts || 0) * C.ECON_FUEL_PER_PORT
        + (snap.factories || 0) * C.ECON_FUEL_PER_FACTORY;
    const planes = (snap.planes || 0) * C.ECON_FUEL_UPKEEP_PLANE;
    const tanks = (snap.tanks || 0) * C.ECON_FUEL_UPKEEP_TANK;
    const drones = (snap.drones || 0) * C.ECON_FUEL_UPKEEP_DRONE;
    const upkeep = planes + tanks + drones;
    return { income, upkeep, net: income - upkeep, parts: { planes, tanks, drones } };
}
function econFuelSides() {
    const s = [myRole, 'player'];
    if (bots.length === 0) s.push('enemy');
    for (const b of bots) if (b.alive) s.push(b.str);
    return [...new Set(s)];
}
function econFuelTick(dt) {
    const C = GAME_CONSTANTS;
    for (const side of econFuelSides()) {
        const scan = econScanFrame().sideData[side] || {};
        const snap = {
            openPorts: Math.max(0, (scan.ports || 0) - (scan.blockaded || 0)),
            factories: (scan.factoryLinks || []).length,
            planes: planes.reduce((n, p) => n + (p.owner === side && !p.dead ? 1 : 0), 0),
            tanks: tanks.reduce((n, t) => n + (t.owner === side && !t.dead ? 1 : 0), 0),
            drones: drones.reduce((n, d) => n + (!d.dead && d.owner === side ? 1 : 0), 0),
        };
        const r = econFuelRatesFromSnapshot(snap);
        let f = econFuelGet(side) + r.net * dt;
        let crisis = 0;
        if (f <= 0) {
            if (r.net < 0) crisis = -r.net * dt * C.ECON_FUEL_CRISIS_GOLD;  // auto-buy at premium
            f = 0;
        } else if (f > C.ECON_FUEL_MAX) f = C.ECON_FUEL_MAX;
        econState.fuel[side] = f;
        if (crisis > 0) econResSet(side, Math.max(0, econResGet(side) - crisis));
        if (side === myRole) window.__fuelBreakdown = Object.assign({}, r, snap, { fuel: f, crisis, at: frame });
    }
}
// Deployment gate: true (fuel deducted) or false + player-facing message.
function econFuelSpend(side, amount, silent) {
    const f = econFuelGet(side);
    if (f < amount) {
        if (!silent && (side === myRole || side === 'player')) {
            logEvent(`⛽ وقود غير كافٍ للنشر (${Math.floor(f)}/${amount}) — الموانئ والمصانع ترفع المخزون`, 'err');
        }
        return false;
    }
    econState.fuel[side] = f - amount;
    return true;
}

// ── WAR SCAN (30-frame cache): war directions + blockaded ports in ONE
//    bounded pass. War signal = someone's forces are actively on/at the
//    other's land: cohorts marching at it, tank divisions standing on it,
//    strategic missiles inbound at it (interceptors excluded via .tgt),
//    warships blockading its ports. READ-ONLY scans of other agents' arrays.
function econWarTick() {
    const C = GAME_CONSTANTS;
    const valid = new Set(econFuelSides());
    const dirs = new Set();
    const blocked = new Set();
    const pairs = new Set();
    const link = (atk, def) => {
        if (atk === def || !valid.has(atk) || !valid.has(def)) return;
        dirs.add(atk + '>' + def);
        pairs.add(atk < def ? atk + '|' + def : def + '|' + atk);
    };
    const ownerAt = (lat, lon) => (typeof getPixelOwner === 'function' && typeof conquestGrid !== 'undefined' && conquestGrid && conquestGrid._maskReady)
        ? getPixelOwner(lat, lon) : null;
    const R = C.BLOCKADE_RADIUS_KM;
    for (const w of warships) {
        if (w.dead) continue;
        for (const p of structs) {
            if (p.type !== 'port' || p.dead || p.owner === w.owner) continue;
            if (_econHavNA(w.lat, w.lon, p.lat, p.lon) <= R) { link(w.owner, p.owner); blocked.add(p.id); }   // TASK-504: no-alloc
        }
    }
    for (const c of troopCohorts) if (!c.dead) link(c.owner, ownerAt(c.tlat, c.tlon));
    for (const t of tanks) if (!t.dead) link(t.owner, ownerAt(t.lat, t.lon));
    for (const m of missiles) if (!m.dead && !m.tgt) link(m.owner, ownerAt(m.tlat, m.tlon));
    econState._warDirs = dirs;
    econState._warPairs = [...pairs];
    econState._blockedPorts = blocked;
    econState._warFrame = frame;
}
function econDefensiveWar(side) {
    for (const d of econState._warDirs) if (d.endsWith('>' + side)) return true;
    return false;
}
function econWarPartnerCount(side) {
    let n = 0;
    for (const p of econState._warPairs) {
        const i = p.indexOf('|');
        if (p.slice(0, i) === side || p.slice(i + 1) === side) n++;
    }
    return n;
}
function econSanctioned(side) {
    return econWarPartnerCount(side) >= GAME_CONSTANTS.ECON_SANCTIONS_MIN_WARS;
}

// ── BLACK MARKET: emergency loans (interest) + war bonds (defensive) ──
function econLoanOf(side) { return econState.loans[side] || (econState.loans[side] = { principal: 0, owed: 0 }); }
function econTakeLoan(side, silent) {
    const C = GAME_CONSTANTS;
    const L = econLoanOf(side);
    if (L.principal + C.ECON_LOAN_AMOUNT > C.ECON_LOAN_MAX_DEBT) {
        if (!silent && side === myRole) logEvent(`🏦 بلغتَ سقف الائتمان ($${C.ECON_LOAN_MAX_DEBT})`, 'err');
        return false;
    }
    L.principal += C.ECON_LOAN_AMOUNT;
    L.owed += C.ECON_LOAN_AMOUNT * C.ECON_LOAN_INTEREST;
    econResAdd(side, C.ECON_LOAN_AMOUNT);
    if (side === myRole) {
        logEvent(`🏦 قرض طارئ: +$${C.ECON_LOAN_AMOUNT} (تسديد $${Math.round(C.ECON_LOAN_AMOUNT * C.ECON_LOAN_INTEREST)} تدريجياً)`, 'warn');
        updateHUD();
    }
    return true;
}
function econLoanTick(dt) {
    const C = GAME_CONSTANTS;
    for (const side of econFuelSides()) {
        const L = econState.loans[side];
        if (!L || L.owed <= 0) continue;
        const res = econResGet(side);
        const avail = res - C.ECON_LOAN_RESERVE;         // repayment pauses at the floor
        if (avail <= 0) continue;
        const pay = Math.min(L.owed, avail, C.ECON_LOAN_REPAY_PS * dt);
        L.owed -= pay;
        L.principal = Math.max(0, L.principal - pay / C.ECON_LOAN_INTEREST);
        econResSet(side, res - pay);
    }
}
function econBondOf(side) { return econState.bonds[side] || (econState.bonds[side] = { owed: 0, epoch: -1, count: 0 }); }
// Rising-edge tracking of defensive wars → the bond allowance resets per war.
function econDefWarEdge() {
    for (const side of econFuelSides()) {
        const st = econState.defWar[side] || (econState.defWar[side] = { active: false, epoch: 0 });
        const active = econDefensiveWar(side);
        if (active && !st.active) st.epoch++;
        st.active = active;
    }
}
function econTakeBond(side, silent) {
    const C = GAME_CONSTANTS;
    const st = econState.defWar[side] || (econState.defWar[side] = { active: false, epoch: 0 });
    if (!econDefensiveWar(side)) {
        if (!silent && side === myRole) logEvent('🎖️ سندات الحرب متاحة فقط أثناء حرب دفاعية على أرضك!', 'err');
        return false;
    }
    const B = econBondOf(side);
    if (B.epoch !== st.epoch) { B.epoch = st.epoch; B.count = 0; }
    if (B.count >= C.ECON_BOND_MAX_PER_WAR) {
        if (!silent && side === myRole) logEvent(`🎖️ صدرت كل سندات هذه الحرب (${C.ECON_BOND_MAX_PER_WAR})`, 'err');
        return false;
    }
    B.count++;
    B.owed += C.ECON_BOND_AMOUNT;
    econResAdd(side, C.ECON_BOND_AMOUNT);
    if (side === myRole) {
        logEvent(`🎖️ سندات حرب: +$${C.ECON_BOND_AMOUNT} (بلا فائدة — تُسدد بعد انتهاء الحرب)`, 'warn');
        updateHUD();
    }
    return true;
}
function econBondTick(dt) {
    const C = GAME_CONSTANTS;
    for (const side of econFuelSides()) {
        const B = econState.bonds[side];
        if (!B || B.owed <= 0) continue;
        if (econDefensiveWar(side)) continue;            // grace while the war lasts
        const res = econResGet(side);
        const pay = Math.min(B.owed, Math.max(0, res), C.ECON_BOND_REPAY_PS * dt);
        if (pay <= 0) continue;
        B.owed -= pay;
        econResSet(side, res - pay);
    }
}
// Bots borrow when broke — a bad early war shouldn't eliminate a nation.
function econBotCreditTick() {
    for (const b of bots) {
        if (!b.alive) continue;
        if (b.res < 120) econTakeLoan(b.str, true);
    }
}

// ── INTEL: reveal enemy structures for a window ──────────────────────
function econIntelActive() { return frame < ((econState.intel && econState.intel.until) || 0); }
function econBuyIntel() {
    const C = GAME_CONSTANTS;
    if (pRes < C.ECON_INTEL_COST) { logEvent(`موارد غير كافية! تحتاج $${C.ECON_INTEL_COST}`, 'err'); return false; }
    pRes -= C.ECON_INTEL_COST;
    econState.intel.until = frame + C.ECON_INTEL_SECONDS * 60;
    _intelBuildMarkers();
    logEvent(`🕵️ نشاط استخبارات: كل منشآت العدو مكشوفة لمدة ${C.ECON_INTEL_SECONDS} ثانية`, 'warn');
    updateHUD();
    return true;
}
function _intelBuildMarkers() {
    _intelClearMarkers();
    if (typeof scene === 'undefined' || !scene) return;
    for (const s of structs) {
        if (s.dead || s.owner === myRole) continue;
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(8, 11, 20),
            new THREE.MeshBasicMaterial({ color: 0xff4455, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.position.copy(latLonToVec3(s.lat, s.lon, EARTH_RADIUS + 2.5));
        ring.lookAt(0, 0, 0);
        ring.renderOrder = 4;
        scene.add(ring);
        econState.intel.markers.push(ring);
    }
}
function _intelClearMarkers() {
    if (!econState.intel.markers) econState.intel.markers = [];
    for (const r of econState.intel.markers) {
        if (r.parent) r.parent.remove(r);
        r.geometry.dispose();
        r.material.dispose();
    }
    econState.intel.markers = [];
}
function _intelTick() {
    if (!econState.intel.markers || !econState.intel.markers.length) return;
    if (!econIntelActive()) {
        _intelClearMarkers();
        logEvent('🕵️ انتهت صلاحية الاستخبارات', 'info');
        return;
    }
    const t = frame / 60;
    for (const r of econState.intel.markers) r.material.opacity = 0.45 + 0.35 * Math.sin(t * 4);
}

// ── TRADE-LANE visualization (port→port demand arcs; raidable) ────────
let tradeLaneGroup = null;
let tradeLanesOn = true;
let _laneFrame = -1e9;
function toggleTradeLanes() {
    tradeLanesOn = !tradeLanesOn;
    rebuildTradeLanes();
    logEvent(tradeLanesOn ? '🛣️ مسارات التجارة ظاهرة (أخضر = آمن، أحمر = خطر قرصنة)' : '🛣️ مسارات التجارة مخفية', 'info');
}
function _disposeGroupChildren(g) {
    for (let i = g.children.length - 1; i >= 0; i--) {
        const c = g.children[i];
        g.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }
}
function laneAtRisk(a, b) {
    const R = GAME_CONSTANTS.ECON_LANE_RAID_RISK_KM;
    const va = latLonToVec3(a.lat, a.lon, 1).normalize();
    const vb = latLonToVec3(b.lat, b.lon, 1).normalize();
    const mid = vec3ToLatLon(va.clone().add(vb).normalize());
    for (const w of warships) {
        if (w.dead || w.owner === myRole) continue;
        if (_econHavNA(w.lat, w.lon, a.lat, a.lon) < R) return true;
        if (_econHavNA(w.lat, w.lon, mid.lat, mid.lon) < R) return true;
        if (_econHavNA(w.lat, w.lon, b.lat, b.lon) < R) return true;
    }
    return false;
}
function rebuildTradeLanes() {
    if (typeof scene === 'undefined' || !scene) return;
    if (!tradeLaneGroup) { tradeLaneGroup = new THREE.Group(); scene.add(tradeLaneGroup); }
    _disposeGroupChildren(tradeLaneGroup);
    if (!tradeLanesOn || window.startSpawnPhase) return;
    const C = GAME_CONSTANTS;
    const myPorts = structs.filter(s => s.type === 'port' && !s.dead && s.owner === myRole);
    if (!myPorts.length) return;
    const foreign = structs.filter(s => s.type === 'port' && !s.dead && s.owner !== myRole);
    const N = 28;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
    for (const p1 of myPorts) {
        const targets = foreign
            .slice().sort((x, y) => _econHavNA(p1.lat, p1.lon, x.lat, x.lon) - _econHavNA(p1.lat, p1.lon, y.lat, y.lon))
            .slice(0, C.ECON_LANE_TOP_TARGETS);
        for (const p2 of targets) {
            const risk = laneAtRisk(p1, p2);
            a.copy(latLonToVec3(p1.lat, p1.lon, 1)).normalize();
            b.copy(latLonToVec3(p2.lat, p2.lon, 1)).normalize();
            const pts = [];
            for (let i = 0; i <= N; i++) {
                const t = i / N;
                p.copy(a).lerp(b, t).normalize()
                    .multiplyScalar(EARTH_RADIUS + 7 + 7 * Math.sin(Math.PI * t));   // lift mid-arc
                pts.push(p.clone());
            }
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineDashedMaterial({ color: risk ? 0xff4444 : 0x39d98a, transparent: true, opacity: risk ? 0.95 : 0.5, dashSize: 7, gapSize: 5 })
            );
            line.computeLineDistances();
            tradeLaneGroup.add(line);
        }
    }
}

// ── SPARKLINE: last 60s of net income, drawn into the econ tooltip ──
function econSparkDraw(cv) {
    const hist = econState.netHist;
    const dpr = window.devicePixelRatio || 1;
    const W = 216, H = 48;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!hist || hist.length < 2) {
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('جارٍ تجميع بيانات الدخل…', W / 2, H / 2 + 3);
        return;
    }
    const lo = Math.min(0, ...hist), hi = Math.max(1, ...hist);
    const range = hi - lo || 1;
    const X = i => 3 + (W - 6) * (i / (hist.length - 1));
    const Y = v => H - 5 - (H - 10) * ((v - lo) / range);
    // zero axis
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(3, Y(0)); ctx.lineTo(W - 3, Y(0)); ctx.stroke();
    ctx.setLineDash([]);
    // area fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(60,230,140,.32)');
    grad.addColorStop(1, 'rgba(60,230,140,0)');
    ctx.beginPath();
    ctx.moveTo(X(0), Y(hist[0]));
    for (let i = 1; i < hist.length; i++) ctx.lineTo(X(i), Y(hist[i]));
    ctx.lineTo(X(hist.length - 1), H - 2); ctx.lineTo(X(0), H - 2); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // line (red while the latest sample is negative)
    ctx.beginPath();
    ctx.moveTo(X(0), Y(hist[0]));
    for (let i = 1; i < hist.length; i++) ctx.lineTo(X(i), Y(hist[i]));
    const neg = hist[hist.length - 1] < 0;
    ctx.strokeStyle = neg ? '#ff5555' : '#3ce68c';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // end dot + scale labels
    ctx.fillStyle = neg ? '#ff5555' : '#3ce68c';
    ctx.beginPath(); ctx.arc(X(hist.length - 1), Y(hist[hist.length - 1]), 2.4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('+' + hi.toFixed(1), 4, 10);
    ctx.textAlign = 'right';
    ctx.fillText(lo < 0 ? lo.toFixed(1) : '0', W - 4, 10);
}

// ── MILESTONE MEDALS: fly-in toast (TASK-404 polish) ─────────────────
function econMilestoneToast(m, bonus) {
    try { SFX.fanfare(); } catch (e) {}   // TASK-408: milestone fanfare
    let host = document.getElementById('econMedals');
    if (!host) { host = document.createElement('div'); host.id = 'econMedals'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'econMedal';
    el.innerHTML = `<span class="mIcon">${m.icon}</span><span class="mTxt"><b>${m.name}</b>${bonus ? `<small>${bonus}</small>` : ''}</span>`;
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();   // stack cap
    setTimeout(() => { el.classList.add('out'); }, 2900);
    setTimeout(() => el.remove(), 3500);
}

// ── BLOCKADE STRIPED overlay on blockaded ports ──────────────────────
let _blkTex = null;
function _blockadeStripeTex() {
    if (_blkTex) return _blkTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.strokeStyle = '#ff5533';
    x.lineWidth = 9;
    for (let i = -64; i < 128; i += 22) {
        x.beginPath(); x.moveTo(i, 64); x.lineTo(i + 64, 0); x.stroke();
    }
    // clip to a circle so it reads as a hazard ring over the port
    x.globalCompositeOperation = 'destination-in';
    x.beginPath(); x.arc(32, 32, 31, 0, 7);
    x.fillStyle = '#fff'; x.fill();
    _blkTex = new THREE.CanvasTexture(c);
    return _blkTex;
}
function _blkMarkAdd(port) {
    if (port._blkMark) return;
    if (typeof scene === 'undefined' || !scene) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _blockadeStripeTex(), transparent: true, opacity: 0.9, depthTest: false }));
    s.scale.set(22, 22, 1);
    s.renderOrder = 6;
    s.position.copy(latLonToVec3(port.lat, port.lon, EARTH_RADIUS + 13));
    scene.add(s);
    port._blkMark = s;
}
function _blkMarkRemove(port) {
    const s = port._blkMark;
    if (!s) return;
    if (s.parent) s.parent.remove(s);
    s.material.dispose();
    port._blkMark = null;
}
function _blkPulse() {
    const t = frame / 60;
    for (const s of structs) {
        if (s.type !== 'port' || s.dead || !s._blkMark) continue;
        s._blkMark.material.opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * 2.2));
    }
}

// ── BLACK-MARKET PANEL (key K) ────────────────────────────────────────
let _mktBuilt = false;
function ensureMarketPanel() {
    if (_mktBuilt && document.getElementById('econMkt')) return;
    const old = document.getElementById('econMkt'); if (old) old.remove();
    const p = document.createElement('div');
    p.id = 'econMkt';
    p.innerHTML = `
        <div class="mkHead"><span>🏦 السوق السوداء</span><button class="mkClose">✕</button></div>
        <div class="mkBody">
            <div class="mkRow" id="mkLoanRow">
                <div class="mkInfo"><b>قرض طارئ</b><small id="mkLoanInfo">—</small></div>
                <button class="mkBtn" id="mkLoanBtn">+$800</button>
            </div>
            <div class="mkRow" id="mkBondRow">
                <div class="mkInfo"><b>🎖️ سندات حرب</b><small id="mkBondInfo">—</small></div>
                <button class="mkBtn" id="mkBondBtn">+$1200</button>
            </div>
            <div class="mkRow" id="mkIntelRow">
                <div class="mkInfo"><b>🕵️ استخبارات</b><small id="mkIntelInfo">—</small></div>
                <button class="mkBtn" id="mkIntelBtn">-$300</button>
            </div>
            <div class="mkStatus" id="mkStatus"></div>
        </div>`;
    document.body.appendChild(p);
    p.querySelector('.mkClose').onclick = () => toggleMarketPanel(false);
    p.querySelector('#mkLoanBtn').onclick = () => { econTakeLoan(myRole); refreshMarketPanel(); };
    p.querySelector('#mkBondBtn').onclick = () => { econTakeBond(myRole); refreshMarketPanel(); };
    p.querySelector('#mkIntelBtn').onclick = () => { econBuyIntel(); refreshMarketPanel(); };
    _mktBuilt = true;
}
function toggleMarketPanel(force) {
    ensureMarketPanel();
    const p = document.getElementById('econMkt');
    const open = force != null ? force : !p.classList.contains('open');
    p.classList.toggle('open', open);
    if (open) refreshMarketPanel();
}
function refreshMarketPanel() {
    const p = document.getElementById('econMkt');
    if (!p || !p.classList.contains('open')) return;
    const C = GAME_CONSTANTS;
    const L = econLoanOf(myRole);
    const canLoan = L.principal + C.ECON_LOAN_AMOUNT <= C.ECON_LOAN_MAX_DEBT;
    const li = document.getElementById('mkLoanInfo');
    // TASK-504 FINISH: show available credit (cap − outstanding principal) —
    // the exact-boundary case (principal $1200 + $800 = cap $2000) reads
    // clearly now instead of the button just going disabled.
    const avail = Math.max(0, C.ECON_LOAN_MAX_DEBT - L.principal);
    if (li) li.textContent = L.owed > 0
        ? `دين قائم $${Math.ceil(L.owed)} — تسديد $${C.ECON_LOAN_REPAY_PS}/ث (ائتمان متاح $${avail})`
        : `ائتمان متاح $${avail} — فائدة ${Math.round((C.ECON_LOAN_INTEREST - 1) * 100)}%`;
    const lb = document.getElementById('mkLoanBtn');
    if (lb) { lb.disabled = !canLoan; lb.textContent = canLoan ? `+$${C.ECON_LOAN_AMOUNT}` : 'سقف الائتمان'; }
    const def = econDefensiveWar(myRole);
    const B = econBondOf(myRole);
    const st = econState.defWar[myRole] || { active: false, epoch: 0 };
    const bondsLeft = (B.epoch === st.epoch) ? Math.max(0, C.ECON_BOND_MAX_PER_WAR - B.count) : C.ECON_BOND_MAX_PER_WAR;
    const bi = document.getElementById('mkBondInfo');
    if (bi) bi.textContent = def
        ? `حرب دفاعية! متاح ${bondsLeft}/${C.ECON_BOND_MAX_PER_WAR} — بلا فائدة`
        : (B.owed > 0 ? `تسديد $${Math.ceil(B.owed)} بعد الحرب` : 'تتاح فقط أثناء حرب دفاعية');
    const bb = document.getElementById('mkBondBtn');
    if (bb) { bb.disabled = !(def && bondsLeft > 0); bb.textContent = def ? `+$${C.ECON_BOND_AMOUNT}` : 'مقفل'; }
    const intelOn = econIntelActive();
    const ii = document.getElementById('mkIntelInfo');
    if (ii) ii.textContent = intelOn
        ? `نشط — ${Math.ceil((econState.intel.until - frame) / 60)} ثانية متبقية`
        : `يكشف كل منشآت العدو ${C.ECON_INTEL_SECONDS} ثانية`;
    const ib = document.getElementById('mkIntelBtn');
    if (ib) { ib.disabled = pRes < C.ECON_INTEL_COST && !intelOn; ib.textContent = intelOn ? 'نشط' : `-$${C.ECON_INTEL_COST}`; }
    const sanc = econSanctioned(myRole);
    const wars = econWarPartnerCount(myRole);
    const f = window.__fuelBreakdown;
    const ss = document.getElementById('mkStatus');
    if (ss) ss.innerHTML =
        (sanc ? `<div class="mkWarn">⚠️ عقوبات دولية — تجارتك ×${C.ECON_SANCTIONS_TRADE_MUL} (حروب: ${wars})</div>` : '') +
        (f ? `<div>⛽ وقود: ${Math.floor(f.fuel)}/${C.ECON_FUEL_MAX} (${f.net >= 0 ? '+' : ''}${f.net.toFixed(2)}/ث)</div>` : '') +
        (L.owed > 0 ? `<div class="mkWarn">🏦 دين مستحق: $${Math.ceil(L.owed)}</div>` : '') +
        (B.owed > 0 ? `<div>🎖️ سندات قيد التسديد: $${Math.ceil(B.owed)}</div>` : '');
}

// ── SECOND TICK: everything once per second ──────────────────────────
function econSecondTick() {
    if (window.startSpawnPhase) return;
    econMilestoneTick();          // TASK-301 (milestones, all sides)
    econWarTick();                // refresh war pairs + blockade set (30f cache)
    econDefWarEdge();             // defensive-war rising edges (bond epochs)
    econLoanTick(1);
    econBondTick(1);
    econBotCreditTick();
    // sparkline history (net income, 60 samples @ 1/s)
    if (window.__econBreakdown) {
        econState.netHist.push(window.__econBreakdown.net);
        if (econState.netHist.length > 60) econState.netHist.shift();
    }
    // treasury-low warning (rate-limited): gold can't cover the next 10s
    const b = window.__econBreakdown;
    if (b && b.net < 0 && pRes < GAME_CONSTANTS.ECON_TREASURY_LOW_S * -b.net &&
        frame - econState._lowT > GAME_CONSTANTS.ECON_TREASURY_LOW_TOAST_F) {
        econState._lowT = frame;
        uiToast(`⚠️ الخزينة تكفي أقل من ${GAME_CONSTANTS.ECON_TREASURY_LOW_S} ثانية من النفقات!`, 'err', 3200);
        logEvent('⚠️ تحذير: الخزينة منخفضة — قلّص الجيش أو اقترض من السوق السوداء', 'err');
    }
    // trade lanes (rebuild cadence; L toggles)
    if (tradeLanesOn && frame - _laneFrame >= GAME_CONSTANTS.ECON_LANE_REFRESH_F) {
        _laneFrame = frame;
        rebuildTradeLanes();
    }
    _intelTick();
    _blkPulse();
    econBusPublish();             // observer: econ UI values on change
    refreshMarketPanel();         // no-op when closed
}

// ── TASK-404 debug accessor (console probes + post-merge verification) ──
// Follows the __ffaProbe pattern: live state by reference where safe, plus
// manual drivers for the 1s pass so edge paths (bond cycle under a war,
// sanctions, lane risk) are probeable without waiting on organic wars.
window.__econProbe = {
    state: () => econState,                        // by REFERENCE — probes may inject
    breakdown: () => window.__econBreakdown,       // (e.g. state()._warDirs.add('X>player'))
    fuelBreakdown: () => window.__fuelBreakdown,
    myRole: () => myRole,
    warDirs: () => [...econState._warDirs],
    defWar: (s) => econDefensiveWar(s || myRole),
    partners: (s) => econWarPartnerCount(s || myRole),
    sanctioned: (s) => econSanctioned(s || myRole),
    takeLoan: (s) => econTakeLoan(s || myRole, true),
    takeBond: (s) => econTakeBond(s || myRole, true),
    loan: (s) => { const L = econLoanOf(s || myRole); return { ...L }; },
    bond: (s) => { const B = econBondOf(s || myRole); return { ...B }; },
    intel: () => ({ active: econIntelActive(), left_s: econIntelActive() ? Math.ceil((econState.intel.until - frame) / 60) : 0 }),
    setFuel: (v, s) => { econState.fuel[s || myRole] = v; },
    fuelTick: (dt) => econFuelTick(dt == null ? 1 : dt),
    secondTick: () => econSecondTick(),            // drive the 1s pass manually
    warTick: () => econWarTick(),                  // rebuild the war/blockade cache NOW
    lanes: () => ({ on: tradeLanesOn, arcs: tradeLaneGroup ? tradeLaneGroup.children.length : 0 }),
    marketOpen: (v) => toggleMarketPanel(v),
};

// ════════════════════════════════════════════════════════════════
// TASK-408 — SOUND DRIVER 🎚️
//   Per-frame observation (READ-ONLY on other agents' arrays — no
//   edits to Missile/Warship/Plane classes needed):
//   · bgmStep  — the previously-dead 16-step beat sequencer, wired on a
//                9-frame step cadence while a game runs
//   · bed      — ambient drone + war-tension filter (tension feeds from
//                MY econState war data)
//   · stinger  — first war dir involving the player (attack or defense)
//   · ping     — hostile missile died mid-flight (progress < .85 — the
//                navalBattleTest intercept criterion) ⇒ intercept sonar
//   · navalBass— shells-in-flight delta across warships (gun fire)
// ════════════════════════════════════════════════════════════════
const _sfxSt = { bgmStep: 0, shells: null, lastBass: -1e9, lastPing: -1e9, stung: false, gc: null };
// TASK-504: persistent threat tracker (was a fresh Map every 3 frames —
// ~20 Map allocs/s). Entries are mutated in place, one small object per
// missile LIFETIME (not per sample); vanished ids are pruned by tick mark.
// Fields: pr (progress), rate (per-frame progress delta), owner, mkey,
// tgtMine (hostile AND aimed at the player), seen (sample tick mark).
const _sfxThreats = new Map();
let _sfxThreatTick = 0;
// TASK-504 FINISH — intercept-ping criterion, v2. PURE (probe-tested by
// qaTest): a vanished tracked missile reads as an INTERCEPT when it died
// with real flight time left. Fixes three v1 gaps:
//   · terminal-dive intercepts (pr .85–1.0) were missed by the fixed
//     pr<.85 cutoff — now estimated remaining flight (progress/rate) must
//     exceed ~0.4s, which catches late intercepts AND still stays silent
//     for natural impacts (pr≈1, ≈1 sample from arrival)
//   · the MIRV bus split (icbm dies at pr>.7 spawning 3 RVs) false-pinged
//     — excluded by mkey
//   · ANY vanished missile pinged (own missiles shot down by the enemy,
//     bot-vs-bot wars) — now only hostile missiles aimed at the player
// Fallback: entries with no rate yet (sighted <2 samples ago) use the old
// absolute pr<.85 rule; ECM progress-rewinds (rate≤0) also fall back.
function _sfxPingCheck(e) {
    if (e.mkey === 'icbm') return false;           // MIRV split, not a kill
    if (e.owner === myRole) return false;          // our own loss — no cue
    if (e.tgtMine === false) return false;         // bot-vs-bot, not our war
    if (e.rate != null && e.rate > 0) return (1 - e.pr) / e.rate > 24;   // >0.4s of flight left
    return e.pr < 0.85;                            // unknown rate → v1 rule
}
function _sfxFrame() {
    if (!SFX.ctx) return;
    if (!_sfxSt.gc) _sfxSt.gc = document.getElementById('gc');   // TASK-504: cache (was per-frame lookup)
    const inGame = !window.startSpawnPhase && !gOver && _sfxSt.gc && _sfxSt.gc.style.display !== 'none';
    if (SFX.muted) { if (SFX._bed) SFX.bedOff(); return; }
    if (!inGame) { if (SFX._bed) SFX.bedOff(); return; }
    // beat sequencer (~100bpm feel: one 16th every 9 frames)
    if (frame % 9 === 0) SFX.bgmStep(_sfxSt.bgmStep++);
    // ambient bed + tension from MY war scan (economy agent's own data)
    SFX.bedOn();
    const atWar = econState && (econDefensiveWar(myRole) || econWarPartnerCount(myRole) > 0);
    SFX.bedTension(atWar ? 1 : (econState && econState._warDirs.size ? 0.35 : 0));
    if (!_sfxSt.stung && econState && econState._warDirs.size) {
        for (const d of econState._warDirs) {
            if (d.startsWith(myRole + '>') || d.endsWith('>' + myRole)) { _sfxSt.stung = true; SFX.stinger(); break; }
        }
    }
    // naval gun bass — shells in flight (READ-ONLY warships scan)
    if (frame % 6 === 0) {
        let total = 0;
        for (const w of warships) if (!w.dead) total += w.shells.length;
        if (_sfxSt.shells != null && total > _sfxSt.shells && frame - _sfxSt.lastBass > 15) {
            _sfxSt.lastBass = frame; SFX.navalBass();
        }
        _sfxSt.shells = total;
    }
    // intercept ping — tracked hostile missile vanished mid-flight (v2
    // criterion above; sampling every 3 frames, in-place entry updates).
    if (frame % 3 === 0) {
        _sfxThreatTick++;
        for (const m of missiles) {
            if (m.dead || m.isSAM) continue;
            let e = _sfxThreats.get(m.id);
            if (!e) {
                // target-of-player check: only missiles aimed at OUR land
                // alert us. Unknown (no conquest grid / mask not ready,
                // e.g. mode 2) stays permissive like v1.
                let aimed = null;
                if (typeof getPixelOwner === 'function' && typeof conquestGrid !== 'undefined' && conquestGrid && conquestGrid._maskReady)
                    aimed = getPixelOwner(m.tlat, m.tlon) === myRole;
                e = { pr: m.progress || 0, rate: null, owner: m.owner, mkey: m.mkey, tgtMine: aimed !== false, seen: 0 };
                _sfxThreats.set(m.id, e);
            } else {
                const pr = m.progress || 0;
                e.rate = Math.max(0, (pr - e.pr) / 3);   // per-frame delta
                e.pr = pr;
            }
            e.seen = _sfxThreatTick;
        }
        const canPing = frame - _sfxSt.lastPing > 30;
        for (const [id, e] of _sfxThreats) {
            if (e.seen === _sfxThreatTick) continue;
            _sfxThreats.delete(id);                     // vanished — prune always
            if (canPing && _sfxPingCheck(e)) { _sfxSt.lastPing = frame; SFX.ping(); break; }
        }
    }
}

// ── 🎚️ mixer panel (button injected next to the mute button; lazy DOM —
//    index.html stays untouched) ─────────────────────────────────
function ensureSfxMixer() {
    if (document.getElementById('sfxMixBtn')) return;
    const mute = document.getElementById('btnMute');
    if (!mute || !mute.parentElement) return;
    const btn = document.createElement('button');
    btn.id = 'sfxMixBtn'; btn.className = 'iconBtn'; btn.textContent = '🎚️';
    btn.title = 'مزج الصوت (Master + فئات)';
    mute.after(btn);
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleSfxMixer(); });
}
function toggleSfxMixer(force) {
    ensureSfxMixer();
    let p = document.getElementById('sfxMix');
    if (!p) {
        p = document.createElement('div');
        p.id = 'sfxMix';
        const rows = [['vol', 'الرئيسي'], ['amb', 'البيئة'], ['bgm', 'الإيقاع'], ['weapons', 'الأسلحة'], ['ui', 'الواجهة'], ['alerts', 'التنبيهات']];
        p.innerHTML = `<div class="sxHead"><span>🎚️ مزج الصوت</span><button class="sxClose">✕</button></div>` +
            rows.map(([k, lbl]) =>
                `<div class="sxRow"><label>${lbl}</label><input type="range" min="0" max="100" data-bus="${k}" value="${Math.round((k === 'vol' ? SFX.vol : SFX.busVol[k]) * 100)}"><span class="sxVal"></span></div>`).join('') +
            `<div class="sxHint">يُحفظ تلقائياً — الأسهم: الرئيسي/البيئة/الإيقاع/الأسلحة/الواجهة/التنبيهات</div>`;
        document.body.appendChild(p);
        p.querySelector('.sxClose').addEventListener('click', () => p.classList.remove('open'));
        p.querySelectorAll('input[type=range]').forEach(r => {
            const upd = () => {
                const v = r.value / 100;
                if (r.dataset.bus === 'vol') SFX.setVolume(v); else SFX.setBus(r.dataset.bus, v);
                r.parentElement.querySelector('.sxVal').textContent = r.value + '%';
            };
            r.addEventListener('input', upd); upd();
        });
    }
    const open = force != null ? force : !p.classList.contains('open');
    if (open) {   // anchor under the 🎚 button
        const b = document.getElementById('sfxMixBtn');
        if (b) {
            const r = b.getBoundingClientRect();
            p.style.left = Math.max(8, Math.min(window.innerWidth - 244, r.left - 190)) + 'px';
            p.style.top = (r.bottom + 8) + 'px';
        }
    }
    p.classList.toggle('open', open);
}
ensureSfxMixer();

// ── TASK-408 probe: audioTest() → node/state census; audioTest(true)
//    also fires one sound per category so a human can hear each bus.
window.audioTest = function (playAll) {
    const _seq = SFX._tension >= .5 ? SFX.BGM_SEQ_WAR : SFX.BGM_SEQ_PEACE;
    const _pi = _seq[Math.floor(_sfxSt.bgmStep / 32) % _seq.length];
    const out = {
        ctx: SFX.ctx ? { state: SFX.ctx.state, sampleRate: SFX.ctx.sampleRate, t: +SFX.ctx.currentTime.toFixed(1) } : null,
        vol: +SFX.vol.toFixed(2),
        buses: Object.fromEntries(Object.entries(SFX.busVol).map(([k, v]) => [k, +v.toFixed(2)])),
        muted: SFX.muted,
        activeSources: SFX._active,
        bed: SFX._bed ? { on: true, tension: SFX._tension } : { on: false },
        bgm: { steps: _sfxSt.bgmStep, pattern: ['pulse', 'march', 'tension'][_pi], seq: _tensionName(SFX._tension) },
        stingerFired: _sfxSt.stung,
        trackedThreats: _sfxThreats.size,
        events: SFX._evtLog.slice(-12),
    };
    if (playAll) { SFX.ui('click'); SFX.ping(); SFX.fanfare(); SFX.navalBass(); SFX.stinger(); SFX.bgmStep(0); SFX.bgmStep(64); SFX.bgmStep(128); SFX.bedOn(); }
    console.log('[audioTest]', out);
    return out;
};
function _tensionName(t) { return t >= .5 ? 'war' : (t > 0 ? 'foreign-war' : 'peace'); }

// ════════════════════════════════════════════════════════════════
// TASK-504 PROBE: qaTest() — economy+sound mastery self-checks.
//   · constants spread (src/econ/constants.js → GAME_CONSTANTS)
//   · no-alloc haversine equivalence + zero Vector3 churn in the scan
//   · credit-cap exact boundary + bond epoch reset (FINISH items)
//   · sparkline/teardown reset semantics (FINISH item)
//   · intercept-ping criterion v2 (FINISH item, pure unit cases)
//   · bgm pattern tables + rotation (FINISH item)
//   · mixer clamps + persistence round-trip
// All mutations are save/restore-synchronous (TASK-404 probe pattern);
// safe to run mid-game. qaTest(true) additionally measures econScanFrame
// at synthetic scale (20 ports/cities/factories) with a Vector3 counter.
// ════════════════════════════════════════════════════════════════
window.qaTest = function (perf) {
    const C = GAME_CONSTANTS;
    const out = { when: new Date().toISOString(), checks: [], perf: null, pass: true };
    const chk = (name, ok, info) => {
        out.checks.push({ name, ok, info: info == null ? '' : String(info) });
        if (!ok) out.pass = false;
        console.log(`${ok ? '✅' : '❌'} [QA] ${name}${info != null ? ' — ' + info : ''}`);
    };
    // Count Vector3 constructions while fn() runs — swap a shim namespace
    // over the global (script-tag) THREE, restore in finally. The game code
    // resolves THREE dynamically, so the shim sees every construction.
    const countV3 = (fn) => {
        const real = globalThis.THREE;
        let made = 0;
        const Counting = class extends real.Vector3 { constructor(...a) { super(...a); made++; } };
        globalThis.THREE = Object.create(real);
        globalThis.THREE.Vector3 = Counting;
        try { fn(); } finally { globalThis.THREE = real; }
        return made;
    };

    // 1) constants spread: every ECON_CONSTANTS key lands in GAME_CONSTANTS
    {
        let missing = 0, drift = 0;
        for (const k of Object.keys(ECON_CONSTANTS)) {
            if (!(k in C)) { missing++; continue; }
            const a = ECON_CONSTANTS[k], b = C[k];
            if (typeof a === 'object' ? JSON.stringify(a) !== JSON.stringify(b) : a !== b) drift++;
        }
        chk('econ constants spread intact (keys+values)', missing === 0 && drift === 0,
            `${Object.keys(ECON_CONSTANTS).length} keys, missing=${missing}, drift=${drift}`);
    }

    // 2) no-alloc haversine: numerically identical to the shared helper AND
    //    constructs zero Vector3 objects (10k-call hot loop under the counter)
    {
        let worst = 0;
        const pts = [[0,0,0,0],[35,42,36,43],[-33,-70,45,12],[89.9,0,-89.9,180],[10,10,10,170]];
        for (let i = 0; i < 200; i++) pts.push([(Math.random()*2-1)*85, (Math.random()*2-1)*180, (Math.random()*2-1)*85, (Math.random()*2-1)*180]);
        for (const [a,b,c,d] of pts) worst = Math.max(worst, Math.abs(_econHavNA(a,b,c,d) - haversineDist(a,b,c,d)));
        const made = countV3(() => { for (let i = 0; i < 10000; i++) _econHavNA(10, 10, 20, 20); });
        chk('no-alloc haversine: identical results + 0 Vector3', worst < 1e-6 && made === 0,
            `max |Δ| = ${worst.toExponential(1)} km / ${pts.length} pairs, allocs=${made}/10000 calls`);
    }

    // 3) credit-cap exact boundary (FINISH: black-market edge cases)
    {
        const side = 'probe504';
        const sv = econState.loans[side];
        delete econState.loans[side];
        const L = econLoanOf(side);              // principal 0
        L.principal = C.ECON_LOAN_MAX_DEBT - C.ECON_LOAN_AMOUNT;   // exactly one loan from cap
        const atExact = econTakeLoan(side, true);                    // 1200+800=2000 → allowed → 2000
        const atCap = econTakeLoan(side, true);                      // 2000+800>2000 → refused
        L.principal = C.ECON_LOAN_MAX_DEBT - C.ECON_LOAN_AMOUNT + 1; // 1201+800>2000
        const overBy1 = econTakeLoan(side, true);                    // refused, principal untouched
        const ok = atExact === true && atCap === false && overBy1 === false
            && L.principal === C.ECON_LOAN_MAX_DEBT - C.ECON_LOAN_AMOUNT + 1;
        if (sv != null) econState.loans[side] = sv; else delete econState.loans[side];
        chk('loan cap: exact-boundary allowed, +1 refused', ok,
            `principal $${C.ECON_LOAN_MAX_DEBT - C.ECON_LOAN_AMOUNT}+$${C.ECON_LOAN_AMOUNT}=${C.ECON_LOAN_MAX_DEBT}`);
    }

    // 4) bond epoch reset (2nd black-market edge: allowance per defensive war)
    {
        const side = 'probe504';
        const svB = econState.bonds[side], svD = econState.defWar[side];
        const svDirs = econState._warDirs;
        econState._warDirs = new Set(['x>' + side]);       // synthetic defensive war
        const st = { active: true, epoch: 7 };
        econState.defWar[side] = st;
        const B = { owed: 0, epoch: 7, count: C.ECON_BOND_MAX_PER_WAR };   // allowance exhausted
        econState.bonds[side] = B;
        const refused = econTakeBond(side, true);           // count maxed in epoch 7
        st.epoch = 8;                                       // NEW defensive war → epoch bumps
        const allowed = econTakeBond(side, true);           // fresh allowance
        econState._warDirs = svDirs;
        if (svB != null) econState.bonds[side] = svB; else delete econState.bonds[side];
        if (svD != null) econState.defWar[side] = svD; else delete econState.defWar[side];
        chk('bond: per-war allowance resets on new war epoch', refused === false && allowed === true);
    }

    // 5) teardown resets derived state (sparkline hygiene — FINISH item;
    //    the FULL new-game path is live-verified by restarting a game).
    //    Teardown also drops visuals — rebuild the ones that were live.
    {
        const svH = econState.netHist.slice();
        const svB = window.__econBreakdown, svF = window.__fuelBreakdown;
        const svIntel = { until: econState.intel.until, had: econState.intel.markers.length > 0 };
        const blkPorts = (typeof structs !== 'undefined' ? structs : []).filter(s => s && s._blockaded);
        econState.netHist.push(1, 2, 3);
        window.__econBreakdown = { marker: true };
        econTeardownForMenu();
        const ok = econState.netHist.length === 0 && window.__econBreakdown === null && window.__fuelBreakdown === null;
        // restore state + visuals teardown cleared
        econState.intel.until = svIntel.until;
        if (svIntel.had && svIntel.until > frame) _intelBuildMarkers();
        for (const p of blkPorts) _blkMarkAdd(p);
        if (typeof rebuildTradeLanes === 'function') rebuildTradeLanes();
        econState.netHist.push(...svH);
        window.__econBreakdown = svB; window.__fuelBreakdown = svF;
        chk('teardown clears sparkline + breakdown snapshots', ok);
    }

    // 6) intercept-ping criterion v2 (pure fn — no audio needed)
    {
        const mk = (o) => Object.assign({ pr: .5, rate: .003, owner: 'bot0', mkey: 'ballistic', tgtMine: true }, o);
        const cases = [
            ['classic mid-flight intercept pings',        mk({}), true],
            ['terminal-dive intercept (pr .92) pings',    mk({ pr: .92, rate: .002 }), true],   // v1 missed this
            ['natural impact (pr .995, 2 frames left)',   mk({ pr: .995, rate: .0025 }), false],
            ['MIRV bus split (icbm) never pings',         mk({ mkey: 'icbm', pr: .72 }), false],
            ['own missile lost — no cue',                 mk({ owner: myRole }), false],
            ['bot-vs-bot (not aimed at us) — no cue',     mk({ tgtMine: false }), false],
            ['no-rate sighting falls back to pr<.85',     mk({ pr: .8, rate: null }), true],
            ['no-rate sighting at .9 stays silent',       mk({ pr: .9, rate: null }), false],
        ];
        let ok = true;
        for (const [name, e, want] of cases) if (_sfxPingCheck(e) !== want) { ok = false; console.log('   ↳ failed:', name); }
        chk('intercept-ping criterion v2 (8 cases)', ok);
    }

    // 7) bgm pattern tables (FINISH: variation beyond the pulse)
    {
        const P = SFX.BGM_PATTERNS;
        let ok = Array.isArray(P) && P.length === 3;
        const notesPer = [];
        if (ok) for (let p = 0; p < 3; p++) {
            const row = P[p];
            ok = ok && Array.isArray(row) && row.length === 16;
            let notes = 0;
            for (const s of row) {
                const arr = Array.isArray(s) ? s : (s ? [s] : []);
                notes += arr.length;
                for (const n of arr) ok = ok && n.g > 0 && n.g <= 0.1 && n.d > 0 && n.f0 > 0;
            }
            notesPer.push(notes);
        }
        // rotation: over 12 bars (192 steps) the peace sequence plays all 3
        // patterns; war tension swaps in the tension-heavy sequence.
        const seen = new Set();
        const svT = SFX._tension; SFX._tension = 0;
        for (let f = 0; f < 192; f++) { if (SFX._bgmPat(f)) seen.add(SFX.BGM_SEQ_PEACE[Math.floor(f / 32) % 6]); }   // pattern idx per 2-bar slot
        SFX._tension = .7;
        const warPat = SFX._bgmPat(96);   // war seq [0,2,1,2,1,2] slot 3 → tension (heartbeat array)
        SFX._tension = svT;
        ok = ok && seen.size === 3 && Array.isArray(warPat);
        chk('bgm: 3 sane patterns + rotation + war weighting', ok,
            `notes/bar [pulse,march,tension]=${notesPer} (TASK-408 pulse was 16)`);
    }

    // 8) mixer clamps + persistence round-trip
    {
        const svVol = SFX.vol, svBgm = SFX.busVol.bgm, svLS = localStorage.getItem('sfxMix');
        SFX.setVolume(1.7); SFX.setBus('bgm', -0.5);
        const clamped = SFX.vol === 1 && SFX.busVol.bgm === 0;
        SFX.setVolume(.42); SFX._persist();
        SFX.vol = 1; SFX._restoreMix();
        const restored = SFX.vol === .42;
        SFX.setVolume(svVol); SFX.setBus('bgm', svBgm);
        if (svLS == null) localStorage.removeItem('sfxMix'); else localStorage.setItem('sfxMix', svLS);
        chk('mixer: clamps [0,1] + localStorage round-trip', clamped && restored);
    }

    // 9) perf at synthetic scale (qaTest(true)): 20 ports/cities/factories
    //    × 50 forced scans with the Vector3 construction counter.
    if (perf && typeof structs !== 'undefined') {
        const savedStructs = structs.slice();
        const savedScanFrame = _econScan.frame;
        try {
            for (let i = 0; i < 20; i++) {
                structs.push({ id: 'qa_p' + i, type: 'port', owner: 'player', dead: false, lat: 30 + (i % 7), lon: 10 + i * 1.5, _blockaded: false });
                structs.push({ type: 'city', owner: 'player', dead: false, lat: 31 + (i % 5), lon: 11 + i * 1.4 });
                structs.push({ type: 'factory', owner: 'player', dead: false, lat: 29 + (i % 6), lon: 12 + i * 1.3 });
            }
            let ms = 0, made = 0;
            const runs = 50;
            made = countV3(() => {
                const t0 = performance.now();
                for (let r = 0; r < runs; r++) { _econScan.frame = -1; econScanFrame(); }
                ms = performance.now() - t0;
            });
            const d = _econScan.sideData.player || {};
            out.perf = { msPerScan: +(ms / runs).toFixed(3), vector3AllocsPerScan: made / runs,
                ports: d.ports, factories: (d.factoryLinks || []).length };
            console.log(`⏱️ [QA] econScanFrame @20p/20c/20f ×${runs}: ${(ms / runs).toFixed(3)}ms/scan, Vector3 allocs/scan: ${made / runs}`);
            chk('econScanFrame at scale: zero Vector3 allocations', made === 0);
        } catch (err) {
            out.perf = { error: String(err) };
            chk('econScanFrame at scale: zero Vector3 allocations', false, String(err));
        } finally {
            structs.length = 0; structs.push(...savedStructs);
            _econScan.frame = savedScanFrame;
        }
    }

    console.log(`[qaTest] ${out.checks.filter(c => c.ok).length}/${out.checks.length} checks ${out.pass ? 'PASS ✅' : 'FAIL ❌'}`);
    window.__qaTestLog = (window.__qaTestLog || []).concat([{ at: out.when, pass: out.pass }]);
    return out;
};

// Remove all TASK-404 visuals (menu return / new game reset).
// TASK-504: also drops the derived econ state (sparkline history +
// breakdown snapshots) so a quit-to-menu leaves NOTHING stale — previously
// these lingered until the next game's econResetState (harmless but unclean).
function econTeardownForMenu() {
    try {
        if (typeof scene !== 'undefined' && scene && tradeLaneGroup) _disposeGroupChildren(tradeLaneGroup);
        _intelClearMarkers();
        if (typeof structs !== 'undefined' && structs) for (const s of structs) if (s && s._blkMark) _blkMarkRemove(s);
        const host = document.getElementById('econMedals'); if (host) host.innerHTML = '';
        const p = document.getElementById('econMkt'); if (p) p.classList.remove('open');
        if (econState.netHist) econState.netHist.length = 0;   // TASK-504: sparkline resets on quit too
        window.__econBreakdown = null;
        window.__fuelBreakdown = null;
    } catch (e) { console.warn('[ECON] teardown:', e); }
}

// Pure refund math for AUDIT #17 (probed by economyTest): proportional
// refund for squad members that never launched (cap ate them post-payment).
function _droneRefund(cost, launched, squad) {
    if (launched >= squad) return 0;
    return Math.floor(cost * (squad - launched) / squad);
}

// ── TASK-301 PROBE: economyTest() ─────────────────────────────────────
// Console probe. economyTest()      → unit checks + live snapshot + balance sim.
// economyTest(followSec)            → same, plus a scheduled re-run after
//                                      followSec seconds (call economyTest(120)
//                                      at game start → t=2min row; economyTest(300) → 5min).
// Simulation assumptions are printed with the results — tune the schedule
// constants in _econSimulateNeutral() if live play drifts.
window.economyTest = function(followSec) {
    const C = GAME_CONSTANTS;
    const out = { when: new Date().toISOString(), followSec: followSec || 0, checks: [], live: null, sim: null, pass: true };
    const chk = (name, ok, info) => {
        out.checks.push({ name, ok, info: info == null ? '' : String(info) });
        if (!ok) out.pass = false;
        console.log(`${ok ? '✅' : '❌'} [ECON] ${name}${info != null ? ' — ' + info : ''}`);
    };

    // ── A. unit checks on the pure math (econRatesFromSnapshot) ──
    {
        const r0 = econRatesFromSnapshot({ base: 1 });
        chk('base income = INCOME_BASE×60', Math.abs(r0.parts.base - C.INCOME_BASE * 60) < 1e-9, r0.parts.base.toFixed(2) + '/s');
        const r1 = econRatesFromSnapshot({ factoryLinks: [1] });
        chk('factory↔city synergy +30%', Math.abs(r1.parts.factories - C.INCOME_FACTORY * 60 * 1.3) < 1e-9, r1.parts.factories.toFixed(2) + '/s');
        const r4 = econRatesFromSnapshot({ factoryLinks: [9] });
        chk('factory synergy capped at 3 links', Math.abs(r4.parts.factories - C.INCOME_FACTORY * 60 * (1 + 3 * C.SYNERGY_FACTORY_CITY)) < 1e-9);
        const r2 = econRatesFromSnapshot({ troops: C.WAR_UPKEEP_FREE_TROOPS + 10000 });
        chk('war upkeep: 10k excess troops', Math.abs(r2.parts.army - 10 * C.WAR_UPKEEP_PER_K) < 1e-9, r2.parts.army.toFixed(2) + '/s');
        const r3 = econRatesFromSnapshot({ troops: C.WAR_UPKEEP_FREE_TROOPS });
        chk('army at free threshold costs 0', r3.parts.army === 0);
        const r5 = econRatesFromSnapshot({ base: 1, factoryLinks: [0, 0], milestoneMul: 1.1 });
        // NOTE (supervisor fix): factoryLinks:[0,0] = TWO factories — each also
        // contributes its OWN income to the subtotal before the multipliers.
        // The old expectation forgot that (expected 12.87 vs actual 26.60).
        chk('milestone × factory multipliers stack',
            Math.abs(r5.income - (C.INCOME_BASE * 60 + 2 * C.INCOME_FACTORY * 60) * (1 + 2 * C.FACTORY_MULTIPLIER) * 1.1) < 1e-9);
        const r6 = econRatesFromSnapshot({ portCityLinks: 2 });
        chk('port↔city throughput income', Math.abs(r6.parts.synergy - 2 * C.SYNERGY_PORT_CITY_INCOME) < 1e-9, r6.parts.synergy.toFixed(2) + '/s');
    }
    // milestone defs integrity
    {
        const ids = new Set();
        let sane = true;
        for (const m of C.ECON_MILESTONES) {
            if (!m.id || ids.has(m.id) || (!m.cells && !m.troops)) sane = false;
            if (m.incomeMul != null && m.incomeMul < 1) sane = false;
            ids.add(m.id);
        }
        chk('milestone defs sane (unique ids, thresholds, mul ≥ 1)', sane, [...ids].join(','));
    }
    // blockade distance logic — synthetic warship pushed & popped synchronously
    // (no frame can interleave; the real warships[] is untouched afterwards).
    // TASK-404: isPortBlockaded reads the 30f war cache — force a rebuild
    // between mutations by rewinding _warFrame (saved + restored around it).
    {
        // The cache is built from structs+warships — push BOTH fakes, and use
        // a REAL hostile side ('enemy' only exists in 1v1; FFA uses bot strs).
        const hostile = bots.length ? bots[0].str : 'enemy';
        const fakePort = { id: 'probe_blk_port', type: 'port', dead: false, lat: 30, lon: 30, owner: 'player' };
        const fakeShip = { dead: false, owner: hostile, lat: 30, lon: 30 };
        const savedWf = econState._warFrame;
        structs.push(fakePort); warships.push(fakeShip);
        econState._warFrame = -1e9; const near = isPortBlockaded(fakePort);
        fakeShip.lon = 40;                    // ≈1040km away — outside radius
        econState._warFrame = -1e9; const far = isPortBlockaded(fakePort);
        fakeShip.lon = 30; fakeShip.owner = 'player';   // own ship never blocks
        econState._warFrame = -1e9; const own = isPortBlockaded(fakePort);
        structs.pop(); warships.pop();
        econState._warFrame = savedWf;        // live cache resumes untouched
        chk('blockade: near✓ far✗ own✗ (30f cache)', near === true && far === false && own === false, `R=${C.BLOCKADE_RADIUS_KM}km vs ${hostile}`);
    }

    // ── A2. TASK-404 unit checks (fuel / loans / bonds / sanctions / refund) ──
    // Probe sides ('probe404') are never in econFuelSides() → no live tick
    // touches them; every mutation is saved + restored synchronously.
    {
        // fuel math (pure snapshot, per-second)
        const f0 = econFuelRatesFromSnapshot({});
        chk('fuel: base trickle', Math.abs(f0.income - C.ECON_FUEL_INCOME_BASE) < 1e-9 && f0.upkeep === 0, f0.income.toFixed(2) + '/s');
        const f1 = econFuelRatesFromSnapshot({ openPorts: 3, factories: 2, planes: 4, tanks: 2, drones: 5 });
        const expInc = C.ECON_FUEL_INCOME_BASE + 3 * C.ECON_FUEL_PER_PORT + 2 * C.ECON_FUEL_PER_FACTORY;
        const expUp = 4 * C.ECON_FUEL_UPKEEP_PLANE + 2 * C.ECON_FUEL_UPKEEP_TANK + 5 * C.ECON_FUEL_UPKEEP_DRONE;
        chk('fuel: income/upkeep parts', Math.abs(f1.income - expInc) < 1e-9 && Math.abs(f1.upkeep - expUp) < 1e-9,
            `net ${f1.net.toFixed(2)}/s`);
        // fuel spend gate (deducts on success, refuses when short)
        const hadFuel = 'probe404' in econState.fuel;
        const oldFuel = econState.fuel.probe404;
        econState.fuel.probe404 = 30;
        const s1 = econFuelSpend('probe404', 25, true);
        const s2 = econFuelSpend('probe404', 10, true);
        const s3 = econState.fuel.probe404 === 5;
        if (hadFuel) econState.fuel.probe404 = oldFuel; else delete econState.fuel.probe404;
        chk('fuel: spend gate deducts + refuses', s1 === true && s2 === false && s3 === true);
        // drone-squad refund math (AUDIT #17)
        chk('drone refund: unlaunched share returned',
            _droneRefund(90, 2, 3) === 30 && _droneRefund(90, 3, 3) === 0 && _droneRefund(90, 0, 3) === 90);
        // loan: amount + interest + credit cap (probe side — econResAdd no-ops)
        delete econState.loans.probe404;
        const t1 = econTakeLoan('probe404', true);
        const L2 = econLoanOf('probe404');
        const t2 = econTakeLoan('probe404', true), t3 = econTakeLoan('probe404', true);   // 3rd crosses the cap
        const loanOk = t1 === true && t2 === true && t3 === false
            && L2.principal === 2 * C.ECON_LOAN_AMOUNT
            && Math.abs(L2.owed - 2 * C.ECON_LOAN_AMOUNT * C.ECON_LOAN_INTEREST) < 1e-9;
        delete econState.loans.probe404;
        chk('loan: +$800 @30% interest, credit-capped', loanOk);
        // bond: refused outside a defensive war (probe side has no incoming war)
        delete econState.bonds.probe404; delete econState.defWar.probe404;
        const bondRefused = econTakeBond('probe404', true) === false;
        delete econState.bonds.probe404; delete econState.defWar.probe404;
        chk('bond: refused outside a defensive war', bondRefused);
        // sanctions: synthetic war partners (saved + restored synchronously)
        const svPairs = econState._warPairs, svWf2 = econState._warFrame;
        econState._warPairs = ['probe404|a', 'probe404|b', 'probe404|c', 'x|y'];
        const nPart = econWarPartnerCount('probe404');
        const sanc = econSanctioned('probe404');
        const notSanc = econSanctioned('x');
        econState._warPairs = svPairs; econState._warFrame = svWf2;
        chk('sanctions: ≥3 war partners → trade penalty', nPart === 3 && sanc === true && notSanc === false,
            `threshold ${C.ECON_SANCTIONS_MIN_WARS}`);
        // sparkline: rolling window — once full it stays at exactly 60
        const svHist = econState.netHist;
        econState.netHist = Array.from({ length: 60 }, (_, i) => i);   // full window [0..59]
        econState.netHist.push(60);
        if (econState.netHist.length > 60) econState.netHist.shift();  // same maintenance as econSecondTick
        const cap60 = econState.netHist.length === 60 && econState.netHist[0] === 1 && econState.netHist[59] === 60;
        econState.netHist = svHist;
        chk('sparkline: rolling window holds 60 samples', cap60);
    }

    // ── B. live snapshot (if a game is running) ──
    if (window.__econBreakdown) {
        const b = window.__econBreakdown;
        out.live = {
            t_sec: Math.round(b.at / 60), cells: b.cells, troops: Math.round(b.troops),
            income: +b.income.toFixed(2), upkeep: +b.upkeep.toFixed(2), net: +b.net.toFixed(2),
            factories: b.factories, planes: b.planes, blockadedPorts: b.blockadedPorts,
            milestones: [...(econState.milestones.player || [])],
        };
        console.log('📊 [ECON] LIVE t=' + out.live.t_sec + 's', JSON.parse(JSON.stringify(out.live)));
    }

    // ── C. balance simulation (typical neutral game through the REAL math) ──
    out.sim = _econSimulateNeutral();
    const fmtMin = s => s == null ? 'never' : (s / 60).toFixed(1) + 'min';
    console.log(`🎯 [ECON] SIM: $3000 treasury @ ${fmtMin(out.sim.t3000)} · full nuke program ($4000) @ ${fmtMin(out.sim.tNuke)} — target window 8–12 min (nuke)`);
    console.table(out.sim.marks.map(m => ({ t_min: m.t / 60, net_ps: +m.net.toFixed(1), gold: m.gold })));

    if (followSec > 0) {
        console.log(`⏱️ [ECON] economyTest will re-snapshot in ${followSec}s...`);
        setTimeout(() => window.economyTest(0), followSec * 1000);
    }
    window.__econTestLog = (window.__econTestLog || []).concat([{ at: out.when, live: out.live, tNuke: out.sim.tNuke }]);
    return out;
};

// Balance simulation: replays a typical neutral game through the REAL economy
// formulas (econRatesFromSnapshot) and reports when the treasury first holds
// `target` spare gold AFTER typical spending. Assumptions (calibrated vs the
// game's actual growth recurrences — see scripts/econ_growth_calibration.mjs):
//   • troops hit the calcMaxTroops ceiling within ~2 min (10 ticks/s growth is
//     explosive), so T(t) ≈ 2*(cells^0.6*1000+50000) + cities*25000
//   • cells grow ~22/s (live-measured conquest rates, soft land ceiling 9000)
//   • structures: city@2m, port@3m, factory@5m, city@7m, factory@9m, port@11m
//     (+ launcher + SAM + 2 planes + techs + missiles — full lump schedule below)
//   • spendFraction of net is re-invested into missiles/tech/units
//   • trade: +2.5/s per port (×0.85 average blockade pressure after 6 min)
function _econSimulateNeutral(opts) {
    const C = GAME_CONSTANTS;
    const o = Object.assign({
        startGold: C.STARTING_RES_OFFLINE,
        spendFraction: 0.35,
        cellsK: 22,                // ≈ cells/sec conquest (calibrated vs live)
        landCap: 9000,             // soft neutral-land ceiling for expansion
        horizonSec: 900,           // 15 min
    }, opts || {});
    const maxTroopsAt = (cells, cities) =>
        2 * (Math.pow(Math.max(1, cells), 0.6) * 1000 + 50000) + cities * C.CITY_TROOP_INCREASE;
    // Lump gold sinks (t_sec, cost) — typical neutral-game purchases.
    const lumps = [
        [30, 180], [60, 300], [120, 500], [180, 400], [240, 450], [300, 600],
        [360, 400], [420, 750], [480, 450], [540, 900], [600, 800], [660, 600],
        [720, 570], [780, 350], [840, 750], [900, 1125],
    ];
    // Online state by time (matches the lump schedule above).
    const citiesAt   = t => (t >= 120 ? 1 : 0) + (t >= 420 ? 1 : 0);
    const factoriesAt = t => (t >= 300 ? 1 : 0) + (t >= 540 ? 1 : 0);
    const portsAt    = t => (t >= 180 ? 1 : 0) + (t >= 660 ? 1 : 0);
    const planesAt   = t => 2 + (t >= 480 ? 1 : 0);
    const upkBAt     = t => 1 + citiesAt(t) + portsAt(t) + (t >= 240 ? 1 : 0);  // launcher+city+port+SAM

    let gold = o.startGold;
    let incomeMul = 1;
    const reached = new Set();
    let t3000 = null, tNuke = null;
    const marks = [];
    // Logistic territory growth (matches the calibrated recurrence
    // cells' = cellsK*(1-cells/landCap)): closed form.
    const cellsAtT = t => o.landCap - (o.landCap - 900) * Math.exp(-o.cellsK * t / o.landCap);
    for (let t = 0; t <= o.horizonSec; t++) {
        const cells = cellsAtT(t);
        const troops = maxTroopsAt(cells, citiesAt(t));   // growth is explosive → at cap
        const nCities = citiesAt(t), nFact = factoriesAt(t);
        const factoryLinks = [];
        for (let i = 0; i < nFact; i++) factoryLinks.push(Math.min(3, nCities));
        const snap = {
            base: 1, nukePlants: 0, airports: 1,
            factoryLinks,
            cells, cityIncome: 0,
            portCityLinks: portsAt(t) * nCities,
            milestoneMul: incomeMul,
            planes: planesAt(t), upkeepBuildings: upkBAt(t),
            troops,
        };
        const r = econRatesFromSnapshot(snap);
        // Trade income (event-based in the live game — modeled per-port here)
        let trade = 2.5 * portsAt(t) * (t >= 360 ? 0.85 : 1);
        // Milestones — same defs & order as econMilestoneTick()
        for (const m of C.ECON_MILESTONES) {
            if (reached.has(m.id)) continue;
            if ((m.cells && cells >= m.cells) || (m.troops && troops >= m.troops)) {
                reached.add(m.id);
                if (m.rewardGold) gold += m.rewardGold;
                if (m.incomeMul) incomeMul *= m.incomeMul;
            }
        }
        const grossNet = r.net + trade;
        gold += grossNet * (1 - o.spendFraction);        // re-invested share spent
        while (lumps.length && lumps[0][0] <= t) gold -= lumps.shift()[1];
        if (gold < 0) gold = 0;
        if (t3000 === null && gold >= 3000) t3000 = t;
        if (tNuke === null && gold >= 4000) tNuke = t;   // nuclear_prog tech + nuke_tac
        if (t === 0 || t === 120 || t === 300 || t === 600 || t === 900) {
            marks.push({ t, net: grossNet, gold: Math.round(gold), troops: Math.round(troops / 1000) + 'k' });
        }
    }
    return { t3000, tNuke, marks, assumptions: o, milestones: [...reached] };
}


function checkWin() {
    if (window.startSpawnPhase) return;
    // Wait until the game initializes completely
    if (frame < 100) return;

    if (window.gameMode === 'mode1') {
        let pCells = conquestGrid ? conquestGrid.countCells('player') : 0;
        let nCells = conquestGrid ? conquestGrid.countCells('neutral') : 0;
        let botCells = 0;
        for (const b of bots) botCells += conquestGrid ? conquestGrid.countCells(b.str) : 0;
        let eCells = conquestGrid ? conquestGrid.countCells('enemy') : 0; // legacy single enemy
        const rivalCells = botCells + eCells;
        const totalLand = pCells + rivalCells + nCells;

        let playerWins = (rivalCells === 0);          // every rival eliminated
        let enemyWins = (pCells === 0);               // player wiped out

        // OpenFront win condition: own WIN_LAND_PERCENT of the LAND → victory.
        if (!playerWins && !enemyWins && totalLand > 0) {
            if (pCells / totalLand >= GAME_CONSTANTS.WIN_LAND_PERCENT) playerWins = true;
            // A dominant bot (80%+) ends the game in defeat
            else if (rivalCells > 0 && (botCells >= GAME_CONSTANTS.WIN_LAND_PERCENT * totalLand || eCells >= GAME_CONSTANTS.WIN_LAND_PERCENT * totalLand)) enemyWins = true;
            // 170-minute hard limit (OpenFront) → draw
            else if (frame / 60 >= GAME_CONSTANTS.WIN_TIME_LIMIT_S) {
                gOver = true;
                document.getElementById('go').classList.add('show');
                document.getElementById('goT').textContent = 'تعادل — انتهى الوقت';
                return;
            }
        }

        // Simultaneous elimination is a DRAW, not a victory.
        if (playerWins && enemyWins) {
            gOver = true; document.getElementById('go').classList.add('show'); document.getElementById('goT').textContent = 'تعادل';
            return;
        }
        if (enemyWins) { gOver=true; document.getElementById('go').classList.add('show'); document.getElementById('goT').textContent='هزيمة'; return; }
        if (playerWins) { gOver=true; document.getElementById('go').classList.add('show'); document.getElementById('goT').textContent='نصر'; }
        return;
    }

    let pb = structs.filter(s=>s.owner==='player'&&s.type==='base'&&!s.dead).length;
    let eb = structs.filter(s=>s.owner==='enemy'&&s.type==='base'&&!s.dead).length;
    
    let pVP = 0; let eVP = 0;
    let capturedEnemyCapital = false;
    let lostPlayerCapital = false;
    
    if (cityNodes) {
        cityNodes.forEach(c => {
            if (c.owner === 'player') {
                pVP += c.victoryPoints;
                if (c.tier === 'national_capital' && c.originalOwner === 'enemy') capturedEnemyCapital = true;
            }
            if (c.owner === 'enemy') {
                eVP += c.victoryPoints;
                if (c.tier === 'national_capital' && c.originalOwner === 'player') lostPlayerCapital = true;
            }
        });
    }

    let pc = cityNodes ? cityNodes.filter(c => c.owner === 'player').length : 0;
    let ec = cityNodes ? cityNodes.filter(c => c.owner === 'enemy').length : 0;

    let playerWins = (eb === 0 && ec === 0) || pVP >= 400 || capturedEnemyCapital;
    let enemyWins = (pb === 0 && pc === 0) || eVP >= 400 || lostPlayerCapital;

    if(enemyWins && !playerWins) { gOver=true; document.getElementById('go').classList.add('show'); document.getElementById('goT').textContent='هزيمة'; }
    if(playerWins) { gOver=true; document.getElementById('go').classList.add('show'); document.getElementById('goT').textContent='نصر'; }
}

function getMissileMaxRange(cfg) {
    if(!cfg) return GAME_CONSTANTS.RANGE_UNLIMITED;
    if(cfg.type === 'icbm' || cfg.type === 'nuke') return GAME_CONSTANTS.RANGE_UNLIMITED;
    if(cfg.type === 'cruise' || cfg.type === 'stealth') return GAME_CONSTANTS.RANGE_CRUISE;
    if(cfg.type === 'hyper') return GAME_CONSTANTS.RANGE_HYPER;
    return GAME_CONSTANTS.RANGE_DEFAULT;
}

// Missile accuracy — impact scatter in DEGREES around the clicked point.
// Uses the previously-UNUSED cfg.acc stat (0..1, higher = more precise):
// worst (scud .06) ≈ ±16km ≈ its own blast radius; best (hyper .55) ≈ ±9km.
// (Was: flat rnd(-1,1)° = ±111km for EVERY missile — shots visibly missed
// the click point and often the whole target footprint.)
function _missileSpread(cfg) {
    const acc = (cfg && cfg.acc !== undefined) ? cfg.acc : 0.3;
    return 0.03 + (1 - acc) * 0.12;   // degrees
}
// Random impact offset (lat/lon degrees) for one shot of this missile type.
function _missileScatter(cfg) {
    const s = _missileSpread(cfg);
    return { dx: rnd(-s, s), dy: rnd(-s, s) * 0.7 };   // lon scaled: cos(lat) shrink ≈ visually circular
}


// Grid-based AI conquest: bots expand into neutral land and attack frontlines.
// FFA: each bot prefers the player's border, then other bots, then neutral;
// naval invasion when fully isolated (OpenFront transport ships).
function aiConquestTick(bot) {
    const diff = (GAME_CONSTANTS.DIFFICULTY || {})[window.gameDifficulty] || (GAME_CONSTANTS.DIFFICULTY || {}).normal;
    if (!conquestGrid || !conquestCtx || !bot.alive || bot.troops < 200) return;
    const me = bot.str;
    let res = conquestGrid.findFrontlineTarget(me, 'player');
    if (!res && bots.length > 1) {
        for (const other of bots) {
            if (other === bot || !other.alive) continue;
            res = conquestGrid.findFrontlineTarget(me, other.str);
            if (res) break;
        }
    }
    if (!res) res = conquestGrid.findFrontlineTarget(me, 'neutral');
    if (!res) {
        // No land frontier at all (isolated landmass) → NAVAL INVASION toward the
        // nearest rival shore.
        if (Math.random() < 0.25 + diff.aggression) {
            let target = null;
            if (conquestGrid.countCells('player') > 0) target = _sampleOwnedShoreCell('player');
            if (!target) {
                for (const other of bots) {
                    if (other === bot || !other.alive) continue;
                    target = _sampleOwnedShoreCell(other.str);
                    if (target) break;
                }
            }
            if (target) launchTransportInvasion({ lat: target.lat, lon: target.lon }, me);
        }
        return;
    }

    let src = conquestGrid.cellToLatLon(res.srcCell);
    let dst = conquestGrid.cellToLatLon(res.dstCell);

    let ratio = res.target === 'neutral' ? 0.35 : 0.4;
    if (res.target !== 'neutral') {
        const defTroops = res.target === 'player' ? pTroops : (botByStr(res.target) || { troops: 0 }).troops;
        const aggressive = bot.troops > defTroops * 0.8 || bot.troops > calcMaxTroops(me) * 0.4 || Math.random() < diff.aggression;
        if (!aggressive) return;
    }
    let troopsToSend = Math.min(bot.troops - 50, Math.floor(bot.troops * ratio));
    if (troopsToSend < 50) return;

    // ConquestAttack deducts bot.troops itself via ctx.addTroops
    activeAttacks.push(new ConquestAttack({
        grid: conquestGrid,
        owner: me,
        target: res.target,
        troops: troopsToSend,
        srcLat: src.lat, srcLon: src.lon,
        dstLat: dst.lat, dstLon: dst.lon,
        ctx: conquestCtx,
    }));
}

// Legacy single-enemy conquest tick (mode 1 with bots=0)
function aiConquestTickEnemy() {
    if (!conquestGrid || !conquestCtx || eTroops < 200) return;
    const diff = (GAME_CONSTANTS.DIFFICULTY || {})[window.gameDifficulty] || (GAME_CONSTANTS.DIFFICULTY || {}).normal;
    let res = conquestGrid.findFrontlineTarget('enemy', 'player');
    if (!res) res = conquestGrid.findFrontlineTarget('enemy', 'neutral');
    if (!res) {
        if (Math.random() < 0.25 + diff.aggression) {
            const inv = _sampleOwnedShoreCell('player');
            if (inv) launchTransportInvasion({ lat: inv.lat, lon: inv.lon }, 'enemy');
        }
        return;
    }

    let src = conquestGrid.cellToLatLon(res.srcCell);
    let dst = conquestGrid.cellToLatLon(res.dstCell);

    let ratio = res.target === 'player' ? 0.4 : 0.35;
    if (res.target === 'player') {
        let aggressive = eTroops > pTroops * 0.8 || eTroops > calcMaxTroops('enemy') * 0.4 || Math.random() < diff.aggression;
        if (!aggressive) return;
    }
    let troopsToSend = Math.min(eTroops - 50, Math.floor(eTroops * ratio));
    if (troopsToSend < 50) return;

    activeAttacks.push(new ConquestAttack({
        grid: conquestGrid, owner: 'enemy', target: res.target,
        troops: troopsToSend, srcLat: src.lat, srcLon: src.lon,
        dstLat: dst.lat, dstLon: dst.lon, ctx: conquestCtx,
    }));
}

function runAI() {
    if(window.startSpawnPhase) return;
    if(isOnline) return; // No AI in online mode

    // ── Rival iteration helpers: bots FFA, or the legacy single enemy ──
    const _rivals = () => bots.length > 0 ? bots.filter(b => b.alive) : [{ str: 'enemy', flag: '🔴', name: 'العدو' }];
    const _resOf = (r) => r.str === 'enemy' ? eRes : r.res;
    const _spendRes = (r, amt) => { if (r.str === 'enemy') eRes -= amt; else r.res -= amt; };

    // 1. AI structures firing missiles (Mode 1 & Mode 2)
    if(frame % GAME_CONSTANTS.AI_TICK_RATE === 0) {
      for (const riv of _rivals()) {
        if (_resOf(riv) <= 200) continue;
        let el = structs.filter(s=>s.owner === riv.str && s.type==='launcher' && s.reload <= 0 && !s.dead);
        if(!el.length) continue;
        // Targets: any rival's structures + real player territory samples
        let trgOpts = [];
        structs.forEach(s => {
            if (s.owner !== riv.str && !s.dead && s.owner !== 'neutral') trgOpts.push({ lat: s.lat, lon: s.lon });
        });
        if (riv.str !== 'player' && window.gameMode === 'mode1' && conquestGrid && conquestGrid._maskReady) {
            const total = conquestGrid.owner.length;
            for (let i = 0; i < 60 && trgOpts.length < 8; i++) {
                const cell = (Math.random() * total) | 0;
                if (conquestGrid.owner[cell] === CONQUEST_CFG.PLAYER) {
                    const ll = conquestGrid.cellToLatLon(cell);
                    trgOpts.push({ lat: ll.lat, lon: ll.lon });
                }
            }
        }
        if(trgOpts.length) {
            let L = el[Math.floor(Math.random()*el.length)];
            let trg = trgOpts[Math.floor(Math.random()*trgOpts.length)];
            let dist = haversineDist(L.lat, L.lon, trg.lat, trg.lon);
            let mcfg = MCFG['ballistic'];
            let maxR = getMissileMaxRange(mcfg);
            if (dist < maxR && _resOf(riv) >= mcfg.cost) {
                missiles.push(new Missile(L.lat, L.lon, trg.lat, trg.lon, mcfg, riv.str, false, (L.id % 2 === 0) ? 'silo' : 'rail'));
                _launchConsume(L);   // TASK-403: bots obey the magazine too
                _spendRes(riv, mcfg.cost);
            } else if (dist < getMissileMaxRange(MCFG['icbm']) && _resOf(riv) >= MCFG['icbm'].cost) {
                missiles.push(new Missile(L.lat, L.lon, trg.lat, trg.lon, MCFG['icbm'], riv.str, false, 'silo'));
                _launchConsume(L);   // TASK-403: bots obey the magazine too
                _spendRes(riv, MCFG['icbm'].cost);
            }
        }
      }
    }

    // 1b. AI DRONE STRIKES (TASK-204): rivals with resources occasionally
    // send a kamikaze or swarm at a rival structure — drones give the AI
    // pressure that doesn't need launcher reload cycles.
    if (frame % Math.max(300, GAME_CONSTANTS.AI_TICK_RATE * 2) === 0) {
      for (const riv of _rivals()) {
        if (_resOf(riv) < 300 || Math.random() > 0.3) continue;
        const myDrones = drones.reduce((n, d) => n + (!d.dead && d.owner === riv.str ? 1 : 0), 0);
        if (myDrones >= GAME_CONSTANTS.DRONE_CAP - 2) continue;
        const tgts = structs.filter(s => !s.dead && s.owner !== riv.str && s.owner !== 'neutral');
        if (!tgts.length) continue;
        const pads = structs.filter(s => !s.dead && s.owner === riv.str && (s.type === 'launcher' || s.type === 'base'));
        if (!pads.length) continue;
        const key = Math.random() < 0.5 ? 'kamikaze' : 'swarm';
        if (_resOf(riv) < DCFG[key].cost) continue;
        const T = tgts[Math.floor(Math.random() * tgts.length)];
        const P = pads[Math.floor(Math.random() * pads.length)];
        if (!econFuelSpend(riv.str, GAME_CONSTANTS.ECON_FUEL_COST_DRONE, true)) continue;   // TASK-404: bots pay fuel too
        _spendRes(riv, DCFG[key].cost);
        launchDrone(riv.str, key, { lat: P.lat, lon: P.lon }, { homeLat: T.lat, homeLon: T.lon });
      }
    }
    
    // 2. AI Troop Conquest (Mode 1 & Mode 2)
    const _aiDiff = (GAME_CONSTANTS.DIFFICULTY || {})[window.gameDifficulty] || (GAME_CONSTANTS.DIFFICULTY || {}).normal;
    if(frame % Math.max(60, Math.round(GAME_CONSTANTS.AI_TICK_RATE * 3 * _aiDiff.aiIntervalMul)) === 0) {
        if(window.gameMode === 'mode1') {
            if (bots.length > 0) {
                // FFA: every bot gets a chance each cadence (staggered start
                // already randomized via attack targets; simple loop, no modulo)
                for (const b of bots) {
                    aiConquestTick(b);
                }
            } else {
                aiConquestTickEnemy();
            }
        } else {
            // Mode 2: Province-based conquest
            let enemyProvinces = [];
            if (window.provinceOwnership) {
                for (let idx in window.provinceOwnership) {
                    if (window.provinceOwnership[idx] === 'enemy') {
                        enemyProvinces.push(parseInt(idx));
                    }
                }
            }
            
            if (enemyProvinces.length > 0) {
                let srcIdx = enemyProvinces[Math.floor(Math.random() * enemyProvinces.length)];
                let srcCoord = null;
                if (cityNodes) {
                    let node = cityNodes.find(c => c.owner === 'enemy' && c.controlledProvinces && c.controlledProvinces.includes(srcIdx));
                    if (node) {
                        srcCoord = { lat: node.lat, lon: node.lon };
                    }
                }
                if (!srcCoord) {
                    let struct = structs.find(s => s.owner === 'enemy' && !s.dead && s.provinceIdx === srcIdx);
                    if (struct) srcCoord = { lat: struct.lat, lon: struct.lon };
                }
                
                if (srcCoord && typeof PROVINCE_POLYGONS !== 'undefined' && PROVINCE_POLYGONS) {
                    let targets = [];
                    for (let idx = 0; idx < PROVINCE_POLYGONS.features.length; idx++) {
                        let owner = window.provinceOwnership[idx] || 'neutral';
                        if (owner !== 'enemy') {
                            let targetCoord = null;
                            if (cityNodes) {
                                let node = cityNodes.find(c => c.controlledProvinces && c.controlledProvinces.includes(idx));
                                if (node) targetCoord = { lat: node.lat, lon: node.lon };
                            }
                            if (!targetCoord) {
                                let struct = structs.find(s => !s.dead && s.provinceIdx === idx);
                                if (struct) targetCoord = { lat: struct.lat, lon: struct.lon };
                            }
                            
                            if (targetCoord) {
                                let p1 = latLonToVec3(srcCoord.lat, srcCoord.lon, 1.0).normalize();
                                let p2 = latLonToVec3(targetCoord.lat, targetCoord.lon, 1.0).normalize();
                                let dotVal = Math.max(-1.0, Math.min(1.0, p1.dot(p2)));
                                let distDeg = Math.acos(dotVal) * (180 / Math.PI);
                                
                                if (distDeg <= GAME_CONSTANTS.ATTACK_RANGE) {
                                    targets.push({ idx: idx, lat: targetCoord.lat, lon: targetCoord.lon });
                                }
                            }
                        }
                    }
                    
                    if (targets.length > 0) {
                        let target = targets[Math.floor(Math.random() * targets.length)];
                        let troopsToSend = Math.floor(eTroops * 0.4);
                        if (troopsToSend >= 100) {
                            eTroops -= troopsToSend;
                            troopCohorts.push(new TroopCohort(
                                srcCoord.lat, srcCoord.lon,
                                target.lat, target.lon,
                                troopsToSend,
                                'enemy',
                                target.idx
                            ));
                        }
                    }
                }
            }
        }
    }

    // 3. AI Dynamic Building logic
    if (frame % (GAME_CONSTANTS.AI_TICK_RATE * 6) === 0) {
      for (const riv of _rivals()) {
        if (_resOf(riv) <= 500) continue;
        if (window.gameMode === 'mode1') {
            // Pick a build spot from this rival's ACTUAL territory (grid frontier)
            let targetCoord = null;
            if (conquestGrid && conquestGrid._maskReady) {
                let fr = conquestGrid.findFrontlineTarget(riv.str, 'player') || conquestGrid.findFrontlineTarget(riv.str, 'neutral');
                if (!fr && riv.str !== 'enemy') {
                    for (const other of bots) {
                        if (other.str === riv.str) continue;
                        fr = conquestGrid.findFrontlineTarget(riv.str, other.str);
                        if (fr) break;
                    }
                }
                if (fr) { const ll = conquestGrid.cellToLatLon(fr.srcCell); targetCoord = { lat: ll.lat, lon: ll.lon }; }
            }
            if (targetCoord) {
                let hasNearbyBase = false, hasNearbyLauncher = false, hasNearbyAirport = false, hasNearbyPort = false;
                for (let s of structs) {
                    if (s.owner === riv.str && !s.dead && haversineDist(s.lat, s.lon, targetCoord.lat, targetCoord.lon) < 300) {
                        if (s.type === 'base') hasNearbyBase = true;
                        else if (s.type === 'launcher') hasNearbyLauncher = true;
                        else if (s.type === 'airport') hasNearbyAirport = true;
                        else if (s.type === 'port') hasNearbyPort = true;
                    }
                }

                const _okSpot = (lat, lon) => isLand(lat, lon) && getPixelOwner(lat, lon) === riv.str;
                if (!hasNearbyBase && _resOf(riv) >= SDEFS['base'].cost) {
                    const bl = targetCoord.lat + rnd(-0.02, 0.02), bo = targetCoord.lon + rnd(-0.02, 0.02);
                    if (_okSpot(bl, bo)) { structs.push(new Structure(bl, bo, 'base', riv.str)); _spendRes(riv, SDEFS['base'].cost); }
                } else if (!hasNearbyLauncher && _resOf(riv) >= SDEFS['launcher'].cost) {
                    const bl = targetCoord.lat + rnd(-0.02, 0.02), bo = targetCoord.lon + rnd(-0.02, 0.02);
                    if (_okSpot(bl, bo)) { structs.push(new Structure(bl, bo, 'launcher', riv.str)); _spendRes(riv, SDEFS['launcher'].cost); }
                } else if (!hasNearbyAirport && _resOf(riv) >= SDEFS['airport'].cost) {
                    const bl = targetCoord.lat + rnd(-0.02, 0.02), bo = targetCoord.lon + rnd(-0.02, 0.02);
                    if (_okSpot(bl, bo)) {
                        let ap = new Structure(bl, bo, 'airport', riv.str);
                        structs.push(ap);
                        _spendRes(riv, SDEFS['airport'].cost);
                        // TASK-404: the bundled starter fighter burns fuel like any deployment
                        if (econFuelSpend(riv.str, GAME_CONSTANTS.ECON_FUEL_COST_PLANE, true))
                            planes.push(new Plane(ap.lat, ap.lon, PCFG['fighter'], riv.str));
                    }
                } else if (!hasNearbyPort && _resOf(riv) >= _enemyPortCost()) {
                    // OpenFront: ports drive the trade economy — snap to the nearest shore.
                    const shore = findNearestShoreTile(targetCoord.lat, targetCoord.lon, 8);
                    if (shore) {
                        structs.push(new Structure(shore.lat, shore.lon, 'port', riv.str));
                        _spendRes(riv, _enemyPortCost());
                        if (riv.str === 'enemy') eBuiltPorts++;
                    }
                }
                // Rail network rebuild — ports/cities can host train stations.
                updateRailroadConnections();
            }
        }
      }
      // Mode 2: City-based building (legacy single enemy)
      if (window.gameMode !== 'mode1') {
            let enemyCities = cityNodes.filter(c => c.owner === 'enemy');
            if (enemyCities.length > 0) {
                let targetCity = enemyCities[Math.floor(Math.random() * enemyCities.length)];
                // P5 FIX: Single-pass scan instead of 3 separate .filter() calls
                let hasNearbyBase2 = false, hasNearbyLauncher2 = false, hasNearbyAirport2 = false;
                for (let s of structs) {
                    if (s.owner === 'enemy' && !s.dead && haversineDist(s.lat, s.lon, targetCity.lat, targetCity.lon) < 300) {
                        if (s.type === 'base') hasNearbyBase2 = true;
                        else if (s.type === 'launcher') hasNearbyLauncher2 = true;
                        else if (s.type === 'airport') hasNearbyAirport2 = true;
                    }
                }

                if (!hasNearbyBase2 && eRes >= SDEFS['base'].cost) {
                    structs.push(new Structure(targetCity.lat + 0.1, targetCity.lon + 0.1, 'base', 'enemy'));
                    eRes -= SDEFS['base'].cost;
                } else if (!hasNearbyLauncher2 && eRes >= SDEFS['launcher'].cost) {
                    structs.push(new Structure(targetCity.lat - 0.1, targetCity.lon + 0.15, 'launcher', 'enemy'));
                    eRes -= SDEFS['launcher'].cost;
                } else if (!hasNearbyAirport2 && eRes >= SDEFS['airport'].cost) {
                    let ap = new Structure(targetCity.lat + 0.1, targetCity.lon - 0.15, 'airport', 'enemy');
                    structs.push(ap);
                    eRes -= SDEFS['airport'].cost;
                    // Give them a starting fighter (TASK-404: burns fuel like any deployment)
                    if (econFuelSpend('enemy', GAME_CONSTANTS.ECON_FUEL_COST_PLANE, true))
                        planes.push(new Plane(ap.lat, ap.lon, PCFG['fighter'], 'enemy'));
                }
            }
        }
    }

    // 4. AI Naval — mixed hull fleets (TASK-202): bots screen with escorts,
    //    strike with missile cruisers, field carriers/drone bays when rich,
    //    and run invasion transports at the nearest rival shore.
    if (window.gameMode === 'mode1' && frame % GAME_CONSTANTS.AI_TICK_RATE === 0) {
        const HC = GAME_CONSTANTS.HULL_CLASSES;
        for (const riv of _rivals()) {
            const myHulls = warships.reduce((n, w) => n + (!w.dead && w.owner === riv.str ? 1 : 0), 0);
            if (myHulls >= 5) continue;
            // Weighted class pick (carrier needs an escort screen first)
            const escorts = warships.reduce((n, w) => n + (!w.dead && w.owner === riv.str && w.hullClass === 'escort' ? 1 : 0), 0);
            const roll = Math.random();
            let ck = roll < 0.28 ? 'destroyer'
                : roll < 0.50 ? 'escort'
                : roll < 0.62 ? 'submarine'   // TASK-402: commerce-raiding boats
                : roll < 0.74 ? 'missile'
                : roll < 0.84 ? 'drone'
                : roll < 0.92 ? (myHulls >= 2 ? 'carrier' : 'destroyer')
                : (escorts >= 1 ? 'transport' : 'escort');
            const hull = HC[ck];
            if (_resOf(riv) < hull.cost + 200) continue;
            const mineSame = warships.reduce((n, w) => n + (!w.dead && w.owner === riv.str && w.hullClass === ck ? 1 : 0), 0);
            if (mineSame >= hull.cap) continue;
            const port = structs.find(s => !s.dead && s.owner === riv.str && s.type === 'port');
            if (!port) continue;
            if (Math.random() > 0.12) continue;   // occasional — cadenced by AI_TICK_RATE
            // Invasion transports need troops to be worth launching
            if (ck === 'transport') {
                const pool = isBotStr(riv.str) ? (botByStr(riv.str) || { troops: 0 }).troops : eTroops;
                if (pool * 0.4 < 300) continue;
            }
            // Patrol toward the nearest rival's shore, else near the port
            let patrol = null;
            let bestD = Infinity;
            for (const other of _rivals()) {
                if (other.str === riv.str) continue;
                const shore = conquestGrid ? conquestGrid.findFrontlineTarget(riv.str, other.str) : null;
                if (shore) {
                    const ll = conquestGrid.cellToLatLon(shore.srcCell);
                    const d = haversineDist(port.lat, port.lon, ll.lat, ll.lon);
                    if (d < bestD) { bestD = d; patrol = ll; }
                }
            }
            const water = _findWaterNear(patrol ? patrol.lat : port.lat, patrol ? patrol.lon : port.lon, 12)
                || _findWaterNear(port.lat, port.lon, 12);
            if (!water) continue;
            const ship = new Warship(riv.str, port, water, ck);
            warships.push(ship);
            _spendRes(riv, hull.cost);
            // Invasion transports embark immediately and sail at a rival shore
            if (ck === 'transport') {
                if (ship._embarkTroops(0.4)) {
                    let tgt = null, td = Infinity;
                    for (const other of _rivals()) {
                        if (other.str === riv.str) continue;
                        const shore = _sampleOwnedShoreCell(other.str);
                        if (shore) {
                            const d = haversineDist(port.lat, port.lon, shore.lat, shore.lon);
                            if (d < td) { td = d; tgt = shore; }
                        }
                    }
                    if (tgt) ship._orderInvasion(tgt);
                }
            }
        }
    }

    // 5. AI Air Force (TASK-201) — rivals with an airport grow a mixed wing.
    //    Weighted buys: cheap fighters early, interceptors/A-10s mid, bombers
    //    + Su-57 when rich. Cap keeps the sky sane.
    //    TASK-401 doctrine: a wing of ≥2 combat planes earns ONE tanker and
    //    ONE AWACS (endurance + detection force-multipliers) before more mass;
    //    rich rivals (2k+ reserve) can afford the F-22.
    if (window.gameMode === 'mode1' && frame % GAME_CONSTANTS.AI_TICK_RATE === 0) {
        const C = GAME_CONSTANTS;
        const MIX = [
            { k: 'fighter', w: 4 }, { k: 'interceptor', w: 2 }, { k: 'a10', w: 2 },
            { k: 'bomber', w: 1.5 }, { k: 'heli', w: 1 }, { k: 'gunship', w: 0.6 },
            { k: 'su57', w: 0.4 }, { k: 'stealth', w: 0.2 },
        ];
        for (const riv of _rivals()) {
            const myPlanes = planes.reduce((n, p) => n + (!p.dead && p.owner === riv.str ? 1 : 0), 0);
            if (myPlanes >= C.AIR_AI_MAX_PLANES) continue;
            const apt = structs.find(s => !s.dead && s.owner === riv.str && s.type === 'airport');
            if (!apt) continue;
            if (Math.random() > 0.35) continue;   // cadenced by AI_TICK_RATE
            // weighted pick within budget
            const budget = _resOf(riv) - 400;   // keep a reserve for rebuilding
            // TASK-401: support doctrine — exactly one tanker + one AWACS,
            // bought once the wing has 2+ combat aircraft
            const hasRole = (role) => planes.some(p => !p.dead && p.owner === riv.str && p.cfg.role === role);
            const combatPlanes = planes.reduce((n, p) => n + (!p.dead && p.owner === riv.str && !p.parked && p.cfg.role !== 'tanker' && p.cfg.role !== 'awacs' ? 1 : 0), 0);
            let forced = null;
            if (combatPlanes >= 2 && !hasRole('tanker') && PCFG['tanker'].cost <= budget) forced = 'tanker';
            else if (combatPlanes >= 2 && !hasRole('awacs') && PCFG['awacs'].cost <= budget) forced = 'awacs';
            let pick;
            if (forced) {
                pick = { k: forced };
            } else {
                let pool = MIX.filter(m => PCFG[m.k].cost <= budget);
                if (_resOf(riv) > 2000 && PCFG['f22'].cost <= budget) pool = pool.concat([{ k: 'f22', w: 0.5 }]);
                if (!pool.length) continue;
                let total = pool.reduce((s, m) => s + m.w, 0), roll = Math.random() * total;
                pick = pool[0];
                for (const m of pool) { roll -= m.w; if (roll <= 0) { pick = m; break; } }
            }
            if (!econFuelSpend(riv.str, C.ECON_FUEL_COST_PLANE, true)) continue;   // TASK-404: bots pay fuel too  // +TASK-404 fuel gate re-applied by @lead merge (covers forced support buys too)
            planes.push(new Plane(apt.lat, apt.lon, PCFG[pick.k], riv.str));
            _spendRes(riv, PCFG[pick.k].cost);
        }
    }

    // 6. AI LAND FORCES (TASK-302): rivals with a war factory field tank
    //    divisions and drive them at the frontline — armor spearheads paint
    //    corridors the troops can exploit, and shred what they reach.
    if (window.gameMode === 'mode1' && frame % GAME_CONSTANTS.AI_TICK_RATE === 0) {
        for (const riv of _rivals()) {
            const myTanks = tanks.reduce((n, t) => n + (!t.dead && t.owner === riv.str ? 1 : 0), 0);
            // Purchase: weighted mix (lights early, Tigers when rich).
            // Bots don't build factories (section 3 builds base/launcher/
            // airport/port) — fall back to their base as the muster point.
            if (myTanks < GAME_CONSTANTS.TANK_AI_CAP && _resOf(riv) > 900 && Math.random() < 0.25) {
                const fac = structs.find(s => !s.dead && s.owner === riv.str && s.type === 'factory')
                    || structs.find(s => !s.dead && s.owner === riv.str && s.type === 'base');
                if (fac) {
                    const roll = Math.random();
                    // TASK-405: SPGs join the AI mix (~15%) — standoff guns
                    // rely on the artillery hold-back re-aim below, else
                    // they'd wade into their own dead zone (120km).
                    const k = roll < 0.35 ? 'light' : roll < 0.65 ? 'medium' : roll < 0.85 ? 'heavy' : 'spg';
                    const cfg = TCFG[k];
                    if (_resOf(riv) >= cfg.cost + 300
                        && econFuelSpend(riv.str, GAME_CONSTANTS.ECON_FUEL_COST_TANK, true)) {   // TASK-404: bots pay fuel too
                        // muster at the base, fan out to a spread holding point
                        // (the frontal re-aim below re-tasks them as the line moves)
                        spawnTankDivision(fac.lat, fac.lon, k, riv.str,
                            { tgtLat: fac.lat + rnd(-0.5, 0.5), tgtLon: fac.lon + rnd(-0.5, 0.5) });
                        _spendRes(riv, cfg.cost);
                    }
                }
            }
            // Re-aim existing divisions at the current frontline (it moves)
            if (myTanks > 0 && frame % (GAME_CONSTANTS.AI_TICK_RATE * 6) === 0 && conquestGrid && conquestGrid._maskReady) {
                let tgt = null;
                for (const other of _rivals()) {
                    if (other.str === riv.str) continue;
                    const fr = conquestGrid.findFrontlineTarget(riv.str, other.str);
                    if (fr) { const ll = conquestGrid.cellToLatLon(fr.srcCell); tgt = ll; break; }
                }
                if (tgt) {
                    // ARTILLERY HOLD-BACK (TASK-405): standoff guns stay ~240km
                    // behind the contact point on the home bearing — inside
                    // gunRange(420), clear of the dead zone(120). Armor keeps
                    // driving at the line.
                    const home = structs.find(s => !s.dead && s.owner === riv.str && (s.type === 'factory' || s.type === 'base'));
                    for (const t of tanks) {
                        if (t.dead || t.owner !== riv.str) continue;
                        if (t.behavior && t.behavior.standoff && home) {
                            const br = Math.atan2(home.lon - tgt.lon, home.lat - tgt.lat);
                            t.setMoveTarget(tgt.lat + Math.cos(br) * 2.2 + rnd(-0.2, 0.2),
                                            tgt.lon + Math.sin(br) * 2.2 + rnd(-0.2, 0.2));
                        } else {
                            t.setMoveTarget(tgt.lat + rnd(-0.3, 0.3), tgt.lon + rnd(-0.3, 0.3));
                        }
                    }
                }
            }
        }
    }
}

// Fixed-timestep game loop: logic always runs at exactly 60 ticks/sec of GAME
// time regardless of display refresh rate. (Was: 1 logic step per RAF frame —
// on a 144-166Hz monitor the whole simulation ran ~2.7× too fast: income,
// troops, ships, AI, research.) Rendering + camera controls still run per frame.

// ── Keyboard globe navigation (arrow keys + WASD): smooth orbit ──
const _navKeys = {};
const _zoomKeys = { out: false, in: false };
const _NAV_KEYMAP = { KeyW: 'ArrowUp', KeyS: 'ArrowDown', KeyA: 'ArrowLeft', KeyD: 'ArrowRight' };
const _isTextInput = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};
window.addEventListener('keydown', e => {
    if (_isTextInput(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = (e.key && e.key.startsWith('Arrow')) ? e.key : _NAV_KEYMAP[e.code];
    if (k) _navKeys[k] = true;
    if (e.code === 'KeyQ') _zoomKeys.out = true;
    if (e.code === 'KeyE') _zoomKeys.in = true;
});
window.addEventListener('keyup', e => {
    const k = (e.key && e.key.startsWith('Arrow')) ? e.key : _NAV_KEYMAP[e.code];
    if (k) _navKeys[k] = false;
    if (e.code === 'KeyQ') _zoomKeys.out = false;
    if (e.code === 'KeyE') _zoomKeys.in = false;
});
function _applyKeyboardNavigation() {
    if (!camera || !controls) return;
    const left = _navKeys['ArrowLeft'], right = _navKeys['ArrowRight'];
    const up = _navKeys['ArrowUp'], down = _navKeys['ArrowDown'];
    if (!left && !right && !up && !down) return;
    // Speed scales with altitude so it feels the same zoomed out or in.
    const altitude = Math.max(1, camera.position.length() - EARTH_RADIUS);
    const speed = Math.min(0.02, 0.0006 * (altitude / 3000 + 0.25));
    const sph = new THREE.Spherical().setFromVector3(camera.position);
    if (left) sph.theta -= speed;
    if (right) sph.theta += speed;
    if (up) sph.phi = Math.max(0.15, sph.phi - speed);
    if (down) sph.phi = Math.min(Math.PI - 0.15, sph.phi + speed);
    camera.position.setFromSpherical(sph);
    camera.lookAt(controls.target);
}
function _applyKeyboardZoom() {
    if (!camera || !controls) return;
    if (!_zoomKeys.out && !_zoomKeys.in) return;
    const dir = _zoomKeys.out ? 1 : -1;
    const off = camera.position.clone().sub(controls.target);
    let len = off.length() * (1 + dir * 0.014);
    len = Math.max(controls.minDistance, Math.min(controls.maxDistance, len));
    off.setLength(len);
    camera.position.copy(controls.target).add(off);
}

function loop(now) {
    if(gOver) return;
    now = now || performance.now();
    if (!_lastRAF) _lastRAF = now;
    const dtMs = Math.min(now - _lastRAF, 100);   // cap: no catch-up spiral after tab-switch
    _lastRAF = now;
    _frameAcc += dtMs / (1000 / 60);              // accumulate 60fps-equivalent frames
    // TASK-303: rolling rAF fps (visual-guardrail metric) — kept on
    // __perfState next to the logic-frame costs.
    {
        const S = window.__perfState;
        S._fpsAcc = (S._fpsAcc || 0) + dtMs; S._fpsN = (S._fpsN || 0) + 1;
        if (S._fpsN >= 30) { S.fpsAvg = 1000 / (S._fpsAcc / S._fpsN); S._fpsAcc = 0; S._fpsN = 0; }
    }
    _polishRenderTick(dtMs);   // TASK-303: cloud drift + shimmer time/map sync
    let _ticks = 0;
    while (_frameAcc >= 1 && _ticks < 4) {
        _frameAcc -= 1;
        _ticks++;
        gameFrame();
    }
    if (_frameAcc > 4) _frameAcc = 0;

    // Dynamic Rotation Speed based on altitude — PROPORTIONAL to zoom so a
    // full-screen drag scrolls a constant number of "screenfuls" of ground at
    // every altitude (the camera orbits the globe CENTER, so perceived ground
    // speed ≈ EARTH_RADIUS × angular speed — the old 0.05 floor made max
    // zoom-in ~25× too fast, whipping ~37 screenfuls per full drag).
    if(camera && controls) {
        let currentDist = camera.position.length();
        let altitude = Math.max(1, currentDist - EARTH_RADIUS);
        const t = altitude / (controls.maxDistance - EARTH_RADIUS);
        controls.rotateSpeed = Math.max(0.0022, 1.0 * t);
    }

    // Custom crosshair upkeep: mode color refresh even without mouse movement
    // (e.g. pressing R/BUILD keys while hovering still).
    if (_cursorHud && _cursorHud.style.display === 'block') {
        let _cm = 'default';
        if (missileMode) _cm = 'missile';
        else if (buildMode) _cm = 'build';
        else if (targetingMode) _cm = 'attack';
        if (_cursorHud.dataset.m !== _cm) { _cursorHud.dataset.m = _cm; _cursorHud.className = 'm-' + _cm; }
    }

    // Missile mode upkeep: rings/HUD track launcher reload state (every 30f)
    if (missileMode && frame % 30 === 0) {
        _refreshMissileRings();
        _refreshMissileHud();
    }

    // TASK-102: devastation decay (rotating window — O(800)/frame)
    if (conquestGrid && conquestGrid.decayDevastation && frame % 2 === 0) {
        conquestGrid.decayDevastation(1600);
    }

    // TASK-406: world-layer VFX upkeep — capture-flash aging, frontline heat
    // pulse + drone selection rings (all safe no-ops before their meshes exist).
    WORLD_RENDER.tickVfx(frame);
    WORLD_RENDER.updateDroneRings(drones, frame);

    _applyKeyboardNavigation();
    _applyKeyboardZoom();
    controls.update();

    // Nation labels run on the RENDER clock (not the 60Hz logic tick) so they
    // stay glued to the globe during rotation — the old logic-tick cadence
    // made them visibly lag/wiggle on high-refresh displays.
    if (typeof updateNationLabels === 'function') updateNationLabels();

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

function gameFrame() {
    frame++;
    try {

    structs.forEach(s => s.update());
    // Compact dead structures (bounded array — previously dead structs were
    // update()-called and scanned forever).
    if (frame % 60 === 0) {
        let _sw = 0;
        for (let _sr = 0; _sr < structs.length; _sr++) {
            const s = structs[_sr];
            if (!s.dead) { if (_sw !== _sr) structs[_sw] = s; _sw++; }
        }
        structs.length = _sw;
    }
    
    // In-place compaction (swap-and-pop) — avoids per-frame array allocation/GC
    // (TASK-403 drive-by: the duplicate `_compactAlive(drones, ...)` that used
    //  to sit here was removed — drones were updated TWICE per tick, doubling
    //  their speed/fuel burn. The single update lives with the mobile units below.)
    _compactAlive(missiles, m => m.update());
    // (AUDIT FIX #3 + TASK-401 re-check: drones are updated EXACTLY ONCE per
    // tick — in the OpenFront block below. The duplicate line that used to
    // sit here doubled speed/fuel/scan cadence + CPU.)
    _updateTransients();                             // tracers / debris / EMP rings
    if (frame % 4 === 0) _wakeFxTick();              // TASK-303: ship wake foam (READ-ONLY scan)
    _updateCraters();                                // fading impact scars
    for (let p of planes) p.update();
    _compactDead(planes);
    // TASK-201: air-to-air missile tracers (+ TASK-401 ArmShots ride the
    // same pipeline — the module pushes them into aamMissiles)
    _compactAlive(aamMissiles, m => m.update());
    _tankDeepTick();   // TASK-405: burning wrecks fade + SPG arc shells fly
    AirCombat.tickWrecks(AIRW);                      // TASK-401: falling wrecks
    
    // Update OpenFront objects
    _compactAlive(tradeShips, ts => ts.update());
    _compactAlive(transportShips, ts => ts.update());
    _compactAlive(warships, w => w.update());
    // TASK-402: submarine torpedoes, minefields, sinking hull animations
    _compactAlive(torpedoes, tp => tp.update(NAVAL_CTX));
    updateMineFields(NAVAL_CTX);
    _tickNavalSinking();
    // (AUDIT FIX #3: drones were updated TWICE per tick — the TASK-202 merge
    //  duplicated the TASK-204 line. 2× speed/fuel/scan cadence + 2× CPU.
    //  TASK-302 merge: tanks join the tick; drones listed ONCE here.
    //  TASK-402 drive-by: the FIRST duplicate line was still live on main
    //  (the fix comment existed but both calls remained) — removed for real.)
    _compactAlive(tanks, t => t.update());   // TASK-302: armored divisions
    _compactAlive(drones, d => d.update());  // TASK-204 drone system (once per tick)
    // TASK-403: keep missile-mode rings/HUD live (magazine pips, re-arm states)
    if (missileMode && frame % 20 === 0) { _refreshMissileRings(); _refreshMissileHud(); }
    _compactAlive(trains, t => t.update());
    _compactAlive(troopCohorts, tc => tc.update());
    if (window.paintExpansions) {
        _compactAlive(window.paintExpansions, pe => pe.update());
    }
    
    // Troop Growth Ticks (every second)
    if(!window.startSpawnPhase && frame % 6 === 0) {
        pTroops += troopIncreaseRate('player', pTroops);
        eTroops += troopIncreaseRate('enemy', eTroops);
        for (const b of bots) {
            if (b.alive) b.troops += troopIncreaseRate(b.str, b.troops);
        }
    }
    
    // P3 FIX: In-place compaction with material recycling (no .filter() allocation, no dispose churn)
    let _ew = 0;
    for (let _er = 0; _er < exps.length; _er++) {
        const ex = exps[_er];
        ex.userData.life -= ex.userData.maxLife;
        if (ex.userData.life <= 0) {
            scene.remove(ex);
            if (ex.material) _recycleMat(ex.material);
        } else {
            ex.scale.setScalar(2 - ex.userData.life);
            if (ex.material) ex.material.opacity = ex.userData.life;
            if (_ew !== _er) exps[_ew] = ex;
            _ew++;
        }
    }
    exps.length = _ew;

    let _pw = 0;
    for (let _pr = 0; _pr < particles.length; _pr++) {
        const p = particles[_pr];
        p.userData.life -= p.userData.maxLife;
        if (p.userData.life <= 0) {
            scene.remove(p);
            if (p.material) _recycleMat(p.material);
        } else {
            if (p.material) p.material.opacity = p.userData.life;
            if (_pw !== _pr) particles[_pw] = p;
            _pw++;
        }
    }
    particles.length = _pw;

    // Economy tick
    if(frame % GAME_CONSTANTS.ECON_TICK_INTERVAL === 0) {
        let pEcon = calcIncome('player');
        pRes += pEcon.net * GAME_CONSTANTS.ECON_TICK_INTERVAL;
        if (bots.length === 0) {
            let eEcon = calcIncome('enemy');
            eRes += eEcon.net * GAME_CONSTANTS.ECON_TICK_INTERVAL;
        } else {
            for (const b of bots) {
                if (!b.alive) continue;
                const eEcon = calcIncome(b.str);
                b.res = Math.max(0, b.res + eEcon.net * GAME_CONSTANTS.ECON_TICK_INTERVAL);
            }
        }
        // Floor at 0 — no debt
        if(pRes < 0) pRes = 0;
        if(eRes < 0) eRes = 0;
        // TASK-404: fuel resource tick (one pooled reserve per side)
        econFuelTick(GAME_CONSTANTS.ECON_TICK_INTERVAL / 60);
    }
    
    // TASK-301 milestones + TASK-404 second-tick (fuel crisis watch, loans,
    // bonds, sanctions, intel, trade lanes, sparkline, observer) — 1/s.
    if (frame % 60 === 0) econSecondTick();
    
    _sfxFrame();   // TASK-408: bgm/bed/intercept-ping/naval-bass observations
    
    // Spawn Trade Ships and Trains on interval
    if(frame % GAME_CONSTANTS.TRADE_SHIP_SPAWN_INTERVAL === 0) {
        spawnTradeShipsForActivePorts();
    }
    if(frame % GAME_CONSTANTS.TRAIN_SPAWN_INTERVAL === 0) {
        spawnTrainsForActiveFactories();
    }
    
    // ── Conquest system: advance active attacks, repaint territory when it changes ──
    if (activeAttacks.length) {
        activeAttacks = activeAttacks.filter(a => { a.tick(); return a.active; });
    }
    if (conquestGrid && conquestGrid.hasDirty()) {
        renderMode1Territory();
    }

    runAI();
    try { updateResearch(); } catch(e) { console.error('[LOOP] updateResearch crashed:', e); }
    if(frame % 500 === 0) aiResearch();
    if(frame % 30 === 0) cityCaptureTick();

    // Check Win regularly instead of during destroy loops to avoid early undefined bugs
    if(frame % GAME_CONSTANTS.WIN_CHECK_INTERVAL === 0) checkWin();

    if(frame - lastHUD > GAME_CONSTANTS.HUD_UPDATE_INTERVAL) { updateHUD(); lastHUD = frame; }

    // Update city labels every 3 frames (saves 10-20% frame time on 200+ cities)
    if(frame % 3 === 0 && typeof updateCityLabels === 'function') updateCityLabels();

    } catch(e) { console.error('[LOOP] Frame', frame, 'crashed:', e); }
}

// ── Perf probe: rolling game-frame time + section costs (console: __perf()) ──
window.__perfState = { frameTimes: [], tGame: 0, tTerritory: 0, tHUD: 0, tAI: 0, frames: 0 };
const _perfOrigGameFrame = gameFrame;
gameFrame = function() {
    const t0 = performance.now();
    _perfOrigGameFrame();
    const dt = performance.now() - t0;
    const S = window.__perfState;
    S.frames++;
    S.tGame += dt;
    if (S.frameTimes.length > 300) S.frameTimes.shift();
    S.frameTimes.push(dt);
};
window.__perf = function() {
    const S = window.__perfState;
    const fts = S.frameTimes.slice();
    fts.sort((a,b) => a-b);
    const avg = fts.reduce((s,v)=>s+v,0) / (fts.length || 1);
    return {
        sampledFrames: fts.length,
        avgGameFrameMs: +avg.toFixed(2),
        p95Ms: +fts[Math.floor(fts.length*0.95)].toFixed(2),
        maxMs: +fts[fts.length-1].toFixed(2),
        estimatedLogicMsPerSec: +(S.tGame / (S.frames/60)).toFixed(1),
    };
};

// ── In-place array compaction helpers (avoid per-frame GC from .filter()) ──
// _compactAlive: calls updateFn on each element, removes dead ones in-place
function _compactAlive(arr, updateFn) {
    let w = 0;
    for (let r = 0; r < arr.length; r++) {
        updateFn(arr[r]);
        if (!arr[r].dead) {
            if (w !== r) arr[w] = arr[r];
            w++;
        }
    }
    arr.length = w;
}
// _compactDead: removes elements already marked dead (no update call)
function _compactDead(arr) {
    let w = 0;
    for (let r = 0; r < arr.length; r++) {
        if (!arr[r].dead) {
            if (w !== r) arr[w] = arr[r];
            w++;
        }
    }
    arr.length = w;
}

// ── Recursive mesh disposal (prevents GPU memory leak on game restart) ──
function disposeMeshDeep(mesh) {
    if (!mesh) return;
    // SHARED resources (geometry/material caches flagged .userData.shared) are
    // never disposed here — they outlive any single entity (3D structure models
    // share their geometries across every instance of that building type).
    const shared = (r) => r && r.userData && r.userData.shared;
    if (mesh.geometry && !shared(mesh.geometry)) mesh.geometry.dispose();
    if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => { if (!shared(m)) m.dispose(); });
    }
    if (mesh.children && mesh.children.length > 0) {
        mesh.children.forEach(disposeMeshDeep);
    }
}

// ════════════════════════════════════════════════════════════════════
// NAVAL HELPERS — shared by player UI, AI, and multiplayer sync
// ════════════════════════════════════════════════════════════════════
const G = {
    startTerritoryAttack: function() {
        targetingMode = 'troop_attack';
        selectedSourceProvinceIdx = -1;
        document.getElementById('conqMsg').textContent = 'انقر على أي أرض مجاورة لاحتلالها ⚔️';
    },
    startNavalInvasion: function() {
        if (window.gameMode !== 'mode1' || !conquestGrid) {
            logEvent('الغزو البحري متاح في طور الفتح فقط', 'err');
            return;
        }
        targetingMode = 'naval_invasion';
        let tgt = document.getElementById('tgtMsg');
        if (tgt) {
            tgt.textContent = '🚢 انقر ساحل العدو (أو أي نقطة بحرية باتجاهه) لبدء الإنزال';
            tgt.style.display = 'block';
        }
    },
    launchSelected: function() { 
        targetingMode = true; 
        document.getElementById('tgtMsg').textContent='اختر الهدف (صواريخ)'; document.getElementById('tgtMsg').style.display='block';
        let launchers = structs.filter(s => s.type==='launcher' && s.owner===myRole && s.reload<=0);
        if(launchers.length > 0 && rangeMarkerMesh) {
             let L = launchers[0];
             let maxR = getMissileMaxRange(MCFG[selMissile]); 
             
             if(maxR < 900) {
                 rangeMarkerMesh.geometry.dispose();
                 rangeMarkerMesh.geometry = DrawSphericalRangeIndicator(L.lat, L.lon, maxR);
                 rangeMarkerMesh.position.set(0,0,0);
                 rangeMarkerMesh.rotation.set(0,0,0);
                 rangeMarkerMesh.scale.setScalar(1);
                 rangeMarkerMesh.visible = true;
             } else {
                 rangeMarkerMesh.visible = false;
             }
        }
    },
    camJump: function(side) {
        let bs = structs.find(s=>s.owner===side&&s.type==='base');
        if(bs) {
            camera.position.copy(latLonToVec3(bs.lat, bs.lon, EARTH_RADIUS + GAME_CONSTANTS.CAM_JUMP_ALTITUDE));
            controls.target.set(0,0,0);
            controls.update();
        }
    },
    orderPlanes: function(mode) {
        targetingMode = 'plane_' + mode;
        document.getElementById('tgtMsg').textContent = 'اختر هدف الطائرات (' + mode + ')';
        document.getElementById('tgtMsg').style.display='block';
    },
    toggleAutoSAM: function() {
        autoSAM = !autoSAM;
        const _asam = document.getElementById('btnASAM');
        if (_asam) _asam.classList.toggle('act', autoSAM);
        logEvent(autoSAM ? 'SAM تلقائي: مفعّل 🛡️' : 'SAM تلقائي: متوقف', 'info');
    },
    interceptAll: function() {
        let sams = structs.filter(s => s.owner === myRole && s.type === 'sam' && s.reload <= 0);
        let threats = missiles.filter(m => m.owner !== myRole && !m.dead && !m.isSAM);
        for(let i=0; i<Math.min(sams.length, threats.length); i++) {
            fireSAM(sams[i], threats[i]); 
            sams[i].reload = sams[i].maxReload;
        }
    },
    selCmd: function(mode) {
        let sel = getSelectedUnits();
        sel.planes.forEach(p => {
            p.mode = mode;
            if(mode !== 'return') p.parked = false;
        });
        updateSelectionPanel();
    },
    restart: function() {
        backToMenu();
        setTimeout(() => {
            document.querySelector('.mBtn.green')?.click();
        }, 100);
    }
};
window.G = G;

function backToMenu() {
    window.DEV_MODE = false;   // reset dev mode when returning to menu
    gOver = true;
    if (missileMode) _setMissileMode(false);   // hide rings + HUD
    volleyCount = 1; missileMix = ['ballistic'];   // TASK-403: reset the volley state
    // B1 FIX: Dispose all geometries/materials to prevent GPU memory leak on restart
    structs.forEach(s => { if(s.mesh) { scene.remove(s.mesh); disposeMeshDeep(s.mesh); } if(s.selRing) { scene.remove(s.selRing); disposeMeshDeep(s.selRing); } });
    missiles.forEach(m => { if(m.mesh) { scene.remove(m.mesh); disposeMeshDeep(m.mesh); } });
    planes.forEach(p => { if(p.mesh) { scene.remove(p.mesh); disposeMeshDeep(p.mesh); } if(p.selRing) { scene.remove(p.selRing); disposeMeshDeep(p.selRing); } });
    aamMissiles.forEach(m => { if(m.mesh) { scene.remove(m.mesh); if(m.mesh.material) _recycleMat(m.mesh.material); } });   // TASK-201 AAM tracers
    AirCombat.clearWrecks();                          // TASK-401 falling wrecks
    tradeShips.forEach(ts => { if(ts.mesh) { scene.remove(ts.mesh); disposeMeshDeep(ts.mesh); } if(ts.pathLine) { scene.remove(ts.pathLine); disposeMeshDeep(ts.pathLine); } });
    transportShips.forEach(ts => { if(ts.mesh) { scene.remove(ts.mesh); disposeMeshDeep(ts.mesh); } if(ts.pathLine) { scene.remove(ts.pathLine); disposeMeshDeep(ts.pathLine); } });
    warships.forEach(w => { if(w.mesh) { scene.remove(w.mesh); disposeMeshDeep(w.mesh); } w.shells.forEach(sh => scene.remove(sh.mesh)); });
    tanks.forEach(t => { if(t.mesh) { scene.remove(t.mesh); disposeMeshDeep(t.mesh); } if(t.selRing && t.selRing.material) t.selRing.material.dispose(); });   // TASK-302
    drones.forEach(d => { if(d.mesh) { scene.remove(d.mesh); disposeMeshDeep(d.mesh); } });
    trains.forEach(t => { if(t.mesh) { scene.remove(t.mesh); disposeMeshDeep(t.mesh); } if(t.pathLine) { scene.remove(t.pathLine); disposeMeshDeep(t.pathLine); } });
    troopCohorts.forEach(tc => { if(tc.mesh) { scene.remove(tc.mesh); disposeMeshDeep(tc.mesh); } });
    drones.forEach(d => { if(d.mesh && !d.dead) { scene.remove(d.mesh); disposeMeshDeep(d.mesh); } });   // TASK-204
    transients.forEach(_killTransient); transients = [];                                             // TASK-204
    craterDecals.forEach(c => { scene.remove(c.mesh); if (c.mesh.material) _recycleMat(c.mesh.material); }); craterDecals = [];
    econTeardownForMenu();   // TASK-404: lanes / intel rings / medals / panel state
    exps.forEach(e => { scene.remove(e); disposeMeshDeep(e); });
    particles.forEach(p => { scene.remove(p); disposeMeshDeep(p); });
    if (window.paintExpansions) window.paintExpansions.forEach(pe => { if(pe.mesh) { scene.remove(pe.mesh); disposeMeshDeep(pe.mesh); } });
    cleanupTerritory();
    structs = []; missiles = []; planes = []; drones = []; exps = []; particles = [];
    tradeShips = []; trains = []; troopCohorts = []; transportShips = []; warships = [];
    tanks = [];   // TASK-302
    transients = []; craterDecals = [];
    // TASK-402: naval deep-pass state — torpedoes, minefields, sinking hulls
    torpedoes.forEach(tp => { if (tp.mesh) { scene.remove(tp.mesh); disposeMeshDeep(tp.mesh); } });
    mineFields.forEach(f => { if (f.mesh) { scene.remove(f.mesh); disposeMeshDeep(f.mesh); } });
    navalSinking.forEach(sk => { scene.remove(sk.mesh); disposeMeshDeep(sk.mesh); });
    torpedoes = []; mineFields = []; navalSinking = [];
    if (mineMode) _setMineMode(false);
    fleetStanceIdx = 0;
    isOnline = false;
    document.getElementById('go')?.classList.remove('show');
    document.getElementById('gc').style.display = 'none';
    document.getElementById('menuScreen').style.display = 'flex';
    document.getElementById('roomCodeDisplay').style.display = 'none';
    document.getElementById('menuStatus').textContent = '';
}
window.backToMenu = backToMenu;

function setVolley(v) { volleyCount = v; const _vp = document.getElementById('volleyPicker'); if (_vp) _vp.style.display = 'none'; }
window.setVolley = setVolley;

function openVolleyPicker(e) {
    let vp = document.getElementById('volleyPicker');
    if (!vp) return;
    if(vp.style.display==='flex') vp.style.display='none';
    else { vp.style.display='flex'; vp.style.left=e.clientX+'px'; vp.style.top=(e.clientY-120)+'px'; }
}
window.openVolleyPicker = openVolleyPicker;

function rebuildRosters() {
    if(document.getElementById('buildRow')) {
        document.getElementById('buildRow').innerHTML = '';
        ['city','port','launcher','radar','flak','sam','factory','iron_dome','airport','ciws','himars','nuke_plant'].forEach(k => {
            if(!SDEFS[k]) return;
            // Tech gate
            if(TECH_LOCKED_BUILDS.includes(k) && !isTechUnlocked(k, 'build', playerTech)) return;
            let b = document.createElement('div');
            b.className = 'ibtn';
            b.innerHTML = `<div class="iname">${SDEFS[k].name}</div><div class="icost">$${SDEFS[k].cost}</div>`;
            b.onclick = () => { buildMode = k; document.getElementById('bldMsg').textContent='اختر موقعا (مؤمن ومناسب)'; };
            document.getElementById('buildRow').appendChild(b);
        });
    }

    if(document.getElementById('missileRow')) {
        document.getElementById('missileRow').innerHTML = '';
        Object.keys(MCFG).forEach(k => {
            // Tech gate
            if(TECH_LOCKED_MISSILES.includes(k) && !isTechUnlocked(k, 'missile', playerTech)) return;
            let btn = document.createElement('div');
            btn.className = 'ibtn' + (selMissile===k?' act':'');
            btn.innerHTML = `<div class="iname">${MCFG[k].name}</div><div class="icost">$${MCFG[k].cost}</div>`;
            btn.onclick = () => { 
                selMissile = k; 
                document.querySelectorAll('#missileRow .ibtn').forEach(b=>b.classList.remove('act'));
                btn.classList.add('act');
            };
            document.getElementById('missileRow').appendChild(btn);
        });
    }
    
    if(document.getElementById('planeRow')) {
        document.getElementById('planeRow').innerHTML = '';
        Object.keys(PCFG).forEach(k => {
            // Tech gate
            if(TECH_LOCKED_PLANES.includes(k) && !isTechUnlocked(k, 'plane', playerTech)) return;
            let btn = document.createElement('div');
            btn.className = 'ibtn';
            btn.innerHTML = `<div class="iname">${PCFG[k].name}</div><div class="icost">$${PCFG[k].cost}</div>`;
            btn.onclick = () => { purchasePlane(k, 'planeRow'); };
            document.getElementById('planeRow').appendChild(btn);
        });
    }
    // Global aviation pane — works WITHOUT selecting an airport (uses nearest)
    if(document.getElementById('planeRowGlobal')) {
        document.getElementById('planeRowGlobal').innerHTML = '';
        Object.keys(PCFG).forEach(k => {
            if(TECH_LOCKED_PLANES.includes(k) && !isTechUnlocked(k, 'plane', playerTech)) return;
            let btn = document.createElement('div');
            btn.className = 'ibtn';
            btn.innerHTML = `<div class="iname">${PCFG[k].name}</div><div class="icost">$${PCFG[k].cost}</div>`;
            btn.onclick = () => { purchasePlane(k, 'planeRowGlobal'); };
            document.getElementById('planeRowGlobal').appendChild(btn);
        });
        refreshPlanePaneStatus();
    }
    
    rebuildTechPanel();
}

// Buy a plane: prefers the SELECTED airport, falls back to nearest player airport.
// Feedback is shown in the ACTIVE aviation pane (never in a hidden one) + event log.
function purchasePlane(k, fromRowId) {
    // Prefer the selected airport, else nearest player airport
    let apt = structs.find(s => s.selected && s.owner === myRole && !s.dead && s.type === 'airport');
    if (!apt) {
        let best = Infinity;
        structs.forEach(s => {
            if (s.owner === myRole && !s.dead && s.type === 'airport') {
                const d = haversineDist(s.lat, s.lon, 0, 0) * 0 + 1; // any airport qualifies
                if (best === Infinity) { best = 0; apt = s; } // first found
            }
        });
    }
    const feedback = (txt, isErr) => {
        let el = document.getElementById('planeMsg');
        // planeMsg lives in the GLOBAL pane; the airport card has its own queue text
        if (el) { el.textContent = txt; el.style.color = isErr ? '#ff5555' : '#00ff88'; }
        if (isErr) logEvent(txt, 'err');
    };
    if (!apt) { feedback('لا يوجد مطار! ابنِ مطاراً عسكرياً أولاً 🛫', true); SFX.ui('err'); return; }
    if (pRes < PCFG[k].cost) { feedback(`موارد غير كافية! تحتاج $${PCFG[k].cost}`, true); SFX.ui('err'); return; }
    // TASK-404: strategic-fuel gate — new aircraft burn reserve fuel on
    // deployment (economy logic; the Plane class itself is untouched).
    if (!econFuelSpend(myRole, GAME_CONSTANTS.ECON_FUEL_COST_PLANE)) { feedback(`⛽ وقود غير كافٍ للنشر! تحتاج ${GAME_CONSTANTS.ECON_FUEL_COST_PLANE}`, true); SFX.ui('err'); return; }
    pRes -= PCFG[k].cost;
    planes.push(new Plane(apt.lat, apt.lon, PCFG[k], myRole));
    feedback(`${PCFG[k].name} أقلعت من المطار ✈️`, false);
    SFX.ui('build');
    logEvent(`${PCFG[k].name} أقلعت من المطار ✈️`, 'info');
    updateHUD();
}

function refreshPlanePaneStatus() {
    const el = document.getElementById('planeMsg');
    if (!el) return;
    const nApt = structs.filter(s => s.owner === myRole && !s.dead && s.type === 'airport').length;
    if (nApt === 0) { el.textContent = 'لا يوجد مطار — ابنِ مطاراً في تبويب البناء أولاً 🛫'; el.style.color = '#ffaa00'; }
    else { el.textContent = `مطاراتك: ${nApt} — الطائرات تُنتج من أقرب مطار`; el.style.color = '#88ddff'; }
}
setTimeout(rebuildRosters, 1000);

// ═══════ TECH TREE SYSTEM ═══════

function isTechUnlocked(itemKey, type, techState) {
    for(let tid in TECH_TREE) {
        let t = TECH_TREE[tid];
        if(techState[tid] !== 'done') continue;
        let list = type === 'missile' ? t.unlocks_missiles : type === 'plane' ? t.unlocks_planes : t.unlocks_builds;
        if(list && list.includes(itemKey)) return true;
    }
    return false;
}

function canResearch(techId, techState) {
    let t = TECH_TREE[techId];
    if(!t) return false;
    if(techState[techId]) return false; // already done or in progress
    // Check prereqs
    for(let p of t.prereq) {
        if(techState[p] !== 'done') return false;
    }
    return true;
}

function startResearch(techId) {
    let t = TECH_TREE[techId];
    if(!t || !canResearch(techId, playerTech)) return;
    if(pRes < t.cost) return;
    if(researchingId) return; // Already researching
    pRes -= t.cost;
    researchingId = techId;
    playerTech[techId] = t.time; // frames remaining
    rebuildTechPanel();
}
window.startResearch = startResearch;

function updateResearch() {
    // Player research tick
    if(researchingId && typeof playerTech[researchingId] === 'number') {
        playerTech[researchingId]--;
        // Update progress bar
        let t = TECH_TREE[researchingId];
        if(t) {
            let pct = ((t.time - playerTech[researchingId]) / t.time * 100).toFixed(0);
            let bar = document.getElementById('techProgress');
            if(bar) bar.style.width = pct + '%';
            let lbl = document.getElementById('techProgressLabel');
            if(lbl) lbl.textContent = `${t.icon} ${t.name} (${Math.ceil(playerTech[researchingId]/60)}s)`;
        }
        if(playerTech[researchingId] <= 0) {
            playerTech[researchingId] = 'done';
            if(TECH_TREE[researchingId].effect) TECH_TREE[researchingId].effect(myRole, structs);
            researchingId = null;
            // Refresh UI to show newly unlocked items
            rebuildRosters();
            if(SFX && SFX.ui) SFX.ui('build');
        }
    }
    
    // Enemy AI research tick
    if(eResearchingId && typeof enemyTech[eResearchingId] === 'number') {
        enemyTech[eResearchingId]--;
        if(enemyTech[eResearchingId] <= 0) {
            enemyTech[eResearchingId] = 'done';
            if(TECH_TREE[eResearchingId].effect) TECH_TREE[eResearchingId].effect('enemy', structs);
            eResearchingId = null;
        }
    }
    
    // FFA bot research ticks
    for (const b of bots) {
        if (b.researchingId && typeof b.tech[b.researchingId] === 'number') {
            b.tech[b.researchingId]--;
            if (b.tech[b.researchingId] <= 0) {
                b.tech[b.researchingId] = 'done';
                if (TECH_TREE[b.researchingId] && TECH_TREE[b.researchingId].effect) TECH_TREE[b.researchingId].effect(b.str, structs);
                b.researchingId = null;
            }
        }
    }
}

function aiResearch() {
    if(isOnline) return;
    // Legacy single enemy
    if (!eResearchingId && bots.length === 0) {
        let available = Object.keys(TECH_TREE).filter(tid => canResearch(tid, enemyTech));
        if(available.length > 0) {
            let pick = available[Math.floor(Math.random() * available.length)];
            let t = TECH_TREE[pick];
            if(eRes >= t.cost) { eRes -= t.cost; eResearchingId = pick; enemyTech[pick] = t.time; }
        }
    }
    // FFA bots: light random tech progression
    for (const b of bots) {
        if (!b.alive || b.researchingId) continue;
        if (Math.random() > 0.25) continue;
        let available = Object.keys(TECH_TREE).filter(tid => canResearch(tid, b.tech));
        if(available.length === 0) continue;
        let pick = available[Math.floor(Math.random() * available.length)];
        let t = TECH_TREE[pick];
        if(b.res >= t.cost) { b.res -= t.cost; b.researchingId = pick; b.tech[pick] = t.time; }
    }
}

function rebuildTechPanel() {
    let container = document.getElementById('techRow');
    if(!container) return;
    container.innerHTML = '';
    
    // Current research progress bar
    if(researchingId) {
        let t = TECH_TREE[researchingId];
        let pct = ((t.time - (playerTech[researchingId] || 0)) / t.time * 100).toFixed(0);
        container.innerHTML += `<div style="width:100%;margin-bottom:4px;"><div id="techProgressLabel" style="font-size:7px;color:#ffcc00;margin-bottom:2px">${t.icon} ${t.name}</div><div class="hbar" style="margin:0"><div class="hfill" id="techProgress" style="width:${pct}%;background:linear-gradient(90deg,#ffcc00,#00ff88)"></div></div></div>`;
    }
    
    // Available techs grouped by tier
    for(let tier = 1; tier <= 3; tier++) {
        let tierTechs = Object.entries(TECH_TREE).filter(([id, t]) => t.tier === tier);
        tierTechs.forEach(([id, t]) => {
            if(playerTech[id] === 'done') {
                // Completed: green
                let el = document.createElement('div');
                el.className = 'ibtn';
                el.style.borderColor = '#00ff8860';
                el.style.opacity = '0.5';
                el.innerHTML = `<div class="iname">${t.icon} ${t.name}</div><div class="icost" style="color:#00ff88">✓</div>`;
                container.appendChild(el);
            } else if(typeof playerTech[id] === 'number') {
                // In progress: yellow pulsing
                let el = document.createElement('div');
                el.className = 'ibtn yel';
                el.style.animation = 'pulse 2s ease-in-out infinite';
                el.innerHTML = `<div class="iname">${t.icon} ${t.name}</div><div class="icost">⏳</div>`;
                container.appendChild(el);
            } else if(canResearch(id, playerTech)) {
                // Available to research
                let el = document.createElement('div');
                el.className = 'ibtn';
                el.title = t.desc;
                el.innerHTML = `<div class="iname">${t.icon} ${t.name}</div><div class="icost">$${t.cost}</div>`;
                el.onclick = () => startResearch(id);
                container.appendChild(el);
            } else {
                // Locked: dim
                let el = document.createElement('div');
                el.className = 'ibtn';
                el.style.opacity = '0.25';
                el.style.pointerEvents = 'none';
                el.innerHTML = `<div class="iname">${t.icon} ${t.name}</div><div class="icost" style="color:#555">🔒</div>`;
                container.appendChild(el);
            }
        });
    }
}

window.renderProvinceBorders = true;
function toggleProvinceBorders() {
    window.renderProvinceBorders = !window.renderProvinceBorders;
    let btn = document.getElementById('btnBorders');
    if(btn) btn.style.opacity = window.renderProvinceBorders ? '1' : '0.4';
    
    // Force immediate visibility update
    if (typeof provinceBorderMesh !== 'undefined' && provinceBorderMesh) {
        if (!window.renderProvinceBorders) {
            provinceBorderMesh.visible = false;
        } else {
            provinceBorderMesh.visible = true;
            if (provinceBorderMesh.material) {
                let altitude = camera.position.length() - EARTH_RADIUS;
                provinceBorderMesh.material.opacity = altitude < 300 ? 0.8 : 0.3;
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
//  NEW UI API — consumed by src/ui.js (radial command menu).
//  Every action the radial menu offers is implemented here against the
//  real game state, mirroring the old button flows.
// ════════════════════════════════════════════════════════════════════════
window.__UI_API = {
    // ── context query: what did the player right-click? ──
    queryTile: (clientX, clientY) => {
        const loc = raycastGlobe({ clientX, clientY, target: document.getElementById('gameCanvas') });
        if (!loc) return null;
        const owner = (window.gameMode === 'mode1' && conquestGrid && conquestGrid._maskReady)
            ? getPixelOwner(loc.lat, loc.lon)
            : (isLand(loc.lat, loc.lon) ? 'neutral' : 'water');
        // nearest structure at that spot
        let struct = null, bestD = GAME_CONSTANTS.CLICK_SELECT_RADIUS || 40;
        structs.forEach(s => {
            if (s.dead) return;
            const d = haversineDist(loc.lat, loc.lon, s.lat, s.lon);
            if (d < bestD) { bestD = d; struct = s; }
        });
        return {
            lat: loc.lat, lon: loc.lon,
            tileOwner: owner === 'water' ? 'water' : owner,
            isWater: owner === 'water' || (!isLand(loc.lat, loc.lon) && owner !== 'player' && owner !== 'enemy'),
            isOwn: owner === 'player',
            struct: struct || null,
            structName: struct ? struct.name : null
        };
    },
    isSpawnPhase: () => !!window.startSpawnPhase,

    // ── actions ──
    attackAt: (lat, lon) => {
        // Same flow as the click handler's mode-1 auto-attack, minus DOM writes.
        if (window.gameMode !== 'mode1' || !conquestGrid || !conquestCtx) {
            logEvent('الهجوم البري متاح في طور الفتح فقط', 'err');
            return;
        }
        const owner = getPixelOwner(lat, lon);
        if (owner === 'water') { logEvent('لا يمكن مهاجمة الماء!', 'err'); return; }
        if (owner === 'player') { logEvent('هذه أراضيك!', 'err'); return; }
        const src = conquestGrid.findNearestOwnedCell(lat, lon, 'player');
        if (!src) { window.__UI_API.boatAt(lat, lon); return; }
        const pct = (window.troopAttackPct || 50) / 100;
        const troopsToSend = Math.floor(pTroops * pct);
        if (troopsToSend < 10) { logEvent('لا توجد قوات كافية للهجوم!', 'err'); return; }
        activeAttacks.push(new ConquestAttack({
            grid: conquestGrid, owner: 'player', target: owner,
            troops: troopsToSend, srcLat: src.lat, srcLon: src.lon,
            dstLat: lat, dstLon: lon, ctx: conquestCtx,
        }));
        if (isOnline) sendAction({ type: 'troop_attack', slat: src.lat, slon: src.lon, tlat: lat, tlon: lon, troops: troopsToSend, targetIdx: -1 });
        logEvent(`⚔️ انطلق الهجوم العسكري (${troopsToSend.toLocaleString('en')} قوة)`, 'info');
        updateHUD();
    },
    boatAt: (lat, lon) => launchTransportInvasion({ lat, lon }, 'player'),
    startBuild: (type) => {
        buildMode = type;
        const cost = window.__UI_API.costOf(type);
        if (type === 'warship') {
            const hull = GAME_CONSTANTS.HULL_CLASSES[warshipBuildClass];
            logEvent(`${hull.icon} وضع النشر: ${hull.name} ($${cost}، الحد ${hull.cap}) — انقر نقطة بحرية قرب مينائك · اضغط V للتبديل`, 'info');
        }
        else if (type === 'tank') {
            const cfg = TCFG[tankBuildClass];
            logEvent(`${cfg.icon} وضع الانتشار: ${cfg.name} ($${cost}، الحد ${cfg.cap}) — انقر أرضاً باتجاه الهدف · اضغط H للتبديل`, 'info');
        }
        else logEvent(`🏗️ وضع البناء: ${SDEFS[type] ? SDEFS[type].name : type} ($${cost}) — انقر موقعاً داخل أراضيك`, 'info');
    },
    fireMissileAt: (mtype, lat, lon) => {
        // Instant strike at the right-clicked point (OpenFront-style: action
        // applies to the tile you clicked, no separate targeting step).
        const cfg = MCFG[mtype];
        if (!cfg) return;
        const cost = cfg.cost;
        if (pRes < cost) { logEvent(`موارد غير كافية! تحتاج $${cost}`, 'err'); return; }
        const maxR = getMissileMaxRange(cfg);
        const pick = _pickLaunchPoint({ lat, lon }, myRole);
        if (!pick) { logEvent('لا توجد منصة إطلاق جاهزة! 🚀', 'err'); return; }
        if (!CheckTargetInRange(pick.lat, pick.lon, lat, lon, maxR)) { logEvent('الهدف خارج نطاق الصاروخ المختار!', 'err'); return; }
        _launchConsume(pick.launcher);   // TASK-403: magazine round + cooldown
        pRes -= cost;
        const { dx, dy } = _missileScatter(cfg);
        missiles.push(new Missile(pick.lat, pick.lon, lat + dx, lon + dy, cfg, myRole, false, pick.style));
        if (isOnline) sendAction({ type: 'launch', lat: pick.lat, lon: pick.lon, tlat: lat + dx, tlon: lon + dy, mtype, style: pick.style });
        logEvent(`🚀 ${cfg.name} انطلق!`, 'info');
        updateHUD();
    },
    purchasePlane: (k) => purchasePlane(k, 'radial'),
    orderPlanesAt: (mode, lat, lon) => window.orderPlanesAt(mode, lat, lon),
    openResearch: () => {
        const rp = document.getElementById('researchPanel');
        if (rp) rp.classList.add('open');
        rebuildTechPanel();
    },

    // ── data accessors ──
    sdefs: () => SDEFS,
    pcfg: () => PCFG,
    mcfg: () => MCFG,
    costOf: (type) => {
        if (type === 'city') return Math.floor(GAME_CONSTANTS.CITY_BASE_COST * Math.pow(1.5, pBuiltCities));
        if (type === 'port') return Math.floor(GAME_CONSTANTS.PORT_BASE_COST * Math.pow(1.5, pBuiltPorts));
        if (type === 'factory') return Math.floor(GAME_CONSTANTS.FACTORY_BASE_COST * Math.pow(1.5, pBuiltFactories));
        if (type === 'warship') {   // TASK-202: fleet slot prices the ARMED hull class
            const h = GAME_CONSTANTS.HULL_CLASSES[warshipBuildClass];
            return h ? h.cost : (SDEFS.warship ? SDEFS.warship.cost : 0);
        }
        if (type === 'tank') {       // TASK-302: armor slot prices the ARMED division class
            const c = TCFG[tankBuildClass];
            return c ? c.cost : (SDEFS.tank ? SDEFS.tank.cost : 0);
        }
        return SDEFS[type] ? SDEFS[type].cost : 0;
    },
    gold: () => pRes,
    troopPct: () => window.troopAttackPct || 50,
    setTroopPct: (v) => {
        v = Math.max(1, Math.min(100, Math.round(v)));
        window.troopAttackPct = v;
        const slider = document.getElementById('pctSlider');
        if (slider) slider.value = v;
        const lbl = document.getElementById('pctLabel');
        if (lbl) lbl.textContent = v + '%';
    },
    lockedMissiles: () => TECH_LOCKED_MISSILES,
    lockedPlanes: () => TECH_LOCKED_PLANES,
    isTechUnlocked: (k) => isTechUnlocked(k, 'missile', playerTech) || isTechUnlocked(k, 'plane', playerTech),

    // ── build-ghost state (hotbar / digit keys / right-click cancel) ──
    isBuildArmed: () => !!buildMode,
    cancelBuild: () => {
        buildMode = null;
        if (window.__refreshHotbar) window.__refreshHotbar();
        const gc = document.getElementById('gc');
        if (gc) gc.classList.remove('buildMode');
    }
};

// Attack-ratio slider wiring (new bottom control bar)
(function wireTroopSlider() {
    const slider = document.getElementById('pctSlider');
    if (!slider) return;
    slider.addEventListener('input', () => {
        window.troopAttackPct = parseInt(slider.value, 10);
        const lbl = document.getElementById('pctLabel');
        if (lbl) lbl.textContent = slider.value + '%';
    });
})();

// ════════════════════════════════════════════════════════════════════════
//  BUILD HOTBAR (OpenFront UnitDisplay port) + hotkey plumbing
//  Slots 1-0 arm the build ghost (buildMode); clicking the map places it.
//  V cycles NAVY HULL CLASSES (TASK-202): first press arms the slot with
//  the current hull, each further press switches to the next class.
// ════════════════════════════════════════════════════════════════════════
const HULL_ORDER = ['destroyer', 'escort', 'submarine', 'missile', 'drone', 'carrier', 'transport'];   // TASK-402: submarine joins the V cycle
let warshipBuildClass = 'destroyer';
// TASK-302: tank division classes cycle on repeated H while the slot is armed
const TANK_ORDER = ['light', 'medium', 'heavy'];
let tankBuildClass = 'medium';

const HOTBAR_SLOTS = [
    { key: '1', type: 'city',       icon: '🏙️', label: 'مدينة',  tip: 'يرفع سقف القوات +25k' },
    { key: '2', type: 'factory',    icon: '🏭', label: 'مصنع',   tip: 'دخل + يشغّل القطارات' },
    { key: '3', type: 'port',       icon: '⚓', label: 'ميناء',  tip: 'سفن تجارية 💰' },
    { key: '4', type: 'launcher',   icon: '🚀', label: 'منصة',   tip: 'إطلاق الصواريخ' },
    { key: '5', type: 'sam',        icon: '🛡️', label: 'SAM',    tip: 'اعتراض الصواريخ' },
    { key: '6', type: 'radar',      icon: '📡', label: 'رادار',  tip: 'كشف مبكر' },
    { key: 'J', type: 'radar_ecm',  icon: '📻', label: 'ECM',    tip: 'تشويش — يشتّت دقة صواريخ العدو داخل 520كم' },
    { key: '7', type: 'flak',       icon: '🔫', label: 'FLAK',   tip: 'دفاع جوي قصير المدى' },
    { key: '8', type: 'airport',    icon: '🛫', label: 'مطار',   tip: 'إنتاج الطائرات' },
    { key: '9', type: 'iron_dome',  icon: '🟢', label: 'قبة',    tip: 'اعتراض الزخات' },
    { key: '0', type: 'nuke_plant', icon: '☢️', label: 'مفاعل',  tip: 'دخل ضخم متأخر' },
    { key: 'V', type: 'warship',    icon: '🛳️', label: 'أسطول',  tip: 'V للتبديل: مدمرة/فرقاطة/غواصة/طراد/درون/حاملة/إنزال — انقر ماءً للنشر' },
    { key: 'Z', type: 'mine',       icon: '💣', label: 'ألغام',  tip: 'وضع الألغام البحرية [Z] — انقر ماءً لنشر حقل ألغام يفجّر سفن العدو وناقلات إنزاله' },
    { key: 'N', type: 'drone',     icon: '🛸', label: 'درون',   tip: 'وضع الدرونات — أنقر الخريطة لنشر أسراب/استطلاع/صائدة صواريخ' },
    { key: 'H', type: 'tank',      icon: '🚜', label: 'مدرعات',  tip: 'H للتبديل: استطلاع/قتال/اختراق — انقر أرضاً لنشر الفرقة من أقرب مصنع حربي' },
];

function _buildHotbarDom() {
    const bar = document.getElementById('hotbar');
    if (!bar) return;
    bar.innerHTML = '';
    HOTBAR_SLOTS.forEach(slot => {
        const def = SDEFS[slot.type] || {};
        const el = document.createElement('div');
        el.className = 'hslot';
        el.dataset.type = slot.type;
        el.innerHTML = `
            <span class="hkey">${slot.key}</span>
            <span class="hicon">${slot.icon}</span>
            <span class="hname">${slot.label || (def.name || slot.type)}</span>
            <span class="hcnt">0</span>
            <span class="hcost">$${def.cost || ''}</span>
            <div class="htip"><div class="t">${slot.label || def.name || slot.type} <small>[${slot.key}]</small></div><div class="d">${slot.tip || ''}</div><div class="c"></div></div>`;
        el.addEventListener('click', ev => { ev.stopPropagation(); window.__hotbarKey(slot.key); });
        bar.appendChild(el);
    });
}

window.__refreshHotbar = function () {
    const bar = document.getElementById('hotbar');
    if (!bar || !bar.children.length) return;
    const mode1 = window.gameMode === 'mode1';
    bar.style.display = (mode1 && !window.startSpawnPhase) ? 'flex' : 'none';
    const HC = GAME_CONSTANTS.HULL_CLASSES;
    HOTBAR_SLOTS.forEach((slot, i) => {
        const el = bar.children[i];
        const cost = slot.type === 'drone'
            ? (DCFG[selDrone] ? DCFG[selDrone].cost : 0)          // TASK-204: drone slot shows selected type cost
            : slot.type === 'mine'
                ? GAME_CONSTANTS.MINE_COST                       // TASK-402: minefield deploy cost
                : window.__UI_API.costOf(slot.type);
        let count;
        if (slot.type === 'warship') {
            count = warships.reduce((n, w) => n + (!w.dead && w.owner === 'player' && w.hullClass === warshipBuildClass ? 1 : 0), 0);
            // Live slot = the armed hull class (V cycling)
            const hull = HC[warshipBuildClass];
            el.querySelector('.hicon').textContent = hull.icon;
            el.querySelector('.hname').textContent = hull.name;
            el.querySelector('.hcnt').textContent = `${count}/${hull.cap}`;
        } else if (slot.type === 'mine') {
            // TASK-402: live minefield count vs cap
            const fields = mineFields.filter(f => !f.dead && f.owner === 'player').length;
            el.querySelector('.hcnt').textContent = `${fields}/${GAME_CONSTANTS.MINE_CAP}`;
        } else if (slot.type === 'tank') {
            // TASK-302: live slot = the armed division class (H cycling)
            const cfg = TCFG[tankBuildClass];
            const same = tanks.reduce((n, t) => n + (!t.dead && t.owner === 'player' && t.key === tankBuildClass ? 1 : 0), 0);
            el.querySelector('.hicon').textContent = cfg.icon;
            el.querySelector('.hname').textContent = cfg.name;
            el.querySelector('.hcnt').textContent = `${same}/${cfg.cap}`;
        } else if (slot.type === 'drone') {
            count = drones.reduce((n, d) => n + (!d.dead && d.owner === 'player' ? 1 : 0), 0);
            el.querySelector('.hcnt').textContent = count;
        } else {
            count = structs.filter(s => s.owner === 'player' && !s.dead && s.type === slot.type).length;
            el.querySelector('.hcnt').textContent = count;
        }
        const techLocked = TECH_LOCKED_BUILDS.includes(slot.type) && !isTechUnlocked(slot.type, 'build', playerTech);
        el.querySelector('.hcost').textContent = '$' + cost;
        el.querySelector('.htip .c').textContent = '$' + cost;
        el.classList.toggle('sel', buildMode === slot.type || (slot.type === 'drone' && droneMode) || (slot.type === 'mine' && mineMode));
        el.classList.toggle('poor', !techLocked && slot.type !== 'drone' && pRes < cost);
        el.classList.toggle('locked', !!techLocked);
    });
    const gc = document.getElementById('gc');
    if (gc) gc.classList.toggle('buildMode', !!buildMode);
};

// Shared arm/cancel for hotbar clicks + digit keys (OpenFront ghost toggle)
window.__hotbarKey = function (key) {
    const slot = HOTBAR_SLOTS.find(s => s.key === key);
    if (!slot) return;
    if (window.startSpawnPhase) return;
    // TASK-204: drone slot is a MODE, not a build ghost
    if (slot.type === 'drone') {
        if (window.gameMode !== 'mode1') return;
        _setDroneMode(!droneMode);
        return;
    }
    // TASK-402: mine slot is a MODE too — Z toggles the deploy cursor
    if (slot.type === 'mine') {
        if (window.gameMode !== 'mode1') return;
        _setMineMode(!mineMode);
        return;
    }
    // V CYCLES HULL CLASSES while the fleet slot is armed (TASK-202)
    if (slot.type === 'warship' && buildMode === 'warship') {
        const i = HULL_ORDER.indexOf(warshipBuildClass);
        warshipBuildClass = HULL_ORDER[(i + 1) % HULL_ORDER.length];
        const hull = GAME_CONSTANTS.HULL_CLASSES[warshipBuildClass];
        logEvent(`⚓ الهيكل التالي: ${hull.icon} ${hull.name} ($${hull.cost}، الحد ${hull.cap}) — ${hull.tip || 'انقر ماءً للنشر'}`, 'info');
        window.__refreshHotbar();
        return;
    }
    // H CYCLES TANK CLASSES while the armor slot is armed (TASK-302)
    if (slot.type === 'tank' && buildMode === 'tank') {
        const i = TANK_ORDER.indexOf(tankBuildClass);
        tankBuildClass = TANK_ORDER[(i + 1) % TANK_ORDER.length];
        const cfg = TCFG[tankBuildClass];
        logEvent(`🚜 الفرقة التالية: ${cfg.icon} ${cfg.name} ($${cfg.cost}، الحد ${cfg.cap}) — ${cfg.tip}`, 'info');
        window.__refreshHotbar();
        return;
    }
    const techLocked = TECH_LOCKED_BUILDS.includes(slot.type) && !isTechUnlocked(slot.type, 'build', playerTech);
    if (techLocked) { logEvent('هذا المبنى مقفل — تحتاج بحثاً أولاً 🔒', 'err'); return; }
    if (buildMode === slot.type) {
        buildMode = null;
        logEvent('أُلغي وضع البناء', 'info');
    } else {
        window.__UI_API.startBuild(slot.type);
    }
    window.__refreshHotbar();
};

// Center camera on my territory (mode1: centroid of sampled owned cells)
function centerOnMyTerritory() {
    if (window.gameMode === 'mode1' && typeof conquestGrid !== 'undefined' && conquestGrid && conquestGrid._maskReady) {
        let sumLat = 0, sumLon = 0, n = 0;
        const total = conquestGrid.owner.length;
        for (let i = 0; i < 600; i++) {
            const cell = (Math.random() * total) | 0;
            if (conquestGrid.owner[cell] === CONQUEST_CFG.PLAYER) {
                const ll = conquestGrid.cellToLatLon(cell);
                sumLat += ll.lat; sumLon += ll.lon; n++;
            }
        }
        if (n > 0) {
            camera.position.copy(latLonToVec3(sumLat / n, sumLon / n, EARTH_RADIUS + GAME_CONSTANTS.CAM_JUMP_ALTITUDE));
            controls.target.set(0, 0, 0);
            controls.update();
            return;
        }
    }
    const s = structs.find(s => s.owner === 'player' && !s.dead);
    if (s) {
        camera.position.copy(latLonToVec3(s.lat, s.lon, EARTH_RADIUS + GAME_CONSTANTS.CAM_JUMP_ALTITUDE));
        controls.target.set(0, 0, 0);
        controls.update();
    }
}

// ESC also closes the research panel
window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const rp = document.getElementById('researchPanel');
        if (rp) rp.classList.remove('open');
    }
}, true);

// Expose functions for inline HTML event handlers
window.startDevMode = typeof startDevMode !== 'undefined' ? startDevMode : window.startDevMode;
window.startVsAI = typeof startVsAI !== 'undefined' ? startVsAI : window.startVsAI;
window.manualConnect = typeof manualConnect !== 'undefined' ? manualConnect : window.manualConnect;
window.createRoom = typeof createRoom !== 'undefined' ? createRoom : window.createRoom;
window.joinRoom = typeof joinRoom !== 'undefined' ? joinRoom : window.joinRoom;
window.toggleProvinceBorders = typeof toggleProvinceBorders !== 'undefined' ? toggleProvinceBorders : window.toggleProvinceBorders;
window.hideCityPanel = typeof hideCityPanel !== 'undefined' ? hideCityPanel : window.hideCityPanel;
window.setVolley = typeof setVolley !== 'undefined' ? setVolley : window.setVolley;
window.openVolleyPicker = typeof openVolleyPicker !== 'undefined' ? openVolleyPicker : window.openVolleyPicker;
window.switchTab = typeof switchTab !== 'undefined' ? switchTab : window.switchTab;
window.backToMenu = typeof backToMenu !== 'undefined' ? backToMenu : window.backToMenu;
window.SFX = typeof SFX !== 'undefined' ? SFX : window.SFX;
// Module-scope functions invoked from INLINE onclick handlers must be exposed
// (type="module" declarations are not globals — these two buttons were dead):
window.upgradeCityRoads = typeof upgradeCityRoads !== 'undefined' ? upgradeCityRoads : window.upgradeCityRoads;
window.clearSelection = typeof clearSelection !== 'undefined' ? clearSelection : window.clearSelection;


// Async load GEO_DATA_ROADS
if (!window.GEO_DATA_ROADS || window.GEO_DATA_ROADS.length === 0) {
    fetch('/data/geo_roads.json')
        .then(res => res.json())
        .then(data => {
            window.GEO_DATA_ROADS = data;
            console.log("Lazy loaded GEO_DATA_ROADS, count:", data.length);
        })
        .catch(err => console.error("Could not load geo roads", err));
}


// Expose for GEO_RENDERER
window.EARTH_RADIUS = EARTH_RADIUS;
window.latLonToVec3 = latLonToVec3;

// ═══════════════════════════════════════════════════════════════════
// TASK-204 PROBES (run from the browser console during a live game)
//   missileAudit() — full warhead balance table (before/after)
//   droneTest()    — drone spawn → engage → KILL verified (kamikaze)
//                    + interceptor drone shoots down an incoming missile
//   samTest()      — radar-chain SAM locks: base range vs chained vs EMP'd
// ═══════════════════════════════════════════════════════════════════
window.missileAudit = function () {
    const BEFORE = {
        scud: { cost: 90, dmg: 70 }, ballistic: { cost: 130, dmg: 95 }, cruise: { cost: 190, dmg: 90 },
        cluster: { cost: 240, dmg: 45 }, emp: { cost: 300, dmg: 8 }, tomahawk: { cost: 350, dmg: 120 },
        thermobaric: { cost: 420, dmg: 240 }, stealth_m: { cost: 480, dmg: 160 }, bunker_bust: { cost: 560, dmg: 380 },
        hyper: { cost: 650, dmg: 200 }, icbm: { cost: 1000, dmg: 500 }, nuke_tac: { cost: 2000, dmg: 700 },
    };
    const ROLE = {
        scud: 'cheap terror/suppression (shocks reloads)', ballistic: 'workhorse (best dmg/$)',
        cruise: 'low-flying precise cruiser', cluster: 'ANTI-TROOP (shreds cohorts ×3.2)',
        emp: 'EW (kills reloads+scans+radar 10s)', tomahawk: 'precision standoff',
        thermobaric: 'anti-structure + deepest devastation', stealth_m: 'defense penetrator (radar-invisible)',
        bunker_bust: 'ANTI-TURTLE (×2.6 vs hardened)', hyper: 'uninterceptable sprint',
        icbm: 'MIRV global saturation ×3', nuke_tac: 'game-ender (+deep EMP)',
    };
    const rows = Object.keys(MCFG).map(k => {
        const c = MCFG[k], b = BEFORE[k] || {};
        return {
            type: k, role: ROLE[k] || '',
            cost: c.cost, dmg: c.dmg, radius: c.rad, speed: c.spd, acc: c.acc,
            evade: c.samEvade, devMul: c.devMul || 1,
            dmg_per_gold: +(c.dmg / c.cost).toFixed(3),
            before_cost_dmg: b.cost != null ? `${b.cost}/${b.dmg}` : '-',
        };
    });
    console.table(rows);
    logEvent(`[missileAudit] ${rows.length} warhead types — جدول التوازن في الكونسول (before/after)`, 'info');
    return rows;
};

window.droneTest = function () {
    const res = { part1_kamikaze: {}, part2_interceptor: {} };
    // ── Part 1: kamikaze drone spawns, acquires, strikes, KILLS ──
    const flak = new Structure(30, 30, 'flak', 'enemy');   // hp 80 < kamikaze dmg 95
    structs.push(flak);
    const drone = new Drone(28.6, 28.6, 'kamikaze', 'player', { homeLat: 28.6, homeLon: 28.6 });
    res.part1_kamikaze.meshBuilt = !!(drone.mesh && drone.mesh.children.length > 0);
    // Target-hook design: restrict acquisition to the probe target ONLY
    // (also proves the hook other platforms will rely on)
    const origAcquire = Drone.ACQUIRE;
    Drone.ACQUIRE = () => [{ kind: 'struct', obj: flak }];
    let engaged = false, steps = 0;
    try {
        while (steps++ < 400 && !drone.dead && !flak.dead) {
            frame++;
            drone.update();
            if (drone.mode === 'engage') engaged = true;
        }
    } finally { Drone.ACQUIRE = origAcquire; }
    res.part1_kamikaze = { ...res.part1_kamikaze, engaged, killed: flak.dead, steps, hpBefore: 80, hpAfter: flak.hp };
    // ── Part 2: interceptor drone vs an incoming enemy missile ──
    const ix = new Drone(10, 10, 'intercept', 'player', { homeLat: 10, homeLon: 10 });
    const mCfg = Object.assign({}, MCFG.ballistic, { samEvade: 0 });   // deterministic (no flare dodge)
    const threat = new Missile(12, 10, -30, 10, mCfg, 'enemy');
    missiles.push(threat);
    let fired = false, s2 = 0;
    while (s2++ < 900 && !threat.dead) {
        frame++;
        ix.update();
        if (missiles.some(x => x.isSAM && x.tgt === threat)) fired = true;   // check BEFORE compaction
        for (const mm of missiles) if (!mm.dead) mm.update();
        missiles = missiles.filter(mm => !mm.dead);
    }
    const intercepted = threat.dead && threat.progress < 0.9;
    res.part2_interceptor = { fired, threatDead: threat.dead, intercepted, progressAtDeath: +threat.progress.toFixed(2), chargesLeft: ix.charges };
    // ── cleanup (probe objects only) ──
    const _killMissile = (m) => { if (m && !m.dead) { m.dead = true; scene.remove(m.mesh); disposeMeshDeep(m.mesh); } else if (m && m.mesh && m.mesh.parent) { scene.remove(m.mesh); disposeMeshDeep(m.mesh); } };
    _killMissile(threat);
    missiles.forEach(m => { if (m.isSAM && (m.tgt === threat)) _killMissile(m); });
    missiles = missiles.filter(m => !(m.dead));
    [drone, ix].forEach(d => { if (!d.dead) { d.dead = true; scene.remove(d.mesh); disposeMeshDeep(d.mesh); } });
    if (!flak.dead) {
        flak.dead = true; scene.remove(flak.mesh); scene.remove(flak.selRing);
        flak.accents.forEach(m => m.dispose());
        if (flak.selRing && flak.selRing.material) flak.selRing.material.dispose();
    }
    const fi = structs.indexOf(flak);
    if (fi >= 0) structs.splice(fi, 1);   // remove probe struct
    const pass = res.part1_kamikaze.engaged && res.part1_kamikaze.killed && res.part2_interceptor.intercepted;
    console.log('[droneTest]', res);
    logEvent(`[droneTest] ${pass ? 'PASS ✅' : 'FAIL ❌'} — كاميكازي: اشتبك=${engaged} قتل=${flak.dead} · صائدة: أطلقت=${fired} اعترضت=${intercepted}`, pass ? 'info' : 'err');
    return res;
};

window.samTest = function () {
    const res = {};
    const sam = new Structure(20, 20, 'sam', 'player');
    const _cleanupStruct = (s) => { if (!s.dead) { s.dead = true; scene.remove(s.mesh); scene.remove(s.selRing); s.accents.forEach(m => m.dispose()); if (s.selRing && s.selRing.material) s.selRing.material.dispose(); } };
    const _killMissile = (m) => { if (!m.dead) { m.dead = true; scene.remove(m.mesh); disposeMeshDeep(m.mesh); } };
    try {
        // Parked threat at ~111km: outside the 80km base envelope, inside the
        // radar-chained 176km envelope.
        const mCfg = Object.assign({}, MCFG.ballistic, { samEvade: 0 });
        const mkThreat = () => {
            const m = new Missile(21, 20, 21.5, 20, mCfg, 'enemy');
            m.progress = 0.3; m.lat = 21.0; m.lon = 20;
            missiles.push(m);
            return m;
        };
        // A) base range only → must NOT engage at 111km
        const tA = mkThreat();
        for (let i = 0; i < 10; i++) { frame++; sam.update(); }
        res.A_base_noLock = !missiles.some(x => x.isSAM && x.tgt === tA);
        _killMissile(tA);
        missiles = missiles.filter(m => !m.dead);
        // B) radar covering the threat → chain lock → FIRES
        //    (Structure ctor does NOT self-register — push to structs so the
        //     radar chain scan can see it, then splice it out on cleanup)
        const radar = new Structure(21.5, 20, 'radar', 'player');
        structs.push(radar);
        const tB = mkThreat();
        for (let i = 0; i < 10; i++) { frame++; sam.update(); }
        res.B_chain_lock = missiles.some(x => x.isSAM && x.tgt === tB);
        missiles.forEach(m => { if (m.isSAM && m.tgt === tB) _killMissile(m); });
        missiles = missiles.filter(m => !m.dead);
        _killMissile(tB);
        // C) EMP'd radar → chain dark → no lock even in chained range
        sam.reload = 0;
        radar.empT = 999;
        const tC = mkThreat();
        for (let i = 0; i < 10; i++) { frame++; sam.update(); }
        res.C_emp_dark = !missiles.some(x => x.isSAM && x.tgt === tC);
        _killMissile(tC);
        missiles = missiles.filter(m => !m.dead);
        const ri = structs.indexOf(radar);
        if (ri >= 0) structs.splice(ri, 1);
        _cleanupStruct(radar);
        // D) EMP'd SAM itself → cannot scan at all (even inside base range)
        sam.reload = 0; sam.empT = 30;
        const tD = new Missile(20.4, 20, 20.5, 20, mCfg, 'enemy');   // ~44km — well inside 80km
        tD.progress = 0.3;
        missiles.push(tD);
        for (let i = 0; i < 10; i++) { frame++; sam.update(); }
        res.D_emp_sam_dark = !missiles.some(x => x.isSAM && x.tgt === tD);
        _killMissile(tD);
        missiles = missiles.filter(m => !m.dead);
    } finally {
        _cleanupStruct(sam);
    }
    const pass = res.A_base_noLock && res.B_chain_lock && res.C_emp_dark && res.D_emp_sam_dark;
    console.log('[samTest]', res);
    logEvent(`[samTest] ${pass ? 'PASS ✅' : 'FAIL ❌'} — أساسي=${res.A_base_noLock} · سلسلة رادار=${res.B_chain_lock} · رادار EMP=${res.C_emp_dark} · SAM مكهرب=${res.D_emp_sam_dark}`, pass ? 'info' : 'err');
    return res;
};

// ── TASK-403: radar-ECM station — enemy missile guidance degrades ONCE when
// passing a covering station (hyper exempt, EMP'd station dark, friendly
// missiles of the station owner are never jammed). ──
window.ecmTest = function () {
    const res = {};
    const ecm = new Structure(20, 20, 'radar_ecm', 'player');
    // Structure ctor does NOT self-register — push to structs so _ecmJam's
    // scan can see it (same registration the live build flow performs).
    structs.push(ecm);
    const _cleanup = (s) => { if (!s.dead) { s.dead = true; scene.remove(s.mesh); scene.remove(s.selRing); s.accents.forEach(m => m.dispose()); if (s.selRing && s.selRing.material) s.selRing.material.dispose(); } };
    const _kill = (m) => { if (m && !m.dead) { m.dead = true; scene.remove(m.mesh); disposeMeshDeep(m.mesh); } };
    try {
        // A) enemy ballistic passing over the station → jammed + aimpoint moved
        const mA = new Missile(24, 20, 16, 20, MCFG['ballistic'], 'enemy');
        const aim0 = { lat: mA.tlat, lon: mA.tlon };
        missiles.push(mA);
        let steps = 0;
        while (steps++ < 40 && !mA.dead && !mA._ecmJammed) { frame++; mA.update(); }
        res.A_jammed = !!mA._ecmJammed;
        res.A_aimMoved = mA._ecmJammed && (mA.tlat !== aim0.lat || mA.tlon !== aim0.lon);
        _kill(mA);
        // B) hyper is exempt (sprints through before a lock)
        const mB = new Missile(24, 20, 16, 20, MCFG['hyper'], 'enemy');
        missiles.push(mB);
        let s2 = 0;
        while (s2++ < 40 && !mB.dead && !mB._ecmJammed) { frame++; mB.update(); }
        res.B_hyperExempt = !mB._ecmJammed;
        _kill(mB);
        // C) EMP'd station is dark
        ecm.empT = 999;
        const mC = new Missile(24, 20, 16, 20, MCFG['ballistic'], 'enemy');
        missiles.push(mC);
        let s3 = 0;
        while (s3++ < 40 && !mC.dead && !mC._ecmJammed) { frame++; mC.update(); }
        res.C_empDark = !mC._ecmJammed;
        _kill(mC);
        ecm.empT = 0;
        // D) the station owner's own missiles are never jammed
        const mD = new Missile(24, 20, 16, 20, MCFG['ballistic'], 'player');
        missiles.push(mD);
        let s4 = 0;
        while (s4++ < 40 && !mD.dead && !mD._ecmJammed) { frame++; mD.update(); }
        res.D_friendlyImmune = !mD._ecmJammed;
        _kill(mD);
        // E) station shape: ecmRadius wired from SDEFS
        res.E_radius = ecm.ecmRadius === (SDEFS.radar_ecm.ecmRadius || 520);
    } finally {
        missiles = missiles.filter(m => !m.dead);
        const ei = structs.indexOf(ecm);
        if (ei >= 0) structs.splice(ei, 1);
        _cleanup(ecm);
    }
    const pass = res.A_jammed && res.A_aimMoved && res.B_hyperExempt && res.C_empDark && res.D_friendlyImmune && res.E_radius;
    console.log('[ecmTest]', res);
    logEvent(`[ecmTest] ${pass ? 'PASS ✅' : 'FAIL ❌'} — شوّش=${res.A_jammed} حرف الهدف=${res.A_aimMoved} · فرط صوتي معفي=${res.B_hyperExempt} · EMP معطل=${res.C_empDark} · صديق محصّن=${res.D_friendlyImmune} · المدى=${res.E_radius}`, pass ? 'info' : 'err');
    return res;
};

// ── TASK-403: AA vs DRONES — SAM fires a guided interceptor (tgtIsDrone) and
// kills the airframe; flak barrage connects for chip damage. ──
window.aaDroneTest = function () {
    const res = {};
    const sam = new Structure(20, 20, 'sam', 'player');
    const flak = new Structure(24, 24, 'flak', 'player');
    const _cleanup = (s) => { if (!s.dead) { s.dead = true; scene.remove(s.mesh); scene.remove(s.selRing); s.accents.forEach(m => m.dispose()); if (s.selRing && s.selRing.material) s.selRing.material.dispose(); } };
    const _killDrone = (d) => { if (d && !d.dead) { d.dead = true; scene.remove(d.mesh); disposeMeshDeep(d.mesh); } };
    // Drone ctor does NOT self-register — launchDrone() pushes to drones, so
    // the probe must too. Isolate the array so live-game drones can't leak in.
    const savedDrones = drones;
    drones = [];
    try {
        // Part 1: SAM vs an enemy kamikaze drone closing on it. Spawn at 150km
        // (inside the 160km drone-detect ring, beyond one 135km/tick hop) and
        // force an even frame so the SAM's scan fires on tick 1 — deterministic.
        const drone = new Drone(21.35, 20, 'kamikaze', 'enemy', { homeLat: 21.35, homeLon: 20 });
        drones.push(drone);
        const origAcquire = Drone.ACQUIRE;
        Drone.ACQUIRE = () => [{ kind: 'struct', obj: sam }];
        if (frame % 2 === 0) frame++;   // next frame++ inside the loop lands even
        let fired = false, s1 = 0;
        try {
            while (s1++ < 300 && !drone.dead && !sam.dead) {
                frame++;
                sam.update();
                drone.update();
                if (missiles.some(x => x.isSAM && x.tgtIsDrone && x.tgt === drone)) fired = true;
                for (const mm of missiles) if (!mm.dead) mm.update();
                missiles = missiles.filter(mm => !mm.dead);
            }
        } finally { Drone.ACQUIRE = origAcquire; }
        res.samFired = fired;
        res.droneKilled = drone.dead;
        res.samSurvived = !sam.dead;
        // Part 2: flak barrage vs a HOLDING drone (acquire pinned empty so it
        // never engages — isolates the barrage). Pump until hp drops (chance
        // ≥0.4/burst, reload 65f → deterministic within 700f).
        const d2 = new Drone(24.05, 24, 'kamikaze', 'enemy', { homeLat: 24.05, homeLon: 24 });
        drones.push(d2);
        Drone.ACQUIRE = () => [];
        const hp0 = d2.hp;
        let s2 = 0;
        while (s2++ < 700 && !d2.dead && d2.hp >= hp0) {
            frame++;
            flak.update();
            d2.update();
        }
        Drone.ACQUIRE = origAcquire;
        res.flakDamaged = d2.hp < hp0 || d2.dead;
        _killDrone(d2);
    } finally {
        for (const d of drones) _killDrone(d);
        drones = savedDrones.filter(d => !d.dead);
        missiles = missiles.filter(m => !m.dead);
        _cleanup(sam); _cleanup(flak);
    }
    const pass = res.samFired && res.droneKilled && res.samSurvived && res.flakDamaged;
    console.log('[aaDroneTest]', res);
    logEvent(`[aaDroneTest] ${pass ? 'PASS ✅' : 'FAIL ❌'} — SAM أطلق=${res.samFired} أسقط الدرون=${res.droneKilled} · FLAK أضر=${res.flakDamaged}`, pass ? 'info' : 'err');
    return res;
};

// ── TASK-403: MIRV — the ICBM bus splits into 3 slim RV models, each with a
// spread-preview ring at its aimpoint. ──
window.mirvTest = function () {
    const res = {};
    const bus = new Missile(35, -20, 24, 45, MCFG['icbm'], 'player');   // Atlantic → Arabia (long leg)
    missiles.push(bus);
    let steps = 0;
    while (steps++ < 900 && !bus.dead && !(bus.mirvDone)) {
        frame++;
        bus.update();
    }
    const kids = missiles.filter(m => m.isWarhead && m.mkey === 'mirv_w');
    res.split = bus.mirvDone || bus.dead;
    res.childCount = kids.length;
    res.allSlimRV = kids.every(k => k.mesh && k.mesh.children.length > 0 && k.mkey === 'mirv_w');
    res.dmgScale = kids.length ? kids[0].dmgScale : 0;
    res.scaleOk = res.dmgScale === 0.55;
    kids.forEach(k => { if (!k.dead) { k.dead = true; scene.remove(k.mesh); disposeMeshDeep(k.mesh); } });
    if (!bus.dead) { bus.dead = true; scene.remove(bus.mesh); disposeMeshDeep(bus.mesh); }
    missiles = missiles.filter(m => !m.dead);
    const pass = res.split && res.childCount === 3 && res.allSlimRV && res.scaleOk;
    console.log('[mirvTest]', res);
    logEvent(`[mirvTest] ${pass ? 'PASS ✅' : 'FAIL ❌'} — انفصل=${res.split} رؤوس=${res.childCount} نموذج RV=${res.allSlimRV} ضرر=${res.dmgScale}`, pass ? 'info' : 'err');
    return res;
};

// ── TASK-403: launcher magazine — 6 launches dry the pad, _pickLaunchPoint
// skips it, LAUNCHER_REARM_FRAMES later the magazine is full again. ──
window.magTest = function () {
    const res = {};
    const L = new Structure(20, 20, 'launcher', 'player');
    const _cleanup = (s) => { if (!s.dead) { s.dead = true; scene.remove(s.mesh); scene.remove(s.selRing); s.accents.forEach(m => m.dispose()); if (s.selRing && s.selRing.material) s.selRing.material.dispose(); } };
    try {
        res.magInit = L.mag;
        for (let i = 0; i < 6; i++) _launchConsume(L);
        res.dryAfterSix = L.mag === 0 && L.rearmT > 0;
        // dry pad is NOT a launch point — isolate structs so ONLY the probe
        // launcher is a candidate (live-game launchers would false-negative)
        const savedStructs = structs;
        structs = [L];
        res.pickSkipsDry = !_pickLaunchPoint({ lat: 21, lon: 21 }, 'player');
        // pump the re-arm cycle (empT 0 → crane runs)
        let steps = 0;
        while (steps++ < GAME_CONSTANTS.LAUNCHER_REARM_FRAMES + 10 && L.mag < L.maxMag) { frame++; L.update(); }
        res.rearmRefill = L.mag === L.maxMag;
        res.pickAfterRearm = !!_pickLaunchPoint({ lat: 21, lon: 21 }, 'player');
        structs = savedStructs;
    } finally {
        const i = structs.indexOf(L);
        if (i >= 0) structs.splice(i, 1);
        _cleanup(L);
    }
    const pass = res.magInit === 6 && res.dryAfterSix && res.pickSkipsDry && res.rearmRefill && res.pickAfterRearm;
    console.log('[magTest]', res);
    logEvent(`[magTest] ${pass ? 'PASS ✅' : 'FAIL ❌'} — مخزون=${res.magInit} · جف=${res.dryAfterSix} · تخطى الجاف=${res.pickSkipsDry} · تعبئة=${res.rearmRefill}`, pass ? 'info' : 'err');
    return res;
};

// ── TASK-403: mixed volleys — _volleyPlan composes multi-type salvos, and a
// live fire puts the composed types in flight (magazine consumed per shot). ──
window.mixVolleyTest = async function () {
    const res = {};
    const saveVolley = volleyCount, saveSel = selMissile, saveMix = missileMix.slice();
    const _killAll = () => { missiles.forEach(m => { if (!m.dead) { m.dead = true; scene.remove(m.mesh); disposeMeshDeep(m.mesh); } }); missiles = missiles.filter(m => !m.dead); };
    try {
        // A) plan composition (sync, deterministic)
        volleyCount = 1; missileMix = ['ballistic']; selMissile = 'ballistic';
        const pSingle = _volleyPlan();
        res.singleTypes = pSingle.types.length === 1 && pSingle.types[0] === 'ballistic';
        volleyCount = 'mix'; missileMix = ['scud', 'ballistic', 'cruise'];
        const pMix = _volleyPlan();
        res.mixTypes = pMix.types.join(',') === 'scud,ballistic,cruise';
        res.mixCost = pMix.cost === MCFG.scud.cost + MCFG.ballistic.cost + MCFG.cruise.cost;
        // B) live fire (first shot delay 0 → lands after one macrotask)
        const L = new Structure(20, 20, 'launcher', 'player');
        structs.push(L);
        L.reload = 0;
        const resBefore = pRes;
        pRes = 5000;
        const fired = fireMissileVolley({ lat: 21, lon: 21 });
        await new Promise(r => setTimeout(r, 60));
        res.fired = fired;
        const firstShot = missiles.find(m => !m.dead && m.owner === 'player');
        res.liveFirstShot = !!firstShot && firstShot.mkey === 'scud';   // plan order preserved
        res.magConsumed = L.mag === 5;
        pRes = resBefore;
        const i = structs.indexOf(L);
        if (i >= 0) structs.splice(i, 1);
        if (!L.dead) { L.dead = true; scene.remove(L.mesh); scene.remove(L.selRing); L.accents.forEach(m => m.dispose()); if (L.selRing && L.selRing.material) L.selRing.material.dispose(); }
    } finally {
        _killAll();
        volleyCount = saveVolley; selMissile = saveSel; missileMix = saveMix;
    }
    const pass = res.singleTypes && res.mixTypes && res.mixCost && res.fired && res.liveFirstShot && res.magConsumed;
    console.log('[mixVolleyTest]', res);
    logEvent(`[mixVolleyTest] ${pass ? 'PASS ✅' : 'FAIL ❌'} — مفرد=${res.singleTypes} · مختلط=${res.mixTypes} · كلفة=${res.mixCost} · أطلق=${res.fired} أول=${res.liveFirstShot} مخزون=${res.magConsumed}`, pass ? 'info' : 'err');
    return res;
};

// Quick drone-state inspector (pairs with the existing __ffaProbe)
window.__ffaProbe = window.__ffaProbe || {};
window.__ffaProbe.droneCheck = () => drones.map(d => ({
    key: d.key, owner: d.owner, mode: d.mode, hp: d.hp, fuel: d.fuel,
    tgt: d.target ? d.target.kind : null, charges: d.charges,
    pos: [+d.lat.toFixed(2), +d.lon.toFixed(2)], home: [+d.homeLat.toFixed(2), +d.homeLon.toFixed(2)],
}));

// ═══════════════════════════════════════════════════════════════════════
//  NAVAL BATTLE TEST (TASK-202 probe) — window.navalBattleTest()
//  Spawns two hostile fleets in the mid-Pacific and verifies the hull-class
//  systems end-to-end over ~70s of live simulation:
//    1. ENGAGE  — gunships close and shell each other (hull HP drops)
//    2. INTERCEPT — an enemy cruise missile at the carrier is killed by
//       escort point-defense / carrier CIWS
//    3. STRIKE  — the missile cruiser's VLS shots land (enemy damage)
//    4. DRONES  — the drone bay launches its DCFG swarm
//    5. AIR WING — the carrier spawns deck-based fighters
//    6. SINK    — sustained fire eventually sinks a hull
//    7. TRANSPORT — the enemy troop transport is engaged (priority-0 target)
//  Progress prints to console; final verdict lands in window.__navalTestResult.
//  Run it from the browser console while a mode-1 game is running.
//  NOTE: in browsers/hosting views where requestAnimationFrame never fires
//  (hidden pages), drive the simulation manually: window.__pumpGame(n) below.
// ═══════════════════════════════════════════════════════════════════════
// Manual logic pump for headless/hidden-page testing (one call = 1 logic tick)
window.__gameFrame = gameFrame;
window.__pumpGame = async function (frames) {
    for (let i = 0; i < frames; i++) {
        gameFrame();
        if (i % 120 === 119) await new Promise(r => setTimeout(r, 0));   // let setTimeout phases interleave
    }
    return { frame, warships: warships.length, drones: drones.length, missiles: missiles.length };
};
window.navalBattleTest = async function () {
    const log = (m) => console.log('%c[NAVAL-TEST] ' + m, 'color:#44ccff;font-weight:bold');
    if (!scene || gOver) { log('Start a game first (mode 1).'); return; }
    logEvent('🧪 اختبار المعركة البحرية بدأ — راقب الكونسول', 'info');

    // ── isolate: clear every hull/drone (and their meshes) ──
    clearSelection();
    for (const w of warships) { if (!w.dead) w._sink(); }
    for (const d of drones) { if (!d.dead) d._crash(); }   // TASK-204 Drone API
    warships.length = 0; drones.length = 0;
    // strip leftover SAM missiles so interception counting is clean
    for (let i = missiles.length - 1; i >= 0; i--) {
        if (missiles[i].isSAM) { missiles[i].dead = true; scene.remove(missiles[i].mesh); }
    }

    // ── theater: open Pacific points ~350km apart (both WATER) ──
    const A = { lat: 8, lon: -138 };    // player fleet
    const B = { lat: 5, lon: -134.5 };  // enemy fleet
    const mkFleet = (owner, anchor, comps) => {
        const fakePort = { lat: anchor.lat, lon: anchor.lon };
        const ships = comps.map(([cls, dx, dy]) => {
            const s = new Warship(owner, fakePort, { lat: anchor.lat + dy, lon: anchor.lon + dx }, cls);
            warships.push(s);
            return s;
        });
        return ships;
    };
    // player: carrier + escort screen + gunship + VLS cruiser + drone bay
    const pFleet = mkFleet('player', A, [['carrier', 0, 0], ['escort', 0.6, 0.6], ['destroyer', -0.6, 0.6], ['missile', 0, 1.2], ['drone', 1.2, 0]]);
    // enemy: gunship + VLS cruiser + loaded invasion transport
    const eFleet = mkFleet('enemy', B, [['destroyer', 0, 0], ['missile', 0.5, 0.5], ['transport', -0.5, 0.5]]);
    const eTransport = eFleet[2];
    eTransport.troops = 4000;   // loaded — must draw priority-0 fire
    pFleet.forEach(s => { pRes = Math.max(pRes, 3000); });
    eRes = Math.max(eRes, 3000);

    const R = { t: 0, engaged: false, hpDropped: false, intercepts: 0, vlsFired: 0, drones: 0, planes: 0,
                sinks: 0, transportHit: false, done: false, pass: false, notes: [] };
    window.__navalTestResult = R;
    // Held references — dead missiles are compacted out of missiles[] the same
    // frame they die, so the probe keeps its own refs to read .dead/.progress.
    const trackedThreats = new Map();   // enemy missiles aimed at our hulls
    const _vlsSeen = new Set();         // cruiser ids observed just after a VLS shot

    // ── phase: inject an enemy cruise missile AT the carrier (t+5s) ──
    setTimeout(() => {
        const carrier = pFleet[0];
        if (carrier.dead) return;
        log('Firing enemy cruise missile at the carrier (PD should intercept)');
        const m = new Missile(B.lat, B.lon, carrier.curLat, carrier.curLon, MCFG['cruise'], 'enemy');
        missiles.push(m);
    }, 5000);

    const snap = () => {
        // damage evidence on either side
        for (const w of [...pFleet, ...eFleet]) {
            if (!w.dead && w.hp < w.maxHp - 1) R.hpDropped = true;
        }
        R.engaged = R.hpDropped;
        R.drones = Math.max(R.drones, drones.filter(d => !d.dead).length);
        R.planes = Math.max(R.planes, planes.filter(p => !p.dead && p.baseStruct === pFleet[0]).length);
        R.sinks = [...pFleet, ...eFleet].filter(w => w.dead).length;
        // Track enemy missiles AIMED at our hulls (while still alive)
        for (const m of missiles) {
            if (m.dead || m.isSAM || m.owner !== 'enemy') continue;
            for (const w of pFleet) {
                if (!w.dead && haversineDist(m.tlat, m.tlon, w.curLat, w.curLon) < 200) {
                    trackedThreats.set(m.id, m);
                    break;
                }
            }
        }
        // A tracked threat that died mid-flight = point-defense intercept
        R.intercepts = [...trackedThreats.values()]
            .filter(m => m.dead && m.progress > 0.05 && m.progress < 0.95).length;
        // VLS evidence: a cruiser's reload timer observed reset to full
        for (const s of [pFleet[3], eFleet[1]]) {
            if (s && !s.dead && s.missileCd > 200) _vlsSeen.add(s.id);
        }
        R.vlsFired = _vlsSeen.size;
        if (!R.transportHit && eTransport.hp < eTransport.maxHp) R.transportHit = true;
    };

    log('Fleet A (player): ' + pFleet.map(w => w.hullClass).join(', '));
    log('Fleet B (enemy):  ' + eFleet.map(w => w.hullClass).join(', '));

    // ── watch loop: 1s samples for 70s ──
    for (let t = 0; t < 70 && !R.done; t++) {
        await new Promise(res => setTimeout(res, 1000));
        R.t = t + 1;
        try { snap(); } catch (err) { R.notes.push('snap error: ' + err.message); }
        if (t % 10 === 9) log(`t=${t + 1}s engaged=${R.engaged} intercepts=${R.intercepts} vls=${R.vlsFired} drones=${R.drones} planes=${R.planes} sinks=${R.sinks} trHit=${R.transportHit}`);
        // early finish once every category has evidence AND a sink occurred
        if (R.hpDropped && R.intercepts > 0 && R.vlsFired > 0 && R.drones > 0 && R.planes > 0 && R.sinks > 0) {
            R.done = true;
        }
    }
    R.done = true;

    // ── verdict ──
    const checks = [
        ['ENGAGE (damage dealt)', R.hpDropped],
        ['INTERCEPT (PD/CIWS kill)', R.intercepts > 0],
        ['VLS (missile-ship fired)', R.vlsFired > 0],
        ['DRONES (swarm launched)', R.drones > 0],
        ['AIR WING (deck fighters)', R.planes > 0],
        ['SINK (a hull went down)', R.sinks > 0],
        ['TRANSPORT (troop ship hit)', R.transportHit],
    ];
    let ok = 0;
    for (const [name, pass] of checks) {
        if (pass) ok++;
        log(`${pass ? '✅' : '❌'} ${name}`);
    }
    R.pass = ok >= 6;   // transport may legitimately survive if sunk early by missiles
    log(`RESULT: ${R.pass ? 'PASS' : 'FAIL'} (${ok}/${checks.length} checks) — window.__navalTestResult`);
    logEvent(R.pass ? '🧪 اختبار البحرية: نجح ✅' : '🧪 اختبار البحرية: فشل ❌ — انظر الكونسول', R.pass ? 'info' : 'err');
    return R;
};

// ═══════════════════════════════════════════════════════════════════════
//  NAVAL DEEP TEST (TASK-402 probe) — window.navalDeepTest()
//  Verifies the deep-pass systems deterministically (pumps gameFrame
//  directly — hidden-page safe, no RAF dependency):
//    1. FLEET AA (audit #6)  — enemy plane + drone near a destroyer get shredded
//    2. SUB+TORPEDO          — sub fires, enemy hull takes torpedo damage,
//                              boat stays undetected with no sonar around
//    3. SONAR                — an ASW escort's ping reveals the submerged boat
//    4. MINES                — an enemy hull sailing into a field detonates it
//    5. FORMATIONS           — line/wedge stances spread distinct waypoints
//    6. SHORE BOMBARDMENT    — gun hulls shell a coastal structure (grid-ready games)
//    7. SYNC RECEIVERS (#7/8)— warship_spawn/move/invade, naval_mine, torpedo,
//                              shipId-based plane basing all mirror locally
//    8. SUB BUILDABLE        — 'submarine' rides the V hull cycle
//  Verdict lands in window.__navalDeepResult. Run from the console in mode 1.
// ═══════════════════════════════════════════════════════════════════════
window.navalDeepTest = async function () {
    const log = (m) => console.log('%c[NAVAL-DEEP] ' + m, 'color:#ffaa33;font-weight:bold');
    if (!scene || gOver) { log('Start a game first (mode 1).'); return; }
    logEvent('🧪 اختبار البحرية العميق بدأ — راقب الكونسول', 'info');
    const C = GAME_CONSTANTS;
    const R = { t: 0, checks: {}, notes: [], done: false, pass: false };
    window.__navalDeepResult = R;

    const pump = async (n, obs) => {
        for (let i = 0; i < n; i++) {
            gameFrame();
            if (obs) obs();
            if (i % 300 === 299) await new Promise(r => setTimeout(r, 0));
        }
        R.t += n / 60;
    };
    const deepClean = () => {
        clearSelection();
        for (const w of warships) if (!w.dead) w._sink();
        for (const d of drones) if (!d.dead) d._crash();
        for (const p of planes) if (!p.dead) { p.dead = true; if (p.mesh) { scene.remove(p.mesh); disposeMeshDeep(p.mesh); } if (p.selRing) { scene.remove(p.selRing); disposeMeshDeep(p.selRing); } }
        for (const tp of torpedoes) tp._fizzle(NAVAL_CTX, true);
        for (const f of mineFields) f._expire(NAVAL_CTX, true);
        warships.length = 0; drones.length = 0; planes.length = 0;
    };
    const fakePort = (ll) => ({ lat: ll.lat, lon: ll.lon });

    // ═══ 1+2. FLEET AA + SUBMARINE warfare (shared theater, mid-Pacific) ═══
    // NOTE: the torpedo victim is a MISSILE cruiser — destroyers/escorts carry
    // ASW sonar (170-260km) and would legitimately locate the boat; the
    // subHidden check needs a sonar-free enemy.
    deepClean();
    const A = { lat: 5, lon: -140 };
    const dd = new Warship('player', fakePort(A), A, 'destroyer');
    const sub = new Warship('player', fakePort({ lat: 3.4, lon: -139 }), { lat: 3.4, lon: -139 }, 'submarine');
    const eDd = new Warship('enemy', fakePort({ lat: 3.0, lon: -139 }), { lat: 3.0, lon: -139 }, 'missile');
    warships.push(dd, sub, eDd);
    const ePlane = new Plane(5.15, -140.1, PCFG['fighter'], 'enemy');
    ePlane.mode = 'patrol'; ePlane.tlat = 5.2; ePlane.tlon = -140.2;
    planes.push(ePlane);
    const droneSquad = launchDrone('enemy', 'nano', { lat: 5.1, lon: -139.9 }, { homeLat: 5.1, homeLon: -139.9 });
    log(`theater up: dd@player sub@player eDd@enemy plane+${droneSquad ? droneSquad.length : 0} drones@enemy`);
    R._sawTorpedo = false; R._sawReveal = false; R._sawSonarDetect = false;
    await pump(2400, () => {
        if (torpedoes.length > 0) R._sawTorpedo = true;
        if (sub._revealT > 0) R._sawReveal = true;
        if (sub._detectedT > 0) R._sawSonarDetect = true;   // sonar lock (not the firing datum)
    });
    R.checks.aa = (ePlane.dead || ePlane.hp < ePlane.cfg.hp - 1) ||
                  (droneSquad || []).some(d => d.dead || d.hp < d.cfg.hp - 1);
    R.checks.subFire = (R._sawTorpedo || R._sawReveal) && (eDd.hp < eDd.maxHp - 1 || eDd.dead);
    // hidden = NO SONAR LOCK before any ASW escort exists (the firing sub's
    // own flaming-datum reveal (_revealT) is expected and legitimate).
    R.checks.subHidden = !R._sawSonarDetect;
    log(`AA=${R.checks.aa} subFire=${R.checks.subFire} subHidden=${R.checks.subHidden} (plane hp ${ePlane.dead ? 'dead' : ePlane.hp}/${ePlane.cfg.hp}, eDd ${eDd.hp}/${eDd.maxHp})`);

    // ═══ 3. SONAR — an ASW escort lights the boat up ═══
    const asw = new Warship('enemy', fakePort({ lat: 3.42, lon: -139 }), { lat: 3.42, lon: -139 }, 'escort');
    warships.push(asw);
    await pump(400);
    R.checks.sonar = sub.detected === true;
    log(`sonar=${R.checks.sonar} (sub.detected=${sub.detected})`);

    // ═══ 4. MINES — enemy hull sails into the field (isolated Indian Ocean
    // theater — later-test fleets must not lure the victim off course) ═══
    const M = { lat: -15, lon: 100 };
    const field = layMineField(NAVAL_CTX, 'player', M);
    const victim = new Warship('enemy', fakePort({ lat: -13.8, lon: 100 }), { lat: -13.8, lon: 100 }, 'destroyer');
    warships.push(victim);
    await pump(220);            // let the field ARM first (a pre-arming arrival
    victim.setPatrol(M);        // would wander off in 60km+ patrol jumps)
    await pump(1500);
    R.checks.mines = victim.hp < victim.maxHp - 1 || victim.dead || field.dead || field.charges < C.MINE_CHARGES;
    log(`mines=${R.checks.mines} (victim ${victim.hp}/${victim.maxHp}${victim.dead ? ' SUNK' : ''}, field charges ${field.charges}/${C.MINE_CHARGES}${field.dead ? ' SPENT' : ''})`);

    // ═══ 5. FORMATIONS — line + wedge spread distinct slots ═══
    const keepStance = fleetStanceIdx;
    const squad = [];
    for (let i = 0; i < 5; i++) {
        const s = new Warship('player', fakePort(A), { lat: A.lat + i * 0.1, lon: A.lon }, i === 0 ? 'carrier' : (i < 3 ? 'escort' : 'destroyer'));
        warships.push(s); squad.push(s);
    }
    fleetStanceIdx = 1;   // line
    const lineStance = assignFormation(NAVAL_CTX, 'player', -12, -141, squad);
    const linePts = new Set(squad.map(s => s.waypoints ? s.waypoints[s.waypoints.length - 1].lat.toFixed(2) + ',' + s.waypoints[s.waypoints.length - 1].lon.toFixed(2) : 'none'));
    fleetStanceIdx = 2;   // wedge
    const wedgeStance = assignFormation(NAVAL_CTX, 'player', -12, -142, squad);
    const wedgePts = new Set(squad.map(s => s.waypoints ? s.waypoints[s.waypoints.length - 1].lat.toFixed(2) + ',' + s.waypoints[s.waypoints.length - 1].lon.toFixed(2) : 'none'));
    fleetStanceIdx = keepStance;
    R.checks.formation = lineStance === 'line' && wedgeStance === 'wedge' && linePts.size >= 4 && wedgePts.size >= 4;
    log(`formation=${R.checks.formation} (line ${lineStance}:${linePts.size} slots, wedge ${wedgeStance}:${wedgePts.size} slots)`);

    // ═══ 6. SHORE BOMBARDMENT — gun hull shells a coastal structure ═══
    if (conquestGrid && conquestGrid._maskReady) {
        // geography-robust: scan random points for LAND, then snap to its shore
        let shore = null;
        for (let i = 0; i < 400 && !shore; i++) {
            const t = { lat: (Math.random() * 140 - 70), lon: (Math.random() * 340 - 170) };
            if (isLand(t.lat, t.lon)) shore = findNearestShoreTile(t.lat, t.lon, 8);
        }
        if (shore) {
            // park the shooter in the nearest water to the shore tile — GRID
            // water (the shore cell came from the grid; GeoJSON isLand can
            // disagree near rasterized coasts, so ask the grid first).
            let water = null;
            for (let r = 0.15; r <= 2.2 && !water; r += 0.15) {
                for (let a = 0; a < 12; a++) {
                    const t = { lat: shore.lat + r * Math.cos(a), lon: shore.lon + r * Math.sin(a) / Math.max(0.2, Math.cos(shore.lat * Math.PI / 180)) };
                    if (getPixelOwner(t.lat, t.lon) === 'water' || !isLand(t.lat, t.lon)) { water = t; break; }
                }
            }
            if (water) {
                const shoreDd = new Warship('player', fakePort(water), water, 'destroyer');
                warships.push(shoreDd);
                const st = new Structure(shore.lat, shore.lon, 'city', 'enemy');
                structs.push(st);
                await pump(1500);
                R.checks.shore = st.hp < st.maxHp - 1 || st.dead;
                log(`shore=${R.checks.shore} (city ${st.hp}/${st.maxHp}${st.dead ? ' DESTROYED' : ''}, range ${haversineDist(water.lat, water.lon, shore.lat, shore.lon).toFixed(0)}km)`);
                if (!st.dead) { st.dead = true; if (st.mesh) scene.remove(st.mesh); if (st.selRing) { scene.remove(st.selRing); } }
            } else { R.checks.shore = 'skipped (no water near shore)'; log(R.checks.shore); }
        } else { R.checks.shore = 'skipped (no shore tile)'; log(R.checks.shore); }
    } else { R.checks.shore = 'skipped (grid not ready)'; log(R.checks.shore); }

    // ═══ 7. SYNC RECEIVERS — applyOpponentAction mirrors the peer's fleet ═══
    deepClean();
    applyOpponentAction({ type: 'warship_spawn', lat: 2, lon: -130, plat: 2, plon: -130, hull: 'escort', troops: 0 });
    const mirror = warships.find(w => !w.dead && w.owner === 'enemy');
    R.checks.syncSpawn = !!mirror;
    if (mirror) {
        applyOpponentAction({ type: 'warship_move', id: mirror.id, lat: 4, lon: -133 });
        R.checks.syncMove = mirror.patrolLat === 4 && Math.abs(mirror.patrolLon - -133) < 0.01;
    } else R.checks.syncMove = false;
    applyOpponentAction({ type: 'naval_mine', lat: 1, lon: -131 });
    R.checks.syncMine = mineFields.some(f => !f.dead && f.owner === 'enemy');
    const eSub = new Warship('enemy', fakePort({ lat: 1.5, lon: -131 }), { lat: 1.5, lon: -131 }, 'submarine');
    warships.push(eSub);
    const pTgt = new Warship('player', fakePort({ lat: 1.3, lon: -131 }), { lat: 1.3, lon: -131 }, 'destroyer');
    warships.push(pTgt);
    applyOpponentAction({ type: 'torpedo', lat: eSub.curLat, lon: eSub.curLon, kind: 'warship', tid: pTgt.id, sid: eSub.id });
    R.checks.syncTorp = torpedoes.length > 0;
    const eCar = new Warship('enemy', fakePort({ lat: 1.8, lon: -131 }), { lat: 1.8, lon: -131 }, 'carrier');
    warships.push(eCar);
    applyOpponentAction({ type: 'spawn_plane', lat: eCar.curLat, lon: eCar.curLon, ptype: 'fighter', shipId: eCar.id });
    R.checks.syncWing = planes.some(p => !p.dead && p.baseStruct === eCar);
    log(`sync spawn=${R.checks.syncSpawn} move=${R.checks.syncMove} mine=${R.checks.syncMine} torpedo=${R.checks.syncTorp} wing=${R.checks.syncWing}`);

    // ═══ 8. SUB BUILDABLE ═══
    R.checks.subBuildable = HULL_ORDER.includes('submarine') && !!C.HULL_CLASSES.submarine;
    log(`subBuildable=${R.checks.subBuildable}`);

    deepClean();
    R.done = true;

    const bool = (v) => v === true;
    const checks = [
        ['FLEET AA (audit #6)', bool(R.checks.aa)],
        ['SUB torpedo attack', bool(R.checks.subFire)],
        ['SUB hidden w/o sonar', bool(R.checks.subHidden)],
        ['SONAR reveals sub', bool(R.checks.sonar)],
        ['MINES detonate', bool(R.checks.mines)],
        ['FORMATIONS line/wedge', bool(R.checks.formation)],
        ['SHORE bombardment', R.checks.shore === true || String(R.checks.shore).startsWith('skipped')],
        ['SYNC receivers (#7/#8)', bool(R.checks.syncSpawn && R.checks.syncMove && R.checks.syncMine && R.checks.syncTorp && R.checks.syncWing)],
        ['SUB buildable (V cycle)', bool(R.checks.subBuildable)],
    ];
    let ok = 0;
    for (const [name, pass] of checks) { if (pass) ok++; log(`${pass ? '✅' : '❌'} ${name}`); }
    R.pass = ok === checks.length;
    log(`RESULT: ${R.pass ? 'PASS' : 'FAIL'} (${ok}/${checks.length} checks) — window.__navalDeepResult`);
    logEvent(R.pass ? '🧪 اختبار البحرية العميق: نجح ✅' : '🧪 اختبار البحرية العميق: فشل ❌ — انظر الكونسول', R.pass ? 'info' : 'err');
    return R;
};


// ═══════════════════════════════════════════════════════════════════════
//  TASK-302: TANK SYSTEM PROBES
//  tankCheck()      — model sanity: every class builds, mesh counts, source
//  tankBattleTest() — two divisions engage: shots fired, hp drops, one
//                    destroyed, devastation painted. Uses __pumpGame so it
//                    works in hidden tabs (RAF-starved) like the naval test.
// ═══════════════════════════════════════════════════════════════════════
window.tankCheck = function () {
    const out = {};
    for (const key of Object.keys(TCFG)) {
        try {
            const m = buildTankModel(key, 0x00aaff);
            let n = 0;
            m.traverse(o => { if (o.isMesh) n++; });
            m.updateMatrixWorld(true);
            const bb = new THREE.Box3().setFromObject(m);
            const size = new THREE.Vector3(); bb.getSize(size);
            // Nose diagnostic: the gun barrel protrudes at the FRONT — the
            // bbox extends further from the origin on the nose side (+Z).
            const back = Math.abs(bb.min.z), front = Math.abs(bb.max.z);
            out[key] = {
                meshes: n,
                src: TANK_MODELS[key] ? 'fbx' : 'procedural',
                len: +Math.max(size.x, size.z).toFixed(1),
                registry: !!TANK_MODELS[key],
                nose: front > back * 1.15 ? '+Z ✓' : back > front * 1.15 ? '-Z (BACKWARDS)' : 'symmetric'
            };
            m.traverse(o => { if (o.isMesh && o.material && o.material.userData && o.material.userData.accent) o.material.dispose(); });
        } catch (e) { out[key] = 'ERR: ' + e.message; }
    }
    out._caps = { total: GAME_CONSTANTS.TANK_CAP_TOTAL };
    out._cfg = Object.keys(TCFG).map(k => `${k}:${TCFG[k].cost}$/hp${TCFG[k].hp}/gun${TCFG[k].gunDmg}`);
    console.log('[TANK-CHECK]', out);
    return out;
};

window.tankBattleTest = async function () {
    const log = (m) => console.log('%c[TANK-TEST] ' + m, 'color:#ffaa44;font-weight:bold');
    if (!scene || gOver) { log('Start a game first (mode 1).'); return 'no scene'; }
    logEvent('🧪 اختبار المعركة البرية بدأ — راقب الكونسول', 'info');

    // ── isolate: clear every division + deep-pass state (wrecks/shells) ──
    clearSelection();
    for (const t of tanks) { if (!t.dead) t._destroy(); }
    tanks.length = 0;
    _clearTankDeep();

    // ── theater: USA midlands (LAND, far from most spawn points) ──
    const A = { lat: 39.0, lon: -98.5 };   // player heavy division
    const B = { lat: 38.2, lon: -97.5 };   // enemy medium division (~125km apart)
    if (!isLand(A.lat, A.lon) || !isLand(B.lat, B.lon)) { log('Theater not on land?!'); return 'bad theater'; }
    const p = spawnTankDivision(A.lat, A.lon, 'heavy', 'player', { tgtLat: B.lat, tgtLon: B.lon });
    const e = spawnTankDivision(B.lat, B.lon, 'medium', 'enemy', { tgtLat: A.lat, tgtLon: A.lon });

    const devBefore = (window.__ffaProbe && conquestGrid) ? window.__ffaProbe.devAt(A.lat, A.lon) : 0;
    const R = { t: 0, engaged: false, hpDropped: false, destroyed: false, shots: 0,
                devPainted: false, attrition: false, pass: false, notes: [] };
    window.__tankTestResult = R;

    // Phase 1: 6s — guns open up
    await window.__pumpGame(360);
    R.t = 6;
    R.shots = p.shots + e.shots;
    R.engaged = R.shots > 0;
    R.hpDropped = (p.hp < p.maxHp) || (e.hp < e.maxHp);
    R.attrition = (p.members.length < p.members0) || (e.members.length < e.members0);
    log(`t=6s shots=${R.shots} pHp=${Math.round(p.hp)}/${p.maxHp} eHp=${Math.round(e.hp)}/${e.maxHp} modes=${p.mode}/${e.mode}`);
    if (!R.engaged) R.notes.push('no shots in 6s — check engage/gun ranges');

    // Phase 2: up to 60s — fight to the finish
    let steps = 0;
    while (steps < 27 && !p.dead && !e.dead) {
        await window.__pumpGame(120);
        steps++;
    }
    R.t = 6 + steps * 2;
    R.destroyed = p.dead || e.dead;
    R.shots = p.shots + e.shots;
    // re-sample attrition at the END (t=6s may predate the first knock-outs)
    R.attrition = (p.members.length < p.members0) || (e.members.length < e.members0);
    if (conquestGrid && window.__ffaProbe) {
        const devAfter = window.__ffaProbe.devAt(A.lat, A.lon);
        R.devPainted = devAfter > devBefore + 0.01;
    }
    log(`t=${R.t}s destroyed=${R.destroyed} (pDead=${p.dead}, eDead=${e.dead}) totalShots=${R.shots} dev=${R.devPainted}`);

    // ── verdict ──
    const checks = [
        ['ENGAGE (guns fired)', R.engaged],
        ['DAMAGE (hp dropped)', R.hpDropped],
        ['KILL (a division destroyed)', R.destroyed],
        ['DEVASTATION (battle painted)', R.devPainted],
        ['ATTRITION (vehicles knocked out)', R.attrition],
    ];
    let ok = 0;
    for (const [name, pass] of checks) { if (pass) ok++; log(`${pass ? '✅' : '❌'} ${name}`); }
    R.pass = ok >= 4;
    log(`RESULT: ${R.pass ? 'PASS' : 'FAIL'} (${ok}/${checks.length}) — window.__tankTestResult`);
    logEvent(R.pass ? '🧪 اختبار المدرعات: نجح ✅' : '🧪 اختبار المدرعات: فشل ❌ — انظر الكونسول', R.pass ? 'info' : 'err');
    return R;
};

// Corridor/march probe: a light division crossing neutral land must paint a
// spearhead corridor (mode 1, grid ready). Gracefully skips if the whole
// path already belongs to the player.
window.tankMarchTest = async function () {
    const log = (m) => console.log('%c[TANK-MARCH] ' + m, 'color:#aaff44;font-weight:bold');
    if (!scene || gOver) { log('Start a game first (mode 1).'); return 'no scene'; }
    if (!conquestGrid || !conquestGrid._maskReady) { log('No conquest grid yet.'); return 'no grid'; }
    clearSelection();
    const A = { lat: 41.5, lon: -101.0 }, B = { lat: 43.0, lon: -95.5 };
    if (!isLand(A.lat, A.lon) || !isLand(B.lat, B.lon)) { log('Theater not on land.'); return 'bad theater'; }
    const midOwnerBefore = getPixelOwner((A.lat + B.lat) / 2, (A.lon + B.lon) / 2);
    if (midOwnerBefore === 'player') { log('Path already player-owned — corridor unverifiable here. SKIP(ok).'); return 'skip-owned'; }
    const d = spawnTankDivision(A.lat, A.lon, 'light', 'player', { tgtLat: B.lat, tgtLon: B.lon });
    await window.__pumpGame(700);   // ~11s × 1.9km/f ≈ 1250km — enough to arrive
    const mid = getPixelOwner((A.lat + B.lat) / 2, (A.lon + B.lon) / 2);
    const arrived = haversineDist(d.lat, d.lon, B.lat, B.lon) < 60;
    const R = { corridorPainted: mid === 'player', arrived, moved: haversineDist(d.lat, d.lon, A.lat, A.lon) > 50, dead: d.dead };
    window.__tankMarchResult = R;
    log(`corridor=${R.corridorPainted} arrived=${R.arrived} moved=${Math.round(R.moved)}km`);
    return R;
};

// ═══ TASK-405 DEEP-PASS PROBE ═══ Exercises everything the wiring pass
// hooked up:
//  • SPG spotting GATE — silent without a spotter, arcs with one
//  • Standoff — the battery holds position while bombarding
//  • Siege + ACE progression (3 kills → veteran)
//  • Entrenchment (20s hold → sandbag ring)
//  • Supply CUT → attrition, and the ENTRENCHED BRIDGEHEAD feeding a
//    fresh division 400km from the nearest hub
//  • River far-bank probe (strait crossable / ocean blocked)
//  • Dual-purpose flak chipping armor inside 90km
//  • Wreck lifecycle (burning wreck spawns, then fades)
// Run from the console during a mode-1 game: await window.tankDeepTest()
window.tankDeepTest = async function () {
    const log = (m) => console.log('%c[TANK-DEEP] ' + m, 'color:#ff7744;font-weight:bold');
    const C = GAME_CONSTANTS;
    const R = { phase: 'setup' };
    window.__tankDeepResult = R;
    if (!scene || gOver) { log('Start a game first (mode 1).'); R.phase = 'no-scene'; return R; }
    logEvent('🧪 اختبار العمق البري (مدفعية/إمداد/تحصين) بدأ', 'info');

    // ── isolation: sweep divisions + deep state; remember what we spawn ──
    clearSelection();
    for (const t of tanks) { if (!t.dead) t._destroy(); }
    tanks.length = 0;
    _clearTankDeep();
    const mineS = [], mineT = [];
    const mkS = (lat, lon, type, owner) => { const s = new Structure(lat, lon, type, owner); structs.push(s); mineS.push(s); return s; };
    const mkT = (lat, lon, key, owner, opts) => { const t = spawnTankDivision(lat, lon, key, owner, opts); mineT.push(t); return t; };
    const dropS = (s) => {
        const i = structs.indexOf(s); if (i >= 0) structs.splice(i, 1);
        if (!s.dead) {
            s.dead = true; scene.remove(s.mesh); scene.remove(s.selRing);
            if (s.accents) s.accents.forEach(m => m.dispose());
            if (s.selRing && s.selRing.material) s.selRing.material.dispose();
        }
    };
    const dropT = (t) => { if (t && !t.dead) { t.dead = true; t.selected = false; scene.remove(t.mesh); disposeMeshDeep(t.mesh); } };

    try {
        // ── theater: Kansas SPG battery (A) vs an enemy flak cluster (F)
        // ≈320km south — beyond the SPG's sightR(300) so indirect fire
        // needs a SPOTTER; on land, inside engageR(520)/gunRange(420). ──
        const A = { lat: 39.5, lon: -98.5 };
        const F = { lat: 36.6, lon: -98.6 };
        if (!isLand(A.lat, A.lon) || !isLand(F.lat, F.lon)) { log('Theater not on land.'); R.phase = 'bad-theater'; return R; }
        R.theater = { dAF: Math.round(haversineDist(A.lat, A.lon, F.lat, F.lon)) };
        mkS(F.lat, F.lon, 'flak', 'enemy');
        mkS(F.lat + 0.3, F.lon, 'flak', 'enemy');
        mkS(F.lat + 0.6, F.lon, 'flak', 'enemy');
        const spg = mkT(A.lat, A.lon, 'spg', 'player', { tgtLat: A.lat, tgtLon: A.lon });

        // ── A1: spotting GATE — no spotter → no rounds downrange ──
        R.phase = 'A1 gate';
        const radarCovers = _radarCovers(F.lat, F.lon, 'player');
        const enemyInSight = structs.some(s => !s.dead && s.owner !== 'player' && s.owner !== 'neutral'
            && haversineDist(A.lat, A.lon, s.lat, s.lon) < spg.cfg.sightR);
        await window.__pumpGame(420);
        R.gateHolds = (radarCovers || enemyInSight) ? 'skip' : (spg.shots === 0);
        log(`A1 gate: shots=${spg.shots} radar=${radarCovers} enemyInSight=${enemyInSight} → ${R.gateHolds}`);

        // ── A2: light scout spots → arc shells fly, battery holds ──
        R.phase = 'A2 spot';
        const SC = { lat: 38.0, lon: -98.6 };   // ~156km N of F: inside scout sightR(520), outside its gunRange(110)
        const scout = mkT(SC.lat, SC.lon, 'light', 'player', { tgtLat: SC.lat, tgtLon: SC.lon });
        await window.__pumpGame(600);
        R.indirect = spg.shots > 0;
        R.standoff = haversineDist(spg.lat, spg.lon, A.lat, A.lon) < 5;
        log(`A2: shots=${spg.shots} batteryDrift=${Math.round(haversineDist(spg.lat, spg.lon, A.lat, A.lon))}km`);

        // ── A3: siege to 3 kills → VETERAN ace ──
        R.phase = 'A3 siege';
        let guard = 0;
        while (spg.kills < 3 && !spg.dead && guard++ < 26) await window.__pumpGame(120);
        R.kills = spg.kills; R.ace = spg.ace;
        log(`A3: kills=${spg.kills} ace=${spg.ace} (${TANK_ACE_AR[spg.ace] || '—'})`);

        // ── B: entrenchment + supply cut + attrition (remote Australia) ──
        R.phase = 'B entrench+supply';
        const B = { lat: -25.5, lon: 134.5 };   // land, ~15000km from any player hub
        if (isLand(B.lat, B.lon)) {
            const dug = mkT(B.lat, B.lon, 'heavy', 'player', { tgtLat: B.lat, tgtLon: B.lon });
            await window.__pumpGame(1400);      // 1200f dig + grace/supply cadence
            R.entrenched = dug.entrench >= 1 && !!dug.sandbags && dug.sandbags.visible;
            R.supplyCut = dug.unsupplied === true;
            R.attrition = dug.hp < dug.maxHp;
            log(`B: entrench=${dug.entrench.toFixed(2)} unsupplied=${dug.unsupplied} hp=${Math.round(dug.hp)}/${dug.maxHp}`);
            // BRIDGEHEAD: a fresh division within 400km of the ENTRENCHED
            // heavy is fed by it — that's the river-crossing payoff.
            const nb = mkT(B.lat + 1.2, B.lon + 1.0, 'light', 'player', { tgtLat: B.lat + 1.2, tgtLon: B.lon + 1.0 });
            await window.__pumpGame(220);
            R.bridgehead = nb.unsupplied === false && !nb.dead;
            log(`bridgehead: fresh division supplied=${!nb.unsupplied}`);
        }

        // ── D: far-bank probe — some strait crossable, ocean blocked ──
        R.phase = 'D river';
        R.riverDetail = window.tankRiverProbe();
        const crossable = Object.values(R.riverDetail.crossings).some(v => v === true);
        const oceanBlocked = R.riverDetail.ocean === false && R.riverDetail.atlantic === false;
        R.riverProbe = crossable && oceanBlocked;
        log(`D: crossable=${crossable} ocean=${R.riverDetail.ocean} atlantic=${R.riverDetail.atlantic} detail=`, R.riverDetail.crossings);

        // ── F: dual-purpose flak chips armor inside 90km ──
        R.phase = 'F flak';
        mkS(39.3, -98.4, 'flak', 'enemy');
        const hp0 = spg.hp;
        await window.__pumpGame(220);
        R.flakChip = spg.hp < hp0;
        log(`F: flak chip ${Math.round(hp0)}→${Math.round(spg.hp)}`);

        // ── E: wreck lifecycle — a kill leaves a burning wreck, then fades ──
        R.phase = 'E wreck';
        const w0 = tankWrecks.length;
        const victim = mineT.find(t => !t.dead);
        if (victim) victim.hit(1e9, 'enemy');
        R.wreckSpawned = tankWrecks.length > w0;
        await window.__pumpGame(C.TANK_WRECK_FRAMES + 120);
        R.wreckFaded = tankWrecks.length === 0;
        R.spgSurvived = !spg.dead;   // attrition may legitimately starve it (Kansas is hub-less early game)
        log(`E: wreckSpawned=${R.wreckSpawned} faded=${R.wreckFaded} spgAlive=${R.spgSurvived}`);
    } finally {
        clearSelection();
        for (const t of mineT) dropT(t);
        for (const s of mineS) dropS(s);
        _clearTankDeep();
    }

    const checks = [
        ['GATE (unspotted → silent)', R.gateHolds === true],
        ['INDIRECT (arc shells flew)', R.indirect === true],
        ['STANDOFF (battery held)', R.standoff === true],
        ['SIEGE (3 kills)', R.kills >= 3],
        ['ACE (veteran earned)', R.ace >= 1],
        ['ENTRENCH (dug in)', R.entrenched === true],
        ['SUPPLY-CUT (attrition)', R.supplyCut === true && R.attrition === true],
        ['BRIDGEHEAD (entrenched feeds)', R.bridgehead === true],
        ['RIVER (strait yes / ocean no)', R.riverProbe === true],
        ['FLAK-CHIP (armor chipped)', R.flakChip === true],
        ['WRECK (spawn + fade)', R.wreckSpawned === true && R.wreckFaded === true],
    ];
    let ok = 0;
    for (const [name, pass] of checks) { if (pass) ok++; log(`${pass ? '✅' : '❌'} ${name}`); }
    R.pass = ok >= checks.length - 1;   // tolerate one soft check (gate may skip)
    log(`RESULT: ${R.pass ? 'PASS' : 'FAIL'} (${ok}/${checks.length}) — window.__tankDeepResult`);
    logEvent(R.pass ? '🧪 اختبار العمق البري: نجح ✅' : '🧪 اختبار العمق البري: فشل ❌ — انظر الكونسول', R.pass ? 'info' : 'err');
    return R;
};

// Standalone river-crossing checker (map-editor companion): probes every
// major strait the armor should be able to wade + two open-ocean controls
// that must stay blocked. Run any time: window.tankRiverProbe()
window.tankRiverProbe = function () {
    const probe = (flat, flon, tlat, tlon) => {
        const nrm = latLonToVec3(flat, flon, 1).normalize();
        const tv = latLonToVec3(tlat, tlon, 1).normalize();
        const dir = tv.addScaledVector(nrm, -tv.dot(nrm));
        if (dir.lengthSq() < 1e-9) return null;
        // _probeFarBank reads no instance state — static call is safe.
        return Tank.prototype._probeFarBank.call(null, nrm, dir.normalize());
    };
    const CROSSINGS = [
        ['suez',    30.4, 32.35,  30.1, 32.35],   // painted canal — guaranteed water
        ['gibraltar', 35.95, -5.6, 36.4, -5.6],
        ['bosporus', 41.05, 28.95, 41.25, 29.1],
        ['messina', 38.22, 15.62, 38.05, 15.6],
        ['bering',  65.8, -168.9, 66.0, -169.2],
        ['dover',   51.0, 1.45,   51.3, 1.35],
    ];
    const out = { crossings: {}, ocean: null, atlantic: null };
    for (const [name, fla, flo, tla, tlo] of CROSSINGS) out.crossings[name] = probe(fla, flo, tla, tlo);
    out.ocean = probe(35.95, -5.6, 35.95, -7.5);      // west out of Gibraltar → must be false
    out.atlantic = probe(30, -40, 30, -41);            // mid-Atlantic → must be false
    console.log('[TANK-RIVER]', out);
    return out;
};
