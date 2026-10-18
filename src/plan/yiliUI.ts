// 议礼对话框：礼部书吏发问，玩家在三个选项里作答。
// 选 A 需探索模式已点亮对应方志，答出后弹方志原文；选 B 在地图上标出礼制方位（此路不通）后回到选项；选 C 记过。
// 对话框停在右下角，不遮地图，好让玩家看清选 B 时的标示。样式按策划书 §8.3：墨框纸底、动效 ≤ 200ms。

import { sound } from '../audio/sound';
import type { YiliEvent, YiliOption } from './yili';

export interface YiliDialogOptions {
  /** 某张卡是否已在探索模式点亮 */
  unlocked(card: string): boolean;
  /** 选 B 时在地图上标出礼制方位；on = false 时撤去 */
  highlight(on: boolean): void;
  /** 「去探索模式查阅」的链接 */
  exploreHref?: string;
}

/** 返回 'A' / 'C'；暂且搁置返回 null。 */
export function showYili(root: HTMLElement, ev: YiliEvent, opts: YiliDialogOptions): Promise<'A' | 'C' | null> {
  const wrap = document.createElement('div');
  wrap.className = 'yili';
  wrap.innerHTML = `
    <div class="yili-sheet" role="dialog" aria-label="${ev.title}">
      <div class="yili-seal">礼部</div>
      <span class="kicker">${ev.title}</span>
      <p class="yili-clerk"><b>礼部书吏</b>${ev.clerk}</p>
      <div class="yili-log"></div>
      <ol class="yili-choices">
        ${ev.options.map((o) => choiceHtml(o, opts)).join('')}
      </ol>
      <button class="yili-later">暂且搁置，容后再议</button>
    </div>`;
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('on'));
  sound.click();

  const log = wrap.querySelector<HTMLElement>('.yili-log')!;
  const say = (who: 'me' | 'clerk', text: string, cls = '') => {
    const p = document.createElement('p');
    p.className = `yili-line ${who} ${cls}`;
    p.innerHTML = who === 'me' ? `<b>答</b>${text}` : `<b>书吏</b>${text}`;
    log.appendChild(p);
  };

  return new Promise((resolve) => {
    const close = (result: 'A' | 'C' | null) => {
      opts.highlight(false);
      wrap.classList.remove('on');
      setTimeout(() => wrap.remove(), 200);
      resolve(result);
    };
    const finishWith = (result: 'A' | 'C', label: string) => {
      const choices = wrap.querySelector<HTMLElement>('.yili-choices')!;
      choices.innerHTML = '';
      wrap.querySelector('.yili-later')!.remove();
      const btn = document.createElement('button');
      btn.className = `yili-done ${result === 'A' ? 'ok' : 'bad'}`;
      btn.textContent = label;
      btn.addEventListener('click', () => close(result));
      choices.after(btn);
    };

    wrap.querySelector('.yili-later')!.addEventListener('click', () => close(null));
    wrap.querySelectorAll<HTMLButtonElement>('.yili-choices button[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        const opt = ev.options.find((o) => o.key === b.dataset.k)!;
        if (opt.requires && !opts.unlocked(opt.requires)) {
          b.closest('li')!.classList.add('hinted');
          return;
        }
        say('me', `「${opt.say}」`);
        if (opt.effect.retry) {
          // 改建：标出礼制方位，书吏答复后回到选项，此项划去
          opts.highlight(true);
          say('clerk', opt.reply, 'bad');
          b.disabled = true;
          b.closest('li')!.classList.add('struck');
          return;
        }
        opts.highlight(false);
        if (opt.key === 'A') {
          say('clerk', opt.reply, 'ok');
          if (ev.quote) log.insertAdjacentHTML('beforeend', `
            <blockquote class="yili-quote"><p>${ev.quote.text}</p><cite>${ev.quote.source}</cite></blockquote>`);
          sound.stamp();
          finishWith('A', opt.effect.reputation ? `存案 · 得「${opt.effect.reputation}」` : '存案');
        } else {
          say('clerk', opt.reply, 'bad');
          finishWith('C', `退下 · 记过${opt.effect.modifier ? ` ${opt.effect.modifier}` : ''}`);
        }
        log.scrollTop = log.scrollHeight;
      }),
    );
    wrap.querySelectorAll<HTMLAnchorElement>('.yili-explore').forEach((a) => a.addEventListener('click', () => opts.highlight(false)));
  });
}

function choiceHtml(o: YiliOption, opts: YiliDialogOptions): string {
  const locked = !!o.requires && !opts.unlocked(o.requires);
  const lockNote = locked
    ? `<small class="yili-lock">${o.locked ?? '尚未查得此条方志'}${opts.exploreHref ? `<a class="yili-explore" href="${opts.exploreHref}">去探索模式查阅 →</a>` : ''}</small>`
    : '';
  return `<li class="${locked ? 'locked' : ''}">
    <button data-k="${o.key}" ${locked ? 'aria-disabled="true"' : ''}><i>${o.key}</i><span><b>${o.label}</b>「${o.say}」</span></button>
    ${lockNote}</li>`;
}
