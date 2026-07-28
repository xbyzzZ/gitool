import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

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

export async function createAcceptanceWorkspace(
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
