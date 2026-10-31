/**
 * 时期详情场景(第五幕 · 结点内四态页)
 *
 * 状态机:
 *   标题页(home-bg,三行文案渐入,点任意处)
 *   → 卷轴页(纸/上轴/下轴整幅 PNG 对位;展开动画:纸 clip-path 自上揭开+下轴随落;
 *     正文自动慢滚,滚轮/拖拽手动介入即停,闲置渐速恢复;点底部「收起卷轴」)
 *   → 文物触发页(文物整幅 PNG 亮白描边静置;点击以 bbox 中心变亮变大)
 *   → 文物详情页(触发键 PNG 按 bbox 裁出放大占位 + 名称/年代/尺寸/简介;
 *     点任意处返回触发页)
 *   → 全部点完 → 勋章浮层原地出现在触发页(占位样式,点任意处)
 *   → resolve → timelineScene 淡回时间线
 *   第一时期无勋章:详情页点任意处后,放出「返回长河」由用户自行返回。
 *   左上角「返回长河」流程未完成时隐藏,全部文物看完(有勋章则勋章页浮现完成)后才出现。
 *
 * 几何:所有美术均为 1920×1080 整幅画布;.era-stage 按 cover 规则等比铺满视口,
 *   子元素一律 % 定位;字号以 stage 宽÷100 = 1em 注入(fitStage)。
 * 数据:文案与文物 bbox 集中在 eraData.ts;动效参数集中在 motion.ts ERA。
 */

import gsap from 'gsap';
import { ERA } from '../config/motion';
import { ASSETS } from '../config/assets';
import { getEraByNode } from './eraData';
import type { EraArtifact, EraData } from './eraData';
import { NODES } from './timelinePath';

export interface EraScene {
  /** 场景淡入前先定好返回按钮状态,避免按钮在淡入首帧闪一下 */
  prepare: (nodeIdx: number) => void;
  /** 跑完一个时期的完整浏览流程(或用户点「返回长河」)后 resolve */
  run: (nodeIdx: number) => Promise<void>;
}

type PageName = 'title' | 'scroll' | 'trigger' | 'detail';

