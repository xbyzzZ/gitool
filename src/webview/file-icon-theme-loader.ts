import * as vscode from 'vscode';
import { parse, type ParseError } from 'jsonc-parser/lib/esm/main.js';
import {
  compileFileIconTheme,
  type CompiledFileIconTheme,
  type FileIconThemeDocument,
  type FileIconThemeVariant,
} from './file-icon-theme.js';

interface IconThemeContribution {
  readonly id: string;
  readonly path: string;
}

interface IconThemePackageJson {
  readonly contributes?: {
    readonly iconThemes?: readonly IconThemeContribution[];
  };
}

interface ExtendedFileIconThemeDocument extends FileIconThemeDocument {
  readonly extends?: string;
}

export interface LoadedFileIconTheme extends CompiledFileIconTheme {
  readonly localResourceRoots: readonly vscode.Uri[];
}

function emptyTheme(): LoadedFileIconTheme {
  return {
    css: '',
    classForPath: () => undefined,
    localResourceRoots: [],
  };
}

function isIconThemeContribution(value: unknown): value is IconThemeContribution {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string'
    && 'path' in value && typeof value.path === 'string';
}

function themeContribution(
  themeId: string,
): { readonly contribution: IconThemeContribution; readonly extensionUri: vscode.Uri } | undefined {
  for (const extension of vscode.extensions.all) {
    const packageJson = extension.packageJSON as IconThemePackageJson;
    const contribution = packageJson.contributes?.iconThemes
      ?.find((item: unknown) => isIconThemeContribution(item) && item.id === themeId);
    if (contribution !== undefined) {
      return { contribution, extensionUri: extension.extensionUri };
    }
  }
  return undefined;
}

function directory(uri: vscode.Uri): vscode.Uri {
  const slash = uri.path.lastIndexOf('/');
  return uri.with({ path: slash <= 0 ? '/' : uri.path.slice(0, slash) });
}

function assetUri(webview: vscode.Webview, themeUri: vscode.Uri, path: string): string {
  return webview.asWebviewUri(vscode.Uri.joinPath(directory(themeUri), path)).toString();
}

function resolveAssets(
  document: ExtendedFileIconThemeDocument,
  themeUri: vscode.Uri,
  webview: vscode.Webview,
): ExtendedFileIconThemeDocument {
  return {
    ...document,
    ...(document.fonts === undefined ? {} : {
      fonts: document.fonts.map((font) => ({
        ...font,
        src: font.src.map((source) => ({
          ...source,
          path: assetUri(webview, themeUri, source.path),
        })),
      })),
    }),
    ...(document.iconDefinitions === undefined ? {} : {
      iconDefinitions: Object.fromEntries(Object.entries(document.iconDefinitions).map(
        ([id, definition]) => [id, definition.iconPath === undefined
          ? definition
          : { ...definition, iconPath: assetUri(webview, themeUri, definition.iconPath) }],
      )),
    }),
  };
}

function mergeAssociations(
  parent: FileIconThemeDocument['light'],
  child: FileIconThemeDocument['light'],
): FileIconThemeDocument['light'] {
  if (parent === undefined && child === undefined) {
    return undefined;
  }
  return {
    ...(parent ?? {}),
    ...(child ?? {}),
    fileExtensions: { ...(parent?.fileExtensions ?? {}), ...(child?.fileExtensions ?? {}) },
    fileNames: { ...(parent?.fileNames ?? {}), ...(child?.fileNames ?? {}) },
  };
}

function mergeThemes(
  parent: ExtendedFileIconThemeDocument,
  child: ExtendedFileIconThemeDocument,
): ExtendedFileIconThemeDocument {
  const fonts = new Map((parent.fonts ?? []).map((font) => [font.id, font]));
  for (const font of child.fonts ?? []) {
    fonts.set(font.id, font);
  }
  const light = mergeAssociations(parent.light, child.light);
  const highContrast = mergeAssociations(parent.highContrast, child.highContrast);
  const highContrastLight = mergeAssociations(
    parent.highContrastLight,
    child.highContrastLight,
  );
  return {
    ...parent,
    ...child,
    fonts: [...fonts.values()],
    iconDefinitions: { ...(parent.iconDefinitions ?? {}), ...(child.iconDefinitions ?? {}) },
    fileExtensions: { ...(parent.fileExtensions ?? {}), ...(child.fileExtensions ?? {}) },
    fileNames: { ...(parent.fileNames ?? {}), ...(child.fileNames ?? {}) },
    ...(light === undefined ? {} : { light }),
    ...(highContrast === undefined ? {} : { highContrast }),
    ...(highContrastLight === undefined ? {} : { highContrastLight }),
  };
}

async function readTheme(
  themeUri: vscode.Uri,
  webview: vscode.Webview,
  visited: Set<string>,
): Promise<ExtendedFileIconThemeDocument> {
  const key = themeUri.toString();
  if (visited.has(key)) {
    throw new Error('文件图标主题包含循环继承');
  }
  visited.add(key);
  const errors: ParseError[] = [];
  const bytes = await vscode.workspace.fs.readFile(themeUri);
  const parsed = parse(new TextDecoder().decode(bytes), errors) as unknown;
  if (errors.length > 0 || typeof parsed !== 'object' || parsed === null) {
    throw new Error('文件图标主题 JSON 无效');
  }
  const document = parsed as ExtendedFileIconThemeDocument;
  const resolved = resolveAssets(document, themeUri, webview);
  if (document.extends === undefined) {
    return resolved;
  }
  const parentUri = vscode.Uri.joinPath(directory(themeUri), document.extends);
  const parent = await readTheme(parentUri, webview, visited);
  return mergeThemes(parent, resolved);
}

function currentVariant(): FileIconThemeVariant {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
      return 'light';
    case vscode.ColorThemeKind.HighContrast:
      return 'highContrast';
    case vscode.ColorThemeKind.HighContrastLight:
      return 'highContrastLight';
    default:
      return 'dark';
  }
}

export async function loadCurrentFileIconTheme(
  webview: vscode.Webview,
): Promise<LoadedFileIconTheme> {
  const themeId = vscode.workspace.getConfiguration('workbench')
    .get<string | null>('iconTheme', 'vs-seti');
  if (themeId === null || themeId.length === 0) {
    return emptyTheme();
  }
  const matched = themeContribution(themeId);
  if (matched === undefined) {
    throw new Error(`找不到当前文件图标主题：${themeId}`);
  }
  const themeUri = vscode.Uri.joinPath(
    matched.extensionUri,
    matched.contribution.path,
  );
  const document = await readTheme(themeUri, webview, new Set());
  return {
    ...compileFileIconTheme(document, currentVariant()),
    localResourceRoots: [matched.extensionUri],
  };
}
