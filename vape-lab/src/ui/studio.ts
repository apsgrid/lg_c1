// The Studio: talk through a visual with Claude, test-run it in three.js, plan the
// assets, then approve it for an Unreal render.
import * as THREE from 'three';
import { shopState } from '../shopState';
import { data } from '../state';
import { STUDIO_RULES, studioTurn } from '../studio/prompt';
import { ENGINE_LABEL, type EngineTarget } from '../export/engines';
import { assetPlan, shoppingList, text3dPrompts, unrealPrompt, type MeasuredProp, type RenderOptions } from '../studio/package';
import { DISTRICTS, fabSearchUrl, KIT, normalizeSpec, sketchSpec, SPOTS, type PropSpec, type Route, type ShotSpec } from '../studio/spec';
import { commitSpec, editSpec, onStudio, saveStudio, studio, type ChatTurn } from '../studio/state';
import { ALL_TARGETS, exportScene } from '../view/exportScene';
import type { StudioScene } from '../view/studioScene';
import { clear, h } from './dom';
import { offerDownload } from './download';
import { toast } from './toast';

type SampleFn = ((input: unknown, opts?: unknown) => Promise<{ text: string }>) & { json: <T>(input: unknown, opts?: unknown) => Promise<T> };
let samplePromise: Promise<SampleFn | null> | null = null;
function getSample(): Promise<SampleFn | null> {
  const host = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!host?.use) return Promise.resolve(null);
  samplePromise ??= host.use('sample').then((s) => (s as SampleFn) ?? null).catch(() => null);
  return samplePromise;
}
let claudeOff = false;

let scene: StudioScene;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shot';
const districtName = (id: string) => data.city?.find((c) => c.id === id)?.name ?? id;

let rebuildTimer = 0;
function rebuild(now = false): void {
  clearTimeout(rebuildTimer);
  if (now) scene.build(studio.spec);
  else rebuildTimer = window.setTimeout(() => scene.build(studio.spec), 120);
}

export function initStudio(s: StudioScene): void {
  scene = s;
  scene.shopProvider = () => shopState.shop;
  scene.build(studio.spec);
  onStudio((reason) => { if (reason === 'spec') rebuild(true); else if (reason === 'edit') rebuild(); });
}

// --- Chat --------------------------------------------------------------------------------

const IDEAS = [
  'Rainy 2am in the CBD, purple and teal neon, moody, low angle on the counter',
  'Cosy beach shack at dusk, warm light, surfboards and plants',
  'Gritty industrial unit, foggy, flickering strip lights, crates everywhere',
  'Shopfront on the Neon Mile in the rain, wet road reflecting the sign',
  'Premium boutique, slick and minimal, gold accents, one hero display case',
];

