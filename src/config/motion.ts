/**
 * 第一幕运动参数集中管理。
 * 所有需要反复微调的视觉/运动参数都放在这里，不要散落在各组件里。
 * 坐标约定：船体相关百分比以 船.png（1920×1080）原始像素坐标为基准。
 */

/* ---------------- 海浪四层（按参考图：海浪1 最前 → 海浪4 最后） ----------------
 * 素材映射（参考图标注 → pics 原始文件 → 工程路径）：
 *   海浪1（最前景） → pics/海1.png → assets/sea-1.webp
 *   海浪2（第二层） → pics/海2.png → assets/sea-2.webp
 *   海浪3（第三层） → pics/海3.png → assets/sea-3.webp
 *   海浪4（最后景） → pics/海4.png → assets/sea-4.webp
 *
 * 空间前后顺序（观察者 → 远处）：海浪1 → 海浪2 → 船体 → 海浪3 → 海浪4
 * z-index 显式设置：海浪1=6 / 海浪2=5 / 船=4 / 海浪3=3 / 海浪4=2
 *
 * 运动方式（第六轮：恢复水平无缝滚动 + 涟漪浮动）：
 * - 横向：每层用「原图 + 水平镜像图」双图接续，conveyor 宽 200%，
 *   关键帧 translateX(-25% → -75%)，首尾显示内容完全相同、位移恰为一张图宽，
 *   循环无接缝无跳变。duration 越短滚动越快。
 * - 纵向：每层叠加小幅上下浮动（wave-bob），幅度/周期/相位各不同，
 *   形成持续变化的波峰组合（涟漪感），不与横向滚动冲突。
 * - 素材边缘色差大（海4 最大 213），不可直接首尾拼接，必须用镜像接续。
 *
 * 尺寸：每张图按原始宽高比（4096×1714）完整显示，宽度用 widthPct
 * （屏宽百分比，>100 兼作左右溢出防露边余量）。本轮整体放大 1.25–1.4 倍。
 * 图层不设固定高度、不做 overflow 裁切，浪峰完整露出。
 */
export interface SeaLayerCfg {
  src: string;
  /** 单张图宽度（屏宽百分比；>100 部分向两侧溢出，防露边） */
  widthPct: number;
  /** 图层距舞台底部偏移（vh），可为负（把图底压到屏幕外） */
  bottomVh: number;
  /** 不透明度（近景实、远景淡） */
  opacity: number;
  /** 整体压暗（远景融入夜色） */
  brightness: number;
  /** 图片底部渐隐蒙版（设在 img 上，随 conveyor 一起平移，淡化硬边） */
  bottomFade: null | { blackUntilPct: number };
  /** 移动端（≤720px）覆盖值 */
  widthPctMobile?: number;
  bottomVhMobile?: number;
  /** z-index：决定前后遮挡，必须显式设置（6/5 船前，3/2 船后） */
  z: number;
  /** 水平滚动一个完整循环的时长（秒）。越短越快，越长越慢 */
  scrollDur: number;
  /** 水平滚动初始相位（秒，负值错开各层起始位置，避免同步） */
  scrollDelay: number;
  /** 上下浮动幅度（px），形成轻微涟漪感 */
  bobY: number;
  /** 上下浮动周期（秒），各层不同避免同相 */
  bobDur: number;
  /** 上下浮动相位（秒，负值错开） */
  bobDelay: number;
}

export const SEA_LAYERS: SeaLayerCfg[] = [
  // 海浪1（最前景，船前）：海1 —— 最快，最大，图底压屏幕外
  { src: 'assets/sea-1.webp', widthPct: 165, bottomVh: -4, opacity: 0.92, brightness: 1,    bottomFade: null,                        scrollDur: 45, scrollDelay: 0,     bobY: 8, bobDur: 7.5, bobDelay: 0,    widthPctMobile: 280, bottomVhMobile: -10, z: 6 },
  // 海浪2（第二层，船前）：海2 —— 次快
  { src: 'assets/sea-2.webp', widthPct: 158, bottomVh: 1,  opacity: 0.95, brightness: 0.97, bottomFade: { blackUntilPct: 95 }, scrollDur: 50, scrollDelay: -14,   bobY: 8, bobDur: 9.2, bobDelay: -2.4, widthPctMobile: 265, bottomVhMobile: -4,  z: 5 },
  // 海浪3（第三层，船后）：海3 —— 较慢
  { src: 'assets/sea-3.webp', widthPct: 150, bottomVh: 6,  opacity: 0.80, brightness: 0.88, bottomFade: { blackUntilPct: 95 }, scrollDur: 60, scrollDelay: -32,   bobY: 6, bobDur: 11.5,bobDelay: -5.1, widthPctMobile: 240, bottomVhMobile: 1,   z: 3 },
  // 海浪4（最后景，船后）：海4 —— 最缓
  { src: 'assets/sea-4.webp', widthPct: 142, bottomVh: 10, opacity: 0.65, brightness: 0.85, bottomFade: { blackUntilPct: 95 }, scrollDur: 100,scrollDelay: -58,   bobY: 5, bobDur: 14, bobDelay: -8.3, widthPctMobile: 215, bottomVhMobile: 4,   z: 2 },
];

/* ---------------- 博物馆 ↔ 船：共享定位与转场时间 ----------------
 * 博物馆与船必须共用同一套定位参数（水平中心 + 底部基准线 + 显示宽度），
 * 才能让点击博物馆时船在原位渐显、无跳动。所有手动调参集中在此处。
 *
 * 定位约定：
 *   - 水平中心：left:50% + translateX(-50%)，两者居中对齐
 *   - 底部基准线：bottom: var(--hero-bottom)，两者底部对齐
 *   - 显示宽度：width: var(--hero-width)，两者等宽
 */
export const HERO = {
  /** 共同显示宽度（博物馆与船一致） */
  width: 'min(82vw, 900px)',
  widthMobile: '92vw',
  /** 共同底部基准线（距视口底部 vh） */
  bottomVh: 14,
  bottomVhMobile: 10,
  /** 船渐显时长（秒）—— 从模糊放大渐显到清晰正常尺寸，与博物馆淡出互为镜像 */
  fadeInDur: 1.8,
  /** 博物馆淡出时长（秒）—— opacity 0 + 轻微放大模糊 */
  fadeOutDur: 1.5,
  /** 船入场起始模糊量（px）：从 blur(enterBlur) 渐变为 blur(0)。0 = 无模糊 */
  enterBlur: 20,
  /** 船入场起始放大倍数：从 scale(enterScale) 收敛到 scale(1)。1 = 无缩放 */
  enterScale: 1.5,
  /** 博物馆淡出与船渐显的重叠时长（秒）。
   *  船渐显起始时刻 = fadeOutDur - overlap。
   *  overlap 越大，两者同时可见的时间越长；为 0 则博物馆完全消失后船才出现。 */
  overlap: 0.7,
  /** 转场时博物馆页背景的压暗时长（秒）：米色纸纹先沉入夜色再随场景淡出，
   *  避免高明度米色直接切成深色水墨造成明度跳变。默认与 fadeOutDur 同长同节奏。 */
  bgDarkenDur: 1.5,
  /** 背景压暗目标亮度（brightness 滤镜终值）：1 = 不压暗，0 = 全黑。
   *  0.14 ≈ 米纸压到深炭色、云纹隐约可见；调大则压得轻、跳变感会回来一些 */
  bgDarkenTo: 0.14,
};

/* ---------------- 船体：尺寸/位置/乘风破浪摇晃 ----------------
 * 摇晃实现（第七轮重做）：
 *   旧实现用「关键帧 + 单条 ease 作用于每一段」，导致每个关键帧处速度都归零，
 *   船在左右极限处长时间停住、像钟摆一样机械。现改为每帧按公式求值的连续正弦：
 *     rotation = 主正弦（周期 period）+ 二次谐波（周期 period/2，制造两侧不对称，
 *                一侧较慢、一侧较快，消除匀速钟摆感）
 *     上下浮动 / 横向漂移 = 与主周期不同比值的正弦，错相叠加，增强浪涌感
 *   函数连续且严格以 period 为周期 → 循环无跳变、永不静止、速度自然变化。
 *   标题触发时刻直接按 period 计算（见 TITLE.delayCycles），改船速时标题自动同步。
 *
 *   想更"浪"：调大 swayAmp/sway2Amp；想更急：调小 period；
 *   想转向更利落：调小 sway2Amp（谐波越小越接近纯正弦、两侧越对称）、或调大 sway2Amp 增加不对称。
 */
export const BOAT = {
  /** 桌面显示宽度上限与 vw 宽度（第三轮：1.5×，让船成为视觉中心） */
  width: 'min(70vw, 1020px)',
  widthMobile: '92vw',
  bottomVh: 10,
  bottomVhMobile: 8,
  /** 旋转受力中心（船体中下部，避免绕远处点旋转） */
  originX: '50%',
  originY: '76%',
  /** 主摇晃周期（秒）：完整左右往复一次。越短摇晃越快、越有活力（旧实现为 8s 关键帧总长） */
  period: 3.4,
  /** 主摇晃最大角度（度）：船体沿主正弦左右各摆到 ±swayAmp */
  swayAmp: 2.4,
  /** 二次谐波幅度（度）：周期为 period/2，与主波叠加产生两侧不对称（一侧慢一侧快） */
  sway2Amp: 1.0,
  /** 二次谐波相位（弧度）：0 = 初始角度恰为 0、入场不倾斜；改动可偏移不对称的偏向 */
  sway2Phase: 0,
  /** 上下浮动幅度（px）：与左右摇晃叠加，模拟水面沉浮。增大 = 起伏更明显 */
  bobAmp: 14,
  /** 上下浮动周期比：浮动周期 = period × bobRatio（≠1 与摇晃错相，避免同频呆板） */
  bobRatio: 1.32,
  /** 横向轻微漂移幅度（px）：船不被海浪带走，仅有自主晃动 */
  driftAmp: 5,
  /** 横向漂移周期比：漂移周期 = period × driftRatio */
  driftRatio: 1.78,
};

