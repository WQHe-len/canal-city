/**
 * 第五幕 · 时间线导航场景
 *
 * 职责:
 *   1. 初始化三张背景图 + SVG 河道 path + 8 个时间结点 + 通惠船
 *   2. 管理纵向滚动容器(惯性滚动,浏览三张拼接图)
 *   3. 结点点击 → 船沿 SVG path 从当前位置滑到目标结点 → 落定 → 切场到时期占位页
 *   4. 时期占位页:左上角「← 返回长河」→ 淡回时间线,船停在刚访问的结点
 *
 * 关键实现:
 *   - 船滑行:tween 一个 0→1 的进度,onUpdate 里用 path.getPointAtLength 换算位置
 *     (比 MotionPathPlugin 更可控,方便叠加船头朝向计算)
 *   - 结点定位:path.getPointAtLength(len × t) → viewBox 坐标 → 画布像素坐标
 *   - 船朝向:onUpdate 里取前后两点的切线角度 + headingOffsetDeg 补偿船图初始朝向
 *   - 船呼吸:用 y 偏移 + scale 轻晃(不用 rotation,避免与朝向 rotation 冲突)
 *   - 时长:路径长度 / boat.speed,夹在 minDur/maxDur 之间
 *   - 滚动:原生 scrollTo({behavior:'smooth'}),惯性由浏览器提供
 *   - 切场:timeline ↔ era 两场景用 GSAP opacity 淡入淡出
 *
 * 所有动效/版式参数集中在 motion.ts TIMELINE。
 */

import gsap from 'gsap';
import { TIMELINE } from '../config/motion';
import { ASSETS } from '../config/assets';
import { RIVER_PATH_D, NODES, BOAT_START } from './timelinePath';
import { createEraScene } from './eraScene';

export interface TimelineScene {
  /** 激活:显示场景、滚到船所在结点、绑定事件 */
  activate: () => void;
  /** 停用:隐藏场景、解绑事件、停动画 */
  deactivate: () => void;
  /** 当前是否激活 */
  readonly active: boolean;
}

