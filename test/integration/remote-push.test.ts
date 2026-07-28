import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/git/git-runner.js';
import { PushService } from '../../src/services/push-service.js';
import { RemoteService } from '../../src/services/remote-service.js';
import { FakeBuiltinRepository } from '../helpers/test-doubles.js';
import {
  createTestRepository,
  type TestRepository,
} from '../helpers/git-repository.js';

const repositories: TestRepository[] = [];
const bareRemotes: string[] = [];

async function createRepository(): Promise<TestRepository> {
  const repository = await createTestRepository();
  repositories.push(repository);
  return repository;
}

async function createBareRemote(): Promise<string> {
  const remote = await mkdtemp(join(tmpdir(), 'gitool-remote-'));
  bareRemotes.push(remote);
  const repository = await createRepository();
  await repository.git('init', '--bare', remote);
  return remote;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(async (repository) => {
    await repository.dispose();
  }));
  await Promise.all(bareRemotes.splice(0).map(async (remote) => {
    await rm(remote, { recursive: true, force: true });
  }));
});

describe('RemoteService', () => {
  it('读取远程名称和当前 URL', async () => {
    const repository = await createRepository();
    const remote = await createBareRemote();
    await repository.git('remote', 'add', 'origin', remote);
    const service = new RemoteService(new GitRunner());

    await expect(service.getRemotes(repository.root)).resolves.toEqual([{
      name: 'origin',
      url: remote,
    }]);
  });

  it('修改已有远程 URL 后重新读取结果', async () => {
    const repository = await createRepository();
    const remoteA = await createBareRemote();
    const remoteB = await createBareRemote();
    await repository.git('remote', 'add', 'origin', remoteA);

    const service = new RemoteService(new GitRunner());
    const result = await service.setUrl(repository.root, 'origin', remoteB);

    expect(result).toEqual({ name: 'origin', url: remoteB });
    expect(await repository.git('remote', 'get-url', 'origin')).toBe(remoteB);
  });

  it('拒绝修改不存在的远程', async () => {
    const repository = await createRepository();
    const service = new RemoteService(new GitRunner());

    await expect(service.setUrl(
      repository.root,
      'missing',
      'https://example.com/a.git',
    )).rejects.toThrow('远程 missing 不存在');
  });

  it('拒绝写入空白远程 URL', async () => {
    const repository = await createRepository();
    const remote = await createBareRemote();
    await repository.git('remote', 'add', 'origin', remote);
    const service = new RemoteService(new GitRunner());

    await expect(service.setUrl(repository.root, 'origin', '  '))
      .rejects.toThrow('远程 URL 不能为空');
    expect(await repository.git('remote', 'get-url', 'origin')).toBe(remote);
  });
});

describe('PushService', () => {
  it('无上游时推送同名分支并建立上游', async () => {
    const repository = new FakeBuiltinRepository({
      head: { name: 'feature/a' },
      remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git' }],
    });
    const service = new PushService();

    const result = await service.push(repository, {
      selectedRemote: 'origin',
      localBranch: 'feature/a',
    });

    expect(result).toEqual({
      kind: 'pushed',
      remote: 'origin',
      branch: 'feature/a',
    });
    expect(repository.pushCalls).toEqual([{
      remoteName: 'origin',
      branchName: 'feature/a',
      setUpstream: true,
    }]);
  });

  it('已有上游时使用上游远程和分支', async () => {
    const repository = new FakeBuiltinRepository({
      head: {
        name: 'feature/a',
        upstream: { remote: 'upstream', name: 'release/a' },
      },
      remotes: [{ name: 'upstream', fetchUrl: 'https://example.com/a.git' }],
    });
    const service = new PushService();

    const result = await service.push(repository, {
      selectedRemote: 'origin',
      localBranch: 'feature/a',
    });

    expect(result).toEqual({
      kind: 'pushed',
      remote: 'upstream',
      branch: 'release/a',
    });
    expect(repository.pushCalls).toEqual([{
      remoteName: 'upstream',
      branchName: 'release/a',
      setUpstream: false,
    }]);
  });

  it('无上游且未选择远程时返回可选远程', async () => {
    const repository = new FakeBuiltinRepository({
      head: { name: 'feature/a' },
      remotes: [
        { name: 'origin', fetchUrl: 'https://example.com/a.git' },
        { name: 'upstream', fetchUrl: 'https://example.com/b.git' },
      ],
    });
    const service = new PushService();

    const result = await service.push(repository, { localBranch: 'feature/a' });

    expect(result).toEqual({
      kind: 'needs-remote',
      remotes: ['origin', 'upstream'],
    });
    expect(repository.pushCalls).toEqual([]);
  });

  it('游离 HEAD 在调用 Git API 前失败', async () => {
    const repository = new FakeBuiltinRepository({
      remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git' }],
    });
    const service = new PushService();

    await expect(service.push(repository, {
      selectedRemote: 'origin',
      localBranch: 'feature/a',
    })).rejects.toThrow('当前处于游离 HEAD，不能推送');
    expect(repository.pushCalls).toEqual([]);
  });
});
