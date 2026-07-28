import { spawn } from 'node:child_process';
import type {
  GitMachineOutput,
  GitResult,
  GitRunOptions,
} from './git-types.js';

export type {
  GitMachineOutput,
  GitResult,
  GitRunOptions,
} from './git-types.js';

const sensitiveQueryParameter =
  /([?&](?:access_token|auth_token|token|password|passwd|secret)=)[^&#\s"'<>]*/giu;
const urlUserInfo = /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/giu;

export function redactSensitiveText(text: string): string {
  return text
    .replace(urlUserInfo, (_match, scheme: string, userInfo: string) => {
      const replacement = userInfo.includes(':') ? '***:***' : '***';
      return `${scheme}${replacement}@`;
    })
    .replace(sensitiveQueryParameter, '$1***');
}

export class GitCommandError extends Error {
  readonly exitCode: number;
  readonly command: string;
  readonly stderr: string;

  constructor(exitCode: number, command: string, stderr: string) {
    const redactedCommand = redactSensitiveText(command);
    const redactedStderr = redactSensitiveText(stderr);
    super(
      `Git 命令失败（退出码 ${String(exitCode)}）：${redactedCommand}`
      + (redactedStderr.length === 0 ? '' : `\n${redactedStderr}`),
    );
    this.name = 'GitCommandError';
    this.exitCode = exitCode;
    this.command = redactedCommand;
    this.stderr = redactedStderr;
  }
}

function displayCommand(gitPath: string, args: readonly string[]): string {
  return [gitPath, ...args].map((argument) => JSON.stringify(argument)).join(' ');
}

export class GitRunner {
  constructor(private readonly gitPath = 'git') {}

  async run(
    repositoryRoot: string,
    args: readonly string[],
    options: GitRunOptions = {},
  ): Promise<GitResult> {
    const rawResult = await this.execute(repositoryRoot, args, options);
    return {
      stdout: redactSensitiveText(rawResult.stdout),
      stderr: redactSensitiveText(rawResult.stderr),
      exitCode: rawResult.exitCode,
    };
  }

  /**
   * 只供哈希、NUL 分隔路径等机器数据解析使用；调用方不得记录原始输出。
   */
  async runForMachineParsing(
    repositoryRoot: string,
    args: readonly string[],
  ): Promise<GitMachineOutput> {
    const rawResult = await this.execute(repositoryRoot, args);
    return { rawStdout: rawResult.stdout };
  }

  private async execute(
    repositoryRoot: string,
    args: readonly string[],
    options: GitRunOptions = {},
  ): Promise<GitResult> {
    const command = displayCommand(this.gitPath, args);

    return await new Promise<GitResult>((resolve, reject) => {
      const child = spawn(this.gitPath, args, {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          ...options.env,
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new GitCommandError(-1, command, error.message));
      });
      child.once('close', (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        const result: GitResult = {
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          exitCode: exitCode ?? -1,
        };

        if (result.exitCode !== 0 && options.allowFailure !== true) {
          reject(new GitCommandError(
            result.exitCode,
            command,
            result.stderr,
          ));
          return;
        }
        resolve(result);
      });

      child.stdin.end(options.stdin);
    });
  }
}
