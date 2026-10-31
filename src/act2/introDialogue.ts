/**
 * 章4 角色介绍对话：美工分镜对话框 + 逐字打字 + 点按推进 + 一次性提示
 *
 * 职责：
 *   - 七组分镜（dialogue1~7.webp，各组内容按序号一一对应）按固定顺序推进，点按船体切换下一组
 *   - 每组两段：第一段逐字打出 → 停顿 paraGapSec → 第二段自动接着逐字打出
 *   - 对话框缩放后贴船分列：左右左右左右左、上中下上中下上（各组图内尾巴恰好朝向船体），
 *     按纸面正文区反推整幅画布位置，正文按纸面区百分比排入，长段落自动降字号防裁切
 *   - 第一组对话框浮现后显示一次性提示「轻触船身，听我继续说。」，首次有效点按后永久消失
 *   - 点按时船底水波涟漪反馈（DOM 单次动画）
 *
 * 所有动效/版式参数集中在 motion.ts ACT2.dialogue。
 */

import gsap from 'gsap';
import { ACT2 } from '../config/motion';
import { ASSETS } from '../config/assets';

export interface BoatRect {
  left: number; top: number; right: number; bottom: number;
  width: number; height: number; cx: number; cy: number;
}

export interface IntroDialogueDeps {
  /** 对话框/提示/涟漪的宿主层（.act2-intro-layer，position:absolute inset:0） */
  layer: HTMLElement;
  /** 船体当前屏幕包围盒（提示与涟漪定位用） */
  getBoatRect: () => BoatRect | null;
  /** 第七组后再次点按的收束反馈（船体微光脉冲） */
  onClosingPulse?: () => void;
  /** 第七组后再次点按:对话全部结束,外部应切场到时间线(与 onClosingPulse 同时触发) */
  onAllDone?: () => void;
}

export interface IntroDialogue {
  /** 进入对话页：显示第一组对话框 + 排程一次性提示 */
  start: () => void;
  /** 立即清场（回滚/离场）：对话框移除、打字取消、提示取消、状态归零 */
  reset: () => void;
  /** 有效点按：推进下一组（正在打字也直接切）；第七组后触发收束反馈 */
  advance: () => void;
  /** 悬停状态变化（hover 进入时给一次涟漪） */
  onHoverChange: (hovered: boolean) => void;
  /** 当前是否处于对话态 */
  readonly active: boolean;
}

/** 分镜画布宽度统一 2048（组 7 画布略矮，单独标注高度） */
const ART_W = 2048;

/** 方位：L/R = 船体左/右；T/M/B = 船体上/中/下。顺序：左右左右左右左、上中下上中下上 */
type Side = 'L' | 'R';
type Vert = 'T' | 'M' | 'B';

interface GroupDef {
  /** 对话框素材（assets 下 WebP，由 ASSETS.dialogueArt 统一列出并预载） */
  art: string;
  /** 画布尺寸 */
  canvasH: number;
  /** 纸面正文区（占画布宽/高的百分比）：x0, y0, x1, y1 —— 由美工图逐张量取 */
  body: [number, number, number, number];
  /** 分列方位：各图尾巴方向与下列顺序一一对应（尾巴朝向船体） */
  side: Side;
  v: Vert;
  /** 文案：1~3 段，逐段自动接打（段间停顿 paraGapSec） */
  paras: string[];
}

