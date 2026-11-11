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

## Python and Linux VM (v5.3.0 / web-v2.3.0 / ipad-v1.1.0)

| Component | Where | Licence | Use |
| --- | --- | --- | --- |
| CPython 3.12 (python-build-standalone builds) — <https://github.com/astral-sh/python-build-standalone> | Mac app `python/` | PSF License 2.0 (builds: BSD-3-Clause / MPL-2.0 tooling) | bundled interpreter |
| numpy, scipy, pandas, matplotlib, sympy, mpmath, pillow and their dependencies (wheels from PyPI) | Mac app `python/lib/python3.12/site-packages`; Linux VM images | BSD-3-Clause / BSD / PSF-based (matplotlib) / HPND (pillow); scipy and numpy wheels include OpenBLAS (BSD-3) and gfortran runtime (GPL-3 with GCC Runtime Library Exception) | preinstalled libraries |
| vfkit — <https://github.com/crc-org/vfkit> | Mac app `vm/vfkit` | Apache-2.0 | starts the desktop Linux VM with Apple Virtualization.framework |
| Alpine Linux 3.22 packages (linux-virt kernel, busybox, musl, python3, py3-* …) — <https://alpinelinux.org> | release assets `linux-vm-*` (downloaded on first use / embedded in the IPA) | per package: GPL-2.0 (kernel, busybox), MIT (musl), PSF, BSD …; sources at <https://gitlab.alpinelinux.org/alpine/aports> | guest operating system |
| Reference BLAS / CBLAS / LAPACK (Alpine `blas`, `cblas`, `lapack`) | iPad VM image | BSD-3-Clause | replaces OpenBLAS in the i686 guest (the emulator has no SSSE3) |
| v86 — <https://github.com/copy/v86> (`libv86.js`, `v86.wasm`, `tools/fs2json.py`, `tools/copy-to-sha256.py` vendored in `vm/v86-tools/`) | IPA `vm/`; `vm/v86-tools/` | BSD-2-Clause | x86 emulator for the iPad Linux VM |
| SeaBIOS / SeaVGABIOS (as shipped with v86) — <https://www.seabios.org> | IPA `vm/seabios.bin`, `vm/vgabios.bin` | LGPL-3.0 (unmodified binaries; source at the upstream site) | VM firmware |
| Pyodide 314 — <https://github.com/pyodide/pyodide> | loaded from cdn.jsdelivr.net on first use, cached by the service worker | MPL-2.0 (packages keep their own licences) | Python in the web app / iPad fallback |
| micropip | via Pyodide | MPL-2.0 | installing extra libraries on web |

No source code of these projects was modified except the two v86 helper scripts, which are used unchanged at build time.

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
