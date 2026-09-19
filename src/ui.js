// ════════════════════════════════════════════════════════════════════════
//  NEW UI — OpenFront-style radial command menu + modern HUD glue.
//  Right-click the globe → context radial menu (two rings, center action).
//  Geometry/design ported from OpenFrontIO src/client/hud/layers/RadialMenu.ts
//  (main ring r40-95, submenu r75-140, padAngle 0.03, first slice at 12
//  o'clock, fills @0.82 opacity, center button r30, 240ms submenu zoom).
// ════════════════════════════════════════════════════════════════════════

const UI = (() => {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // OpenFront palette (RadialMenuElements.ts)
    const COL = {
        attack: '#ef4444', boat: '#2a82c9', build: '#e6c74a', building: '#1e3a5f',
        info: '#475569', research: '#a855f7', plane: '#38bdf8', missile: '#f97316',
        sam: '#22d3ee', center: '#0f2744', disabled: '#808080', fallback: '#1e3a5f',
        back: '#0f2744'
    };

    let overlay = null;       // fullscreen click-catcher
    let svg = null;           // radial svg
    let svgRoot = null;       // <g> translated to the svg center — all rings draw around (0,0)
    let menuX = 0, menuY = 0; // last client point the menu opened at
    let openedAt = 0;         // timestamp — Windows fires contextmenu AFTER mouseup,
                              // which would instantly close the just-opened menu
    let tooltip = null;
    let open = false;
    let reopenCooldownUntil = 0;
    let ctx = null;           // { x, y, lat, lon, tileOwner, isOwn, isWater, hasStructure, struct }
    let menuStack = [];       // submenu navigation
    let centerBtn = null;

    // ── tiny helpers ─────────────────────────────────────────────────────
    const el = (tag, attrs, parent) => {
        const node = tag === 'svg' || ['g', 'path', 'circle', 'text', 'defs', 'filter', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'linearGradient', 'stop'].includes(tag)
            ? document.createElementNS(SVG_NS, tag)
            : document.createElement(tag);
        if (attrs) for (const k in attrs) {
            if (k === 'text') node.textContent = attrs[k];
            else node.setAttribute(k, attrs[k]);
        }
        if (parent) parent.appendChild(node);
        return node;
    };
    const api = () => window.__UI_API || {};

    function polar(cx, cy, r, ang) {
        return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) };
    }
    // Pie-slice path (equal segments, padAngle gap, first slice centered top)
    function slicePath(cx, cy, r0, r1, a0, a1) {
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        const p0 = polar(cx, cy, r1, a0), p1 = polar(cx, cy, r1, a1);
        const p2 = polar(cx, cy, r0, a1), p3 = polar(cx, cy, r0, a0);
        return `M${p0.x},${p0.y} A${r1},${r1} 0 ${large} 1 ${p1.x},${p1.y} L${p2.x},${p2.y} A${r0},${r0} 0 ${large} 0 ${p3.x},${p3.y} Z`;
    }

    // ── toast system (mirrors legacy hidden message sinks) ──────────────
    const toastBox = () => {
        let b = document.getElementById('toastBox');
        if (!b) {
            b = el('div', { id: 'toastBox' });
            document.body.appendChild(b);
        }
        return b;
    };
    function toast(text, kind = 'info', ms = 2600) {
        if (!text) return;
        const b = toastBox();
        const t = el('div', { class: 'toast ' + kind, text });
        b.appendChild(t);
        requestAnimationFrame(() => t.classList.add('in'));
        setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
        while (b.children.length > 5) b.firstChild.remove();
    }

    // Watch legacy message sinks and mirror them into toasts — zero-touch
    // migration for the hundreds of `getElementById('tgtMsg').textContent = …`
    // writes all over main.js.
    function watchLegacySinks() {
        const sinks = [
            ['tgtMsg', 'info'], ['conqMsg', 'info'], ['bldMsg', 'warn'],
            ['techMsg', 'info'], ['planeMsg', 'info']
        ];
        sinks.forEach(([id, kind]) => {
            const node = document.getElementById(id);
            if (!node) return;
            let last = node.textContent;
            new MutationObserver(() => {
                const txt = node.textContent.trim();
                if (txt && txt !== last) { last = txt; toast(txt, kind); }
                else if (!txt) last = '';
            }).observe(node, { childList: true, characterData: true, subtree: true });
        });
    }

    // ── menu item model ──────────────────────────────────────────────────
    // { id, name, color, icon, disabled, tooltip, subMenu(), action() }
    function itemsForContext() {
        const A = api();
        const c = ctx;
        const items = [];
        const infoItem = {
            id: 'info', name: 'معلومات', color: COL.info, icon: 'ℹ️',
            tooltip: 'معلومات عن هذه البقعة',
            action: () => {
                const s = c.struct;
                if (s) toast(`${c.structName || 'مبنى'} — HP ${Math.ceil(s.hp)}/${s.maxHp}`, 'info');
                else toast(c.isWater ? 'محيط — انقر يابسة للأوامر' :
                    (c.isOwn ? 'أراضيك ✅' : (c.tileOwner === 'enemy' ? 'أرض العدو 🔴' : 'أرض محايدة ⚪')), 'info');
            }
        };
        items.push(infoItem);

        if (c.isWater) {
            items.push({
                id: 'boat', name: 'غزو بحري', color: COL.boat, icon: '🚢',
                tooltip: 'إرسال قوات عبر البحر نحو أقرب ساحل معادٍ',
                disabled: !A.boatAt,
                action: () => A.boatAt && A.boatAt(c.lat, c.lon)
            });
        } else if (c.isOwn) {
            items.push({
                id: 'build', name: 'بناء', color: COL.build, icon: '🏗️',
                tooltip: 'ابنِ هيكلاً هنا (ثم انقر الموقع)',
                subMenu: () => buildItems()
            });
            items.push({
                id: 'planes', name: 'طائرات', color: COL.plane, icon: '🛫',
                tooltip: 'إنتاج طائرة من أقرب مطار',
                subMenu: () => planeItems()
            });
            items.push({
                id: 'research', name: 'أبحاث', color: COL.research, icon: '🔬',
                tooltip: 'فتح لوحة الأبحاث',
                disabled: !A.openResearch,
                action: () => A.openResearch && A.openResearch()
            });
        } else {
            // enemy or neutral land
            items.push({
                id: 'boat', name: 'إنزال بحري', color: COL.boat, icon: '🚢',
                tooltip: 'غزو برمائي إذا لم يوجد طريق بري',
                disabled: !A.boatAt,
                action: () => A.boatAt && A.boatAt(c.lat, c.lon)
            });
            items.push({
                id: 'missiles', name: 'صواريخ', color: COL.missile, icon: '🚀',
                tooltip: 'ضربة صاروخية على هذا الموقع',
                subMenu: () => missileItems()
            });
            if (api().orderPlanesAt) {
                items.push({
                    id: 'planes', name: 'أمر الطائرات', color: COL.plane, icon: '✈️',
                    tooltip: 'توجيه طائراتك المحددة إلى هنا',
                    subMenu: () => [
                        { id: 'p_atk', name: 'هجوم', color: COL.attack, icon: '⚔️', action: () => api().orderPlanesAt('attack', c.lat, c.lon) },
                        { id: 'p_pat', name: 'دورية', color: COL.plane, icon: '🛡️', action: () => api().orderPlanesAt('patrol', c.lat, c.lon) },
                        { id: 'p_ret', name: 'عودة', color: COL.info, icon: '🏠', action: () => api().orderPlanesAt('return', c.lat, c.lon) }
                    ]
                });
            }
        }
        return items;
    }

    function buildItems() {
        const A = api();
        const defs = (A.sdefs && A.sdefs()) || {};
        const order = ['city', 'port', 'factory', 'airport', 'launcher', 'sam', 'radar', 'flak', 'himars', 'ciws', 'iron_dome', 'nuke_plant'];
        const icons = { city: '🏙️', port: '⚓', factory: '🏭', airport: '🛫', launcher: '🚀', sam: '🛡️', radar: '📡', flak: '🔫', himars: '🚚', ciws: '🔷', iron_dome: '🟢', nuke_plant: '☢️' };
        return order.filter(k => defs[k]).map(k => ({
            id: 'b_' + k, name: defs[k].name || k, color: COL.building, icon: icons[k] || '🏗️',
            tooltip: `${defs[k].name || k} — التكلفة $${A.costOf ? A.costOf(k) : defs[k].cost}`,
            disabled: !A.startBuild || (A.gold != null && A.costOf && A.gold() < A.costOf(k)),
            action: () => A.startBuild(k)
        }));
    }

    function planeItems() {
        const A = api();
        const cfg = (A.pcfg && A.pcfg()) || {};
        const locked = (A.lockedPlanes && A.lockedPlanes()) || [];
        return Object.keys(cfg).filter(k => !locked.includes(k) || (A.isTechUnlocked && A.isTechUnlocked(k))).map(k => ({
            id: 'p_' + k, name: cfg[k].name, color: COL.plane, icon: '✈️',
            tooltip: `${cfg[k].name} — $${cfg[k].cost}`,
            disabled: !A.purchasePlane || (A.gold != null && A.gold() < cfg[k].cost),
            action: () => A.purchasePlane(k)
        }));
    }

    function missileItems() {
        const A = api();
        const cfg = (A.mcfg && A.mcfg()) || {};
        const locked = (A.lockedMissiles && A.lockedMissiles()) || [];
        return Object.keys(cfg).filter(k => !locked.includes(k) || (A.isTechUnlocked && A.isTechUnlocked(k))).map(k => ({
            id: 'm_' + k, name: cfg[k].name, color: COL.missile, icon: '🚀',
            tooltip: `${cfg[k].name} — $${cfg[k].cost}`,
            disabled: !A.fireMissileAt || (A.gold != null && A.gold() < cfg[k].cost),
            action: () => A.fireMissileAt(k, c2().lat, c2().lon)
        }));
    }
    const c2 = () => ctx;

    // ── rendering ────────────────────────────────────────────────────────
    function radiiFor(level) {
        const inner = level === 0 ? 40 : 75;
        return [inner, inner + (level === 0 ? 55 : 65)];
    }

    function showRadialMenu(x, y, context) {
        ctx = context;
        hideRadialMenu(true);
        open = true;
        openedAt = performance.now();
        menuStack = [];
        buildOverlay();
        menuX = x; menuY = y;
        positionSvg(x, y);
        renderLevel(0, itemsForContext());
        renderCenterButton();
    }

    function buildOverlay() {
        if (overlay) { overlay.style.display = 'block'; return; }
        overlay = el('div', { id: 'radialOverlay' });
        // Guard: Windows fires contextmenu right AFTER mouseup — the menu just
        // opened from that mouseup must not be insta-closed by its own overlay.
        const fresh = () => performance.now() - openedAt < 250;
        overlay.addEventListener('mousedown', e => { if (e.target === overlay && !fresh()) hideRadialMenu(); });
        overlay.addEventListener('contextmenu', e => { e.preventDefault(); if (!fresh()) hideRadialMenu(); });
        document.body.appendChild(overlay);
        svg = el('svg', { id: 'radialSvg' });
        overlay.appendChild(svg);
        overlay.style.display = 'block';
    }

    function positionSvg(x, y) {
        const lvl = menuStack.length;
        const [, outer] = radiiFor(lvl === 0 ? 0 : 1);
        const margin = Math.max(outer, 30) + 10;
        let cx = Math.min(Math.max(x, margin), window.innerWidth - margin);
        let cy = Math.min(Math.max(y, margin), window.innerHeight - margin);
        if (window.innerWidth < margin * 2) cx = window.innerWidth / 2;
        if (window.innerHeight < margin * 2) cy = window.innerHeight / 2;
        // Explicit svg size + a root <g> translated to the center — the rings
        // draw around local (0,0). (A 0×0 svg + overflow:visible gets clipped
        // by browsers → invisible menu.)
        const size = margin * 2;
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.style.left = (cx - size / 2) + 'px';
        svg.style.top = (cy - size / 2) + 'px';
        if (!svgRoot) { svgRoot = el('g', {}); svg.appendChild(svgRoot); }
        svgRoot.setAttribute('transform', `translate(${size / 2}, ${size / 2})`);
    }

    function clearGroups() {
        while (svg.firstChild) svg.firstChild.remove();
        svgRoot = null;
    }

    function renderLevel(level, items, selectedParent) {
        if (!svgRoot) positionSvg(menuX, menuY);
        // level group with open/close animation
        const g = el('g', { class: 'menu-level-' + level });
        svgRoot.appendChild(g);
        const [r0, r1] = radiiFor(level);
        const n = Math.max(1, items.length);
        const offset = -Math.PI / n;
        const pad = 0.03;
        const span = (Math.PI * 2 - pad * n) / n;
        items.forEach((item, i) => {
            const center = offset + i * (span + pad) + span / 2 - Math.PI / 2 + (Math.PI * 2 / n) / 2 - (Math.PI * 2 / n) / 2;
            // angle for slice i: center of slice at top for i=0
            const a0 = -Math.PI / 2 - span / 2 + i * (span + pad);
            const a1 = a0 + span;
            const mid = (a0 + a1) / 2;
            const color = item.color || COL.fallback;
            const path = el('path', {
                d: slicePath(0, 0, r0, r1, a0, a1),
                fill: item.disabled ? COL.disabled : color,
                'fill-opacity': item.disabled ? 0.4 : 0.82,
                stroke: 'none'
            }, g);
            // icon at centroid
            const cr = (r0 + r1) / 2;
            const icon = el('text', {
                x: polar(0, 0, cr, mid).x, y: polar(0, 0, cr, mid).y + 8,
                'text-anchor': 'middle', 'font-size': level === 0 ? 22 : 24,
                fill: '#ffffff', class: 'rm-icon'
            }, g);
            icon.textContent = item.icon || item.name[0];
            if (item.disabled) { icon.setAttribute('opacity', 0.5); path.style.cursor = 'not-allowed'; }
            else {
                path.style.cursor = 'pointer';
                path.addEventListener('mouseenter', () => { path.style.filter = 'brightness(1.5)'; showTip(item); });
                path.addEventListener('mousemove', e => moveTip(e));
                path.addEventListener('mouseleave', () => { path.style.filter = ''; hideTip(); });
                path.addEventListener('click', e => {
                    e.stopPropagation();
                    SFXsafe('click');
                    if (item.subMenu) {
                        menuStack.push({ items, level, selectedParent: item });
                        // shrink current ring, render submenu
                        g.style.transformOrigin = '0px 0px';
                        g.style.transition = 'transform 240ms ease, opacity 240ms ease';
                        g.style.transform = 'scale(0.65)'; g.style.opacity = '0.8';
                        g.style.pointerEvents = 'none';
                        renderLevel(level + 1, item.subMenu(), item);
                        renderCenterButton(true);
                        positionSvgAtCtx();
                    } else {
                        try { item.action && item.action(); } catch (err) { console.error('[UI] action failed', err); }
                        hideRadialMenu();
                    }
                });
            }
        });
        // submenu entrance animation
        if (level > 0) {
            g.style.transformOrigin = '0px 0px';
            g.style.transform = 'scale(0.5)'; g.style.opacity = '0';
            requestAnimationFrame(() => {
                g.style.transition = 'transform 240ms ease, opacity 240ms ease';
                g.style.transform = 'scale(1)'; g.style.opacity = '1';
            });
        }
    }

    function positionSvgAtCtx() {
        // re-clamp using the submenu radius at the original open point
        positionSvg(menuX, menuY);
    }

    function renderCenterButton(isBack) {
        if (centerBtn) centerBtn.remove();
        if (!svgRoot) positionSvg(menuX, menuY);
        const g = el('g', { class: 'center-button' });
        svgRoot.appendChild(g);
        const A = api();
        let icon = '⚔️';
        let act = null;
        if (isBack) {
            icon = '↩️';
            act = () => goBack();
        } else if (ctx && !ctx.isWater && !ctx.isOwn && A.attackAt) {
            icon = '⚔️';
            const pct = A.troopPct ? A.troopPct() : 50;
            act = () => A.attackAt(c2().lat, c2().lon);
        } else if (ctx && ctx.isWater && A.boatAt) {
            icon = '🚢';
            act = () => A.boatAt(c2().lat, c2().lon);
        }
        const circle = el('circle', { r: 30, fill: COL.center, stroke: '#3b82f6', 'stroke-width': 1.5 }, g);
        const t = el('text', {
            'text-anchor': 'middle', y: 9, 'font-size': 26, fill: '#fff', class: 'rm-icon'
        }, g);
        t.textContent = icon;
        circle.style.cursor = act ? 'pointer' : 'default';
        t.style.cursor = circle.style.cursor;
        if (act) {
            // Back navigation must NOT close the menu — only leaf actions do.
            const fire = e => { e.stopPropagation(); act(); if (!isBack) hideRadialMenu(); };
            circle.addEventListener('click', fire);
            t.addEventListener('click', fire);
            circle.addEventListener('mouseenter', () => circle.setAttribute('r', 36));
            circle.addEventListener('mouseleave', () => circle.setAttribute('r', 30));
        }
        centerBtn = g;
    }

    function goBack() {
        // remove the top submenu group, restore parent ring
        const groups = svgRoot ? svgRoot.querySelectorAll('g[class^="menu-level-"]') : [];
        if (groups.length > 1) {
            const top = groups[groups.length - 1];
            top.remove();
            const parent = groups[groups.length - 2];
            parent.style.transform = 'scale(1)'; parent.style.opacity = '1';
            parent.style.pointerEvents = 'all';
        }
        menuStack.pop();
        renderCenterButton(menuStack.length > 0);
        positionSvgAtCtx();
    }

    function hideRadialMenu(internal) {
        if (!open) { if (svg) clearGroups(); return; }
        open = false;
        menuStack = [];
        if (centerBtn) { centerBtn.remove(); centerBtn = null; }
        if (overlay) overlay.style.display = 'none';
        if (svg) clearGroups();
        hideTip();
        if (!internal) reopenCooldownUntil = performance.now() + 300;
        else reopenCooldownUntil = performance.now() + 120;
    }

    // ── tooltip ──────────────────────────────────────────────────────────
    function showTip(item) {
        if (!item.tooltip && !item.name) return;
        ensureTip();
        tooltip.innerHTML = '';
        const title = el('div', { class: 'title', text: item.name || '' });
        tooltip.appendChild(title);
        if (item.tooltip) {
            const body = el('div', { class: 'body', text: item.tooltip });
            tooltip.appendChild(body);
        }
        tooltip.style.display = 'block';
    }
    function moveTip(e) {
        if (!tooltip) return;
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top = (e.clientY + 14) + 'px';
    }
    function hideTip() { if (tooltip) tooltip.style.display = 'none'; }
    function ensureTip() {
        if (tooltip) return;
        tooltip = el('div', { id: 'radialTooltip' });
        document.body.appendChild(tooltip);
    }

    function SFXsafe(kind) {
        try { window.SFX && window.SFX.ui && window.SFX.ui(kind); } catch (e) { /* noop */ }
    }

    // ── right-click wiring ───────────────────────────────────────────────
    // RTS-style controls: right-DRAG = camera navigation (OrbitControls rotate),
    // right-TAP (press+release without moving >8px) = radial menu. The browser
    // contextmenu event fires on right-PRESS, so we only preventDefault there
    // and open the menu on mouseup when no drag happened.
    const PANEL_SELECTOR = '#menuScreen, #radialOverlay, #topBar, #slog, #mmap, #selPan, #researchPanel, #go, #troopPctOverlay, #hotbar, .toast, #cityPanel, #cityTooltip, #devPortPanel, #colorGradePanel, #mapEditorPanel';
    let rDown = null; // { x, y, target, dragging }

    function tryOpenMenuFromTap(downX, downY) {
        if (performance.now() < reopenCooldownUntil) return;
        const A = api();
        // OpenFront onContextMenu: an armed build ghost is cancelled by
        // right-click FIRST — no menu opens that time.
        if (A.isBuildArmed && A.isBuildArmed()) {
            A.cancelBuild();
            toast('أُلغي وضع البناء 🚫', 'info');
            return;
        }
        if (!A.queryTile) return;
        if (A.isSpawnPhase && A.isSpawnPhase()) return;
        const q = A.queryTile(downX, downY);
        if (!q) return; // missed the globe
        showRadialMenu(downX, downY, q);
    }

    // ESC closes (main.js also has its own ESC handler; ours must run first)
    function init() {
        watchLegacySinks();
        // Suppress the browser context menu over the game surface (capture phase).
        // On Windows the contextmenu event arrives AFTER pointerup for right-clicks.
        window.addEventListener('contextmenu', e => {
            if (e.target.closest && e.target.closest(PANEL_SELECTOR)) return;
            e.preventDefault();
        }, true);
        // Right-button tracking via POINTER events (compatibility mouse events
        // are suppressed when pointerdown gets canceled by other handlers —
        // pointerdown/up always fire). Tap (<8px) = menu; drag = nothing.
        window.addEventListener('pointerdown', e => {
            if (e.button !== 2) return;
            rDown = { x: e.clientX, y: e.clientY, target: e.target, dragging: false };
        }, true);
        window.addEventListener('pointermove', e => {
            window.__lastMouseXY = { x: e.clientX, y: e.clientY }; // Enter-key build at cursor
            if (!rDown) return;
            const dx = e.clientX - rDown.x, dy = e.clientY - rDown.y;
            if (dx * dx + dy * dy > 64) rDown.dragging = true; // >8px = drag
        }, true);
        window.addEventListener('pointerup', e => {
            if (e.button !== 2 || !rDown) return;
            const st = rDown; rDown = null;
            if (st.dragging) return;                 // right-drag → no menu
            if (st.target.closest && st.target.closest(PANEL_SELECTOR)) return;
            tryOpenMenuFromTap(st.x, st.y);
        }, true);
        window.addEventListener('pointercancel', () => { rDown = null; }, true);
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && open) { hideRadialMenu(); }
        }, true);
        window.addEventListener('resize', () => { if (open) hideRadialMenu(true); });
        window.addEventListener('blur', () => { if (open) hideRadialMenu(true); });
        // Shift+scroll adjusts attack ratio (OpenFront InputHandler.onShiftScroll)
        window.addEventListener('wheel', e => {
            if (!e.shiftKey) return;
            const A = api();
            if (!A.setTroopPct) return;
            e.preventDefault();
            A.setTroopPct(Math.round((A.troopPct() + (e.deltaY < 0 ? 5 : -5)) / 5) * 5);
        }, { passive: false });
        console.log('[UI] controls: left-drag = navigate, left-tap = act, right-tap = radial menu');
    }

    return { init, toast, showRadialMenu, hideRadialMenu, isMenuOpen: () => open };
})();

export const initNewUI = () => UI.init();
export const uiToast = (t, k, ms) => UI.toast(t, k, ms);
export const isRadialOpen = () => UI.isMenuOpen();
window.__UI = UI;
