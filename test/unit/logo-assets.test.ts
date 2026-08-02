import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readPngSize(path: string): { readonly width: number; readonly height: number } {
  const content = readFileSync(resolve(path));
  expect(content.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  return {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
  };
}

describe('Gitool Logo 资产', () => {
  it('提供 512 像素展示 Logo', () => {
    expect(readPngSize('media/logo-512.png')).toEqual({
      width: 512,
      height: 512,
    });
  });

  it('提供 128 像素 Marketplace Logo', () => {
    expect(readPngSize('media/logo.png')).toEqual({
      width: 128,
      height: 128,
    });
  });
});
