// Dev validator: every PIXEL_ICONS grid must be exactly 12 rows × 12 cols,
// chars from [#.+]. Run: node scripts/validate_pixel_icons.mjs
import { readFileSync } from 'fs';
const src = readFileSync('src/main.js', 'utf8');
const m = src.match(/const PIXEL_ICONS = \{([\s\S]*?)\n\};/);
if (!m) { console.error('PIXEL_ICONS block not found'); process.exit(1); }
const body = m[1];
const grids = {};
const re = /^ {4}(\w+): (\[[\s\S]*?\]),?$/gm;
let mm;
while ((mm = re.exec(body))) {
    try { grids[mm[1]] = eval(mm[2]); } catch (e) { console.error(mm[1], 'eval failed', e.message); }
}
let ok = true;
const valid = new Set(['#', '.', '+']);
for (const [name, g] of Object.entries(grids)) {
    if (g.length !== 12) { console.error(`${name}: ${g.length} rows`); ok = false; }
    for (let i = 0; i < g.length; i++) {
        if (g[i].length !== 12) { console.error(`${name} row ${i}: len ${g[i].length} <${g[i]}>`); ok = false; }
        for (const ch of g[i]) if (!valid.has(ch)) { console.error(`${name} row ${i}: bad char '${ch}'`); ok = false; }
    }
}
const names = Object.keys(grids).join(', ');
console.log('icons:', names);
console.log(ok ? `ALL ${Object.keys(grids).length} GRIDS VALID 12x12` : 'GRID ERRORS');
process.exit(ok ? 0 : 1);
