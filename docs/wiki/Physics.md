# Physics Visualizer

A deterministic 2D simulator + canvas renderer aimed at **Chinese high-school physics**.

## Topics covered (examples included)

* Mechanics — projectile, inclined plane, collision, circular motion
* Oscillation / waves — spring–mass SHM, simple pendulum
* Electromagnetism — charge in E / B fields, RC charging, AC
* Optics — plane mirror, refraction / TIR, thin lens
* Thermal — ideal-gas particle sketch
* Modern — photoelectric schematic

## Scene JSON (AI output)

Required: `topic`, `bodies[]` (each with `id`). Optional: `world`, `g`, `dt`, `springs`, `fields` (`E` / `B`), `walls`, `optics`, `circuit` (`RC` / `AC`), `plots`, `meta` / `zh`.

Coordinates: **+x right, +y up**; gravity pulls **−y**.

Always call `phys_validate` before `phys_load`. On failure, fix the JSON and retry.

## Agent tools

`phys_validate`, `phys_load`, `phys_play`, `phys_pause`, `phys_step`, `phys_reset`, `phys_set_speed`, `phys_state`, `phys_list_examples`, `phys_load_example`, `phys_set_param`, `phys_update`, `phys_list_params`.

**Every parameter is customisable** (v2.2.0): 19 parametric modules (projectile, incline with static μ₀ / kinetic μ, circular, pendulum, spring, collision, gravitation, SHM, waves, charged particle in plates + B, circuits DC/RC/RL/AC, transformer, induction, refraction, lens, mirror, ideal gas, photoelectric, decay) plus rigid-body scenes with friction, restitution, fields and planets. See [[Physics-Parameters]] for the full table of keys, units and ranges. Derived values (range, critical angle, τ, Ek, …) are shown live.

Panel controls: Play / Pause / Step / Reset / Speed, Vectors, Trails, example picker, live plot.

## Scene JSON reference

| Field | Meaning |
|---|---|
| `topic` | e.g. `mechanics.projectile` |
| `meta` / `zh` | title / Chinese title shown in the panel |
| `world` | `{xmin,xmax,ymin,ymax,air}` view box (metres) and air drag |
| `g`, `dt` | gravity (default 9.8), time step (default 1/120 s) |
| `bodies[]` | `{id,x,y,vx,vy,mass,radius,q,color,label,fixed,bounce,e,gravity}` |
| `springs[]` | `{a,b,k,rest,damping}` between body ids |
| `fields[]` | `{type:'E',Ex,Ey}` or `{type:'B',Bz}`, optional rectangular region |
| `walls`, `forces[]` | solid walls; `{type:'const'}` or `{type:'gravity_point'}` forces |
| `optics` | `{rays,mirrors,lenses,interfaces}` for geometric optics |
| `circuit` | `{type:'RC'}` or `{type:'AC'}` with R, C, V / amplitude, frequency |
| `plots[]` | live plots `{id,of:'body.prop'}` or `of:'t'` |

The integrator is semi-implicit Euler at a fixed step, so the same scene always gives the same result.