export function mountStudioChat(root: HTMLElement): void {
  const log = h('div.chat-log', { 'aria-live': 'polite' });
  const box = h('textarea.chat-input', { rows: 3, placeholder: 'Describe the visual you\'re after, or ask for ideas…' }) as HTMLTextAreaElement;
  const send = h('button.primary', {}, 'Send');
  const stop = h('button.ghost', { hidden: true }, 'Stop');
  const status = h('div.fine.chat-status');
  const ideas = h('div.chips.idea-chips', {}, ...IDEAS.map((t) => h('button.chip', { onclick: () => { box.value = t; box.focus(); } }, t)));
  root.append(
    h('h3', {}, 'Talk it through'),
    h('p.fine', {}, 'Describe the shot. Claude turns it into a shot spec and the preview test-runs it. Keep tweaking in plain words, then approve it for Unreal.'),
    log,
    h('div.chat-compose', {}, box, h('div.row', {}, send, stop, status)),
    h('h4', {}, 'Need a starting point?'), ideas,
  );
  let ctl: AbortController | null = null;

  const bubble = (t: ChatTurn) => h('div.bubble-row', { class: t.role },
    h('div.chat-bubble', {}, t.content, t.version ? h('button.ver-chip', { title: 'Go back to this version', onclick: () => restore(t.version!) }, `v${t.version}`) : null,
      t.note ? h('div.fine', {}, t.note) : null));
  const render = () => {
    clear(log);
    if (!studio.chat.length) log.append(h('div.empty-state', {}, 'No conversation yet. Try one of the ideas below, or describe your own.'));
    for (const t of studio.chat) log.append(bubble(t));
    log.scrollTop = log.scrollHeight;
  };
  const restore = (n: number) => {
    const v = studio.versions.find((x) => x.n === n);
    if (!v) return;
    commitSpec(v.spec, `Back to v${n}`);
    toast(`Back to version ${n}.`);
  };

  const offline = (text: string, why: string) => {
    const { spec, changes } = sketchSpec(text, studio.spec);
    const v = commitSpec(spec, text.slice(0, 60));
    studio.chat.push({ role: 'assistant', content: changes.length ? `Sketched it: ${changes.join(', ')}.` : 'I couldn\'t pick anything out of that. Try naming a district, the weather, colours, time of day, a camera angle or a prop.', version: v.n, note: why });
    saveStudio('chat');
  };

  const go = async () => {
    const text = box.value.trim();
    if (!text || ctl) return;
    box.value = '';
    studio.chat.push({ role: 'user', content: text });
    saveStudio('chat');
    render();
    const sample = claudeOff ? null : await getSample();
    if (!sample) {
      offline(text, 'Offline sketch: Claude isn\'t available in this view (open the published page in Claude to chat for real).');
      render();
      return;
    }
    ctl = new AbortController();
    send.disabled = true;
    stop.hidden = false;
    const t0 = performance.now();
    const tick = window.setInterval(() => { status.textContent = `Claude is designing the shot… ${Math.round((performance.now() - t0) / 1000)}s`; }, 500);
    status.textContent = 'Claude is designing the shot…';
    try {
      const history = studio.chat.slice(-13, -1).map((t) => ({ role: t.role, content: t.content }));
      const input = [{ role: 'user', content: STUDIO_RULES }, ...history, { role: 'user', content: studioTurn(text, studio.spec) }];
      const res = await sample.json<{ reply?: unknown; spec?: unknown }>(input, { cache: false, signal: ctl.signal });
      const spec: ShotSpec = normalizeSpec(res?.spec ?? studio.spec, studio.spec);
      const v = commitSpec(spec, text.slice(0, 60));
      studio.chat.push({ role: 'assistant', content: typeof res?.reply === 'string' && res.reply.trim() ? res.reply.trim() : 'Updated the shot.', version: v.n });
      saveStudio('chat');
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'cancelled') studio.chat.push({ role: 'assistant', content: 'Stopped.' });
      else if (code && ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) {
        claudeOff = true;
        offline(text, 'Claude isn\'t allowed for this page, so this is an offline sketch. You can allow it from the page\'s permissions.');
      } else if (code === 'rate_limited') studio.chat.push({ role: 'assistant', content: 'Claude is rate-limited right now. Give it a minute and send again.' });
      else if (code === 'invalid_json') studio.chat.push({ role: 'assistant', content: 'I couldn\'t read Claude\'s answer as a shot. Try again, or ask for a smaller change.' });
      else if (code === 'refused') studio.chat.push({ role: 'assistant', content: 'Claude declined that one. Try describing it differently.' });
      else studio.chat.push({ role: 'assistant', content: 'Something went wrong reaching Claude. Try again.' });
      saveStudio('chat');
    } finally {
      clearInterval(tick);
      ctl = null;
      send.disabled = false;
      stop.hidden = true;
      status.textContent = '';
      render();
    }
  };
  send.addEventListener('click', () => void go());
  stop.addEventListener('click', () => ctl?.abort());
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void go(); } });
  onStudio((r) => { if (r === 'chat' || r === 'spec') render(); });
  render();
}

// --- Shot (the spec, by hand) ---------------------------------------------------------------

