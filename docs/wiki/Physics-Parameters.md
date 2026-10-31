# Physics parameters

Every quantity below is editable in the **Params** panel (slider + number box, with units), settable by the agent with `phys_set_param {module, key, value}` (or `phys_update {changes:{"modules[0].v0":20}}`), and is validated against its range. Scenes use `modules:[{"kind":"projectile", ...params}]`; call `phys_list_params` for the live list.

## 抛体运动 — `projectile`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `v0` | 初速度 | m/s | 0 … 100 | 15 |
| `angle` | 抛射角 | ° | -90 … 90 | 45 |
| `h0` | 初始高度 | m | 0 … 200 | 0 |
| `g` | 重力加速度 | m/s² | 0.1 … 30 | 9.8 |
| `k` | 空气阻力系数 | kg/s | 0 … 2 | 0 |
| `mass` | 质量 | kg | 0.01 … 10 | 1 |

## 斜面与摩擦 — `incline`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `theta` | 斜面倾角 θ | ° | 0 … 80 | 30 |
| `mass` | 质量 | kg | 0.1 … 20 | 2 |
| `mu0` | 静摩擦因数 μ₀ |  | 0 … 1.5 | 0.5 |
| `mu` | 动摩擦因数 μ |  | 0 … 1.5 | 0.3 |
| `length` | 斜面长度 | m | 0.5 … 20 | 5 |
| `v0` | 初速度(沿斜面向下为正) | m/s | -10 … 10 | 0 |
| `g` | 重力加速度 | m/s² | 0.1 … 30 | 9.8 |

## 匀速圆周运动 — `circular`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `radius` | 半径 r | m | 0.1 … 50 | 2 |
| `omega` | 角速度 ω | rad/s | 0.1 … 30 | 3 |
| `mass` | 质量 | kg | 0.01 … 100 | 1 |
| `phase0` | 初相位 | ° | -180 … 180 | 0 |

## 单摆 — `pendulum`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `L` | 摆长 / 绳长 | m | 0.1 … 20 | 1 |
| `theta0` | 初始摆角 | ° | 1 … 170 | 20 |
| `mass` | 质量 | kg | 0.01 … 20 | 0.5 |
| `g` | 重力加速度 | m/s² | 0.1 … 30 | 9.8 |
| `damping` | 阻尼系数 | 1/s | 0 … 2 | 0 |

## 弹簧振子 — `spring`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `k` | 劲度系数 k | N/m | 1 … 500 | 20 |
| `mass` | 质量 | kg | 0.05 … 50 | 1 |
| `amplitude` | 振幅 A | m | 0.01 … 5 | 0.5 |
| `damping` | 阻尼系数 | kg/s | 0 … 10 | 0 |
| `rest` | 原长 | m | 0.1 … 5 | 1 |

## 一维碰撞 — `collision`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `m1` | 质量 m₁ | kg | 0.1 … 20 | 2 |
| `m2` | 质量 m₂ | kg | 0.1 … 20 | 1 |
| `v1` | 初速度 v₁ | m/s | -20 … 20 | 4 |
| `v2` | 初速度 v₂ | m/s | -20 … 20 | 0 |
| `e` | 恢复系数 e |  | 0 … 1 | 1 |

## 万有引力与天体 — `gravitation`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `G` | 引力常量 G | ×1e-11 N·m²/kg² | 1 … 20 | 6.674 |
| `M` | 行星质量 M | ×1e24 kg | 0.01 … 5000 | 5.97 |
| `Rp` | 行星半径 | ×1e6 m | 0.1 … 100 | 6.371 |
| `h` | 轨道高度 | ×1e6 m | 0 … 100 | 0.4 |
| `m` | 卫星质量 | kg | 1 … 10000 | 1000 |

## 简谐运动 — `shm`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `A` | 振幅 | m | 0.01 … 5 | 1 |
| `T` | 周期 T | s | 0.1 … 20 | 2 |
| `phase` | 初相位 φ | ° | -180 … 180 | 0 |
| `damping` | 阻尼系数 | 1/s | 0 … 2 | 0 |
| `frequency` (alias) | 频率 f | Hz | 0.05 … 10 |  |

## 机械波 — `wave`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `A` | 振幅 | m | 0.01 … 2 | 0.5 |
| `T` | 周期 T | s | 0.1 … 10 | 2 |
| `lambda` | 波长 λ | m | 0.1 … 20 | 4 |
| `phase` | 初相位 φ | ° | -180 … 180 | 0 |
| `damping` | 阻尼系数 | 1/m | 0 … 1 | 0 |
| `frequency` (alias) | 频率 f | Hz | 0.1 … 10 |  |
| `speed` (alias) | 波速 v | m/s | 0.05 … 100 |  |

## 带电粒子（平行板 + 磁场） — `plates`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `q` | 电荷量 q | µC | -10 … 10 | 1 |
| `mass` | 质量 m | mg | 0.01 … 100 | 1 |
| `U` | 板间电压 U | V | 0 … 10000 | 10 |
| `d` | 板间距 d | cm | 0.5 … 50 | 10 |
| `Lp` | 极板长度 | cm | 1 … 200 | 40 |
| `B` | 磁感应强度 B | T | -5 … 5 | 0 |
| `v0` | 入射速度 | m/s | 0 … 500 | 20 |
| `angle` | 入射角 | ° | -80 … 80 | 0 |
| `Edir` | 电场方向(°，向上=90) | ° | -180 … 180 | -90 |

