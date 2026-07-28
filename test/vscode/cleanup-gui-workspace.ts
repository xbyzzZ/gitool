import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

async function main(): Promise<void> {
  const input = process.argv[2];
  if (input === undefined) {
    throw new Error('必须提供隔离验收根目录');
  }
  const target = resolve(input);
  const expectedParent = resolve(tmpdir());
  const name = basename(target);
  if (
    dirname(target) !== expectedParent
    || (!name.startsWith('gt-g-') && !name.startsWith('gitool-gui-'))
  ) {
    throw new Error('拒绝清理非 Gitool 隔离验收根目录');
  }
  await rm(target, { force: true, recursive: true });
  process.stdout.write(`已清理隔离验收根目录：${target}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`清理隔离 GUI 验收工作区失败：${message}\n`);
  process.exitCode = 1;
});
