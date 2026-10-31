/**
 * 浪花双段播放器（canvas 逐帧绘制）
 *
 * 需求：浪花1 播一遍 → 末尾立刻接浪花2 → 浪花2 循环（loop2=true）
 * 或播完定格在末帧（loop2=false）。
 *
 * 为什么不用 GIF 直接播：
 *   <img> 播 GIF 的进度由浏览器时钟推进，倍速、两段衔接、循环都不可控；
 *   而 WebCodecs ImageDecoder 只有 Chrome/Edge 支持，Safari/Firefox 拿不到帧。
 * 所以素材在接入时已由美工 GIF 拆成帧序列（public/assets/wave/*.webp，保留透明通道，
 * 13 帧共 636KB），播放器只做一件事：按自己的时间轴定时 drawImage 到 canvas。
 * 浏览器只要支持 canvas + img 就完全一致 —— Chrome / Safari / Firefox 同一条路径，
 * 不依赖任何编解码 API，也没有"某个浏览器读不到参数"的分支。
 *
 * 节奏由 ACT2.reveal.props.wave 控制：
 *   每帧停留 = 素材原帧时长(frameMs) ÷ speed；两段首尾自动衔接。
 * 帧图在 prepare 阶段取回（13 帧约 108MB 解码后体积，浏览器按需解码、不一次性全解）。
 */

import gsap from 'gsap';
import { ACT2 } from '../config/motion';

export interface WavePlayer {
  /** 预载帧序列（boot 阶段调用，幂等） */
  prepare: () => void;
  /** 起播：从第一段首帧开始，并淡入到配置不透明度 */
  play: () => void;
  /** 停止并清场：隐藏、时钟归零（下次 play 从头重播） */
  reset: () => void;
}

interface Clip {
  imgs: HTMLImageElement[];
  /** 每帧停留时长（毫秒，已按倍速换算） */
  durs: number[];
  /** 一段总时长（毫秒） */
  total: number;
  loop: boolean;
}

export function createWavePlayer(layer: HTMLElement, canvas: HTMLCanvasElement): WavePlayer {
  const W = ACT2.reveal.props.wave;
  const ctx = canvas.getContext('2d');

  let clips: Clip[] | null = null;
  let preparing = false;
  let prepared = false;
  let wantPlay = false;
  let playing = false;

  let raf = 0;
  let lastTs = 0;
  let seg = 0;
  let clock = 0;
  /** 已绘制的帧标识 `${段}:${帧}`，避免同一帧重复绘制 */
  let shownKey = '';

  function loadFrames(urls: string[]): Promise<HTMLImageElement[]> {
    return Promise.all(
      urls.map(
        (url) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`浪花帧加载失败：${url}`));
            img.src = url;
          }),
      ),
    );
  }

  function makeClip(imgs: HTMLImageElement[], frameMs: number, speed: number, loop: boolean): Clip {
    const dur = Math.max(16, frameMs / speed);
    const durs = imgs.map(() => dur);
    return { imgs, durs, total: dur * imgs.length, loop };
  }

  function bestIndex(clip: Clip, t: number): number {
    let acc = 0;
    for (let i = 0; i < clip.durs.length; i++) {
      acc += clip.durs[i];
      if (t < acc) return i;
    }
    return clip.imgs.length - 1;
  }

  function drawFrame(clip: Clip, index: number): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(clip.imgs[index], 0, 0, canvas.width, canvas.height);
  }

  function tick(ts: number): void {
    if (!playing) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
    /* 阅读态把整层淡到 0 / 场景停用时冻结时钟，回来接着播，不空转也不偷跑 */
    if (layer.style.opacity === '0') {
      lastTs = 0;
      return;
    }
    const dt = lastTs ? Math.min(120, ts - lastTs) : 0;
    lastTs = ts;
    if (!clips) return;

    clock += dt;
    let clip = clips[seg];
    while (clock >= clip.total) {
      if (clip.loop) {
        clock %= clip.total;
        break;
      }
      if (seg + 1 >= clips.length) {
        /* 末段不循环：停在最后一帧（定格），停掉 rAF 免得空转；
         * 本节仍会往下走完，把末帧画出来 */
        clock = clip.total - 1;
        playing = false;
        break;
      }
      clock -= clip.total;
      seg += 1;
      clip = clips[seg];
    }

    const idx = bestIndex(clip, Math.min(clock, clip.total - 1));
    const key = `${seg}:${idx}`;
    if (key !== shownKey) {
      shownKey = key;
      drawFrame(clip, idx);
    }
  }

  function start(): void {
    if (!wantPlay || playing || !clips) return;
    /* 淡入到配置不透明度（与书法字同一套「起播同步淡入」语言） */
    gsap.killTweensOf(canvas);
    gsap.fromTo(
      canvas,
      { opacity: 0, visibility: 'visible' },
      { opacity: W.opacity, duration: W.fadeInSec, ease: 'power1.out', overwrite: 'auto' },
    );
    seg = 0;
    clock = 0;
    shownKey = '';
    lastTs = 0;
    playing = true;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function prepare(): void {
    if (preparing || prepared) return;
    preparing = true;
    void (async () => {
      try {
        const [a, b] = await Promise.all([
          loadFrames(W.frames1),
          loadFrames(W.frames2),
        ]);
        clips = [makeClip(a, W.frameMs1, W.src1Speed, false), makeClip(b, W.frameMs2, W.src2Speed, W.loop2)];
        // 两段首帧先解出来：起播不空白，切到第二段也不会卡一帧
        await Promise.all([a[0].decode(), b[0].decode()].map((p) => p.catch(() => undefined)));
        drawFrame(clips[0], 0);
        shownKey = '0:0';
      } catch (e) {
        console.warn('[act2] 浪花帧序列加载失败：', e);
      }
      prepared = true;
      start();
    })();
  }

  function play(): void {
    wantPlay = true;
    prepare();
    start();
  }

  function reset(): void {
    wantPlay = false;
    playing = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    lastTs = 0;
    seg = 0;
    clock = 0;
    shownKey = '';
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    gsap.killTweensOf(canvas);
    gsap.set(canvas, { opacity: 0, visibility: 'hidden' });
  }

  return { prepare, play, reset };
}
