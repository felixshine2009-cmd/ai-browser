// Generates the web copy of the physics panel from the desktop extension panel (single source of truth).
// usage: node scripts/sync-web-physics.js [out.html]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let h = fs.readFileSync(path.join(root, 'extensions/builtin/physics/panel.html'), 'utf8');
h = h.replace('src="modules.js"', 'src="physics/modules.js"').replace('src="sim.js"', 'src="physics/sim.js"').split("fetch('examples/").join("fetch('physics/examples/");
fs.writeFileSync(process.argv[2] || path.join(root, 'web/panels-phys.html'), h);
