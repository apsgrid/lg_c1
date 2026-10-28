import type { Product, SynergyId, TestResult } from '../sim/types';

const KEY = {
  formulas: 'vapelab.v1.formulas',
  discovered: 'vapelab.v1.discovered',
  history: 'vapelab.v1.history',
  current: 'vapelab.v1.current',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the lab still works for this session.
  }
}

export interface SavedFormula {
  slotId: string;              // library entry id (independent of product id)
  lineage: string;
  savedAt: number;
  product: Product;
  lastAppeal?: number;
}

export interface HistoryEntry {
  lineage: string;
  version: number;
  at: number;
  product: Product;
  appeal: number;
  originality: number;
  balance: number;
  repeatPurchase: number;
  projectedProfit: number;
}

export const storage = {
  loadFormulas: (): SavedFormula[] => read(KEY.formulas, [] as SavedFormula[]),
  saveFormulas: (f: SavedFormula[]) => write(KEY.formulas, f),

  loadDiscovered: (): SynergyId[] => read(KEY.discovered, [] as SynergyId[]),
  saveDiscovered: (d: SynergyId[]) => write(KEY.discovered, d),

  loadHistory: (): HistoryEntry[] => read(KEY.history, [] as HistoryEntry[]),
  pushHistory(lineage: string, product: Product, r: TestResult): HistoryEntry {
    const all = storage.loadHistory();
    const version = all.filter((e) => e.lineage === lineage).length + 1;
    const entry: HistoryEntry = {
      lineage, version, at: Date.now(), product,
      appeal: r.appeal, originality: r.originality, balance: r.balance,
      repeatPurchase: r.repeatPurchase, projectedProfit: r.projectedProfit,
    };
    all.push(entry);
    write(KEY.history, all.slice(-200));
    return entry;
  },

  loadCurrent: (): { product: Product; lineage: string } | null => read(KEY.current, null),
  saveCurrent: (product: Product, lineage: string) => write(KEY.current, { product, lineage }),

  resetAll(): void {
    try {
      for (const k of Object.values(KEY)) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
