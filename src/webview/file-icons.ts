export interface FileIconPresentation {
  readonly glyph: string;
  readonly color: 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'muted';
}

const gitIcon: FileIconPresentation = { glyph: '◆', color: 'yellow' };
const fallbackIcon: FileIconPresentation = { glyph: '◇', color: 'muted' };

const extensionIcons: Readonly<Record<string, FileIconPresentation>> = {
  '.css': { glyph: '#', color: 'blue' },
  '.html': { glyph: '<>', color: 'orange' },
  '.js': { glyph: 'JS', color: 'yellow' },
  '.json': { glyph: '{}', color: 'yellow' },
  '.jsx': { glyph: 'JS', color: 'blue' },
  '.md': { glyph: 'M', color: 'blue' },
  '.mjs': { glyph: 'JS', color: 'yellow' },
  '.ts': { glyph: 'TS', color: 'blue' },
  '.tsx': { glyph: 'TS', color: 'blue' },
  '.vue': { glyph: 'V', color: 'green' },
  '.yaml': { glyph: 'Y', color: 'purple' },
  '.yml': { glyph: 'Y', color: 'purple' },
};

export function resolveFileIcon(path: string): FileIconPresentation {
  const fileName = (path.split('/').at(-1) ?? path).toLowerCase();
  if (fileName === '.gitignore' || fileName === '.gitattributes') {
    return gitIcon;
  }
  const dotIndex = fileName.lastIndexOf('.');
  const extension = dotIndex <= 0 ? '' : fileName.slice(dotIndex);
  return extensionIcons[extension] ?? fallbackIcon;
}
