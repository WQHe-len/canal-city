import type { CloudCfg, RainCfg } from '../config/motion';

/**
 * 天气层（云 / 雨）构建器。
 * - 云：每朵云从画面右侧外漂入、左侧外漂出，循环重置发生在屏幕外 → 无跳变。
 *   外层做水平位移，内层做轻微上下浮动。
 * - 雨：每层为上下两张同图拼接的履带，整体 translateY(0 → -50%) 循环，
 *   雨线持续向下进入/离开画面；三（两）层速度/透明度不同，制造纵深。
 */

export function buildClouds(container: HTMLElement, items: CloudCfg[]): void {
  container.innerHTML = '';
  items.forEach((c) => {
    const drift = document.createElement('div');
    drift.className = 'cloud-drift';
    drift.style.top = `${c.topVh}vh`;
    drift.style.width = `${c.widthVw}vw`;
    drift.style.setProperty('--dur', `${c.duration}s`);
    drift.style.setProperty('--delay', `${c.delay}s`);
    drift.style.setProperty('--bob-dur', `${c.bobDur}s`);
    drift.style.setProperty('--bob-y', `${c.bobY}px`);

    const bob = document.createElement('div');
    bob.className = 'cloud-bob';
    const img = document.createElement('img');
    img.src = c.src;
    img.alt = '';
    img.style.opacity = String(c.opacity);
    bob.appendChild(img);
    drift.appendChild(bob);
    container.appendChild(drift);
  });
}

export function buildRain(container: HTMLElement, items: RainCfg[]): void {
  container.innerHTML = '';
  items.forEach((r) => {
    const layer = document.createElement('div');
    layer.className = 'rain-layer';
    layer.style.setProperty('--dur', `${r.duration}s`);
    layer.style.setProperty('--delay', `${r.delay}s`);
    layer.style.setProperty('--scale', String(r.scale));
    layer.style.setProperty('--op', String(r.opacity));

    const col = document.createElement('div');
    col.className = 'rain-col';
    const imgA = document.createElement('img');
    const imgB = document.createElement('img');
    imgA.src = r.src;
    imgB.src = r.src;
    imgA.alt = '';
    imgB.alt = '';
    col.appendChild(imgA);
    col.appendChild(imgB);
    layer.appendChild(col);

    container.appendChild(layer);
  });
}
