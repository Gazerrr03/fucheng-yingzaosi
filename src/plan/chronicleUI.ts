// 史书界面：名号设置、营建记卷轴（竖排）、史书卷宗（历次记载）、导出图片与分享码。

import { sound } from '../audio/sound';
import type { CityVerdict } from './fengshui';
import type { Lesson } from './lessons';
import type { PlanMap } from './planMap';
import { openModal, type PlanUI } from './planScreen';
import {
  OFFICES, addToBook, composeChronicle, loadBook, loadProfile, nextRevision, saveProfile,
  type ChronicleEntry, type Profile,
} from './chronicle';
import { encodeShare, originOf } from './share';

export interface ChronicleContext {
  map: PlanMap;
  verdict: CityVerdict;
  mode: 'lesson' | 'custom';
  lesson?: Lesson;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 名号设置。first：第一次（不能取消） */
export async function askProfile(root: HTMLElement, first = false): Promise<Profile | null> {
  const p = loadProfile() ?? { name: '', office: '知府' };
  const html = `
    <span class="kicker">史书署名</span>
    <h2>${first ? '敢问大人名号' : '更改名号'}</h2>
    <p>营建记的开头与落款都会写上你的官职与名号，例如「知府栎阳谨记」。</p>
    <label>名号（十二字以内）</label>
    <input class="pf-name" maxlength="12" value="${esc(p.name)}" placeholder="例如：栎阳">
    <label>官职</label>
    <select class="pf-office">${OFFICES.map((o) => `<option ${o === p.office ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  for (;;) {
    const btn = await openModal(root, html, '落笔', ...(first ? [] : ['取消']));
    if (btn !== 0) return null;
    const name = root.querySelector<HTMLInputElement>('.pf-name')?.value.trim() ?? '';
    const office = root.querySelector<HTMLSelectElement>('.pf-office')?.value ?? '知府';
    if (name) {
      const prof = { name, office };
      saveProfile(prof);
      return prof;
    }
  }
}

/** 过关或「修成史书」时调用：问名号 → 写一卷 → 展开卷轴 */
export async function writeChronicle(ui: PlanUI, ctx: ChronicleContext): Promise<ChronicleEntry | null> {
  const profile = loadProfile() ?? (await askProfile(ui.root, true));
  if (!profile) return null;
  const revision = nextRevision(ctx.map.data.id, ctx.mode);
  const origin = ctx.mode === 'custom' ? originOf(ctx.map.data.id) : undefined;
  const entry: ChronicleEntry = {
    ...composeChronicle({ ...ctx, profile, revision, origin }),
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    layout: ctx.map.snapshot(),
    thumb: thumbnail(ui),
  };
  addToBook(entry);
  sound.stamp();
  await showScroll(ui.root, entry);
  return entry;
}

function thumbnail(ui: PlanUI): string | undefined {
  try {
    const prev = ui.view.showCompass;
    ui.view.showCompass = false;
    const url = ui.view.snapshot(480);
    ui.view.showCompass = prev;
    ui.view.invalidate();
    return url;
  } catch {
    return undefined;
  }
}

function scrollHtml(e: ChronicleEntry): string {
  return `
    <div class="scroll">
      <div class="scroll-text">
        <h3>${esc(e.title)}</h3>
        ${e.body.map((p, i) => `<p class="${i === e.body.length - 1 ? 'sign' : ''}">${esc(p)}</p>`).join('')}
      </div>
      <aside class="scroll-side">
        ${e.thumb ? `<img src="${e.thumb}" alt="">` : ''}
        <div class="seal-grade"><b>${e.grade}</b><span>风水总评 ${e.total}</span></div>
        <small>${e.mode === 'lesson' ? '经典模式' : '自定义模式'} · ${esc(e.mapName)} · 第${e.revision}卷</small>
      </aside>
    </div>`;
}

/** 展开一卷营建记 */
export async function showScroll(root: HTMLElement, e: ChronicleEntry): Promise<void> {
  const modal = root.querySelector<HTMLElement>('.plan-modal')!;
  modal.classList.add('wide');
  for (;;) {
    const btn = await openModal(root, scrollHtml(e), '收卷', '导出图片', '复制正文', ...(e.mode === 'custom' ? ['复制城池码'] : []));
    if (btn === 0) break;
    if (btn === 1) await exportImage(e);
    if (btn === 2) await copy(root, `《${e.title}》\n${e.body.join('\n')}`, '正文已复制');
    if (btn === 3) await copy(root, encodeShare(e.mapId, e.layout, e.author), '城池码已复制，可以发给同好续修');
  }
  modal.classList.remove('wide');
}

async function copy(root: HTMLElement, text: string, ok: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toastIn(root, ok);
  } catch {
    await openModal(root, `<h2>请手动复制</h2><textarea rows="6" readonly>${esc(text)}</textarea>`, '好');
  }
}

function toastIn(root: HTMLElement, text: string) {
  const t = root.querySelector<HTMLElement>('.plan-toast');
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 2200);
}

