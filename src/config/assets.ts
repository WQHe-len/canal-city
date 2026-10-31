/**
 * 全站素材路径集中管理。
 * 约定：所有页面/场景只从这里引用素材路径，后期替换正式美术时只需：
 *  1) 用同名文件覆盖 public/assets 下的文件，或
 *  2) 修改这里的路径指向新文件。
 * 原始素材始终保留在 /pics 与 /docs，不放回原始目录。
 */

export const ASSETS = {
  /**
   * 船页专用水墨波纹底图（对应素材：pics/首页背景.png，1920×1080）。
   * 已转 WebP q80（3.0MB → 0.42MB），经 .home-bg 层 cover 铺满。
   */
  homeBg: 'assets/home-bg.webp',

  /**
   * 博物馆页专用背景（assets/museum-bg.webp，1920×1080 米色云纹纸纹）。
   * 仅第一幕博物馆场景使用（置于 #scene-museum 内，随场景整体显隐）；
   * 船页背景仍为 homeBg（.home-bg 全局底层，不受影响）。
   * 已转 WebP q80（3.50MB → 0.23MB），原 PNG 保留在 public/assets。
   */
  museumBg: 'assets/museum-bg.webp',

  /**
   * 【临时占位素材】博物馆外观图，提取自设计方案 PPT 第 4 页
   * （原文件：docs/运河上漂来一座城….pptx → ppt/media/image6.png，1022×683）。
   * 正式美术素材完成后已转码为 assets/museum.webp。
   * 已替换
   */
  museumPlaceholder: 'assets/museum.webp',

  /** 主角漕船（对应素材：pics/船.png，1920×1080 透明背景） */
  boat: 'assets/boat.webp',

  /** 水墨海浪四层，由远及近（对应素材：pics/海1.png ~ 海4.png）。
   *  已降采样至 2048×857 转 WebP（q80，保留 alpha），单张 0.07–0.16MB（原 PNG 共 8.4MB → 0.4MB）；
   *  4096px PNG 原图仅保留在 pics/，工程内旧 PNG 副本已移除 */
  seaFar: 'assets/sea-1.webp',
  seaMidFar: 'assets/sea-2.webp',
  seaMidNear: 'assets/sea-3.webp',
  seaNear: 'assets/sea-4.webp',

  /** 云层（对应素材：pics/云1.png ~ 云4.png；云4 为本轮新增，WebP 格式） */
  clouds: ['assets/cloud-1.webp', 'assets/cloud-2.webp', 'assets/cloud-3.webp', 'assets/cloud-4.webp'],

  /** 雨幕三帧（对应素材：pics/雨1.png ~ 雨3.png） */
  rains: ['assets/rain-1.webp', 'assets/rain-2.webp', 'assets/rain-3.webp'],

  /** 船页标题文字（对应素材：pics/封面标题.png，1920×1080 透明背景，左侧竖排书法+印章）。
   *  与标题背景共用同一 1920×1080 画布，叠放时保持美工内部对位 */
  titleText: 'assets/title-text.webp',

  /** 船页标题背景帧序列（对应素材：pics/标题背景图层/帧1.png ~ 帧7.png，
   *  1920×1080 透明背景，云雾翻滚的 7 个状态，播完定格末帧）。
   *  与标题文字共用同一 1920×1080 画布，叠放时保持美工内部对位。
   *  已转 WebP q80（共 4.6MB → 1.5MB，alpha 逐像素无损）；
   *  最早的一次性 GIF（无循环扩展、播放进度受浏览器时钟与缓存影响）与此前的单张
   *  静态图均已废弃：现为 GSAP 时间轴驱动的帧序列（见 motion.ts TITLE.bgFrameStep）。 */
  titleBgFrames: [
    'assets/title-bg-1.webp',
    'assets/title-bg-2.webp',
    'assets/title-bg-3.webp',
    'assets/title-bg-4.webp',
    'assets/title-bg-5.webp',
    'assets/title-bg-6.webp',
    'assets/title-bg-7.webp',
  ],

  /** 船页标题印章（对应素材：pics/印章.png，1200×800 透明背景，印面在 x373-844 / y3-770）。
   *  放在标题「城」字正下方，标题与背景完全显示后最后盖下（动画见 motion.ts TITLE.stamp*）。
   *  已转 WebP q85（0.45MB → 0.05MB），原 PNG 保留在 pics */
  stamp: 'assets/stamp.webp',

  /** 第二幕预留：IP「通惠」（pics/通惠.png）与发光河道图（pics/河道.png） */
  tonghui: 'assets/tonghui.webp',
  riverMap: 'assets/river-map.webp',

  /** 卷轴阅读页背景（3D-page-bg.png.jpg 转码为 3d-page-bg.webp，2848×1600 夜色运河全景，cover 铺满）。
   *  仅阅读态显示，与亮相页道具/浪花背景反向淡入淡出（见 act2Scene.fadeReadBackdrop） */
  readBg: 'assets/3d-page-bg.webp',

  /** 章4 角色介绍对话框 1~7（美工 PNG 2048×1536 / 组 7 为 2048×1399，已转 WebP q88 保留 alpha）。
   *  图片自带气泡造型与版面位置，正文按各组纸面正文区百分比排入（见 introDialogue GROUPS） */
  dialogueArt: [
    'assets/dialogue1.webp',
    'assets/dialogue2.webp',
    'assets/dialogue3.webp',
    'assets/dialogue4.webp',
    'assets/dialogue5.webp',
    'assets/dialogue6.webp',
    'assets/dialogue7.webp',
  ],

  /** 时间线导航页:三张背景(1920×1080,垂直堆叠拼接,河道大致连成一线)。
   *  顺序即时间顺序(从古到今):bg-1 灰暗 → bg-2 黄褐 → bg-3 青绿 */
  timelineBgs: [
    'assets/timeline/timeline-bg-1.webp',
    'assets/timeline/timeline-bg-2.webp',
    'assets/timeline/timeline-bg-3.webp',
  ],

  /** 通惠 IP 形象(pics/通惠.png 转码,2048×1536 透明 WebP,2.0MB → 0.39MB):时间线页作为
   *  「用户操作的船」,沿河道在 8 个时间结点间滑行。原 PNG 保留在 pics/。 */
  tonghuiIp: 'assets/tonghui-ip.webp',

  /** 时间线装饰层:三张背景上叠加的前景元素(花/鸟/竹),每张均为 1920×1080 整幅透明画布,
   *  位置由美工在画布内预排,铺满对应 bg 几何盒即严格对位,无需位移参数。
   *  分组规则:flower → bg-1(灰暗),birds → bg-2(黄褐),bamboo → bg-3(青绿) */
  timelineDecor: {
    flower: [
      'assets/timeline/flower-1.webp',
      'assets/timeline/flower-2.webp',
      'assets/timeline/flower-3.webp',
      'assets/timeline/flower-4.webp',
      'assets/timeline/flower-5.webp',
      'assets/timeline/flower-6.webp',
      'assets/timeline/flower-7.webp',
      'assets/timeline/flower-8.webp',
      'assets/timeline/flower-9.webp',
      'assets/timeline/flower-10.webp',
    ],
    birds: [
      'assets/timeline/birds-1.webp',
      'assets/timeline/birds-2.webp',
      'assets/timeline/birds-3.webp',
      'assets/timeline/birds-4.webp',
      'assets/timeline/birds-5.webp',
      'assets/timeline/birds-6.webp',
    ],
    bamboo: [
      'assets/timeline/bamboo-1.webp',
      'assets/timeline/bamboo-2.webp',
      'assets/timeline/bamboo-3.webp',
      'assets/timeline/bamboo-4.webp',
      'assets/timeline/bamboo-5.webp',
      'assets/timeline/bamboo-6.webp',
      'assets/timeline/bamboo-7.webp',
      'assets/timeline/bamboo-8.webp',
    ],
  },

  /** 时间线结点图标:发光灯柱(542×833 透明 PNG),底边落在结点坐标上、只向上生长,
   *  灯座周围保留地面光晕(见 timeline.css 的 .timeline-node::before / ::after) */
  timelineNode: 'assets/dot-light.webp',

  /** 时间线接缝遮罩云:复用海面场景的 cloud-1/3/4(半透明,横向宽,带 alpha 边缘),
   *  绝对定位在 bg1/bg2(y=1080)与 bg2/bg3(y=2160)接缝处,随内容滚动,全程遮盖拼缝。 */
  timelineSeamClouds: [
    'assets/cloud-4.webp',
    'assets/cloud-3.webp',
    'assets/cloud-1.webp',
  ],

  /** 时期详情页背景:每时期一张 1920×1080 整幅画布(timeline-page-x.png),
   *  卷轴页/文物触发页/文物详情页/勋章浮层共用;标题页统一用 homeBg。 */
  eraPages: [
    'assets/timeline-detail/timeline-page-1.webp',
    'assets/timeline-detail/timeline-page-2.webp',
    'assets/timeline-detail/timeline-page-3.webp',
  ],

  /** 文物触发键:1920×1080 整幅透明画布,文物位置由美工预排(alpha 包围盒实测值见 eraData.ts)。
   *  详情页大图暂无正式素材,先用触发键 PNG 按 bbox 裁出放大占位。 */
  eraIcons: {
    '1-1': 'assets/timeline-detail/timeline-icon-1-1.webp',
    '1-2': 'assets/timeline-detail/timeline-icon-1-2.webp',
    '2-1': 'assets/timeline-detail/timeline-icon-2-1.webp',
    '2-2': 'assets/timeline-detail/timeline-icon-2-2.webp',
    '2-3': 'assets/timeline-detail/timeline-icon-2-3.webp',
    '2-4': 'assets/timeline-detail/timeline-icon-2-4.webp',
    '2-5': 'assets/timeline-detail/timeline-icon-2-5.webp',
    '3-1': 'assets/timeline-detail/timeline-icon-3-1.webp',
    '3-2': 'assets/timeline-detail/timeline-icon-3-2.webp',
    '3-3': 'assets/timeline-detail/timeline-icon-3-3.webp',
    '3-4': 'assets/timeline-detail/timeline-icon-3-4.webp',
  },

  /** 时期卷轴美术:纸/上轴/下轴三张 1920×1080 整幅透明 PNG,铺满同一画布即严格对位
   *  (卷轴2.png 为三者合成参考图,不使用)。 */
  eraScroll: {
    paper: 'assets/timeline-detail/卷轴纸2.webp',
    rodTop: 'assets/timeline-detail/上轴2.webp',
    rodBottom: 'assets/timeline-detail/下轴2.webp',
  },

  /** 详情页羊皮纸:1920×1080 整幅,作为时期详情页(有/无文物图)的文字面板背景 */
  eraDetailParchment: 'assets/timeline-detail/羊皮纸.webp',

  /** 第二时期文物正式详情图:2048×2048 正方形,整图即是文物(不再像触发键那样按 bbox 裁) */
  eraDetailImages: {
    '2-1': 'assets/timeline-detail/timeline-detail-2-1.webp',
    '2-2': 'assets/timeline-detail/timeline-detail-2-2.webp',
    '2-3': 'assets/timeline-detail/timeline-detail-2-3.webp',
    '2-4': 'assets/timeline-detail/timeline-detail-2-4.webp',
    '2-5': 'assets/timeline-detail/timeline-detail-2-5.webp',
    '3-1': 'assets/timeline-detail/timeline-detail-3-1.webp',
    '3-2': 'assets/timeline-detail/timeline-detail-3-2.webp',
    '3-3': 'assets/timeline-detail/timeline-detail-3-3.webp',
    '3-4': 'assets/timeline-detail/timeline-detail-3-4.webp',
  },
} as const;
