/**
 * 博物馆 2.5D 分层视差（最小实验，可独立开关）。
 *
 * 不切图、不改素材：把同一张 museum.webp 复制成若干条纵向「分带层」，按纵深权重做
 * 差速水平位移，从而模拟真分层视差的空间纵深感 —— 先看效果，再决定是否让美术出真实分层切图。
 *
 * 叠合策略（保证任意位置合成 α 恒为 1，不露底、无重影，且不依赖底层对齐）：
 *   - 第 1 条带（最上层区域）整幅不透明，作为不透明底层；
 *   - 其后每一条带从「自身顶部接缝」处淡入，并一直保持不透明（遮蔽下方条带）。
 *   - 于是接缝处只混合相邻两层；静止时全部位移为 0 → 叠合结果 = 原图。
 *
 * 结构（由外到内）：
 *   .museum-3d（experiment.ts 建立的舞台，承担倾斜 + 相机漂移）
 *     ├ #museum-img            ← 原始底层（定义高度；被分带层完全覆盖，不参与显示）
 *     ├ .p25-band × N          ← 分带层（本模块创建，插在底层之上；DOM 顺序 = 索引顺序 = 层级）
 *     │   └ <img>              ← 同一张 museum.webp，运行时只做 translateX
 *     └ .museum-boat-reveal    ← 船图蒙版层（effect B，叠在最上，故本层在其下）
 *
 * 关键点：
 *  - 蒙版加在「带层」上、位移加在带层内的 <img> 上 → 蒙版窗口固定、内容在其中滑动，
 *    接缝在带层内部软化，不会连带把蒙版一起平移而露出缺口。
 *  - 素材边缘为透明（内容仅在 x 6.6%~90.7%），位移量（≤1%）远小于透明边距，
 *    故左右边缘错位落在透明区，不露背景、不穿帮 → 无需边缘羽化。
 *  - pointer-events: none，不拦截 #museum-trigger 的点击。
 *  - teardown() 移除全部注入元素与样式，恢复原状。
 */
import { EXPERIMENT } from '../config/motion';
import { ASSETS } from '../config/assets';

export interface Parallax25D {
  /** 传入已缓动的归一化指针位置 nx ∈ -1..1（左右），驱动各分带差速位移 */
  update: (nx: number) => void;
  /** 整幅「相机」漂移系数（占宽/高 %），供 experiment 写入舞台 transform */
  cameraX: number;
  cameraY: number;
  teardown: () => void;
}

/**
 * @param stage  experiment.ts 已建立的 .museum-3d 舞台（含原始 #museum-img 底层）
 * @param forced 调试钩子：true 时无视 config 的 enabled 强制启用（对应 URL ?25d）
 */
export function createParallax25D(stage: HTMLElement, forced = false): Parallax25D | null {
  const cfg = EXPERIMENT.parallax25d;
  if (!forced && !cfg.enabled) return null;

  const base = stage.querySelector<HTMLImageElement>('#museum-img');
  if (!base || !base.parentNode) return null;

  const style = document.createElement('style');
  style.textContent = `
    .p25-band {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      will-change: transform;
    }
    .p25-band > img {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: auto;
      display: block;
      will-change: transform;
    }
  `;
  document.head.appendChild(style);

  const f = cfg.feather;
  const layers: { img: HTMLImageElement; weight: number }[] = [];
  const els: HTMLElement[] = [];

  cfg.bands.forEach((band, i) => {
    const el = document.createElement('div');
    el.className = 'p25-band';
    el.setAttribute('aria-hidden', 'true');

    // 第 1 条带整幅不透明（不透明底层）；其后每条带仅需一条「顶部淡入」渐变：
    // from-f 之前透明 → from+f 处为不透明 → 之后保持不透明（末色自动延续）。
    // 末色延续 + DOM 顺序 = 索引顺序，使每条后带遮住前带，合成 α 恒为 1。
    if (i > 0) {
      let mask = `linear-gradient(to bottom, transparent ${band.from - f}%, #000 ${band.from + f}%)`;
      if (cfg.edgeFeather > 0) {
        const e = cfg.edgeFeather;
        mask = `${mask}, linear-gradient(to right, transparent 0%, #000 ${e}%, #000 ${100 - e}%, transparent 100%)`;
        el.style.webkitMaskComposite = 'source-in';
        el.style.maskComposite = 'intersect';
      }
      el.style.webkitMaskImage = mask;
      el.style.maskImage = mask;
    }

    const im = document.createElement('img');
    im.alt = '';
    im.src = ASSETS.museumPlaceholder;
    el.appendChild(im);

    // 按索引顺序追加到舞台末尾 → DOM 顺序 = 索引顺序 = 层级（后一条带盖住前一条带）；
    // 底层 #museum-img 仍在其下，船图蒙版层随后追加、位于本层之上
    stage.appendChild(el);

    els.push(el);
    layers.push({ img: im, weight: band.weight });
  });

  const update = (nx: number): void => {
    for (const l of layers) {
      const dx = nx * cfg.maxShift * l.weight;
      l.img.style.transform = `translate3d(${dx.toFixed(3)}%, 0, 0)`;
    }
  };

  const teardown = (): void => {
    style.remove();
    els.forEach((el) => el.remove());
  };

  return { update, cameraX: cfg.cameraX, cameraY: cfg.cameraY, teardown };
}
