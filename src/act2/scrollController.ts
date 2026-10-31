/**
 * 虚拟滚动控制器：wheel/touch 事件 → 归一化进度 progress ∈ [0,1]
 *
 * 设计目标：
 *   项目用 overflow:hidden，没有真实 DOM 滚动——本模块在 window 层监听
 *   wheel（桌面）和 touch（移动端）事件，累计到 targetProgress，然后用 rAF
 *   驱动 progress 以 ease 系数追及 target。所有消费进度的视觉模块（四阶段
 *   A→D）只订阅 onProgress 回调，不直接碰事件。
 *
 *   clamp 到 [0,1] + 每帧最大增量 → 快速滚不跳变、反向滚正常、边界不越界。
 */

import { ACT2 } from '../config/motion';

export type ProgressListener = (progress: number) => void;
/** 章节模式输入方向：1 = 正向（滚下/上滑），-1 = 反向（滚上/下滑） */
export type ChapterDirHandler = (dir: 1 | -1) => void;

export interface ScrollController {
  /** 当前平滑进度 [0,1] */
  readonly progress: number;
  /** 目标进度（事件累计值，progress 向它追及；章节模式下与 progress 同步） */
  readonly target: number;
  /** 启用：注册事件监听、开启 rAF */
  activate: () => void;
  /** 停用：移除事件监听、停 rAF；可重新 activate */
  deactivate: () => void;
  /** 订阅进度变化回调（progress 每帧更新时触发，节流场景也会触发） */
  onProgress: (cb: ProgressListener) => () => void;
  /** 手动重置进度（如从 act2 退回船页） */
  reset: () => void;
  /** 手动设置目标进度（调试/程序化驱动） */
  setTarget: (p: number) => void;
  /** 进入章节模式（传 handler）：wheel/swipe 不再累加进度，改为按方向触发 handler，
   *  一次手势只触发一次（wheel 冷却窗 + swipe 位移阈值消费）；传 null 退回连续模式 */
  setChapterMode: (handler: ChapterDirHandler | null) => void;
  /** 章节模式专用：外部 tween 直接写入进度并立即通知订阅者（绕过 rAF 追及） */
  setProgressDirect: (p: number) => void;
}

export function createScrollController(): ScrollController {
  const cfg = ACT2.scroll;
  const CH = ACT2.chapters;
  let target = 0;
  let progress = 0;
  let active = false;
  let rafId = 0;
  let lastTouchY = 0;

  /* —— 章节模式状态 —— */
  let chapterHandler: ChapterDirHandler | null = null;
  /** 上次方向触发时刻（performance.now）：冷却窗内吞掉触控板惯性尾巴 */
  let lastDirFireAt = 0;
  /** 本轮 touch 手势是否已消费（一次滑动只触发一次） */
  let swipeConsumed = false;

  const listeners = new Set<ProgressListener>();

  const step = () => {
    if (!active) return;
    const diff = target - progress;
    const maxStep = Math.max(cfg.maxDeltaPerFrame, 0.0001); // 防止死循环
    const stepVal = diff * cfg.ease;
    // 同时 clamp 单帧最大变化量（不管 ease 多小都不超过）
    const delta = Math.max(-maxStep, Math.min(maxStep, stepVal));
    progress += delta;

    // 收敛判定：progress 几乎追到 target 了就贴住，避免长期残留小差值
    if (Math.abs(target - progress) < 0.0001) progress = target;

    // 通知所有订阅者
    for (const cb of listeners) cb(progress);

    rafId = requestAnimationFrame(step);
  };

  /** 章节模式：把一次方向输入派发给 handler（带冷却窗防触控板惯性连发） */
  const fireChapterDir = (dir: 1 | -1) => {
    const now = performance.now();
    if (now - lastDirFireAt < CH.wheelCooldownMs) return; // 惯性尾巴：冷却期内忽略
    lastDirFireAt = now;
    chapterHandler?.(dir);
  };

  const onWheel = (e: WheelEvent) => {
    if (!active) return;
    // 防止页面默认滚动（虽然 overflow:hidden，但 passsive:false 时还是拦截更干净）
    e.preventDefault();
    if (chapterHandler) {
      // 章节模式：一次 wheel = 一次方向触发（冷却窗内吞掉触控板惯性尾巴）
      if (Math.abs(e.deltaY) >= 1) fireChapterDir(e.deltaY > 0 ? 1 : -1);
      return;
    }
    // 连续模式：取垂直方向（deltaMode 0 = 像素，1 = 行，统一按像素处理）
    target = clamp01(target + e.deltaY * cfg.wheelFactor);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (!active) return;
    lastTouchY = e.touches[0]?.clientY ?? 0;
    swipeConsumed = false; // 新手势开始，复位消费标志
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!active) return;
    if (e.cancelable) e.preventDefault();
    const y = e.touches[0]?.clientY ?? lastTouchY;
    // 手指上滑（y 减小）→ 进度推进；手指下滑（y 增大）→ 回退
    const dy = lastTouchY - y;
    if (chapterHandler) {
      // 章节模式：单手势累计位移超过阈值 = 一次触发，之后直到抬手不再触发
      if (!swipeConsumed && Math.abs(dy) >= CH.touchSwipePx) {
        swipeConsumed = true;
        fireChapterDir(dy > 0 ? 1 : -1);
      }
      return;
    }
    target = clamp01(target + dy * cfg.touchFactor);
    lastTouchY = y;
  };

  // 事件监听引用（便于卸载）
  const wheelOptions: AddEventListenerOptions = { passive: false };

  function activate() {
    if (active) return;
    active = true;
    window.addEventListener('wheel', onWheel, wheelOptions);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    rafId = requestAnimationFrame(step);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    window.removeEventListener('wheel', onWheel, wheelOptions);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    cancelAnimationFrame(rafId);
  }

  function reset() {
    target = 0;
    progress = 0;
  }

  function setTarget(p: number) {
    target = clamp01(p);
  }

  /** 章节模式：进度由外部章节 tween 通过 setProgressDirect 写入，rAF 追及闲置（diff 恒 0） */
  function setChapterMode(handler: ChapterDirHandler | null) {
    chapterHandler = handler;
    if (handler) target = progress; // 对齐，避免残留 rAF 追及改写进度
  }

  /** 外部 tween 直接写进度：同步 target 防追及干扰，立即通知订阅者 */
  function setProgressDirect(p: number) {
    progress = clamp01(p);
    target = progress;
    for (const cb of listeners) cb(progress);
  }

  function onProgress(cb: ProgressListener) {
    listeners.add(cb);
    // 立即同步一次当前进度，让订阅者能初始化自己的状态
    cb(progress);
    return () => listeners.delete(cb);
  }

  return {
    get progress() { return progress; },
    get target() { return target; },
    activate,
    deactivate,
    onProgress,
    reset,
    setTarget,
    setChapterMode,
    setProgressDirect,
  };
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