/* ---------------- 船页标题（美工素材 + 出现时机/动画） ----------------
 * 素材为 1920×1080 整幅画布（pics/封面标题.png + pics/标题背景图层/帧1~7.png），
 * 以同一几何盒叠放（同 --title-* 定位/缩放），保持美工内部对位：
 *   标题背景层（.title-cloud 内 7 帧叠放，z9 第二高层级）
 *   标题文字层（.title-text，书法+印章，在 .sea-title z10 内 → 最高层级，位于背景之上）
 * 定位/缩放的变量由 main.ts 注入 :root，实际数值全部在此集中管理。
 *
 * 标题背景的出现方式（第九轮：帧序列 + GSAP 顺序播放）：
 *   最早用一次性 GIF 播放，但 GIF 的进度由浏览器时钟推进（素材仅 1.3s、无循环扩展），
 *   页面卡顿时跳帧直追末帧、同一 URL 的动画资源可能被复用为"已播完"状态 → 时好时坏；
 *   后改单张静态图 + 柔边遮罩揭开，但那版素材只有一团云、没有动态。
 *   现美工重出 7 帧序列：7 层 <img> 叠放同一几何盒，由 GSAP 时间轴依次淡入、
 *   帧帧保留不消失，最终叠合成完整背景——进度完全由时间轴驱动，
 *   没有播放时钟，不可能闪烁或定格。
 */
export const TITLE = {
  /** 桌面缩放：标题画布宽度 = scale × 100vw（1 = 画布恰为整屏宽，与 16:9 设计稿一致） */
  scale: 1,
  /** 移动端缩放：画布宽度 = scaleMobile × 100vw */
  scaleMobile: 1.9,
  /** 桌面整体平移（相对舞台左上角，CSS 长度）。例如 '6vw' 向右、'-4vh' 向上 */
  x: '-5px',
  y: '0px',
  /** 移动端整体平移 */
  xMobile: '0px',
  yMobile: '8vh',
  /** 标题背景每帧的启动间隔（秒）：相邻两帧淡入起点之间的时间。
   *  7 帧总叠加时长 ≈ (帧数-1) × bgFrameStep + bgFrameFade；
   *  当前 0.42 → 约 2.7s 全部叠完。想叠得更快就调小 */
  bgFrameStep: 0.32,
  /** 每帧淡入的时长（秒）：帧亮起后不再熄灭，全部保留叠合成完整背景。
   *  等于 0 则为瞬间出现；太大（接近 bgFrameStep）会整体发糊 */
  bgFrameFade: 0.22,
  /** 标题文字自上而下揭开的时长（秒） */
  textDur: 2.5,
  /** 文字相对背景开始的启动延迟（秒）：背景先出现，文字随后跟随揭开 */
  textDelay: 0.55,
  /** 标题触发延迟 = BOAT.period × delayCycles（船体跑完几个完整摇晃周期后标题才出现）。
   *  当前 2 = 船体跑完 2 个完整摇晃周期；改为 1 则第 1 个周期结束即出现 */
  delayCycles: 2,
  /** 文字揭开动画的裁切起点/终点（clip-path）：起点下方裁掉 100% = 完全不可见 */
  textClipFrom: 'inset(0% 0% 100% 0%)',
  textClipTo: 'inset(0% 0% 0% 0%)',

  /* ---- 印章（pics/印章.png → assets/stamp.webp）：盖在「城」字正下方，最后出现 ----
   * 触发时机自动计算：max(文字完成, 背景帧叠完) + stampDelay，标题全部显示完才盖章。
   * 位置/尺寸是标题 1920×1080 画布的百分比（与标题文字同一几何盒，缩放自动同步）。
   * 素材整幅 1200×800、印面在 x373-844/y3-770（含透明边），下方参数按整幅 img 标定：
   * 当前值使印面中心对齐「城」字中心（画布约 x300），印面顶贴「城」底（画布约 y938）。 */
  /** 印章 img 左边缘（% 画布宽） */
  stampLeft: 12.4,
  /** 印章 img 顶边缘（% 画布高） */
  stampTop: 86.6,
  /** 印章 img 高度（% 画布高，宽度按素材比例自动） */
  stampHeight: 9.5,
  /** 盖章动作：从 stampLift（自身高度的倍数）高处、放大 stampScaleFrom 倍快速砸下 */
  stampLift: 3.2,
  stampScaleFrom: 2.0,
  /** 下落时长（秒，power3.in 加速）：越短砸得越干脆 */
  stampDur: 0.56,
  /** 落地瞬间压扁的 scale（<1 = 砸扁过冲），随后弹性回稳到 1 */
  stampSquash: 0.83,
  /** 落地回稳时长（秒，elastic）：印章"墩"一下再稳住 */
  stampSettle: 0.75,
  /** 落地瞬间印泥增亮闪一下（brightness 峰值，1 = 不闪），随后 0.3s 回到 1 */
  stampFlash: 1,
  /** 距标题完全显示后的额外延迟（秒） */
  stampDelay: 0.05,
  /** 「下拉 · 随水而行」提示距印章落地后的延迟（秒）：印章墩稳后提示才浮现 */
  hintDelay: 1.4,
};

/* ---------------- 船载绳索（固定于最后一根桅杆顶部） ---------------- */
export const ROPE = {
  /** 最后一根（最右/最高）桅杆在 船.png 中的锚点（实测像素坐标，尖顶 890,42，绑扎点在桅饰下方） */
  anchorX: 890,
  anchorY: 152,
  /** 自由端坐标与绳结尺寸（1920×1080 坐标系）。自由端越过帆面右缘，
   *  挂入大帆与船舱之间的暗空区：绳结在深色背景上可辨，且高于近景浪线 */
  endX: 1255,
  endY: 505,
  knotW: 58,
  knotH: 74,
  knotSrc: 'assets/rope-knot.webp',
  /** 绳索相对桅杆的滞后钟摆（秒/度），相位与船体主摇晃错开 */
  duration: 6.4,
  times: [0, 0.2, 0.42, 0.62, 0.82, 1],
  rotation: [0, -5.2, 3.4, -2.2, 4.4, 0],
  strokeWidthDark: 13,
  strokeWidthMain: 7,
  strokeWidthHi: 2.2,
  strokeDark: '#47331e',
  strokeMain: '#b3894f',
  strokeHi: '#ddc58d',
};

/* ---------------- 云 ---------------- */
export interface CloudCfg {
  src: string;
  topVh: number;
  widthVw: number;
  opacity: number;
  duration: number;
  /** 负延迟让初始时刻云已分布在天空中 */
  delay: number;
  bobDur: number;
  bobY: number;
}

/* ---------------- 天气开关 ----------------
 * 第三轮起博物馆页不显示任何天气动画：以下两个数组即为博物馆页天气开关，
 * 置空 = 关闭（index.html 中也已移除对应容器）；
 * 如需开启，填入 CloudCfg/RainCfg 并在 index.html 的 #scene-museum 内恢复
 * <div class="clouds weather-clouds"> 与 <div class="rain weather-rain"> 容器。 */
export const MUSEUM_CLOUDS: CloudCfg[] = [];
export const MUSEUM_RAIN: RainCfg[] = [];

/** 海面场景：5 颗云（含新增云4），错落分布；周期较上一轮提速约 2 倍，
 *  透明度整体调高让云形可辨。云从标题（z10）与船（z4）后方掠过，不构成遮挡 */
export const SEA_CLOUDS: CloudCfg[] = [
  { src: 'assets/cloud-4.webp', topVh: -20,  widthVw: 50, opacity: 0.70, duration: 64, delay: -12, bobDur: 14, bobY: 12 },
  { src: 'assets/cloud-3.webp',  topVh: -3, widthVw: 30, opacity: 0.72, duration: 50, delay: -33, bobDur: 12, bobY: 9 },
  { src: 'assets/cloud-1.webp',  topVh: 2, widthVw: 45, opacity: 0.70,  duration: 40, delay: -22, bobDur: 10, bobY: 7 },
  { src: 'assets/cloud-2.webp',  topVh: 10,  widthVw: 37, opacity: 0.80,  duration: 35, delay: -5,  bobDur: 9,  bobY: 6 },
  { src: 'assets/cloud-3.webp',  topVh: 15, widthVw: 45, opacity: 0.38, duration: 30, delay: -17, bobDur: 8,  bobY: 5 },
  { src: 'assets/cloud-4.webp',  topVh: 12, widthVw: 70, opacity: 0.55, duration: 35, delay: -10, bobDur: 10,  bobY: 8 },
  { src: 'assets/cloud-1.webp',  topVh: 4, widthVw: 30, opacity: 0.60, duration: 32, delay: -30, bobDur: 8,  bobY: 5 },
];

/* ---------------- 雨（三层独立平移，非帧切换） ---------------- */
export interface RainCfg {
  src: string;
  duration: number;
  opacity: number;
  delay: number;
  /** 轻微缩放/横向覆盖差异制造纵深 */
  scale: number;
}

