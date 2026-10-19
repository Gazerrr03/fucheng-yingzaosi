// 营建构件目录：经典关卡和自定义模式共用。方位偏好与讲解见 docs/玩法需求_v2.md 第 3 节。

export type BuildingGroup = '城防' | '官署' | '坛庙' | '市井' | '水利';

/** 八方：以城心为原点。center 指离城心很近（城中）。 */
export type Dir = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** 放置约束 */
export type Placement =
  | 'land' //        陆地（非水、非城墙）
  | 'onWall' //      替换一段城墙（城门、角楼、水门）
  | 'nearGate' //    陆地，紧贴城门
  | 'nearWall' //    陆地，紧贴城墙
  | 'shore' //       陆地，紧贴江河湖塘
  | 'canal'; //      陆地，城内城外皆可（水渠）

export interface BuildingDef {
  id: string;
  name: string;
  /** 地图上的单字标记 */
  glyph: string;
  group: BuildingGroup;
  placement: Placement;
  /** 是否算作城墙线（参与围合判定） */
  wallish?: boolean;
  /** 是否算作水面（护城河） */
  waterish?: boolean;
  /** 全城最多几座；不填不限 */
  max?: number;
  /** 视图里的高度（相对值）和屋顶颜色 */
  height: number;
  roof: string;
  /** 一句话讲解（选中构件时显示） */
  about: string;
}

export const BUILDINGS: BuildingDef[] = [
  // 城防
  { id: 'wall', name: '城墙', glyph: '垣', group: '城防', placement: 'land', wallish: true, height: 0.5, roof: '#8d8577',
    about: '夯土包砖。明代府城城墙周回多在 4～12 里之间，围合成闭环才算成城。' },
  { id: 'gate', name: '城门', glyph: '门', group: '城防', placement: 'onWall', wallish: true, height: 1.1, roof: '#4a4f57',
    about: '开在城墙上。明代府城多为四门，也有因山水而开三门、五门、六门的。' },
  { id: 'wengcheng', name: '瓮城', glyph: '瓮', group: '城防', placement: 'nearGate', height: 0.6, roof: '#7a7266',
    about: '城门外再围一圈小城，敌人破了外门还要被困在「瓮」里。保定四门皆有瓮城。' },
  { id: 'jiaolou', name: '角楼', glyph: '角', group: '城防', placement: 'onWall', wallish: true, height: 1.0, roof: '#4a4f57',
    about: '城墙转角上的楼，两面瞭望，补转角的射击死角。' },
  { id: 'ditai', name: '敌台', glyph: '台', group: '城防', placement: 'nearWall', height: 0.7, roof: '#7a7266',
    about: '突出城墙外的墩台，守军可从侧面射击攻城之敌。无险可守的一面最需要。' },
  // 官署
  { id: 'fushu', name: '府署', glyph: '府', group: '官署', placement: 'land', max: 1, height: 1.0, roof: '#3f4550',
    about: '知府治事之所，一城之首。明代府城府署多居城中或偏北，坐北朝南。' },
  { id: 'xianshu', name: '县署', glyph: '县', group: '官署', placement: 'land', max: 2, height: 0.8, roof: '#4a4f57',
    about: '附郭县的县衙，与府署同城，多在府署之侧。' },
  { id: 'gulou', name: '钟鼓楼', glyph: '鼓', group: '官署', placement: 'land', max: 2, height: 1.4, roof: '#3f4550',
    about: '晨钟暮鼓，为全城报时，多在城中十字街口或府署之前。' },
  // 坛庙
  { id: 'xuegong', name: '学宫', glyph: '学', group: '坛庙', placement: 'land', max: 1, height: 0.9, roof: '#5a3d2b',
    about: '府学与文庙合一，前有泮池。方志常记「学宫在治东南」，东南巽位主文运。' },
  { id: 'chenghuang', name: '城隍庙', glyph: '隍', group: '坛庙', placement: 'land', max: 1, height: 0.8, roof: '#5a3d2b',
    about: '城隍是一城的守护神，明初定制府州县皆立城隍庙，与官署一阴一阳相表里。' },
  { id: 'sheji', name: '社稷坛', glyph: '社', group: '坛庙', placement: 'land', max: 1, height: 0.3, roof: '#9a8c6a',
    about: '祭土神与谷神。洪武初定制：府州县社稷坛设于城西北。' },
  { id: 'shanchuan', name: '山川坛', glyph: '川', group: '坛庙', placement: 'land', max: 1, height: 0.3, roof: '#9a8c6a',
    about: '风云雷雨山川坛，祭境内山川。洪武制设于城南。' },
  { id: 'litan', name: '厉坛', glyph: '厉', group: '坛庙', placement: 'land', max: 1, height: 0.25, roof: '#8a7f68',
    about: '祭无祀孤魂。洪武制设于城北郊外。' },
  { id: 'shuyuan', name: '书院', glyph: '院', group: '坛庙', placement: 'land', max: 2, height: 0.7, roof: '#5a3d2b',
    about: '士人讲学之所，多择山水清幽处，常近学宫。' },
  { id: 'kuixing', name: '魁星楼', glyph: '魁', group: '坛庙', placement: 'land', max: 1, height: 1.5, roof: '#5a3d2b',
    about: '奉魁星，主科举文运。宜在城东南高处，与学宫相望。' },
  { id: 'louge', name: '楼阁', glyph: '楼', group: '坛庙', placement: 'land', max: 2, height: 1.7, roof: '#3f4550',
    about: '登临望远的名楼，如武昌黄鹤楼、襄阳仲宣楼，多据山头或城角临水。' },
  // 市井
  { id: 'shisi', name: '市肆', glyph: '市', group: '市井', placement: 'land', height: 0.55, roof: '#6d5640',
    about: '商铺集市。《考工记》说「面朝后市」；明清府城的市多依城门、码头与水路。' },
  { id: 'minju', name: '民居坊', glyph: '坊', group: '市井', placement: 'land', height: 0.45, roof: '#5d5a55',
    about: '坊巷民居，宜连片、避水患，不宜上陡山。' },
  // 水利
  { id: 'matou', name: '码头', glyph: '埠', group: '水利', placement: 'shore', height: 0.25, roof: '#6d5640',
    about: '泊船装卸之所。临江府城的粮盐百货多由码头入城。' },
  { id: 'shuimen', name: '水门', glyph: '闸', group: '水利', placement: 'onWall', wallish: true, height: 0.9, roof: '#4a4f57',
    about: '城墙上的过水门，引护城河水入城，兼通舟楫。' },
  { id: 'moat', name: '护城河', glyph: '濠', group: '水利', placement: 'nearWall', waterish: true, height: 0, roof: '#4f7f8f',
    about: '城外绕城的人工河道，与城墙合称「城池」。' },
  { id: 'qu', name: '水渠', glyph: '渠', group: '水利', placement: 'canal', waterish: true, height: 0, roof: '#4f7f8f',
    about: '人工开挖的渠道，城内称内河。按住拖动连续开挖；接上江河、湖塘、护城河才有活水。' },
];

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));
export const BUILDING_GROUPS: BuildingGroup[] = ['城防', '官署', '坛庙', '市井', '水利'];

export const DIR_NAME: Record<Dir, string> = {
  N: '北', NE: '东北', E: '东', SE: '东南', S: '南', SW: '西南', W: '西', NW: '西北',
};
/** 后天八卦方位 */
export const DIR_GUA: Record<Dir, string> = {
  N: '坎', NE: '艮', E: '震', SE: '巽', S: '离', SW: '坤', W: '兑', NW: '乾',
};