function select<T extends string>(label: string, value: T, options: readonly T[], onChange: (v: T) => void, names?: (v: T) => string): HTMLElement {
  const s = h('select', { onchange: () => onChange(s.value as T) }, ...options.map((o) => h('option', { value: o, selected: o === value }, names ? names(o) : o.replace(/_/g, ' ')))) as HTMLSelectElement;
  return h('label.field', {}, label, s);
}
function slider(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
  const out = h('span.fine', {}, value.toFixed(2));
  const r = h('input', { type: 'range', min, max, step: (max - min) / 100, value, oninput: () => { out.textContent = Number(r.value).toFixed(2); onChange(Number(r.value)); } }) as HTMLInputElement;
  return h('label.field', {}, h('span.row', {}, label, out), r);
}
function colourIn(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const c = h('input', { type: 'color', value, oninput: () => onChange(c.value) }) as HTMLInputElement;
  return h('label.field.colour-field', {}, label, c);
}

export function mountStudioShot(root: HTMLElement): void {
  const body = h('div.studio-shot');
  root.append(body);
  const render = () => {
    clear(body);
    const s = studio.spec;
    const titleIn = h('input', { type: 'text', value: s.title, onchange: () => editSpec((x) => { x.title = titleIn.value; }) }) as HTMLInputElement;
    const signIn = h('input', { type: 'text', value: s.sign, maxlength: 32, onchange: () => editSpec((x) => { x.sign = signIn.value; }) }) as HTMLInputElement;
    const notes = h('textarea', { rows: 3, onchange: () => editSpec((x) => { x.renderNotes = notes.value; }) }, s.renderNotes) as HTMLTextAreaElement;
    const json = h('textarea.spec-json', { rows: 14, spellcheck: false }, JSON.stringify(s, null, 2)) as HTMLTextAreaElement;
    const sceneName = (v: ShotSpec['scene']) => ({ shop: 'A shop', city: 'The city', street: 'A run\'s street' }[v]);
    const rivals = shopState.shop.rivals;
    body.append(
      h('p.fine', {}, `Version ${studio.versions.at(-1)?.n ?? 1}. Edits here change the shot straight away; chat changes make a new version you can go back to.`),
      h('label.field', {}, 'Title', titleIn),
      h('div.grid2', {},
        select('Scene', s.scene, ['shop', 'city', 'street'] as const, (v) => editSpec((x) => { x.scene = v; x.camera.custom = undefined; }), sceneName),
        s.scene === 'street' ? select('Run', s.street.mode, ['firebomb', 'delivery'] as const, (v) => editSpec((x) => { x.street.mode = v; x.camera.custom = undefined; }), (v) => (v === 'firebomb' ? 'Firebomb run' : 'Night Round')) : h('span'),
        s.scene === 'street' && s.street.mode === 'firebomb' ? select('Rival', s.street.rival, rivals.map((r) => r.id), (v) => editSpec((x) => { x.street.rival = v; }), (v) => rivals.find((r) => r.id === v)?.name ?? v) : h('span'),
        s.scene === 'street' ? h('label.field', {}, 'Aftermath', h('select', { onchange: (e: Event) => editSpec((x) => { x.street.aftermath = (e.target as HTMLSelectElement).value === 'yes'; }) },
          h('option', { value: 'no', selected: !s.street.aftermath }, s.street.mode === 'firebomb' ? 'Before: fronts intact' : 'Before: porch lights on'),
          h('option', { value: 'yes', selected: s.street.aftermath }, s.street.mode === 'firebomb' ? 'After: fronts on fire' : 'After: parcels delivered'))) : h('span'),
      ),
      s.scene === 'shop' ? h('span') : h('p.fine', {}, s.scene === 'city' ? 'The city is built from your current game: districts, turf, rival stores and your places. "District" picks where the camera looks ("Looking at: room" shows the whole city).' : 'The street is laid out exactly like the run in the game. A firebomb street takes its district from the rival; a Night Round street uses the district below and your real orders when there are some.'),
      h('div.grid2', {},
        select('Setting', s.setting, ['interior', 'shopfront'] as const, (v) => editSpec((x) => { x.setting = v; })),
        select('District', s.district, DISTRICTS, (v) => editSpec((x) => { x.district = v; }), districtName),
        select('Size', s.size, ['small', 'medium', 'large'] as const, (v) => editSpec((x) => { x.size = v; })),
        select('Style', s.style, ['gritty', 'cosy', 'slick', 'premium', 'retro'] as const, (v) => editSpec((x) => { x.style = v; })),
        select('Time', s.time, ['day', 'dusk', 'night', 'late'] as const, (v) => editSpec((x) => { x.time = v; })),
        h('label.field', {}, 'Shop sign', signIn),
      ),
      h('h4', {}, 'Weather and light'),
      h('div.grid2', {},
        slider('Rain', s.weather.rain, 0, 1, (v) => editSpec((x) => { x.weather.rain = v; })),
        slider('Fog', s.weather.fog, 0, 1, (v) => editSpec((x) => { x.weather.fog = v; })),
        slider('Main light', s.lighting.key, 0, 1.5, (v) => editSpec((x) => { x.lighting.key = v; })),
        slider('Warmth', s.lighting.warmth, -1, 1, (v) => editSpec((x) => { x.lighting.warmth = v; })),
        slider('Neon', s.lighting.neon, 0, 2, (v) => editSpec((x) => { x.lighting.neon = v; })),
      ),
      h('div.row.palette-row', {},
        colourIn('Walls', s.palette.wall, (v) => editSpec((x) => { x.palette.wall = v; })),
        colourIn('Floor', s.palette.floor, (v) => editSpec((x) => { x.palette.floor = v; })),
        colourIn('Neon 1', s.palette.accent, (v) => editSpec((x) => { x.palette.accent = v; })),
        colourIn('Neon 2', s.palette.accent2, (v) => editSpec((x) => { x.palette.accent2 = v; })),
      ),
      h('h4', {}, 'Camera'),
      h('div.grid2', {},
        select('Shot', s.camera.shot, ['wide', 'medium', 'close', 'low', 'overhead'] as const, (v) => editSpec((x) => { x.camera.shot = v; x.camera.custom = undefined; })),
        select('Looking at', s.camera.focus, ['room', 'counter', 'shelves', 'door', 'window'] as const, (v) => editSpec((x) => { x.camera.focus = v; x.camera.custom = undefined; })),
        slider('Lens (mm)', s.camera.lens, 12, 135, (v) => editSpec((x) => { x.camera.lens = Math.round(v); })),
      ),
      h('div.row', {},
        h('button', { onclick: () => { const view = scene.currentView(); editSpec((x) => { x.camera.custom = view; }); toast('Saved this framing for the render.'); } }, '📷 Use the current view'),
        s.camera.custom ? h('button.ghost', { onclick: () => editSpec((x) => { x.camera.custom = undefined; }) }, 'Back to the preset') : null,
      ),
      h('p.fine', {}, 'Drag the preview to frame it by hand, then "Use the current view" so Unreal renders exactly that.'),
      h('h4', {}, `People (${s.people.length})`),
      h('div.people-list', {}, ...s.people.map((p, i) => h('div.row', {},
        h('span', {}, `${p.role} at the ${p.spot}${p.pose && p.pose !== 'stand' ? `, ${p.pose}` : ''}`),
        h('button.icon', { 'aria-label': 'Remove', onclick: () => editSpec((x) => { x.people.splice(i, 1); }) }, '×')))),
      h('div.row', {}, h('button.small', { onclick: () => editSpec((x) => { x.people.push({ role: 'customer', spot: SPOTS[x.people.length % 6], pose: 'browse' }); }) }, '+ Customer'),
        h('button.small', { onclick: () => editSpec((x) => { x.people.push({ role: 'regular', spot: 'counter' }); }) }, '+ Regular')),
      h('h4', {}, 'Render notes for Unreal'), notes,
      h('details', {}, h('summary', {}, 'Shot spec (JSON)'), json,
        h('div.row', {}, h('button.small', { onclick: () => {
          try { commitSpec(normalizeSpec(JSON.parse(json.value), studio.spec), 'Hand-edited JSON'); toast('Applied.'); } catch { toast('That isn\'t valid JSON.'); }
        } }, 'Apply JSON'))),
      h('h4', {}, 'Versions'),
      h('div.versions', {}, ...[...studio.versions].reverse().slice(0, 12).map((v) => h('button.version', { class: v.n === studio.versions.at(-1)?.n ? 'on' : '', onclick: () => commitSpec(v.spec, `Back to v${v.n}`) },
        h('b', {}, `v${v.n}`), h('span.fine', {}, v.note)))),
    );
  };
  onStudio((r) => { if (r === 'spec') render(); });
  render();
}