export const SEA_RAIN: RainCfg[] = [
  { src: 'assets/rain-1.webp', duration: 1.0, opacity: 0.14, delay: -0.2, scale: 1.08 },
  { src: 'assets/rain-3.webp', duration: 1.7, opacity: 0.07, delay: -0.8, scale: 1.22 },
];

/* ---------------- 实验交互（可独立开关，不影响已交付的开幕转场） ----------------
 * 两个效果均仅作用于博物馆开幕页的博物馆主体，进入船页面后自动失效。
 * 总开关 EXPERIMENT.enabled = false 即恢复原开幕页表现。
 * 触屏（pointer: coarse）与 prefers-reduced-motion 下自动降级为静态展示。
 */
export const EXPERIMENT = {
  /** 总开关：false 时两个实验效果均不启用，恢复原开幕页 */
  enabled: true,

  /* ---- 效果 A：博物馆伪 3D 晃动 ----
   * 在 #museum-trigger 内注入独立包装层 .museum-3d，承担 perspective + rotateX/rotateY + scale。
   * #museum-trigger 原有的 translateX(-50%) 定位与转场时 GSAP 的 scale/opacity 完全不受影响。
   * 倾斜方向：卡片向光标方向倾斜（光标在哪一侧，那一侧向前）。 */
  tilt3d: {
    enabled: true,
    /** rotateX 最大角度（度）：上下倾斜幅度 */
    maxTiltX: 4,
    /** rotateY 最大角度（度）：左右倾斜幅度 */
    maxTiltY: 5,
    /** 透视距离（px）：越小透视越强、倾斜越夸张 */
    perspective: 900,
    /** 跟随平滑系数（0~1）：越小越顺滑但越有惯性延迟 */
    ease: 0.14,
    /** 悬停轻微放大倍数（保留原有悬停反馈，合并进同一 transform） */
    hoverScale: 1.012,
    /** 离开后归位时长（秒） */
    leaveDur: 0.6,
  },

  /* ---- 效果 C：博物馆 2.5D 分层视差（最小实验，默认关闭） ----
   * 不切图、不改素材：把同一张 museum.webp 复制成若干条纵向「分带层」。第 1 条带（最上层区域）
   * 整幅不透明，作为不透明底层；其后每一条带从「自身顶部接缝」处淡入、并一直保持不透明。
   * 这样任意位置的合成 α 恒为 1（不露底、不依赖底层对齐、无重影），接缝处只混合相邻两层，
   * 静止时全部位移为 0 → 叠合结果 = 原图，初始视觉与修改前完全一致。
   * 开启方式：把 enabled 改为 true，或 URL 加 ?25d（同时会临时关闭 tilt3d 以便单看此效果）。
   * 注：museum.webp 为 1920×1080 透明边距素材（内容仅在 x 6.6%~90.7% / y 14.7%~80.3%），
   *     因此分带错位露出的边缘落在透明区，不会露出背景或穿帮。 */
  parallax25d: {
    enabled: true,
    /** 分带：from/to 为纵向百分比边界，weight 为视差强度（越大越「近」、位移越多）。
     *  必须按 from 升序、且首尾覆盖 0~100，相邻带共享边界（前一带的 to = 后一带的 from）。 */
    bands: [
      { from: 0, to: 37, weight: 0.3 },
      { from: 37, to: 59, weight: 0.62 },
      { from: 59, to: 100, weight: 1.0 },
    ],
    /** 每层最大水平位移（占宽度 %）：各层位移 = maxShift × weight */
    maxShift: 1.0,
    /** 接缝羽化半宽（占高度 %）：后一条带在 from ± feather 的范围内淡入、遮住前一条带 */
    feather: 6,
    /** 整幅「相机」水平漂移（占宽度 %）：随指针左右移动 */
    cameraX: 0.5,
    /** 整幅「相机」垂直漂移（占高度 %）：随指针上下移动 */
    cameraY: 0.5,
    /** 左右边缘羽化（占宽度 %）：0 = 不羽化（该素材边缘为透明，无需处理） */
    edgeFeather: 0,
  },

  /* ---- 效果 B：船图动态蒙版显露 ----
   * 在博物馆主体上叠加同尺寸（1920×1080）的船图层，用 CSS radial-gradient mask 跟随鼠标
   * 局部显露。船图原始透明度保留。蒙版边缘柔和、带少量拖尾。 */
  boatReveal: {
    enabled: true,
    /** 蒙版半径（占博物馆宽度的百分比） */
    radius: 30,
    /** 边缘柔和程度（0~1）：softness 比例的半径作为柔边过渡带 */
    softness: 0.5,
    /** 拖尾强度（0~1）：蒙版位置跟随的平滑系数，越小拖尾越长 */
    trailing: 0.2,
    /** 指针离开后的淡出时长（秒） */
    fadeOut: 0.5,
    /** 船图相对博物馆画布的整体缩放 */
    boatScale: 1,
    /** 船图水平偏移（% 画布宽），用于微调船在画框中的位置 */
    boatOffsetX: 0,
    /** 船图垂直偏移（% 画布高） */
    boatOffsetY: 0,
    /** 船图 object-fit：cover（铺满裁切）或 contain（完整显示留空） */
    boatFit: 'cover' as 'cover' | 'contain',
  },
};

/* ============================================================
 * 第二幕 · 通惠船：滚动驱动的 3D 船体揭幕（参考 moto-card.com 章节）
 *
 * 整体架构：
 *   项目用 overflow:hidden，没有真实 DOM 滚动——用 wheel/touch 事件驱动一个
 *   归一化进度值 progress ∈ [0,1]，映射到四个阶段：
 *     A 入场      [0.00, 0.15]  大船 2D 缩小淡出，3D 船体自下方渐显浮起
 *     B 节奏旋转  [0.15, 0.90]  关键帧曲线驱动的非匀速 360° 旋转
 *                               （停留 → 轻推蓄势 → 两段扫掠各带缓滞 → 收势落定）
 *     C 光影扫掠  与 B 同步     轮廓光随扫掠脉冲（高斯），主光入场爬坡
 *     D 定格交权  [0.90, 1.00]  收势定格，unlockAt 后解锁自由拖拽（不回弹不复位）
 *   进度是纯函数映射：正向推进、反向按相同区间恢复，任意位置跳转一致。
 *
 * 所有视觉参数集中在此；相关文件：
 *   src/act2/scrollController.ts — wheel/touch → 虚拟进度
 *   src/act2/placeholderShip.ts  — Three.js 中式古船 + 关键帧旋转 + 拖拽
 *   src/act2/act2Scene.ts        — 串联进度与阶段逻辑
 * ============================================================ */

/* ---------------- 博物馆页飞鸟群 ----------------
 * 独立层 .bird-sky（z 高于 museum-bg、低于博物馆图），
 * 每只鸟 = bird.webp（翅膀扇动）+ CSS keyframes 水平飞过（translateX + 微振幅 translateY）。
 * 所有视觉参数集中在此，运行时 JS 按此生成每只鸟的随机值。
 *
 * 飞行策略：鸟的 keyframes 全程横穿 120vw（保证从窗口外飞入、窗口外飞出不露馅），
 * 实际可见窗口由 `.bird-sky` 的 clip-path 控制（visibleStartVw / visibleEndVw），
 * 这样"飞行范围大小"只改这两个参数，不用动 keyframes 本身。 */
export const BIRDS = {
  /** 鸟的数量 */
  count: 10,
  /** 飞行高度范围（vh：相对视口顶部，非博物馆局部） */
  vTopMinVh: 23,
  vTopMaxVh: 50,
  /** 可见窗口左边界（vw）—— 鸟从这里开始进入视野（窗口外还有 offscreenPadVw 的不可见缓冲） */
  visibleStartVw: 0,
  /** 可见窗口右边界（vw）—— 鸟飞到这里开始离开视野 */
  visibleEndVw: 100,
  /** 窗口外侧不可见缓冲（vw）—— 保证飞入飞出不在可见边缘露馅 */
  offscreenPadVw: 15,
  /** 尺寸缩放范围：近大远小，暗示视差深度 */
  scaleMin: 0.6,
  scaleMax: 2,
  /** 飞行时长范围（秒）：远小鸟慢、近大鸟快，真实视差 */
  durMin: 10,
  durMax: 18,
  /** 起始延迟范围（秒，全负）—— 让鸟在 activate 时已经飞到轨迹中段，
   *  避免停在起始点等待；区间 [-durMax, 0] 覆盖所有可能的飞行时长 */
  delayMin: -14,
  delayMax: 0,
  /** 透明度范围：远景空气透视更淡 */
  opacityMin: 0.65,
  opacityMax: 0.95,
  /** 反向飞行概率（约 30% 鸟反向飞） */
  reverseProb: 0.4,
  /** 飞行轨迹上方微浮动振幅（px，CSS translate 叠加）—— 每只单独随机 */
  bobAmpMin: -16,
  bobAmpMax: -4,
  /** 飞行轨迹上方微浮动周期（秒）—— 与主飞行时长独立 */
  bobDur: 2.5,
};

/* ---------------- 卷轴式人物档案（第二幕章 3 当前阶段） ----------------
 * 独立卷轴模块 src/act2/scrollProfile.ts 使用。
 * 自动滚动用 requestAnimationFrame 驱动 content.scrollTop += pxPerFrame（初始 0.3px/frame ≈ 18px/s，极慢）；
 * wheel/touch/drag 手动时立即暂停并记录 lastInteractionTime；闲置 resumeDelay 秒后从当前速度渐变恢复。
 * 所有可微调参数集中在此，业务代码只读不写。 */
