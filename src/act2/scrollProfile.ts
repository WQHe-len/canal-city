/**
 * 卷轴式人物档案（第二幕章 3 当前阶段）
 *
 * 独立模块：HTML 文字滚动卷轴，与 Three.js 3D 船体并行（船体此时右移让出空间）。
 * 下一幕气泡交互代码完整保留在 introDialogue.ts——act2Scene.ts 不创建 dialogue，
 * 只创建本模块，两者互不干扰、不互相删除。
 *
 * 结构（index.html 占位，scrollProfile.activate 时写文字 DOM）：
 *   .act2-intro-layer
 *     .scroll-frame          — 16:9 美术画布（高度/对位由 SCROLL.art 注入的 CSS 变量控制）
 *       .scroll-art-paper    — 卷轴纸.png（1920×1080 整幅透明画布，铺满画布盒）
 *       .scroll-viewport     — 文字滚动窗口（按纸面内区百分比定位）
 *         .scroll-content    — 正文内容（HTML 按 CONTENT 常量构建）
 *       .scroll-art-rod-top / .scroll-art-rod-bottom — 上轴/下轴.png
 *
 * 自动滚动：requestAnimationFrame 驱动 viewport.scrollTop += pxPerFrame（初始 0.23 ≈ 14px/s 极慢）。
 * 手动交互（wheel / touch / 按住拖动正文）立即暂停自动滚动并记录 lastInteractionTime；
 * 闲置 SCROLL.resumeDelay 秒后以 SCROLL.resumeRampSec 渐增速度恢复；
 * 到底后平稳停止（SCROLL.loop=false）。
 *
 * 无进度条/滑块（已移除）：滑动浏览直接作用于正文区——
 * 桌面按住拖动（pointer）、移动端触摸滑动、滚轮均改同一浮点位置。
 *
 * 船体右移：beginIntro 时调用 ship.shiftForScroll(true) 让出左侧空间
 *（成像平移，船的投影形状不变；偏移量见 SCROLL.boatViewShiftPct）。
 *
 * 字体：正文优先"华文中宋"/STZhongsong，回退宋体 serif。Mac 上 STZhongsong 预装可用，
 * Windows 通常回退宋体；CSS 字体族声明在 main.css。
 *
 * 素材替换：三张 PNG 与文字层完全分离——替换美术只需覆盖同名文件，位置/比例由
 * SCROLL.art 的百分比统一控制；文字层与滚动逻辑无需改动。
 */

import gsap from 'gsap';
import { SCROLL } from '../config/motion';

/** 正式人物档案文案（原样录入，未经改写） */
const CONTENT: Array<
  | { type: 'group'; title: string }
  | { type: 'field'; label: string; value: string | string[] }
> = [
  { type: 'group', title: '人物基本信息' },
  { type: 'field', label: '姓名', value: '通惠' },
  { type: 'field', label: '年龄', value: '700 多岁，处于幼年至青壮年期。' },
  { type: 'field', label: '诞生时间', value: '元代至元三十年（1293 年）。通惠河全线竣工、积水潭码头千帆汇聚之时诞生。' },
  { type: 'field', label: '身份', value: '北京大运河博物馆·运河文脉互动使者、通惠河守护者。' },
  { type: 'field', label: '常驻地点', value: '北京大运河博物馆数字空间，原型扎根于通惠河河道。' },

  { type: 'group', title: '名字与来历' },
  { type: 'field', label: '命名溯源', value: [
    '取自郭守敬于元代开凿的"通惠河"，是京杭大运河最北端的收尾河段，也是大运河真正进入北京城的标志。',
    '"通"为通达、连通；"惠"为惠泽百姓。',
  ]},
  { type: 'field', label: '本体意象', value: '大运河记忆灵一族，是由通惠河河水、古船木、帆影与千年漕运记忆凝聚而成的灵体。' },

  { type: 'group', title: '性格与能力' },
  { type: 'field', label: '性格特质', value: '温和沉稳，自带河水一般包容的气质；善于把复杂的水利、漕运知识转化为通俗故事。拥有漫长岁月带来的共情力。' },
  { type: 'field', label: '核心能力', value: [
    '1. 通晓水利：深谙郭守敬引水、设闸、分水的工程智慧，能讲解古代水利原理。',
    '2. 跨越时空：见证从元、明、清漕运兴衰，直至近现代河道变迁、当代运河文化活化。',
    '3. 连接万物：作为媒介，串联人与运河、城市与历史、南北地域文化。',
  ]},

  { type: 'group', title: '身体意象' },
  { type: 'field', label: '身体结构', value: '形似小型元代漕船，船体为饱经河水浸润的古木质感，带有淡淡的水痕；周身萦绕流动的浅青色水脉，随对话流动。' },
  { type: 'field', label: '意象符号', value: '身上藏着微小船闸构件、漕运粮袋、码头石钉等符号，是千年记忆的碎片。' },
];

