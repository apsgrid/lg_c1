import { describe, expect, it } from 'vitest';
import { crc32, makeZip } from '../src/util/zip';

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a valid stored archive with every entry', () => {
    const bin = new Uint8Array([0, 1, 2, 250, 255]);
    const zip = makeZip([{ name: 'scene.glb', data: bin }, { name: 'scene.render.json', data: '{"a":1}' }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const cdOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(cdOffset, true)).toBe(0x02014b50);
    // First entry's data follows its 30-byte header and name.
    const nameLen = view.getUint16(26, true);
    expect(Array.from(zip.slice(30 + nameLen, 30 + nameLen + bin.length))).toEqual(Array.from(bin));
  });
});
