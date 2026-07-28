import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { runTests } from '@vscode/test-electron';

const execFileAsync = promisify(execFile);

async function runGit(
  workingDirectory: string,
  args: readonly string[],
): Promise<void> {
  await execFileAsync('git', args, { cwd: workingDirectory });
}

async function createRepository(repositoryRoot: string): Promise<void> {
  await mkdir(repositoryRoot, { recursive: true });
  await runGit(repositoryRoot, ['init', '--initial-branch=main']);
  await runGit(repositoryRoot, ['config', 'user.name', 'Gitool 测试']);
  await runGit(repositoryRoot, ['config', 'user.email', 'gitool@example.test']);
  await writeFile(join(repositoryRoot, 'tracked.txt'), '初始内容\n', 'utf8');
  await runGit(repositoryRoot, ['add', '--', 'tracked.txt']);
  await runGit(repositoryRoot, ['commit', '-m', '测试：初始化仓库']);
  await writeFile(join(repositoryRoot, 'tracked.txt'), '已跟踪变更\n', 'utf8');
  await writeFile(join(repositoryRoot, 'untracked.txt'), '未跟踪变更\n', 'utf8');
}

async function createAcceptanceWorkspace(
  fixtureRoot: string,
): Promise<string> {
  const repositoryA = join(fixtureRoot, 'repo-a');
  const repositoryB = join(fixtureRoot, 'repo-b');
  const remote = join(fixtureRoot, 'remote.git');
  const secondRemote = join(fixtureRoot, 'remote-second.git');
  await createRepository(repositoryA);
  await createRepository(repositoryB);
  await writeFile(join(repositoryA, 'preserved.txt'), '保留暂存\n', 'utf8');
  await runGit(repositoryA, ['add', '--', 'preserved.txt']);
  await mkdir(remote, { recursive: true });
  await runGit(remote, ['init', '--bare']);
  await mkdir(secondRemote, { recursive: true });
  await runGit(secondRemote, ['init', '--bare']);
  await runGit(repositoryA, ['remote', 'add', 'origin', remote]);

  const workspaceFile = join(fixtureRoot, 'gitool-acceptance.code-workspace');
  await writeFile(workspaceFile, JSON.stringify({
    folders: [
      { path: repositoryA },
      { path: repositoryB },
    ],
    settings: {
      'git.openRepositoryInParent': 'never',
    },
  }), 'utf8');
  return workspaceFile;
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, '../../..');
  const extensionTestsPath = resolve(__dirname, 'suite/index.js');
  const userDataDirectory = await mkdtemp('/private/tmp/gitool-user-');
  const extensionsDirectory = await mkdtemp('/private/tmp/gitool-ext-');
  const fixtureRoot = await mkdtemp('/private/tmp/gitool-acceptance-');

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
    await Promise.all([
      rm(userDataDirectory, { force: true, recursive: true }),
      rm(extensionsDirectory, { force: true, recursive: true }),
      rm(fixtureRoot, { force: true, recursive: true }),
    ]);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`VS Code 扩展测试失败：${message}\n`);
  process.exitCode = 1;
});
