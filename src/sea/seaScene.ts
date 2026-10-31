import { SEA_LAYERS, type SeaLayerCfg } from '../config/motion';

/**
 * 海面场景：海1~海4 四个纵深图层（实测均为 4096×1714 透明 PNG / WebP）。
 *
 * 运动方式（第六轮：水平无缝滚动 + 涟漪浮动）：
 * - 横向：每层用「原图 + 水平镜像图」双图接续（conveyor 宽 200%），
 *   关键帧 translateX(-25% → -75%)，首尾显示内容完全相同、位移恰为一张图宽，
 *   循环无接缝无跳变。素材边缘色差大（海4 最大 213），不可直接首尾拼接。
 * - 纵向：每层叠加小幅上下浮动（wave-bob），幅度/周期/相位各不同，
 *   形成持续变化的波峰组合（涟漪感），不与横向滚动冲突。
 * - 尺寸：每张图按原始宽高比完整显示，宽度 widthPct（>100 兼作溢出余量）。
 * - DOM 极简：每层仅 2 个 <img>（原图+镜像），无无限复制。
 *
 * 图层 z 序（显式设置，不依赖 DOM 顺序）：
 *   海浪1 z6 → 海浪2 z5 → 船 z4 → 海浪3 z3 → 海浪4 z2
 * resize 走防抖全量重建，监听器全局只注册一次。
 */

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

async function createLayer(cfg: SeaLayerCfg): Promise<HTMLDivElement> {
  const isMobile = window.innerWidth <= 720;
  const widthPct = isMobile && cfg.widthPctMobile != null ? cfg.widthPctMobile : cfg.widthPct;
  const bottomVh = isMobile && cfg.bottomVhMobile != null ? cfg.bottomVhMobile : cfg.bottomVh;

  // 图层只负责定位与层叠：不设定高度、不裁切，高度由图片自然撑开
  const layer = document.createElement('div');
  layer.className = 'wave-layer';
  layer.style.zIndex = String(cfg.z);
  layer.style.bottom = `${bottomVh}vh`;
  layer.style.opacity = String(cfg.opacity);
  layer.style.filter = `brightness(${cfg.brightness})`;

  // 纵向浮动层：小幅度上下起伏（涟漪感），不影响横向滚动
  const bob = document.createElement('div');
  bob.className = 'wave-bob';
  bob.style.setProperty('--bob-y', `${cfg.bobY}px`);
  bob.style.setProperty('--bob-dur', `${cfg.bobDur}s`);
  bob.style.setProperty('--bob-delay', `${cfg.bobDelay}s`);

  // 横向传送带：原图 + 水平镜像图，宽 200%，整体平移实现无缝循环
  const conveyor = document.createElement('div');
  conveyor.className = 'wave-conveyor';
  conveyor.style.setProperty('--scroll-dur', `${cfg.scrollDur}s`);
  conveyor.style.setProperty('--scroll-delay', `${cfg.scrollDelay}s`);
  conveyor.style.setProperty('--width-pct', String(widthPct));

  const makeImg = (mirror: boolean) => {
    const img = document.createElement('img');
    img.src = cfg.src;
    img.alt = '';
    if (mirror) img.style.transform = 'scaleX(-1)';
    // 底部渐隐蒙版设在图片本身，随 conveyor 一起平移
    if (cfg.bottomFade) {
      const p = cfg.bottomFade.blackUntilPct;
      img.style.webkitMaskImage =
        img.style.maskImage =
          `linear-gradient(to bottom, #000 0%, #000 ${p}%, transparent 100%)`;
    }
    return img;
  };
  conveyor.appendChild(makeImg(false));
  conveyor.appendChild(makeImg(true));

  bob.appendChild(conveyor);
  layer.appendChild(bob);
  return layer;
}

let bound = false;
let currentContainer: HTMLElement | null = null;

const onResize = debounce(() => {
  if (currentContainer) void buildSea(currentContainer);
}, 220);

export async function buildSea(container: HTMLElement): Promise<void> {
  currentContainer = container;
  container.querySelectorAll('.wave-layer').forEach((el) => el.remove());

  const layers = await Promise.all(SEA_LAYERS.map(createLayer));
  layers.forEach((l) => container.appendChild(l));

  if (!bound) {
    window.addEventListener('resize', onResize);
    bound = true;
  }
}
