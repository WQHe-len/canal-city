/**
 * 第二幕展陈道具序列（展柜 / 罐 / 浪花）
 *
 * 时间基准（ACT2.reveal.props）：anchorSec = 相对「船定格瞬间」的秒数，锚点取 3D 船开始
 * 旋转上升的瞬间（reveal.moveStart）。每项 delaySec 相对该锚点：
 *   anchorSec + delaySec < 0 → 换算成滚动进度阈值，到进度立即升起（连播路径下秒数精确）；
 *   ≥ 0 → 定格（prog 1.0）后按秒排计时器。
 * 退到阈值下：撤销未触发的计时、隐藏已升起的道具（浪花同时暂停并复位到 0），
 * 重回重新计时重播 —— 与书法字层（fonts）同一套语义。
 *
 * 层级由 index.html 的 DOM 位置决定：道具层在 #act2-three 之前（船体遮挡），
 * 浪花层在道具层之后、「通」之前（压在「通」之下）。
 *
 * 素材均为 16:9 整幅透明画布、位置由美工预排 → 代码零位移参数：
 *   - 展柜：淡入 + 上浮 + 「由小变大」（缩放轴心 = 画布中心，两张素材都是左右对称环境框）
 *   - 陶罐：淡入 + 上浮，落位后再以各自罐底为轴心轻晃一下停稳（轴心见 props.jarSettle.origins）
 *   - 浪花：浪花1 加速播一遍 → 末尾立刻接浪花2 无限循环（播放器见 wavePlayer.ts）
 */

import gsap from 'gsap';
import { ACT2 } from '../config/motion';
import { createWavePlayer } from './wavePlayer';

/** 相对定格秒数 → { 进度阈值, 到阈值后再延时秒数 }
 *  负值按连播段时长/缓动反解进度（与 act2Scene 共用：书法字、按钮、道具同一套换算）。
 *  公式对应 ACT2.chapters 的 easeRise = power1.in（章1 线性）、easeSpin = power1.out（章2 线性）；
 *  若改动缓动类型，此处需同步改写。 */
export function delaySecToThreshold(delaySec: number): { threshold: number; delay: number } {
  if (delaySec >= 0) return { threshold: 0.999, delay: delaySec };
  const C = ACT2.chapters;
  const t = C.durTransition + C.durRotation + delaySec; // 距连播开始的绝对秒数
  if (t <= 0) return { threshold: 0, delay: 0 };
  if (t <= C.durTransition) return { threshold: 0.5 * (t / C.durTransition), delay: 0 };
  const u = Math.min(1, (t - C.durTransition) / C.durRotation);
  return { threshold: 0.5 + 0.5 * u, delay: 0 };
}

export interface Act2Props {
  /** boot 预载：浪花两段 GIF 取回并解码（幂等） */
  prepare: () => void;
  /** tick 每帧调用：按当前进度驱动全部道具与浪花 */
  drive: (prog: number) => void;
  /** 场景复位 / 停用：撤销全部计时、隐藏道具、浪花归零 */
  reset: () => void;
}

interface ItemState {
  el: HTMLImageElement | null;
  threshold: number;
  delay: number;
  riseDurSec: number;
  /** 该组的整体目标不透明度（展柜 / 陶罐分组） */
  opacity: number;
  timer: number;
  shown: boolean;
  /** 陶罐组：只有罐子做落位轻晃，展柜做缩放入场 */
  isJar: boolean;
  /** 摆动方向（±1）：按序列交错，避免 8 只罐子同向齐晃 */
  dir: number;
  /** 落位轻晃补间（隐藏 / 复位时必须 kill） */
  wobble: gsap.core.Tween | null;
}

