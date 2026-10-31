/**
 * Three.js 通惠船模型（第二幕 3D 揭幕展示）
 *
 * 模型装载：默认 GLTFLoader 异步加载美工正式 GLB（ACT2.model.glbUrl）；
 * 程序化占位船 buildPlaceholderJunk() 保留为对比/兜底（ACT2.model.usePlaceholder
 * 开关可切回，GLB 加载失败也自动回退占位）。任何模型进来都走包围盒自适应管线
 * （居中 + 按屏高缩放），几何与动画逻辑完全解耦，后续换彩色版模型只需覆盖同名文件。
 *
 * 揭幕时间轴（setReveal，滚动进度的纯函数映射，反向滚动天然可逆）：
 *   - 阶段 A 入场：opacity / 缩放 / 上浮（reveal.entrance）
 *   - 阶段 B 旋转：yawKeys/pitchKeys 单调三次关键帧曲线（非匀速，有停留/变速/缓滞/收势）
 *   - 阶段 C 灯光：主光组入场爬坡 + 轮廓光随扫掠脉冲（reveal.rimLight）
 *   - 阶段 D 交权：unlockAt 后解锁拖拽；之后时间轴角恒为定格值
 *
 * 姿态合成（五层独立叠加、互不污染）：
 *   rotation = 时间轴角(滚动驱动) + 用户拖拽角(永久保留) + 悬停偏移(弹簧回弹)
 *            + 点按轻晃(对话期反馈) + 阅读态自转(ACT2.spin 柜台式慢转)
 *
 * 呼吸悬浮（阶段 D+，reveal.bob）：解锁定格后轻微正弦上下浮动。
 *   层级 scene → floatGroup(呼吸位移) → modelGroup(旋转) → fitGroup(入场) → raw，
 *   呼吸只写 floatGroup.position.y，与其他所有动画零属性冲突；
 *   拖拽时冻结相位完全静止，松手从冻结相位无缝续摆；回锁时包络衰减到 0。
 *
 * 交互（仅 unlockAt 解锁后生效）：
 *   - 鼠标左键拖动 → 累积到 userYaw/userPitch，松手后保持，不复位不回弹
 *   - 悬停跟随 → 瞬时弹簧偏移，闲置自动回弹（见 rotation.hover* 配置）
 *   - 定格展示态无自动旋转：完全静止，控制权完全交给用户；
 *     仅卷轴阅读态（beginIntro 后）开启 ACT2.spin 柜台式 360° 慢转
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { ACT2, SCROLL } from '../config/motion';

/** 对话期事件回调（act2Scene 接线；null = 关闭点按/悬停反馈） */
export type DialogueHandlers = {
  /** 有效点按船体（位移/时长均低于阈值的单击，区别于拖拽） */
  onTap?: () => void;
  /** 悬停进出船体命中区 */
  onHoverChange?: (hovered: boolean) => void;
} | null;

export interface PlaceholderShip {
  /** 初始化（创建场景、相机、渲染器、灯光、事件；GLB 异步装载 + 法线重建 + 着色器预热完成后 Promise 才兑现）。
   *  onProgress 回调 GLB 下载字节进度（loaded/total）；幂等：重复调用返回同一 Promise。 */
  init: (onProgress?: (loaded: number, total: number) => void) => Promise<void>;
  /** 每帧更新：姿态合成 + 悬停弹簧 + 渲染；由外部 rAF（act2Scene.tick）驱动 */
  update: () => void;
  /** 揭幕时间轴：传入第二幕整体进度 [0,1]，驱动入场/旋转/灯光/交互解锁 */
  setReveal: (globalProgress: number) => void;
  /** resize：更新相机 aspect 与 renderer 尺寸 */
  resize: () => void;
  /** 销毁：停止渲染、释放 Three.js 资源、移除事件监听 */
  dispose: () => void;
  /** 模型组（可用来挂自定义标签/热点） */
  readonly modelGroup: THREE.Group | null;

  /* —— 角色介绍阅读态（点击「了解通惠」/章 3 滚动）：无相机运动，原地直接进入 ——
   * 阅读态关闭拖拽与悬停跟随（纯自转展示），呼吸保留；若定格角被拖拽改变，
   * 先补间回 443° 基准姿势再启动自转；onSettled 立即回调（激活卷轴）。
   * 返回 false = 当前不可进入（未解锁 / 已在阅读态） */
  beginIntro: (onSettled?: () => void) => boolean;
  /** 退出阅读态（回滚离开展示阶段）：同步关闭，无回位动画 */
  cancelIntro: () => void;
  /** 气泡对话页（章4）：暂停/恢复卷轴阅读态自转。
   *  false → 速度包络降到 0 并把余角补间回基准姿势（每次进页姿态一致，只留呼吸起伏）；
   *  true  → 打断未完成的回位补间，从当前角继续匀速慢转 */
  setAutoSpin: (on: boolean) => void;
  /** 阅读态占用中——外部用于门控进度驱动的标题显隐与章节回退 */
  readonly introActive: boolean;
  /** 对话期事件接线（章3阅读态由 act2Scene 注入；传 null 关闭点按/悬停反馈） */
  setDialogueHandlers: (h: DialogueHandlers) => void;
  /** 船体当前屏幕包围盒（气泡布局锚定用；模型/相机未就绪返回 null） */
  getBoatScreenRect: () => {
    left: number; top: number; right: number; bottom: number;
    width: number; height: number; cx: number; cy: number;
  } | null;
  /** 最后一组之后再次点按的收束反馈（柔和光脉冲一次，不推进对话） */
  closingPulse: () => void;
  /** 卷轴阶段船体让位（右移 + 略下沉）：true→让位，false→回原位；
   *  横向经 camera.setViewOffset 成像平移（投影形状不变），纵向经独立 offset 叠加呼吸位移（GSAP tween） */
  shiftForScroll: (enable: boolean) => void;
}

/* ---------- Fritsch–Carlson 单调三次插值采样器 ----------
 * C1 连续、段内无过冲、极值点切线为 0（关键帧处自然停顿），适合滚动 scrub：
 * 对含"停留/缓滞"的关键帧序列，出段时速度平滑建立，无匀速感突变。
 * 数据不必全局单调（俯仰波动也能用），只需节点 x 严格递增。 */
function createMonotoneCubicSampler(keys: ReadonlyArray<readonly [number, number]>) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  // 每段 secant 斜率
  const ds: number[] = [];
  for (let i = 0; i < n - 1; i++) ds.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  // 节点切线（FC 限制：相邻段斜率异号 → 0；同号 → 加权调和平均）
  const ms: number[] = new Array(n);
  ms[0] = ds[0];
  ms[n - 1] = ds[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (ds[i - 1] * ds[i] <= 0) {
      ms[i] = 0;
    } else {
      const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
      const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
      ms[i] = (w1 + w2) / (w1 / ds[i - 1] + w2 / ds[i]);
    }
  }
  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    // 三次 Hermite 基函数
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[i] + h10 * h * ms[i] + h01 * ys[i + 1] + h11 * h * ms[i + 1];
  };
}

