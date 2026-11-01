# Third-party notices

This file records every outside source used by the **physics element library** (desktop v3.4.0 / web v1.2.0) and its licence.

## Physics element library (v3.4.0 / web-v1.2.0)

| What | Where | Source / licence | How it is used |
| --- | --- | --- | --- |
| Rigid-body engine `PhysRigid` (`extensions/builtin/physics/rigid.js`) | own code (MIT, same as this project) | Algorithmic lineage: **Box2D-lite** by Erin Catto — <https://github.com/erincatto/box2d-lite> — MIT License, © Erin Catto | Only the *published technique* is followed: SAT collision detection with edge clipping, contact manifolds, sequential-impulse solver with warm starting. **No Box2D / Box2D-lite source code was copied or bundled**; the engine was written from scratch (plus belts, pulleys, ropes, one-way shapes, split-impulse position correction). |
| Element visuals (blocks, pulleys, conveyors, coils, lenses, prisms, field symbols, rulers, …) | `extensions/builtin/physics/elements-types.js`, `editor.js` | Drawn by this project with Canvas 2D (each type has its own `draw`; palette thumbnails are rendered from those same draw routines) | **No third-party icons, SVGs, images or fonts are bundled.** |
| Palette icons | `editor.js` | Rendered from our own canvas draw routines | none |
| Physics formulas (Snell's law, Lorentz force, Faraday's law, moment of inertia of ball / disc / ring, Atwood machine, belt friction…) | tests `test/suites/28-physics-elements.js` | Textbook physics (not copyrightable) | analytic checks for the simulation |

* **Bundled MIT/BSD physics libraries:** none (the decision was to write our own engine so the app stays small and fully offline / PWA-cacheable).
* **GPL / AGPL / LGPL code:** none was used. Nothing in this release needs a licence flag.
* **Web search:** reference designs and open-source simulations were only used for *look-and-parameter ideas*; nothing was copied.

## Components that were already part of the project (unchanged by this release)

Electron, node-llama-cpp, WebLLM / transformers.js (web), GeoGebra (non-commercial licence, loaded locally), the language models listed under *Models and licences* in the README, and the dev-only test tools (Playwright). Each keeps its own licence; see the README and the respective upstream projects.

## Box2D-lite licence text (for the algorithmic lineage above)

```
The MIT License (MIT)

Copyright (c) 2006-2019 Erin Catto http://www.gamedev.net/erin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
