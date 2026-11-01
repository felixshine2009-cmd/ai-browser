# Physics element library (v3.4.0)

The physics panel is a sandbox: build a scene from **54 built-in elements**, edit **every property** in the inspector, save your own types to **我的元件**, and let the AI do the same with the `phys_*_element` tools. Coordinates: +x right, +y up, metres, degrees counter-clockwise.

## Using the editor

* **Add**: drag an element from the palette onto the canvas, or tap it (adds at the view centre). On narrow screens the palette (button *Palette 元件库*) and the inspector collapse; only one is open at a time.
* **Select / edit**: click an element (Shift / Ctrl / ⌘-click, or the multi-select toggle on touch screens, for multi-select). Handles: move, rotate, resize. The inspector shows every parameter with its unit and range; changes apply live and out-of-range values are rejected with the allowed range. Selected elements can be duplicated, deleted (Delete key or toolbar), snapped to a grid (Shift = coarser). Undo / Redo cover every edit.
* **My elements 我的元件**: *Save selection* stores the selection (or a single element with its current properties) as a custom type; *Export lib / Import lib* use JSON. A scene that uses custom types carries them along, so a shared scene opens on any machine.
* **Run**: Play / Pause / Step / Reset. Editing pauses and resets the run to t = 0.

## What is simulated

Own rigid-body engine (`rigid.js`): convex polygons and circles, SAT + clipping contacts, sequential-impulse solver with warm starting, static/kinetic Coulomb friction (pair rules via *friction pair*), rolling without slipping (ball, disc, ring, with moment-of-inertia coefficient k), belt surface velocity, pulleys (ideal and massive), ropes, springs, elastic cords, hinges. Fields: uniform E, B and gravity regions (charged particles follow the Lorentz force), rails + rod and coil use analytic induction models, optics use ray tracing (Snell with dispersion, mirrors, thin lenses).

Known limits: the loop is a 2D projection (a ball can lap repeatedly); massive-pulley inertia is exact for the single-fixed-pulley two-body case; the turntable is top-view; coil and rails are analytic models rather than circuit solvers.

## Element types

### Shapes 形体

| id | name | description | main parameters |
|---|---|---|---|
| `block` | 物块/方块 / Block | 矩形物块，可设质量、摩擦、恢复系数、初速度、电荷。 | w [m], h [m], mass [kg], mu0, mu, e, q [C], fixed |
| `plank` | 木板（地面上） / Plank | 放在地面上的长木板，用来做滑块-木板两物体摩擦问题（两者之间的摩擦因数用「摩擦对」精确指定）。 | w [m], h [m], mass [kg], mu0, mu, e, q [C], fixed |
| `ball` | 小球 / Ball | 实心小球（转动惯量系数 k：实心球 0.4，圆柱 0.5，圆环 1），会滚动。 | r [m], k, mass [kg], mu0, mu, e, q [C], fixed |
| `cylinder` | 圆柱/圆盘 / Cylinder / disc | 圆盘或圆柱的侧视图，会滚动（k=0.5）。 | r [m], k, mass [kg], mu0, mu, e, q [C], fixed |
| `ring` | 圆环 / Ring / hoop | 圆环（k=1），会滚动；碰撞按外圆计算。 | r [m], t [m], mass [kg], mu0, mu, e, q [C], fixed |
| `rod` | 细棒/杆（刚体） / Rod (rigid body) | 有质量的细棒，可转动。 | len [m], t [m], mass [kg], mu0, mu, e, q [C], fixed |
| `wedge` | 三角劈/斜面体 / Triangle wedge | 直角三角形物块（可动或固定），直角边在下。 | base [m], height [m], flip, mass [kg], mu0, mu, e, q [C] |
| `polygon` | 任意多边形 / Polygon | 顶点（相对质心）可编辑；非凸多边形按凸包处理。 | verts, mass [kg], mu0, mu, e, q [C], fixed, gravity |
| `compound` | 组合体（多形状刚体） / Compound body | parts 是 JSON 数组：{shape:"box"/"circle", w,h,r, dx,dy, da(°)}；整体是一个刚体（可用于自定义元件）。 | parts, mass [kg], mu0, mu, e, q [C], fixed, gravity |
| `particle` | 带电粒子 / Charged particle | 小电荷粒子（默认不受重力、留下轨迹），用于电场、磁场、质谱仪、回旋加速器。数值采用演示用 SI 量级。 | r [m], mass [kg], mu0, mu, e, q [C], fixed, gravity |

