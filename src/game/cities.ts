// 三座城的总览信息与通关判定。

import genes from '../../data/genes.json';
import type { Vec2 } from '../scene/homography';
import { litGenes } from './cards';
import type { Level, LevelJSON } from './level';
import type { Progress } from './progress';

export interface CityInfo {
  id: string;
  name: string;
  /** 在总览舆图上的位置（像素） */
  overview: Vec2;
  /** 总览卡片上的一句话 */
  blurb: string;
}

export const CITIES: CityInfo[] = [
  { id: 'xiangyang', name: '襄阳府', overview: [445, 572], blurb: '汉水中游南岸，三面临水，一面接山。' },
  { id: 'jingzhou', name: '荆州府', overview: [802, 712], blurb: '长江中游北岸，城绕水、水护城。' },
  { id: 'baoding', name: '保定府', overview: [812, 158], blurb: '畿南首善之地，群山西峙，众水东潆。' },
];

export const GENE_COUNT = genes.length;

/** 只依据关卡数据（不需要底图）算某城已点亮的基因。 */
export function cityLitGenes(data: LevelJSON, progress: Progress): string[] {
  return litGenes({ data } as Level, progress.visited(data.id));
}