const GROUPS: GroupDef[] = [
  { // 01
    art: ASSETS.dialogueArt[0],
    canvasH: 1536,
    body: [8.5, 26.5, 74.0, 73.3],
    side: 'L', v: 'T',
    paras: [
      '你好呀，我叫通惠！',
      '我诞生于通惠河开凿的那一年，现在已经 700 多岁啦！',
      '很高兴认识你！',
    ],
  },
  { // 02
    art: ASSETS.dialogueArt[1],
    canvasH: 1536,
    body: [17.2, 26.8, 82.7, 73.6],
    side: 'R', v: 'M',
    paras: [
      '我是大运河的文脉守护者，一名穿梭在历史与当下的旅行家。',
      '船是我的骨，帆是我的眼，奔流不息的河水就是我的血脉。',
    ],
  },
  { // 03
    art: ASSETS.dialogueArt[2],
    canvasH: 1536,
    body: [8.5, 34.5, 74.0, 81.3],
    side: 'L', v: 'B',
    paras: [
      '从元代起，我便守着这条河道。',
      '如今，我已在北京大运河博物馆数字空间里安家，',
      '依托博物馆收藏的文物、史料维系自身记忆。',
    ],
  },
  { // 04
    art: ASSETS.dialogueArt[3],
    canvasH: 1536,
    body: [17.2, 26.5, 82.7, 73.3],
    side: 'R', v: 'T',
    paras: [
      '你看，我是不是有点像一艘小小的元代漕船？船身上还留着河水浸润过的痕迹。',
      '引水、设闸、分水……这些古人的水利智慧，我可熟悉啦！',
      '从元、明、清的漕运兴衰，到近现代河道的变迁，我都见证过。',
    ],
  },
  { // 05
    art: ASSETS.dialogueArt[4],
    canvasH: 1536,
    body: [4.8, 26.8, 70.3, 73.6],
    side: 'L', v: 'M',
    paras: [
      '其实呀，我不是一艘普通的船，我是大运河记忆灵一族的一员。',
      '我的身体里，凝聚着一条河和一座城的记忆。',
    ],
  },
  { // 06
    art: ASSETS.dialogueArt[5],
    canvasH: 1536,
    body: [17.2, 34.5, 82.7, 81.3],
    side: 'R', v: 'B',
    paras: [
      '我最擅长的，就是把复杂的历史和水利知识，变成有趣又好懂的故事。',
      '想把故事讲好，我仍需在不断探寻中集齐关于运河的记忆碎片，让它们不断被人看见、理解、传承。',
      '那么，你愿意和我一起，走进大运河的记忆，集齐遗落其中的记忆碎片吗？',
    ],
  },
  { // 07
    art: ASSETS.dialogueArt[6],
    canvasH: 1399,
    body: [8.6, 29.6, 73.7, 70.8],
    side: 'L', v: 'T',
    paras: [
      '来吧，',
      '升帆，启航！',
      '我们的探索之旅马上开始！',
    ],
  },
];

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/** 字号按视口比例折算，再夹在可读区间：与对话框尺寸解耦，框变小字不跟着缩 */
function fitFontSize(D: typeof ACT2.dialogue): number {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return clamp(Math.min(vw * D.fontW, vh * D.fontH), D.fontMin, D.fontMax);
}