### Surfaces 表面

| id | name | description | main parameters |
|---|---|---|---|
| `ground` | 地面 / Ground | 水平地面，y 是地面高度；可用 segments 设置粗糙/光滑分段，如 "0:2:0.8:0.6; 2:5:0.05:0.05"（x0:x1:μ₀:μ）。 | w [m], thick [m], segments, mu0, mu, e |
| `wall` | 竖直墙 / Wall | 竖直墙/挡板（x,y 为中心）。 | h [m], thick [m], mu0, mu, e |
| `wallSeg` | 平板/线段 / Plate / segment | 任意角度的固定平板（x,y 为中心）。 | len [m], thick [m], mu0, mu, e |
| `patch` | 粗糙/光滑段 / Rough / smooth patch | 一段表面，μ₀、μ 可单独设置；放在抬高的平台上（顶面对齐地面时请改用地面的 segments）。 | len [m], thick [m], mu0, mu, e |
| `incline` | 斜面 / Incline | 斜面（x,y 是斜面底端）：倾角 θ、斜面长 L、μ₀/μ。 | slope [°], len [m], flip, mu0, mu, e |
| `arc` | 圆弧轨道 / Arc track | 圆弧轨道，圆心在 (x,y)，R 为运行半径；起止角可设（逆时针），内/外侧运行。 | R [m], a0 [°], a1 [°], thick [m], side, mu0, mu, e |
| `semiTrack` | 半圆轨道 / Semicircular track | 半圆形碗状轨道（180°→360°）。 | R [m], a0 [°], a1 [°], thick [m], side, mu0, mu, e |
| `quarterRamp` | 四分之一圆弧斜坡 / Quarter-circle ramp | 凹形（球从高处滑下）或凸形（球在圆弧顶部滑下）的四分之一圆弧；x,y 是圆心。 | R [m], thick [m], convex, flip, mu0, mu, e |
| `loop` | 竖直圆环轨道（回环） / Loop-the-loop | 入口四分之一圆弧 + 平地 + 竖直圆环（底部有小缺口）+ 出口平地。x,y 是圆环最低点；小球可从入口圆弧释放。2D 投影：通过环后可能再次进入圆环。 | R [m], Rq [m], floor [m], exitLen [m], gap [°], thick [m], mu0, mu |

### Mechanisms 机构

| id | name | description | main parameters |
|---|---|---|---|
| `cart` | 小车/滑车 / Cart / trolley | 带轮小车：与接触面的摩擦用自己的 μ₀、μ（滚动阻力），默认很小。 | w [m], h [m], wr [m], mass [kg], mu0, mu, e, q [C] |
| `stopper` | 挡板/止动块 / Stopper / baffle | 固定挡板，默认完全非弹性（e=0）。 | h [m], thick [m], mu0, mu, e |
| `conveyor` | 传送带 / Conveyor belt | 传送带：表面速度 = 带速（可反向、可倾斜）。物块与带面之间先静摩擦（μ₀）带动，超过最大静摩擦则滑动摩擦（μ），直到速度与带相同。 | len [m], thick [m], speed [m/s], dir, mu0, mu, e |
| `pulley` | 滑轮 / Pulley | 定滑轮/动滑轮。「理想」= 轻质无摩擦；否则按圆盘转动惯量 I=½·m·r² 计入（单个定滑轮 + 两端物体时精确，其他连接方式按理想处理并提示）。 | r [m], ideal, mass [kg], fixed, gravity |
| `rope` | 轻绳 / Light rope | 轻绳：只能拉不能推，可绕过 1–2 个滑轮（via）。length=0 表示按初始位置自动取绳长；设置更大的长度则初始松弛。 | a, ax [m], ay [m], b, bx [m], by [m], via, via2 |
| `lightRod` | 轻杆 / Light rod | 轻质刚性杆：保持两端距离不变，可受拉也可受压。length=0 自动取初始距离。 | a, ax [m], ay [m], b, bx [m], by [m], length [m] |
| `spring` | 弹簧 / Spring | 轻弹簧：F = k·(L − 原长)，既可拉伸也可压缩。rest=0 表示初始距离即原长。 | a, ax [m], ay [m], b, bx [m], by [m], k [N/m], rest [m] |
| `cord` | 弹性绳 / Elastic cord | 弹性绳：只在拉伸（L>原长）时产生拉力 k·(L−原长)，松弛时没有力。 | a, ax [m], ay [m], b, bx [m], by [m], k [N/m], rest [m] |
| `hinge` | 铰链/固定销 / Hinge / pin | 在世界点 (x,y) 把元件 A 与元件 B（或空=固定在世界上）连接：pin=自由转动的铰链，weld=固接。 | a, b, mode |
| `turntable` | 转盘（俯视） / Turntable (top view) | 俯视图转盘：盘上的物块（建立场景时圆心在盘内的物块/小球/圆柱）受摩擦力随盘转动；超过最大静摩擦就滑动。盘上物体不受重力沿面方向影响（俯视），支持力 N=mg。 | r [m], omega0 [rad/s], alpha [rad/s²], omegaMax [rad/s], mu0, mu |
| `launcher` | 发射器 / Launcher | 在 fireT 时刻以速度 speed 沿炮管方向（角度）发射一个小球。 | len [m], speed [m/s], fireT [s], mass [kg], pr [m], e, mu0, mu |

