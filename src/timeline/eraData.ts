/**
 * 时期详情页文案与文物数据(文案原样录自 docs/timeline架构方式.docx)。
 *
 * 每个时期对应时间线上的一个结点(nodeIdx = NODES 下标):
 *   标题页:kicker(第x时期)/ name(时期名称)/ period(朝代 · 时间)
 *   卷轴页:intro 段落流(para 正文 / subhead 小标题)
 *   触发页:artifacts 数组,每件文物一张 1920×1080 整幅透明 PNG(位置美工预排)
 *   详情页:name + dynasty/size/provenance + desc;大图暂用触发键 PNG 放大占位
 *
 * bbox:文物在整幅 PNG 内的 alpha 包围盒(% 画布宽/高,PIL 实测)。
 *   复测命令:
 *   python3 -c "from PIL import Image; im=Image.open('public/assets/timeline-detail/xxx.png').convert('A' if False else 'RGBA'); print(im.getchannel('A').getbbox())"
 *
 * hasMedal:全部文物点完后是否出现勋章浮层(第一时期暂无勋章,详情页直接回时间线)。
 */

import { ASSETS } from '../config/assets';

export type EraScrollBlock =
  | { type: 'para'; text: string }
  | { type: 'subhead'; text: string };

export interface EraArtifact {
  /** 文物序号,与素材文件名对应('2-1' = timeline-icon-2-1.png) */
  id: string;
  name: string;
  /** 年代,如 '唐(618-907)' */
  dynasty?: string;
  /** 尺寸 */
  size?: string;
  /** 出土地点(仅部分文物有) */
  provenance?: string;
  /** 简介正文 */
  desc: string;
  /** 触发键整幅 PNG 路径 */
  icon: string;
  /** 文物 alpha 包围盒(% 画布,l/t/r/b) */
  bbox: { l: number; t: number; r: number; b: number };
  /** 正式详情图路径(第一时期无文物图 → undefined,详情页仅文字面板居中;
   *  第二时期 2048×2048 正方形整图即是文物,不再按 bbox 裁) */
  detailImg?: string;
}

export interface EraData {
  /** 对应 timelinePath.ts NODES 的下标 */
  nodeIdx: number;
  /** 标题页第一行:'第x时期' */
  kicker: string;
  /** 标题页第二行:时期名称 */
  name: string;
  /** 标题页第三行:朝代 · 时间 */
  period: string;
  /** 卷轴页/触发页/详情页/勋章浮层共用背景 */
  pageBg: string;
  /** 卷轴页文案流 */
  intro: EraScrollBlock[];
  /** 文物列表(第一时期仅一个触发键,点开为「河润平原」介绍,非文物) */
  artifacts: EraArtifact[];
  /** 全部点完后是否出现勋章浮层 */
  hasMedal: boolean;
}

