// 三城对比页：七项基因 × 三座城。三城全部通关后可进入；未通关时直接访问也能看，但会提示进度。

import genes from '../../data/genes.json';
import compare from '../../data/compare.json';
import { assetUrl, fetchLevel } from '../game/assets';
import { CITIES, GENE_COUNT, cityLitGenes } from '../game/cities';
import { Progress } from '../game/progress';
import type { Nav } from './nav';

interface Cell {
  value: string;
  sub?: string;
  note?: string;
  flag?: string;
}

export async function runCompare(nav: Nav): Promise<void> {
  const progress = new Progress();
  const levels = await Promise.all(CITIES.map((c) => fetchLevel(c.id)));
  const done = levels.filter((d) => cityLitGenes(d, progress).length === GENE_COUNT).length;
  const order = compare.cities.map((id) => CITIES.find((c) => c.id === id)!);

  const cell = (c: Cell | undefined) =>
    c
      ? `<td><strong>${c.value}</strong>${c.sub ? `<small>${c.sub}</small>` : ''}${c.note ? `<p>${c.note}</p>` : ''}${c.flag ? `<i title="资料问题报告 #${c.flag}">待核</i>` : ''}</td>`
      : '<td></td>';

  const root = document.createElement('div');
  root.className = 'compare';
  root.innerHTML = `
    <header>
      <button class="back">← 三城总览</button>
      <h1>三城对比</h1>
      <p>同为明代府城，七项规划基因在三座城里各有不同的表达。${done < 3 ? `<span class="warn">（尚有 ${3 - done} 座城未通关）</span>` : ''}</p>
    </header>
    <table>
      <thead><tr><th></th>${order.map((c) => `<th><img src="${assetUrl(`ui/seal_${c.id}`)}" alt=""><span>${c.name}</span></th>`).join('')}</tr></thead>
      <tbody>
        ${compare.rows.map((row) => {
          const g = genes.find((x) => x.id === row.gene)!;
          const head = `<th><img src="${assetUrl(`ui/${g.icon}`)}" alt=""><span>${g.name}</span></th>`;
          if ('same' in row && row.same) {
            return `<tr>${head}<td colspan="3" class="same">${row.same}${row.flag ? `<i title="资料问题报告 #${row.flag}">待核</i>` : ''}</td></tr>`;
          }
          const cells = (row as { cells: Record<string, Cell> }).cells;
          return `<tr>${head}${order.map((c) => cell(cells[c.id])).join('')}</tr>`;
        }).join('')}
      </tbody>
    </table>
    <footer>数据来源：三份府城资料及对应的「明代府城规划基因」StoryMap；标「待核」处见资料问题报告。</footer>
  `;
  document.body.appendChild(root);
  root.querySelector('.back')!.addEventListener('click', () => void nav.home());
  document.body.classList.add('ready');
  await nav.arrive();
}
