// The shot spec: a structured description of a visual, written by Claude from a
// conversation (or by hand), previewed in three.js, and handed to Unreal on approval.
// Pure data + validation; no DOM, no three.js.

export const KIT = [
  'plant', 'sofa', 'armchair', 'stool', 'bench', 'neon_sign', 'arcade', 'vending', 'display_case', 'shelf_unit',
  'crate_stack', 'bin', 'umbrella_stand', 'tv', 'poster', 'rug', 'floor_lamp', 'fridge', 'car', 'bollard', 'bike',
] as const;
export type KitKind = (typeof KIT)[number];
/** Props that hang on a wall (or the shopfront) rather than standing on the floor. */
export const WALL_KINDS: KitKind[] = ['neon_sign', 'poster', 'tv'];

export const SPOTS = ['counter', 'shelves', 'door', 'window', 'centre', 'back-left', 'back-right', 'front-left', 'front-right', 'outside'] as const;
export type Spot = (typeof SPOTS)[number];

export type Route = 'procedural' | 'library' | 'text3d';
export const ROUTES: Route[] = ['procedural', 'library', 'text3d'];

export interface PartSpec {
  shape: 'box' | 'cylinder' | 'sphere' | 'cone';
  /** Metres: box [w,h,d]; cylinder/cone [radius,height,-]; sphere [radius,-,-]. */
  size: [number, number, number];
  /** Centre, metres, relative to the prop's spot on the floor. */
  at: [number, number, number];
  colour: string;
  glow?: boolean;
  rotY?: number;
}

export interface PropSpec {
  id: string;
  name: string;
  kind: KitKind | 'custom';
  spot: Spot;
  scale?: number;
  colour?: string;
  glow?: string;
  text?: string;
  rotY?: number;
  parts?: PartSpec[];
  asset: { route: Route; query?: string; prompt?: string };
}

export interface PersonSpec {
  role: 'customer' | 'regular' | 'staff';
  spot: Spot;
  pose?: 'stand' | 'browse' | 'lean' | 'sit';
  colour?: string;
}

export type SceneKind = 'shop' | 'city' | 'street';
export interface StreetSpec {
  /** The Paperboy-style firebomb run on a rival's street, or the Night Round to regulars' doors. */
  mode: 'firebomb' | 'delivery';
  /** Rival id for a firebomb street (their district sets the look). */
  rival: string;
  /** Show the result: fronts on fire / parcels on the doorsteps. */
  aftermath: boolean;
}

export interface ShotSpec {
  version: 1;
  title: string;
  /** What's being shot: a shop (interior or shopfront), the whole city, or a run's street. */
  scene: SceneKind;
  street: StreetSpec;
  setting: 'interior' | 'shopfront';
  district: string;
  size: 'small' | 'medium' | 'large';
  style: 'gritty' | 'cosy' | 'slick' | 'premium' | 'retro';
  time: 'day' | 'dusk' | 'night' | 'late';
  weather: { rain: number; fog: number };
  palette: { wall: string; floor: string; accent: string; accent2: string };
  lighting: { key: number; warmth: number; neon: number };
  camera: {
    shot: 'wide' | 'medium' | 'close' | 'low' | 'overhead';
    focus: 'counter' | 'shelves' | 'door' | 'window' | 'room';
    lens: number;
    /** A view you framed by hand in the preview (metres, Y up). */
    custom?: { position: [number, number, number]; target: [number, number, number] };
  };
  sign: string;
  people: PersonSpec[];
  props: PropSpec[];
  /** Anything for the final render the preview can't show (wet reflections, volumetrics...). */
  renderNotes: string;
}

export const DISTRICTS = ['school', 'cbd', 'neon_mile', 'church', 'uni', 'beach', 'industrial', 'market', 'suburbs', 'mall', 'hospital'];

