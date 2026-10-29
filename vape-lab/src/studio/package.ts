// What "Approve for Unreal" puts in the zip besides the scene itself: the asset
// plan, a Fab shopping list, text-to-3D prompts, and instructions for Claude on
// the PC that has Unreal. Pure: the caller measures the props in the scene.
import { fabSearchUrl, type ShotSpec } from './spec';

export interface RenderOptions {
  resolution: '1920x1080' | '2560x1440' | '3840x2160';
  quality: 'draft' | 'high' | 'final';
  motion: 'still' | 'push-in';
}

export interface MeasuredProp { id: string; position: [number, number, number]; size: [number, number, number]; rotationY: number }

export interface AssetPlanItem {
  id: string;
  name: string;
  kind: string;
  route: 'procedural' | 'library' | 'text3d';
  node: string;
  query?: string;
  fabUrl?: string;
  prompt?: string;
  generatedFile?: string;
  position: [number, number, number];
  rotationY: number;
  size: [number, number, number];
}

export function assetPlan(spec: ShotSpec, measured: MeasuredProp[]): AssetPlanItem[] {
  const byId = new Map(measured.map((m) => [m.id, m]));
  return spec.props.map((p) => {
    const m = byId.get(p.id);
    const item: AssetPlanItem = {
      id: p.id, name: p.name, kind: p.kind, route: p.asset.route, node: `prop_${p.id}`,
      position: m?.position ?? [0, 0, 0], rotationY: m?.rotationY ?? 0, size: m?.size ?? [1, 1, 1],
    };
    if (p.asset.route === 'library') { item.query = p.asset.query ?? p.name; item.fabUrl = fabSearchUrl(item.query); }
    if (p.asset.route === 'text3d') { item.prompt = p.asset.prompt ?? p.name; item.generatedFile = `generated/${p.id}.glb`; }
    return item;
  });
}

const dims = (s: [number, number, number]) => s.map((v) => v.toFixed(2)).join(' × ');

export function shoppingList(plan: AssetPlanItem[]): string {
  const lib = plan.filter((p) => p.route === 'library');
  if (!lib.length) return '# Fab / Megascans shopping list\n\nNothing from the library in this shot.\n';
  return [
    '# Fab / Megascans shopping list',
    '',
    'Add one asset per line to your Unreal project (Fab in the editor, or fab.com → "Add to project").',
    'Any folder works: the import script searches your whole project for the best name match.',
    'Megascans are free in Fab for Unreal projects; check each asset\'s licence for anything else.',
    '',
    ...lib.map((p) => `- [ ] **${p.name}**: search [${p.query}](${p.fabUrl}). Needs to be roughly ${dims(p.size)} m (w × h × d); it's scaled to fit.`),
    '',
  ].join('\n');
}

export function text3dPrompts(plan: AssetPlanItem[]): string {
  const t = plan.filter((p) => p.route === 'text3d');
  if (!t.length) return '# Text-to-3D prompts\n\nNo generated models in this shot.\n';
  return [
    '# Text-to-3D prompts',
    '',
    'Run `python scripts/generate.py . --provider meshy` (or `tripo`) in this folder with your API key set,',
    'or generate these anywhere and save each file under the name shown.',
    '',
    ...t.flatMap((p) => [`## ${p.name} → \`${p.generatedFile}\``, '', `About ${dims(p.size)} m (w × h × d).`, '', p.prompt ?? '', '']),
  ].join('\n');
}

export function unrealPrompt(spec: ShotSpec, plan: AssetPlanItem[], opts: RenderOptions, zipName: string): string {
  const lib = plan.filter((p) => p.route === 'library').length;
  const gen = plan.filter((p) => p.route === 'text3d').length;
  return [
    `# Unreal render: "${spec.title}"`,
    '',
    'Paste this to Claude on the PC that has Unreal Engine (with an Unreal MCP that can run editor Python).',
    '',
    '---',
    '',
    `I approved a shot in Vape Wars Studio. The package is \`${zipName}\`. Please:`,
    '',
    `1. Unzip it into a folder next to the zip (keep the folder: generated models and edits live there).`,
    gen
      ? `2. Text-to-3D: ${gen} prop(s) need generated models (see TEXT3D_PROMPTS.md). If MESHY_API_KEY or TRIPO_API_KEY is set, run \`python scripts/generate.py <folder> --provider meshy\` (or tripo; add --refine for full textures). Otherwise run it with \`--provider manual\` and tell me which files to make.`
      : '2. Text-to-3D: none in this shot.',
    lib
      ? `3. Library: ${lib} prop(s) come from Fab/Megascans (see LIBRARY_SHOPPING_LIST.md). Check whether my project already has a good match for each; for the rest, give me the list of Fab links to add, and wait for me to say they're added.`
      : '3. Library: none in this shot.',
    `4. In Unreal, run \`scripts/vape_import.py\`'s \`main("<folder>", render=True)\` through the MCP. It imports the scene into /Game/VapeWars/Maps/<name>, swaps in the library and generated assets, lights it, sets the camera and post-processing, and starts a Movie Render Queue job (${opts.resolution}, ${opts.quality}, ${opts.motion}).`,
    '5. Read the `[vape]` summary in the Output Log. Fix anything that failed for my engine version (the script hasn\'t been run against Unreal before), then run it again with `import_mode="skip"`.',
    `6. Apply the render notes below in Unreal (they're things the browser preview can't do), then re-render and show me the result.`,
    '',
    `**Render notes:** ${spec.renderNotes || '(none)'}`,
    '',
    `**Look:** ${spec.style}, ${spec.time}, rain ${Math.round(spec.weather.rain * 100)}%, fog ${Math.round(spec.weather.fog * 100)}%, accents ${spec.palette.accent} / ${spec.palette.accent2}, ${spec.camera.shot} shot on a ${spec.camera.lens}mm lens.`,
    '',
    'Keep the shop fictional: no real brands or logos.',
    '',
  ].join('\n');
}
