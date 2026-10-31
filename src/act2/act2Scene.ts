/**
 * 第二幕场景编排：「沉入暮色 → 黑暗中升起」转场 + moto-card 式轻摆
 *
 * 职责：
 *   1. 初始化 scrollController（虚拟进度）、placeholderShip（Three.js 3D 模型）
 *   2. 启动 rAF 循环，每帧根据当前 progress：
 *      - 海页环境简化淡出（0→0.12）：标题/云/雨/浪/背景直接淡出
 *      - 2D 大船缩小＋下沉至屏幕底缘＋轻微倾斜（0.02→0.20，easeIn），
 *        变暗成剪影（0.10→0.22，brightness 0.25）——沉入暮色而非消失，
 *        淡出归零（0.30→0.45，3D 船已升过它）
 *      - placeholderShip.setReveal(prog)：3D 船从视口底缘之下升起（0.16→0.38，
 *        变大＋揭幕旋转 55°→12°），随后 360° 节奏旋转（起势-扫掠-缓滞-收势）→ 定格交权
 *   3. 管理第二幕 section 的显隐（pointer-events + 透明度）
 *   4. 生命周期：activate() 启用（在船页展示完成后调用），deactivate() 停 rAF 和事件
 *
 * 设计注意：
 *   - 所有视觉变化只通过 GSAP.set 和 placeholderShip.setReveal 驱动，
 *     进度是纯函数映射：正向推进、反向按相同区间恢复，不创建 GSAP 时间轴
 *   - 2D 船只做轻微倾斜不做整圈旋转（平面内转圈有 PPT 退出动画感）
 *   - 3D canvas 在图层最顶端：3D 船升起时从变暗的 2D 剪影上方经过 = 天然交接
 *   - placeholderShip 的渲染走同一 rAF，避免两套循环
 *   - resize 监听只在激活时注册一次；resize 事件分发给子模块
 */

import gsap from 'gsap';
import { ACT2 } from '../config/motion';
import {
  createScrollController,
  type ChapterDirHandler,
  type ScrollController,
} from './scrollController';
import { createPlaceholderShip, type PlaceholderShip } from './placeholderShip';
import { createScrollProfile, type ScrollProfile } from './scrollProfile';
import { createAct2Props, delaySecToThreshold } from './act2Props';
import { createIntroDialogue, type IntroDialogue } from './introDialogue';

export interface Act2Scene {
  /** 预载：创建 Three.js 渲染器 + GLB 下载/解析/法线重建 + 着色器预热（boot 预载阶段调用，
   *  徽章落地前完成全部重活；幂等，重复调用返回同一 Promise）。onProgress 回调 GLB 下载进度 [0,1]。 */
  preload: (onProgress?: (p: number) => void) => Promise<void>;
  /** 激活：初始化子模块、启用虚拟滚动、启动 rAF（重活已在 preload 完成，此处只做轻量接管） */
  activate: () => Promise<void>;
  /** 停用：停 rAF、停虚拟滚动、释放 Three.js 资源、重置船的 transform */
  deactivate: () => void;
  /** 当前是否激活 */
  readonly active: boolean;
  /** 当前进度（供外部查询，调试用） */
  readonly progress: number;
  /** 【调试】章节状态快照（?act2 自动化验收用）：停留章 / 播放中 / 本章起止进度 */
  readonly chapterDebug: { stage: number; playing: boolean; from: number; to: number; progress: number };
  /** 【调试】直接跳到指定进度并同步渲染一帧(不依赖 rAF,仅供 ?act2 截图验证) */
  debugSetProgress: (p: number) => void;
  /** 注册「对话全部结束」回调:第七组对话后用户再点船时触发 */
  onDialogueComplete: (cb: () => void) => void;
}

/** 连播后继段描述（playChapter 的 chainNext 参数）：本段播完后自动接播的下一段配置 */
type ChapterChainSeg = { from: number; to: number; dur: number; ease: string };

