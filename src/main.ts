import gsap from 'gsap';
import { ASSETS } from './config/assets';
import { SEA_LAYERS, SEA_CLOUDS, SEA_RAIN, HERO, BOAT, TITLE, ACT2, TIMELINE } from './config/motion';
import { buildSea } from './sea/seaScene';
import { buildClouds, buildRain } from './scene/weather';
import { rigBoat } from './boat/boatRig';
import { setupMuseumExperiment, type MuseumExperiment } from './museum/experiment';
import { createBirdScene, type BirdScene } from './museum/birdScene';
import { createAct2Scene, type Act2Scene } from './act2/act2Scene';
import { createTimelineScene, type TimelineScene } from './timeline/timelineScene';

/* ---------- 博物馆 ↔ 船 共享定位变量（首屏即注入，博物馆按此定位） ---------- */
function applyHeroVars(): void {
  const root = document.documentElement;
  root.style.setProperty('--hero-width', HERO.width);
  root.style.setProperty('--hero-width-m', HERO.widthMobile);
  root.style.setProperty('--hero-bottom', `${HERO.bottomVh}vh`);
  root.style.setProperty('--hero-bottom-m', `${HERO.bottomVhMobile}vh`);
}

/* ---------- 标题定位变量（素材为 1920×1080 整幅画布，两图共用同一几何盒） ---------- */
function applyTitleVars(): void {
  const root = document.documentElement;
  root.style.setProperty('--title-scale', String(TITLE.scale));
  root.style.setProperty('--title-x', TITLE.x);
  root.style.setProperty('--title-y', TITLE.y);
  root.style.setProperty('--title-scale-m', String(TITLE.scaleMobile));
  root.style.setProperty('--title-x-m', TITLE.xMobile);
  root.style.setProperty('--title-y-m', TITLE.yMobile);
  // 印章定位（% 标题画布，见 motion.ts TITLE.stamp*）
  root.style.setProperty('--stamp-left', `${TITLE.stampLeft}%`);
  root.style.setProperty('--stamp-top', `${TITLE.stampTop}%`);
  root.style.setProperty('--stamp-height', `${TITLE.stampHeight}%`);
}

/* ---------- 标题背景帧序列：在 .title-cloud 几何盒内叠 7 层 <img>（DOM 顺序 = 层叠顺序） ---------- */
let titleFrames: HTMLImageElement[] = [];

function buildTitleBg(): void {
  const holder = document.querySelector('.title-cloud')!;
  titleFrames = ASSETS.titleBgFrames.map((src) => {
    const img = document.createElement('img');
    img.alt = '';
    img.src = src; // 静态帧无播放时钟，启动即挂载，不存在提前播完/缓存复用定格问题
    holder.appendChild(img);
    return img;
  });
}

/* ---------- 天气层（第三轮起仅海面场景有云雨；博物馆开关见 motion.ts） ---------- */
function buildWeather(): void {
  buildClouds(document.querySelector('#scene-sea .weather-clouds')!, SEA_CLOUDS);
  buildRain(document.querySelector('#scene-sea .weather-rain')!, SEA_RAIN);
}

/* ---------- 预加载清单（从各配置自动汇总，避免漏载） ---------- */
function preloadList(): string[] {
  return [
    ASSETS.homeBg,
    ASSETS.museumBg,
    ASSETS.museumPlaceholder,
    ASSETS.boat,
    ...SEA_LAYERS.map((l) => l.src),
    ...SEA_CLOUDS.map((c) => c.src),
    ...SEA_RAIN.map((r) => r.src),
    'assets/rope-knot.png',
    ASSETS.titleText,
    ...ASSETS.titleBgFrames,
    ASSETS.stamp,
    // 博物馆页飞鸟群（birdScene.ts：每只只在 activate 时挂载 src，防翅膀动画提前播完）
    'assets/bird.webp',
    // 书法字静帧：GIF 播完后 swap 的定格帧，须预加载保证瞬时切换无闪烁。
    // GIF 本体不预加载——GIF 从挂载 src 时刻起播，提前加载会导致书写动画在标题触发前播完
    ACT2.reveal.fonts.tongStill,
    ACT2.reveal.fonts.huiStill,
    // 第二幕展陈道具（展柜 + 罐）：静态 PNG，启动即预载。
    // 浪花 GIF 不预载——从挂载 src 时刻起播，提前加载会在触发前播完（同书法字逻辑）
    ...ACT2.reveal.props.items.map((i) => i.src),
    // 卷轴阅读页背景：进入阅读态才显示，提前缓存避免淡入时空白
    ASSETS.readBg,
    // 章4 对话框分镜：进入对话页才显示，提前缓存避免浮现时空白（7 张，已转 WebP）
    ...ASSETS.dialogueArt,
    // 章5 时间线:三张背景 + 通惠 IP 船 + 装饰层(花/鸟/竹 24 张)
    ...ASSETS.timelineBgs,
    ASSETS.tonghuiIp,
    ...ASSETS.timelineDecor.flower,
    ...ASSETS.timelineDecor.birds,
    ...ASSETS.timelineDecor.bamboo,
  ];
}

