import { GitRunner, redactSensitiveText } from '../git/git-runner.js';

export interface RemoteInfo {
  readonly name: string;
  readonly url: string;
}

function parseRemoteNames(output: string): string[] {
  return output.split('\n').filter((name) => name.length > 0);
}

function removeOutputLineEnding(output: string): string {
  return output.replace(/\r?\n$/u, '');
}

export class RemoteService {
  constructor(private readonly git: GitRunner) {}

  async getRemotes(repositoryRoot: string): Promise<readonly RemoteInfo[]> {
    const remoteNames = parseRemoteNames(
      (await this.git.run(repositoryRoot, ['remote'])).stdout,
    );
    return await Promise.all(remoteNames.map(async (name) => ({
      name,
      url: removeOutputLineEnding((await this.git.run(repositoryRoot, [
        'remote',
        'get-url',
        name,
      ])).stdout),
    })));
  }

  async setUrl(
    repositoryRoot: string,
    name: string,
    url: string,
  ): Promise<RemoteInfo> {
    if (url.trim().length === 0) {
      throw new RangeError('远程 URL 不能为空');
    }

    const remotes = await this.getRemotes(repositoryRoot);
    if (!remotes.some((remote) => remote.name === name)) {
      throw new Error(`远程 ${name} 不存在`);
    }

    await this.git.run(repositoryRoot, ['remote', 'set-url', name, url]);
    const actualUrl = (await this.git.run(repositoryRoot, [
      'remote',
      'get-url',
      name,
    ])).stdout;
    const actualRemoteUrl = removeOutputLineEnding(actualUrl);
    if (actualRemoteUrl !== redactSensitiveText(url)) {
      throw new Error(`远程 ${name} URL 写入后核对失败`);
    }
    return { name, url: actualRemoteUrl };
  }
}
