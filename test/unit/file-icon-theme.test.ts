import { describe, expect, it } from 'vitest';
import { compileFileIconTheme } from '../../src/webview/file-icon-theme.js';

describe('Webview 文件图标主题', () => {
  it('按文件名、最长复合扩展名和默认文件解析字体图标', () => {
    const theme = compileFileIconTheme({
      fonts: [{ id: 'seti', src: [{ path: 'theme://seti.woff', format: 'woff' }] }],
      iconDefinitions: {
        default: { fontCharacter: '\uE001', fontColor: '#cccccc' },
        config: { fontCharacter: '\uE002', fontColor: '#6d8086' },
        test: { fontCharacter: '\uE003', fontColor: '#519aba' },
      },
      file: 'default',
      fileNames: { 'package.json': 'config' },
      fileExtensions: { ts: 'config', 'test.ts': 'test' },
    });

    expect(theme.classForPath('package.json')).toBe(theme.classForPath('src/package.json'));
    expect(theme.classForPath('src/user.test.ts')).not.toBe(theme.classForPath('src/user.ts'));
    expect(theme.classForPath('README')).toBe(theme.classForPath('unknown'));
    expect(theme.css).toContain('@font-face');
    expect(theme.css).toContain('content: "\\e003"');
  });

  it('应用亮色映射并为图片图标生成受控资源规则', () => {
    const theme = compileFileIconTheme({
      iconDefinitions: {
        dark: { iconPath: 'theme://dark.svg' },
        light: { iconPath: 'theme://light.svg' },
      },
      fileExtensions: { vue: 'dark' },
      light: { fileExtensions: { vue: 'light' } },
    }, 'light');

    const iconClass = theme.classForPath('App.vue');
    expect(iconClass).toBe('gitool-file-icon-0');
    expect(theme.css).toContain('.gitool-file-icon-0 { background-image: url("theme://light.svg")');
  });

  it('转义主题资源中的样式结束标签并拒绝非法颜色', () => {
    const theme = compileFileIconTheme({
      fonts: [{ id: 'icons', src: [{ path: 'theme://icons.woff' }] }],
      iconDefinitions: {
        image: { iconPath: 'theme://icon.svg</style><script>' },
        font: { fontCharacter: '\uE001', fontColor: 'red; display:none' },
      },
      fileExtensions: { svg: 'image', ts: 'font' },
    });
    expect(theme.css).not.toContain('</style>');
    expect(theme.css).not.toContain('display:none');
    expect(theme.classForPath('icon.svg')).toBeDefined();
  });
});