export function defaultSpec(): ShotSpec {
  return {
    version: 1,
    title: 'Late shift in the CBD',
    scene: 'shop',
    street: { mode: 'firebomb', rival: 'cloud_kings', aftermath: false },
    setting: 'interior',
    district: 'cbd',
    size: 'medium',
    style: 'slick',
    time: 'night',
    weather: { rain: 0.4, fog: 0.15 },
    palette: { wall: '#1f2a38', floor: '#3a4250', accent: '#ff4fa3', accent2: '#3ad7ff' },
    lighting: { key: 0.7, warmth: -0.2, neon: 1 },
    camera: { shot: 'wide', focus: 'room', lens: 28 },
    sign: 'Cloud Nine',
    people: [{ role: 'staff', spot: 'counter' }, { role: 'customer', spot: 'shelves', pose: 'browse' }],
    props: [
      { id: 'plant1', name: 'Big potted plant', kind: 'plant', spot: 'front-right', asset: { route: 'library', query: 'potted monstera plant' } },
      { id: 'neon1', name: 'Neon cloud sign', kind: 'neon_sign', spot: 'back-left', text: 'open late', glow: '#ff4fa3', asset: { route: 'procedural' } },
      { id: 'arcade1', name: 'Retro arcade cabinet', kind: 'arcade', spot: 'back-right', asset: { route: 'text3d', prompt: 'A worn 1980s upright arcade cabinet, purple side art with a cartoon cloud, glowing screen, scuffed edges, game-ready, realistic PBR' } },
    ],
    renderNotes: 'Rain streaks on the window, wet pavement outside the door catching the neon.',
  };
}

// --- Validation ------------------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const colour = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const str = (v: unknown, d: string, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);
const vec3 = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;

function normPart(p: unknown): PartSpec | null {
  const o = (p ?? {}) as Record<string, unknown>;
  const size = vec3(o.size), at = vec3(o.at);
  if (!size || !at) return null;
  return {
    shape: pick(o.shape, ['box', 'cylinder', 'sphere', 'cone'] as const, 'box'),
    size: size.map((n) => Math.min(4, Math.max(0.01, Math.abs(n)))) as [number, number, number],
    at: at.map((n) => Math.min(4, Math.max(-4, n))) as [number, number, number],
    colour: colour(o.colour, '#888888'),
    glow: o.glow === true,
    rotY: clamp(o.rotY, -Math.PI * 2, Math.PI * 2, 0),
  };
}

function normProp(p: unknown, i: number, used: Set<string>): PropSpec | null {
  const o = (p ?? {}) as Record<string, unknown>;
  const kind = o.kind === 'custom' ? 'custom' : pick(o.kind, KIT, 'crate_stack');
  const parts = kind === 'custom' && Array.isArray(o.parts) ? o.parts.slice(0, 24).map(normPart).filter((x): x is PartSpec => !!x) : undefined;
  if (kind === 'custom' && !parts?.length) return null;
  let id = str(o.id, `prop${i + 1}`, 32).replace(/[^a-z0-9_]/gi, '_');
  while (used.has(id)) id += '_';
  used.add(id);
  const a = (o.asset ?? {}) as Record<string, unknown>;
  const route = pick(a.route, ROUTES, 'procedural');
  const name = str(o.name, kind === 'custom' ? 'Custom prop' : kind.replace(/_/g, ' '), 80);
  return {
    id, name, kind, spot: pick(o.spot, SPOTS, 'centre'),
    scale: clamp(o.scale, 0.3, 3, 1),
    colour: o.colour === undefined ? undefined : colour(o.colour, '#888888'),
    glow: o.glow === undefined ? undefined : colour(o.glow, '#ff4fa3'),
    text: o.text === undefined ? undefined : str(o.text, '', 40),
    rotY: clamp(o.rotY, -Math.PI * 2, Math.PI * 2, 0),
    parts,
    asset: {
      route,
      query: route === 'library' ? str(a.query, name, 100) : undefined,
      prompt: route === 'text3d' ? str(a.prompt, `${name}, single object, realistic PBR materials, game-ready`, 600) : undefined,
    },
  };
}

