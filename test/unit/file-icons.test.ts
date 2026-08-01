import { describe, expect, it } from 'vitest';
import { resolveFileIcon } from '../../src/webview/file-icons.js';

describe('文件类型图标', () => {
  it.each([
    ['src/main.ts', { glyph: 'TS', color: 'blue' }],
    ['src/App.vue', { glyph: 'V', color: 'green' }],
    ['config/project.yml', { glyph: 'Y', color: 'purple' }],
    ['package.json', { glyph: '{}', color: 'yellow' }],
    ['styles/main.css', { glyph: '#', color: 'blue' }],
    ['README.md', { glyph: 'M', color: 'blue' }],
  ] as const)('为 %s 返回稳定的本地图标', (path, expected) => {
    expect(resolveFileIcon(path)).toEqual(expected);
  });

  it('识别不带扩展名的 Git 配置文件', () => {
    expect(resolveFileIcon('.gitignore')).toEqual({
      glyph: '◆',
      color: 'yellow',
    });
  });

  it('未知扩展名使用通用文件图标', () => {
    expect(resolveFileIcon('assets/archive.unknown')).toEqual({
      glyph: '◇',
      color: 'muted',
    });
  });

  it('扩展名匹配不区分大小写', () => {
    expect(resolveFileIcon('SRC/INDEX.TSX')).toEqual({
      glyph: 'TS',
      color: 'blue',
    });
  });
});