export function createIntroDialogue(deps: IntroDialogueDeps): IntroDialogue {
  const D = ACT2.dialogue;
  const host = deps.layer.querySelector<HTMLElement>('.act2-bubbles')!;
  const hintEl = deps.layer.querySelector<HTMLElement>('.act2-hint')!;
  const rippleEl = deps.layer.querySelector<HTMLElement>('.act2-ripple')!;

  let active = false;
  let switching = false;
  let groupIdx = 0;
  let currentEls: HTMLElement[] = [];
  let typingTl: gsap.core.Timeline | null = null;
  let hintTl: gsap.core.Timeline | null = null;

  /** 当前正在展示的对话框（resize 时按同一组重排） */
  let live: { idx: number; wrap: HTMLElement; img: HTMLImageElement; text: HTMLElement; blocks: HTMLElement[]; fs: number; activeIdx: number } | null = null;

  function defaultRect(): BoatRect {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(vw * 0.5, 640), h = vh * 0.4;
    return { left: (vw - w) / 2, top: (vh - h) / 2, right: (vw + w) / 2, bottom: (vh + h) / 2, width: w, height: h, cx: vw / 2, cy: vh / 2 };
  }

  /** 对话框缩小后贴船分列：纸面正文区宽 bodyW，按 L/R 落在船左/右侧、按 T/M/B 对齐船的上/中/下；
   *  图片按组内纸面正文区百分比反推整幅画布的位置，保证纸面精确落在目标框内，再夹进视口。 */
  function layout(img: HTMLImageElement, textEl: HTMLElement, g: GroupDef) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = deps.getBoatRect() ?? defaultRect();
    const [x0, y0, x1, y1] = g.body;
    const bodyWFrac = (x1 - x0) / 100;
    const bodyHFrac = (y1 - y0) / 100;
    const bodyAspect = (bodyHFrac * g.canvasH) / (bodyWFrac * ART_W); // 纸面高/宽

    // 纸面正文区尺寸：竖屏按屏宽比例，宽屏按屏宽比例并封顶
    const bw = vh > vw ? vw * D.bodyVwPortrait : Math.min(vw * D.bodyVw, D.bodyMaxPx);
    const bh = bw * bodyAspect;

    // 左右：左侧组额外右移 leftShiftPx（更贴近船），右侧组保持原间距
    let bl = g.side === 'L'
      ? rect.left - D.gapPx + D.leftShiftPx - bw
      : rect.right + D.gapPx;
    // 上中下：以船体包围盒为基准分段对齐
    let bt = g.v === 'T' ? rect.top + rect.height * D.anchorTopFrac
           : g.v === 'B' ? rect.bottom - rect.height * D.anchorBottomFrac - bh
           : rect.cy - bh / 2;

    bl = clamp(bl, D.padPx, Math.max(D.padPx, vw - D.padPx - bw));
    bt = clamp(bt, D.padPx, Math.max(D.padPx, vh - D.padPx - bh));

    // 由纸面框反推整幅画布（透明留白 + 尾巴）的位置与尺寸
    const scale = bw / (ART_W * bodyWFrac);
    const w = ART_W * scale;
    const h = g.canvasH * scale;
    img.style.cssText = `left:${bl - w * x0 / 100}px;top:${bt - h * y0 / 100}px;width:${w}px;height:${h}px;`;

    // 正文框：纸面框内缩（竖屏纸面更小，上下内缩更少）
    const portrait = vh > vw;
    const padX = bw * D.textPadX;
    const padY = bh * (portrait ? D.textPadYPortrait : D.textPadY);
    const tL = bl + padX;
    const tT = bt + padY;
    const tW = Math.max(80, bw - padX * 2);
    const tH = Math.max(60, bh - padY * 2);

    // 字号独立于对话框尺寸：按视口比例算，框缩小字不跟着缩
    const fs = fitFontSize(D);
    textEl.style.cssText = `left:${tL}px;top:${tT}px;width:${tW}px;height:${tH}px;font-size:${fs}px;`;
    return fs;
  }

  /** 统一字号：逐段单独显示时测量，按最长的一段收缩，保证换段不跳字号也不裁切 */
  function fitBlocks(textEl: HTMLElement, blocks: HTMLElement[], startFs: number): number {
    let fs = startFs;
    for (const b of blocks) {
      blocks.forEach((x) => { x.style.display = x === b ? '' : 'none'; });
      let guard = 0;
      while (textEl.scrollHeight > textEl.clientHeight + 1 && fs > D.fontMin && guard++ < 40) {
        fs = Math.max(D.fontMin, fs - 0.5);
        textEl.style.fontSize = `${fs}px`;
      }
    }
    return fs;
  }

  /** 全局统一字号：一次性测量所有组，取能容纳最长那句的最小字号。
   *  所有组共用同一字号，保证居中对齐时位置不随组跳变。resize 时清缓存重算。 */
  let cachedUnifiedFs: number | null = null;
  function computeUnifiedFs(): number {
    if (cachedUnifiedFs !== null) return cachedUnifiedFs;
    const off = document.createElement('div');
    off.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;';
    document.body.appendChild(off);
    let minFs = Infinity;
    for (const g of GROUPS) {
      const wrap = document.createElement('div');
      const img = document.createElement('img');
      const textEl = document.createElement('div');
      textEl.className = 'act2-dialogue-text';
      const blocks = g.paras.map(() => document.createElement('p'));
      textEl.append(...blocks);
      wrap.append(img, textEl);
      off.appendChild(wrap);
      g.paras.forEach((txt, i) => fillChars(blocks[i], txt));
      const baseFs = layout(img, textEl, g);
      const fs = fitBlocks(textEl, blocks, baseFs);
      minFs = Math.min(minFs, fs);
    }
    document.body.removeChild(off);
    cachedUnifiedFs = minFs;
    return minFs;
  }

  function relayout() {
    if (!live) return;
    cachedUnifiedFs = null; // 视口变了，统一字号重算
    layout(live.img, live.text, GROUPS[live.idx]);
    live.fs = computeUnifiedFs();
    live.blocks.forEach((b, i) => { b.style.display = i === live!.activeIdx ? '' : 'none'; });
    live.text.style.fontSize = `${live.fs}px`;
  }

  /** 把一段文字拆成逐字 span（初始 opacity 0，由时间轴顺序点亮） */
  function fillChars(p: HTMLElement, text: string): HTMLElement[] {
    p.textContent = '';
    const frag = document.createDocumentFragment();
    const spans: HTMLElement[] = [];
    for (const ch of text) {
      const s = document.createElement('span');
      s.className = 'act2-char';
      s.textContent = ch;
      spans.push(s);
      frag.appendChild(s);
    }
    p.appendChild(frag);
    return spans;
  }

  function killHint() {
    if (hintTl) { hintTl.kill(); hintTl = null; }
  }

  function ripple(x: number, y: number, scale = 1) {
    rippleEl.style.left = `${x}px`;
    rippleEl.style.top = `${y}px`;
    gsap.fromTo(rippleEl,
      { opacity: 0.55, scale: 0.35 * scale },
      { opacity: 0, scale: 1.5 * scale, duration: 1.1, ease: 'power2.out', overwrite: true });
  }

  function showGroup(idx: number, onTyped?: () => void) {
    const g = GROUPS[idx];

    const wrap = document.createElement('div');
    wrap.className = 'act2-dialogue-art';
    const img = document.createElement('img');
    img.className = 'act2-dialogue-img';
    img.alt = '';
    img.decoding = 'async';
    img.src = g.art;
    const textEl = document.createElement('div');
    textEl.className = 'act2-dialogue-text';
    const blocks = g.paras.map(() => document.createElement('p'));
    textEl.append(...blocks);
    wrap.append(img, textEl);
    host.appendChild(wrap);

    const charSets = g.paras.map((txt, i) => fillChars(blocks[i], txt));
    layout(img, textEl, g);
    const fs = computeUnifiedFs();
    blocks.forEach((b) => { b.style.display = 'none'; });
    textEl.style.fontSize = `${fs}px`;

    live = { idx, wrap, img, text: textEl, blocks, fs, activeIdx: 0 };
    currentEls = [wrap];

    // 对话框入场：整体淡入（纸张与正文一起）
    gsap.fromTo(wrap,
      { opacity: 0, filter: `blur(${D.bubbleBlur}px)`, y: D.bubbleRise },
      {
        opacity: 1, filter: 'blur(0px)', y: 0, duration: D.bubbleIn, ease: 'power2.out',
        onComplete: () => { switching = false; },
      });

    // 逐句播放：一段逐字打完 → 停 paraGapSec → 清空 → 下一段重新逐字打出；
    // 最后一段停在画面上，然后才回调 onTyped
    typingTl?.kill();
    typingTl = gsap.timeline({
      delay: D.typeStartDelay,
      onComplete: () => { onTyped?.(); },
    });
    let cursor = 0;
    blocks.forEach((block, i) => {
      typingTl!.call(() => {
        block.style.display = '';
        block.style.opacity = '1';
        if (live) live.activeIdx = i;
      }, [], cursor);
      typingTl!.fromTo(charSets[i], { opacity: 0 }, {
        opacity: 1, duration: D.charFade, ease: 'none', stagger: D.charSec,
      }, cursor);
      const typedEnd = cursor + charSets[i].length * D.charSec + D.charFade;
      if (i < blocks.length - 1) {
        const clearAt = typedEnd + D.paraGapSec;
        typingTl!.to(block, { opacity: 0, duration: D.paraClearSec, ease: 'power1.out' }, clearAt);
        typingTl!.call(() => { block.style.display = 'none'; }, [], clearAt + D.paraClearSec);
        cursor = clearAt + D.paraClearSec;
      } else {
        cursor = typedEnd;
      }
    });
  }

  /** 常驻提示：落在船体正下方（水平按屏幕中线对齐船体），淡入后一直显示到离开对话页 */
  function showHint() {
    killHint();
    const rect = deps.getBoatRect() ?? defaultRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const hintW = hintEl.offsetWidth || 220;
    const hintH = hintEl.offsetHeight || 40;
    // 船在对话页居中（camera 回正），以屏幕中线为准最贴近「正下方」的观感；
    // 元素自带 translateX(-50%)，左右边界按半宽内缩，避免贴边被裁。
    const halfW = hintW / 2;
    const leftMin = 12 + halfW;
    const leftMax = vw - 12 - halfW;
    const left = leftMin <= leftMax ? clamp(vw / 2, leftMin, leftMax) : vw / 2;
    const top = clamp(rect.bottom - rect.height * D.hintLiftFrac + 14, 24, vh - hintH - 24);
    hintEl.style.left = `${left}px`;
    hintEl.style.top = `${top}px`;
    hintTl = gsap.timeline();
    hintTl.to(hintEl, { opacity: 1, duration: D.hintFade, ease: 'power1.out' }, D.hintShowDelay);
  }

  function start() {
    reset();
    active = true;
    switching = true;
    window.addEventListener('resize', relayout);
    showGroup(0, () => showHint());
  }

  function reset() {
    window.removeEventListener('resize', relayout);
    cachedUnifiedFs = null;
    active = false;
    switching = false;
    groupIdx = 0;
    typingTl?.kill();
    typingTl = null;
    live = null;
    killHint();
    gsap.killTweensOf(hintEl);
    gsap.set(hintEl, { opacity: 0 });
    gsap.killTweensOf(rippleEl);
    gsap.set(rippleEl, { opacity: 0 });
    currentEls.forEach((el) => { gsap.killTweensOf(el); el.remove(); });
    currentEls = [];
    host.innerHTML = '';
  }

  function advance() {
    if (!active || switching) return;
    // 水波落在船底吃水线：水平对齐屏幕中线（对话页船体回正居中），垂直从包围盒下沿上提
    const rect = deps.getBoatRect() ?? defaultRect();
    ripple(window.innerWidth / 2, rect.bottom - rect.height * D.tapFxLiftFrac, 1.25);
    if (groupIdx >= GROUPS.length - 1) {
      deps.onClosingPulse?.();
      deps.onAllDone?.();
      return;
    }
    switching = true;
    typingTl?.kill();
    typingTl = null;
    const old = currentEls;
    currentEls = [];
    live = null;
    old.forEach((el) => {
      gsap.to(el, {
        opacity: 0, filter: `blur(${D.bubbleBlur}px)`, y: -D.bubbleRise * 0.6,
        duration: D.bubbleOut, ease: 'power1.in',
        onComplete: () => el.remove(),
      });
    });
    groupIdx += 1;
    const nextIdx = groupIdx;
    gsap.delayedCall(D.bubbleOut * 0.7, () => {
      if (!active) return;
      showGroup(nextIdx);
    });
  }

  function onHoverChange(hovered: boolean) {
    if (!active || !hovered) return;
    const rect = deps.getBoatRect() ?? defaultRect();
    ripple(window.innerWidth / 2, rect.bottom - rect.height * D.tapFxLiftFrac, 1);
  }

  return {
    start,
    reset,
    advance,
    onHoverChange,
    get active() { return active; },
  };
}