export const SCROLL = {
  /** 卷轴出现后停留多少秒再开始自动滚动（让用户先看清开头） */
  startDelay: 2,
  /** 自动滚动速度（px per frame @60fps）—— 0.3 ≈ 18px/s，非常慢，适合阅读 */
  autoPxPerFrame: 0.23,
  /** 每像素触发一次手动交互就暂停自动滚动；闲置多少秒后尝试平滑恢复 */
  resumeDelay: 3,
  /** 恢复自动滚动时，速度从当前 0 渐增到 autoPxPerFrame 的时间（秒） */
  resumeRampSec: 1.2,
  /** 自动滚动是否循环—— false = 到底平稳停止（推荐） */
  loop: false,
  /** 卷轴容器相对视口的尺寸与位置 —— 已改为「16:9 美术画布」方案，
   *  卷轴位置由美工素材（卷轴纸/上轴/下轴）在 1920×1080 整屏画布中的预排坐标决定：
   *  纸面 bbox x 6.0%–40.1%、y 23.5%–84.3%；上轴 y 16.9%–23.7%，下轴 y 84.1%–90.9%；
   *  三张透明 PNG 铺满同一 16:9 画布即严格对位（不再用 CSS 占位形状）。 */
  art: {
    /** 桌面画布高度（vh）：16:9 画布高度随屏高，宽度 = 高 × 16/9（可能超出视口，卷轴固定在左侧） */
    canvasHeightVh: 100,
    /** 移动端画布高度（vw）：令上下轴总宽 ≈ 92vw（轴宽占画布 42.1%） */
    canvasHeightVwMobile: 123,
    /** 纸面内文区（相对画布宽/高的百分比，已含装饰边框内缩） */
    viewport: { leftPct: 8.9, rightPct: 63.6, topPct: 28.6, bottomPct: 20.8 },
    /** 纸面在画布内的上下边界（% 画布高，美工素材 alpha 实测）：
     *  卷轴展开时上边界固定、下边界自上而下推进 */
    paperTopPct: 23.52,
    paperBottomPct: 84.26,
    /** 下轴顶边（% 画布高）：展开时跟随纸面下缘下落，最终停在此处 */
    rodBottomTopPct: 84.07,
  },
  /* —— 卷轴展开（上轴固定、纸面自上而下揭开、下轴随下缘落下）——
   * 纸面用 clip-path 揭示、下轴用 yPercent 跟随，两者由同一进度 p 驱动、边缘严格贴合；
   * 展开到 textAt 时正文才淡入，避免文字浮在尚未展开的纸上。
   * 自动滚动起点同步顺延 durationSec，保证"展开完成后再停留 startDelay 秒"才滚动。 */
  unfold: {
    /** 总开关：false = 恢复原来的静态淡入 */
    enable: true,
    /** 展开时长（秒） */
    durationSec: 1.0,
    /** 展开缓动：前段慢、后段略快，"纸被拉开"的手感 */
    ease: 'power2.inOut',
    /** 正文开始淡入的展开进度 [0,1] */
    textAt: 0.7,
    /** 正文淡入时长（秒） */
    textFadeSec: 0.45,
  },
  /** 正文字号（px） */
  bodyFontSize: 16,
  /** 正文行高（倍） */
  bodyLineHeight: 1.9,
  /** 分组标题字号（px） */
  groupFontSize: 18,
  /** 分组标题上/下间距（px） */
  groupMarginTop: 36,
  groupMarginBottom: 14,
  /** 字段名称（姓名/年龄/…）字号与颜色 */
  fieldLabelSize: 13,
  fieldLabelColor: '#8a7b5e',
  /** 字段值与字段名之间的间距（px） */
  fieldValueGap: 6,
  /** 字段之间的间距（px） */
  fieldGap: 16,
  /** 船体让位（卷轴出现时船让出左侧空间并略下沉，与卷轴构图协调）——
   *  横向：camera.setViewOffset 做成像平移（占屏宽比例），纯二维、完全不改变船的投影形状；
   *        0.30 ≈ 船心从画面 47% 推到 77%，想更靠右就调大、更靠左就调小。
   *  纵向：世界坐标 y 负值 = 下移（世界单位，屏高约 6.9 个单位）。 */
  boatViewShiftPct: 0.24,
  boatShiftYWorld: -0.5,
  boatShiftDur: 0.7,
};

