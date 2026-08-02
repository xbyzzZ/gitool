import { describe, expect, it } from 'vitest';
import { resolveFileIcon } from '../../src/webview/file-icons.js';

describe('文件类型图标', () => {
  it.each([
    ['src/main.ts', { codicon: 'file-code', color: 'blue' }],
    ['src/App.vue', { codicon: 'file-code', color: 'green' }],
    ['config/project.yml', { codicon: 'file-code', color: 'purple' }],
    ['package.json', { codicon: 'json', color: 'yellow' }],
    ['styles/main.css', { codicon: 'file-code', color: 'blue' }],
    ['README.md', { codicon: 'markdown', color: 'blue' }],
  ] as const)('为 %s 返回 VS Code Codicon', (path, expected) => {
    expect(resolveFileIcon(path)).toEqual(expected);
  });

  it('识别不带扩展名的 Git 配置文件', () => {
    expect(resolveFileIcon('.gitignore')).toEqual({
      codicon: 'git-commit',
      color: 'yellow',
    });
  });

  it('未知扩展名使用通用文件图标', () => {
    expect(resolveFileIcon('assets/archive.unknown')).toEqual({
      codicon: 'file',
      color: 'muted',
    });
  });

  it('扩展名匹配不区分大小写', () => {
    expect(resolveFileIcon('SRC/INDEX.TSX')).toEqual({
      codicon: 'file-code',
      color: 'blue',
    });
  });
});