// --- Assets -------------------------------------------------------------------------------

const ROUTE_LABEL: Record<Route, string> = { procedural: 'Built-in', library: 'Fab library', text3d: 'Text-to-3D' };

export function mountStudioAssets(root: HTMLElement): void {
  const body = h('div.studio-assets');
  root.append(
    h('p.hint', {}, 'Choose where each prop\'s final model comes from. Built-in: the stylised model you see. Fab library: a real asset from Fab or Megascans, matched by the search words. Text-to-3D: a bespoke model generated from the prompt (Meshy or Tripo, or any tool you like).'),
    body,
  );
  const render = () => {
    clear(body);
    const s = studio.spec;
    if (!s.props.length) body.append(h('div.empty-state', {}, 'No props yet. Ask for some in the chat, or add one below.'));
    s.props.forEach((p, i) => body.append(propCard(p, i)));
    const kind = h('select', {}, ...KIT.map((k) => h('option', { value: k }, k.replace(/_/g, ' ')))) as HTMLSelectElement;
    const spot = h('select', {}, ...SPOTS.map((k) => h('option', { value: k }, k))) as HTMLSelectElement;
    body.append(h('div.add-prop', {}, h('b', {}, 'Add a prop'), h('div.row', {}, kind, spot,
      h('button.small', { onclick: () => editSpec((x) => {
        const k = kind.value as PropSpec['kind'];
        x.props.push({ id: `${k}${x.props.length + 1}`, name: k.replace(/_/g, ' '), kind: k, spot: spot.value as PropSpec['spot'], asset: { route: 'procedural' } });
      }) }, 'Add'))));
    const counts = { procedural: 0, library: 0, text3d: 0 };
    for (const p of s.props) counts[p.asset.route]++;
    body.append(h('p.fine', {}, `${counts.procedural} built-in · ${counts.library} from the library · ${counts.text3d} generated`));
  };
  const propCard = (p: PropSpec, i: number) => {
    const routeSeg = h('div.seg.route-seg', {}, ...(['procedural', 'library', 'text3d'] as Route[]).map((r) => h('button', {
      class: p.asset.route === r ? 'on' : '',
      onclick: () => editSpec((x) => {
        const q = x.props[i];
        q.asset = { route: r, query: r === 'library' ? (q.asset.query ?? q.name) : undefined, prompt: r === 'text3d' ? (q.asset.prompt ?? `${q.name}, single object, realistic PBR materials, game-ready`) : undefined };
      }),
    }, ROUTE_LABEL[r])));
    const detail = p.asset.route === 'library'
      ? (() => {
        const q = h('input', { type: 'text', value: p.asset.query ?? '', onchange: () => editSpec((x) => { x.props[i].asset.query = q.value; }) }) as HTMLInputElement;
        return h('div', {}, h('label.field', {}, 'Fab search', q), h('a.fine', { href: fabSearchUrl(p.asset.query ?? p.name), target: '_blank', rel: 'noopener' }, 'Preview this search on fab.com ↗'));
      })()
      : p.asset.route === 'text3d'
        ? (() => {
          const t = h('textarea', { rows: 3, onchange: () => editSpec((x) => { x.props[i].asset.prompt = t.value; }) }, p.asset.prompt ?? '') as HTMLTextAreaElement;
          return h('label.field', {}, 'Text-to-3D prompt (one object: shape, materials, colours, wear)', t);
        })()
        : h('p.fine', {}, 'Rendered as the stylised model from the preview.');
    return h('div.asset-card', {},
      h('div.row', {}, h('b', {}, p.name), h('span.fine', {}, `${p.kind.replace(/_/g, ' ')} · ${p.spot}`),
        h('button.icon', { 'aria-label': `Remove ${p.name}`, onclick: () => editSpec((x) => { x.props.splice(i, 1); }) }, '×')),
      routeSeg, detail);
  };
  onStudio((r) => { if (r === 'spec' || r === 'edit') render(); });
  render();
}

