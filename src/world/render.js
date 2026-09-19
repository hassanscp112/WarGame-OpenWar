// ════════════════════════════════════════════════════════════════════
//  TASK-406 — WORLD RENDER LAYER (extracted from main.js)
//  Everything that paints CONQUEST state onto the globe:
//    · territory overlay upload pipeline (downscaled 2048×1024 canvas,
//      now with SUB-RECT blits from the grid's shared dirty-region queue)
//    · crisp vector frontier lines (150ms throttle, preserved)
//    · devastation VISUAL layer — scorched tint that fades with decay
//    · capture FLASH — short-lived bright points on freshly flipped cells
//    · frontline HEAT glow — pulsing additive line over recent combat
//    · drone selection rings (selection feedback for TASK-204 drones)
//  Extracted per TASK-406 REFACTOR: "grid painting + frontier-line
//  rebuild out of main.js into src/world/" (the great main.js split is
//  TASK-407; this is the world-feature slice of it).
// ════════════════════════════════════════════════════════════════════
import { CONQUEST_CFG } from '../core/conquest.js';

const OVERLAY_TEX_W = 2048, OVERLAY_TEX_H = 1024;
const _D2R = Math.PI / 180;

export function createWorldRender(deps) {
  // deps (all lazy getters — bound before scene/grid exist):
  //   grid() → ConquestGrid | null     scene() → THREE.Scene | null
  //   bots() → bot[]                    R() → EARTH_RADIUS
  //   latLonToVec3(lat, lon, r)         ownerHexColor(ownerStr) → 0xRRGGBB
  //   hideTerritoryMesh()               (legacy mode-2 mesh hide on overlay creation)
  const S = {
    // territory overlay pipeline
    overlayCanvas: null, overlayCtx: null, lastUpload: 0, overlayPending: false,
    texture: null, overlayMesh: null,
    // frontier lines
    frontierLine: null, lastFL: 0, flPending: false,
    // devastation overlay
    devCanvas: null, devCtx: null, devTexture: null, devMesh: null, lastDevUp: 0,
    // capture flashes
    flashPoints: null, flashIdx: 0, flashT0: 0,
    FLASH_MAX: 512, FLASH_LIFE_F: 48,
    // frontline heat
    heatLine: null,
    // drone selection rings
    droneRings: new Map(),   // drone.id → ring mesh
  };
  const THREEref = () => window.THREE || (typeof THREE !== 'undefined' ? THREE : null);

  // ── territory overlay upload ─────────────────────────────────────────
  // Consumes the grid's shared dirty-region queue: full blit on full repaint,
  // sub-rect blit for incremental conquest ticks (the old path re-drew the
  // whole 7200×3600 source every 100ms; the sub-rect is sub-millisecond).
  function _uploadOverlay(force) {
    const now = performance.now();
    if (!force && now - S.lastUpload < 100) { S.overlayPending = true; return false; }
    S.overlayPending = false;
    S.lastUpload = now;
    const grid = deps.grid();
    if (!grid) return false;
    if (!S.overlayCanvas) {
      S.overlayCanvas = document.createElement('canvas');
      S.overlayCanvas.width = OVERLAY_TEX_W;
      S.overlayCanvas.height = OVERLAY_TEX_H;
      S.overlayCtx = S.overlayCanvas.getContext('2d');
      S.overlayCtx.imageSmoothingEnabled = true;
      if (typeof window !== 'undefined') window.__overlayCanvas = S.overlayCanvas;   // debug handle (kept)
    }
    const src = grid.getCanvas();
    const rect = grid.takeOverlayRect();   // undefined=none · null=full · {x,y,w,h}
    const sx = OVERLAY_TEX_W / grid.cfg.GRID_W;
    const sy = OVERLAY_TEX_H / grid.cfg.GRID_H;
    if (rect && rect !== null) {
      // incremental: blit ONLY the changed sub-rect (canvas content persists)
      S.overlayCtx.drawImage(src,
        rect.x, rect.y, rect.w, rect.h,
        rect.x * sx, rect.y * sy, Math.max(1, rect.w * sx), Math.max(1, rect.h * sy));
    } else {
      // full repaint (or first paint with no pending rect)
      S.overlayCtx.clearRect(0, 0, OVERLAY_TEX_W, OVERLAY_TEX_H);
      S.overlayCtx.drawImage(src, 0, 0, OVERLAY_TEX_W, OVERLAY_TEX_H);
    }
    return true;
  }

  // ── main per-frame territory sync (was renderMode1Territory in main.js) ──
  function tickTerritory() {
    const THREE = THREEref();
    const grid = deps.grid();
    const scene = deps.scene();
    if (!grid || !scene || !THREE) return;
    const changed = grid.flushRender();

    // territory overlay texture (re)bind
    let repainted = false;
    if (changed) repainted = _uploadOverlay(false);
    else if (S.overlayPending) repainted = _uploadOverlay(false);   // retry throttled upload
    const texSource = S.overlayCanvas || grid.getCanvas();
    if (!S.texture || S.texture.image !== texSource) {
      // REBIND whenever the underlying display canvas changed (fresh grid after
      // a failed-spawn retry) — the overlay must never point at a dead canvas.
      if (S.texture) S.texture.dispose();
      _uploadOverlay(true);
      S.texture = new THREE.CanvasTexture(texSource);
      S.texture.wrapS = THREE.RepeatWrapping;
      S.texture.wrapT = THREE.ClampToEdgeWrapping;
      S.texture.colorSpace = THREE.SRGBColorSpace;
      S.texture.magFilter = THREE.NearestFilter;   // hard pixel edges on fills
      S.texture.minFilter = THREE.LinearFilter;
      S.texture.generateMipmaps = false;
      repainted = true;
    }
    if (!S.overlayMesh) {
      const geo = new THREE.SphereGeometry(deps.R() + 2.0, 256, 128);
      const mat = new THREE.MeshBasicMaterial({
        map: S.texture, transparent: true, depthWrite: false, side: THREE.FrontSide
      });
      S.overlayMesh = new THREE.Mesh(geo, mat);
      S.overlayMesh.renderOrder = 1;
      scene.add(S.overlayMesh);
      deps.hideTerritoryMesh();   // legacy country-fill overlay retired in mode1
    } else if (S.overlayMesh.material.map !== S.texture) {
      S.overlayMesh.material.map = S.texture;
      S.overlayMesh.material.needsUpdate = true;
    }
    if (repainted && S.texture) S.texture.needsUpdate = true;

    // ── devastation VISUAL layer (scorch) ──
    if (grid.hasDevDirty()) {
      const now = performance.now();
      if (now - S.lastDevUp >= 100) {
        S.lastDevUp = now;
        if (grid.flushDevastationRender()) _uploadDevastation(scene, THREE);
      }
    }

    // ── vector frontier lines — throttled to every 150ms ──
    if (changed) {
      const now = performance.now();
      if (now - S.lastFL >= 150) { S.lastFL = now; S.flPending = false; rebuildFrontierLines(); }
      else S.flPending = true;
    }
    if (S.flPending && performance.now() - S.lastFL >= 150) {
      S.lastFL = performance.now();
      S.flPending = false;
      rebuildFrontierLines();
    }
  }

  // ── devastation overlay: scorch canvas → downscaled texture → sphere ──
  function _uploadDevastation(scene, THREE) {
    const grid = deps.grid();
    if (!grid) return;
    if (!S.devCanvas) {
      S.devCanvas = document.createElement('canvas');
      S.devCanvas.width = OVERLAY_TEX_W;
      S.devCanvas.height = OVERLAY_TEX_H;
      S.devCtx = S.devCanvas.getContext('2d');
      S.devTexture = new THREE.CanvasTexture(S.devCanvas);
      S.devTexture.wrapS = THREE.RepeatWrapping;
      S.devTexture.wrapT = THREE.ClampToEdgeWrapping;
      S.devTexture.colorSpace = THREE.SRGBColorSpace;
      S.devTexture.magFilter = THREE.LinearFilter;
      S.devTexture.minFilter = THREE.LinearFilter;
      S.devTexture.generateMipmaps = false;
      const geo = new THREE.SphereGeometry(deps.R() + 1.0, 128, 64);
      const mat = new THREE.MeshBasicMaterial({
        map: S.devTexture, transparent: true, depthWrite: false, side: THREE.FrontSide
      });
      S.devMesh = new THREE.Mesh(geo, mat);
      S.devMesh.renderOrder = 0.5;   // above the biome globe, under territory fills
      scene.add(S.devMesh);
    }
    S.devCtx.clearRect(0, 0, OVERLAY_TEX_W, OVERLAY_TEX_H);
    S.devCtx.drawImage(grid.getDevastationCanvas(), 0, 0, OVERLAY_TEX_W, OVERLAY_TEX_H);
    S.devTexture.needsUpdate = true;
  }

  // ── crisp vector territory borders (was rebuildFrontierLines in main.js) ──
  function rebuildFrontierLines() {
    const THREE = THREEref();
    const grid = deps.grid();
    const scene = deps.scene();
    if (!grid || !scene || !THREE) return;
    const { segs, own } = grid.getFrontierEdges();
    const n = own.length;
    if (n === 0) { if (S.frontierLine) S.frontierLine.visible = false; return; }

    const R = deps.R() + 3.0;   // just above the overlay (+2.0) — never z-fights
    const positions = new Float32Array(n * 6);
    const colors = new Float32Array(n * 6);
    const pCol = CONQUEST_CFG.COLOR.player, eCol = CONQUEST_CFG.COLOR.enemy;
    const PLAYER = CONQUEST_CFG.PLAYER, ENEMY = CONQUEST_CFG.ENEMY;
    const bots = deps.bots();
    for (let i = 0; i < n; i++) {
      const lat1 = segs[i * 4], lon1 = segs[i * 4 + 1];
      const lat2 = segs[i * 4 + 2], lon2 = segs[i * 4 + 3];
      let phi = (90 - lat1) * _D2R, th = (lon1 + 180) * _D2R, sp = Math.sin(phi);
      positions[i * 6]     = -(R * sp * Math.cos(th));
      positions[i * 6 + 1] = R * Math.cos(phi);
      positions[i * 6 + 2] = R * sp * Math.sin(th);
      phi = (90 - lat2) * _D2R; th = (lon2 + 180) * _D2R; sp = Math.sin(phi);
      positions[i * 6 + 3] = -(R * sp * Math.cos(th));
      positions[i * 6 + 4] = R * Math.cos(phi);
      positions[i * 6 + 5] = R * sp * Math.sin(th);
      let cr, cg, cb;
      if (own[i] === PLAYER) { cr = pCol[0]; cg = pCol[1]; cb = pCol[2]; }
      else if (own[i] === ENEMY) { cr = eCol[0]; cg = eCol[1]; cb = eCol[2]; }
      else {
        const b = bots.find(bb => bb.code === own[i]);
        if (b) { cr = b.colorRGB[0]; cg = b.colorRGB[1]; cb = b.colorRGB[2]; }
        else { cr = 20; cg = 20; cb = 24; }
      }
      cr = (cr * 0.45) / 255; cg = (cg * 0.45) / 255; cb = (cb * 0.45) / 255;
      colors[i * 6] = cr; colors[i * 6 + 1] = cg; colors[i * 6 + 2] = cb;
      colors[i * 6 + 3] = cr; colors[i * 6 + 4] = cg; colors[i * 6 + 5] = cb;
    }

    if (!S.frontierLine) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
      S.frontierLine = new THREE.LineSegments(geo, mat);
      S.frontierLine.renderOrder = 2;   // above the territory overlay (1)
      scene.add(S.frontierLine);
    }
    // Dispose the OLD geometry — GL buffers are only freed by dispose()
    S.frontierLine.geometry.dispose();
    const geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo2.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    S.frontierLine.geometry = geo2;
    S.frontierLine.geometry.computeBoundingSphere();
    S.frontierLine.visible = true;
  }

  // ── capture FLASH points ─────────────────────────────────────────────
  // Fixed pool of 512 points, ring-buffer spawn; shader fades by age.
  function _ensureFlashPoints(scene, THREE) {
    if (S.flashPoints) return;
    const MAX = S.FLASH_MAX;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX * 3);
    const birth = new Float32Array(MAX);
    const col = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) { birth[i] = -1e9; pos[i * 3 + 1] = 1e9; }   // hidden
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uNow: { value: 0 },
        uLife: { value: S.FLASH_LIFE_F * 16.67 },   // frames → ms
        uSize: { value: 9.0 },
      },
      vertexShader: `
        attribute float aBirth;
        attribute vec3 aColor;
        uniform float uNow, uLife, uSize;
        varying float vA;
        varying vec3 vC;
        void main() {
          float age = uNow - aBirth;
          float t = clamp(age / uLife, 0.0, 1.0);
          vA = (age < 0.0 || t >= 1.0) ? 0.0 : (1.0 - t);
          vC = mix(vec3(1.0), aColor, t);   // white-hot → owner color
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (1.0 + t * 0.8) * (300.0 / max(1.0, -mv.z)) * 10.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        varying vec3 vC;
        void main() {
          if (vA <= 0.01) discard;
          gl_FragColor = vec4(vC, vA * 0.85);
        }`,
      transparent: true, depthWrite: false,
    });
    S.flashPoints = new THREE.Points(geo, mat);
    S.flashPoints.frustumCulled = false;
    S.flashPoints.renderOrder = 3;
    S.flashT0 = performance.now();
    scene.add(S.flashPoints);
  }

  // Called from conquestCtx.onConquerCell — spawn one flash at the flipped cell.
  function onCellConquered(cell, ownerStr) {
    const THREE = THREEref();
    const grid = deps.grid();
    const scene = deps.scene();
    if (!grid || !scene || !THREE) return;
    _ensureFlashPoints(scene, THREE);
    const ll = grid.cellToLatLon(cell);
    const v = deps.latLonToVec3(ll.lat, ll.lon, deps.R() + 2.5);
    let hex = ownerStr === 'player' ? 0x00ff88 : (ownerStr === 'neutral' ? 0xbdbdbd : deps.ownerHexColor(ownerStr));
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const i = S.flashIdx;
    S.flashIdx = (S.flashIdx + 1) % S.FLASH_MAX;
    const pos = S.flashPoints.geometry.attributes.position;
    const birth = S.flashPoints.geometry.attributes.aBirth;
    const col = S.flashPoints.geometry.attributes.aColor;
    pos.setXYZ(i, v.x, v.y, v.z);
    birth.setX(i, performance.now() - S.flashT0);
    col.setXYZ(i, r, g, b);
    pos.needsUpdate = birth.needsUpdate = col.needsUpdate = true;
  }

  // ── frontline HEAT glow — pulsing additive line over recent combat ──
  function _updateHeatLine(scene, THREE) {
    const grid = deps.grid();
    const segs = grid ? grid.getHotEdges() : null;
    const n = segs ? segs.length / 4 : 0;
    if (!n) { if (S.heatLine) S.heatLine.visible = false; return; }
    if (!S.heatLine) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffb347, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      S.heatLine = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      S.heatLine.renderOrder = 3;
      S.heatLine.frustumCulled = false;
      scene.add(S.heatLine);
    }
    const R = deps.R() + 4.0;   // above the frontier lines (+3)
    const positions = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const lat1 = segs[i * 4], lon1 = segs[i * 4 + 1];
      const lat2 = segs[i * 4 + 2], lon2 = segs[i * 4 + 3];
      let phi = (90 - lat1) * _D2R, th = (lon1 + 180) * _D2R, sp = Math.sin(phi);
      positions[i * 6]     = -(R * sp * Math.cos(th));
      positions[i * 6 + 1] = R * Math.cos(phi);
      positions[i * 6 + 2] = R * sp * Math.sin(th);
      phi = (90 - lat2) * _D2R; th = (lon2 + 180) * _D2R; sp = Math.sin(phi);
      positions[i * 6 + 3] = -(R * sp * Math.cos(th));
      positions[i * 6 + 4] = R * Math.cos(phi);
      positions[i * 6 + 5] = R * sp * Math.sin(th);
    }
    S.heatLine.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    S.heatLine.geometry = geo;
    S.heatLine.visible = true;
  }

  // ── drone selection rings (TASK-406 audit #15 companion) ────────────
  function updateDroneRings(drones, frame) {
    const THREE = THREEref();
    const scene = deps.scene();
    if (!scene || !THREE) return;
    const alive = new Set();
    for (const d of drones) {
      if (d.dead || !d.selected) continue;
      alive.add(d.id);
      let ring = S.droneRings.get(d.id);
      if (!ring) {
        const geo = new THREE.RingGeometry(3.2, 4.2, 24);
        const mat = new THREE.MeshBasicMaterial({
          color: 0x00ffcc, transparent: true, opacity: 0.85,
          side: THREE.DoubleSide, depthWrite: false,
        });
        ring = new THREE.Mesh(geo, mat);
        ring.renderOrder = 3;
        scene.add(ring);
        S.droneRings.set(d.id, ring);
      }
      if (d.pos) {
        ring.position.copy(d.pos);
        ring.lookAt(0, 0, 0);
      }
      ring.material.opacity = 0.55 + 0.3 * Math.sin(frame * 0.15);
    }
    for (const [id, ring] of S.droneRings) {
      if (!alive.has(id)) {
        scene.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
        S.droneRings.delete(id);
      }
    }
  }

  // ── per-game-frame VFX upkeep (flashes age, heat pulses) ────────────
  function tickVfx(frame) {
    const THREE = THREEref();
    const scene = deps.scene();
    if (!scene || !THREE) return;
    if (S.flashPoints) S.flashPoints.material.uniforms.uNow.value = performance.now() - S.flashT0;
    if (frame % 20 === 0) _updateHeatLine(scene, THREE);
    if (S.heatLine && S.heatLine.visible) {
      S.heatLine.material.opacity = 0.30 + 0.25 * Math.sin(frame * 0.12);
    }
  }

  // ── full reset (called from cleanupTerritory — initWorld + backToMenu) ──
  function reset() {
    const scene = deps.scene();
    if (scene) {
      if (S.overlayMesh) {
        scene.remove(S.overlayMesh);
        S.overlayMesh.geometry.dispose();
        S.overlayMesh.material.dispose();
      }
      if (S.devMesh) {
        scene.remove(S.devMesh);
        S.devMesh.geometry.dispose();
        S.devMesh.material.dispose();
      }
      if (S.frontierLine) {
        scene.remove(S.frontierLine);
        S.frontierLine.geometry.dispose();
        S.frontierLine.material.dispose();
      }
      if (S.flashPoints) {
        scene.remove(S.flashPoints);
        S.flashPoints.geometry.dispose();
        S.flashPoints.material.dispose();
      }
      if (S.heatLine) {
        scene.remove(S.heatLine);
        S.heatLine.geometry.dispose();
        S.heatLine.material.dispose();
      }
      for (const [, ring] of S.droneRings) {
        scene.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
      }
    }
    S.droneRings.clear();
    if (S.texture) S.texture.dispose();
    if (S.devTexture) S.devTexture.dispose();
    S.texture = null; S.devTexture = null;
    S.overlayMesh = null; S.devMesh = null; S.frontierLine = null;
    S.flashPoints = null; S.heatLine = null;
    S.lastUpload = 0; S.lastFL = 0; S.lastDevUp = 0;
    S.overlayPending = false; S.flPending = false;
    S.devCanvas = null; S.devCtx = null; S.overlayCanvas = null; S.overlayCtx = null;
  }

  return { tickTerritory, rebuildFrontierLines, onCellConquered, tickVfx, updateDroneRings, reset, state: S };
}
