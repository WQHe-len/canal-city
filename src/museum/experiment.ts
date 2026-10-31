/**
 * 博物馆开幕页实验交互（可独立开关）。
 *
 * 效果 A：博物馆伪 3D 晃动 —— 鼠标在主体上移动时，根据相对中心的位置做轻微
 *         rotateX / rotateY + perspective，带惯性缓动，离开后平滑归位。
 * 效果 B：船图动态蒙版显露 —— 在博物馆主体上叠加同尺寸船图，用 radial-gradient
 *         mask 跟随鼠标局部显露，边缘柔和、带少量拖尾，离开后淡出。
 * 效果 C：博物馆 2.5D 分层视差（最小实验，默认关闭）—— 分带层由 parallax25d.ts 提供，
 *         本模块把缓动后的指针位置喂给它，并把整幅「相机」漂移并入舞台 transform。
 *
 * 实现要点（避免破坏已交付的开幕转场）：
 *  - 倾斜/缩放 transform 放在注入的 .museum-3d 包装层上，#museum-trigger 原有的
 *    translateX(-50%) 定位与转场时 GSAP 的 scale/opacity/filter 完全不受影响。
 *  - 原 #museum-img 的 CSS hover scale 被 !important 覆盖，改由本模块统一管理
 *    （与 rotate 合并进同一 transform，避免 CSS transition 与 rAF 打架）。
 *  - 船图蒙版层 pointer-events: none，不拦截博物馆点击事件。
 *  - 仅在 (hover:hover) 且 (pointer:fine) 且非 prefers-reduced-motion 时启用；
 *    触屏与减弱动态下直接返回 null，保持静态展示。
 *  - teardown() 可随时撤销所有 DOM / 样式 / 监听，恢复原开幕页。
 */
import { EXPERIMENT } from '../config/motion';
import { ASSETS } from '../config/assets';
import { createParallax25D, type Parallax25D } from './parallax25d';

export interface MuseumExperiment {
  teardown: () => void;
}

