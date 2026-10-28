import { faultChance, FORMATS, LOGOS, PACK_STYLES, TIERS, unitCost, type Logo } from '../sim';
import { data, state, subscribe, update } from '../state';
import { drawLabel, drawLogo } from '../view/label';
import { clear, h } from './dom';

const SWATCHES = ['#3a6df0', '#ff4fa3', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#f4f4f5', '#18181b', '#d8b56a'];

function logoIcon(logo: Logo): HTMLCanvasElement {
  const c = h('canvas', { width: 40, height: 40 });
  drawLogo(c.getContext('2d')!, logo, 20, 20, 13, '#e9e6f2');
  return c;
}

export function mountBranding(root: HTMLElement): void {
  const preview = h('canvas.label-preview', { width: 384, height: 640, 'aria-label': 'Label preview' });
  const name = h('input', {
    type: 'text', maxLength: 24, value: state.product.brand.name, 'aria-label': 'Product name',
    oninput: (e: Event) => update((p) => { p.brand.name = (e.target as HTMLInputElement).value; }, 'brand'),
  });
  const colour = h('input', {
    type: 'color', value: state.product.brand.labelColour, 'aria-label': 'Label colour',
    oninput: (e: Event) => update((p) => { p.brand.labelColour = (e.target as HTMLInputElement).value; }, 'brand'),
  });
  const swatches = h('div.swatches', {}, ...SWATCHES.map((c) => h('button.sw', {
    style: `background:${c}`, 'aria-label': `Colour ${c}`,
    onclick: () => update((p) => { p.brand.labelColour = c; }, 'brand'),
  })));
  const formats = h('div.chips', { role: 'radiogroup', 'aria-label': 'Format' });
  const formatNote = h('p.fine');
  const styles = h('div.chips');
  const logos = h('div.logos');
  const tiers = h('div.chips');
  const priceVal = h('b');
  const price = h('input', {
    type: 'range', min: 3, max: 60, step: 0.5, value: String(state.product.brand.price), 'aria-label': 'Price',
    oninput: (e: Event) => update((p) => { p.brand.price = Number((e.target as HTMLInputElement).value); }, 'brand'),
  });
  const economics = h('div.econ');

  root.append(
    h('div.brand-grid', {},
      h('div', {},
        h('label', {}, 'Name', name),
        h('div.field', {}, h('span', {}, 'Format'), formats, formatNote),
        h('label', {}, 'Label colour', h('div.row', {}, colour, swatches)),
        h('div.field', {}, h('span', {}, 'Packaging style'), styles),
        h('div.field', {}, h('span', {}, 'Logo'), logos),
        h('div.field', {}, h('span', {}, 'Tier'), tiers),
        h('label', {}, h('span', {}, 'Price ', priceVal, ' credits'), price),
        economics,
      ),
      h('div.preview-col', {}, preview, h('p.fine', {}, 'Live label, also shown on the 3D device.')),
    ),
  );

  const render = () => {
    const b = state.product.brand;
    if (document.activeElement !== name) name.value = b.name;
    if (document.activeElement !== colour) colour.value = b.labelColour;
    if (document.activeElement !== price) price.value = String(b.price);
    priceVal.textContent = b.price.toFixed(1);

    clear(formats);
    for (const f of FORMATS) {
      const on = (b.format ?? 'refillable') === f;
      formats.append(h('button.chip', { class: on ? 'on' : '', role: 'radio', 'aria-checked': String(on), onclick: () => update((p) => { p.brand.format = f; }, 'brand') }, f));
    }
    const fc = faultChance(state.product);
    formatNote.textContent = (b.format === 'disposable'
      ? 'Half the build cost, so big margins. But '
      : 'Sturdy hardware. ') + `About ${Math.round(fc * 100)}% of units come back faulty at the ${b.tier} tier.`;
    formatNote.classList.toggle('bad', fc >= 0.1);

    clear(styles);
    for (const s of PACK_STYLES) {
      styles.append(h('button.chip', { class: s === b.style ? 'on' : '', onclick: () => update((p) => { p.brand.style = s; }, 'brand') }, s));
    }
    clear(logos);
    for (const l of LOGOS) {
      logos.append(h('button.logo-btn', {
        class: l === b.logo ? 'on' : '', 'aria-label': `Logo ${l}`, title: l,
        onclick: () => update((p) => { p.brand.logo = l; }, 'brand'),
      }, logoIcon(l)));
    }
    clear(tiers);
    for (const t of TIERS) {
      tiers.append(h('button.chip', { class: t === b.tier ? 'on' : '', onclick: () => update((p) => { p.brand.tier = t; }, 'brand') }, t));
    }

    const cost = unitCost(state.product, data);
    const margin = b.price - cost.total;
    clear(economics);
    economics.append(
      h('div', {}, h('span.muted', {}, 'Unit cost'), h('b', {}, `${cost.total.toFixed(2)} cr`)),
      h('div', {}, h('span.muted', {}, 'Margin'), h('b', { class: margin > 0 ? 'good' : 'bad' }, `${margin.toFixed(2)} cr`)),
      h('div.fine', {}, `base ${cost.base} · notes ${cost.notes} · tuning ${cost.tuning} · pack ${cost.packaging}`),
    );
    drawLabel(preview, b, state.product.notes, data);
  };
  subscribe(render);
  render();
}