### Fields 场

| id | name | description | main parameters |
|---|---|---|---|
| `fieldE` | 匀强电场区 / Uniform E field | 区域内带电体受力 F=qE。dir 是电场方向（世界坐标，90°=向上）；alt 开启则电场方向按 period 周期反向（回旋加速器）。 | shape, w [m], h [m], r [m], E [V/m], dir [°], alt, period [s] |
| `fieldB` | 匀强磁场区 / Uniform B field | 区域内带电体受洛伦兹力 F=qv×B（垂直于纸面，into=向里 ⊗，否则向外 ⊙）。 | shape, w [m], h [m], r [m], B [T], into |
| `fieldG` | 重力场区 / Gravity region | 区域内重力加速度改为 g、方向 dir（世界角，−90°=向下）。 | shape, w [m], h [m], r [m], g [m/s²], dir [°] |
| `boundary` | 场边界/参考线 / Boundary | 画出场区边界或参考线（虚线）。absorb 开启时，进入该区域的物体会被吸收（冻结）。 | shape, w [m], h [m], r [m], absorb |
| `massSpectrometer` | 质谱仪（模板） / Mass spectrometer (template) | 一次放入：加速电容器（含缝）+ 匀强磁场 + 两个不同质量的离子。离子在磁场中沿半圆运动，落点间距 = 2(r₂−r₁)，r=√(2mU/q)/B。 | U [V], Bf [T], m1 [kg], m2 [kg], q [C] |
| `cyclotron` | 回旋加速器（模板） / Cyclotron (template) | 圆形匀强磁场 + 中间缝隙里的交变电场（周期 T=2πm/(qB)）+ 中心的粒子；粒子半径随速度增大。（近似：缝隙处也有磁场） | Bf [T], E [V/m], m [kg], q [C], Rd [m] |

### Electrical / optical 电学光学

| id | name | description | main parameters |
|---|---|---|---|
| `capacitor` | 平行板电容器 / Capacitor plates | 两块平行板，板间匀强电场 E=U/d（从正板指向负板）。底板可开缝（slit）并作为落点探测板（detect）。带电粒子穿过板间会偏转/加速。 | len [m], d [m], thick [m], U [V], top, slit [m], slitX [m], detect |
| `rails` | 导轨+导体棒（电磁感应） / Rails with sliding rod | 俯视图：两根平行导轨（间距 gap）左端接电阻 R，导体棒（质量 M、电阻 Rr）在匀强磁场 B 中沿导轨滑动。ε=B·gap·v，I=(E−ε)/(R+Rr)，安培力 F=B·I·gap；可加外力 F、倾角 incline（沿轨道方向的重力分量 M·g·sinθ，摩擦 μ·M·g·cosθ）。 | len [m], gap [m], B [T], into, R [Ω], Rr [Ω], E [V], M [kg] |
| `coil` | 线框/线圈（电磁感应） / Coil / loop | 矩形闭合线框（N 匝、总电阻 Rc）：穿过磁场区时磁通 Φ=N·B·S 变化产生 ε=−dΦ/dt、I=ε/Rc，受安培阻力（能量守恒）。线框是运动的刚体，不与其他物体碰撞。 | w [m], h [m], N, Rc [Ω], mass [kg], gravity, vx [m/s], vy [m/s] |
| `glass` | 玻璃砖 / Glass block | 矩形玻璃砖（折射率 n 与色散可调）。 | n, disp, w [m], h [m] |
| `prism` | 三棱镜 / Prism | 等腰三棱镜（顶角 α、腰长 side）；白光会色散。 | n, disp, apex [°], side [m] |
| `semiGlass` | 半圆形玻璃 / Semicircular glass | 半圆柱玻璃（直边在原点，朝 +x 半圆）。 | n, disp, r [m] |
| `lens` | 透镜 / Thin lens | 薄透镜：光轴方向 = 角度；凸透镜会聚、凹透镜发散，焦距 f。 | f [m], kind, h [m] |
| `mirror` | 平面镜 / Plane mirror | 平面镜（角度 = 镜面方向；镜背有斜线）。 | len [m] |
| `lightSource` | 光源 / Light source | 点光源（扇形）或平行光束；白光 = 七色，遇棱镜/玻璃色散。角度 = 出射方向。 | mode, count, spread, white |
| `screen` | 屏/探测板 / Screen | 接收光线（记录光斑位置）并阻挡带电粒子/物体（记录落点）；可开缝。 | len [m], thick [m], slit [m], slitX [m], e |

