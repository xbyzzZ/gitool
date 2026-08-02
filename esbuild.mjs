import { build } from 'esbuild';
import { copyFileSync, existsSync } from 'node:fs';

for (const fileName of ['codicon.css', 'codicon.ttf']) {
  copyFileSync(
    `node_modules/@vscode/codicons/dist/${fileName}`,
    `media/${fileName}`,
  );
}

const builds = [];

if (existsSync('src/extension.ts')) {
  builds.push(build({
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    sourcemap: false,
    target: 'node22',
  }));
}

if (existsSync('src/webview/client.ts')) {
  builds.push(build({
    entryPoints: ['src/webview/client.ts'],
    outfile: 'media/main.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    sourcemap: false,
    target: 'es2022',
  }));
}

const vscodeTestEntries = [
  'test/vscode/run-tests.ts',
  'test/vscode/suite/index.ts',
  'test/vscode/suite/extension.test.ts',
  'test/vscode/prepare-gui-workspace.ts',
  'test/vscode/cleanup-gui-workspace.ts',
].filter(existsSync);

if (vscodeTestEntries.length > 0) {
  builds.push(build({
    entryPoints: vscodeTestEntries,
    outbase: '.',
    outdir: 'dist',
    bundle: true,
    external: ['vscode', 'mocha'],
    format: 'cjs',
    platform: 'node',
    sourcemap: false,
    target: 'node22',
  }));
}

await Promise.all(builds);