function preload(urls: string[], onProgress: (p: number) => void): Promise<void> {
  let done = 0;
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          const settle = () => {
            done += 1;
            onProgress(done / urls.length);
            resolve(); // 单张失败不阻断整体体验
          };
          img.onload = settle;
          img.onerror = () => {
            console.warn('[运河上飘来一座城] 素材加载失败：', url);
            settle();
          };
          img.src = url;
        }),
    ),
  ).then(() => undefined);
}

/* ---------- 场景切换：博物馆 → 漂流之海 ---------- */
let voyageStarted = false;
let museumExperiment: MuseumExperiment | null = null;
let birdScene: BirdScene | null = null;
let act2: Act2Scene | null = null;
let timeline: TimelineScene | null = null;

/** 对话全部完成 → 切场到时间线 */
async function enterTimeline(): Promise<void> {
  if (!timeline || !act2) return;
  const act2El = document.getElementById('scene-act2');
  const seaEl = document.getElementById('scene-sea');
  if (!act2El) return;

  // 1. act2 淡出
  await gsap.to(act2El, { opacity: 0, duration: TIMELINE.transition.act2FadeOut, ease: 'power1.in' });
  // 2. 隐藏 act2 与 sea(海面场景的船/标题/滚动提示必须一并隐藏,否则会盖在时间线上)
  act2El.classList.add('is-hidden');
  act2El.setAttribute('aria-hidden', 'true');
  seaEl?.classList.add('is-hidden');
  seaEl?.setAttribute('aria-hidden', 'true');
  await act2.deactivate();
  timeline.activate();
  // 3. timeline 淡入
  const timelineEl = document.getElementById('scene-timeline')!;
  await gsap.fromTo(timelineEl, { opacity: 0 }, { opacity: 1, duration: TIMELINE.transition.timelineFadeIn, ease: 'power1.out' });
}