export const ACT2 = {
  /* ---------- 进度区间（归一化 0→1）——「沉入暮色 → 黑暗中升起」＋ moto-card 式轻摆 ----------
   *   0.00–0.10  海页环境（标题/云/雨/浪/背景）简化淡出
   *   0.02–0.20  2D 船：缩小（1→0.55）＋ 下沉至船底贴住屏幕底缘 ＋ 轻微倾斜（easeIn）
   *   0.10–0.22  2D 船变暗（brightness 1→0.25）：沉入暮色成剪影，而非透明消失
   *   0.30–0.45  2D 船淡出归零（3D 船已升过它，不留残影）
   *   0.20–0.34  3D 船在屏幕底部渐显（与 2D 船变暗尾部交叠 = 交接缝）
   *   0.20–0.50  3D 船从视口底缘之下缓缓上升 ＋ 变大（0.7→1）——旋转从上升首帧同步启动
   *   0.20–0.96  连续 360° 节奏旋转（全程无停顿）：缓起 → 加速 → 两次带缓滞的主扫掠 → 收势落定
   *   0.96–1.00  定格；0.96 解锁自由拖拽（回锁时拖拽角平滑归零，定格姿态恒定一致）
   * ---------------------------------------------------------------- */

  /* ---------- 预载（GLB 解析/法线重建/着色器预热全部前置到首屏预载阶段，开场零卡顿） ---------- */
  preload: {
    /** 进度条合并权重：GLB（52MB）与图片素材并行预载时 GLB 的进度占比 */
    glbWeight: 0.65,
    /** GLB 下载字节进度占其份额的比例（剩余份额留给解析 + 法线重建 + 着色器预热） */
    glbDownloadShare: 0.9,
  },

  /* ---------- 虚拟滚动控制器（连续模式参数；第二幕已改用章节模式，见下方 chapters） ---------- */
  scroll: {
    wheelFactor: 0.0035,
    maxDeltaPerFrame: 0.015,
    ease: 0.12,
    touchFactor: 0.0008,
  },

  /* ---------- 章节化滚动（opxy 式"滚一下 = 自动播完一章"）----------
   * 第二幕交互骨架：每次 wheel/swipe 只推进一章，由固定时长 tween 自动播完，
   * 期间正向输入忽略（(a) 锁），反向输入允许打断回退到本章起点。
   * 章节边界取时间轴关键帧；所有已调好的进度纯函数映射不变，只换"油门"：
   *   章 1（0 → boundary1）   沉暮 → 升起：2D 退场 + 3D 入场转场
   *   章 2（boundary1 → 1）   旋转展示 → 定格 + 「通惠」标题浮现
   *   章 3（beginIntro）      推近 → 掠过 → 重构图 → 停稳 → 介绍文字（独立相机时间轴）
   * 反向滚：章 3 打断（cancelIntro 回位）；章 1/2 播放中打断 = 从当前位置回本章起点；
   * 完成态反向 = 反向播放上一章。停留点序列：0 → 0.5 → 1.0（定格）→ 阅读。 */
  chapters: {
    /** 章 1 终点 = 转场完成点（3D 船入场 moveEnd 对齐 0.50） */
    boundary1: 0.50,
    /** 章 1（转场）时长（秒）：沉暮升起较从容，参考 opxy 单段 1.5-2.5s、转场信息量大放慢 */
    durTransition: 2.2,
    /** 章 2（旋转展示→定格→标题）时长（秒）：与章 1 等长使交界速度无缝衔接
     *  （两段进度跨度均 0.5，章 1 末端峰值速度 = 章 2 首端峰值速度） */
    durRotation: 2.2,
    /** 正向连播：章 1 转场自然播完自动接章 2 旋转，一次滚动直达定格（中间不停顿：
     *  章 1 加速进场、章 2 从峰值速度全程减速，交界处速度连续无落停）。 */
    autoChainChapter2: true,
    /** 反向连播：定格态一次反向滚动连续播完回退两段直达船页（1.0→0.5→0，
     *  0.5 仅为播放中的路径路标不再停留；关闭则恢复两步回退，0.5 处停一章） */
    autoChainBackward: true,
    /** 章 1 转场正向缓动：power1.in 全程加速，末端达峰值速度 → 与章 2 首速度无缝交接
     *  （旧 inOut 在 0.5 交界减速归零，形成"船到中心先落停再转"的定格感，已去除） */
    easeRise: 'power1.in',
    /** 章 2 旋转正向缓动：power1.out 从峰值速度开始全程减速，扫掠自然收进定格 */
    easeSpin: 'power1.out',
    /** 反向回退缓动 */
    easeBackward: 'power1.inOut',
    /** 一次章节触发后的输入冷却（毫秒）：吞掉触控板惯性尾巴，防误触发下一章 */
    wheelCooldownMs: 500,
    /** 移动端一次滑动触发一章的位移阈值（px）：一次手势只触发一次 */
    touchSwipePx: 40,
  },

  /* ---------- 海页环境简化淡出（船的沉暮交接是转场主体） ---------- */
  envFade: {
    /** 环境元素开始 / 完全淡出的进度 */
    start: 0.0,
    end: 0.16,
  },

  /* ---------- 2D 大船退场：缩小＋沉底＋倾斜（easeIn）→ 变暗成剪影 → 淡出归零 ---------- */
  exit: {
    /** 缩放/下沉/倾斜区间（easeIn：加速下沉；整体放慢节奏） */
    start: 0.02,
    end: 0.30,
    /** 缩小到的目标比例 */
    targetScale: 0.55,
    /** 下沉距离（vh）：船底贴住屏幕底缘（含 scale 缩小引起的底部上抬补偿） */
    sinkVh: 70,
    /** 船身倾斜角度（度）：轻微侧倾，不做整圈旋转（避免 PPT 感） */
    tilt: 5,
    /** 变暗区间与目标亮度（CSS filter brightness，剪影化而非透明化） */
    dimStart: 0.14,
    dimEnd: 0.34,
    dimBrightness: 0.25,
    /** 淡出归零区间（3D 船升到中心之后，交接完成不留残影） */
    fadeStart: 0.42,
    fadeEnd: 0.62,
  },

  /* ---------- 3D 船体揭幕时间轴（滚动进度 → 姿态/灯光的纯函数映射） ---------- */
  reveal: {
    /* —— 阶段 A：入场（黑暗中升起 → 揭幕落定，两段分离） —— */
    entrance: {
      /** 3D 船体渐显区间（与 2D 船变暗尾部交叠） */
      fadeStart: 0.20,
      fadeEnd: 0.34,
      /** 位置/缩放区间：从视口底缘之下升起 → 屏幕中心展示位（easeOut，放慢节奏） */
      moveStart: 0.20,
      moveEnd: 0.50,
      /** 入场起始缩放（变大段 0.6→1，线性铺满上升区间，由小变大全程可感） */
      fromScale: 0.4,
      /** 入场起始下沉量（相对模型自身高度比例）：完全藏到视口底缘之下
       *  （按模型自身高度换算：约 1.6 倍模型高即可完全沉到视口底缘之下，取 1.75 留余量） */
      fromYRatio: 1.75,
    },

    /* —— 阶段 B：偏航关键帧 [progress, 角度°]，单调三次插值（Fritch–Carlson）。
     *    钟形弧线节奏：缓起 → 加速 → 主扫掠峰值 → 缓滞 → 渐进减速 → 定格。
     *    升船第一帧（0.20）即开始转，升船与旋转并行，彻底消除"两阶段感"：
     *    · 缓起 0.20–0.28：船刚露出来就慢转（眼球注意到"动了"）
     *    · 加速 0.28–0.50：船升 2/3 → 升到中心（67°），与入场同步
     *    · 主扫掠 0.50–0.78：两段快扫（193→280→375），船到中心瞬间接峰值，不中断
     *    · 收势 0.78–0.96：渐进减速落定 443°（= 83° + 360，完整一周；定格姿态=用户参考图：
     *      船首弧线朝画面左前、帆面大半可见、木桨斜伸左下、右后舵板可见的 3/4 视角，
     *      已实测比对 p=0.75（yaw 83°）截图确认）
     *    起始角 126°、落定角 443° 恒定 → 每次刷新/每次经过展示，起点与定格完全一致 —— */
    yawKeys: [
      [0.00, 126],
      [0.20, 126],
      [0.28, 132],
      [0.40, 158],
      [0.50, 193],
      [0.62, 280],
      [0.78, 375],
      [0.90, 430],
      [0.96, 443],
      [1.00, 443],
    ] as [number, number][],

    /* —— 俯仰关键帧：上升段平稳（8→6），主扫掠期间 ±3° 小幅起伏加"呼吸感"
     *    （非单调数据，极值点自然减速） —— */
    pitchKeys: [
      [0.0, 8],
      [0.36, 6],
      [0.56, 12],
      [0.70, 6],
      [0.84, 11],
      [0.96, 0],
      [1.0, 0],
    ] as [number, number][],

    /* —— 阶段 D：解锁自由拖拽的进度（解锁后不回弹、不复位、不自动旋转）
     *    必须与 yawKeys 的定格点（0.96）对齐：船停稳的瞬间即交出控制权，
     *    若晚于定格点，用户在船停稳时停止滚动就永远差一点、hover/拖拽无响应 —— */
    unlockAt: 0.96,

    /* —— 阶段 D+：定格后的「呼吸悬浮」—— 船只静静悬浮水面的轻微起伏 ——
     * 实现约定：只写独立 floatGroup.position.y（scene→floatGroup→modelGroup→fitGroup），
     * 与入场(fitGroup)/旋转(modelGroup)/相机视差零属性冲突；
     * 拖拽时冻结相位（偏移保持恒定，完全静止），松手从冻结相位无缝续摆；
     * 反向滚回重新上锁时，包络平滑衰减到 0，时间轴完全接管 —— */
    bob: {
      /** 浮动幅度：模型显示高度的比例（0.005–0.01 = 克制呼吸感，≥0.02 开始像弹跳） */
      heightRatio: 0.012,
      /** 呼吸周期（秒）：一次完整上浮 + 回落 */
      period: 4,
      /** 进入/退出浮动的包络时间常数（秒）：越大淡入淡出越缓 */
      easeTau: 0.8,
    },

    /* —— 阶段 D 文字收尾：「通惠」书法字 + 「了解通惠」按钮 ——
     * 书法字（通/惠 GIF）的入场延时在下方 fonts 段独立管理（定格后延时，先通后惠），
     * 此处只保留按钮参数：与书法字同一套「定格后延时」机制，反向离开定格即撤销/隐藏 —— */
    title: {
      /** 「了解通惠」按钮延时入场（秒，相对定格，支持负值 = 定格前出现）。
       *  等惠字写完再出现 → 需 ≥ fonts.huiDelaySec + fonts.huiSwapAtSec（惠写完定格），再留点喘息 */
      btnDelaySec: 8.5,
      /** 按钮淡入时长（秒） */
      btnFadeInSec: 0.6,
      /** 初始模糊(px)与下移(px)：像从空气与水汽中慢慢浮现（按钮浮现语言） */
      fromBlurPx: 12,
      fromOffsetY: 10,
    },

    /* —— 书法字层（通/惠 GIF 书写动画）：替代原衬线体「通惠」文字标题 ——
     * 两张 16:9 整幅透明底 GIF，字位已由美工按画布预排（通左上、惠右下，对角环抱船身）；
     * 夹心层级：通在 3D 画布之下、惠在画布之上（index.html 两个 .act2-fonts-layer 的 DOM 位置决定）；
     * 播完 swap 到预加载静帧：tong 不循环播完即定格，hui 带循环标志须在重启前换掉防闪。 */
    fonts: {
      /* —— 先通后惠：两字独立延时入场，秒数以「船定格瞬间」为 0 基准 ——
       * ≥0：定格后排计时器，到点淡入 + 起播书写 GIF；
       * <0：定格前 N 秒出现（旋转收势段），内部换算成进度阈值触发；
       * 退到各自阈值下：撤销未触发的计时、摘除已挂载的字，重回重新计时重播。
       * 惠要等通写完（3.2s）再出现 → huiDelaySec ≥ tongDelaySec + 3.2（再留点喘息更好）。 */
      /** 「通」入场延时（秒，相对定格）：6.9 = 定格后等浪花 GIF 播完（props.wave 起播 +2.08 ~ 播完 +6.89）再开始书写 */
      tongDelaySec: -0.5,
      /** 「惠」入场延时（秒，相对定格）：10.3 = 通写完（6.9+3.2=10.1）后再停 0.2s */
      huiDelaySec: 2.9,
      /** 两字共用的淡入时长（秒）：淡入与起播同步开始 */
      fadeInSec: 0.7,
      /** 「通」书写 GIF / 静帧 / swap 时机（秒，不循环：播完即换）
       *  tong-font-fast.gif 为原 GIF 的 0.65 倍速版（帧延迟 60ms→40ms，像素逐帧一致），
       *  想再调速度：python3 重新生成变体后同步改 tongSrc + tongSwapAtSec */
      tongSrc: 'assets/tong-font-fast.gif',
      tongStill: 'assets/tong-font-still.webp',
      tongSwapAtSec: 3.2,
      /** 「惠」书写 GIF / 静帧 / swap 时机（秒，带循环：须在 4.1s 重启前换掉） */
      huiSrc: 'assets/hui-font.gif',
      huiStill: 'assets/hui-font-still.webp',
      huiSwapAtSec: 4.05,
      /** 整体缩放（1 = 16:9 画布高 = 屏高，与船体同按屏高定尺寸，任何窗口比例下环抱构图不走样） */
      scale: 1,
      /** 整体偏移（px，正右/正下） */
      xPx: 0,
      yPx: 0,
    },

    /* —— 展陈道具 + 浪花（背景角色序列）——
     * 素材均为 1920×1080 的 16:9 透明画布，位置由美工按画幅预排 → 代码零位移参数，
     * 直接铺满与字体层同一几何盒即可严格对位。
     * 时间基准：anchorSec = 相对「船定格瞬间」的秒数，锚点取 3D 船开始上升（reveal.moveStart）。
     *   anchorSec + 各项 delaySec 为负 → 换算成滚动进度阈值（连播路径下秒数精确）；
     *   为正 → 定格后排计时器。退到阈值下自动撤销计时并隐藏，重进重播。
     * 层级：整体位于 3D 船体之下（背景角色）；浪花单独一层，压在「通」之下。
     * 透明度：groupOpacity 分组控制（展柜一组、陶罐一组），罐子作为远景角色可压低。 */
    props: {
      enable: true,
      /** 锚点：船开始旋转上升的瞬间（reveal.moveStart = 0.20 → 连播下为定格前约 3.52s） */
      anchorSec: -3.52,
      /** 单个道具升起时长（秒）：从下方浮起 + 淡入 */
      riseDurSec: 0.5,
      /** 升起起始位移（% 几何盒高，正值 = 从下方升起；0 = 原地淡入） */
      riseFromYPercent: 22,
      /** 展柜「由小变大」入场：起始缩放（1 = 关闭）。
       *  两张展柜素材是左右对称的环境框，视觉中心恰在画布正中，
       *  因此统一以画布中心为轴心缩放，不会产生任何位移。 */
      caseScaleFrom: 0.20,
      /** 展柜「渐显」：在缩放/升起之外独立叠加的透明度补间。
       *  缩放仍按各展柜自己的 riseDurSec 播放，透明度从 0 延后 caseFadeDelaySec 起淡、
       *  经 caseFadeDurSec 淡到 groupOpacity.case —— 视觉上是「先成形、再显影」。 */
      caseFadeDelaySec: 0.15,
      caseFadeDurSec: 1.1,
      /** 罐子落位后的轻晃：到达位置后以罐底为轴心衰减摆动一下再停稳。
       *  各罐到达时间本就相隔 0.2s，摆动自然错开；方向按序列左右交错，避免齐晃。 */
      jarSettle: {
        enable: true,
        /** 起始摆角（度）：摆幅按 (1-u)^decay 衰减。
         *  实际可见峰值 ≈ angleDeg × 0.645（首个 sin 峰 u≈0.167 时振幅已衰到 0.645 倍）。
         *  罐子素材高矮差异大（jar-3 高 21% 画布、jar-5 高 70%），按角度统一，
         *  高罐摆得明显、小罐只轻轻一颤 —— 想整体更明显就调大，想更含蓄调小。 */
        angleDeg: 4.0,
        /** 摆动总时长（秒） */
        durSec: 0.9,
        /** 摆动半周数：3 ≈ 左 → 右 → 左 后归零 */
        swings: 3,
        /** 衰减指数：越大收得越快 */
        decay: 2.4,
        /** 罐底旋转轴心（占画布宽 / 高百分比，素材 alpha 实测）：
         *  每张素材的罐子在画布内位置不同，轴心必须落到各自的罐底，
         *  否则旋转会绕画布中心、把罐子甩出去。 */
        origins: {
          'jar-1': [7.24, 79.44],
          'jar-2': [17.79, 70.46],
          'jar-3': [23.85, 65.93],
          'jar-4': [29.9, 61.57],
          'jar-5': [91.59, 78.33],
          'jar-6': [82.63, 70.56],
          'jar-7': [75.13, 65.28],
          'jar-8': [70.6, 60.09],
        } as Record<string, [number, number]>,
      },
      /** 分组整体不透明度（0-1）：case = 展柜 1/2，jar = 陶罐 1-8。
       *  素材为高明度白描，满不透明会抢船体与书法字的视觉重心；压低罐子让其退回远景。 */
      groupOpacity: { case: 1, jar: 0.30 },
      /** 道具序列（数组顺序 = DOM 叠放顺序，越后越靠前；delaySec 相对锚点） */
      items: [
        { key: 'case-1', src: 'assets/prop-case-1.webp', delaySec: 0, riseDurSec: 1.3 }, // 与船同步升起
        { key: 'case-2', src: 'assets/prop-case-2.webp', delaySec: 1.0 },
        { key: 'jar-1', src: 'assets/prop-jar-1.webp', delaySec: 1.0 }, // 与展柜 2 同刻
        { key: 'jar-2', src: 'assets/prop-jar-2.webp', delaySec: 1.2 },
        { key: 'jar-3', src: 'assets/prop-jar-3.webp', delaySec: 1.4 },
        { key: 'jar-4', src: 'assets/prop-jar-4.webp', delaySec: 1.6 },
        { key: 'jar-5', src: 'assets/prop-jar-5.webp', delaySec: 1.8 },
        { key: 'jar-6', src: 'assets/prop-jar-6.webp', delaySec: 2.0 },
        { key: 'jar-7', src: 'assets/prop-jar-7.webp', delaySec: 2.2 },
        { key: 'jar-8', src: 'assets/prop-jar-8.webp', delaySec: 2.4 },
      ],
      /** 浪花双段：与「通」同步起播（delaySec 与 fonts.tongDelaySec 同基准——
       *  相对「船定格瞬间」的秒数，不走 anchorSec 锚点）。
       *  第一段浪花1 播一遍 → 末尾立刻接浪花2 → 浪花2 由 loop2 决定循环或定格。
       *
       *  素材是逐帧 WebP（public/assets/wave/）：由美工 GIF 拆帧转码，保留透明通道，
       *  13 帧共 636KB。播放走 canvas 时间轴，所有浏览器同一条路径，
       *  不依赖 WebCodecs —— Safari/Firefox 也读得到下面全部参数
       *  （此前"GIF 直读 + 无 ImageDecoder 回退 MP4"的方案在 Safari 里永远不认参数）。 */
      wave: {
        /** 第一段帧序列（原 浪花1.gif 的 9 帧，末帧与第二段首帧严丝合缝） */
        frames1: [
          'assets/wave/w1-1.webp', 'assets/wave/w1-2.webp', 'assets/wave/w1-3.webp',
          'assets/wave/w1-4.webp', 'assets/wave/w1-5.webp', 'assets/wave/w1-6.webp',
          'assets/wave/w1-7.webp', 'assets/wave/w1-8.webp', 'assets/wave/w1-9.webp',
        ],
        /** 第一段素材原帧时长（毫秒）：与 GIF 一致 100ms/帧 */
        frameMs1: 100,
        /** 第一段倍速：每帧停留 = frameMs1 ÷ speed。
         *  1 → 100ms/帧（整段 0.9s）；0.5 → 200ms（1.8s）；0.25 → 400ms（3.6s）；
         *  0.1 → 1000ms（整段 9s）；0.05 → 2000ms（18s） */
        src1Speed: 0.6,
        /** 第二段帧序列（原 浪花2.gif 的 4 帧） */
        frames2: [
          'assets/wave/w2-1.webp', 'assets/wave/w2-2.webp',
          'assets/wave/w2-3.webp', 'assets/wave/w2-4.webp',
        ],
        /** 第二段素材原帧时长（毫秒）：与 GIF 一致 250ms/帧 */
        frameMs2: 250,
        /** 第二段倍速：每帧停留 = frameMs2 ÷ speed。
         *  1 → 250ms/帧（整段 1s）；0.5 → 500ms（2s）；0.1 → 2500ms（10s） */
        src2Speed: 1,
        /** 第二段是否循环：true = 无限循环（直到进阅读页 / 退出定格）；
         *  false = 播完一遍定格在末帧 */
        loop2: true,
        delaySec: -1,
        /** 起播淡入时长（秒） */
        fadeInSec: 0.5,
        /** 浪花整体不透明度（0-1）：压低可让水花更含蓄、更多透出船体；
         *  0.85 近乎全遮船体，0.5-0.6 时船帆与船底细节仍可辨 */
        opacity: 0.45,
      },
    },

    /* —— 阶段 E：角色介绍阅读态（滚动推进到章 3 / 点击「了解通惠」触发）——
     * 无相机运动：由 placeholderShip.beginIntro() 瞬时切入阅读态，
     * 船体保持当前定格姿态，拖拽/悬停/呼吸不中断，直接浮现环绕气泡（见 ACT2.dialogue）。 */

    /* —— 阅读态清场：亮相页专属背景（展陈道具 + 浪花）在进入阅读页后淡出，
     *    让卷轴与 3D 船落在纯黑背景上；反向退回定格时再淡回。 —— */
    readBackdrop: {
      /** 淡出/淡回时长（秒）：与标题、按钮退场同节奏，避免生硬切黑 */
      fadeSec: 0.5,
    },

    /* —— 阶段 C：灯光 —— */
    /** 主光/补光/半球光入场爬坡区间（0.45 倍 → 1 倍），与 3D 船渐显同步点亮 */
    lightRamp: [0.20, 0.32] as [number, number],
    /** 轮廓光（背光）：基础强度 + 随摆动到极值的高斯脉冲 = "光扫过卡面" */
    rimLight: {
      color: 0xdce8ff,
      /** 位置：左后上方，勾出船体背缘轮廓 */
      position: [-5, 3, -5] as [number, number, number],
      baseIntensity: 0.55,
      /** 脉冲 [中心进度, 宽度σ, 峰值]：对准两段主扫掠与收势，"扫光掠过船身" */
      pulses: [
        { center: 0.64, width: 0.055, peak: 1.8 },
        { center: 0.81, width: 0.055, peak: 1.8 },
        { center: 0.93, width: 0.06, peak: 1.1 },
      ],
    },
  },

  /* ---------- Three.js 3D 通惠船 ---------- */
  model: {
    /* —— 相机：标准焦段（42°）——
     * 船体在阅读态右移后若仍盯着世界原点，会因偏离光轴被横向透视压缩（越靠边越"瘪"）。
     * 现改为「视轴跟随船体」：placeholderShip.update 每帧 lookAt 船体世界 x，
     * 船的形状与「船在画面正中」时完全一致（长焦拉远只能减小压缩，做不到归零）。
     * 屏幕位置偏移留给下一步用 camera.setViewOffset 做纯二维成像平移（不改变形状）。
     * 约束：改 fov 时必须同步按 k 倍改 cameraZ 与 cameraY（y/z 比决定俯视角，
     * 保持 2/9 的机位高度比例，否则观船俯角会变）。 */
    fov: 42,
    cameraZ: 9,
    /** 机位高度（世界单位）：保持 12.5° 俯视角度 */
    cameraY: 2.0,
    /** 【尺寸主参数】模型包围盒高度占屏幕高度的目标比例（产品展示区间 0.35–0.50）。 */
    screenHeightRatio: 0.80,
    /** 宽度保护：模型宽度不超过屏宽 × 此值（窄屏不被裁切） */
    maxWidthRatio: 0.72,
    /** 模型整体额外缩放微调（1 = 按包围盒自动适配） */
    scale: 1,
    /** 初始姿态基准（= yawKeys 入场起始角，落定角由 yawKeys 收势决定） */
    initRotY: 126,
    initRotX: 8,
    ambient: 0.62,
    keyLightIntensity: 1.5,
    keyLightColor: 0xfff2d4,
    fillLightIntensity: 0.5,
    fillLightColor: 0x88aacc,
    /** 正式模型 GLB（public/assets，美工交付；后续彩色版直接覆盖同名文件即可生效） */
    glbUrl: './assets/tonghui-boat.glb',
    /** true = 仍用程序化占位船（对比/兜底）；false = 加载正式 GLB 模型 */
    usePlaceholder: false,
    /** 材质中和：GLB 无环境贴图，metal=1 部件在直接光下会发黑——临时压低金属度保底可视；
     *  美工彩色版交付后如需保留金属质感，关闭此项或放宽阈值 */
    materialFix: { enable: false, maxMetalness: 0.25, minRoughness: 0.55 },
  },

  /* ---------- 鼠标/触摸拖拽旋转（仅在 unlockAt 解锁后生效） ---------- */
  rotation: {
    horizontalSensitivity: 0.35,
    verticalSensitivity: 0.25,
    minRotX: -55,
    maxRotX: 55,
    dragCursor: 'grab',
    draggingCursor: 'grabbing',

    /* —— 悬停跟随（鼠标滑过时轻微转动，有牵拉感，幅度远小于拖拽）—— */
    /** 悬停最大偏航角（度）：光标移到容器左右边缘时的最大 Y 偏转 */
    hoverYawMax: 15,
    /** 悬停最大俯仰角（度）：光标移到容器上下边缘时的最大 X 偏转 */
    hoverPitchMax: 15,
    /** 速度前馈强度：光标移动速度带来的额外"被拽过头"量（牵拉感强弱） */
    hoverLead: 0.35,
    /** 弹簧刚度 k：越大跟得越紧（k≈55、阻尼≈11 时为轻微过冲的快跟随） */
    hoverStiffness: 55,
    /** 弹簧阻尼 c（单位 1/s）：越大回弹越干脆、过冲越小（临界值 ≈ 2√k） */
    hoverDamping: 5,
    /** 悬停偏移的角度上限（度，绝对值；防止速度前馈瞬时过冲过大） */
    hoverClamp: 40,
    /** 停止移动多久后开始回弹（秒）：0 = 停下立即回弹 */
    hoverIdleDelay: 0.4,
    /** 回弹过程时长（秒）：悬停目标从当前值衰减到 0 的时间 */
    hoverIdleFade: 0.6,

    /* —— 悬停视差增益（立体空间感）—— */
    /** 相机随光标的水平视差位移（世界单位，正数使模型有轻微环绕感） */
    parallaxX: 0.4,
    /** 相机随光标的垂直视差位移 */
    parallaxY: 0.22,
    /** 悬停时的轻微滚转（度）：跟随水平偏移产生侧倾 */
    hoverRoll: 3,
    /** 视差跟手的弹簧刚度 */
    parallaxStiffness: 40,
    /** 视差弹簧阻尼 */
    parallaxDamping: 9,
  },

  /* ---------------- 卷轴阅读态自转展示（柜台式 360° 水平慢转） ----------------
   * 仅在阅读态生效：beginIntro（进卷轴页）缓入启动，cancelIntro（回滚退出）停止；
   * 独立自转通道 spinYaw，与时间轴/拖拽/悬停/点按各旋转层并列叠加、互不污染；
   * 呼吸浮动（reveal.bob）与自转不同轴，叠加保留。 */
  spin: {
    /** 总开关：false = 卷轴页恢复为静止 + 拖拽/悬停跟随的原有行为 */
    enable: true,
    /** 自转角速度（度/秒）：5 ≈ 72 秒一圈，柜台慢展感 */
    degPerSec: 15,
    /** 启动/停止速度包络时长（秒）：0→全速 / 全速→0 线性渐变，避免突兀启停 */
    rampSec: 1,
    /** 进入阅读态时若定格角被用户拖拽改变，先平滑回到定格姿势（443°）再启动自转：回位时长（秒） */
    returnSec: 0.8,
    /** 退出阅读态时把自转角补间回最近 360° 整数倍的时长（秒）——等价回到定格基准姿势 */
    settleSec: 0.8,
  },

  /* ---------------- 章3 角色介绍对话（气泡 + 点按推进 + 悬停反馈） ----------------
   * 参数集中在此，业务代码只读不写。 —— */
  dialogue: {
    /* —— 对话框入场/退场（素材：assets/dialogue1~7.webp，按纸面正文区缩放后贴船左右上下分列） —— */
    bubbleIn: 1.3,      // 对话框整体淡入时长（秒）
    bubbleOut: 0.28,     // 旧对话框淡出时长
    bubbleRise: 10,      // 浮现初始下移 px
    bubbleBlur: 6,       // 浮现初始模糊 px
    padPx: 14,           // 对话框距视口边缘最小留白
    /* —— 尺寸与落位（左右左右左右左 / 上中下上中下上） —— */
    gapPx: 12,           // 纸面正文区与船体包围盒的水平间距（右侧组）
    leftShiftPx: 160,    // 左侧组额外右移量 px（右侧组不动）
    bodyVw: 0.18,        // 纸面正文区宽度 = 屏宽 × 该比例（宽屏）
    bodyMaxPx: 280,      // 纸面正文区宽度上限 px
    bodyVwPortrait: 0.82,// 竖屏时纸面正文区宽度占屏宽比例
    anchorTopFrac: 0.10, // 上位居：正文区顶边 = 船顶 + 船高 × 该比例
    anchorBottomFrac: 0.10, // 下位居：正文区底边 = 船底 − 船高 × 该比例
    /* —— 正文版式（百分比均相对纸面正文区） —— */
    textPadX: 0.07,      // 正文左右内缩比例
    textPadY: 0.01,      // 正文上下内缩比例
    textPadYPortrait: 0.05, // 竖屏正文上下内缩比例（纸面更小，留出更多行高）
    fontW: 0.044,        // 字号 = 屏宽 × 该系数（与对话框尺寸解耦，参与取小后夹在 min/max）
    fontH: 0.10,         // 字号 = 屏高 × 该系数（与对话框尺寸解耦，参与取小后夹在 min/max）
    fontMin: 11,         // 字号下限 px
    fontMax: 15,         // 字号上限 px
    /* —— 逐字打字 —— */
    typeStartDelay: 0.5, // 对话框浮现后延迟多久开始打字（秒）
    charSec: 0.1,       // 每个字出现的间隔（秒），越小越快
    charFade: 0.14,       // 单字淡入时长（秒）
    paraGapSec: 2.0,      // 一句打完到清空前的停顿（秒）
    paraClearSec: 0.35,   // 清空淡出时长（秒）
    /* —— 点按 vs 拖拽 —— */
    tapMaxDist: 7,       // 鼠标位移阈值 px
    tapMaxDistTouch: 14, // 触屏位移阈值 px
    tapMaxDur: 0.6,      // 按压时长阈值（秒）
    /* —— 点按反馈：船体轻晃（独立弹簧通道） —— */
    tapKickSpeed: 26,    // 初速度（度/秒）
    tapSpringK: 34,      // 弹簧刚度
    tapSpringC: 5.2,     // 阻尼（欠阻尼 → 轻晃一两下收敛）
    /* —— 悬停/收束微光（浅青点光；GLB 无独立水脉材质 → 轻量点光 + CSS 水波） —— */
    hoverGlow: 0.9,      // 悬停稳态强度
    tapGlow: 2.2,        // 点按瞬时峰值
    closeGlow: 1.6,      // 收束峰值
    /* —— 常驻提示（船体正下方） —— */
    hintShowDelay: 0.4,  // 第一组文字打完后再等多久浮现
    hintFade: 1.1,       // 淡入时长（浮现后常驻，不再消失）
    hintLiftFrac: 0.18,  // 从船体包围盒下沿上提的比例（船高 × 该值；包围盒被木桨/水珠拉低，需上提到船身边）
    /* —— 点按水波特效（落在船底吃水线附近） —— */
    tapFxLiftFrac: 0.30, // 水波中心 = 包围盒下沿 − 船高 × 该值（贴着船底，不落到桨尖）
    /* —— 命中盒放大系数：给点按一点宽容度 —— */
    hitInflate: 1.06,
    /* —— 卷轴页 → 气泡页入口（「开启对话」按钮） —— */
    ctaIn: 0.45,         // 按钮淡入时长
    ctaOut: 0.3,         // 按钮淡出时长
    entryFade: 0.5,      // 卷轴纸淡出时长
    entryDelay: 0.45,    // 卷轴淡出后、第一组气泡出现的延迟（秒）
  },
};