### Measurement 测量

| id | name | description | main parameters |
|---|---|---|---|
| `ruler` | 刻度尺 / Ruler | 刻度尺（仅显示，不参与碰撞），单位 m，刻度 1 cm / 5 cm / 10 cm。 | len [m] |
| `protractor` | 量角器 / Protractor | 量角器（半圆，0°–180°，仅显示）。 | r [m] |
| `photogate` | 光电门 / Photogate | 一条光线段：物体遮光时记录进入时刻 t_in、离开时刻 t_out、遮光时间 Δt 和通过时的速度。 | len [m], showLine |
| `stopwatch` | 秒表/计时器 / Stopwatch | 计时：不设光电门时从 t=0 开始一直走；设置起、止光电门则从起门触发计时到止门触发。 | startGate, stopGate |
| `springScale` | 弹簧秤 / Spring scale | 弹簧秤：两端受拉，表盘显示拉力 F（k 取 2000 N/m，伸长很小）。可串在绳上或挂物体，读数 = 拉力。 | a, ax [m], ay [m], b, bx [m], by [m], maxF [N], rest [m] |
| `readout` | 读数显示（速度/受力…） / Readout | 在画布上实时显示某个元件的某个物理量（速度、加速度、动能、支持力、摩擦力、张力、感应电动势…）；勾选「曲线」会把它画到右侧曲线图。 | target, qty, digits, plot |
| `trace` | 轨迹点（频闪） / Trace points | 每隔 interval 秒在目标元件（及其局部偏移点）的位置打一个点，像频闪照片，并标出时刻。 | target, interval [s], ox [m], oy [m], labels |
| `frictionPair` | 摩擦对（两物体间 μ） / Friction pair | 精确指定两个元件之间的摩擦因数 μ₀、μ（和恢复系数 e）。没有摩擦对时：物体与固定表面取表面的 μ；两个动体取两者平均。 | a, b, mu0, mu, e |

For every parameter with its unit, range and default call `phys_list_element_types` (or see the inspector).

## Examples

`el_conveyor_horizontal`, `el_conveyor_incline`, `el_atwood`, `el_block_on_plank`, `el_loop_the_loop`, `el_rails_rod`, `el_mass_spectrometer`, `el_prism_dispersion` (pick them in the *Examples* list).

## Agent tools

| tool | purpose |
|---|---|
| `phys_list_element_types` | every type, parameter, unit, range, default (+ the user's custom types); optional category filter |
| `phys_add_element` | add one element (templates such as `massSpectrometer` expand to several) — errors name the bad parameter and its range |
| `phys_update_element` | change properties of an element by id |
| `phys_remove_element` | delete by id (ropes / springs / hinges that depend on it are removed with it) |
| `phys_define_custom_element` | define a reusable type: `{id, zh, base, defaults}` or `{id, zh, template:[…]}` |
| `phys_new_scene` / `phys_get_elements` | blank sandbox / read back the document and runtime summary |

`phys_load` also accepts a scene with `elements:[{id,type,x,y,angle,…}]`.

## Credits

Own engine and own canvas drawings; technique lineage: Box2D-lite (Erin Catto, MIT). No third-party code, icons or SVGs are bundled; no GPL code. See [THIRD_PARTY_NOTICES.md](https://github.com/felixshine2009-cmd/ai-browser/blob/main/THIRD_PARTY_NOTICES.md).
