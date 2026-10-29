// Offer a generated file to the viewer: through the hosting page's downloads
// capability when published as an artifact, or a plain browser download.

interface DownloadsApi { save(req: { filename: string; data: Blob | Uint8Array }): Promise<unknown> }
type ClaudeHost = { use?: (name: string) => Promise<unknown> };

let api: Promise<DownloadsApi | null> | null = null;
function downloadsApi(): Promise<DownloadsApi | null> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!host?.use) return Promise.resolve(null);
  api ??= host.use('downloads').then((d) => (d as DownloadsApi) ?? null).catch(() => null);
  return api;
}

export async function offerDownload(filename: string, data: Uint8Array, mime = 'application/zip'): Promise<'saved' | 'declined' | 'failed'> {
  const blob = new Blob([data], { type: mime });
  const dl = await downloadsApi();
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return 'declined';
      if (code !== 'unavailable' && code !== 'not_granted') return 'failed';
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return 'saved';
  } catch {
    return 'failed';
  }
}
