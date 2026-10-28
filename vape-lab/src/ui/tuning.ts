import { describeTradeOffs, TUNING_KEYS, TUNING_LABELS, type TuningKey } from '../sim';
import { state, subscribe, update } from '../state';
import { clear, h } from './dom';

const SVGNS = 'http://www.w3.org/2000/svg';
const SWEEP = 270;
const START = -135;

const DIAL_COLOUR: Record<TuningKey, string> = {
  intensity: '#ff5a5a', cooling: '#5ad7ff', smoothness: '#b48bff', vapour: '#e6e6f0', dependence: '#ffb020',
};

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

interface Dial {
  key: TuningKey;
  shown: number;
  arc: SVGPathElement;
  needle: SVGLineElement;
  text: HTMLElement;
  input: HTMLInputElement;
}

/** Five animated dials. Drag the dial or use the slider/keyboard. */
export function mountTuning(root: HTMLElement): void {
  const dials: Dial[] = [];
  const grid = h('div.dials');
  const notes = h('ul.tradeoffs');

  for (const key of TUNING_KEYS) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('dial-svg');
    const track = document.createElementNS(SVGNS, 'path');
    track.setAttribute('d', arcPath(50, 50, 38, START, START + SWEEP));
    track.setAttribute('class', 'dial-track');
    const arc = document.createElementNS(SVGNS, 'path');
    arc.setAttribute('class', 'dial-arc');
    arc.setAttribute('stroke', DIAL_COLOUR[key]);
    const needle = document.createElementNS(SVGNS, 'line');
    needle.setAttribute('x1', '50');
    needle.setAttribute('y1', '50');
    needle.setAttribute('class', 'dial-needle');
    const hub = document.createElementNS(SVGNS, 'circle');
    hub.setAttribute('cx', '50');
    hub.setAttribute('cy', '50');
    hub.setAttribute('r', '5');
    hub.setAttribute('class', 'dial-hub');
    svg.append(track, arc, needle, hub);

    const text = h('div.dial-value');
    const input = h('input', {
      type: 'range', min: 0, max: 100, step: 1, value: String(state.product.tuning[key]),
      'aria-label': TUNING_LABELS[key],
      oninput: (e: Event) => update((p) => { p.tuning[key] = Number((e.target as HTMLInputElement).value); }, 'tuning'),
    });

    // Drag around the dial face.
    const setFromPointer = (e: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      deg = Math.max(START, Math.min(START + SWEEP, deg));
      const v = Math.round(((deg - START) / SWEEP) * 100);
      update((p) => { p.tuning[key] = v; }, 'tuning');
    };
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      setFromPointer(e);
      const move = (ev: PointerEvent) => setFromPointer(ev);
      const up = () => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
    });

    const card = h('div.dial', { class: key === 'dependence' ? 'dial-risk' : '' },
      h('div.dial-face', {}, svg as unknown as Node, text),
      h('div.dial-label', {}, TUNING_LABELS[key]),
      input,
    );
    grid.append(card);
    dials.push({ key, shown: state.product.tuning[key], arc, needle, text, input });
  }

  root.append(
    h('p.hint', {}, 'Drag a dial or its slider. Every dial is a trade-off.'),
    grid,
    h('h4', {}, 'Trade-offs'),
    notes,
    h('p.fine', {}, 'Dependence rating is an abstract game stat: it lifts repeat purchases but raises reputation risk.'),
  );

  let raf = 0;
  const animate = () => {
    let moving = false;
    for (const d of dials) {
      const target = state.product.tuning[d.key];
      const diff = target - d.shown;
      if (Math.abs(diff) > 0.1) {
        d.shown += diff * 0.2;
        moving = true;
      } else d.shown = target;
      const deg = START + (d.shown / 100) * SWEEP;
      d.arc.setAttribute('d', d.shown > 0.5 ? arcPath(50, 50, 38, START, deg) : '');
      const [x, y] = polar(50, 50, 30, deg);
      d.needle.setAttribute('x2', String(x));
      d.needle.setAttribute('y2', String(y));
      d.text.textContent = String(Math.round(d.shown));
    }
    raf = moving ? requestAnimationFrame(animate) : 0;
  };

  const render = () => {
    for (const d of dials) {
      if (document.activeElement !== d.input) d.input.value = String(state.product.tuning[d.key]);
    }
    clear(notes);
    const t = describeTradeOffs(state.product.tuning);
    if (!t.length) notes.append(h('li.muted', {}, 'Balanced settings: no strong trade-offs right now.'));
    for (const x of t) notes.append(h('li', { class: `tone-${x.tone}` }, h('b', {}, `${TUNING_LABELS[x.key]}: `), x.text));
    if (!raf) raf = requestAnimationFrame(animate);
  };
  subscribe(render);
  render();
}
