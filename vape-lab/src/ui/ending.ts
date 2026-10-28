import { districtsLed, WIN_DISTRICTS } from '../sim';
import { resetShop, shopState } from '../shopState';
import { data } from '../state';
import { h } from './dom';

/** The end of a run: you took the city, or the business went under. */
export function showEnding(kind: 'win' | 'bankrupt', text: string): void {
  if (document.querySelector('.ending')) return;
  const s = shopState.shop;
  const close = () => overlay.remove();
  const regulars = s.regulars.filter((r) => !r.gone).length;
  const overlay = h('div.ending', { role: 'dialog', 'aria-label': kind === 'win' ? 'You run the city' : 'Bankrupt' },
    h('div.ending-card', { class: kind },
      h('div.big-emoji', {}, kind === 'win' ? '👑' : '💀'),
      h('h2', {}, kind === 'win' ? `${s.name} runs the city` : 'Bankrupt'),
      h('p', {}, text),
      h('div.ending-stats', {},
        h('div', {}, h('span.muted', {}, 'Day'), h('b', {}, s.day - 1)),
        h('div', {}, h('span.muted', {}, 'Districts led'), h('b', {}, `${districtsLed(s, data).length}/${WIN_DISTRICTS}`)),
        h('div', {}, h('span.muted', {}, 'Cash'), h('b', {}, `${Math.round(s.cash)} cr`)),
        h('div', {}, h('span.muted', {}, 'Regulars'), h('b', {}, regulars)),
      ),
      kind === 'win'
        ? h('p.fine', {}, 'The rival chains will keep fighting for every district, so you can play on, or start a fresh run from the car boot.')
        : h('p.fine', {}, 'You can keep trading your way out of debt, or start again from the car boot. Your Lab formulas are kept either way.'),
      h('div.row', {},
        h('button.primary.big', { onclick: close }, kind === 'win' ? 'Keep playing' : 'Keep trading'),
        h('button.ghost', { onclick: () => { resetShop(); close(); location.reload(); } }, 'Start a new run'),
      ),
    ),
  );
  document.body.append(overlay);
}
