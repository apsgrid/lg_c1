import { h } from './dom';

let host: HTMLElement | null = null;

export function toast(text: string, kind: 'info' | 'gold' = 'info'): void {
  if (!host) {
    host = h('div.toasts', { 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = h('div.toast', { class: kind }, text);
  host.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}
