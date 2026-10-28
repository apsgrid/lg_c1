import { describeRequirement } from '../sim';
import { data, state, subscribe } from '../state';
import { clear, h } from './dom';

export function mountJournal(root: HTMLElement): void {
  const list = h('div.journal');
  const head = h('p.hint');
  root.append(head, list);

  const render = () => {
    const found = state.discovered.length;
    head.textContent = `${found} of ${data.synergies.length} synergies discovered. Hidden pairings reveal themselves through test results and customer comments.`;
    clear(list);
    for (const syn of data.synergies) {
      const known = state.discovered.includes(syn.id);
      if (!known) {
        list.append(h('div.jentry.locked', {}, h('b', {}, '??? '), h('span.muted', {}, 'Undiscovered pairing')));
        continue;
      }
      const bonus = Object.entries(syn.bonus).map(([k, v]) => `${k} +${v}`).join(', ');
      list.append(h('div.jentry', {},
        h('b', {}, `✦ ${syn.name}`),
        h('div.quote', {}, syn.hint),
        h('div.fine', {}, `Needs: ${syn.needs.map((r) => describeRequirement(r, data)).join(' + ')} (15+ pts each)`),
        h('div.fine', {}, `Bonus: ${bonus}`),
      ));
    }
  };
  subscribe((reason) => { if (reason === 'result' || reason === 'reset') render(); });
  render();
}