export function setupMuseumExperiment(): MuseumExperiment | null {
  if (!EXPERIMENT.enabled) return null;

  // 调试钩子：?exp 强制启用（无视触屏/减弱动效），便于在自动化环境中验证；
  // ?25d 额外单独预演 2.5D 分层视差（同时临时关闭 tilt3d）。与项目已有 ?sea=1 钩子同性质，非用户可见入口。
  const params = new URLSearchParams(location.search);
  const preview25d = params.has('25d');
  const force = params.has('exp') || preview25d;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!force && (reduceMotion || !finePointer)) return null;

  const trigger = document.getElementById('museum-trigger');
  const img = document.getElementById('museum-img') as HTMLImageElement | null;
  if (!trigger || !img) return null;

  const tiltCfg = EXPERIMENT.tilt3d;
  const revealCfg = EXPERIMENT.boatReveal;
  // ?25d 预演时临时关掉倾斜，避免两个效果叠加影响观察
  const tiltOn = tiltCfg.enabled && !preview25d;

  /* ---------- 注入实验样式（随 teardown 移除） ---------- */
  const style = document.createElement('style');
  style.textContent = `
    .museum-3d {
      position: relative;
      width: 100%;
      transform-style: preserve-3d;
      will-change: transform;
    }
    /* 覆盖原 #museum-img 的 hover scale + transition，统一由 JS 管理 transform */
    .museum-3d #museum-img {
      transition: none !important;
      transform: none !important;
      display: block;
      width: 100%;
      height: auto;
    }
    .museum-boat-reveal {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0;
      transition: opacity var(--reveal-fade, 0.5s) ease;
      -webkit-mask-image: radial-gradient(circle at var(--mx, 50%) var(--my, 50%), #000 0%, #000 var(--r-solid, 15%), transparent var(--r, 30%));
      mask-image: radial-gradient(circle at var(--mx, 50%) var(--my, 50%), #000 0%, #000 var(--r-solid, 15%), transparent var(--r, 30%));
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
    }
    .museum-boat-reveal.is-active { opacity: 1; }
    .boat-reveal-img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: var(--boat-fit, cover);
      object-position: center;
      transform: scale(var(--boat-scale, 1)) translate(var(--boat-ox, 0), var(--boat-oy, 0));
      display: block;
    }
  `;
  document.head.appendChild(style);

  /* ---------- 构建 DOM：把 #museum-img 包进 .museum-3d，船图层叠在其上 ---------- */
  const stage = document.createElement('div');
  stage.className = 'museum-3d';
  img.parentNode!.insertBefore(stage, img);
  stage.appendChild(img);

  // 效果 C：2.5D 分层视差（插在原始底层之上、船图蒙版层之下）
  const parallax: Parallax25D | null = createParallax25D(stage, preview25d);
  const camX = parallax ? parallax.cameraX : 0;
  const camY = parallax ? parallax.cameraY : 0;

  let reveal: HTMLDivElement | null = null;
  if (revealCfg.enabled) {
    reveal = document.createElement('div');
    reveal.className = 'museum-boat-reveal';
    reveal.setAttribute('aria-hidden', 'true');
    const boatImg = document.createElement('img');
    boatImg.className = 'boat-reveal-img';
    boatImg.alt = '';
    boatImg.src = ASSETS.boat;
    reveal.appendChild(boatImg);
    stage.appendChild(reveal);

    // 蒙版与船图定位参数（仅初始化一次；运行时只更新 --mx / --my）
    reveal.style.setProperty('--reveal-fade', `${revealCfg.fadeOut}s`);
    reveal.style.setProperty('--r', `${revealCfg.radius}%`);
    reveal.style.setProperty('--r-solid', `${revealCfg.radius * (1 - revealCfg.softness)}%`);
    reveal.style.setProperty('--boat-scale', String(revealCfg.boatScale));
    reveal.style.setProperty('--boat-ox', `${revealCfg.boatOffsetX}%`);
    reveal.style.setProperty('--boat-oy', `${revealCfg.boatOffsetY}%`);
    reveal.style.setProperty('--boat-fit', revealCfg.boatFit);
  }

  /* ---------- 交互状态 ---------- */
  // 归一化指针位置（-1..1，相对主体中心），经 rAF 缓动后同时驱动倾斜 / 相机 / 2.5D 分带
  let targetNx = 0;
  let targetNy = 0;
  let curNx = 0;
  let curNy = 0;
  let targetScale = 1;
  let curScale = 1;

  // 船图蒙版位置（% 画布）
  let targetMX = 50;
  let targetMY = 50;
  let curMX = 50;
  let curMY = 50;

  const onMove = (e: MouseEvent): void => {
    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // 归一化到 -1..1（相对主体中心）
    targetNx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    targetNy = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    if (reveal) {
      targetMX = ((e.clientX - rect.left) / rect.width) * 100;
      targetMY = ((e.clientY - rect.top) / rect.height) * 100;
    }
  };

  const onEnter = (): void => {
    if (tiltOn) targetScale = tiltCfg.hoverScale;
    if (reveal) reveal.classList.add('is-active');
  };

  const onLeave = (): void => {
    targetNx = 0;
    targetNy = 0;
    targetScale = 1;
    if (reveal) reveal.classList.remove('is-active');
  };

  trigger.addEventListener('mousemove', onMove);
  trigger.addEventListener('mouseenter', onEnter);
  trigger.addEventListener('mouseleave', onLeave);

  /* ---------- 统一 rAF 循环：指针缓动 → 倾斜 / 相机漂移 / 2.5D 分带 / 蒙版位置 ---------- */
  let rafId = 0;
  const tick = (): void => {
    const e = tiltOn ? tiltCfg.ease : 0.2;
    curNx += (targetNx - curNx) * e;
    curNy += (targetNy - curNy) * e;
    curScale += (targetScale - curScale) * e;

    // 舞台变换：相机漂移 + 伪 3D 倾斜 + 缩放，合并成单一 transform 避免互相覆盖
    let tr = '';
    if (camX !== 0 || camY !== 0) {
      tr += `translate3d(${(curNx * camX).toFixed(3)}%, ${(curNy * camY).toFixed(3)}%, 0) `;
    }
    if (tiltOn) {
      // 卡片向光标方向倾斜：光标在哪一侧，那一侧向前
      tr +=
        `perspective(${tiltCfg.perspective}px) ` +
        `rotateX(${(curNy * tiltCfg.maxTiltX).toFixed(3)}deg) ` +
        `rotateY(${(-curNx * tiltCfg.maxTiltY).toFixed(3)}deg) `;
    }
    tr += `scale(${curScale.toFixed(4)})`;
    stage.style.transform = tr;

    // 2.5D：把缓动后的左右指针位置传给分带层做差速位移
    parallax?.update(curNx);

    if (reveal) {
      const t = revealCfg.trailing;
      curMX += (targetMX - curMX) * t;
      curMY += (targetMY - curMY) * t;
      reveal.style.setProperty('--mx', `${curMX.toFixed(2)}%`);
      reveal.style.setProperty('--my', `${curMY.toFixed(2)}%`);
    }

    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  /* ---------- 撤销：移除样式、还原 DOM、解绑监听 ---------- */
  const teardown = (): void => {
    cancelAnimationFrame(rafId);
    trigger.removeEventListener('mousemove', onMove);
    trigger.removeEventListener('mouseenter', onEnter);
    trigger.removeEventListener('mouseleave', onLeave);
    parallax?.teardown();
    style.remove();
    // 把 #museum-img 还原到 #museum-trigger 的直接子节点
    if (stage.parentNode) {
      stage.parentNode.insertBefore(img, stage);
      stage.parentNode.removeChild(stage);
    }
  };

  return { teardown };
}