/* ---------------- 时间线导航页（章 5：长河） ----------------
 * 场景：三张 1920×1080 背景垂直堆叠成一张 1920×3240 长图，河道作为时间轴，
 *       8 个时间结点沿途分布；通惠 IP 船沿 SVG path 在结点间滑行。
 * 交互：点击结点 → 船从当前位置沿河道划过去 → 落定 → 淡出到对应时期占位页。
 * 返回：时期页左上角「← 返回长河」→ 淡回时间线，船停在刚访问的结点。
 *       该按钮在流程未完成时隐藏，全部文物看完（有勋章则勋章页浮现完成）后才出现。
 * 路径：SVG path 定义在 timeline/timelinePath.ts（以 1920×3240 画布坐标系）。
 * —— */
export const TIMELINE = {
  /* —— 画布几何 —— */
  /** 内容画布逻辑宽度 px（与背景图原始宽度一致） */
  canvasW: 1920,
  /** 内容画布逻辑高度 px = 1080 × 3（三张 1920×1080 垂直堆叠） */
  canvasH: 3240,
  /** 调试叠层：坐标系网格 + 结点/航道锚点 + 光标坐标读数；调完位置后改 false 关闭 */
  debug: false,

  /* —— 船（通惠 IP 形象） —— */
  boat: {
    /** 船图相对画布宽的占比（原图 2048×1536，渲染宽 = canvasW × 该值） */
    widthFrac: 0.16,
    /** 船滑行基准速度（px/s，在 1920×3240 画布坐标系内）：实际时长 = 路径长度 / 速度 */
    speed: 520,
    /** 单次滑行最短/最长时长（秒）：防止极短路径一闪而过、或跨屏长路径等太久 */
    minDur: 1.4,
    maxDur: 4.2,
    /** 落定后停顿时长（秒）：船到达结点 → 开始淡出到时期页之间的留白 */
    settleSec: 0.35,
    /** 船头初始朝向偏移（度）：通惠.png 船头朝左上，需要补偿使其对齐 path 切线方向 */
    headingOffsetDeg: -45,
    /** 船随水波轻晃：呼吸周期（秒）与幅度（度） */
    bobPeriod: 2.8,
    bobAmpDeg: 2.2,
    /** 船停靠时相对结点坐标的向上偏移（画布 px）：
     *  灯柱是「底边贴结点、向上生长」，船默认中心对齐结点会显得比灯靠下；
     *  此值让船上移，使船视觉中心对齐灯的视觉中心（约 = 灯高的一半）。
     *  想让船更靠上就调大，更靠下就调小/负数。 */
    anchorOffsetY: 65,
  },

  /* —— 结点（时间点上的人文景观） —— */
  node: {
    /** 结点圆点直径 px（相对 1920 画布宽） */
    sizePx: 28,
    /** 结点图标(dot-light.png 灯柱)的渲染宽度 px(相对 1920 画布宽);高度按原图 542:833 自动推算。
     *  想放大/缩小结点图标,只改这一个值即可(原 42,当前 84 = 放大一倍) */
    imgWidthPx: 126,
    /** 结点配色：核心点 / 外圈光晕 */
    coreColor: '#e8dcc3',   // 米白（与标题印泥同调）
    haloColor: 'rgba(232, 220, 195, 0.35)',
    /** 已访问结点着色 */
    visitedColor: '#c9a86a', // 金色
    /** 当前所在结点着色（船停在这里） */
    currentColor: '#ff6b4a', // 朱红
    /** 悬停放大倍数 */
    hoverScale: 1.25,
    /** 点击后缩放脉冲时长（秒） */
    pulseSec: 0.45,
  },

  /* —— 滚动 —— */
  scroll: {
    /** 进入时间线时，容器自动滚动到「船当前所在结点」的时长（秒） */
    enterSec: 1.2,
    /** 滚动到位后船才接收点击的延迟（秒） */
    interactDelaySec: 0.15,
  },

  /* —— 场景切换 —— */
  transition: {
    /** 对话框 → 时间线：act2 淡出 + timeline 淡入 */
    act2FadeOut: 0.8,
    timelineFadeIn: 1.0,
    /** 时间线 → 时期占位页 */
    timelineFadeOut: 0.7,
    eraFadeIn: 0.8,
    /** 时期占位页 → 时间线 */
    eraFadeOut: 0.6,
    timelineFadeBack: 0.8,
  },
} as const;

