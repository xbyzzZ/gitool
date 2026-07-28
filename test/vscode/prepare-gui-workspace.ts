import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAcceptanceWorkspace } from './acceptance-workspace.js';
import { manualWorkspaceCommands } from './manual-workspace.js';

function vscodeCli(): string {
  const macCli =
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  return process.platform === 'darwin' && existsSync(macCli) ? macCli : 'code';
}

async function main(): Promise<void> {
  const prefix = process.platform === 'darwin' ? 'gt-g-' : 'gitool-gui-';
  const fixtureRoot = await mkdtemp(join(tmpdir(), prefix));
  try {
    const userDataDirectory = join(fixtureRoot, 'user-data');
    const extensionsDirectory = join(fixtureRoot, 'extensions');
    await mkdir(userDataDirectory);
    await mkdir(extensionsDirectory);
    const workspaceFile = await createAcceptanceWorkspace(fixtureRoot);
    const extensionDevelopmentPath = resolve(__dirname, '../../..');
    const commands = manualWorkspaceCommands({
      codeCommand: vscodeCli(),
      extensionDevelopmentPath,
      workspaceFile,
      userDataDirectory,
      extensionsDirectory,
      fixtureRoot,
    });

    process.stdout.write([
      `隔离验收根目录：${fixtureRoot}`,
      `repo-a：${join(fixtureRoot, 'repo-a')}`,
      `repo-b：${join(fixtureRoot, 'repo-b')}`,
      `启动命令：${commands.launch}`,
      `手工验收结束后的清理命令：${commands.cleanup}`,
      '注意：此命令不会自动清理目录，以便保留截图和 Git 核对证据。',
      '',
    ].join('\n'));
  } catch (error) {
    await rm(fixtureRoot, { force: true, recursive: true });
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`准备隔离 GUI 验收工作区失败：${message}\n`);
  process.exitCode = 1;
});
