import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/git/git-runner.js';
import { HistoryService } from '../../src/services/history-service.js';
import {
  createTestRepository,
  type TestRepository,
} from '../helpers/git-repository.js';

describe('提交历史服务', () => {
  const repositories: TestRepository[] = [];

  afterEach(async () => {
    await Promise.all(repositories.splice(0).map(async (repository) => {
      await repository.dispose();
    }));
  });

  it('读取真实提交、当前分支引用和根提交详情', async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await repository.write('README.md', '初始\n');
    await repository.git('add', '--', 'README.md');
    await repository.git('commit', '-m', '功能：初始化');
    const firstHash = await repository.git('rev-parse', 'HEAD');
    await repository.write('src/main.ts', 'export const value = 1;\n');
    await repository.git('add', '--', 'src/main.ts');
    await repository.git('commit', '-m', '功能：增加入口');

    const service = new HistoryService(new GitRunner());
    const history = await service.list(repository.root, 50);
    const rootDetails = await service.details(repository.root, firstHash);

    expect(history.commits.map((commit) => commit.subject)).toEqual([
      '功能：增加入口',
      '功能：初始化',
    ]);
    expect(history.commits[0]?.refs).toEqual([
      { name: 'main', kind: 'head' },
    ]);
    expect(rootDetails).toMatchObject({
      hash: firstHash,
      files: [{ status: 'A', path: 'README.md' }],
    });
    expect(rootDetails.parentHash).toBeUndefined();
  });

  it('读取重命名文件的原路径和当前路径', async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await repository.write('old.ts', 'export {};\n');
    await repository.git('add', '--', 'old.ts');
    await repository.git('commit', '-m', '功能：增加文件');
    await repository.git('mv', 'old.ts', 'new.ts');
    await repository.git('commit', '-m', '重构：重命名文件');
    const hash = await repository.git('rev-parse', 'HEAD');

    const details = await new HistoryService(new GitRunner()).details(
      repository.root,
      hash,
    );

    expect(details.files).toEqual([
      { status: 'R100', path: 'new.ts', originalPath: 'old.ts' },
    ]);
  });

  it('没有上游时返回明确同步状态', async () => {
    const repository = await createTestRepository();
    repositories.push(repository);

    await expect(new HistoryService(new GitRunner()).aheadBehind(
      repository.root,
    )).resolves.toEqual({ kind: 'no-upstream' });
  });
});