/* ---------------- 时期详情页（章 5.1：结点内的四态页） ----------------
 * 流程：标题页(home-bg，点任意处) → 卷轴页(展开+自动/手动滚动，点底部「收起」)
 *       → 文物触发页(亮白描边静置，点击变亮变大) → 文物详情页(点任意处返回触发页)
 *       → 全部点完出勋章浮层(占位，点任意处) → 回时间线。
 *       第一时期无勋章：详情页点任意处后直接回时间线。
 * 几何：所有美术均为 1920×1080 整幅透明 PNG，位置由美工预排；eraScene 的 .era-stage
 *       按 cover 规则等比铺满视口，子元素一律 % 定位即与画面严格对位；
 *       字号以「stage 宽 ÷ 100 = 1em」由 JS 注入，随窗口缩放。
 * 文物热区：触发键 PNG 的 alpha 包围盒(% 画布，PIL 实测)写在 timeline/eraData.ts。 */
export const ERA = {
  /** 美术画布逻辑尺寸(px) */
  canvasW: 1920,
  canvasH: 1080,

  /** 页间交叉淡入淡出时长(秒) */
  pageFadeSec: 0.5,

  /* —— 标题页 —— */
  title: {
    /** 三行文案(第x时期/名称/朝代·时间)的渐入间隔与单行动画时长 */
    lineStaggerSec: 0.22,
    lineFadeSec: 0.7,
    /** 底部提示文案与「点任意处」布防延迟(秒,防上一页点击穿透) */
    hint: '点击任意处继续',
    armDelaySec: 0.4,
  },

  /* —— 卷轴页 ——
   * 美术 alpha 实测(1920×1080 画布 %):
   *   纸 L11.72–88.54 / T21.67–79.54;上轴 T15.28–21.85;下轴 T78.80–85.83 */
  scroll: {
    /** 纸面内文区(% 画布,已含装饰边框内缩) */
    viewport: { leftPct: 16.5, rightPct: 83.5, topPct: 26.5, bottomPct: 74.5 },
    /** 纸面上下边界(% 画布高):展开时上边界固定、下边界自上而下推进(clip-path) */
    paperTopPct: 21.67,
    paperBottomPct: 79.54,
    /** 下轴顶边目标位置(% 画布高):展开时跟随纸面下缘落下;
     *  实测纸底 79.54、下轴 alpha-box 顶 78.80;
     *  关系:roller_top = bottomEdge - (rodBottomTopPct - 78.80),
     *  即 rodBottomTopPct - 78.80 = 重叠量。取 79.8 → 下轴压在纸底上方约 1.0%,
     *  消除下轴与卷轴纸之间的缝隙(原 78.4 会造成 0.4% 空隙) */
    rodBottomTopPct: 79.8,
    /** 展开/收起动画时长(秒) */
    unfoldSec: 1.1,
    collapseSec: 0.8,
    /** 展开到该进度正文开始淡入 / 正文淡入时长 */
    textAt: 0.65,
    textFadeSec: 0.5,
    /** 自动滚动(逻辑同 SCROLL):停留→慢速滚动,手动介入即停,闲置后渐速恢复 */
    startDelay: 1.2,
    autoPxPerFrame: 0.25,
    resumeDelay: 3,
    resumeRampSec: 1.2,
    /** 底部「收起」按钮文案 */
    collapseLabel: '收起卷轴',
  },

  /* —— 文物触发页 —— */
  trigger: {
    /** 文物入场:淡入时长与依次间隔(秒) */
    iconFadeSec: 0.7,
    iconStaggerSec: 0.15,
    /** 原地上下微浮动:幅度(em,1em=画布宽1%)、单周期(秒)、错峰(秒) */
    bobAmpEm: 0.30,
    bobDurSec: 3.8,
    bobStaggerSec: 0.5,
    /** 点击反馈:以 bbox 中心为原点变亮变大,随后进入详情页 */
    tapScale: 1.16,
    tapBrightness: 1.45,
    tapSec: 0.45,
    /** 热区相对 bbox 的外扩幅度(% 画布宽/高) */
    hitPadPct: 1.2,
    /** 底部提示 */
    hint: '点击文物,聆听它的故事',
  },

  /* —— 文物详情页 ——
   * 文物大图与羊皮纸各自独立可调,互不联动。
   * 尺寸/位置单位:% 画布宽(水平)或 % 画布高(垂直)。
   * topPct: 'center' = 垂直居中;数字 = 顶边距画布顶的 %。
   * hero.heightPct: 'square' = 正方形(高=宽);数字 = 相对画布高的 %。
   * parchment.heightPct: 'ratio' = 保持羊皮纸原图 16:9;数字 = 相对画布高的 %。 */
  detail: {
    /** 点击布防延迟(秒),防触发页点击穿透 */
    armDelaySec: 0.35,
    hint: '点击任意处返回',
    /** 文物大图(左侧,独立可调) */
    hero: {
      leftPct: 6,
      topPct: 'center' as number | 'center',
      widthPct: 40,
      heightPct: 'square' as number | 'square',
    },
    /** 羊皮纸(右侧,独立可调,与文物无联动) */
    parchment: {
      leftPct: 42,
      topPct: 'center' as number | 'center',
      widthPct: 56,
      heightPct: 'ratio' as number | 'ratio',
    },
  },

  /* —— 勋章浮层(占位样式,素材到位后替换 .era-medal-badge) —— */
  medal: {
    fadeSec: 0.5,
    popSec: 0.75,
    title: '恭喜你获得勋章',
    hint: '点击任意处返回长河',
  },
} as const;
