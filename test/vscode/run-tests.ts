import { resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';
import { createAcceptanceWorkspace } from './acceptance-workspace.js';
import { createTemporaryDirectories } from './temporary-directories.js';

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, '../../..');
  const extensionTestsPath = resolve(__dirname, 'suite/index.js');
  const directories = await createTemporaryDirectories();
  const {
    userDataDirectory,
    extensionsDirectory,
    fixtureRoot,
  } = directories;

  try {
    const workspaceFile = await createAcceptanceWorkspace(fixtureRoot);
    process.stdout.write(`Gitool 验收工作区：${fixtureRoot}\n`);
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceFile,
        `--user-data-dir=${userDataDirectory}`,
        `--extensions-dir=${extensionsDirectory}`,
        '--disable-workspace-trust',
        '--disable-gpu',
        '--skip-release-notes',
        '--skip-welcome',
      ],
    });
  } finally {
    await directories.dispose();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`VS Code 扩展测试失败：${message}\n`);
  process.exitCode = 1;
});