export function createAct2Scene(): Act2Scene {
  const ENV = ACT2.envFade;
  const EXIT = ACT2.exit;

  let scrollCtrl: ScrollController | null = null;
  let ship: PlaceholderShip | null = null;
  let rafId = 0;
  let active = false;
  let currentProgress = 0;
  /** 调试跳帧模式：忽略虚拟滚动回写，由 debugSetProgress 独占进度 */
  let debugOverride = false;
  /** 对话全部完成回调(由外部 main.ts 注册,触发后切场到时间线) */
  let dialogueCompleteCb: (() => void) | null = null;

  // DOM 引用
  const boatWrap = () => document.getElementById('boat-wrap');
  const sceneAct2 = () => document.getElementById('scene-act2');
  /** 书法字层容器（前后两层：通在画布下、惠在画布上——gsap 的 set/to 直接接受元素数组） */
  const titleEl = () => Array.from(document.querySelectorAll<HTMLElement>('.act2-fonts-layer'));
  const ctaEl = () => document.querySelector<HTMLElement>('.act2-cta');
  const fontTongEl = () => document.querySelector<HTMLImageElement>('.act2-font-tong');
  const fontHuiEl = () => document.querySelector<HTMLImageElement>('.act2-font-hui');
  const introLayerEl = () => document.querySelector<HTMLElement>('.act2-intro-layer');
  const dialogueCtaEl = () => document.querySelector<HTMLButtonElement>('.act2-dialogue-cta');
  const scrollFrameEl = () => document.querySelector<HTMLElement>('.scroll-frame');

  /* —— 书法字 GIF src 闩锁（两字独立，先通后惠）：GIF 从挂载 src 时刻起播，摘除即复位（重进重播）；
   * 播完 swap 到预加载静帧（hui 带循环标志，不换会每 4.1s 重写闪烁） —— */
  let tongAttached = false;
  let huiAttached = false;
  let tongSwapTimer = 0;
  let huiSwapTimer = 0;
  function attachTong(): void {
    if (tongAttached) return;
    tongAttached = true;
    const F = ACT2.reveal.fonts;
    const el = fontTongEl();
    if (el) {
      el.src = F.tongSrc;
      tongSwapTimer = window.setTimeout(() => { if (tongAttached) el.src = F.tongStill; }, F.tongSwapAtSec * 1000);
    }
  }
  function attachHui(): void {
    if (huiAttached) return;
    huiAttached = true;
    const F = ACT2.reveal.fonts;
    const el = fontHuiEl();
    if (el) {
      el.src = F.huiSrc;
      huiSwapTimer = window.setTimeout(() => { if (huiAttached) el.src = F.huiStill; }, F.huiSwapAtSec * 1000);
    }
  }
  function detachTong(): void {
    if (!tongAttached) return;
    tongAttached = false;
    window.clearTimeout(tongSwapTimer);
    fontTongEl()?.removeAttribute('src');
  }
  function detachHui(): void {
    if (!huiAttached) return;
    huiAttached = false;
    window.clearTimeout(huiSwapTimer);
    fontHuiEl()?.removeAttribute('src');
  }
  /** 两字同时挂/摘：定格淡回时重播、阅读态淡出后清场、场景复位用 */
  function attachFonts(): void { attachTong(); attachHui(); }
  function detachFonts(): void { detachTong(); detachHui(); }

  /* —— 书法字延时入场调度（先通后惠）：delaySec 语义为「相对定格的秒数」——
   * ≥0：定格（prog 1.0）后排计时器，到点淡入 + 挂载起播；
   * <0：定格前 N 秒出现，换算成旋转段进度阈值（连播时长固定 2.2+2.2s），到进度立即入场。
   * 退到各自阈值下：撤销未触发的计时、摘除已挂载、层归零；重回重新计时重播。
   * 注：负值换算基于 chapters 的 easeRise(power1.in)/easeSpin(power1.out)，改缓动则秒数失准；
   * 分两段滚动（非连播）时负值退化为纯进度阈值，墙上秒数不再精确 —— */
  let tongEnterTimer = 0;
  let huiEnterTimer = 0;
  /** 相对定格秒数 → { 进度阈值, 到阈值后再延时秒数 }
   *  （实现移至 act2Props.ts，与展陈道具序列共用同一份换算） */
  function enterFont(which: 'tong' | 'hui', layers: HTMLElement[]): void {
    if (which === 'tong' ? tongAttached : huiAttached) return;
    if (which === 'tong') attachTong(); else attachHui();
    const layer = which === 'tong' ? layers[0] : layers[1];
    if (layer) {
      gsap.fromTo(layer,
        { opacity: 0, visibility: 'visible' },
        { opacity: 1, duration: ACT2.reveal.fonts.fadeInSec, ease: 'power1.out', overwrite: 'auto' });
    }
  }
  /** 单字驱动（tick 每帧调用）：到阈值排期/立即入场，退到阈值下撤销 + 摘除 + 归零 */
  function driveFont(which: 'tong' | 'hui', prog: number, layers: HTMLElement[]): void {
    const F = ACT2.reveal.fonts;
    const { threshold, delay } = delaySecToThreshold(which === 'tong' ? F.tongDelaySec : F.huiDelaySec);
    const layer = which === 'tong' ? layers[0] : layers[1];
    if (prog >= threshold) {
      if (which === 'tong' ? (tongAttached || tongEnterTimer) : (huiAttached || huiEnterTimer)) return;
      if (delay > 0) {
        const t = window.setTimeout(() => {
          if (which === 'tong') tongEnterTimer = 0; else huiEnterTimer = 0;
          enterFont(which, layers);
        }, delay * 1000);
        if (which === 'tong') tongEnterTimer = t; else huiEnterTimer = t;
      } else {
        enterFont(which, layers);
      }
    } else {
      if (which === 'tong') {
        if (tongEnterTimer) { window.clearTimeout(tongEnterTimer); tongEnterTimer = 0; }
        detachTong();
      } else {
        if (huiEnterTimer) { window.clearTimeout(huiEnterTimer); huiEnterTimer = 0; }
        detachHui();
      }
      if (layer) gsap.set(layer, { opacity: 0, visibility: 'hidden', overwrite: 'auto' });
    }
  }
  function cancelFontEnter(): void {
    if (tongEnterTimer) { window.clearTimeout(tongEnterTimer); tongEnterTimer = 0; }
    if (huiEnterTimer) { window.clearTimeout(huiEnterTimer); huiEnterTimer = 0; }
  }

  /* —— 「了解通惠」按钮定格后延时入场：与书法字同一套计时基准（定格起计时，到点淡入） —— */
  let btnEnterTimer = 0;
  /** 按钮是否已完成入场（定格可见态）；退出阅读态淡回时直接置 true，避免重新延时排队 */
  let btnShown = false;
  /** 幂等：已入场或已排期则跳过（tick 每帧调用）。负延时由 tick 按阈值调用，此处 delay 为 0 立即入场 */
  function scheduleBtnEnter(): void {
    if (btnShown || btnEnterTimer) return;
    const T = ACT2.reveal.title;
    const { delay } = delaySecToThreshold(T.btnDelaySec);
    const enter = () => {
      btnEnterTimer = 0;
      btnShown = true;
      const cta = ctaEl();
      if (cta) {
        gsap.fromTo(cta,
          { opacity: 0, visibility: 'visible', filter: `blur(${T.fromBlurPx}px)`, y: T.fromOffsetY },
          {
            opacity: 1, filter: 'blur(0px)', y: 0,
            duration: T.btnFadeInSec, ease: 'power1.out', overwrite: 'auto',
            onComplete: () => {
              /* 淡入完全结束才开启点击；若期间已进入阅读态（btnShown 被复位）则不恢复 */
              if (btnShown) gsap.set(cta, { pointerEvents: 'auto', filter: 'none' });
            },
          });
      }
    };
    if (delay > 0) btnEnterTimer = window.setTimeout(enter, delay * 1000);
    else enter();
  }
  function cancelBtnEnter(): void {
    if (btnEnterTimer) { window.clearTimeout(btnEnterTimer); btnEnterTimer = 0; }
  }

  /* —— 章节化滚动状态机（opxy 式"滚一下 = 自动播完一章"）——
   * 正向：stage 0（进度 0，2D 船页）滚一下 → 转场+旋转连播直达 stage 2（1.0，定格+标题，
   * autoChainChapter2 可关闭退回两段式）→ 再滚 stage 3（介绍镜头/阅读态）；播放中正向忽略。
   * 反向：随时打断回本章起点；定格态反向连播直达船页（1.0→0.5→0，autoChainBackward
   * 可关闭退回两步式）。 */
  /** 当前停留章节（终态语义，非播放中）：0 船页 / 1 转场中点 / 2 定格 / 3 卷轴阅读 / 4 气泡对话 */
  let chapterStage: 0 | 1 | 2 | 3 | 4 = 0;
  /** 当前章节 tween（gsap 驱动 scrollCtrl.setProgressDirect；null = 空闲） */
  let chapterTween: ReturnType<typeof gsap.to> | null = null;
  /** 当前章节 tween 的起点进度（反向打断时回退目标） */
  let chapterFrom = 0;
  /** 当前章节 tween 的终点进度（打断时计算剩余比例） */
  let chapterTo = 0;
  /** 连播后继段（正向：转场→旋转；反向：定格回退→转场回退）；打断/停用/跳帧即撤销 */
  let chainNextSeg: ChapterChainSeg | null = null;

  /* —— 阅读态编排状态 —— */
  /** 上一帧阅读态是否占用：用于检测"阅读态结束"沿，恢复标题/按钮 */
  let introEngaged = false;
  /** 已请求取消（latch）：防止 tick 每帧重复 cancel/hide 导致文字淡出 tween 反复重建而卡住 */
  let introCancelRequested = false;
  /** 标题淡回保护期（performance.now 毫秒时间戳）：期间跳过逐帧映射，避免 0→1 瞬跳 */
  let titleFadeLock = 0;
  /** 卷轴式人物档案（章 3 阶段） */
  let scrollProfile: ScrollProfile | null = null;
  /** 卷轴正文是否已滑到最底端（「开启对话」入口的显隐条件） */
  let scrollAtEnd = false;
  /** 「开启对话」入口当前是否已浮现（幂等：避免每帧重复建 tween） */
  let dialogueCtaShown = false;
  /** 气泡对话（章 4 阶段：从卷轴页进入） */
  let dialogue: IntroDialogue | null = null;
  /** 气泡页入场延时计时器（卷轴淡出 + entryDelay 后才出第一组气泡） */
  let dialogueEntryTimer = 0;
  /** 展陈道具 + 浪花序列（展柜/罐/浪花）：由 ACT2.props 配置驱动，DOM 静态存在即创建 */
  const act2Props = createAct2Props();

  /** 卷轴浮现：beginIntro 瞬时进入阅读态后调用，文字自动缓慢滚动 + 手动 wheel/touch 支持 */
  function showIntroText() {
    // 船体右移让出左侧空间给卷轴（placeholderShip.beginIntro 里已调用 shiftForScroll）
    ship?.shiftForScroll(true);
    setDialogueCtaVisible(false); // 每次进阅读页都从「未到底端」开始
    scrollProfile?.activate();
  }

  /** 卷轴画框显隐：进气泡页时淡出画框（层本身保留可见，气泡用同一宿主） */
  function showScrollFrame(show: boolean): void {
    const frame = scrollFrameEl();
    if (!frame) return;
    if (show) {
      gsap.killTweensOf(frame);
      gsap.set(frame, { opacity: 1, visibility: 'visible' });
    } else {
      gsap.to(frame, {
        opacity: 0,
        duration: ACT2.dialogue.entryFade,
        ease: 'power1.out',
        overwrite: 'auto',
        onComplete: () => { if (chapterStage === 4) gsap.set(frame, { visibility: 'hidden' }); },
      });
    }
  }

  /** 「开启对话」入口显隐（屏幕右下角纯文字）：滚动到底才浮现，离开底端/进气泡页即退场 */
  function setDialogueCtaVisible(show: boolean): void {
    const el = dialogueCtaEl();
    if (!el) return;
    if (show === dialogueCtaShown) return;
    dialogueCtaShown = show;
    const D = ACT2.dialogue;
    if (show) {
      gsap.fromTo(el,
        { opacity: 0, visibility: 'visible', y: 8 },
        {
          opacity: 1, y: 0, duration: D.ctaIn, ease: 'power1.out', overwrite: 'auto',
          onComplete: () => { if (dialogueCtaShown) gsap.set(el, { pointerEvents: 'auto' }); },
        });
    } else {
      gsap.to(el, {
        opacity: 0, y: 8, duration: D.ctaOut, ease: 'power1.in', overwrite: 'auto',
        onComplete: () => {
          if (dialogueCtaShown) return;
          gsap.set(el, { pointerEvents: 'none', visibility: 'hidden', y: 0 });
        },
      });
    }
  }

  /** 气泡页清场：气泡/提示/涟漪 + 船体对话接线 + 卷轴画框可见性全部复位（不改章节状态） */
  function clearDialoguePage(): void {
    if (dialogueEntryTimer) { window.clearTimeout(dialogueEntryTimer); dialogueEntryTimer = 0; }
    dialogue?.reset();
    dialogue = null;
    ship?.setDialogueHandlers(null);
    showScrollFrame(true);
  }

  /** 章 4：卷轴正文滑到最底端 → 点击「开启对话」进入气泡页（船回正中，卷轴画框淡出） */
  function enterDialogueChapter(): void {
    if (!ship || !scrollProfile || chapterTween) return;
    if (chapterStage !== 3) return; // 仅卷轴阅读态可进入
    const layer = introLayerEl();
    if (!layer) return;

    const D = ACT2.dialogue;
    setDialogueCtaVisible(false);
    scrollProfile.pause(); // 停滚动/摘监听，但层保持可见（气泡宿主在同一层）
    showScrollFrame(false);
    ship.shiftForScroll(false); // 通惠回画面中央
    ship.setAutoSpin(false); // 对话页不转：减速停住并回基准姿势，只保留呼吸起伏
    chapterStage = 4;

    dialogue = createIntroDialogue({
      layer,
      getBoatRect: () => ship?.getBoatScreenRect() ?? null,
      onClosingPulse: () => ship?.closingPulse(),
      onAllDone: () => dialogueCompleteCb?.(),
    });
    ship.setDialogueHandlers({
      onTap: () => dialogue?.advance(),
      onHoverChange: (hovered) => dialogue?.onHoverChange(hovered),
    });
    // 卷轴淡出走完再看 entryDelay 秒出第一组气泡（避免两页元素同框）
    dialogueEntryTimer = window.setTimeout(() => {
      dialogueEntryTimer = 0;
      if (chapterStage === 4) dialogue?.start();
    }, (D.entryFade + D.entryDelay) * 1000);
  }

  /** 章 4 → 章 3：反向滚动退回卷轴阅读页（气泡清场、船回右让位、卷轴重新展开） */
  function exitDialogueChapter(): void {
    if (chapterStage !== 4) return;
    clearDialoguePage();
    setDialogueCtaVisible(false);
    chapterStage = 3;
    ship?.shiftForScroll(true);
    ship?.setAutoSpin(true); // 回到卷轴页恢复慢转展示
    scrollProfile?.activate();
  }

  /** 亮相页 ↔ 阅读页背景切换（反向联动）。
   *  进阅读态 show=false：展陈道具/浪花淡出、3D-page-bg 淡入（卷轴页背景）；
   *  退回定格 show=true：道具/浪花淡回、阅读页背景淡出。 */
  function fadeReadBackdrop(show: boolean): void {
    const dur = ACT2.reveal.readBackdrop.fadeSec;
    const layers = Array.from(
      document.querySelectorAll<HTMLElement>('.act2-props-layer, .act2-wave-layer'),
    );
    if (layers.length) {
      gsap.to(layers, {
        opacity: show ? 1 : 0,
        duration: dur,
        ease: 'power1.out',
        overwrite: 'auto',
      });
    }
    const readBg = document.querySelector<HTMLElement>('.act2-read-bg');
    if (readBg) {
      gsap.to(readBg, {
        opacity: show ? 0 : 1,
        duration: dur,
        ease: 'power1.out',
        overwrite: 'auto',
      });
    }
  }

  /** 卷轴退场：回滚退出阅读态时立即清场（气泡页若仍占用则一并清场） */
  function hideIntroText() {
    if (chapterStage === 4) clearDialoguePage();
    setDialogueCtaVisible(false);
    scrollProfile?.stop();
    ship?.shiftForScroll(false);
  }

  /* ---------- 章节管理器：滚一下 = 自动播完一章 ---------- */

  function killChapterTween() {
    if (chapterTween) { chapterTween.kill(); chapterTween = null; }
    chainNextSeg = null; // 打断/停用/跳帧：撤销未执行的后继连播段
  }

  /** 播放一个进度章节：gsap tween 直接驱动 scrollCtrl 进度（绕过 rAF 追及）。
   * dur 可选：打断回退时按剩余比例缩放，保证回退速度与正向一致。
   * chainNext：本段自然播完后自动接下一段（正向/反向连播；打断路径不会走到该分支）。 */
  function playChapter(
    from: number,
    to: number,
    dur: number,
    ease: string,
    chainNext: ChapterChainSeg | null = null,
  ) {
    killChapterTween();
    chainNextSeg = chainNext;
    debugOverride = false; // 章节接管进度：解除跳帧锁定，允许 tween 回写 currentProgress
    const C = ACT2.chapters;
    const proxy = { p: from };
    chapterFrom = from;
    chapterTo = to;
    chapterTween = gsap.to(proxy, {
      p: to,
      duration: dur,
      ease,
      onUpdate: () => scrollCtrl?.setProgressDirect(proxy.p),
      onComplete: () => {
        chapterTween = null;
        // 按终点刷新停留章（浮点用容差判断）
        chapterStage = to >= 0.999 ? 2 : (to >= C.boundary1 - 0.001 ? 1 : 0);
        // 连播：本段自然完成 → 同步无缝接后继段（无空窗，wheel 无法插入）
        const next = chainNextSeg;
        chainNextSeg = null;
        if (next) playChapter(next.from, next.to, next.dur, next.ease);
      },
    });
  }

  /** 章 3：定格态滚动/点击「了解通惠」进入角色介绍阅读态（标题与按钮淡出腾空间，立即浮现第一组气泡） */
  function startIntroChapter() {
    if (!ship) return;
    cancelFontEnter(); // 撤销未触发的入场计时，防止淡出期间字又挂上
    cancelBtnEnter(); // 按钮同理
    btnShown = false;
    fadeReadBackdrop(false); // 亮相页道具/浪花淡出，换成卷轴页背景（3D-page-bg）
    const title = titleEl();
    if (title.length) gsap.to(title, { opacity: 0, duration: 0.5, ease: 'power1.out', overwrite: 'auto', onComplete: detachFonts });
    const cta = ctaEl();
    if (cta) {
      // 镜头期间逐帧映射被 introNow 跳过，须显式关闭点击，避免隐形热区
      gsap.set(cta, { pointerEvents: 'none' });
      gsap.to(cta, { opacity: 0, duration: 0.5, ease: 'power1.out', overwrite: 'auto' });
    }
    const started = ship.beginIntro(() => showIntroText());
    if (started) {
      introCancelRequested = false; // 重置取消锁存（可能从回位途中重启）
      chapterStage = 3;
    }
  }

  /** 章节输入方向处理（scrollController 章节模式回调）
   * 正向：空闲时推进下一章（stage 0 起步含 autoChainChapter2 连播直达定格）；阅读终态无后续。
   * 反向：打断介绍镜头回定格；定格态反向连播直达船页；中间点反向播放上一章。
   * 播放中：只有「逆播放方向」的输入构成撤销——正向播放+反向滚=回本章起点；
   * 反向播放+正向滚=回到本次回退出发点；同向输入一律忽略等待播完
   * （触控板惯性尾巴落在回退章节上曾把进度弹回前一章终点，导致退不回船页）。 */
  const onChapterWheel: ChapterDirHandler = (dir) => {
    if (!ship) return;
    const C = ACT2.chapters;

    /* ---- 播放中：逆向输入撤销回起点，同向输入忽略（等本章自然播完） ---- */
    if (chapterTween) {
      const playingForward = chapterTo > chapterFrom;
      const undoRequested = playingForward ? dir === -1 : dir === 1;
      if (undoRequested) {
        // 撤销：从当前位置回本章起点，时长按剩余比例（速度感与正播一致）
        const span = Math.abs(chapterTo - chapterFrom);
        const remain = Math.abs(currentProgress - chapterFrom);
        // 段时长/缓动按所在区间选：[0,0.5)=转场段、[0.5,1]=旋转段（与该章正播一致）
        const inSpinSeg =
          Math.min(chapterFrom, chapterTo) >= C.boundary1 - 0.001;
        const fullDur = inSpinSeg ? C.durRotation : C.durTransition;
        const dur = span > 0.0001 ? fullDur * (remain / span) : 0.4;
        playChapter(
          currentProgress,
          chapterFrom,
          Math.max(0.3, dur),
          playingForward ? C.easeBackward : inSpinSeg ? C.easeSpin : C.easeRise,
        );
      }
      return;
    }

    /* ---- 气泡对话页：正向忽略（末章无后续），反向退回卷轴阅读页 ---- */
    if (chapterStage === 4) {
      if (dir === 1) return;
      exitDialogueChapter();
      return;
    }

    /* ---- 阅读态占用：正向忽略（阅读终态无后续），反向退出回定格 ---- */
    if (ship.introActive) {
      if (dir === 1) return;
      introCancelRequested = true;
      ship.cancelIntro();
      hideIntroText();
      chapterStage = 2;
      return;
    }

    /* ---- 空闲：按停留章推进 / 回退 ---- */
    if (dir === 1) {
      if (chapterStage === 0 && currentProgress <= 0.001) {
        // 正向连播：一次滚动 = 转场 + 旋转直达定格（autoChainChapter2 关闭则停在 0.5）
        playChapter(0, C.boundary1, C.durTransition, C.easeRise,
          C.autoChainChapter2
            ? { from: C.boundary1, to: 1, dur: C.durRotation, ease: C.easeSpin }
            : null);
      } else if (chapterStage === 1) {
        playChapter(C.boundary1, 1, C.durRotation, C.easeSpin);
      } else if (chapterStage === 2) {
        // 定格态：正向滚动不再推进到阅读态。必须点击「了解通惠」按钮（onCtaClick）才能进入，
        // 避免按钮尚未入场时滑动误触进入下一页。
        return;
      }
      // stage 3：阅读终态，无后续章节
    } else {
      if (chapterStage === 2) {
        // 反向连播：定格态一次回退连续播完两段直达船页（autoChainBackward 关闭则停在 0.5）
        playChapter(1, C.boundary1, C.durRotation, C.easeBackward,
          C.autoChainBackward
            ? { from: C.boundary1, to: 0, dur: C.durTransition, ease: C.easeBackward }
            : null);
      } else if (chapterStage === 1) {
        playChapter(C.boundary1, 0, C.durTransition, C.easeBackward); // 转场完成 → 回船页
      }
      // stage 0：已在开头，忽略
    }
  };

  /* ---------- 「了解通惠」按钮：点击进入介绍镜头（与章 3 滚动触发等效，防重入） ---------- */
  function onCtaClick() {
    if (!ship || chapterTween) return; // 章节/回退播放中忽略
    if (chapterStage !== 2 || ship.introActive) return; // 仅定格停留态可进入
    startIntroChapter();
  }

  /* ---------- 「开启对话」按钮：卷轴滑到底端后可点击，进入气泡对话页 ---------- */
  function onDialogueCtaClick() {
    if (!ship || chapterTween || dialogue) return;
    if (chapterStage !== 3 || !scrollAtEnd) return; // 仅在卷轴阅读态且已到底端可进入
    enterDialogueChapter();
  }

  // 原始船 transform（激活前保存，deactivate 时还原）
  let savedBoatOpacity: number | null = null;

  /** 在指定 start/end 区间内做线性归一化 [0,1]，超出范围 clamp */
  function subP(p: number, start: number, end: number): number {
    if (p <= start) return 0;
    if (p >= end) return 1;
    return (p - start) / (end - start);
  }

  function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }

  /** 每帧主循环 */
  function tick() {
    if (!active) return;

    const prog = currentProgress;
    const act2 = sceneAct2();
    const boat = boatWrap();

    /* ---------- 海页环境简化淡出（0→0.12）：全靠船的旋转交接完成转场 ---------- */
    const seaOpacity = 1 - easeOut(subP(prog, ENV.start, ENV.end));
    gsap.set('.sea-title, .title-cloud', { opacity: seaOpacity });
    gsap.set('.sea-clouds', { opacity: seaOpacity });
    gsap.set('.sea-rain', { opacity: seaOpacity });
    gsap.set('.wave-layer', { opacity: seaOpacity });
    gsap.set('.home-bg', { opacity: seaOpacity });

    /* ---------- 2D 大船退场：缩小＋沉底＋倾斜（0.02–0.20，easeIn 加速下沉） ----------
     * scale 1→0.55、y 0→28vh（船底贴住屏幕底缘）、rotation 0→5°；
     * 变暗（0.10–0.22）：brightness 1→0.25，沉入暮色成剪影而非透明消失；
     * 淡出（0.30–0.45）：3D 船升过之后彻底归零，不留残影。 */
    if (boat) {
      const tX = subP(prog, EXIT.start, EXIT.end);
      const easedIn = tX * tX;
      const boatScale = 1 + (EXIT.targetScale - 1) * easedIn;
      const boatY = easedIn * EXIT.sinkVh;
      const boatRot = EXIT.tilt * easedIn;
      const bright = 1 - (1 - EXIT.dimBrightness) * subP(prog, EXIT.dimStart, EXIT.dimEnd);
      const boatOpacity = 1 - subP(prog, EXIT.fadeStart, EXIT.fadeEnd);
      gsap.set(boat, {
        y: `${boatY}vh`,
        scale: boatScale,
        rotation: boatRot,
        filter: `brightness(${bright})`,
        opacity: boatOpacity,
      });
    }

    /* ---------- 3D 船体揭幕：最小处渐显 → 边转边放大 → 节奏旋转 → 定格 ---------- */
    if (ship) {
      ship.setReveal(prog);
      ship.update();
    }

    /* ---------- 阅读态状态机（与进度映射互斥，防止两套动画互相覆盖） ----------
     * 阅读态期间：跳过下方标题的逐帧映射（已由章节启动淡出）；
     * 反向退出（onChapterWheel）显式 cancelIntro + 清场气泡；此处仅作安全网：
     * 若进度因任何路径低于 unlockAt 而阅读态仍在，立即退出（latch 防每帧重建）；
     * 阅读态结束沿：若仍在展示段，标题平滑淡回。 */
    const introNow = ship ? ship.introActive : false;
    if (introNow && prog < ACT2.reveal.unlockAt && !introCancelRequested) {
      introCancelRequested = true;
      ship?.cancelIntro();
      hideIntroText();
      fadeReadBackdrop(true); // 退回到展示段之前：阅读页背景淡出、道具/浪花淡回
      if (chapterStage >= 3) chapterStage = 2; // 阅读态/气泡页被打断后回定格停留点
    }
    if (!introNow && introEngaged) {
      // 退回定格展示段：亮相页道具/浪花背景淡回（阅读页期间它们已淡出）
      if (prog >= ACT2.reveal.unlockAt) fadeReadBackdrop(true);
      const t = titleEl();
      if (prog >= ACT2.reveal.unlockAt && t.length) {
        // 退出阅读态后仍处定格展示段：标题/按钮平滑淡回（短暂锁住逐帧映射，避免 0→1 瞬跳；
        // 按钮点击态由锁过期后的逐帧映射接管恢复）
        titleFadeLock = performance.now() + 550;
        gsap.to(t, { opacity: 1, duration: 0.5, ease: 'power1.out', overwrite: 'auto' });
        attachFonts(); // 书法字随淡回重播书写动画
        const cta = ctaEl();
        if (cta) {
          btnShown = true; // 淡回视为已入场：防止保护期过后被 scheduleBtnEnter 重新延时排队
          gsap.to(cta, {
            opacity: 1, duration: 0.5, ease: 'power1.out', overwrite: 'auto',
            onComplete: () => { if (btnShown) gsap.set(cta, { pointerEvents: 'auto', filter: 'none', y: 0 }); },
          });
        }
      } else if (t.length) {
        gsap.set(t, { visibility: 'hidden' });
      }
    }
    if (!introNow) introCancelRequested = false;
    introEngaged = introNow;

    /* ---------- 书法字层（通/惠 GIF）+「了解通惠」按钮：按各自延时独立入场 ----------
     * delaySec 语义为「相对定格的秒数」：≥0 定格后排计时器到点淡入起播，<0 换算成旋转段
     * 进度阈值到点立即入场（GIF 从挂载时刻开始书写）；退到各自阈值下撤销计时、摘除归零，
     * 重回重新计时重播。阅读态（introNow）与淡回保护期内不干预，避免覆盖淡出/淡回动画 ---------- */
    if (!introNow && performance.now() >= titleFadeLock) {
      /* 展陈道具（展柜/罐）+ 浪花：与书法字同一套「相对定格秒数」机制，锚点取船开始上升 */
      act2Props?.drive(prog);
      /* DOM 序：通后层在前、惠前层在后（layers[0]=通, layers[1]=惠） */
      const layers = titleEl();
      driveFont('tong', prog, layers);
      driveFont('hui', prog, layers);
      /* 按钮同一套机制；淡入完全结束才开启点击（scheduleBtnEnter 的 onComplete 恢复） */
      if (prog >= delaySecToThreshold(ACT2.reveal.title.btnDelaySec).threshold) {
        scheduleBtnEnter();
      } else {
        cancelBtnEnter();
        btnShown = false;
        const cta = ctaEl();
        if (cta) {
          gsap.set(cta, { opacity: 0, visibility: 'hidden', pointerEvents: 'none', filter: 'none', y: 0, overwrite: 'auto' });
        }
      }
    }

    /* ---------- section 交互态 ---------- */
    if (act2) {
      document.body.classList.toggle('act2-active', active && prog > 0.02);
    }

    /* ---------- 滚动提示在环境淡出完成后隐藏 ----------
     * 只在 prog > ENV.end 时干预（隐藏）；prog <= ENV.end 时不碰，
     * 让 main.ts 开场时间轴的 opacity 0→1 淡入 tween 正常播放，
     * 避免本帧 set(1) 覆盖 tween 导致提示瞬间闪现、没有浮现动画。 */
    if (prog > ENV.end) {
      gsap.set('.scroll-hint', { opacity: 0 });
    }

    rafId = requestAnimationFrame(tick);
  }

  /* ---------- resize 分发 ---------- */
  let resizeBound = false;
  function onResize() {
    if (ship) ship.resize();
  }

  /* ---------- 预载：WebGL 初始化 + GLB 装载 + 法线重建 + 着色器预热 ----------
   * 全部重活在 boot 预载阶段完成（#scene-act2 是 visibility:hidden 而非 display:none，
   * 容器有真实尺寸，渲染器可正常创建）；徽章落地时 activate 只做轻量交互接管。
   * 幂等：重复调用返回同一 Promise。 */
  let preloadPromise: Promise<void> | null = null;

  function preload(onProgress?: (p: number) => void): Promise<void> {
    if (preloadPromise) return preloadPromise;
    // 浪花双段素材（GIF 取回 + 逐帧解码）自有异步链路，不占主进度条
    act2Props?.prepare();
    const threeHost = document.getElementById('act2-three');
    if (!threeHost) {
      console.warn('[act2] 缺少必要的 DOM 元素，无法预载');
      preloadPromise = Promise.resolve();
      return preloadPromise;
    }
    ship = createPlaceholderShip(threeHost);
    preloadPromise = ship.init((loaded, total) => {
      if (onProgress && total > 0) onProgress(loaded / total);
    });
    return preloadPromise;
  }

  async function activate() {
    if (active) return;
    active = true;

    /* ---------- 0) 确保预载完成：正常路径 boot 已兑现，此处瞬时返回；
     *     deactivate 后重进（ship 已销毁）或 ?act2 直跳且预载未竟时等待/重建 ---------- */
    if (!ship) preloadPromise = null;
    await preload();

    if (!ship) {
      console.warn('[act2] 缺少必要的 DOM 元素，无法激活');
      active = false;
      return;
    }
    ship.resize(); // 预载到激活之间窗口可能变化，激活时按当前尺寸校正

    /* ---------- 1) 保存船当前状态 ---------- */
    const boat = boatWrap();
    if (boat) {
      savedBoatOpacity = parseFloat(boat.style.opacity) || 1;
    }

    /* ---------- 2) 激活虚拟滚动（章节模式：滚一下 = 自动播完一章） ---------- */
    scrollCtrl = createScrollController();
    scrollCtrl.activate();
    scrollCtrl.onProgress((p) => { if (!debugOverride) currentProgress = p; });
    scrollCtrl.setChapterMode(onChapterWheel);

    /* ---------- 3) Three.js 模型已在预载阶段就绪（渲染器/GLB/法线/着色器），此处零重活 ---------- */

    /* ---------- 3.5) 卷轴式人物档案层 + 「开启对话」入口 ---------- */
    const introLayer = introLayerEl();
    if (introLayer) {
      scrollProfile = createScrollProfile(introLayer);
      // 正文滑到底端 → 右下角「开启对话」浮现；滑回上方 → 退场
      scrollProfile.onEndChange((atEnd) => {
        scrollAtEnd = atEnd;
        if (chapterStage === 3) setDialogueCtaVisible(atEnd);
      });
    }
    scrollAtEnd = false;
    dialogueCtaShown = false;
    showScrollFrame(true);
    const dCta = dialogueCtaEl();
    if (dCta) {
      gsap.set(dCta, { opacity: 0, visibility: 'hidden', pointerEvents: 'none', y: 0 });
      dCta.addEventListener('click', onDialogueCtaClick);
    }

    /* ---------- 3.6) 字体层 / 道具层 / 浪花层几何参数注入（同一屏高基准 16:9 几何盒，严格对位） ---------- */
    const F = ACT2.reveal.fonts;
    document.querySelectorAll<HTMLElement>('.act2-fonts-layer, .act2-props-layer, .act2-wave-layer').forEach((el) => {
      el.style.setProperty('--font-scale', String(F.scale));
      el.style.setProperty('--font-x', `${F.xPx}px`);
      el.style.setProperty('--font-y', `${F.yPx}px`);
    });

    /* ---------- 4) 第二幕 section 就绪（section 自身无背景，透明不遮下层） ---------- */
    const act2 = sceneAct2();
    if (act2) {
      act2.classList.remove('is-hidden');
      act2.setAttribute('aria-hidden', 'false');
      act2.style.opacity = '1';
    }

    /* ---------- 4.5) 章 3 角色介绍：滚动触发（onChapterWheel → startIntroChapter）或
     * 定格态点击「了解通惠」（onCtaClick → startIntroChapter），复用同一进入路径 ---------- */
    document.querySelector('.act2-cta')?.addEventListener('click', onCtaClick);

    /* ---------- 5) resize ---------- */
    if (!resizeBound) {
      window.addEventListener('resize', onResize);
      resizeBound = true;
    }

    /* ---------- 6) 启动 rAF 主循环 ---------- */
    rafId = requestAnimationFrame(tick);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    debugOverride = false;
    cancelAnimationFrame(rafId);

    /* ---------- 停虚拟滚动（含章节模式与进行中的章节 tween） ---------- */
    killChapterTween();
    scrollCtrl?.setChapterMode(null);
    scrollCtrl?.deactivate();
    scrollCtrl = null;

    /* ---------- 停 Three.js + 释放 ---------- */
    ship?.dispose();
    ship = null;

    /* ---------- 还原船的 transform + 海页环境 ---------- */
    const boat = boatWrap();
    if (boat) {
      gsap.set(boat, {
        y: 0,
        rotation: 0,
        scale: 1,
        filter: 'none',
        opacity: savedBoatOpacity ?? 1,
      });
    }
    // 还原船页内部被淡出的元素（用户可能从第二幕回退）
    gsap.set('.sea-title, .title-cloud, .sea-clouds, .sea-rain, .wave-layer, .home-bg', { opacity: '' });

    /* ---------- 标题复位（恢复隐藏态）+ 章节状态归零 ---------- */
    document.querySelector('.act2-cta')?.removeEventListener('click', onCtaClick);
    dialogueCtaEl()?.removeEventListener('click', onDialogueCtaClick);
    gsap.set('.act2-fonts-layer', { opacity: 0, visibility: 'hidden' });
    cancelFontEnter();
    cancelBtnEnter();
    btnShown = false;
    detachFonts();
    // 展陈道具 + 浪花复位（撤销计时、隐藏道具、摘除浪花 src）
    act2Props?.reset();
    // 亮相页背景层不透明度复位（阅读态可能被淡到 0）
    gsap.set('.act2-props-layer, .act2-wave-layer', { opacity: 1 });
    // 卷轴阅读页背景复位（阅读态淡入过，退出场景后必须归零）
    gsap.set('.act2-read-bg', { opacity: 0 });
    gsap.set('.act2-cta', { opacity: 0, visibility: 'hidden', y: 0, filter: 'none', pointerEvents: 'none' });
    // 气泡页清场（若仍停留在章 4，scrollProfile.pause 后 stop 会提前返回，需先复位）
    clearDialoguePage();
    setDialogueCtaVisible(false);
    dialogueCtaShown = false;
    scrollAtEnd = false;
    gsap.set('.act2-dialogue-cta', { opacity: 0, visibility: 'hidden', pointerEvents: 'none', y: 0 });
    // 卷轴层复位（镜头若在进行，scrollProfile.stop 已清场）
    scrollProfile?.stop();
    scrollProfile = null;
    // 层本身可能停在可见态（章 4 用 pause 保留），统一归零
    if (introLayerEl()) introLayerEl()!.style.opacity = '0';
    introEngaged = false;
    introCancelRequested = false;
    titleFadeLock = 0;
    chapterStage = 0;
    chapterFrom = 0;
    chapterTo = 0;

    /* ---------- 第二幕隐藏 ---------- */
    const act2 = sceneAct2();
    if (act2) {
      act2.classList.add('is-hidden');
      act2.setAttribute('aria-hidden', 'true');
      act2.style.opacity = '';
    }
    document.body.classList.remove('act2-active');

    /* ---------- 恢复滚动提示 ---------- */
    gsap.set('.scroll-hint', { opacity: 1 });

    /* ---------- 进度归零 ---------- */
    currentProgress = 0;
    savedBoatOpacity = null;
  }

  /** 调试：精确跳到某进度并同步渲染一帧（取消挂起的 rAF，避免双循环）。
   *  同步章节停留态与 scrollCtrl 进度，保证后续 wheel 章节推进语义正确。 */
  function debugSetProgress(p: number) {
    debugOverride = true; // 锁定：虚拟滚动不再回写进度
    killChapterTween();
    currentProgress = Math.max(0, Math.min(1, p));
    scrollCtrl?.setProgressDirect(currentProgress);
    chapterStage = currentProgress >= 0.999 ? 2 : (currentProgress >= ACT2.chapters.boundary1 - 0.001 ? 1 : 0);
    cancelAnimationFrame(rafId);
    tick();
  }

  return {
    preload,
    activate,
    deactivate,
    debugSetProgress,
    /** 注册「对话全部结束」回调:第七组对话后用户再点船时触发,外部切场到时间线 */
    onDialogueComplete: (cb: () => void) => { dialogueCompleteCb = cb; },
    get active() { return active; },
    get progress() { return currentProgress; },
    get chapterDebug() {
      return {
        stage: chapterStage,
        playing: chapterTween !== null,
        from: chapterFrom,
        to: chapterTo,
        progress: currentProgress,
      };
    },
  };
}