export function createTimelineScene(): TimelineScene {
  const T = TIMELINE;
  /** 调试叠层开关(坐标系网格/锚点/光标读数) */
  const DEBUG = T.debug as boolean;

  // DOM 引用
  const sceneEl = () => document.getElementById('scene-timeline');
  const eraEl = () => document.getElementById('scene-era');
  const scrollEl = () => document.querySelector<HTMLElement>('.timeline-scroll');
  const canvasEl = () => document.querySelector<HTMLElement>('.timeline-canvas');
  const pathEl = () => document.querySelector<SVGPathElement>('.timeline-path');
  const nodesEl = () => document.querySelector<HTMLElement>('.timeline-nodes');
  const boatEl = () => document.querySelector<HTMLImageElement>('.timeline-boat');

  /** 时期详情四态页(标题/卷轴/触发/详情/勋章),内部自管理,完成后 resolve */
  const eraScene = createEraScene();

  // 状态
  let active = false;
  /** 船当前所在结点索引(-1 = 还在 BOAT_START,未点击过任何结点) */
  let currentNodeIdx = -1;
  /** 船当前在 path 上的位置 t ∈ [0,1](setupAssets 里初始化为 BOAT_START 的 t) */
  let currentT = 0;
  /** 是否正在滑行中(滑行期间禁止点击) */
  let cruising = false;
  /** 已访问过的结点集合(初始为空,船还在 BOAT_START) */
  const visited = new Set<number>();
  /** 船呼吸晃动 tween */
  let bobTween: gsap.core.Tween | null = null;
  /** 滑行 tween(取消用) */
  let cruiseTween: gsap.core.Tween | null = null;
  /** 事件解绑函数集合 */
  const cleanupFns: Array<() => void> = [];

  /** 画布像素尺寸(运行时可变,响应窗口宽度) */
  function canvasSize(): { w: number; h: number } {
    const el = canvasEl();
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }

  /** 把 path 上的 t 比例 → 画布像素坐标 */
  function tToPoint(t: number): { x: number; y: number } {
    const path = pathEl();
    if (!path) return { x: 0, y: 0 };
    const len = path.getTotalLength();
    const p = path.getPointAtLength(len * t);
    // SVG viewBox 是 1920×3240,preserveAspectRatio="none" 拉伸铺满画布
    // 所以 viewBox 坐标需要按比例缩放到画布像素坐标
    const { w, h } = canvasSize();
    return { x: (p.x / T.canvasW) * w, y: (p.y / T.canvasH) * h };
  }

  /** 把画布坐标 (x,y) 吸附到河道上,返回最近点的 t 值(线性扫描) */
  function xyToT(x: number, y: number): number {
    const path = pathEl();
    if (!path) return 0;
    const len = path.getTotalLength();
    const steps = 300;
    let bestT = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = path.getPointAtLength(len * t);
      const dx = p.x - x;
      const dy = p.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestT = t; }
    }
    return bestT;
  }

  /** 船停靠时相对结点坐标的向上偏移（屏幕 px，由画布 px × 画布缩放比例换算） */
  function boatOffsetY(): number {
    const { h } = canvasSize();
    return T.boat.anchorOffsetY * (h / T.canvasH);
  }

  /** 把船定位到 path 上的 t 位置(瞬移,不动画)。船永远正着,不随路径旋转 */
  function snapBoatTo(t: number): void {
    const boat = boatEl();
    if (!boat) return;
    const pt = tToPoint(t);
    gsap.set(boat, {
      x: pt.x,
      y: pt.y - boatOffsetY(),
      xPercent: -50,
      yPercent: -50,
      rotation: 0, // 强制正着
    });
  }

  /** 启动船呼吸晃动(y 偏移 + scale 轻晃,不用 rotation,避免与朝向冲突) */
  function startBob(): void {
    stopBob();
    const boat = boatEl();
    if (!boat) return;
    bobTween = gsap.to(boat, {
      y: '+=6',
      duration: T.boat.bobPeriod / 2,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  }

  function stopBob(): void {
    bobTween?.kill();
    bobTween = null;
  }

  /** 渲染 8 个结点 */
  function buildNodes(): void {
    const host = nodesEl();
    if (!host) return;
    host.innerHTML = '';
    NODES.forEach((n, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'timeline-node';
      btn.dataset.idx = String(i);
      btn.setAttribute('aria-label', `${n.name} ${n.year}`);
      // 结点视觉:dot-light.png 灯柱(真实 img,底边贴结点坐标、向上生长)
      const dot = document.createElement('img');
      dot.className = 'timeline-node-dot';
      dot.src = ASSETS.timelineNode;
      dot.alt = '';
      dot.setAttribute('aria-hidden', 'true');
      btn.appendChild(dot);
      host.appendChild(btn);

      const onTap = () => handleNodeTap(i);
      btn.addEventListener('click', onTap);
      cleanupFns.push(() => btn.removeEventListener('click', onTap));
    });
    layoutNodes();
  }

  /** 按 path 实际位置布局 8 个结点(resize 时重算) */
  function layoutNodes(): void {
    const host = nodesEl();
    if (!host) return;
    const { w } = canvasSize();
    const scale = w / T.canvasW;
    const size = T.node.sizePx * scale;
    Array.from(host.children).forEach((el, i) => {
      const n = NODES[i];
      const pt = tToPoint(n.t);
      const btn = el as HTMLElement;
      btn.style.left = `${pt.x}px`;
      btn.style.top = `${pt.y}px`;
      const dot = btn.querySelector<HTMLImageElement>('.timeline-node-dot');
      const dotW = T.node.imgWidthPx * scale;
      if (dot) dot.style.width = `${dotW}px`;
      /* 点击热区至少覆盖放大后的图标宽度,保证图标整体可点 */
      const hitbox = Math.max(44, size * 2, dotW);
      btn.style.width = `${hitbox}px`;
      btn.style.height = `${hitbox}px`;
      btn.classList.toggle('is-visited', visited.has(i));
      btn.classList.toggle('is-current', i === currentNodeIdx);
    });
  }

  /** 船沿 path 从 fromT 滑到 toT,返回 Promise */
  function cruiseTo(fromT: number, toT: number): Promise<void> {
    return new Promise((resolve) => {
      const boat = boatEl();
      const path = pathEl();
      if (!boat || !path) { resolve(); return; }

      const totalLen = path.getTotalLength();
      const segLen = Math.abs(toT - fromT) * totalLen;
      const dur = Math.min(T.boat.maxDur, Math.max(T.boat.minDur, segLen / T.boat.speed));

      const state = { t: fromT };
      cruiseTween = gsap.to(state, {
        t: toT,
        duration: dur,
        ease: 'power1.inOut',
        onUpdate: () => {
          currentT = state.t;
          const pt = tToPoint(state.t);
          // 船永远正着,只更新 x/y 位置,不随路径旋转
          gsap.set(boat, {
            x: pt.x,
            y: pt.y - boatOffsetY(),
          });
        },
        onComplete: () => { cruiseTween = null; resolve(); },
      });
    });
  }

  /** 结点点击处理 */
  async function handleNodeTap(idx: number): Promise<void> {
    if (!active || cruising) return;
    if (idx === currentNodeIdx) return;
    cruising = true;

    const targetT = NODES[idx].t;
    const fromT = currentT;

    const nodesHost = nodesEl();
    if (nodesHost) {
      const curBtn = nodesHost.children[currentNodeIdx] as HTMLElement | undefined;
      curBtn?.classList.remove('is-current');
    }

    stopBob();
    await cruiseTo(fromT, targetT);

    currentNodeIdx = idx;
    currentT = targetT;
    visited.add(idx);
    layoutNodes();

    await new Promise((r) => gsap.delayedCall(T.boat.settleSec, r));
    await showEra(idx);

    cruising = false;
  }

  /** 切到时期详情页:淡出时间线 → 淡入 era → eraScene 跑完整个四态流程 → 淡回时间线 */
  async function showEra(idx: number): Promise<void> {
    const era = eraEl();
    const timeline = sceneEl();
    if (!era || !timeline) return;

    await gsap.to(timeline, { opacity: 0, duration: T.transition.timelineFadeOut, ease: 'power1.in' });
    /* 先按需求锁好返回按钮,再显形,避免淡入时按钮闪现 */
    eraScene.prepare(idx);
    timeline.classList.add('is-hidden');
    era.classList.remove('is-hidden');
    era.removeAttribute('aria-hidden');
    await gsap.fromTo(era, { opacity: 0 }, { opacity: 1, duration: T.transition.eraFadeIn, ease: 'power1.out' });

    /* 时期页内完整流程(标题→卷轴→触发→详情→勋章),用户点「返回长河」也会在此 resolve */
    await eraScene.run(idx);

    await gsap.to(era, { opacity: 0, duration: T.transition.eraFadeOut, ease: 'power1.in' });
    era.classList.add('is-hidden');
    era.setAttribute('aria-hidden', 'true');

    timeline.classList.remove('is-hidden');
    timeline.removeAttribute('aria-hidden');
    await gsap.fromTo(timeline, { opacity: 0 }, { opacity: 1, duration: T.transition.timelineFadeBack, ease: 'power1.out' });

    scrollToBoat(false);
    startBob();
  }

  /** 滚动容器到船当前位置(让船在视口垂直居中) */
  function scrollToBoat(animate: boolean): void {
    const scroll = scrollEl();
    if (!scroll) return;
    const pt = tToPoint(currentT);
    const targetTop = Math.max(0, pt.y - window.innerHeight / 2);
    if (animate) {
      scroll.scrollTo({ top: targetTop, behavior: 'smooth' });
    } else {
      scroll.scrollTop = targetTop;
    }
  }

  /** 把 path 上的 t 比例 → 画布逻辑坐标(viewBox 单位,1920×3240) */
  function tToViewPoint(t: number): { x: number; y: number } | null {
    const path = pathEl();
    if (!path) return null;
    const p = path.getPointAtLength(path.getTotalLength() * t);
    return { x: p.x, y: p.y };
  }

  /** 设置背景图 / path / 船 src 与尺寸 */
  function setupAssets(): void {
    document.querySelectorAll<HTMLImageElement>('.timeline-bg').forEach((img, i) => {
      img.src = ASSETS.timelineBgs[i] ?? '';
    });
    const path = pathEl();
    if (path) path.setAttribute('d', RIVER_PATH_D);
    const boat = boatEl();
    if (boat) {
      boat.src = ASSETS.tonghuiIp;
      const { w } = canvasSize();
      const bw = w * T.boat.widthFrac;
      const bh = bw * (1536 / 2048);
      boat.style.width = `${bw}px`;
      boat.style.height = `${bh}px`;
    }
    setupDecor();
    setupSeamClouds();

    // path 设置好后,把每个结点的坐标吸附到河道上,算出对应 t 值
    NODES.forEach((n) => { n.t = xyToT(n.x, n.y); });
    // 船起始位置 = BOAT_START 坐标吸附到河道的 t
    currentT = xyToT(BOAT_START.x, BOAT_START.y);
    setupDebug();
  }

  /* ---------------- 调试叠层:坐标系网格 + 锚点 ---------------- */

  /** 显示 1920×3240 坐标系、结点锚点(手填坐标 vs 吸附后位置)、航道锚点与光标读数。
   *  开关在 motion.ts 的 TIMELINE.debug,调完位置改 false 即可。 */
  function setupDebug(): void {
    const canvas = canvasEl();
    const timeline = sceneEl();
    canvas?.querySelector('.timeline-debug')?.remove();
    timeline?.querySelector('.timeline-debug-hud')?.remove();
    if (!DEBUG || !canvas || !timeline) return;

    const NS = 'http://www.w3.org/2000/svg';
    const wrap = document.createElement('div');
    wrap.className = 'timeline-debug';
    wrap.setAttribute('aria-hidden', 'true');

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'timeline-debug-svg');
    svg.setAttribute('viewBox', `0 0 ${T.canvasW} ${T.canvasH}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    wrap.appendChild(svg);

    const mk = (tag: string, attrs: Record<string, string | number>): SVGElement => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      svg.appendChild(el);
      return el;
    };

    /* 1. 坐标系网格:100px 细线 / 500px 粗线,每 200px 标一次刻度 */
    for (let x = 0; x <= T.canvasW; x += 100) {
      const major = x % 500 === 0;
      mk('line', { x1: x, y1: 0, x2: x, y2: T.canvasH, class: major ? 'tdb-grid-major' : 'tdb-grid-minor' });
    }
    for (let y = 0; y <= T.canvasH; y += 100) {
      const major = y % 500 === 0;
      mk('line', { x1: 0, y1: y, x2: T.canvasW, y2: y, class: major ? 'tdb-grid-major' : 'tdb-grid-minor' });
    }
    for (let x = 200; x < T.canvasW; x += 200) {
      [0, 1080, 2160].forEach((baseY) => {
        mk('text', { x: x + 5, y: baseY + 28, class: 'tdb-label' }).textContent = String(x);
      });
    }
    for (let y = 0; y <= T.canvasH; y += 200) {
      mk('text', { x: 10, y: y + 26, class: 'tdb-label' }).textContent = String(y);
    }

    /* 2. 三张背景的接缝 */
    [1080, 2160].forEach((y, i) => {
      mk('line', { x1: 0, y1: y, x2: T.canvasW, y2: y, class: 'tdb-seam' });
      mk('text', {
        x: T.canvasW / 2,
        y: y - 12,
        class: 'tdb-seam-label',
        'text-anchor': 'middle',
      }).textContent = `图${i + 1} / 图${i + 2} 接缝  y=${y}`;
    });

    /* 3. 河道线 + 贝塞尔控制点(圆点/控制多边形) + 锚点(P0..Pn) */
    mk('path', { d: RIVER_PATH_D, class: 'tdb-river' });

    const nums = (RIVER_PATH_D.match(/[-+]?\d*\.?\d+/g) ?? []).map(Number);
    const anchors: Array<{ x: number; y: number; label: string }> = [];
    if (nums.length >= 2) anchors.push({ x: nums[0], y: nums[1], label: 'P0' });
    let cursor = 2;
    let pi = 1;
    let prevX = nums[0] ?? 0;
    let prevY = nums[1] ?? 0;
    while (cursor + 5 < nums.length) {
      const c1x = nums[cursor];
      const c1y = nums[cursor + 1];
      const c2x = nums[cursor + 2];
      const c2y = nums[cursor + 3];
      const endX = nums[cursor + 4];
      const endY = nums[cursor + 5];
      /* 控制多边形:锚点 → C1 → C2 → 下一个锚点 */
      mk('line', { x1: prevX, y1: prevY, x2: c1x, y2: c1y, class: 'tdb-handle' });
      mk('line', { x1: c1x, y1: c1y, x2: c2x, y2: c2y, class: 'tdb-handle' });
      mk('line', { x1: c2x, y1: c2y, x2: endX, y2: endY, class: 'tdb-handle' });
      /* 两个贝塞尔控制点 */
      mk('circle', { cx: c1x, cy: c1y, r: 7, class: 'tdb-ctrl' });
      mk('circle', { cx: c2x, cy: c2y, r: 7, class: 'tdb-ctrl' });
      anchors.push({ x: endX, y: endY, label: `P${pi}` });
      prevX = endX;
      prevY = endY;
      cursor += 6;
      pi += 1;
    }
    anchors.forEach((a) => {
      mk('rect', {
        x: a.x - 5,
        y: a.y - 5,
        width: 10,
        height: 10,
        transform: `rotate(45 ${a.x} ${a.y})`,
        class: 'tdb-path-anchor',
      });
      mk('text', { x: a.x + 12, y: a.y - 10, class: 'tdb-path-label' }).textContent =
        `${a.label} (${Math.round(a.x)},${Math.round(a.y)})`;
    });

    /* 4. 结点锚点:洋红十字 = NODES 手填的 x/y;绿圈 = 吸附到河道后的实际落点 */
    NODES.forEach((n, i) => {
      const snap = tToViewPoint(n.t);
      if (snap) {
        mk('line', { x1: n.x, y1: n.y, x2: snap.x, y2: snap.y, class: 'tdb-link' });
        mk('circle', { cx: snap.x, cy: snap.y, r: 9, class: 'tdb-snap' });
      }
      mk('line', { x1: n.x - 18, y1: n.y, x2: n.x + 18, y2: n.y, class: 'tdb-raw' });
      mk('line', { x1: n.x, y1: n.y - 18, x2: n.x, y2: n.y + 18, class: 'tdb-raw' });
      mk('circle', { cx: n.x, cy: n.y, r: 5, class: 'tdb-raw-dot' });
      mk('text', { x: n.x + 22, y: n.y - 18, class: 'tdb-node-label' }).textContent =
        `#${i + 1} (${Math.round(n.x)},${Math.round(n.y)})`;
    });

    /* 5. 船起点锚点 */
    const boatSnap = tToViewPoint(currentT);
    mk('line', { x1: BOAT_START.x - 18, y1: BOAT_START.y, x2: BOAT_START.x + 18, y2: BOAT_START.y, class: 'tdb-boat' });
    mk('line', { x1: BOAT_START.x, y1: BOAT_START.y - 18, x2: BOAT_START.x, y2: BOAT_START.y + 18, class: 'tdb-boat' });
    if (boatSnap) mk('circle', { cx: boatSnap.x, cy: boatSnap.y, r: 9, class: 'tdb-snap' });
    mk('text', { x: BOAT_START.x + 22, y: BOAT_START.y + 34, class: 'tdb-boat-label' }).textContent =
      `船起点 (${BOAT_START.x},${BOAT_START.y})`;

    canvas.appendChild(wrap);

    /* 6. 固定 HUD:悬停时显示光标在画布坐标系里的 x / y */
    const hud = document.createElement('div');
    hud.className = 'timeline-debug-hud';
    hud.textContent = `画布 ${T.canvasW}×${T.canvasH} · 光标 —`;
    timeline.appendChild(hud);
  }

  /** 接缝遮罩云:在 y=1080(bg1/bg2)与 y=2160(bg2/bg3)接缝处各放 2 朵云,
   *  横向错开 + 尺寸不同,形成云团;绝对定位在 .timeline-canvas 内,随页面滚动,
   *  全程遮盖接缝;CSS keyframes 提供轻微横向漂移。
   *  云的层级 z5 高于船 z4,让船在云下穿行,视觉上增加纵深。 */
  function setupSeamClouds(): void {
    const canvas = canvasEl();
    if (!canvas) return;
    if (canvas.querySelector('.timeline-seam-cloud')) return;

    const clouds = ASSETS.timelineSeamClouds;
    const { w } = canvasSize();
    // 每个接缝 4 朵云,横向铺满整个接缝,位置/尺寸/漂移错落
    const seams = [
      // 接缝 1:y=1080(bg1/bg2)
      { src: clouds[0], leftFrac: -0.15, widthFrac: 0.48, centerYFrac: 1080 / 3240, driftX:  70, driftDur: 38, driftDelay:  -6, opacity: 0.92 },
      { src: clouds[1], leftFrac:  0.25, widthFrac: 0.42, centerYFrac: 1080 / 3240, driftX: -55, driftDur: 30, driftDelay: -20, opacity: 0.88 },
      { src: clouds[2], leftFrac:  0.55, widthFrac: 0.50, centerYFrac: 1080 / 3240, driftX:  60, driftDur: 34, driftDelay: -12, opacity: 0.90 },
      { src: clouds[0], leftFrac:  0.82, widthFrac: 0.40, centerYFrac: 1080 / 3240, driftX: -48, driftDur: 26, driftDelay: -28, opacity: 0.85 },
      // 接缝 2:y=2160(bg2/bg3)
      { src: clouds[1], leftFrac: -0.12, widthFrac: 0.46, centerYFrac: 2160 / 3240, driftX: -65, driftDur: 36, driftDelay: -10, opacity: 0.92 },
      { src: clouds[2], leftFrac:  0.22, widthFrac: 0.50, centerYFrac: 2160 / 3240, driftX:  55, driftDur: 32, driftDelay: -24, opacity: 0.88 },
      { src: clouds[0], leftFrac:  0.58, widthFrac: 0.44, centerYFrac: 2160 / 3240, driftX: -60, driftDur: 30, driftDelay: -16, opacity: 0.90 },
      { src: clouds[1], leftFrac:  0.85, widthFrac: 0.38, centerYFrac: 2160 / 3240, driftX:  50, driftDur: 28, driftDelay: -30, opacity: 0.85 },
    ];

    seams.forEach((s) => {
      const img = document.createElement('img');
      img.src = s.src;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.className = 'timeline-seam-cloud';
      const cw = w * s.widthFrac;
      img.style.width = `${cw}px`;
      img.style.left = `${w * s.leftFrac}px`;
      // top 用 calc:画布高 × centerYFrac − 云高/2;云高 ≈ 云宽 × 0.5(估算,云图宽高比约 2:1)
      const approxH = cw * 0.5;
      img.style.top = `calc(${s.centerYFrac * 100}% - ${approxH / 2}px)`;
      img.style.opacity = String(s.opacity);
      img.style.setProperty('--drift-x', `${s.driftX}px`);
      img.style.setProperty('--drift-dur', `${s.driftDur}s`);
      img.style.setProperty('--drift-delay', `${s.driftDelay}s`);
      canvas.appendChild(img);
    });
  }

  /** 挂载装饰层:flower → bg-1,birds → bg-2,bamboo → bg-3。
   *  每张图为 1920×1080 整幅透明画布,位置由美工预排,铺满对应 bg 几何盒即严格对位。
   *  摇晃动画:CSS keyframes decorSway,每张图随机周期/相位错开,避免同相位摆。 */
  function setupDecor(): void {
    const canvas = canvasEl();
    if (!canvas) return;
    // 幂等:已挂载则跳过
    if (canvas.querySelector('.timeline-decor')) return;

    const groups: Array<{ bg: number; list: readonly string[] }> = [
      { bg: 0, list: ASSETS.timelineDecor.flower },
      { bg: 1, list: ASSETS.timelineDecor.birds },
      { bg: 2, list: ASSETS.timelineDecor.bamboo },
    ];

    groups.forEach(({ bg, list }) => {
      const holder = document.createElement('div');
      holder.className = 'timeline-decor';
      holder.dataset.bg = String(bg);
      list.forEach((src, i) => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        // 周期 5.0s~6.6s 随机,相位 0~4s 随机负偏移(保证动画立即处于中段,不在起点)
        const dur = 5.0 + ((i * 7919) % 17) / 10;   // 确定性伪随机
        const delay = -(((i * 104729) % 40) / 10);
        img.style.setProperty('--sway-dur', `${dur}s`);
        img.style.setProperty('--sway-delay', `${delay}s`);
        holder.appendChild(img);
      });
      canvas.appendChild(holder);
    });
  }

  /** 绑定事件 */
  function bindEvents(): void {
    const onResize = () => {
      layoutNodes();
      snapBoatTo(currentT);
      setupAssets();
    };
    window.addEventListener('resize', onResize);
    cleanupFns.push(() => window.removeEventListener('resize', onResize));

    /* 调试 HUD:鼠标在画布内时实时显示 1920×3240 坐标系下的 x / y */
    if (DEBUG) {
      const onMove = (e: MouseEvent) => {
        const hud = document.querySelector<HTMLElement>('.timeline-debug-hud');
        const canvas = canvasEl();
        if (!hud || !canvas) return;
        const r = canvas.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) {
          hud.textContent = `画布 ${T.canvasW}×${T.canvasH} · 光标 —`;
          return;
        }
        const x = Math.round(((e.clientX - r.left) / r.width) * T.canvasW);
        const y = Math.round(((e.clientY - r.top) / r.height) * T.canvasH);
        hud.textContent = `画布 ${T.canvasW}×${T.canvasH} · 光标 x=${x}  y=${y}`;
      };
      window.addEventListener('mousemove', onMove);
      cleanupFns.push(() => window.removeEventListener('mousemove', onMove));
    }
  }

  function activate(): void {
    if (active) return;
    active = true;

    const timeline = sceneEl();
    if (!timeline) return;

    setupAssets();
    buildNodes();
    bindEvents();

    timeline.classList.remove('is-hidden');
    timeline.removeAttribute('aria-hidden');

    snapBoatTo(currentT);
    startBob();
    scrollToBoat(true);
  }

  function deactivate(): void {
    if (!active) return;
    active = false;

    stopBob();
    cruiseTween?.kill();
    cruiseTween = null;
    cleanupFns.forEach((fn) => fn());
    cleanupFns.length = 0;

    const timeline = sceneEl();
    if (timeline) {
      timeline.classList.add('is-hidden');
      timeline.setAttribute('aria-hidden', 'true');
    }
  }

  return {
    activate,
    deactivate,
    get active() { return active; },
  };
}