async function startVoyage(): Promise<void> {
  if (voyageStarted) return;
  voyageStarted = true;

  // 转场开始即撤销博物馆交互：飞鸟群（清空销毁 GIF 实例）+ 伪 3D 晃动 + 船图蒙版，避免干扰船页
  birdScene?.teardown();
  birdScene = null;
  museumExperiment?.teardown();
  museumExperiment = null;

  const museum = document.getElementById('scene-museum')!;
  const sea = document.getElementById('scene-sea')!;

  await buildSea(document.getElementById('sea')!);
  rigBoat(); // 绳索与船体摇晃时间轴启动（船初始不可见）

  sea.classList.remove('is-hidden');
  // 海面场景显隐：移除 is-hidden 后由 GSAP 显式驱动 opacity 0→1（0.8s 淡入），
  // 与 .scene 的 CSS transition 方向/速度一致，但避免节流环境下 CSS transition 不触发导致海面不可见。
  gsap.fromTo(sea, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power1.out' });
  gsap.set('.wave-layer', { yPercent: 30, opacity: 0 });
  // 船初始不可见：位置由 --hero-bottom 锁定在博物馆原位；水平居中用 xPercent（百分比，
  // 不固化为像素，resize 仍居中）。入场 = 博物馆淡出的镜像：模糊放大 → 清晰正常尺寸。
  gsap.set('#boat-wrap', { xPercent: -50, x: 0, opacity: 0, scale: HERO.enterScale, filter: `blur(${HERO.enterBlur}px)` });
  // 标题初始隐藏：7 帧全部透明 + 文字 clip-path 完全裁掉（下方 100%）。
  // 背景帧是静态图：没有播放时钟，不会提前播完、不会闪烁、也不会因缓存复用而定格；
  // 「播放」由下方时间轴依次 crossfade 完成，时序 100% 确定。
  gsap.set(titleFrames, { opacity: 0 });
  gsap.set('.title-text', { opacity: 0, clipPath: TITLE.textClipFrom });
  // 印章初始悬在「城」字上方（上移 stampLift 倍自身高、放大、未显形），
  // transformOrigin 在印章底部（约 88%）：落地压扁与回弹绕底面接触点，更像真的盖章
  gsap.set('.title-stamp', {
    opacity: 0,
    yPercent: -TITLE.stampLift * 100,
    scale: TITLE.stampScaleFrom,
    transformOrigin: '50% 88%',
    filter: 'brightness(1)',
  });
  gsap.set('.scroll-hint', { opacity: 0 });
  gsap.set('.sea-clouds, .sea-rain', { opacity: 0 });

  // 船渐显起始时刻 = 博物馆淡出时长 - 重叠时长，保证两者有一段同时可见
  const boatStart = HERO.fadeOutDur - HERO.overlap;
  // 标题触发时刻：船体跑完 TITLE.delayCycles 个完整摇晃周期（周期即 BOAT.period，船速改了自动同步）
  const titleAt = BOAT.period * TITLE.delayCycles;
  // 印章触发时刻：标题文字与背景帧全部显示完后（取两者较晚者）再等 stampDelay
  const stampAt =
    titleAt +
    Math.max(TITLE.textDelay + TITLE.textDur, (titleFrames.length - 1) * TITLE.bgFrameStep + TITLE.bgFrameFade) +
    TITLE.stampDelay;

  const tl = gsap.timeline();
  tl.to('.museum-hint', { opacity: 0, duration: 0.7, ease: 'power1.out' }, 0)
    // 转场第一步：米色背景先压暗（沉入夜色），与博物馆淡出同长同节奏——
    // 场景层随后淡出时露出的深色水墨明度已衔接，消除明度跳变（参数见 HERO.bgDarken*）
    .to('.museum-bg', { filter: `brightness(${HERO.bgDarkenTo})`, duration: HERO.bgDarkenDur, ease: 'power2.in' }, 0)
    // 第二阶段：博物馆淡出（缩放+模糊+透明）
    .to('#museum-trigger', { scale: 1.07, opacity: 0, filter: 'blur(8px)', duration: HERO.fadeOutDur, ease: 'power2.in' }, 0)
    // 第二阶段：船在博物馆原位渐显（opacity + scale + blur，博物馆淡出的镜像），与博物馆淡出重叠 overlap 秒
    .to('#boat-wrap', { opacity: 1, scale: 1, filter: 'blur(0px)', duration: HERO.fadeInDur, ease: 'power2.out' }, boatStart)
    // 博物馆场景整体淡出（船已部分可见后），随后隐藏避免遮挡
    .to('#scene-museum', { opacity: 0, duration: 0.55, ease: 'power1.in' }, boatStart + 0.15)
    .set(museum, { visibility: 'hidden' })
    .to('.sea-clouds, .sea-rain', { opacity: 1, duration: 1.6, ease: 'power2.out' }, 0.85);
  // 海浪层各自回到配置透明度（远景更淡），并从下方升起（yPercent:30→0）
  document.querySelectorAll<HTMLElement>('.wave-layer').forEach((el, i) => {
    tl.to(el, { opacity: SEA_LAYERS[i].opacity, duration: 1.5, ease: 'power1.out' }, 0.85 + i * 0.12)
      .to(el, { yPercent: 0, duration: 1.5, ease: 'power2.out' }, 0.85 + i * 0.12);
  });
  // 标题：船体先持续摇晃，跑完 delayCycles 个完整周期后再出现。
  // 背景按帧序列逐层叠合：帧依次淡入后不再消失，7 帧全部保留，
  // 最终叠成完整背景；文字随后跟随、自上而下 clip-path 揭开。
  tl.to(titleFrames[0], { opacity: 1, duration: TITLE.bgFrameFade, ease: 'power1.out' }, titleAt);
  for (let i = 1; i < titleFrames.length; i++) {
    tl.to(titleFrames[i], { opacity: 1, duration: TITLE.bgFrameFade, ease: 'power1.out' }, titleAt + i * TITLE.bgFrameStep);
  }
  tl.to('.title-text', {
      opacity: 1,
      clipPath: TITLE.textClipTo,
      duration: TITLE.textDur,
      ease: 'power2.out',
    }, titleAt + TITLE.textDelay);
  // 「下拉」提示：等印章落地墩稳（stampAt + stampDur）后再等 hintDelay 浮现
  tl.to('.scroll-hint', { opacity: 1, duration: 0.9, ease: 'power1.out' }, stampAt + TITLE.stampDur + TITLE.hintDelay);
  // 印章：标题完全显示后最后盖下。
  // 显形（高空即见）→ power3.in 加速砸落 + 放大值同步收拢 → 落地瞬间压扁过冲 +
  // 印泥亮度闪一下 → 弹性回稳，"墩"一下再定住。
  tl.to('.title-stamp', { opacity: 1, duration: 0.12, ease: 'power1.out' }, stampAt)
    .to('.title-stamp', { yPercent: 0, duration: TITLE.stampDur, ease: 'power3.in' }, stampAt)
    .to('.title-stamp', { scale: TITLE.stampSquash, duration: TITLE.stampDur, ease: 'power3.in' }, stampAt)
    .to('.title-stamp', { scale: 1, duration: TITLE.stampSettle, ease: 'elastic.out(1, 0.4)' }, stampAt + TITLE.stampDur)
    .to('.title-stamp', { filter: `brightness(${TITLE.stampFlash})`, duration: 0.08, ease: 'power1.out' }, stampAt + TITLE.stampDur)
    .to('.title-stamp', { filter: 'brightness(1)', duration: 0.3, ease: 'power1.in' }, stampAt + TITLE.stampDur + 0.08);

  // 船页开场动画（船渐显 + 标题揭开 + 印章落地墩稳）完成后立即激活第二幕。
  // 印章全部落地在 stampAt + stampDur + stampSettle ≈ 11.2s。
  // 让 `.call()` 定位在此处，用户看到印章墩稳 → 看到滚动提示 → 立即可以滚。
  // Three.js 重活（渲染器/GLB 解析/法线重建/着色器预热）已在 boot 预载阶段完成，
  // 此处 activate 只做轻量交互接管，不再阻塞主线程。
  const act2Start = stampAt + TITLE.stampDur + TITLE.stampSettle;
  tl.call(() => { void act2?.activate(); }, undefined, act2Start);

  museum.setAttribute('aria-hidden', 'true');
}

/* ---------- 启动 ---------- */
async function boot(): Promise<void> {
  applyHeroVars(); // 首屏即注入博物馆↔船共享定位变量
  applyTitleVars(); // 标题素材的定位/缩放变量
  document.querySelector<HTMLDivElement>('.home-bg')!.style.backgroundImage = `url(${ASSETS.homeBg})`;
  document.querySelector<HTMLDivElement>('.museum-bg')!.style.backgroundImage = `url(${ASSETS.museumBg})`;
  document.querySelector<HTMLImageElement>('#museum-img')!.src = ASSETS.museumPlaceholder;
  document.querySelector<HTMLImageElement>('#boat-img')!.src = ASSETS.boat;
  document.querySelector<HTMLImageElement>('.title-text')!.src = ASSETS.titleText;
  document.querySelector<HTMLImageElement>('.title-stamp')!.src = ASSETS.stamp;
  document.querySelector<HTMLImageElement>('.act2-read-bg')!.src = ASSETS.readBg;
  buildTitleBg(); // 标题背景 7 帧：启动即构建并挂 src（静态帧无播放时钟，不存在定格问题）
  buildWeather();

  const fill = document.getElementById('preloader-fill')!;
  const preloader = document.getElementById('preloader')!;
  const museum = document.getElementById('scene-museum')!;
  const trigger = document.getElementById('museum-trigger')!;

  // 第二幕场景创建（仅建闭包与查询静态 DOM，无重活）；Three.js 初始化/GLB 装载全部走下方 preload
  act2 = createAct2Scene();

  // 章5 时间线场景创建(仅建闭包,激活时才渲染)
  timeline = createTimelineScene();
  // 注册「对话全部完成」回调:第七组对话后用户再点船 → 切场到时间线
  act2.onDialogueComplete(() => { void enterTimeline(); });

  // 图片素材与第二幕 3D 场景（52MB GLB 下载/解析/法线重建/着色器预热）并行预载：
  // 重活全部压在预载阶段，开场徽章落地时 activate 只做轻量交互接管，滚动零卡顿。
  // 进度按 ACT2.preload.glbWeight 权重合并到同一进度条；GLB 下载字节进度只占其份额的
  // glbDownloadShare，剩余份额留给下载完成后的解析/法线/编译阶段。
  let imgP = 0, shipP = 0;
  const updateFill = () => {
    const W = ACT2.preload.glbWeight;
    fill.style.width = `${Math.round((imgP * (1 - W) + shipP * W) * 100)}%`;
  };
  await Promise.all([
    preload(preloadList(), (p) => { imgP = p; updateFill(); }),
    act2.preload((p) => { shipP = p * ACT2.preload.glbDownloadShare; updateFill(); })
      .then(() => { shipP = 1; updateFill(); }),
  ]);

  preloader.classList.add('is-done');
  museum.classList.remove('is-hidden');
  gsap.from('#museum-trigger', { opacity: 0, y: 18, duration: 1.3, ease: 'power2.out', delay: 0.25 });
  gsap.from('.museum-hint', { opacity: 0, duration: 1.2, delay: 0.9 });

  // 博物馆实验交互（伪 3D 晃动 + 船图蒙版显露）：仅鼠标+非减弱动效下启用，可随时撤销
  museumExperiment = setupMuseumExperiment();

  // 飞鸟群：8 只鸟 CSS keyframes 横穿屏幕，按 BIRDS 配置随机尺寸/时长/起点/反向
  // 只在此时才挂载 src（preload 已缓存，GIF 翅膀动画与博物馆激活时刻同步开始）
  birdScene = createBirdScene();
  birdScene.activate();

  trigger.addEventListener('click', startVoyage, { once: true });

  // 调试/截图钩子：?sea=1 自动进入海面场景（非用户可见入口）
  // 必须显式 =1 才生效：避免残留的裸 ?sea / ?act2 地址让开屏博物馆被自动跳过、点击失效。
  const params = new URLSearchParams(location.search);
  if (params.get('sea') === '1') {
    gsap.delayedCall(0.4, startVoyage);
  }
  // 调试钩子：?act2=1 跳过开场 timeline，提前激活第二幕（3D 调试用）
  if (params.get('act2') === '1') {
    gsap.delayedCall(0.4, startVoyage);
    gsap.delayedCall(3.2, () => { void act2?.activate(); });
    // 自动化截图用：同步激活 + 精确跳帧（rAF 被节流时仍可逐阶段验证）
    // chapter()：章节状态快照（stage/playing/from/to/progress），wheel 链路验收用
    (window as unknown as {
      __act2Debug?: {
        activate: () => void;
        set: (p: number) => void;
        chapter: () => { stage: number; playing: boolean; from: number; to: number; progress: number } | null;
      };
    }).__act2Debug = {
      activate: () => { void act2?.activate(); },
      set: (p: number) => act2?.debugSetProgress(p),
      chapter: () => act2?.chapterDebug ?? null,
    };
    // &p=0.35：激活完成后跳到指定进度（无头截图逐阶段验收用）
    const jump = parseFloat(params.get('p') ?? '');
    if (!Number.isNaN(jump)) {
      gsap.delayedCall(6, () => act2?.debugSetProgress(jump));
    }
  }
  // 调试钩子:?timeline=1 跳过所有前置场景,直跳时间线页(开发时间线用)
  if (params.get('timeline') === '1') {
    gsap.delayedCall(0.4, () => {
      // 隐藏所有前置场景,避免船/标题/滚动提示盖在时间线上
      document.getElementById('scene-museum')?.classList.add('is-hidden');
      document.getElementById('scene-sea')?.classList.add('is-hidden');
      document.getElementById('scene-act2')?.classList.add('is-hidden');
      void act2?.deactivate();
      timeline?.activate();
    });
  }
}

boot();
