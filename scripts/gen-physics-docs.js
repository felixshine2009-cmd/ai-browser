// Generates docs/wiki/Physics-Parameters.md from the module registry (single source of truth).
const path = require('path'), fs = require('fs');
require(path.join(__dirname, '../extensions/builtin/physics/modules.js'));
const M = globalThis.PhysModules; let o = '# Physics parameters\n\nEvery quantity below is editable in the **Params** panel (slider + number box, with units), settable by the agent with `phys_set_param {module, key, value}` (or `phys_update {changes:{"modules[0].v0":20}}`), and is validated against its range. Scenes use `modules:[{"kind":"projectile", ...params}]`; call `phys_list_params` for the live list.\n';
for (const k of M.kinds()) {
  const r = M.REGISTRY[k]; o += `\n## ${r.zh} — \`${k}\`\n\n| key | 名称 | unit | range / options | default |\n|---|---|---|---|---|\n`;
  for (const p of M.paramList(k)) o += `| \`${p.key}\`${p.alias ? ' (alias)' : ''} | ${p.zh || ''} | ${p.unit || ''} | ${p.enum ? p.enum.join(' / ') : p.min + ' … ' + p.max} | ${p.enum || p.alias ? (p.def == null ? '' : p.def) : p.def} |\n`;
}
o += '\n## Rigid-body scenes\n\n| Path | Meaning |\n|---|---|\n| `g` | gravity (m/s²); overridden by `planet{G,M,R}` → g = GM/R² |\n| `world.air` | linear air drag (kg/s) |\n| `bodies[i].mass, e, mu, mu0, q, radius` | mass, restitution, kinetic / static friction, charge |\n| `walls[i].mu, mu0, bounce` | surface friction (static μ₀ holds, kinetic μ decelerates) and restitution |\n| `springs[i].k, rest, damping` | stiffness, rest length, damping |\n| `fields[i]` E | `{Ex,Ey}` or `{mag, angle}` or `{U, d, angle}` (E = U/d) |\n| `fields[i]` B | `{Bz}` or `{mag, dir:"out"|"in"}` |\n';
fs.writeFileSync(path.join(__dirname, '../docs/wiki/Physics-Parameters.md'), o); console.log(o.split('\n').length, 'lines');