export const ERAS: EraData[] = [
  /* ============ 第一时期 ============ */
  {
    nodeIdx: 0,
    kicker: '第一时期',
    name: '江河道渠 水运初兴',
    period: '史前至南北朝 · 约70万年前－公元581年',
    pageBg: ASSETS.eraPages[0],
    intro: [
      {
        type: 'para',
        text: '北京是大运河连接长城与草原的重要枢纽城市，坐落在群山环抱的 “北京湾” 之中，西靠太行、北倚燕山，得天独厚的地形让多条大河自西北山地向东南平原蜿蜒流淌，织就天然水系，为城市的孕育与发展奠定了根基。',
      },
      {
        type: 'para',
        text: '水，是北京文明绵延不绝的底色。早在远古时期，先民便择水而居，依托河湖沃土繁衍生息。中原农耕文明、北方草原文明在此交汇碰撞，让北京兼具南北气质。',
      },
      {
        type: 'para',
        text: '流水承载漕舟，滋养城池，也维系着文明的流转。千百年间，水系塑造城市形态，城市依托水系不断发展。人与自然和谐相依，人与城市共生共长，大运河静静流淌，见证着北京依托漕运兴起，在山河之间，成为融汇南北、连通农牧的核心枢纽。',
      },
    ],
    artifacts: [
      {
        id: '1-1',
        name: '漕运初起',
        desc: '作为边疆重要军镇的古代北京，陆路交通方面有多条大道连接中原与长城以北地区。水路交通方面，潞河（今北运河）与海河水系服务于中原物资北运，供应边疆防御军事需要。古代无论水利工程抑或水运修渠，须道法自然。汉代及以前的水利开发多在黄河流域，后逐渐南扩至珠江流域。水运方面，长江及以南地区多利用自然水系，北方偏重修建人工运渠。运河的修建尤以黄河、江淮之间最为重要，形成骨干运道。',
        icon: ASSETS.eraIcons['1-1'],
        bbox: { l: 60.0, t: 37.04, r: 68.18, b: 43.33 },
      },
      {
        id: '1-2',
        name: '河润平原',
        desc: '在大运河萌生之前，在北京小平原上，古人类已与水打交道。以七十万年前的北京猿人、一万年前的东胡林人、五千年前的雪山人为代表，北京地区古人类与河流密切共生，北京地区的文明曙光乍现。三千多年前，周王朝册封诸侯国蓟国、燕国在北京地区营城肇建，即依托永定河古河道、琉璃河。之后蓟国灭、燕都废，燕国迁都蓟城，人与水、城与河的共生关系进一步发展。',
        icon: ASSETS.eraIcons['1-2'],
        bbox: { l: 55.57, t: 51.57, r: 66.93, b: 67.96 },
      },
    ],
    hasMedal: false,
  },

  /* ============ 第二时期 ============ */
  {
    nodeIdx: 1,
    kicker: '第二时期',
    name: '渠通幽州 多元融合',
    period: '隋唐五代 · 公元581-960年',
    pageBg: ASSETS.eraPages[1],
    intro: [
      {
        type: 'para',
        text: '隋代大规模开凿运河,形成北抵涿郡(今北京)、南达明州(今宁波)的大运河体系,完成大运河的第一次全线贯通。',
      },
      {
        type: 'para',
        text: '隋唐大运河将当时的北京地区同中原、江淮地区紧密联结起来,这在北京向统一多民族国家政治中心跃升的历史进程中具有十分重要的意义。',
      },
      { type: 'subhead', text: '运贯南北' },
      {
        type: 'para',
        text: '为加强长安、洛阳与东南富庶地区和幽燕军事重镇的联系,隋代统治者在地方运河基础上开凿贯通南北的大运河,对后世产生深远影响。',
      },
      { type: 'subhead', text: '军政永济' },
      {
        type: 'para',
        text: '隋炀帝为经营北方,开凿南起黄河、北至今北京地区的永济渠,此后永济渠成为隋唐帝国向幽州运送兵员与物资的主要渠道之一。',
      },
      { type: 'subhead', text: '重镇幽州' },
      {
        type: 'para',
        text: '隋唐大运河加速了农耕文化、游牧文化、渔猎文化在幽州的汇聚,幽州的战略地位上升为一座雄踞北方的军事重镇、水陆交通中心和经济文化中心。',
      },
    ],
    artifacts: [
      {
        id: '2-1',
        name: '缠枝莲飞凤纹透腿铜镜',
        dynasty: '唐(618-907)',
        size: '径23.0,厚1.5厘米',
        desc: '镜体厚实,八出菱花形,圆钮。镜背主纹为缠枝莲花纹,于枝蔓缠绕的莲花间点缀四只凤鸟,凤鸟口衔花枝,单腿立于一朵莲花之上,扬尾展翅,翩然欲飞,形象婀娜俊美,镜背边缘以流云纹装点。鸟花争艳,柔美自然,整个镜背纹饰富丽华美,更为罕见的是凤腿制成透雕,为唐镜中的珍品。',
        icon: ASSETS.eraIcons['2-1'],
        bbox: { l: 74.11, t: 71.76, r: 84.69, b: 90.56 },
        detailImg: ASSETS.eraDetailImages['2-1'],
      },
      {
        id: '2-2',
        name: '带木柄铁锸',
        dynasty: '隋(581-618)',
        size: '通柄长91.0,头长21.0,宽16.8厘米',
        provenance: '北京市海淀区紫竹院高梁河',
        desc: '锸头为长方形,带有木柄,木柄截面为椭圆形。隋代百姓使用此类工具开凿了贯通南北的大运河,付出巨大艰辛。',
        icon: ASSETS.eraIcons['2-2'],
        bbox: { l: 20.21, t: 39.26, r: 25.31, b: 49.07 },
        detailImg: ASSETS.eraDetailImages['2-2'],
      },
      {
        id: '2-3',
        name: '黄道窑黄釉蓝斑席纹执壶',
        dynasty: '唐(618-907)',
        size: '高22.1,口径10.1,腹径15.0,底径11.3厘米',
        desc: '壶撇口卷沿,短颈,丰肩,圆腹,饼形足。肩部饰带状曲柄和短直流,另两侧有对称双系。通体施黄釉,施釉不及底。器身刻有跳刀席纹,并在肩部点缀蓝斑。胎质细密,呈灰白色。釉面有细碎开片。唐代黄釉蓝彩器主要产于河南郏县黑虎涧窑和黄道窑,除黄釉外,还有黑釉,茶叶末釉,系上饰天蓝色或月白色斑。',
        icon: ASSETS.eraIcons['2-3'],
        bbox: { l: 30.0, t: 65.19, r: 36.35, b: 79.07 },
        detailImg: ASSETS.eraDetailImages['2-3'],
      },
      {
        id: '2-4',
        name: '黄釉碾',
        dynasty: '唐(618-907)',
        size: '高5.5,长32.0,宽7.5厘米',
        desc: '碾茶工具,由碾槽、碾轮及钺形铲组成。碾槽为长方形,中间有凹槽,外壁施黄绿色釉,施釉不到底,胎质粗硬。碾轮为扁圆形,中间微鼓,有一圆孔用以安装木轴,无釉。钺形铲施黄绿色釉,边缘无釉,有明显的使用痕迹。',
        icon: ASSETS.eraIcons['2-4'],
        bbox: { l: 52.92, t: 39.63, r: 57.6, b: 44.81 },
        detailImg: ASSETS.eraDetailImages['2-4'],
      },
      {
        id: '2-5',
        name: '越窑青釉刻牡丹纹盒',
        dynasty: '唐(618-907)',
        size: '通高6.5,口径17.2厘米',
        desc: '盒扁圆形,子母口,盖微隆起,直壁,圜底。底面满釉,有十多个支烧痕。盖缘刻凹弦纹一周,盖面满刻牡丹纹。胎色灰白,胎质细腻,釉色青中泛黄,为越窑青釉的精品。盒为唐代最流行的梳妆用品盛具。越窑所在地主要在越州境内(今浙江省宁波市和绍兴市),唐代越窑工艺最为精湛。越窑青瓷明彻如冰,温润似玉。水运是瓷器运输的最佳方式,得益于大运河和海上丝绸之路,越窑瓷器实现了通江达海。',
        icon: ASSETS.eraIcons['2-5'],
        bbox: { l: 15.1, t: 38.15, r: 19.17, b: 43.89 },
        detailImg: ASSETS.eraDetailImages['2-5'],
      },
    ],
    hasMedal: true,
  },

  /* ============ 第三时期 ============ */
  {
    nodeIdx: 2,
    kicker: '第三时期',
    name: '辽金建都 漕运通济',
    period: '辽宋金 · 公元907-1279年',
    pageBg: ASSETS.eraPages[2],
    intro: [
      {
        type: 'para',
        text: '辽金与两宋时期，幽州地区从北方军事重镇向王朝都城迈进。政治中心的变化，使运河随之分为南北两个系统。金代海陵王迁都燕京后，疏浚水道积极探索和开发中都漕渠。',
      },
      { type: 'subhead', text: '建都通漕' },
      {
        type: 'para',
        text: '938年，辽太宗耶律德光升幽州为南京，利用今北运河及燕京附近水道连通漕运。1153年，金代海陵王完颜亮将都城迁至燕京。金代将河北、山东的粮食运至通州，并为解决通州至中都之间的漕粮运输问题多次修浚运河。',
      },
      { type: 'subhead', text: '四方物聚' },
      {
        type: 'para',
        text: '辽金时期，由运河、天然水道勾连而成的水路交通网，带来人员和物资的南北流动，幽州作为北方的政治、军事中心得到迅速发展，经济和文化繁荣发展，都城地位也进一步巩固。',
      },
    ],
    artifacts: [
      {
        id: '3-1',
        name: '磁州窑白地褐彩龙凤纹罐',
        dynasty: '金(1115-1234)',
        size: '高29厘米，口径18厘米，底径13厘米',
        provenance: '北京市房山区金陵遗址',
        desc: '金海陵王迁都燕京的同时将祖陵迁至房山，该罐便出土于北京房山金陵遗址，肩部绘缠枝菊瓣纹，腹部绘龙凤纹，具有金代皇家元素。',
        icon: ASSETS.eraIcons['3-1'],
        bbox: { l: 53.79, t: 55.62, r: 59.90, b: 66.69 },
        detailImg: ASSETS.eraDetailImages['3-1'],
      },
      {
        id: '3-2',
        name: '磁州窑白地褐彩龙凤纹罐',
        dynasty: '金(1115-1234)',
        size: '高29厘米，口径18厘米，底径13厘米',
        provenance: '北京市房山区金陵遗址',
        desc: '金海陵王迁都燕京的同时将祖陵迁至房山，该罐便出土于北京房山金陵遗址，肩部绘缠枝菊瓣纹，腹部绘龙凤纹，具有金代皇家元素。',
        icon: ASSETS.eraIcons['3-2'],
        bbox: { l: 15.17, t: 36.50, r: 21.24, b: 50.94 },
        detailImg: ASSETS.eraDetailImages['3-2'],
      },
      {
        id: '3-3',
        name: '湖州真石家葵花形铜镜',
        dynasty: '金(1115-1234)',
        size: '径11.5厘米',
        provenance: '北京市通州区石宗璧墓',
        desc: '湖州是宋代的铸镜中心之一，湖州石家以其世代相承、家族经营的特色成为宋代最有名的铜镜铸造作坊，标明产地和制作者名号的"湖州石家"逐渐成为湖州铜镜的商标和品牌。金代石宗璧墓出土一面铸有"湖州真正石念二叔照子"的石家镜，说明在运河畅通的时代背景下商品流通的广泛性和多元化。',
        icon: ASSETS.eraIcons['3-3'],
        bbox: { l: 63.17, t: 17.62, r: 71.98, b: 32.75 },
        detailImg: ASSETS.eraDetailImages['3-3'],
      },
      {
        id: '3-4',
        name: '石宗璧墓志',
        dynasty: '金(1115-1234)',
        size: '长70厘米，宽70厘米',
        provenance: '北京市通州区石宗璧墓',
        desc: '石宗璧墓位于北京通州区梨园镇三间房村，石宗璧墓志是通州建置得名的重要证据。据墓志记载，石宗璧墓"以大定十七年四月四日，葬于通州潞县台头村之新茔"。这是第一次在北京地区发现"通州"字样的实物。《元史·地理志》载："金改通州，取漕运通济之义，有丰备、通济、太仓，以供京师。"石宗璧墓志与史料记载相互印证，说明通州地处水陆要津，是漕粮进京的重要枢纽和物资转运基地。',
        icon: ASSETS.eraIcons['3-4'],
        bbox: { l: 22.75, t: 67.25, r: 33.78, b: 86.88 },
        detailImg: ASSETS.eraDetailImages['3-4'],
      },
    ],
    hasMedal: true,
  },
];

/** 按时间线结点下标取时期数据(未建设的时期返回 undefined → 占位页) */
export function getEraByNode(nodeIdx: number): EraData | undefined {
  return ERAS.find((e) => e.nodeIdx === nodeIdx);
}