/** Coerce anything (Claude's JSON, a hand edit, an old save) into a valid spec. */
export function normalizeSpec(raw: unknown, base: ShotSpec = defaultSpec()): ShotSpec {
  const o = (raw ?? {}) as Record<string, unknown>;
  const w = (o.weather ?? {}) as Record<string, unknown>;
  const pal = (o.palette ?? {}) as Record<string, unknown>;
  const li = (o.lighting ?? {}) as Record<string, unknown>;
  const cam = (o.camera ?? {}) as Record<string, unknown>;
  const custom = (cam.custom ?? null) as Record<string, unknown> | null;
  const used = new Set<string>();
  const cpos = custom ? vec3(custom.position) : null, ctgt = custom ? vec3(custom.target) : null;
  const st = (o.street ?? {}) as Record<string, unknown>;
  const baseStreet = base.street ?? { mode: 'firebomb', rival: 'cloud_kings', aftermath: false };
  return {
    version: 1,
    title: str(o.title, base.title, 80),
    scene: pick(o.scene, ['shop', 'city', 'street'] as const, base.scene ?? 'shop'),
    street: {
      mode: pick(st.mode, ['firebomb', 'delivery'] as const, baseStreet.mode),
      rival: str(st.rival, baseStreet.rival, 40),
      aftermath: typeof st.aftermath === 'boolean' ? st.aftermath : baseStreet.aftermath,
    },
    setting: pick(o.setting, ['interior', 'shopfront'] as const, base.setting),
    district: pick(o.district, DISTRICTS, base.district),
    size: pick(o.size, ['small', 'medium', 'large'] as const, base.size),
    style: pick(o.style, ['gritty', 'cosy', 'slick', 'premium', 'retro'] as const, base.style),
    time: pick(o.time, ['day', 'dusk', 'night', 'late'] as const, base.time),
    weather: { rain: clamp(w.rain, 0, 1, base.weather.rain), fog: clamp(w.fog, 0, 1, base.weather.fog) },
    palette: {
      wall: colour(pal.wall, base.palette.wall), floor: colour(pal.floor, base.palette.floor),
      accent: colour(pal.accent, base.palette.accent), accent2: colour(pal.accent2, base.palette.accent2),
    },
    lighting: { key: clamp(li.key, 0, 1.5, base.lighting.key), warmth: clamp(li.warmth, -1, 1, base.lighting.warmth), neon: clamp(li.neon, 0, 2, base.lighting.neon) },
    camera: {
      shot: pick(cam.shot, ['wide', 'medium', 'close', 'low', 'overhead'] as const, base.camera.shot),
      focus: pick(cam.focus, ['counter', 'shelves', 'door', 'window', 'room'] as const, base.camera.focus),
      lens: clamp(cam.lens, 12, 135, base.camera.lens),
      custom: cpos && ctgt ? { position: cpos, target: ctgt } : undefined,
    },
    sign: str(o.sign, base.sign, 32),
    people: Array.isArray(o.people) ? o.people.slice(0, 8).map((p) => {
      const q = (p ?? {}) as Record<string, unknown>;
      return {
        role: pick(q.role, ['customer', 'regular', 'staff'] as const, 'customer'),
        spot: pick(q.spot, SPOTS, 'centre'),
        pose: pick(q.pose, ['stand', 'browse', 'lean', 'sit'] as const, 'stand'),
        colour: q.colour === undefined ? undefined : colour(q.colour, '#888888'),
      };
    }) : base.people,
    props: Array.isArray(o.props) ? o.props.slice(0, 24).map((p, i) => normProp(p, i, used)).filter((x): x is PropSpec => !!x) : base.props,
    renderNotes: typeof o.renderNotes === 'string' ? o.renderNotes.slice(0, 600) : base.renderNotes,
  };
}

export function fabSearchUrl(query: string): string {
  return `https://www.fab.com/search?q=${encodeURIComponent(query)}`;
}

// --- Offline sketching -------------------------------------------------------------------------