export function createEraScene(): EraScene {
  const E = ERA;

  const rootEl = () => document.getElementById('scene-era');
  const stageEl = () => rootEl()?.querySelector<HTMLElement>('.era-stage');
  const backEl = () => rootEl()?.querySelector<HTMLButtonElement>('.era-back');

  /** 返回按钮锁定:流程未走完时隐藏,避免用户中途退出 */
  function setBackLocked(locked: boolean): void {
    backEl()?.classList.toggle('is-locked', locked);
  }

  /** 当前 run 的 resolve;finish 时调用 */
  let resolveRun: (() => void) | null = null;
  /** 自动滚动 rAF */
  let rafId = 0;
  /** 活跃 tween(取消用) */
  let tweens: gsap.core.Tween[] = [];
  /** 事件解绑函数 */
  let listeners: Array<() => void> = [];
  /** 详情页大图重排(resize 时调用) */
  let relayoutDetail: (() => void) | null = null;

  /* ---------------- 基础工具 ---------------- */

  function stageSize(): { w: number; h: number } {
    const s = stageEl();
    return { w: s?.clientWidth ?? 0, h: s?.clientHeight ?? 0 };
  }

  /** stage 按 cover 规则铺满视口(保持 16:9,超出部分居中裁掉);1em = 画布宽 1% */
  function fitStage(): void {
    const s = stageEl();
    if (!s) return;
    const scale = Math.max(window.innerWidth / E.canvasW, window.innerHeight / E.canvasH);
    const w = E.canvasW * scale;
    const h = E.canvasH * scale;
    s.style.width = `${w}px`;
    s.style.height = `${h}px`;
    s.style.fontSize = `${w / 100}px`;
  }

  function listen<K extends keyof HTMLElementEventMap>(
    el: HTMLElement | null,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void {
    if (!el) return;
    const wrapped = fn as EventListener;
    el.addEventListener(type, wrapped, opts);
    listeners.push(() => el.removeEventListener(type, wrapped));
  }

  function img(cls: string, src: string): HTMLImageElement {
    const im = document.createElement('img');
    if (cls) im.className = cls;
    im.src = src;
    im.alt = '';
    im.setAttribute('aria-hidden', 'true');
    return im;
  }

  function hintEl(text: string, tone: 'light' | 'dark', static_ = false): HTMLElement {
    const p = document.createElement('p');
    p.className = `era-hint era-hint-${tone}${static_ ? ' era-hint-static' : ''}`;
    p.textContent = text;
    return p;
  }

  /** 结束本次 run:清场并 resolve */
  function finish(): void {
    const r = resolveRun;
    resolveRun = null;
    teardown();
    r?.();
  }

  function teardown(): void {
    cancelAnimationFrame(rafId);
    tweens.forEach((t) => t.kill());
    tweens = [];
    listeners.forEach((fn) => fn());
    listeners = [];
    relayoutDetail = null;
    const s = stageEl();
    if (s) s.innerHTML = '';
  }

  /** 页间交叉淡变 */
  function switchPage(pages: Record<PageName, HTMLElement>, name: PageName): void {
    (Object.keys(pages) as PageName[]).forEach((key) => {
      const el = pages[key];
      if (key === name) {
        el.classList.add('is-on');
        tweens.push(gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: E.pageFadeSec, ease: 'power1.out' }));
      } else {
        el.classList.remove('is-on');
        tweens.push(gsap.to(el, { opacity: 0, duration: E.pageFadeSec * 0.8, ease: 'power1.in' }));
      }
    });
  }

  /* ---------------- 页骨架 ---------------- */

  function buildShell(era: EraData): Record<PageName, HTMLElement> {
    const s = stageEl()!;
    const mk = (cls: string): HTMLElement => {
      const d = document.createElement('div');
      d.className = cls;
      s.appendChild(d);
      return d;
    };
    const pages: Record<PageName, HTMLElement> = {
      title: mk('era-page era-page-title'),
      scroll: mk('era-page era-page-scroll'),
      trigger: mk('era-page era-page-trigger'),
      detail: mk('era-page era-page-detail'),
    };
    pages.title.appendChild(img('era-bg', ASSETS.homeBg));
    pages.scroll.appendChild(img('era-bg', era.pageBg));
    pages.trigger.appendChild(img('era-bg', era.pageBg));
    pages.detail.appendChild(img('era-bg', era.pageBg));
    return pages;
  }

  /* ---------------- 1. 标题页 ---------------- */

  function buildTitle(page: HTMLElement, era: EraData, onNext: () => void): void {
    const block = document.createElement('div');
    block.className = 'era-placeholder era-title-block';
    block.innerHTML = `
      <p class="era-kicker"></p>
      <h2 class="era-title"></h2>
      <p class="era-sub"></p>`;
    block.querySelector('.era-kicker')!.textContent = era.kicker;
    block.querySelector('.era-title')!.textContent = era.name;
    block.querySelector('.era-sub')!.textContent = era.period;
    page.appendChild(block);
    page.appendChild(hintEl(E.title.hint, 'light'));

    const lines = block.querySelectorAll('.era-kicker, .era-title, .era-sub');
    tweens.push(
      gsap.fromTo(
        lines,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: E.title.lineFadeSec, stagger: E.title.lineStaggerSec, ease: 'power2.out', delay: 0.2 },
      ),
    );
    tweens.push(gsap.delayedCall(E.title.armDelaySec, () => listen(page, 'click', onNext)));
  }

  /* ---------------- 2. 卷轴页 ---------------- */

  interface ScrollParts {
    paper: HTMLImageElement;
    rodBottom: HTMLImageElement;
    viewport: HTMLElement;
    collapse: HTMLButtonElement;
  }

  function buildScroll(page: HTMLElement, era: EraData, onCollapse: () => void): ScrollParts {
    const S = E.scroll;
    const paper = img('era-scroll-paper', ASSETS.eraScroll.paper);
    const rodTop = img('era-scroll-rod era-scroll-rod-top', ASSETS.eraScroll.rodTop);
    const rodBottom = img('era-scroll-rod era-scroll-rod-bottom', ASSETS.eraScroll.rodBottom);

    const viewport = document.createElement('div');
    viewport.className = 'era-scroll-viewport';
    viewport.style.left = `${S.viewport.leftPct}%`;
    viewport.style.right = `${100 - S.viewport.rightPct}%`;
    viewport.style.top = `${S.viewport.topPct}%`;
    viewport.style.bottom = `${100 - S.viewport.bottomPct}%`;
    const content = document.createElement('div');
    content.className = 'era-scroll-content';
    era.intro.forEach((b) => {
      if (b.type === 'subhead') {
        const h = document.createElement('h3');
        h.className = 'era-scroll-subhead';
        h.textContent = b.text;
        content.appendChild(h);
      } else {
        const p = document.createElement('p');
        p.textContent = b.text;
        content.appendChild(p);
      }
    });
    viewport.appendChild(content);

    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'era-scroll-collapse';
    collapse.textContent = S.collapseLabel;

    page.append(paper, rodTop, rodBottom, viewport, collapse);
    const parts: ScrollParts = { paper, rodBottom, viewport, collapse };

    listen(collapse, 'click', () => playCollapse(parts, onCollapse));
    playUnfold(parts);
    startAutoScroll(viewport);
    return parts;
  }

  /** 展开:纸 clip-path 自上揭开,下轴随纸面下缘落下;到 textAt 正文淡入 */
  function playUnfold(parts: ScrollParts): void {
    const S = E.scroll;
    const { h } = stageSize();
    const paperSpan = S.paperBottomPct - S.paperTopPct;
    const state = { p: 0 };
    let textShown = false;

    const render = () => {
      const bottomEdge = S.paperTopPct + paperSpan * state.p;
      gsap.set(parts.paper, { clipPath: `inset(${S.paperTopPct}% 0% ${100 - bottomEdge}% 0%)` });
      gsap.set(parts.rodBottom, { y: ((bottomEdge - S.rodBottomTopPct) / 100) * h });
    };
    gsap.set(parts.viewport, { opacity: 0 });
    gsap.set(parts.collapse, { opacity: 0 });
    render();

    tweens.push(
      gsap.to(state, {
        p: 1,
        duration: S.unfoldSec,
        ease: 'power2.inOut',
        onUpdate: () => {
          render();
          if (!textShown && state.p >= S.textAt) {
            textShown = true;
            tweens.push(gsap.to(parts.viewport, { opacity: 1, duration: S.textFadeSec }));
            tweens.push(gsap.to(parts.collapse, { opacity: 1, duration: S.textFadeSec }));
          }
        },
      }),
    );
  }

  /** 收起:正文先淡出,纸自下而上卷起,下轴随上缘收回 */
  function playCollapse(parts: ScrollParts, onDone: () => void): void {
    const S = E.scroll;
    const { h } = stageSize();
    const paperSpan = S.paperBottomPct - S.paperTopPct;
    const state = { p: 1 };
    tweens.push(gsap.to([parts.viewport, parts.collapse], { opacity: 0, duration: 0.3 }));
    tweens.push(
      gsap.to(state, {
        p: 0,
        duration: S.collapseSec,
        ease: 'power2.inOut',
        onUpdate: () => {
          const bottomEdge = S.paperTopPct + paperSpan * state.p;
          gsap.set(parts.paper, { clipPath: `inset(${S.paperTopPct}% 0% ${100 - bottomEdge}% 0%)` });
          gsap.set(parts.rodBottom, { y: ((bottomEdge - S.rodBottomTopPct) / 100) * h });
        },
        onComplete: onDone,
      }),
    );
  }

  /** 正文自动慢滚 + 手动介入(滚轮/拖拽),闲置后渐速恢复;逻辑同 act2 scrollProfile */
  function startAutoScroll(viewport: HTMLElement): void {
    const S = E.scroll;
    let pos = 0;
    let dragging = false;
    let lastY = 0;
    let lastInteraction = 0;
    const startAt = performance.now() + S.unfoldSec * 1000;
    const maxPos = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const clampPos = (v: number) => Math.min(maxPos(), Math.max(0, v));
    const apply = () => { viewport.scrollTop = pos; };
    const mark = () => { lastInteraction = performance.now(); };

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (dragging) return;
      const now = performance.now();
      const sinceStart = (now - startAt) / 1000 - S.startDelay;
      const idle = (now - lastInteraction) / 1000;
      if (sinceStart > 0 && idle > S.resumeDelay) {
        const ramp = Math.min(1, sinceStart / S.resumeRampSec) * Math.min(1, (idle - S.resumeDelay) / S.resumeRampSec);
        const next = clampPos(pos + S.autoPxPerFrame * ramp);
        if (next !== pos) { pos = next; apply(); }
      }
    };
    rafId = requestAnimationFrame(tick);

    listen(viewport, 'wheel', (e) => {
      e.preventDefault();
      mark();
      pos = clampPos(pos + e.deltaY);
      apply();
    }, { passive: false });
    listen(viewport, 'pointerdown', (e) => {
      dragging = true;
      lastY = e.clientY;
      viewport.setPointerCapture(e.pointerId);
      mark();
    });
    listen(viewport, 'pointermove', (e) => {
      if (!dragging) return;
      pos = clampPos(pos - (e.clientY - lastY));
      lastY = e.clientY;
      mark();
      apply();
    });
    const endDrag = () => { dragging = false; mark(); };
    listen(viewport, 'pointerup', endDrag);
    listen(viewport, 'pointercancel', endDrag);
  }

  /* ---------------- 3. 文物触发页 ---------------- */

  function buildTrigger(
    page: HTMLElement,
    era: EraData,
    onTap: (a: EraArtifact, imgEl: HTMLImageElement) => void,
  ): void {
    era.artifacts.forEach((a, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'era-artifact';
      /* 上下微浮动:注入幅度/周期,错峰 delay 避免多图标同频机械感 */
      wrap.style.setProperty('--bob-amp', `${E.trigger.bobAmpEm}em`);
      wrap.style.setProperty('--bob-dur', `${E.trigger.bobDurSec}s`);
      wrap.style.animationDelay = `${i * E.trigger.bobStaggerSec}s`;
      const im = img('era-artifact-img', a.icon);
      wrap.appendChild(im);

      const hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'era-artifact-hit';
      hit.setAttribute('aria-label', a.name);
      const pad = E.trigger.hitPadPct;
      hit.style.left = `${a.bbox.l - pad}%`;
      hit.style.top = `${a.bbox.t - pad}%`;
      hit.style.width = `${a.bbox.r - a.bbox.l + pad * 2}%`;
      hit.style.height = `${a.bbox.b - a.bbox.t + pad * 2}%`;

      /* hit 必须在 wrap 之前:CSS 用 .era-artifact-hit:hover + .era-artifact 联动高亮 */
      page.append(hit, wrap);
      listen(hit, 'click', () => onTap(a, im));
      tweens.push(
        gsap.fromTo(wrap, { opacity: 0 }, { opacity: 1, duration: E.trigger.iconFadeSec, delay: 0.25 + i * E.trigger.iconStaggerSec }),
      );
    });
    page.appendChild(hintEl(E.trigger.hint, 'dark'));
  }

  /* ---------------- 4. 文物详情页 ----------------
   * 架构:.era-detail-panel(羊皮纸做 background-image)+ 内部 .era-detail-textwrap(文字)
   * panel 尺寸/位置由 JS 设定,文字靠 CSS padding 内缩,不再需要 alpha bbox 计算。 */

  function buildDetail(page: HTMLElement, a: EraArtifact, onClose: () => void): void {
    const D = E.detail;
    /* 清场:详情页元素全删掉重新来 */
    page.querySelectorAll(
      '.era-detail-panel, .era-detail-hero, .era-hint',
    ).forEach((n) => n.remove());

    const hasImage = !!a.detailImg;

    /* 羊皮纸面板:background-image = 羊皮纸.png,文字放在内部 textwrap */
    const panel = document.createElement('div');
    panel.className = 'era-detail-panel';
    panel.style.backgroundImage = `url(${ASSETS.eraDetailParchment})`;

    /* 文字层(放在 panel 内部,CSS padding 控制内缩) */
    const textwrap = document.createElement('div');
    textwrap.className = 'era-detail-textwrap';

    const nameEl = document.createElement('h3');
    nameEl.className = 'era-detail-name';
    nameEl.textContent = a.name;
    textwrap.appendChild(nameEl);

    const meta: string[] = [];
    if (a.dynasty) meta.push(`年代：${a.dynasty}`);
    if (a.size) meta.push(`尺寸：${a.size}`);
    if (a.provenance) meta.push(`出土地点：${a.provenance}`);
    if (meta.length) {
      const metaEl = document.createElement('p');
      metaEl.className = 'era-detail-meta';
      meta.forEach((m) => {
        const span = document.createElement('span');
        span.textContent = m;
        metaEl.appendChild(span);
      });
      textwrap.appendChild(metaEl);
    }
    const desc = document.createElement('p');
    desc.className = 'era-detail-desc';
    desc.textContent = a.desc;
    textwrap.appendChild(desc);

    panel.appendChild(textwrap);
    page.appendChild(panel);

    const layout = () => {
      const { w, h } = stageSize();

      if (hasImage) {
        /* 有图模式:文物大图 + 羊皮纸面板,各自独立可调(参数在 motion.ts ERA.detail) */
        const H = E.detail.hero;
        const heroW = (w * H.widthPct) / 100;
        const heroH = H.heightPct === 'square' ? heroW : (h * (H.heightPct as number)) / 100;
        const heroLeft = (w * H.leftPct) / 100;
        const heroTop = H.topPct === 'center' ? (h - heroH) / 2 : (h * (H.topPct as number)) / 100;

        let hero = page.querySelector<HTMLElement>('.era-detail-hero');
        if (!hero) {
          hero = document.createElement('div');
          hero.className = 'era-detail-hero';
          page.appendChild(hero);
        }
        hero.style.left = `${heroLeft}px`;
        hero.style.top = `${heroTop}px`;
        hero.style.width = `${heroW}px`;
        hero.style.height = `${heroH}px`;
        hero.innerHTML = '';
        hero.appendChild(img('era-detail-big', a.detailImg!));

        /* 羊皮纸面板(独立定位,与文物无联动) */
        const P = E.detail.parchment;
        const parW = (w * P.widthPct) / 100;
        const parH = P.heightPct === 'ratio' ? parW * (1080 / 1920) : (h * (P.heightPct as number)) / 100;
        const parLeft = (w * P.leftPct) / 100;
        const parTop = P.topPct === 'center' ? (h - parH) / 2 : (h * (P.topPct as number)) / 100;

        panel.style.left = `${parLeft}px`;
        panel.style.top = `${parTop}px`;
        panel.style.width = `${parW}px`;
        panel.style.height = `${parH}px`;
      } else {
        /* 纯文字模式:羊皮纸面板居中铺满,文物大图容器已删 */
        page.querySelectorAll('.era-detail-hero').forEach((n) => n.remove());
        const scale = Math.min(w / 1920, h / 1080);
        const parW = 1920 * scale;
        const parH = 1080 * scale;
        const parLeft = (w - parW) / 2;
        const parTop = (h - parH) / 2;
        panel.style.left = `${parLeft}px`;
        panel.style.top = `${parTop}px`;
        panel.style.width = `${parW}px`;
        panel.style.height = `${parH}px`;
      }
    };
    layout();
    relayoutDetail = layout;

    page.appendChild(hintEl(D.hint, 'dark'));

    /* 入场淡入 */
    const fadeTargets: HTMLElement[] = [panel];
    const hero = page.querySelector<HTMLElement>('.era-detail-hero');
    if (hero) fadeTargets.unshift(hero);
    tweens.push(
      gsap.fromTo(
        fadeTargets,
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.12 },
      ),
    );
    tweens.push(gsap.delayedCall(D.armDelaySec, () => listen(page, 'click', onClose)));
  }

  /* ---------------- 5. 勋章浮层 ---------------- */

  function showMedal(triggerPage: HTMLElement, onClose: () => void): void {
    const M = E.medal;
    const m = document.createElement('div');
    m.className = 'era-medal';
    m.innerHTML = `
      <div class="era-medal-card">
        <div class="era-medal-badge"><span>勋章</span></div>
        <p class="era-medal-title"></p>
      </div>`;
    m.querySelector('.era-medal-title')!.textContent = M.title;
    m.querySelector('.era-medal-card')!.appendChild(hintEl(M.hint, 'light', true));
    triggerPage.appendChild(m);

    tweens.push(gsap.to(m, { opacity: 1, duration: M.fadeSec, ease: 'power1.out' }));
    tweens.push(
      gsap.fromTo(
        m.querySelector('.era-medal-badge'),
        { scale: 0 },
        {
          scale: 1,
          duration: M.popSec,
          ease: 'back.out(1.8)',
          delay: 0.15,
          /* 勋章页完全浮现后,才放出「返回长河」 */
          onComplete: () => setBackLocked(false),
        },
      ),
    );
    tweens.push(gsap.delayedCall(0.4, () => listen(m, 'click', onClose)));
  }

  /* ---------------- 6. 未建设时期占位页 ---------------- */

  function buildPlaceholder(nodeIdx: number): void {
    const s = stageEl();
    if (!s) return;
    const n = NODES[nodeIdx];
    const d = document.createElement('div');
    d.className = 'era-page era-page-ph is-on';
    d.innerHTML = `
      <div class="era-placeholder">
        <p class="era-kicker">通惠河 · 时光片段</p>
        <h2 class="era-title"></h2>
        <p class="era-sub">这一时期的内容正在筹备中<br/>点击左上角返回长河</p>
      </div>`;
    d.querySelector('.era-title')!.textContent = n?.name ?? '未知时期';
    s.appendChild(d);
  }

  /* ---------------- 状态机入口 ---------------- */

  function prepare(nodeIdx: number): void {
    setBackLocked(getEraByNode(nodeIdx) !== undefined);
  }

  function run(nodeIdx: number): Promise<void> {
    teardown();
    return new Promise<void>((resolve) => {
      const stage = stageEl();
      if (!stage) { resolve(); return; }
      resolveRun = resolve;

      fitStage();
      const onResize = () => { fitStage(); relayoutDetail?.(); };
      window.addEventListener('resize', onResize);
      listeners.push(() => window.removeEventListener('resize', onResize));
      listen(backEl() ?? null, 'click', () => finish());

      const era = getEraByNode(nodeIdx);
      if (!era) { setBackLocked(false); buildPlaceholder(nodeIdx); return; }
      setBackLocked(true);

      const pages = buildShell(era);
      const visited = new Set<string>();

      /* 触发页 → 详情页 → 返回;全部点完且有勋章 → 勋章浮层 → 结束 */
      const openDetail = (a: EraArtifact, imgEl: HTMLImageElement) => {
        visited.add(a.id);
        const cx = (a.bbox.l + a.bbox.r) / 2;
        const cy = (a.bbox.t + a.bbox.b) / 2;
        tweens.push(
          gsap.to(imgEl, {
            scale: E.trigger.tapScale,
            filter: `brightness(${E.trigger.tapBrightness}) drop-shadow(0 0 0.4em rgba(255,252,240,1)) drop-shadow(0 0 1.4em rgba(255,240,200,0.8))`,
            transformOrigin: `${cx}% ${cy}%`,
            duration: E.trigger.tapSec,
            ease: 'power2.out',
            onComplete: () => {
              gsap.set(imgEl, { clearProps: 'scale,filter,transformOrigin' });
              buildDetail(pages.detail, a, () => {
                switchPage(pages, 'trigger');
                if (visited.size === era.artifacts.length) {
                  /* 全部点完:有勋章出浮层(浮现完成后放出返回按钮),无勋章直接放出返回按钮 */
                  if (era.hasMedal) showMedal(pages.trigger, () => finish());
                  else setBackLocked(false);
                }
              });
              switchPage(pages, 'detail');
            },
          }),
        );
      };

      buildTitle(pages.title, era, () => {
        switchPage(pages, 'scroll');
        buildScroll(pages.scroll, era, () => switchPage(pages, 'trigger'));
      });
      buildTrigger(pages.trigger, era, openDetail);
      switchPage(pages, 'title');
    });
  }

  return { prepare, run };
}
