export type FileIconThemeVariant = 'dark' | 'light' | 'highContrast' | 'highContrastLight';

interface FileIconFontSource {
  readonly path: string;
  readonly format?: string;
}

interface FileIconFont {
  readonly id: string;
  readonly src: readonly FileIconFontSource[];
  readonly weight?: string;
  readonly style?: string;
  readonly size?: string;
}

interface FileIconDefinition {
  readonly iconPath?: string;
  readonly fontId?: string;
  readonly fontCharacter?: string;
  readonly fontColor?: string;
}

interface FileIconThemeAssociations {
  readonly file?: string;
  readonly fileExtensions?: Readonly<Record<string, string>>;
  readonly fileNames?: Readonly<Record<string, string>>;
}

export interface FileIconThemeDocument extends FileIconThemeAssociations {
  readonly fonts?: readonly FileIconFont[];
  readonly iconDefinitions?: Readonly<Record<string, FileIconDefinition>>;
  readonly light?: FileIconThemeAssociations;
  readonly highContrast?: FileIconThemeAssociations;
  readonly highContrastLight?: FileIconThemeAssociations;
}

export interface CompiledFileIconTheme {
  readonly css: string;
  classForPath(path: string): string | undefined;
}

function cssString(value: string): string {
  return value.replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('<', '\\3c ')
    .replaceAll('>', '\\3e ');
}

function cssCharacter(value: string): string {
  if (/^\\[0-9a-f]{1,6}$/iu.test(value)) {
    return value.toLocaleLowerCase('en-US');
  }
  return Array.from(value).map((character) =>
    `\\${character.codePointAt(0)?.toString(16) ?? '0'}`).join(' ');
}

function safeColor(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return /^(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))$/iu.test(value)
    ? value
    : undefined;
}

function safeFontSize(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return /^\d+(?:\.\d+)?(?:%|px|em|rem)$/u.test(value) ? value : undefined;
}

function safeFontWeight(value: string | undefined): string | undefined {
  return value !== undefined && /^(?:normal|bold|[1-9]00)$/u.test(value)
    ? value
    : undefined;
}

function safeFontStyle(value: string | undefined): string | undefined {
  return value !== undefined && /^(?:normal|italic|oblique)$/u.test(value)
    ? value
    : undefined;
}

function safeFontFormat(value: string | undefined): string | undefined {
  return value !== undefined && /^(?:woff2?|truetype|opentype|embedded-opentype|svg)$/u.test(value)
    ? value
    : undefined;
}

function normalizedMap(
  values: Readonly<Record<string, string>> | undefined,
): ReadonlyMap<string, string> {
  return new Map(Object.entries(values ?? {}).map(([key, value]) => [
    key.toLocaleLowerCase('en-US'),
    value,
  ]));
}

function associations(
  document: FileIconThemeDocument,
  variant: FileIconThemeVariant,
): Required<FileIconThemeAssociations> {
  const override = variant === 'dark' ? undefined : document[variant];
  return {
    file: override?.file ?? document.file ?? '',
    fileExtensions: {
      ...(document.fileExtensions ?? {}),
      ...(override?.fileExtensions ?? {}),
    },
    fileNames: {
      ...(document.fileNames ?? {}),
      ...(override?.fileNames ?? {}),
    },
  };
}

function fileName(path: string): string {
  return path.split('/').at(-1)?.toLocaleLowerCase('en-US') ?? path;
}

function extensionCandidates(name: string): readonly string[] {
  const segments = name.split('.');
  const start = segments[0]?.length === 0 ? 1 : 0;
  return segments.slice(start).map((_segment, index) =>
    segments.slice(start + index).join('.')).filter((value) => value.length > 0);
}

export function compileFileIconTheme(
  document: FileIconThemeDocument,
  variant: FileIconThemeVariant = 'dark',
): CompiledFileIconTheme {
  const effective = associations(document, variant);
  const fileNames = normalizedMap(effective.fileNames);
  const fileExtensions = normalizedMap(effective.fileExtensions);
  const definitions = document.iconDefinitions ?? {};
  const usedDefinitionIds = new Set([
    effective.file,
    ...Object.values(effective.fileNames),
    ...Object.values(effective.fileExtensions),
  ].filter((value) => value.length > 0));
  const fonts = new Map((document.fonts ?? []).map((font) => [font.id, font]));
  const defaultFont = document.fonts?.[0];
  const classes = new Map<string, string>();
  const css: string[] = [];

  for (const [index, font] of (document.fonts ?? []).entries()) {
    const sources = font.src.map((source) => {
      const format = safeFontFormat(source.format);
      return `url("${cssString(source.path)}")${format === undefined
        ? ''
        : ` format("${format}")`}`;
    }).join(', ');
    if (sources.length === 0) {
      continue;
    }
    const weight = safeFontWeight(font.weight);
    const style = safeFontStyle(font.style);
    css.push(`@font-face { font-family: "gitool-file-icon-font-${String(index)}"; src: ${sources};${weight === undefined ? '' : ` font-weight: ${weight};`}${style === undefined ? '' : ` font-style: ${style};`} }`);
  }

  for (const [definitionId, definition] of Object.entries(definitions)) {
    if (!usedDefinitionIds.has(definitionId)) {
      continue;
    }
    const className = `gitool-file-icon-${String(classes.size)}`;
    if (definition.iconPath !== undefined) {
      classes.set(definitionId, className);
      css.push(`.${className} { background-image: url("${cssString(definition.iconPath)}"); background-position: center; background-repeat: no-repeat; background-size: contain; }`);
      continue;
    }
    if (definition.fontCharacter === undefined) {
      continue;
    }
    const font = fonts.get(definition.fontId ?? '') ?? defaultFont;
    if (font === undefined) {
      continue;
    }
    const fontIndex = (document.fonts ?? []).indexOf(font);
    const color = safeColor(definition.fontColor);
    const size = safeFontSize(font.size);
    classes.set(definitionId, className);
    css.push(`.${className}::before { content: "${cssCharacter(definition.fontCharacter)}"; font-family: "gitool-file-icon-font-${String(fontIndex)}";${color === undefined ? '' : ` color: ${color};`}${size === undefined ? '' : ` font-size: ${size};`} }`);
  }

  const classForPath = (path: string): string | undefined => {
    const name = fileName(path);
    const normalizedPath = path.replaceAll('\\', '/').toLocaleLowerCase('en-US');
    const definition = fileNames.get(normalizedPath)
      ?? fileNames.get(name)
      ?? extensionCandidates(name).map((candidate) => fileExtensions.get(candidate))
        .find((value) => value !== undefined)
      ?? (effective.file.length === 0 ? undefined : effective.file);
    return definition === undefined ? undefined : classes.get(definition);
  };

  return { css: css.join('\n'), classForPath };
}
