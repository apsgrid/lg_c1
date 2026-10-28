import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const simDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim');
const files = readdirSync(simDir).filter((f) => f.endsWith('.ts'));

describe('sim/ rules', () => {
  it('never imports from view/, ui/, store/, three or the DOM', () => {
    for (const f of files) {
      const src = readFileSync(join(simDir, f), 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        expect(imp, `${f} imports ${imp}`).toMatch(/^\.\/[\w-]+$/);
      }
      expect(src, `${f} touches the DOM`).not.toMatch(/\b(document|window|localStorage)\./);
    }
  });
  it('never uses Math.random', () => {
    for (const f of files) expect(readFileSync(join(simDir, f), 'utf8'), f).not.toContain('Math.random');
  });
});