export function createPlaceholderShip(container: HTMLElement): PlaceholderShip {
  const M = ACT2.model;
  const R = ACT2.rotation;
  const RV = ACT2.reveal;
  const D = ACT2.dialogue;
  const SP = ACT2.spin;

  // 关键帧采样器（构建一次；yaw 单调、pitch 波动，同一算法均适用）
  const sampleYaw = createMonotoneCubicSampler(RV.yawKeys);
  const samplePitch = createMonotoneCubicSampler(RV.pitchKeys);

  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let renderer: THREE.WebGLRenderer;
  let modelGroup: THREE.Group | null = null;
  /** 仅承载入场缩放/上浮（fit 缩放），与旋转组分离避免互相覆盖 */
  let fitGroup: THREE.Group | null = null;
  let baseFitScale = 1;
  /** 模型原始包围盒高度（世界单位，入场下沉量按此换算） */
  let rawHeight = 1;
  /* —— 呼吸悬浮（reveal.bob）：只写 floatGroup.position.y，独立于其他所有动画 —— */
  let floatGroup: THREE.Group | null = null;
  let bobTime = 0;   // 呼吸相位时间（秒）：仅在解锁且未拖拽时推进 → 拖拽/回锁冻结
  let bobWeight = 0; // 浮动包络 [0,1]：解锁淡入 / 回锁淡出，杜绝位置跳变
  let canvasEl: HTMLCanvasElement;

  /* —— 灯光引用（setReveal 按进度驱动强度） —— */
  let ambientLight: THREE.AmbientLight;
  let keyLight: THREE.DirectionalLight;
  let fillLight: THREE.DirectionalLight;
  let hemiLight: THREE.HemisphereLight;
  let rimLight: THREE.DirectionalLight;

  /* —— 旋转三层叠加：时间轴角（滚动）+ 用户拖拽角（永久）+ 悬停偏移（弹簧） —— */
  let tlYaw = M.initRotY;   // 时间轴偏航角（度），由 setReveal 每帧改写
  let tlPitch = M.initRotX; // 时间轴俯仰角（度）
  let userYaw = 0;          // 用户拖拽累积偏航（度），解锁后永久保留
  let userPitch = 0;        // 用户拖拽累积俯仰（度），clamp 在 [minRotX, maxRotX]
  /* 回锁归位（拖拽角 → 0）：快照 + 壁钟时间戳，指数衰减与帧率无关 */
  let relockAt = -1;        // 回锁时刻（performance.now ms；-1 = 无待衰减快照）
  let relockYaw = 0;        // 回锁瞬间的拖拽角快照
  let relockPitch = 0;
  let rafId = 0;
  let disposed = false;

  /* —— 悬停跟随状态（叠加在时间轴+拖拽角之上的瞬时偏移，会自行回弹）—— */
  let interactive = false; // 揭幕完成后（unlockAt）才响应悬停/拖拽
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let hoverX = 0; // 叠加于俯仰的偏移（度）
  let hoverY = 0; // 叠加于偏航的偏移（度）
  let hoverTargetX = 0;
  let hoverTargetY = 0;
  let hoverVelX = 0;
  let hoverVelY = 0;
  /* —— 闲置回弹：移动时 idleFade=1，停止超过 hoverIdleDelay 后
   *  在 hoverIdleFade 秒内衰减到 0，悬停目标随之归零、弹簧拉回 —— */
  let idleFade = 1;
  let lastMoveTime = 0; // 最近一次悬停移动时间（秒）

  /* —— 悬停视差（相机随光标微移，制造立体空间感）—— */
  let paraX = 0;
  let paraY = 0;
  let paraVelX = 0;
  let paraVelY = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let hasPointer = false; // 是否有上一帧光标位置（用于速度前馈）
  let camBaseX = 0;
  let camBaseY = 0;
  /** 画布逻辑尺寸（CSS 像素）：setViewOffset 的成像平移按此换算屏宽比例 */
  let viewW = 0;
  let viewH = 0;

  /* —— 阅读态（章3 角色介绍）：beginIntro 进入 / cancelIntro 退出，均为瞬时状态切换 ——
   * 无相机运动：船体保持当前姿态，拖拽/悬停/呼吸不中断；
   * introActive 保持给 act2Scene 门控标题显隐与章节回退语义。 */
  let introActive = false;

  /* —— 对话期交互（章3阅读态：点按推进 / 悬停反馈 / 轻晃）——
   * readingActive：阅读态期间开放点按/悬停反馈（与 introActive 同进同出）。
   * 命中检测：GLB 196万三角不直接 raycast，用随船旋转的隐形包围盒。
   * 点按 vs 拖拽：按下-抬起的位移与时长双阈值判定。
   * 轻晃 tapYaw：第五层独立旋转通道，弹簧衰减，与其他旋转层互不污染。 */
  let readingActive = false;
  let dialogueHandlers: DialogueHandlers = null;
  let hitBox: THREE.Mesh | null = null;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2(); // 悬停用 NDC（pointermove 时更新）
  const ndcTap = new THREE.Vector2();     // 点按用 NDC（与悬停分离防互相覆盖）
  let pointerInContainer = false;
  let hoverBoat = false;
  let downX = 0;
  let downY = 0;
  let downTime = 0;
  let downMoved = false;
  let downMaxDist = D.tapMaxDist; // 按下时按指针类型定阈值
  let tapYaw = 0;
  let tapVel = 0;
  let glowLight: THREE.PointLight | null = null;

  /* —— 卷轴阅读态自转展示（柜台式 360° 水平慢转，ACT2.spin）——
   * 独立自转通道 spinYaw，与其他旋转层并列叠加、互不污染；
   * 仅阅读态（beginIntro/cancelIntro）启停；阅读态无拖拽/悬停，纯展示；
   * 进入时若定格角被拖拽改变，先补间回定格姿势（443°）再启动自转；
   * 退出时补间回最近 360° 整数倍 = 定格基准姿势，不跳变。 */
  let spinYaw = 0;        // 自转累积角（度），始终 mod 360 保持有界
  let spinSpeed = 0;      // 当前角速度（度/秒），向 spinTarget 按 rampSec 线性渐变
  let spinTarget = 0;     // 目标角速度：0 或 SP.degPerSec
  let spinSettling = false; // 退出阅读态的回位补间进行中（期间停止速度累积）
  let spinSettleTween: gsap.core.Tween | null = null;
  let returnTween: gsap.core.Tween | null = null; // 进入阅读态时拖拽角回定格补间

  let lastTime = 0; // 上一帧时间戳（秒），用于弹簧积分

  // ---------- 占位模型构建 ----------
  function buildPlaceholderJunk(): THREE.Group {
    const group = new THREE.Group();

    /* 颜色常量（统一暖色系，呼应运河漕船质感） */
    const hullDark = new THREE.Color(0x3a2818);     // 船体深棕
    const hullLight = new THREE.Color(0x5c3a22);    // 船体上沿浅棕
    const mastWood = new THREE.Color(0x8a5a3a);     // 桅杆木色
    const sailCloth = new THREE.Color(0xd4c8a8);    // 船帆米白
    const cabinWood = new THREE.Color(0x7a4f2f);    // 船舱木色
    const detailRed = new THREE.Color(0xb34030);    // 装饰红
    const ropeTan = new THREE.Color(0xc9a86a);      // 绳索金

    /* ---------- 船体（参照通惠.png：短而弯的福船船身） ----------
     * 截面 = 底部窄 + 上沿宽 + 弧底，沿 Z 轴拉伸形成船身长度 */
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-1.7, -0.55);
    hullShape.lineTo(-2.05, 0.0);
    hullShape.lineTo(-1.5, 0.14);
    hullShape.lineTo(1.5, 0.14);
    hullShape.lineTo(2.05, 0.0);
    hullShape.lineTo(1.7, -0.55);
    hullShape.bezierCurveTo(1.2, -0.85, -1.2, -0.85, -1.7, -0.55);

    const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
      depth: 5.4,                    // 船体长度（沿 Z，随后旋转到 X）
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.12,
      bevelSegments: 3,
      curveSegments: 16,
    });
    hullGeo.center();

    const hullMat = new THREE.MeshStandardMaterial({
      color: hullDark,
      roughness: 0.75,
      metalness: 0.05,
      flatShading: false,
    });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    // 仅绕 Y 旋转 90°：挤出方向（船长 5.4）转到 X（船头朝 +X，与船尾舵 -2.8 / 旗 +2.5 对齐），
    // 截面宽度（4.1）落到 Z（船宽），截面高度保持竖直。
    // 注意不能叠加 rotation.x——会把船长转到竖直方向（船体立起来的 bug）
    hull.rotation.y = Math.PI / 2;
    hull.receiveShadow = true;     // 承接桅杆/船舱投影
    group.add(hull);

    // 船体上沿装饰条
    const deckTrimGeo = new THREE.BoxGeometry(4.0, 0.07, 5.0);
    const deckTrimMat = new THREE.MeshStandardMaterial({ color: hullLight, roughness: 0.8 });
    const deckTrim = new THREE.Mesh(deckTrimGeo, deckTrimMat);
    deckTrim.position.set(0, 0.17, 0);
    deckTrim.receiveShadow = true;
    group.add(deckTrim);

    /* ---------- 甲板 ---------- */
    const deckGeo = new THREE.BoxGeometry(3.5, 0.05, 4.6);
    const deckMat = new THREE.MeshStandardMaterial({ color: cabinWood, roughness: 0.7 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(0, 0.2, 0);
    deck.receiveShadow = true;
    group.add(deck);

    /* ---------- 中后舱（低矮、带弧顶，呼应插图船舱） ---------- */
    const cabinGeo = new THREE.BoxGeometry(2.0, 0.55, 2.2);
    const cabinMat = new THREE.MeshStandardMaterial({ color: cabinWood, roughness: 0.7 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(-0.5, 0.52, 0);
    cabin.receiveShadow = true;
    group.add(cabin);

    const roofGeo = new THREE.BoxGeometry(2.2, 0.1, 2.4);
    const roofMat = new THREE.MeshStandardMaterial({ color: hullDark, roughness: 0.6 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(-0.5, 0.85, 0);
    roof.receiveShadow = true;
    group.add(roof);

    /* ---------- 3 根桅杆（插图中主帆高耸，桅杆是视觉主体） ---------- */
    const mastMat = new THREE.MeshStandardMaterial({ color: mastWood, roughness: 0.6 });

    function makeMast(x: number, z: number, height: number): THREE.Mesh {
      const g = new THREE.CylinderGeometry(0.05, 0.08, height, 12);
      const m = new THREE.Mesh(g, mastMat);
      m.position.set(x, 0.22 + height / 2, z);
      return m;
    }

    const mastFront = makeMast(1.7, 0, 4.6);   // 前桅
    const mastMain = makeMast(0.2, 0, 6.8);    // 主桅（最高）
    const mastRear = makeMast(-1.6, 0, 4.2);   // 后桅

    group.add(mastFront, mastMain, mastRear);

    /* ---------- 硬帆（福船标志性的巨大纵帆） ----------
     * PlaneGeometry 默认在 XY 平面：X 沿船长、Y 竖直 —— 正是侧面视角，
     * 绝不能再旋转（旧代码旋转 90° 导致帆从镜头看是一条线）。
     * 用横向竹条（细 Box）压在帆面上，做出插图的骨扇感。 */
    const sailMat = new THREE.MeshStandardMaterial({
      color: sailCloth,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });
    const battenMat = new THREE.MeshStandardMaterial({ color: ropeTan, roughness: 0.8 });

    function makeSail(mast: THREE.Mesh, width: number, height: number, leanX = 0) {
      const sailGroup = new THREE.Group();

      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 8, 10), sailMat);
      cloth.position.set(leanX, 0, 0);
      cloth.userData.noCast = true; // 帆布太薄不投影（避免破影），只接收
      cloth.receiveShadow = true;
      sailGroup.add(cloth);

      // 横向竹条（6 根）
      const battens = 6;
      for (let i = 1; i <= battens; i++) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(width * 0.96, 0.035, 0.035),
          battenMat,
        );
        b.position.set(leanX, -height / 2 + (height * i) / (battens + 1), 0.02);
        sailGroup.add(b);
      }

      // 帆底部贴近甲板，顶端接近桅顶
      const baseY = 0.35;
      const tipY = mast.position.y + height / 2 - 0.35;
      sailGroup.position.set(mast.position.x, (baseY + tipY) / 2, 0);
      return sailGroup;
    }

    const sailMain = makeSail(mastMain, 3.6, 6.0, 0.25);   // 主帆最大、略前倾
    const sailFront = makeSail(mastFront, 2.6, 4.0, 0.2);
    const sailRear = makeSail(mastRear, 2.2, 3.6, 0.15);

    group.add(sailMain, sailFront, sailRear);

    /* ---------- 船头红旗 ---------- */
    const flagGeo = new THREE.PlaneGeometry(0.4, 0.3);
    const flagMat = new THREE.MeshStandardMaterial({
      color: detailRed, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(2.5, 1.05, 0);
    flag.userData.noCast = true;
    group.add(flag);

    /* ---------- 船尾舵 ---------- */
    const rudderGeo = new THREE.BoxGeometry(0.1, 0.7, 0.8);
    const rudderMat = new THREE.MeshStandardMaterial({ color: hullDark, roughness: 0.7 });
    const rudder = new THREE.Mesh(rudderGeo, rudderMat);
    rudder.position.set(-2.8, -0.1, 0);
    group.add(rudder);

    /* ---------- 两支长桨（侧面视角：自船中斜向探到画面下两角） ---------- */
    const oarMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.75 });
    function makeOar(x: number, tilt: number): THREE.Mesh {
      const g = new THREE.CylinderGeometry(0.045, 0.07, 3.4, 8);
      const m = new THREE.Mesh(g, oarMat);
      m.rotation.z = tilt; // 在侧面（XY）平面内倾斜
      m.position.set(x, -0.1, 0);
      return m;
    }
    group.add(makeOar(0.9, 0.7));
    group.add(makeOar(-0.9, -0.7));

    // 注意：build 不设置缩放/旋转——init 中按包围盒自适应尺寸，
    // 旋转挂在外层 modelGroup 上，避免与 fit 缩放互相覆盖。
    return group;
  }

  // ---------- 事件处理 ----------
  function onPointerDown(e: PointerEvent) {
    // 卷轴阅读态（无对话接线）纯自转展示：不提供拖拽/点按，按下直接忽略
    if (introActive && !dialogueHandlers) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    downTime = performance.now();
    downMoved = false;
    downMaxDist = e.pointerType === 'touch' ? D.tapMaxDistTouch : D.tapMaxDist;
    // 进入拖拽：悬停偏移目标归零，由弹簧平滑衰减（不直接清角度，避免跳变）
    hoverTargetX = 0;
    hoverTargetY = 0;
    hasPointer = false;
    container.classList.remove('is-grab');
    container.classList.add('is-grabbing');
    try { canvasEl.setPointerCapture(e.pointerId); } catch { /* 合成/无效指针忽略 */ }
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    // —— 拖拽分支：累积到用户永久角度（与时间轴角、悬停偏移三层叠加） ——
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (!downMoved && Math.hypot(e.clientX - downX, e.clientY - downY) > downMaxDist) {
        downMoved = true;
      }

      userYaw += dx * R.horizontalSensitivity;
      userPitch -= dy * R.verticalSensitivity; // 向上拖 → 增加俯角
      userPitch = Math.max(R.minRotX, Math.min(R.maxRotX, userPitch));
      return;
    }

    // —— 悬停分支：只写入瞬时偏移目标，角度由弹簧在 update() 中追 ——
    if (!interactive) return;

    // 卷轴阅读态（无对话接线）纯自转展示：关闭悬停跟随（两套旋转叠加会打架）；
    // 目标归零交给弹簧平滑回位。未来气泡阶段接线 dialogueHandlers 后不受此门控。
    if (SP.enable && introActive && !dialogueHandlers) {
      hoverTargetX = 0;
      hoverTargetY = 0;
      hasPointer = false;
      pointerInContainer = false;
      return;
    }

    const rect = container.getBoundingClientRect();
    // 守卫：容器无有效尺寸时不计算（避免除零得到 NaN 角度）
    if (rect.width < 1 || rect.height < 1) return;
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) {
      hoverTargetX = 0;
      hoverTargetY = 0;
      hasPointer = false;
      pointerInContainer = false;
      return;
    }
    pointerInContainer = true;

    // 归一化光标位置：容器中心为 0，边缘为 ±1
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    pointerNdc.set(nx, -ny);

    // 光标瞬时位移 → 速度前馈（"被拽过头"的牵拉感）；首帧不产生冲量
    let dx = 0;
    let dy = 0;
    if (hasPointer) {
      dx = e.clientX - lastPointerX;
      dy = e.clientY - lastPointerY;
    }
    hasPointer = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    const clampAbs = (v: number) => Math.max(-R.hoverClamp, Math.min(R.hoverClamp, v));
    hoverTargetY = clampAbs(nx * R.hoverYawMax + dx * R.hoverLead);
    hoverTargetX = clampAbs(-ny * R.hoverPitchMax - dy * R.hoverLead);
    // 有移动 → 重置闲置衰减（目标全量生效）
    idleFade = 1;
    lastMoveTime = performance.now() / 1000;
  }

  function onPointerLeave() {
    // 离开容器 → 目标归零，交给弹簧平滑回位
    hoverTargetX = 0;
    hoverTargetY = 0;
    hasPointer = false;
    pointerInContainer = false;
    if (hoverBoat) {
      hoverBoat = false;
      container.classList.remove('is-hover-boat');
      gsap.to(glowLight, { intensity: 0, duration: 0.6, overwrite: true });
      dialogueHandlers?.onHoverChange?.(false);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    container.classList.remove('is-grabbing');
    container.classList.add('is-grab');
    try { canvasEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    // 对话期点按判定：未拖动、未超时、命中船体 → 轻晃 + 脉冲 + 推进
    const quick = performance.now() - downTime <= D.tapMaxDur * 1000;
    if (readingActive && dialogueHandlers?.onTap && !downMoved && quick && hitBoatAt(e.clientX, e.clientY)) {
      const br = getBoatScreenRect();
      tapVel += (br && e.clientX < br.cx ? -1 : 1) * D.tapKickSpeed;
      pulseGlow(D.tapGlow);
      dialogueHandlers.onTap();
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    // 滚轮不控制旋转，由全局 scrollController 管
  }

  function bindEvents() {
    container.classList.add('is-grab');
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointerleave', onPointerLeave);
    container.addEventListener('pointercancel', onPointerLeave);
    container.addEventListener('wheel', onWheel, { passive: false });
  }

  function unbindEvents() {
    container.classList.remove('is-grab', 'is-grabbing');
    container.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointerleave', onPointerLeave);
    container.removeEventListener('pointercancel', onPointerLeave);
    container.removeEventListener('wheel', onWheel);
  }

  // ---------- 生命周期 ----------
  let initPromise: Promise<void> | null = null; // 幂等锁：重复 init 返回同一 Promise

  function init(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = new Promise<void>((resolve) => {

    // Scene —— 背景必须透明：下层是纯黑 body（#05070a）
    scene = new THREE.Scene();
    scene.background = null;

    // Camera
    const rect = container.getBoundingClientRect();
    camera = new THREE.PerspectiveCamera(M.fov, rect.width / rect.height, 0.1, 100);
    camera.position.set(0, M.cameraY, M.cameraZ);
    camera.lookAt(0, 0, 0);
    // 记录相机基准位置：悬停视差在此基础上做微移
    camBaseX = camera.position.x;
    camBaseY = camera.position.y;
    viewW = rect.width;
    viewH = rect.height;

    // Renderer —— alpha + 透明清除色；柔和阴影（产品展示质感）
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(rect.width, rect.height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    canvasEl = renderer.domElement;
    canvasEl.style.cssText = 'display:block;width:100%;height:100%;outline:none;';
    canvasEl.setAttribute('tabindex', '0');
    container.appendChild(canvasEl);
    // 揭幕未完成前不拦截指针（保证触屏滑动转场不被拖拽劫持）
    container.style.pointerEvents = 'none';

    // Lights
    ambientLight = new THREE.AmbientLight(0xffffff, M.ambient);
    scene.add(ambientLight);

    keyLight = new THREE.DirectionalLight(M.keyLightColor, M.keyLightIntensity);
    keyLight.position.set(3, 5, 4);
    /* 阴影：光本身的 castShadow 常开（避免反复开关触发着色器重编译），
     * 实际是否投影由每个 mesh 的 castShadow 在 setReveal 中按透明度控制——
     * 半透明期 mesh 一律不投影，杜绝透明材质投全黑影 */
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.left = -6;
    keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -6;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.radius = 4;
    scene.add(keyLight);

    fillLight = new THREE.DirectionalLight(M.fillLightColor, M.fillLightIntensity);
    fillLight.position.set(-4, 1.5, -2);
    scene.add(fillLight);

    hemiLight = new THREE.HemisphereLight(0xf3e8d2, 0x16202c, 0.5);
    scene.add(hemiLight);

    // 轮廓光：左后上方冷光，勾出船体背缘；强度由 setReveal 按扫掠脉冲驱动
    rimLight = new THREE.DirectionalLight(RV.rimLight.color, RV.rimLight.baseIntensity);
    rimLight.position.set(RV.rimLight.position[0], RV.rimLight.position[1], RV.rimLight.position[2]);
    scene.add(rimLight);

    // 悬停/点按微光（浅青点光；GLB 无独立水脉材质 → 以点光轻量替代，强度由对话态 tween 驱动）
    glowLight = new THREE.PointLight(0x9fd8d4, 0, 6.5, 2);
    glowLight.position.set(0, 0.6, 2.2);
    scene.add(glowLight);

    /* —— 模型装载：正式 GLB（异步）或程序化占位（usePlaceholder 开关 / 加载失败兜底）——
     * 装载完成前 modelGroup 为 null，setReveal/update 已有空守卫安全空跑；
     * 装载完成后下一帧 setReveal 按当前进度渲染正确状态（纯函数映射自愈） */
    /** 着色器预热：全 mesh（含阴影深度材质）实渲一帧，把编译开销留在预载阶段 */
    const warmupAndResolve = () => {
      modelGroup?.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      renderer.render(scene, camera);
      modelGroup?.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = false; });
      resolve();
    };

    const setupModel = (raw: THREE.Object3D) => {
      /* —— 尺寸自适应：按模型包围盒投影到屏幕的高度反推缩放 ——
       * 可见视口（相机处）：visH = 2·tan(fov/2)·cameraZ
       * 目标：模型高 = 屏高 × screenHeightRatio，且宽 ≤ 屏宽 × maxWidthRatio
       * 0.96 安全系数：旋转过程中投影尺寸会波动，预留余量防裁切 */
      raw.updateMatrixWorld(true);

      /* —— 浏览器端补平滑法线：GLB 无烘焙顶点法线 → 三角硬边 + 光照计算错误 ——
       *  1) mergeVertices 合并重合顶点，使相邻三角面共享顶点才能算出平滑过渡
       *  2) computeVertexNormals 基于合并后的顶点位置重新计算逐顶点平滑法线
       *  仅在首次加载执行，开销约几秒（196 万三角高模），之后 geometry 常驻
       *  —— 美工补上贴图绑定 + 真正法线后可直接删除此段 —— */
      let fixedMeshes = 0;
      raw.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          const g = mesh.geometry;
          if (!g.hasAttribute('normal')) {
            try {
              const merged = mergeVertices(g);
              merged.computeVertexNormals();
              mesh.geometry.dispose();
              mesh.geometry = merged;
              fixedMeshes++;
            } catch { /* 兜底：万一 mergeVertices 对某些几何报错，跳过不崩 */ }
          } else {
            g.computeVertexNormals(); // 即使有 NORMAL 也重算，防止顶点未合并导致 per-face 硬边
          }
        }
      });
      if (fixedMeshes) console.log(`[act2] 自动补上了 ${fixedMeshes} 个 mesh 的平滑法线（GLB 未烘焙）`);

      const bbox = new THREE.Box3().setFromObject(raw);
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      rawHeight = size.y;

      const visH = 2 * Math.tan(THREE.MathUtils.degToRad(M.fov) / 2) * M.cameraZ;
      const visW = visH * camera!.aspect;
      const fitH = (visH * M.screenHeightRatio) / size.y;
      const fitW = (visW * M.maxWidthRatio) / size.x;
      baseFitScale = Math.min(fitH, fitW) * 0.96 * M.scale;

      // raw 平移使包围盒中心在原点 → fitGroup 缩放/上浮 → modelGroup 旋转
      raw.position.set(-center.x, -center.y, -center.z);
      fitGroup = new THREE.Group();
      fitGroup.scale.setScalar(baseFitScale * RV.entrance.fromScale);
      fitGroup.add(raw);
      modelGroup = new THREE.Group();
      modelGroup.add(fitGroup);
      modelGroup.rotation.y = THREE.MathUtils.degToRad(M.initRotY);
      modelGroup.rotation.x = THREE.MathUtils.degToRad(M.initRotX);
      // 层级：scene → floatGroup(呼吸浮动) → modelGroup(旋转) → fitGroup(入场) → raw
      // 呼吸只写 floatGroup.position.y；旋转/入场/拖拽各写各的节点，互不覆盖
      floatGroup = new THREE.Group();
      floatGroup.add(modelGroup);
      scene.add(floatGroup);
      floatGroup.position.x = -0.4;  // 负 = 往左

      // 隐形命中盒：比包围盒略宽，随船旋转，点按/悬停射线只打它（避免 196 万三角高模）
      const hbGeo = new THREE.BoxGeometry(size.x * D.hitInflate, size.y * D.hitInflate, size.z * D.hitInflate);
      const hbMat = new THREE.MeshBasicMaterial({ visible: false });
      hitBox = new THREE.Mesh(hbGeo, hbMat);
      hitBox.userData.noCast = true;
      fitGroup.add(hitBox);

      // 初始 opacity=0，由 setReveal 按进度驱动。
      // 注意：材质可能被多个 mesh 共享（GLB 同理），traverse 会对同一材质
      // 访问多次——只能在首次遇到时记录设计不透明度，否则会把清零后的 0 当成基值
      modelGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          if (mat.userData.baseOpacity === undefined) {
            mat.userData.baseOpacity = mat.opacity;
          }
          mat.transparent = true;
          mat.opacity = 0;
          mat.depthWrite = false; // 全模型透明淡入期间避免深度排序瑕疵
          obj.receiveShadow = true; // 自阴影与占位船一致（投影开关仍由 setReveal 控制 castShadow）
          // 材质中和：GLB 无环境贴图，金属件在直接光下会发黑；美工彩色版交付后可经配置关闭
          const fix = M.materialFix;
          if (fix.enable && mat.metalness > fix.maxMetalness) {
            mat.metalness = fix.maxMetalness;
            mat.roughness = Math.max(mat.roughness, fix.minRoughness);
          }
        }
      });
    };

    if (M.usePlaceholder) {
      setupModel(buildPlaceholderJunk());
      warmupAndResolve();
    } else {
      new GLTFLoader().load(
        M.glbUrl,
        (gltf) => {
          if (!disposed) { setupModel(gltf.scene); warmupAndResolve(); }
          else resolve();
        },
        (ev) => { onProgress?.(ev.loaded, ev.total); },
        (err) => {
          console.error('[act2] 通惠船 GLB 加载失败，回退程序化占位模型:', err);
          if (!disposed) { setupModel(buildPlaceholderJunk()); warmupAndResolve(); }
          else resolve();
        },
      );
    }

    bindEvents();
    renderer.render(scene, camera);
    }); // Promise executor close
    return initPromise;
  }

  /* ---------- 自转回位补间：把 spinYaw 补间到最近的 360° 整数倍 ----------
   * 视觉上等价于回到定格基准姿势（443°），只消化自转通道的余角，
   * 不触碰 tlYaw/userYaw 等其他旋转层。spinYaw ∈ [0,360)，目标非 0 即 360。 */
  function settleSpinYaw() {
    spinSettling = true;
    spinSpeed = 0;
    const target = spinYaw > 180 ? 360 : 0;
    const proxy = { v: spinYaw };
    spinSettleTween = gsap.to(proxy, {
      v: target,
      duration: SP.settleSec,
      ease: 'power2.inOut',
      onUpdate: () => { spinYaw = proxy.v; },
      onComplete: () => { spinYaw = 0; spinSettling = false; spinSettleTween = null; },
    });
  }

  /* ---------- 进入阅读态：无相机运动，原地开启对话 ----------
   * 阅读态关闭拖拽与悬停跟随（纯自转展示），呼吸浮动保留；
   * 若定格展示态被用户拖拽改变了角度：先补间回定格姿势（443°），到位后再启动自转；
   * onSettled 立即回调，act2Scene 并行淡出标题/按钮、激活卷轴。 */
  function beginIntro(onSettled?: () => void): boolean {
    if (!modelGroup || !fitGroup || !camera || !interactive) return false;
    if (introActive) return false; // 已在阅读态：拒绝重入
    introActive = true;
    readingActive = true;
    container.classList.remove('is-grab'); // 阅读态无拖拽，光标不显示抓手
    if (SP.enable) {
      // 若退出回位补间尚未播完：杀 tween，从当前角直接接力（姿势连续无跳变）
      spinSettleTween?.kill();
      spinSettleTween = null;
      spinSettling = false;
      spinSpeed = 0;
      returnTween?.kill();
      if (Math.abs(userYaw) > 0.01 || Math.abs(userPitch) > 0.01) {
        // 定格角被拖拽改变过：先平滑回 443° 基准姿势，到位后再启动自转
        const proxy = { yaw: userYaw, pitch: userPitch };
        returnTween = gsap.to(proxy, {
          yaw: 0,
          pitch: 0,
          duration: SP.returnSec,
          ease: 'power2.inOut',
          onUpdate: () => { userYaw = proxy.yaw; userPitch = proxy.pitch; },
          onComplete: () => {
            userYaw = 0; userPitch = 0; returnTween = null;
            spinTarget = SP.degPerSec;
          },
        });
      } else {
        returnTween = null;
        spinTarget = SP.degPerSec; // 已在定格姿势：直接缓入自转
      }
    }
    onSettled?.();
    return true;
  }

  /* ---------- 气泡对话页：自转暂停 / 恢复（章4） ----------
   * 暂停：目标速度归零 → update 里按 rampSec 包络自然减速，
   *       同时把已转过的余角补间回最近 360° 整数倍（= 定格基准姿势），
   *       保证每次进入对话页船都停在同一姿态，之后只剩呼吸起伏。
   * 恢复：若回位补间未播完，从当前角直接接力继续慢转（姿势连续）。 */
  function setAutoSpin(on: boolean) {
    if (!SP.enable) return;
    if (on) {
      if (spinSettling) {
        spinSettleTween?.kill();
        spinSettleTween = null;
        spinSettling = false;
        spinYaw = spinYaw % 360;
        spinSpeed = 0;
      }
      spinTarget = SP.degPerSec;
      return;
    }
    spinTarget = 0;
    if (spinYaw !== 0 && !spinSettling) settleSpinYaw();
  }

  /* ---------- 退出阅读态（回滚离开展示段）：同步关闭，无回位动画 ---------- */
  function cancelIntro() {
    if (!introActive) return;
    readingActive = false; // 先关对话交互（悬停射线/微光由 update 下一帧自然清理）
    introActive = false;
    container.classList.add('is-grab');
    // 自转停止：补间回最近 360° 整数倍（= 定格基准姿势），不跳变
    if (SP.enable) {
      spinTarget = 0;
      returnTween?.kill(); // 回位途中退出：停在当前角（展示态允许保留拖拽角）
      returnTween = null;
      if (spinYaw !== 0 && !spinSettling) settleSpinYaw();
    }
  }

  function update() {
    if (!modelGroup || !floatGroup || disposed) return;

    const now = performance.now() / 1000;
    const dt = lastTime === 0 ? 1 / 60 : Math.min(0.05, Math.max(0.001, now - lastTime));
    lastTime = now;

    /* —— 闲置回弹：停止移动超过 hoverIdleDelay 后，
     *  悬停目标按 hoverIdleFade 时长衰减到 0（只缩放目标，不改原始目标，
     *  下次移动会整体重置为 1，弹簧负责把姿态平滑拉回）—— */
    if (now - lastMoveTime > R.hoverIdleDelay) {
      idleFade = Math.max(0, idleFade - dt / Math.max(0.05, R.hoverIdleFade));
    }
    const effTargetY = hoverTargetY * idleFade;
    const effTargetX = hoverTargetX * idleFade;

    /* —— 悬停弹簧（半隐式欧拉）：位置跟随给方向感，
     *  速度前馈给"被拽过头"的牵拉感，阻尼让回弹自然 —— */
    hoverVelY += ((effTargetY - hoverY) * R.hoverStiffness - hoverVelY * R.hoverDamping) * dt;
    hoverY += hoverVelY * dt;
    hoverVelX += ((effTargetX - hoverX) * R.hoverStiffness - hoverVelX * R.hoverDamping) * dt;
    hoverX += hoverVelX * dt;

    /* —— 点按轻晃（对话期反馈）：第五层旋转，欠阻尼弹簧自然收敛 —— */
    if (tapYaw !== 0 || tapVel !== 0) {
      tapVel += (-tapYaw * D.tapSpringK - tapVel * D.tapSpringC) * dt;
      tapYaw += tapVel * dt;
      if (Math.abs(tapYaw) < 0.001 && Math.abs(tapVel) < 0.001) { tapYaw = 0; tapVel = 0; }
    }

    /* —— 自转展示（卷轴阅读态）：速度按 rampSec 线性包络渐变（启停无突兀），
     *  dt 积分帧率无关；回位补间进行中（spinSettling）时角度由 tween 驱动，不再累积 —— */
    if (SP.enable) {
      if (!spinSettling && (spinSpeed !== 0 || spinTarget !== 0)) {
        const rate = SP.degPerSec / Math.max(0.05, SP.rampSec); // 度/秒²
        if (spinSpeed < spinTarget) spinSpeed = Math.min(spinTarget, spinSpeed + rate * dt);
        else if (spinSpeed > spinTarget) spinSpeed = Math.max(spinTarget, spinSpeed - rate * dt);
        spinYaw = (spinYaw + spinSpeed * dt) % 360;
      }
    }

    /* —— 对话期悬停探测：射线只打隐形命中盒；进出边缘切换光标/微光并回调 —— */
    if (readingActive && dialogueHandlers && !dragging && pointerInContainer && hitBox) {
      raycaster.setFromCamera(pointerNdc, camera);
      const hit = raycaster.intersectObject(hitBox, false).length > 0;
      if (hit !== hoverBoat) {
        hoverBoat = hit;
        container.classList.toggle('is-hover-boat', hit);
        gsap.to(glowLight, { intensity: hit ? D.hoverGlow : 0, duration: hit ? 0.45 : 0.6, overwrite: true });
        dialogueHandlers.onHoverChange?.(hit);
      }
    } else if (hoverBoat) {
      hoverBoat = false;
      container.classList.remove('is-hover-boat');
      gsap.to(glowLight, { intensity: 0, duration: 0.6, overwrite: true });
      dialogueHandlers?.onHoverChange?.(false);
    }

    /* —— 回锁归位：重新进入时间轴阶段后，拖拽角按壁钟时间指数衰减归零 ——
     * 时间戳基准（非帧积分）：数值只依赖真实流逝时间，rAF 节流/后台标签页
     * 也能在一次更新内跳到正确衰减值，无跳变、无停滞；
     * 保证每次经过旋转展示都从同一角度开始、定格在同一姿态（刷新亦然）；
     * 仅在未解锁时生效，解锁期间的自由拖拽不受任何重置 */
    if (!interactive && relockAt >= 0 && (userYaw !== 0 || userPitch !== 0)) {
      const f = Math.exp(-(performance.now() - relockAt) / 1000 / 0.25);
      if (f < 0.001) { // ≈1.7s 后彻底归零（残余 <0.07°，视觉不可感知）
        userYaw = 0;
        userPitch = 0;
        relockAt = -1;
      } else {
        userYaw = relockYaw * f;
        userPitch = relockPitch * f;
      }
    }

    /* —— 姿态合成：时间轴角 + 用户拖拽角 + 悬停偏移 + 点按轻晃 + 阅读态自转（五层独立、互不污染）—— */
    modelGroup.rotation.y = THREE.MathUtils.degToRad(tlYaw + userYaw + hoverY + tapYaw + spinYaw);
    modelGroup.rotation.x = THREE.MathUtils.degToRad(tlPitch + userPitch + hoverX);
    // 增益：水平偏移带来的轻微侧倾（复用已平滑的 hoverY，不再额外起弹簧）
    modelGroup.rotation.z = THREE.MathUtils.degToRad(
      hoverY * (R.hoverRoll / R.hoverYawMax),
    );

    /* —— 增益：光标视差。由悬停偏移换算相机微移，再经独立弹簧平滑，
     *  制造轻微环绕/空间感 —— */
    const paraTargetX = hoverY * (R.parallaxX / R.hoverYawMax);
    const paraTargetY = hoverX * (R.parallaxY / R.hoverPitchMax);
    paraVelX += ((paraTargetX - paraX) * R.parallaxStiffness - paraVelX * R.parallaxDamping) * dt;
    paraX += paraVelX * dt;
    paraVelY += ((paraTargetY - paraY) * R.parallaxStiffness - paraVelY * R.parallaxDamping) * dt;
    paraY += paraVelY * dt;
    camera.position.x = camBaseX + paraX;
    camera.position.y = camBaseY + paraY;
    camera.lookAt(0, 0, 0);

    /* —— 阅读态成像平移（shift lens）——
     * 船体世界坐标完全不动：焦距、俯角、眼点→船的相对关系都与定格态一致，
     * 再用 camera.setViewOffset 把成像窗口横移，船就平移到画面右侧。
     * setViewOffset 只改主点位置、属于纯二维平移，因此船的宽高比与轮廓逐像素不变；
     * 对比物理右移：船离开光轴会被透视压缩（实测宽度 −9%），这才是「变瘪」的根因。
     * 偏移量按屏宽比例给（SCROLL.boatViewShiftPct），任意窗口尺寸下位置一致。 */
    const viewShiftX = scrollShift.x;
    if (Math.abs(viewShiftX) > 1e-4) {
      // 负 offsetX = 成像窗口左移 = 物体在画面中右移
      camera.setViewOffset(viewW, viewH, -viewShiftX * viewW, 0, viewW, viewH);
    } else if (camera.view?.enabled) {
      camera.clearViewOffset();
    }

    /* —— 呼吸悬浮（解锁定格后）：轻微正弦上下浮动，船静静悬浮水面的呼吸感 ——
     * 相位仅在"已解锁且未拖拽"时推进：拖拽 = 冻结相位（偏移恒定完全静止，不干扰操作）；
     * 包络权重向 interactive ? 1 : 0 平滑趋近：解锁淡入 / 回锁淡出，均无位置跳变；
     * 时间基于 dt 积分，帧率无关；幅度按模型最终显示高度换算（构图不受窗口尺寸影响） */
    const BOB = RV.bob;
    if (interactive && !dragging) bobTime += dt;
    const bobTarget = interactive ? 1 : 0;
    bobWeight += (bobTarget - bobWeight) * (1 - Math.exp(-dt / Math.max(0.05, BOB.easeTau)));
    const bobAmp = BOB.heightRatio * rawHeight * baseFitScale;
    floatGroup.position.y =
      Math.sin((bobTime / BOB.period) * Math.PI * 2) * bobAmp * bobWeight
      + scrollShift.y; // 阅读态下沉偏移叠加在呼吸位移之上（互不覆盖）

    renderer.render(scene, camera);
  }

  /* ---------- 揭幕时间轴 ----------
   * 传入第二幕整体进度 ∈ [0,1]，纯函数映射到所有视觉状态：
   * 反向滚动按相同区间恢复，任意跳转结果一致。 */
  function setReveal(p: number) {
    if (!modelGroup || !fitGroup) return;
    const g = Math.min(1, Math.max(0, p));
    const E = RV.entrance;

    /* —— 阶段 A 入场：两段分离 ——
     * 质感转化（fadeStart–fadeEnd）：opacity 线性渐显，与 2D 船同位置渐隐交叠
     * 上浮落定（moveStart–moveEnd）：位置 easeOutCubic 移到屏幕中心展示位；
     * 缩放独立线性（由小变大全程可感）——easeOutCubic 前段极快会让船一露出
     * 就已达最终大小的 88%，视觉上等于没有大小变化，故缩放与位置解耦 —— */
    const tE = g <= E.fadeStart
      ? 0
      : g >= E.fadeEnd
        ? 1
        : (g - E.fadeStart) / (E.fadeEnd - E.fadeStart);
    const tM = g <= E.moveStart
      ? 0
      : g >= E.moveEnd
        ? 1
        : (g - E.moveStart) / (E.moveEnd - E.moveStart);
    const easedM = 1 - Math.pow(1 - tM, 3);

    modelGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        const base = typeof mat.userData.baseOpacity === 'number' ? mat.userData.baseOpacity : 1;
        mat.opacity = base * tE;
        // 半透明期关深度写入避免排序瑕疵；实心部件完全显形后恢复
        mat.depthWrite = mat.opacity >= 0.99;
        // 半透明材质会投全黑影：入场未完成前一律不投影
        obj.castShadow = !obj.userData.noCast && tE >= 1;
      }
    });
    // 缩放：线性走满 moveStart–moveEnd 全程，"由小变大"在上升期间持续可感
    fitGroup.scale.setScalar(
      baseFitScale * (E.fromScale + (1 - E.fromScale) * tM),
    );
    // 起始位置对齐 2D 大船（屏幕偏下），随上浮落定移到屏幕中心（easeOutCubic）
    fitGroup.position.y = -E.fromYRatio * rawHeight * baseFitScale * (1 - easedM);

    /* —— 阶段 B：时间轴姿态（关键帧曲线，非匀速 360°）—— */
    tlYaw = sampleYaw(g);
    tlPitch = samplePitch(g);

    /* —— 阶段 C：灯光 —— 主光组入场爬坡 + 轮廓光扫掠脉冲 —— */
    const LR = RV.lightRamp;
    const tL = g <= LR[0] ? 0 : g >= LR[1] ? 1 : (g - LR[0]) / (LR[1] - LR[0]);
    const ramp = 0.45 + 0.55 * tL;
    ambientLight.intensity = M.ambient * ramp;
    keyLight.intensity = M.keyLightIntensity * ramp;
    fillLight.intensity = M.fillLightIntensity * ramp;
    hemiLight.intensity = 0.5 * ramp;
    let rim = RV.rimLight.baseIntensity;
    for (const pulse of RV.rimLight.pulses) {
      const d = (g - pulse.center) / pulse.width;
      rim += pulse.peak * Math.exp(-d * d);
    }
    rimLight.intensity = rim;

    /* —— 阶段 D：交互权交接 —— 定格后交给用户；反向滚回则时间轴重新独占 —— */
    const wasInteractive = interactive;
    interactive = g >= RV.unlockAt;
    container.style.pointerEvents = interactive ? 'auto' : 'none';
    if (!interactive) {
      hoverTargetX = 0;
      hoverTargetY = 0;
      hasPointer = false;
      // 回锁瞬间快照拖拽角 + 壁钟时间：此后按指数时间戳衰减（帧率无关）
      if (wasInteractive) {
        relockAt = performance.now();
        relockYaw = userYaw;
        relockPitch = userPitch;
      }
    }
  }

  function resize() {
    if (!camera || !renderer) return;
    const rect = container.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    viewW = rect.width;
    viewH = rect.height;
    renderer.setSize(rect.width, rect.height, false);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    initPromise = null; // 允许销毁后重新 init（幂等锁复位）
    cancelAnimationFrame(rafId);
    unbindEvents();
    introActive = false;
    readingActive = false;
    dialogueHandlers = null;
    spinSettleTween?.kill();
    spinSettleTween = null;
    returnTween?.kill();
    returnTween = null;
    hoverBoat = false;
    hitBox = null;
    if (glowLight) { gsap.killTweensOf(glowLight); glowLight.intensity = 0; }

    // 呼吸悬浮：随整棵层级一起移除；状态归零防复用叠加（update 已停，无残留动画）
    if (floatGroup) {
      scene.remove(floatGroup);
      floatGroup = null;
      bobTime = 0;
      bobWeight = 0;
    }

    if (modelGroup) {
      modelGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }

    if (renderer) {
      renderer.dispose();
      if (canvasEl && canvasEl.parentElement === container) container.removeChild(canvasEl);
    }

    scene = null as any;
    camera = null as any;
    renderer = null as any;
    modelGroup = null;
    canvasEl = null as any;
  }

  /* ---------- 对话期：命中测试 / 屏幕包围盒 / 微光脉冲 ---------- */

  /** 点按位置是否命中船体（射线只打隐形命中盒，随船姿态旋转） */
  function hitBoatAt(clientX: number, clientY: number): boolean {
    if (!hitBox || !camera) return false;
    const r = container.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    ndcTap.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    raycaster.setFromCamera(ndcTap, camera);
    return raycaster.intersectObject(hitBox, false).length > 0;
  }

  /** 船体当前屏幕包围盒（世界包围盒 8 角投影；气泡布局锚定用） */
  function getBoatScreenRect() {
    if (!modelGroup || !camera || !canvasEl) return null;
    // 手动构建包围盒，跳过 hitBox（userData.noCast）等辅助不可见对象
    // 避免隐形命中盒撑大包围盒导致气泡/提示被定位到屏幕外
    const wb = new THREE.Box3();
    modelGroup.traverse((obj) => {
      if ((obj as THREE.Object3D).userData?.noCast) return;
      const anyObj = obj as any;
      if ((anyObj.isMesh || anyObj.isLineSegments || anyObj.isLine || anyObj.isSprite) && anyObj.geometry) {
        const geo = anyObj.geometry as THREE.BufferGeometry;
        // 确保包围盒已计算
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (geo.boundingBox) {
          const worldBox = geo.boundingBox.clone().applyMatrix4(obj.matrixWorld);
          wb.union(worldBox);
        }
      }
    });
    if (wb.isEmpty()) return null;
    const cr = canvasEl.getBoundingClientRect();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    const v = new THREE.Vector3();
    for (const x of [wb.min.x, wb.max.x]) {
      for (const y of [wb.min.y, wb.max.y]) {
        for (const z of [wb.min.z, wb.max.z]) {
          v.set(x, y, z).project(camera);
          const sx = cr.left + ((v.x + 1) / 2) * cr.width;
          const sy = cr.top + ((1 - v.y) / 2) * cr.height;
          l = Math.min(l, sx); r = Math.max(r, sx);
          t = Math.min(t, sy); b = Math.max(b, sy);
        }
      }
    }
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, cx: (l + r) / 2, cy: (t + b) / 2 };
  }

  /** 微光脉冲：瞬时升到 peak 后回落到当前应有强度（悬停中回 hoverGlow，否则回 0） */
  function pulseGlow(peak: number) {
    if (!glowLight) return;
    gsap.timeline()
      .to(glowLight, { intensity: peak, duration: 0.12, ease: 'power2.out' }, 0)
      .to(glowLight, {
        intensity: hoverBoat ? D.hoverGlow : 0,
        duration: 0.9, ease: 'power2.inOut',
      }, 0.12);
  }

  /** 收束反馈（第五组后再点按）：柔和呼吸式光涌一次，不推进对话 */
  function closingPulse() {
    if (!glowLight) return;
    gsap.killTweensOf(glowLight);
    gsap.timeline()
      .to(glowLight, { intensity: D.closeGlow, duration: 0.7, ease: 'sine.inOut' }, 0)
      .to(glowLight, {
        intensity: hoverBoat ? D.hoverGlow : 0,
        duration: 1.6, ease: 'sine.inOut',
      }, 0.7);
  }

  /* —— 卷轴阶段船体让位（右移 + 略下沉，与卷轴构图协调）——
   * 横向：船体世界坐标不动，tween 的是「成像平移量」scrollShift.x，
   *       update 里交给 camera.setViewOffset 做纯二维横移，因此轮廓与定格态完全一致；
   * 纵向：不能直接 tween floatGroup.position.y（呼吸每帧写 y），改为 tween 独立 offset，
   *       在 update 里叠加到呼吸位移上。两者都用同一段 GSAP 补间，进退对称。 */
  const scrollShift = { x: 0, y: 0 };
  function shiftForScroll(enable: boolean) {
    if (!floatGroup) return;
    gsap.killTweensOf(scrollShift);
    gsap.to(scrollShift, {
      x: enable ? SCROLL.boatViewShiftPct : 0,
      y: enable ? SCROLL.boatShiftYWorld : 0,
      duration: SCROLL.boatShiftDur,
      ease: 'power2.out',
    });
  }

  /** 对话期事件接线（act2Scene 注入；null 关闭并清理悬停/微光状态） */
  function setDialogueHandlers(h: DialogueHandlers) {
    dialogueHandlers = h;
    if (!h && hoverBoat) {
      hoverBoat = false;
      container.classList.remove('is-hover-boat');
      if (glowLight) gsap.to(glowLight, { intensity: 0, duration: 0.4, overwrite: true });
    }
  }

  return {
    init,
    update,
    setReveal,
    resize,
    dispose,
    beginIntro,
    cancelIntro,
    setAutoSpin,
    setDialogueHandlers,
    getBoatScreenRect,
    closingPulse,
    shiftForScroll,
    get modelGroup() { return modelGroup; },
    get introActive() { return introActive; },
  };
}