export function createAct2Props(): Act2Props | null {
  const P = ACT2.reveal.props;
  if (!P.enable) return null;

  /* —— 道具：按配置生成状态，元素用 class 惰性查找（HTML 中已静态存在） —— */
  const items: ItemState[] = P.items.map((cfg, i) => {
    const { threshold, delay } = delaySecToThreshold(P.anchorSec + cfg.delaySec);
    const el = document.querySelector<HTMLImageElement>(`.act2-prop-${cfg.key}`);
    /* 静态 PNG：创建时即挂 src（已在预载列表，不会闪）；道具层靠 opacity/visibility 控制显隐 */
    if (el) el.src = cfg.src;
    /* key 以 jar 开头 = 陶罐组，其余 = 展柜组 */
    const isJar = cfg.key.startsWith('jar');
    /* 罐子的旋转轴心落到各自罐底：素材是整幅画布，默认 50%/50% 落在画布中心，
     * 直接旋转会把罐子绕空处甩出去 */
    if (el && isJar) {
      const o = P.jarSettle.origins[cfg.key];
      if (o) el.style.transformOrigin = `${o[0]}% ${o[1]}%`;
    }
    return {
      el,
      threshold,
      delay,
      riseDurSec: cfg.riseDurSec ?? P.riseDurSec,
      opacity: isJar ? P.groupOpacity.jar : P.groupOpacity.case,
      timer: 0,
      shown: false,
      isJar,
      dir: i % 2 === 0 ? 1 : -1,
      wobble: null,
    };
  });

  /** 罐子落位轻晃：以罐底为轴心的衰减正弦摆动。
   *  振幅 (1-u)^decay 与相位 sin(swings·π·u) 在 u=1 同时归零 → 收尾无跳变；
   *  u=0 时相位也为 0 → 起摆瞬间没有角度突跳。 */
  function startJarSettle(st: ItemState): void {
    const J = P.jarSettle;
    if (!J.enable || !st.el) return;
    const el = st.el;
    st.wobble?.kill();
    const state = { t: 0 };
    st.wobble = gsap.to(state, {
      t: J.durSec,
      duration: J.durSec,
      ease: 'none',
      onUpdate: () => {
        const u = Math.min(1, state.t / J.durSec);
        const amp = J.angleDeg * Math.pow(1 - u, J.decay) * st.dir;
        gsap.set(el, { rotation: amp * Math.sin(J.swings * Math.PI * u) });
      },
      onComplete: () => {
        gsap.set(el, { rotation: 0 });
        st.wobble = null;
      },
    });
  }

  const showItem = (st: ItemState): void => {
    if (!st.el) return;
    st.shown = true;
    const el = st.el;
    // 展柜：缩放/升起与渐显拆成两条并行补间——透明度独立延时淡入（不再跟随缩放节奏），
    // 视觉上是「先由小变大成形、再逐渐显影」。罐子保持原有的单条 fromTo。
    if (!st.isJar) {
      gsap.set(el, { opacity: 0, visibility: 'visible' });
      gsap.fromTo(el,
        { yPercent: P.riseFromYPercent, scale: P.caseScaleFrom },
        { yPercent: 0, scale: 1, duration: st.riseDurSec, ease: 'power2.out', overwrite: 'auto' });
      gsap.fromTo(el,
        { opacity: 0 },
        {
          opacity: st.opacity,
          duration: P.caseFadeDurSec,
          delay: P.caseFadeDelaySec,
          ease: 'power2.inOut',
          overwrite: 'auto',
        });
      return;
    }
    gsap.fromTo(
      el,
      {
        opacity: 0,
        visibility: 'visible',
        yPercent: P.riseFromYPercent,
        scale: 1,
      },
      {
        opacity: st.opacity,
        yPercent: 0,
        scale: 1,
        duration: st.riseDurSec,
        ease: 'power2.out',
        overwrite: 'auto',
        // 罐子到位置后才轻轻晃一下（展柜不晃）
        onComplete: () => {
          if (st.isJar) startJarSettle(st);
        },
      },
    );
  };
  const hideItem = (st: ItemState): void => {
    st.shown = false;
    st.wobble?.kill();
    st.wobble = null;
    if (st.el) {
      gsap.set(st.el, {
        opacity: 0,
        visibility: 'hidden',
        yPercent: P.riseFromYPercent,
        scale: 1,
        rotation: 0,
        overwrite: 'auto',
      });
    }
  };

  /* —— 浪花：双段播放器（浪花1 播一遍 → 浪花2 循环 / 定格），见 wavePlayer.ts ——
   * canvas 逐帧绘制，帧序列来自 assets/wave/*.webp，所有浏览器同一条时间轴。 */
  const waveLayer = document.querySelector<HTMLElement>('.act2-wave-layer');
  const waveCanvas = document.querySelector<HTMLCanvasElement>('.act2-wave-canvas');
  const wavePlayer =
    waveLayer && waveCanvas ? createWavePlayer(waveLayer, waveCanvas) : null;
  const waveAt = delaySecToThreshold(P.wave.delaySec);
  let waveTimer = 0;
  let waveShown = false;

  const showWave = (): void => {
    if (waveShown || !wavePlayer) return;
    waveShown = true;
    wavePlayer.play();
  };

  const hideWave = (): void => {
    if (waveTimer) {
      window.clearTimeout(waveTimer);
      waveTimer = 0;
    }
    if (!waveShown) return;
    waveShown = false;
    wavePlayer?.reset();
  };

  function drive(prog: number): void {
    /* 道具 */
    for (const st of items) {
      if (!st.el) continue;
      if (prog >= st.threshold) {
        if (st.shown || st.timer) continue;
        if (st.delay > 0) {
          st.timer = window.setTimeout(() => {
            st.timer = 0;
            showItem(st);
          }, st.delay * 1000);
        } else {
          showItem(st);
        }
      } else if (st.shown || st.timer) {
        if (st.timer) {
          window.clearTimeout(st.timer);
          st.timer = 0;
        }
        hideItem(st);
      }
    }

    /* 浪花 */
    if (prog >= waveAt.threshold) {
      if (!waveShown && !waveTimer) {
        if (waveAt.delay > 0) {
          waveTimer = window.setTimeout(() => {
            waveTimer = 0;
            showWave();
          }, waveAt.delay * 1000);
        } else {
          showWave();
        }
      }
    } else if (waveShown || waveTimer) {
      hideWave();
    }
  }

  function reset(): void {
    for (const st of items) {
      if (st.timer) {
        window.clearTimeout(st.timer);
        st.timer = 0;
      }
      hideItem(st);
    }
    hideWave();
  }

  return { prepare: () => wavePlayer?.prepare(), drive, reset };
}