## 电路（直流 / RC / RL / 交流） — `circuit`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `type` | 类型 |  | DC / RC / RL / AC | DC |
| `emf` | 电动势 ε | V | 0 … 100 | 12 |
| `r` | 内阻 r | Ω | 0 … 20 | 1 |
| `R` | 电阻 R | Ω | 0.1 … 1000 | 10 |
| `C` | 电容 C | µF | 0.1 … 1000 | 100 |
| `L` | 电感 L | mH | 1 … 1000 | 100 |
| `rho` | 电阻率 ρ | Ω·mm²/m | 0 … 1 | 0.0175 |
| `wireLen` | 导线长度 l | m | 0 … 1000 | 0 |
| `area` | 导线横截面积 S | mm² | 0.1 … 50 | 1 |
| `freq` | 交流频率 f | Hz | 1 … 1000 | 50 |
| `V0` | 交流峰值 V₀ | V | 0 … 500 | 311 |

## 变压器 — `transformer`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `N1` | 原线圈匝数 n₁ |  | 1 … 5000 | 100 |
| `N2` | 副线圈匝数 n₂ |  | 1 … 5000 | 50 |
| `U1` | 原线圈电压 U₁ | V | 1 … 1000 | 220 |
| `Rl` | 负载电阻 | Ω | 1 … 1000 | 10 |
| `freq` | 频率 | Hz | 1 … 1000 | 50 |

## 电磁感应（线圈 / 导体棒） — `induction`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `mode` | 模式 |  | coil / rod | coil |
| `N` | 线圈匝数 N |  | 1 … 1000 | 100 |
| `area` | 线圈面积 S | cm² | 1 … 1000 | 100 |
| `B` | 磁感应强度 B | T | 0.001 … 5 | 0.5 |
| `omega` | 转动角速度 ω | rad/s | 0 … 300 | 100 |
| `Rc` | 回路电阻 | Ω | 0.1 … 100 | 10 |
| `len` | 棒长 l | m | 0.05 … 5 | 0.5 |
| `vrod` | 棒速度 v | m/s | 0 … 50 | 4 |

## 折射与全反射 — `refraction`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `n1` | 介质1折射率 n₁ |  | 1 … 3 | 1 |
| `n2` | 介质2折射率 n₂ |  | 1 … 3 | 1.5 |
| `incidence` | 入射角 | ° | 0 … 89.9 | 30 |
| `wavelength` | 真空波长 λ | nm | 380 … 780 | 550 |

## 薄透镜成像 — `lens`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `f` | 焦距 f (凸+ 凹−) | cm | -50 … 50 | 10 |
| `u` | 物距 u | cm | 1 … 100 | 25 |
| `h` | 物高 | cm | 0.1 … 20 | 2 |
| `wavelength` | 光波长 | nm | 380 … 780 | 550 |

## 球面镜 — `mirror`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `Rc` | 曲率半径 R (凹+ 凸−) | cm | -100 … 100 | 20 |
| `u` | 物距 u | cm | 1 … 100 | 30 |
| `h` | 物高 | cm | 0.1 … 20 | 2 |

## 理想气体（等温/等压/等容/绝热） — `gas`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `n` | 物质的量 n | mol | 0.01 … 10 | 1 |
| `T` | 初温 T | K | 50 … 1500 | 300 |
| `V` | 初体积 V | L | 1 … 100 | 20 |
| `process` | 过程 |  | isothermal / isobaric / isochoric / adiabatic | isothermal |
| `Vend` | 末体积 V₂ | L | 1 … 100 | 40 |
| `Tend` | 末温 T₂ (等容) | K | 50 … 1500 | 600 |
| `gamma` | 比热比 γ |  | 1.05 … 1.7 | 1.4 |
| `c` | 比热容 c | J/(kg·K) | 100 … 5000 | 1000 |
| `mass` | 质量 | kg | 0.001 … 10 | 0.1 |
| `p` (alias) | 初压强 p | kPa | 1 … 5000 |  |

## 光电效应 — `photoelectric`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `nu` | 光子频率 ν | ×10¹⁴ Hz | 1 … 20 | 8 |
| `W0` | 逸出功 W₀ | eV | 0.5 … 6 | 2.2 |
| `h` | 普朗克常量 h | ×10⁻³⁴ J·s | 1 … 10 | 6.626 |
| `intensity` | 光强 | % | 0 … 100 | 50 |
| `Vapp` | 外加电压 U | V | -6 … 6 | 0 |
| `wavelength` (alias) | 光子波长 λ | nm | 15 … 3000 |  |

## 半衰期与放射性衰变 — `decay`

| key | 名称 | unit | range / options | default |
|---|---|---|---|---|
| `N0` | 初始原子核数 N₀ |  | 100 … 10000 | 1000 |
| `halfLife` | 半衰期 T½ | s | 1 … 100 | 10 |

## Rigid-body scenes

| Path | Meaning |
|---|---|
| `g` | gravity (m/s²); overridden by `planet{G,M,R}` → g = GM/R² |
| `world.air` | linear air drag (kg/s) |
| `bodies[i].mass, e, mu, mu0, q, radius` | mass, restitution, kinetic / static friction, charge |
| `walls[i].mu, mu0, bounce` | surface friction (static μ₀ holds, kinetic μ decelerates) and restitution |
| `springs[i].k, rest, damping` | stiffness, rest length, damping |
| `fields[i]` E | `{Ex,Ey}` or `{mag, angle}` or `{U, d, angle}` (E = U/d) |
| `fields[i]` B | `{Bz}` or `{mag, dir:"out"|"in"}` |
