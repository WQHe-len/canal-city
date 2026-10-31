import gsap from 'gsap';
import { BOAT, ROPE, HERO } from '../config/motion';

/**
 * 船体装配：
 * 1) 在船图上叠加同坐标系 SVG（viewBox 1920×1080），绘制从最后一根桅杆顶部
 *    垂下的绳索；固定端用桅顶实测坐标，自由端挂绳结吊坠（复用 挂绳.png 裁切件）。
 * 2) .boat-inner 每帧按正弦公式驱动「乘风破浪」摇晃（主正弦 + 二次谐波，
 *    上下浮动/横向漂移错相叠加，连续无停顿，详见 BOAT 配置与下方 rockTick）。
 * 3) 绳索在随船整体运动的基础上，绕锚点做相位错开的滞后钟摆。
 * 绳索与船处于同一变换参考系（都在 .boat-inner 内），锚点永不漂移。
 */
export interface BoatRig {
  /** 初始隐藏，由场景时间轴控制入场 */
  enterTimeline: gsap.core.Timeline;
  kill: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

export function rigBoat(): BoatRig {
  const inner = document.querySelector<HTMLElement>('#boat-wrap .boat-inner')!;

  /* ---------- 尺寸/位置参数：博物馆与船共用 HERO 配置（motion.ts） ----------
   * 变量注入到 :root，博物馆（首屏）与船（海面）均引用同一套 --hero-* 变量，
   * 保证点击转场时两者位置完全一致、无跳动。 */
  const root = document.documentElement;
  root.style.setProperty('--hero-width', HERO.width);
  root.style.setProperty('--hero-width-m', HERO.widthMobile);
  root.style.setProperty('--hero-bottom', `${HERO.bottomVh}vh`);
  root.style.setProperty('--hero-bottom-m', `${HERO.bottomVhMobile}vh`);

  /* ---------- 绳索 SVG ---------- */
  const svg = svgEl('svg');
  svg.setAttribute('viewBox', '0 0 1920 1080');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'rope-svg');

  const sway = svgEl('g');
  sway.setAttribute('id', 'rope-sway');

  // 悬垂弧线：锚点 → 自由端（前段压在帆面索具间，后段甩入帆与船舱的暗空，
  // 绳结悬在暗背景上，摆动时清晰可见）
  const d = `M ${ROPE.anchorX} ${ROPE.anchorY}
             C 902 295, 1150 400, ${ROPE.endX} ${ROPE.endY}`;

  const dark = svgEl('path');
  dark.setAttribute('d', d);
  dark.setAttribute('fill', 'none');
  dark.setAttribute('stroke', ROPE.strokeDark);
  dark.setAttribute('stroke-width', String(ROPE.strokeWidthDark));
  dark.setAttribute('stroke-linecap', 'round');
  dark.setAttribute('opacity', '0.85');

  const main = svgEl('path');
  main.setAttribute('d', d);
  main.setAttribute('fill', 'none');
  main.setAttribute('stroke', ROPE.strokeMain);
  main.setAttribute('stroke-width', String(ROPE.strokeWidthMain));
  main.setAttribute('stroke-linecap', 'round');

  const hi = svgEl('path');
  hi.setAttribute('d', d);
  hi.setAttribute('fill', 'none');
  hi.setAttribute('stroke', ROPE.strokeHi);
  hi.setAttribute('stroke-width', String(ROPE.strokeWidthHi));
  hi.setAttribute('stroke-linecap', 'round');
  hi.setAttribute('opacity', '0.7');

  sway.appendChild(dark);
  sway.appendChild(main);
  sway.appendChild(hi);

  // 绑扎点（桅杆上的绳头小结）
  const tie = svgEl('circle');
  tie.setAttribute('cx', String(ROPE.anchorX));
  tie.setAttribute('cy', String(ROPE.anchorY));
  tie.setAttribute('r', '9');
  tie.setAttribute('fill', ROPE.strokeDark);
  sway.appendChild(tie);

  // 自由端绳结吊坠（来自 挂绳.png 的裁切件）
  const knot = svgEl('image');
  knot.setAttribute('href', ROPE.knotSrc);
  knot.setAttribute('x', String(ROPE.endX - ROPE.knotW / 2));
  knot.setAttribute('y', String(ROPE.endY - 6));
  knot.setAttribute('width', String(ROPE.knotW));
  knot.setAttribute('height', String(ROPE.knotH));
  sway.appendChild(knot);

  svg.appendChild(sway);
  inner.appendChild(svg);

  /* ---------- 主摇晃：主正弦 + 二次谐波，连续自然 ----------
   * 旧实现用「关键帧 + 单条 ease 作用于每一段」，每个关键帧处速度都归零，
   * 船在左右极限长时间停住、像钟摆一样机械。现改为每帧按公式求值：
   *   rotation = swayAmp·sin(ωt) + sway2Amp·sin(2ωt)   （ω = 2π/period）
   * 二次谐波让两侧摆幅/速度不对称（一侧慢、一侧快），消除匀速钟摆感；
   * 函数连续且严格以 period 为周期 → 循环无跳变、永不静止。
   * 上下浮动与横向漂移用不同周期比的正弦错相叠加，增强水面起伏。 */
  gsap.set(inner, { transformOrigin: `${BOAT.originX} ${BOAT.originY}` });

  let elapsed = 0; // 已运行秒数（由 gsap.ticker 的 deltaTime 累加，节流后仍连续）
  const rockTick = (_time: number, deltaMs: number): void => {
    elapsed += deltaMs / 1000;
    const w = (Math.PI * 2) / BOAT.period;
    const rotation =
      BOAT.swayAmp * Math.sin(w * elapsed) +
      BOAT.sway2Amp * Math.sin(2 * w * elapsed + BOAT.sway2Phase);
    const y = -BOAT.bobAmp * Math.sin((w / BOAT.bobRatio) * elapsed);
    const x = BOAT.driftAmp * Math.sin((w / BOAT.driftRatio) * elapsed);
    gsap.set(inner, { rotation, x, y });
  };
  gsap.ticker.add(rockTick);

  /* ---------- 绳索滞后钟摆（相位/周期均与船体错开） ---------- */
  const ropeKeyframes: Record<string, any> = {};
  ROPE.times.forEach((t, i) => {
    ropeKeyframes[`${Math.round(t * 100)}%`] = { rotation: ROPE.rotation[i] };
  });
  ropeKeyframes.ease = 'sine.inOut';

  const ropeSwing = gsap.timeline({ repeat: -1 });
  ropeSwing.to(sway, {
    duration: ROPE.duration,
    keyframes: ropeKeyframes,
    svgOrigin: `${ROPE.anchorX} ${ROPE.anchorY}`,
    ease: 'none',
  });

  return {
    enterTimeline: gsap.timeline(),
    kill: () => {
      gsap.ticker.remove(rockTick);
      ropeSwing.kill();
    },
  };
}
