import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

export interface TestRepository {
  readonly root: string;
  write(relativePath: string, content: string): Promise<void>;
  remove(relativePath: string): Promise<void>;
  git(...args: string[]): Promise<string>;
  status(): Promise<string>;
  dispose(): Promise<void>;
}

const repositoryPrefix = join(tmpdir(), 'gitool-test-');

async function runGit(root: string, args: readonly string[]): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd: root,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      const output = Buffer.concat(stdout).toString('utf8').trim();
      if (exitCode === 0) {
        resolvePromise(output);
        return;
      }

      reject(new Error(
        `测试仓库 Git 命令失败（退出码 ${String(exitCode)}）：`
        + Buffer.concat(stderr).toString('utf8').trim(),
      ));
    });
  });
}

function resolveRepositoryPath(root: string, relativePath: string): string {
  const absolutePath = resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    throw new RangeError(`测试路径超出仓库：${JSON.stringify(relativePath)}`);
  }
  return absolutePath;
}

export async function createTestRepository(): Promise<TestRepository> {
  const root = await mkdtemp(repositoryPrefix);
  await runGit(root, ['init', '-b', 'main']);
  await runGit(root, ['config', 'user.name', 'Gitool 测试']);
  await runGit(root, ['config', 'user.email', 'gitool@example.invalid']);
  let disposed = false;

  return {
    root,
    async write(relativePath, content) {
      const absolutePath = resolveRepositoryPath(root, relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, 'utf8');
    },
    async remove(relativePath) {
      await unlink(resolveRepositoryPath(root, relativePath));
    },
    async git(...args) {
      return await runGit(root, args);
    },
    async status() {
      return await runGit(root, ['status', '--short']);
    },
    async dispose() {
      if (disposed) {
        return;
      }
      if (!root.startsWith(repositoryPrefix) || root === repositoryPrefix) {
        throw new Error(`拒绝清理未经验证的测试目录：${root}`);
      }
      disposed = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}