// --- Approve ------------------------------------------------------------------------------

function measure(): MeasuredProp[] {
  const out: MeasuredProp[] = [];
  for (const [id, obj] of scene.propNodes()) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const r = (n: number) => +n.toFixed(3);
    out.push({ id, position: [r(obj.position.x), r(obj.position.y), r(obj.position.z)], size: [r(size.x), r(size.y), r(size.z)], rotationY: r(obj.rotation.y) });
  }
  return out;
}

const TARGET_HINT: Record<EngineTarget, string> = {
  threejs: 'viewer.html: double-click to look around the scene in a browser',
  godot: 'the zip is a Godot 4.3+ project: open project.godot, press Play (a street export plays the run)',
  unreal: 'import script, asset swaps (Fab / text-to-3D) and a Movie Render Queue render, with UNREAL_PROMPT.md for Claude on your PC',
  blender: 'a script that lights and renders the scene in Cycles or Eevee',
};

export function mountStudioApprove(root: HTMLElement): void {
  const body = h('div.studio-approve');
  root.append(body);
  const render = () => {
    clear(body);
    const s = studio.spec;
    const o = studio.options;
    const targets = studio.targets;
    const shopScene = s.scene === 'shop';
    const counts = { library: shopScene ? s.props.filter((p) => p.asset.route === 'library').length : 0, text3d: shopScene ? s.props.filter((p) => p.asset.route === 'text3d').length : 0 };
    const go = h('button.primary.big', { disabled: !targets.length }, '📦 Export');
    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = 'Packaging…';
      try {
        scene.build(s);
        const plan = shopScene ? assetPlan(s, measure()) : [];
        const zipName = `${s.scene === 'shop' ? 'shot' : s.scene}-${slug(s.title)}.zip`;
        const unreal = targets.includes('unreal');
        const zip = await exportScene({
          name: zipName.replace(/\.zip$/, ''),
          scene: scene.scene, camera: scene.camera, target: scene.controls.target, renderer: scene.renderer,
          bloom: { strength: 0.6, threshold: 0.82 },
          backdrop: [s.scene === 'shop' ? s.palette.wall : '#141a30', '#09080f'],
          info: { view: 'studio', scene: s.scene, title: s.title, district: s.district, districtName: districtName(s.district), time: s.time, fog: s.weather.fog, rain: s.weather.rain, render: o, spec: s },
          targets,
          run: s.scene === 'street' ? scene.run : null,
          readme: studioReadmeLines(unreal),
          extraFiles: [
            { name: 'shot.spec.json', data: JSON.stringify(s, null, 2) },
            { name: 'assets.json', data: JSON.stringify({ shot: s.title, props: plan, people: shopScene ? s.people.map((p, i) => ({ node: `person_${i + 1}`, ...p, note: 'placeholder figure: swap for your own characters if you like' })) : [] }, null, 2) },
            ...(unreal ? [
              { name: 'UNREAL_PROMPT.md', data: unrealPrompt(s, plan, o, zipName) },
              { name: 'LIBRARY_SHOPPING_LIST.md', data: shoppingList(plan) },
              { name: 'TEXT3D_PROMPTS.md', data: text3dPrompts(plan) },
            ] : []),
          ],
        });
        const r = await offerDownload(zipName, zip);
        if (r === 'saved') {
          studio.approved.push({ title: s.title, at: new Date().toISOString(), zip: zipName, spec: s, options: { ...o } });
          saveStudio('approved');
          toast(`Exported ${zipName} for ${targets.map((t) => ENGINE_LABEL[t]).join(', ')}.`, 'gold');
        } else if (r === 'failed') toast('Couldn\'t save the package here.');
      } catch (e) {
        console.error(e);
        toast('Packaging failed. See the console.');
      } finally {
        go.disabled = !studio.targets.length;
        go.textContent = '📦 Export';
      }
    });
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      try { commitSpec(normalizeSpec(JSON.parse(await f.text())), `Loaded ${f.name}`); toast('Shot loaded.'); } catch { toast('That file isn\'t a shot spec.'); }
      fileIn.value = '';
    } }) as HTMLInputElement;
    const what = s.scene === 'city' ? `The city · ${districtName(s.district)}` : s.scene === 'street'
      ? `${s.street.mode === 'firebomb' ? 'Firebomb run' : 'Night Round'} street${s.street.aftermath ? ' (aftermath)' : ''}`
      : `${s.setting === 'interior' ? 'Inside' : 'Shopfront'} · ${districtName(s.district)} · ${s.style}`;
    body.append(
      h('div.approve-card', {},
        h('b', {}, s.title),
        h('p.fine', {}, `${what} · ${s.time}${s.weather.rain > 0.05 ? ' · rain' : ''}${s.weather.fog > 0.05 ? ' · fog' : ''} · ${s.camera.shot} shot${s.camera.custom ? ' (your framing)' : ''}`),
        shopScene ? h('p.fine', {}, `${s.props.length} props (${counts.library} from Fab, ${counts.text3d} to generate) · ${s.people.length} people`) : null,
      ),
      h('h4', {}, 'Export to'),
      h('div.targets', {}, ...ALL_TARGETS.map((t) => h('label.target', {},
        h('input', { type: 'checkbox', checked: targets.includes(t), onchange: (e: Event) => {
          const on = (e.target as HTMLInputElement).checked;
          studio.targets = ALL_TARGETS.filter((x) => (x === t ? on : studio.targets.includes(x)));
          saveStudio('approved');
        } }),
        h('span', {}, h('b', {}, ENGINE_LABEL[t]), h('span.fine', {}, TARGET_HINT[t]))))),
      targets.includes('unreal') ? h('div', {},
        h('h4', {}, 'Unreal render'),
        h('div.grid2', {},
          select('Resolution', o.resolution, ['1920x1080', '2560x1440', '3840x2160'] as const, (v) => { studio.options.resolution = v; saveStudio('options'); }),
          select('Quality', o.quality, ['draft', 'high', 'final'] as const, (v) => { studio.options.quality = v; saveStudio('options'); }),
          select('Shot type', o.motion, ['still', 'push-in'] as const, (v) => { studio.options.motion = v as RenderOptions['motion']; saveStudio('options'); }, (v) => (v === 'still' ? 'Still frame' : '5 s slow push-in')),
        )) : h('span'),
      go,
      h('div.approve-steps', {},
        h('b', {}, 'Every export has'),
        h('ol', {},
          h('li', {}, 'scene.glb: the scene exactly as previewed, with marker_* nodes for gameplay (street targets, city locations, shop spots).'),
          h('li', {}, 'scene.json: camera, lights, look, glowing parts and markers. Every engine target reads it, and a playable port can build on it.'),
          h('li', {}, 'shot.spec.json: load it back here to keep iterating.'),
          targets.includes('unreal') && (counts.library || counts.text3d) ? h('li', {}, `For Unreal: ${counts.text3d} model${counts.text3d === 1 ? '' : 's'} to generate (Meshy, Tripo or by hand) and ${counts.library} Fab asset${counts.library === 1 ? '' : 's'} to add; UNREAL_PROMPT.md walks Claude on your PC through it.`) : null,
        ),
      ),
      h('h4', {}, 'Exported shots'),
      studio.approved.length
        ? h('div.versions', {}, ...[...studio.approved].reverse().map((a) => h('button.version', { onclick: () => commitSpec(normalizeSpec(a.spec), `Reopened "${a.title}"`) },
          h('b', {}, a.title), h('span.fine', {}, `${new Date(a.at).toLocaleString()} · ${a.zip}`))))
        : h('p.fine', {}, 'None yet.'),
      h('div.row', {}, h('button.small.ghost', { onclick: () => fileIn.click() }, 'Load a shot.spec.json…'), fileIn),
    );
  };
  onStudio((r) => { if (r === 'spec' || r === 'edit' || r === 'approved') render(); });
  render();
}

function studioReadmeLines(unreal: boolean): string[] {
  return [
    'shot.spec.json  the shot (load it back into the Studio)',
    'assets.json     every prop: route (procedural / library / text3d), size, placement',
    ...(unreal ? ['UNREAL_PROMPT.md           paste to Claude on your Unreal PC', 'LIBRARY_SHOPPING_LIST.md   Fab / Megascans searches', 'TEXT3D_PROMPTS.md          prompts for generated props'] : []),
  ];
}
