/**
 * 博物馆页飞鸟群：8 只 bird.webp + CSS keyframes 横穿屏幕
 *
 * 纯 CSS 方案：每只鸟的飞行轨迹（translateX 主水平 + translateY 微浮动 + scale 恒定）
 * 由一条复合 keyframes 驱动，所有随机参数通过 CSS 变量注入。
 *
 * 可见窗口由 `.bird-sky` 的 clip-path 控制（JS 在 activate 时写入）：
 *   clip-path: inset(0 var(--clip-r) 0 var(--clip-l))
 * keyframes 全程横穿 -20vw → +100vw（120vw 安全距离），但只在窗口内露出——
 * 进窗口时自然飞入、出窗口时自然飞出，不需要 opacity 渐变。
 * 改飞行范围大小只动 BIRDS.visibleStartVw / visibleEndVw / offscreenPadVw 三参数。
 *
 * 起始延迟全负（按每只鸟自己的 dur 动态：rand(-dur, -dur*0.05)），
 * activate 时每只鸟必然已飞到轨迹中段，不会有任何鸟停在起始点等待露馅。
 *
 * GIF 挂载时机：activate() 里才写 src（preload 已缓存，翅膀动画与博物馆激活同步）；
 * teardown 清空销毁实例，防止下次进缓存复用翅膀定格。
 * 配置集中在 motion.ts BIRDS。
 */

import { BIRDS } from '../config/motion';

export interface BirdScene {
  activate: () => void;
  teardown: () => void;
}

/** [lo, hi) 均匀随机浮点数 */
function rand(lo: number, hi: number): number { return lo + Math.random() * (hi - lo); }

/** 生成一只鸟（不再写 --bird-start-x，keyframes 已改为固定 -20vw → +100vw） */
function spawnBird(): HTMLElement {
  const el = document.createElement('img');
  el.className = 'bird';
  el.alt = '';

  // 视差等级：近大鸟（scale 大）飞更快（dur 短），远小鸟更慢
  const scale = rand(BIRDS.scaleMin, BIRDS.scaleMax);
  const depthNorm = (scale - BIRDS.scaleMin) / (BIRDS.scaleMax - BIRDS.scaleMin); // 0=远 → 1=近
  const dur = BIRDS.durMax - (BIRDS.durMax - BIRDS.durMin) * depthNorm; // 远=14s 近=6s
  const opacity = rand(
    BIRDS.opacityMin,
    BIRDS.opacityMin + (BIRDS.opacityMax - BIRDS.opacityMin) * (0.3 + 0.7 * depthNorm),
  );

  // 飞行高度（vh 范围随机）
  const topVh = rand(BIRDS.vTopMinVh, BIRDS.vTopMaxVh);

  // 起始延迟：全负、按每只鸟自己的 dur 动态——activate 时鸟必然已在轨迹中段
  const delay = rand(-dur, -dur * 0.05);

  // 微浮动振幅
  const bob = rand(BIRDS.bobAmpMin, BIRDS.bobAmpMax).toFixed(1);

  // 反向飞标记 + CSS 变量
  if (Math.random() < BIRDS.reverseProb) el.classList.add('reverse');
  el.style.setProperty('--bird-scale', scale.toFixed(2));
  el.style.setProperty('--bird-dur', `${dur.toFixed(1)}s`);
  el.style.setProperty('--bird-delay', `${delay.toFixed(2)}s`);
  el.style.setProperty('--bird-opacity', opacity.toFixed(2));
  el.style.setProperty('--bird-top-vh', topVh.toFixed(1));
  el.style.setProperty('--bird-bob', `${bob}px`);

  requestAnimationFrame(() => { el.src = 'assets/bird.webp'; });
  return el;
}

export function createBirdScene(): BirdScene {
  let sky: HTMLElement | null = null;
  let active = false;

  function activate() {
    if (active) return;
    sky = document.querySelector('.bird-sky');
    if (!sky) { console.warn('[bird-sky] 未找到 .bird-sky 容器'); return; }

    // clip-path inset(top right bottom left)：可见区域 = 左内缩 → (100-右内缩) vw
    // 鸟的 keyframes 0% = translate(-20vw)（屏左 -20vw），100% = translate(100vw)（屏右外）
    // 我们要的可见窗口是 visibleStartVw → visibleEndVw（默认 25 → 75 vw），
    // 外加 offscreenPadVw（15vw）缓冲让鸟在窗口外开始/结束飞行——保证飞入飞出不露馅。
    // 左内缩 = visibleStartVw - offscreenPadVw = 25 - 15 = 10vw → 可见区左缘 10vw，
    //   鸟从 -20vw 飞来 → 越过 10vw 时恰好进入视野（飞行距离 ≈ 30vw 的缓冲，自然飞入）
    // 右内缩 = 100 - visibleEndVw - offscreenPadVw = 100 - 75 - 15 = 10vw → 可见区右缘 90vw，
    //   鸟飞到 90vw 时开始离开视野（飞过 100vw 时完全消失）
    const clipL = Math.max(0, BIRDS.visibleStartVw - BIRDS.offscreenPadVw);
    const clipR = Math.max(0, 100 - BIRDS.visibleEndVw - BIRDS.offscreenPadVw);
    sky.style.setProperty('--clip-l', `${clipL}vw`);
    sky.style.setProperty('--clip-r', `${clipR}vw`);

    active = true;
    for (let i = 0; i < BIRDS.count; i++) sky.appendChild(spawnBird());
  }

  function teardown() {
    if (!active || !sky) return;
    active = false;
    sky.innerHTML = '';
  }

  return { activate, teardown };
}