const COLOUR_WORDS: Record<string, string> = {
  pink: '#ff4fa3', magenta: '#ff2fbf', purple: '#9a5cff', violet: '#7a4dff', teal: '#2ad4c0', cyan: '#3ad7ff', blue: '#3a6df0',
  red: '#ff3b4a', orange: '#ff8a2a', amber: '#ffb020', gold: '#ffd27a', yellow: '#ffe14a', green: '#3ddc84', lime: '#9cff3a', white: '#f2f2f8',
};
const DISTRICT_WORDS: Array<[RegExp, string]> = [
  [/\b(cbd|city centre|office|downtown|business)\b/, 'cbd'], [/\b(club|neon mile|nightclub|bar strip|nightlife)\b/, 'neon_mile'],
  [/\b(beach|seaside|harbour|seafront)\b/, 'beach'], [/\b(industrial|warehouse|estate|factory)\b/, 'industrial'],
  [/\b(market)\b/, 'market'], [/\b(suburb|suburbs|residential)\b/, 'suburbs'], [/\b(mall|shopping centre)\b/, 'mall'],
  [/\b(uni|campus|student)\b/, 'uni'], [/\b(church)\b/, 'church'], [/\b(hospital)\b/, 'hospital'], [/\b(school)\b/, 'school'],
];

/**
 * A rough spec from plain words, used when Claude isn't available in this view.
 * Returns the new spec and a short note of what it changed.
 */
