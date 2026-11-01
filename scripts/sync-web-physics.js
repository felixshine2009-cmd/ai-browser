// Generates the web copy of the physics panel from the desktop extension panel (single source of truth).
// usage: node scripts/sync-web-physics.js [out.html]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let h = fs.readFileSync(path.join(root, 'extensions/builtin/physics/panel.html'), 'utf8');
['modules', 'rigid', 'elements', 'elements-types', 'sim', 'editor'].forEach((f) => { h = h.replace('src="' + f + '.js"', 'src="physics/' + f + '.js"'); });
h = h.split("fetch('examples/").join("fetch('physics/examples/");
fs.writeFileSync(process.argv[2] || path.join(root, 'web/panels-phys.html'), h);