/** 史书卷宗：按时间倒序列出所有记载 */
export async function showBook(root: HTMLElement, filter?: (e: ChronicleEntry) => boolean): Promise<void> {
  for (;;) {
    const book = loadBook().filter(filter ?? (() => true));
    const profile = loadProfile();
    const html = `
      <span class="kicker">史书卷宗</span>
      <h2>${profile ? `${esc(profile.office)}${esc(profile.name)}营建录` : '营建录'}</h2>
      ${book.length ? `<ol class="book">${book.map((e, i) => `
        <li><button data-i="${i}">
          ${e.thumb ? `<img src="${e.thumb}" alt="">` : '<span class="noimg"></span>'}
          <span><b>${esc(e.title)}</b><em>${esc(e.dateText)}</em><small>${e.mode === 'lesson' ? '经典' : '自定义'} · ${esc(e.mapName)} · ${e.grade}（${e.total}）</small></span>
        </button></li>`).join('')}</ol>` : '<p>尚无记载。过关或在自定义模式里「修成史书」，就会写下一卷。</p>'}`;
    const modal = root.querySelector<HTMLElement>('.plan-modal')!;
    let picked = -1;
    const onClick = (ev: Event) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.book button');
      if (!b) return;
      picked = Number(b.dataset.i);
      modal.querySelector<HTMLButtonElement>('.actions button')!.click();
    };
    modal.addEventListener('click', onClick);
    const btn = await openModal(root, html, '合上', '更改名号');
    modal.removeEventListener('click', onClick);
    if (picked >= 0) await showScroll(root, book[picked]);
    else if (btn === 1) await askProfile(root);
    else return;
  }
}

// ---------------------------------------------------------------- 导出图片

/** 把一卷画成竖排的图片（右起竖排，仿古籍），并触发下载 */
export async function exportImage(e: ChronicleEntry): Promise<void> {
  const W = 1400, H = 900, dpr = 1;
  const cv = document.createElement('canvas');
  cv.width = W * dpr;
  cv.height = H * dpr;
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const font = getComputedStyle(document.body).fontFamily;
  // 纸
  ctx.fillStyle = '#ece2ca';
  ctx.fillRect(0, 0, W, H);
  const paper = await loadImg(`${import.meta.env.BASE_URL}assets/ui/ui_panel_paper.webp`).catch(() => null);
  if (paper) {
    ctx.globalAlpha = 0.6;
    ctx.drawImage(paper, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = '#8a3a2a';
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, W - 60, H - 60);
  ctx.lineWidth = 1;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  // 左侧：城图与等第
  const left = 70, imgW = 420;
  if (e.thumb) {
    const img = await loadImg(e.thumb).catch(() => null);
    if (img) {
      const h = (img.height / img.width) * imgW;
      ctx.drawImage(img, left, 80, imgW, h);
      ctx.strokeStyle = 'rgba(47,36,26,0.4)';
      ctx.strokeRect(left, 80, imgW, h);
    }
  }
  ctx.save();
  ctx.translate(left + 70, H - 170);
  ctx.rotate(-0.06);
  ctx.strokeStyle = '#b8322a';
  ctx.lineWidth = 4;
  ctx.strokeRect(-55, -55, 110, 110);
  ctx.fillStyle = '#b8322a';
  ctx.font = `bold 44px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(e.grade, 0, 2);
  ctx.restore();
  ctx.fillStyle = '#6b5a45';
  ctx.font = `16px ${font}`;
  ctx.textAlign = 'left';
  ctx.fillText(`风水总评 ${e.total} · ${e.mode === 'lesson' ? '经典模式' : '自定义模式'} · 第${e.revision}卷`, left + 150, H - 175);
  ctx.fillText('三府古城 · 营建记', left + 150, H - 148);

  // 右侧：竖排正文，从右往左
  const colW = 34, top = 90, bottom = H - 80, fs = 22;
  let x = W - 90;
  const column = (text: string, size: number, color: string, gapAfter = 0) => {
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let y = top;
    for (const ch of text) {
      if (y + size > bottom) {
        x -= colW;
        y = top;
      }
      // 竖排时标点放在字格右上
      const punct = /[，。、；：]/.test(ch);
      ctx.fillText(ch, x + (punct ? size * 0.3 : 0), y - (punct ? size * 0.35 : 0));
      y += size * 1.12;
    }
    x -= colW + gapAfter;
  };
  column(e.title, 30, '#2f241a', 14);
  for (let i = 0; i < e.body.length; i++) {
    if (x < left + imgW + 40) break;
    column(e.body[i], fs, i === e.body.length - 1 ? '#6b5a45' : '#2f241a', 6);
  }

  const url = cv.toDataURL('image/jpeg', 0.9);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${e.title}.jpg`;
  a.click();
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
