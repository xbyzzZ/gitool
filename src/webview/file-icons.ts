export interface FileIconPresentation {
  readonly codicon: 'file' | 'file-code' | 'git-commit' | 'json' | 'markdown';
  readonly color: 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'muted';
}

const gitIcon: FileIconPresentation = {
  codicon: 'git-commit',
  color: 'yellow',
};
const fallbackIcon: FileIconPresentation = {
  codicon: 'file',
  color: 'muted',
};

const extensionIcons: Readonly<Record<string, FileIconPresentation>> = {
  '.css': { codicon: 'file-code', color: 'blue' },
  '.html': { codicon: 'file-code', color: 'orange' },
  '.js': { codicon: 'file-code', color: 'yellow' },
  '.json': { codicon: 'json', color: 'yellow' },
  '.jsx': { codicon: 'file-code', color: 'blue' },
  '.md': { codicon: 'markdown', color: 'blue' },
  '.mjs': { codicon: 'file-code', color: 'yellow' },
  '.ts': { codicon: 'file-code', color: 'blue' },
  '.tsx': { codicon: 'file-code', color: 'blue' },
  '.vue': { codicon: 'file-code', color: 'green' },
  '.yaml': { codicon: 'file-code', color: 'purple' },
  '.yml': { codicon: 'file-code', color: 'purple' },
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