/** 阅读状态机 */
type ReadState = 'idle' | 'auto' | 'manual' | 'done';

export interface ScrollProfile {
  activate: () => void;
  /** 暂时停用交互与自动滚动，但保留整层可见（进气泡对话页时用：不淡出层、不清场） */
  pause: () => void;
  stop: () => void;
  /** 正文滑到最底端的状态变化回调（显隐「开启对话」入口用） */
  onEndChange: (cb: (atEnd: boolean) => void) => void;
}

export function createScrollProfile(layer: HTMLElement): ScrollProfile {
  const S = SCROLL;

  /* ---- DOM 引用 ---- */
  const viewport = layer.querySelector<HTMLElement>('.scroll-viewport');
  const content = layer.querySelector<HTMLElement>('.scroll-content');
  const paper = layer.querySelector<HTMLElement>('.scroll-art-paper');
  const rodBottom = layer.querySelector<HTMLElement>('.scroll-art-rod-bottom');

  /* ---- 美术画布几何注入：画布高度 + 纸面内文区百分比（全部来自 SCROLL.art） ---- */
  const A = S.art;
  layer.style.setProperty('--scroll-canvas-h', `${A.canvasHeightVh}vh`);
  layer.style.setProperty('--scroll-canvas-h-m', `${A.canvasHeightVwMobile}vw`);
  layer.style.setProperty('--scroll-viewport-left', `${A.viewport.leftPct}%`);
  layer.style.setProperty('--scroll-viewport-right', `${A.viewport.rightPct}%`);
  layer.style.setProperty('--scroll-viewport-top', `${A.viewport.topPct}%`);
  layer.style.setProperty('--scroll-viewport-bottom', `${A.viewport.bottomPct}%`);

  /* ---- 状态 ---- */
  let rafId = 0;
  let state: ReadState = 'idle';
  let currentAutoSpeed = 0; // 当前自动滚动速度（px/frame；恢复时从 0 渐变到 S.autoPxPerFrame）
  let resumeStartAt = 0;    // 恢复渐变起始时间戳
  let userPausedAt = 0;     // 最近一次手动交互时间戳（performance.now）
  let maxScroll = 0;        // content.scrollHeight - viewport.clientHeight
  /** 按住正文拖动中（鼠标/触控笔）：抑制自动滚动恢复 */
  let dragging = false;
  /** 滚动位置浮点累加器：DOM scrollTop 读回是整数，<1px/帧的小数增量会被取整吃掉，
   *  所以真实位置在 JS 里以浮点维护，scrollTop 只写不读 */
  let posFloat = 0;
  /** 正文到达底端（用于显隐「开启对话」入口） */
  let atEnd = false;
  let endCb: ((atEnd: boolean) => void) | null = null;
  /** 卷轴激活时刻（performance.now）：startDelay 内静止，之后经 resumeRampSec 渐增到全速 */
  let startAt = 0;

  function applyPos(): void {
    if (viewport) viewport.scrollTop = posFloat;
    // 底端状态变化（自动滚动到底 / 用户滑回上方）时通知外部
    const nowEnd = maxScroll > 0 && posFloat >= maxScroll - 2;
    if (nowEnd !== atEnd) {
      atEnd = nowEnd;
      endCb?.(nowEnd);
    }
  }

  /* ---------- 卷轴展开：纸面自上而下揭开、下轴跟随下缘 ----------
   * 正文字段先构建好，但展开到 textAt 之前整体不可见（避免文字浮在未展开的纸上）。
   * 展开进度由 GSAP 补间驱动一个代理对象，换算成：
   *   纸面 clip-path 的下缘 inset（上边界固定）
   *   下轴 translateY（yPercent 基准 = 该 img 自身高度 = 整个画布高，等于展开行程） */
  const U = S.unfold;
  /** 纸面高度（占画布高 %）：既是展开行程，也是下轴的下移总距离 */
  const paperH = A.paperBottomPct - A.paperTopPct;
  const unfoldState = { p: 0 };
  let unfoldTween: gsap.core.Tween | null = null;
  let textShown = false;

  function applyUnfold(p: number): void {
    if (paper) {
      const bottomInset = 100 - (A.paperTopPct + paperH * p);
      paper.style.clipPath = `inset(${A.paperTopPct}% 0% ${bottomInset}% 0%)`;
    }
    // p=1 时位移为 0，下轴正好停在美工素材的原始位置
    if (rodBottom) rodBottom.style.transform = `translateY(${-paperH * (1 - p)}%)`;
  }

  function resetUnfold(): void {
    unfoldTween?.kill();
    unfoldTween = null;
    textShown = false;
    unfoldState.p = 0;
    if (paper) paper.style.clipPath = '';
    if (rodBottom) rodBottom.style.transform = '';
    if (viewport) {
      gsap.killTweensOf(viewport);
      viewport.style.opacity = '';
    }
  }

  function playUnfold(): void {
    resetUnfold();
    if (!U.enable) return;
    applyUnfold(0);
    if (viewport) viewport.style.opacity = '0';
    unfoldTween = gsap.to(unfoldState, {
      p: 1,
      duration: U.durationSec,
      ease: U.ease,
      onUpdate: () => {
        applyUnfold(unfoldState.p);
        if (!textShown && unfoldState.p >= U.textAt) {
          textShown = true;
          if (viewport) {
            gsap.to(viewport, { opacity: 1, duration: U.textFadeSec, ease: 'power1.out' });
          }
        }
      },
    });
  }

  function buildContent(): void {
    if (!content) return;
    content.innerHTML = '';
    CONTENT.forEach((item) => {
      if (item.type === 'group') {
        const h = document.createElement('h4');
        h.className = 'sp-group';
        h.textContent = item.title;
        content.appendChild(h);
      } else {
        const row = document.createElement('div');
        row.className = 'sp-field';
        const label = document.createElement('div');
        label.className = 'sp-label';
        label.textContent = item.label;
        row.appendChild(label);
        const val = document.createElement('div');
        val.className = 'sp-value';
        const lines = Array.isArray(item.value) ? item.value : [item.value];
        lines.forEach((line) => {
          const p = document.createElement('p');
          p.textContent = line;
          val.appendChild(p);
        });
        row.appendChild(val);
        content.appendChild(row);
      }
    });
  }

  function setManual(): void {
    state = 'manual';
    currentAutoSpeed = 0;
    userPausedAt = performance.now();
  }

  function checkResume(elapsed: number): void {
    if (state !== 'manual' || currentAutoSpeed >= S.autoPxPerFrame) return;
    // 闲置超过 resumeDelay 后开始恢复渐变
    if (elapsed >= S.resumeDelay * 1000 && currentAutoSpeed < S.autoPxPerFrame) {
      if (resumeStartAt === 0) resumeStartAt = performance.now();
      const t = Math.min(1, (performance.now() - resumeStartAt) / (S.resumeRampSec * 1000));
      currentAutoSpeed = S.autoPxPerFrame * t;
      if (currentAutoSpeed >= S.autoPxPerFrame) {
        currentAutoSpeed = S.autoPxPerFrame;
        state = 'auto';
      }
    }
  }

  function onWheel(e: WheelEvent): void {
    if (!viewport || state === 'idle') return;
    e.preventDefault();
    e.stopPropagation(); // 不传播到外层 scrollController
    posFloat = Math.max(0, Math.min(maxScroll, posFloat + e.deltaY));
    applyPos();
    setManual();
  }

  function onTouchStart(e: TouchEvent): void {
    if (!viewport || !e.touches[0]) return;
    lastTouchY = e.touches[0].clientY;
    lastTouchScrollTop = posFloat;
    setManual();
  }
  let lastTouchY = 0;
  let lastTouchScrollTop = 0;

  function onTouchMove(e: TouchEvent): void {
    if (!viewport || !e.touches[0]) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = lastTouchY - e.touches[0].clientY; // 手指向上滑 → 位置增加
    posFloat = Math.max(0, Math.min(maxScroll, lastTouchScrollTop + dy));
    applyPos();
  }

  /* ---- 按住正文拖动浏览（鼠标 / 触控笔）：与滚轮、触摸共用同一浮点位置 ----
   * 触屏走上面的 touch 事件，这里只接管非触摸指针，避免同一次滑动被计算两遍。 */
  let dragPointerId = -1;
  let dragStartY = 0;
  let dragStartPos = 0;

  function onDragDown(e: PointerEvent): void {
    if (!viewport || state === 'idle') return;
    if (e.pointerType === 'touch' || e.button !== 0) return;
    e.preventDefault(); // 阻止拖动时选中文字
    e.stopPropagation();
    dragPointerId = e.pointerId;
    dragStartY = e.clientY;
    dragStartPos = posFloat;
    dragging = true;
    viewport.classList.add('is-dragging');
    viewport.setPointerCapture(e.pointerId);
    setManual();
  }
  function onDragMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId || !viewport) return;
    e.preventDefault();
    // 鼠标上移 = 手指上滑 = 内容往前（与触摸方向一致）
    posFloat = Math.max(0, Math.min(maxScroll, dragStartPos + (dragStartY - e.clientY)));
    applyPos();
    setManual(); // 拖动期间持续刷新暂停时刻，松手后才重新计 3s
  }
  function onDragUp(e: PointerEvent): void {
    if (e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = -1;
    viewport?.classList.remove('is-dragging');
    viewport?.releasePointerCapture(e.pointerId);
  }

  function autoFrame(): void {
    if (!activeRef) return;
    rafId = requestAnimationFrame(autoFrame);
    if (!viewport) return;

    maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

    // 手动交互期间：只检查恢复条件
    if (state === 'manual') {
      const elapsed = performance.now() - userPausedAt;
      if (elapsed >= S.resumeDelay * 1000 && !dragging) {
        checkResume(elapsed);
      }
      return;
    }

    if (state === 'idle') return;

    // 起始停留：startDelay 秒内不动；之后经 resumeRampSec 从 0 渐增到全速，避免突然启动
    const sinceStart = performance.now() - startAt;
    if (sinceStart < S.startDelay * 1000) return;
    const rampT = Math.min(1, (sinceStart - S.startDelay * 1000) / (S.resumeRampSec * 1000));
    currentAutoSpeed = S.autoPxPerFrame * rampT;

    // auto：驱动自动滚动（浮点累加，<1px/帧也能持续前进）
    posFloat += currentAutoSpeed;
    if (!S.loop && posFloat >= maxScroll) {
      posFloat = maxScroll;
      state = 'done';
      currentAutoSpeed = 0;
    }
    posFloat = Math.max(0, Math.min(maxScroll, posFloat));
    applyPos();
  }

  let activeRef = false;

  function activate(): void {
    if (activeRef) return;
    if (!layer) return;
    activeRef = true;

    layer.setAttribute('aria-hidden', 'false');
    layer.style.pointerEvents = 'auto'; // 卷轴 wheel/touch/thumb drag 需要
    gsapFadeInLayer();
    playUnfold(); // 纸面展开（正文在 textAt 后才淡入）

    // 构建文字（清空 + 重建）
    buildContent();

    // 等下一帧 layout 稳定后初始化滚动
    requestAnimationFrame(() => {
      if (!viewport) return;
      maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      posFloat = 0;
      applyPos();
      currentAutoSpeed = 0; // 起始停留期间速度为 0，由 autoFrame 按 sinceStart 渐增
      // 自动滚动的停留计时从「展开完成」起算，避免纸还在展开文字就动了
      startAt = performance.now() + (U.enable ? U.durationSec * 1000 : 0);
      state = 'auto';
      resumeStartAt = 0;
      userPausedAt = 0;
      rafId = requestAnimationFrame(autoFrame);
    });

    // 事件监听：绑定在 viewport 上（不挡整个页面）
    viewport?.addEventListener('wheel', onWheel, { passive: false });
    viewport?.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport?.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport?.addEventListener('pointerdown', onDragDown);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }

  function pause(): void {
    if (!activeRef) return;
    activeRef = false;
    cancelAnimationFrame(rafId);

    layer.style.pointerEvents = 'none'; // 让出点击：气泡页需要船体接收点按
    // 移除事件监听
    viewport?.removeEventListener('wheel', onWheel);
    viewport?.removeEventListener('touchstart', onTouchStart);
    viewport?.removeEventListener('touchmove', onTouchMove);
    viewport?.removeEventListener('pointerdown', onDragDown);
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);

    state = 'idle';
    currentAutoSpeed = 0;
    resumeStartAt = 0;
    userPausedAt = 0;
    dragging = false;
    dragPointerId = -1;
    viewport?.classList.remove('is-dragging');
    posFloat = 0;
    applyPos();
  }

  function stop(): void {
    if (!activeRef) return;
    pause();
    resetUnfold(); // 收起纸面/下轴，恢复静态初始态，下次进入重新展开
    gsapFadeOutLayer();
  }

  /* ---- 层淡入淡出（用 CSS transition，轻量） ---- */
  function gsapFadeInLayer(): void {
    layer.style.transition = 'opacity 0.7s ease';
    layer.style.opacity = '0';
    // 强制 reflow
    void layer.offsetWidth;
    layer.style.opacity = '1';
  }
  function gsapFadeOutLayer(): void {
    layer.style.transition = 'opacity 0.5s ease';
    layer.style.opacity = '0';
  }

  return {
    activate,
    pause,
    stop,
    onEndChange: (cb) => { endCb = cb; },
  };
}