export function sketchSpec(text: string, current: ShotSpec): { spec: ShotSpec; changes: string[] } {
  const t = text.toLowerCase();
  const s: ShotSpec = JSON.parse(JSON.stringify(current));
  const changes: string[] = [];
  const set = (label: string, fn: () => void) => { fn(); changes.push(label); };
  if (/\b(night round|delivery|deliveries|delivering|parcels?)\b/.test(t)) set('Night Round street', () => { s.scene = 'street'; s.street.mode = 'delivery'; });
  else if (/\b(firebomb|fire.?bomb|drive.?by|paperboy|street run)\b/.test(t)) set('firebomb street', () => { s.scene = 'street'; s.street.mode = 'firebomb'; });
  else if (/\b(city|skyline|aerial|whole map|bird'?s.?eye)\b/.test(t)) set('the city', () => { s.scene = 'city'; });
  else if (/\b(shop|store|counter|inside|interior|shopfront|shop front)\b/.test(t)) set('a shop', () => { s.scene = 'shop'; });
  if (/\b(on fire|burning|aftermath|in flames|delivered)\b/.test(t)) set('aftermath', () => { s.street.aftermath = true; });
  for (const [id, re] of [['cloud_kings', /cloud kings/], ['mist_co', /mist/], ['puff_palace', /puff palace/]] as const) if (re.test(t)) set(`rival ${id}`, () => { s.street.rival = id; });
  for (const [re, id] of DISTRICT_WORDS) if (re.test(t)) { set(`district: ${id}`, () => { s.district = id; }); break; }
  if (/\b(outside|exterior|shopfront|shop front|street|facade)\b/.test(t)) set('shopfront', () => { s.setting = 'shopfront'; });
  else if (/\b(inside|interior)\b/.test(t)) set('interior', () => { s.setting = 'interior'; });
  if (/\b(no rain|dry)\b/.test(t)) set('dry', () => { s.weather.rain = 0; });
  else if (/\b(rain|rainy|wet|storm|drizzle)\b/.test(t)) set('rain', () => { s.weather.rain = /\b(storm|pouring|heavy)\b/.test(t) ? 1 : 0.7; });
  if (/\b(fog|foggy|mist|haze|hazy|smoke|smoky)\b/.test(t)) set('fog', () => { s.weather.fog = 0.6; });
  if (/\b(day|daytime|sunny|morning|afternoon)\b/.test(t)) set('daytime', () => { s.time = 'day'; });
  else if (/\b(dusk|sunset|golden hour|evening)\b/.test(t)) set('dusk', () => { s.time = 'dusk'; });
  else if (/\b(late|midnight|2am|3am|small hours)\b/.test(t)) set('late night', () => { s.time = 'late'; });
  else if (/\bnight\b/.test(t)) set('night', () => { s.time = 'night'; });
  const cols = Object.keys(COLOUR_WORDS).filter((c) => new RegExp(`\\b${c}\\b`).test(t));
  if (cols[0]) set(`accent ${cols[0]}`, () => { s.palette.accent = COLOUR_WORDS[cols[0]]; });
  if (cols[1]) set(`second accent ${cols[1]}`, () => { s.palette.accent2 = COLOUR_WORDS[cols[1]]; });
  if (/\b(cosy|cozy|warm|homely)\b/.test(t)) set('cosy and warm', () => { s.style = 'cosy'; s.lighting.warmth = 0.6; });
  if (/\b(gritty|grimy|dirty|run.down|dingy)\b/.test(t)) set('gritty', () => { s.style = 'gritty'; s.lighting.key = 0.45; });
  if (/\b(slick|modern|minimal|clean)\b/.test(t)) set('slick', () => { s.style = 'slick'; });
  if (/\b(premium|luxury|boutique|fancy)\b/.test(t)) set('premium', () => { s.style = 'premium'; s.lighting.warmth = 0.4; });
  if (/\b(retro|80s|eighties|synthwave|vaporwave)\b/.test(t)) set('retro', () => { s.style = 'retro'; s.lighting.neon = 1.6; });
  if (/\b(moody|dark|noir)\b/.test(t)) set('moody', () => { s.lighting.key = 0.35; s.lighting.neon = Math.max(s.lighting.neon, 1.3); });
  if (/\b(bright|lit up)\b/.test(t)) set('brighter', () => { s.lighting.key = 1.1; });
  if (/\b(close.?up|close)\b/.test(t)) set('close shot', () => { s.camera.shot = 'close'; s.camera.custom = undefined; });
  else if (/\blow.?angle|low camera|from below\b/.test(t)) set('low angle', () => { s.camera.shot = 'low'; s.camera.custom = undefined; });
  else if (/\b(overhead|top.?down|bird)\b/.test(t)) set('overhead', () => { s.camera.shot = 'overhead'; s.camera.custom = undefined; });
  else if (/\bwide\b/.test(t)) set('wide shot', () => { s.camera.shot = 'wide'; s.camera.custom = undefined; });
  for (const f of ['counter', 'shelves', 'door', 'window'] as const) if (new RegExp(`\\bon the ${f}|at the ${f}|towards? the ${f}`).test(t)) set(`focus ${f}`, () => { s.camera.focus = f; });
  if (/\b(busy|crowd|crowded|packed)\b/.test(t)) set('busy', () => {
    s.people = [{ role: 'staff', spot: 'counter' }, ...(['counter', 'shelves', 'centre', 'door', 'window'] as Spot[]).map((spot) => ({ role: 'customer' as const, spot, pose: 'browse' as const }))];
  });
  else if (/\b(empty|deserted|nobody)\b/.test(t)) set('empty', () => { s.people = []; });
  const named = /(?:called|named|sign says|sign reading)\s+["“']?([^"”'.,!?]{2,28})/.exec(text);
  if (named) set(`sign "${named[1].trim()}"`, () => { s.sign = named[1].trim(); });
  for (const kind of KIT) {
    const word = kind.replace('_', ' ');
    if (new RegExp(`\\b(add|with|and|a|an|some)\\s+(?:\\w+\\s+)?${word}s?\\b`).test(t) && !s.props.some((p) => p.kind === kind)) {
      set(`added ${word}`, () => {
        const spot = SPOTS.filter((x) => x !== 'outside' && !s.props.some((p) => p.spot === x))[0] ?? 'centre';
        s.props.push({ id: `${kind}${s.props.length + 1}`, name: word, kind, spot, asset: { route: 'procedural' } });
      });
    }
  }
  return { spec: normalizeSpec(s, current), changes };
}
