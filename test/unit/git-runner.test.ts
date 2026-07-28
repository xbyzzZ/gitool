import { describe, expect, it } from 'vitest';
import { GitRunner, redactSensitiveText } from '../../src/git/git-runner.js';

describe('redactSensitiveText', () => {
  it('遮蔽 URL 中的用户名、密码和令牌', () => {
    expect(redactSensitiveText(
      '推送 https://alice:secret@example.com/a.git?access_token=token123',
    )).toBe(
      '推送 https://***:***@example.com/a.git?access_token=***',
    );
  });
});

describe('GitRunner 安全诊断输出', () => {
  it('成功命令的标准输出和标准错误默认脱敏', async () => {
    const runner = new GitRunner(process.execPath);
    const result = await runner.run(process.cwd(), [
      '-e',
      [
        'process.stdout.write(',
        '"https://alice:secret@example.com/a.git?access_token=token123"',
        ');',
        'process.stderr.write(',
        '"https://bob:password@example.com/b.git?token=token456"',
        ');',
      ].join(''),
    ]);

    expect(result.stdout).toBe(
      'https://***:***@example.com/a.git?access_token=***',
    );
    expect(result.stderr).toBe(
      'https://***:***@example.com/b.git?token=***',
    );
  });

  it('允许失败命令的标准输出和标准错误仍然脱敏', async () => {
    const runner = new GitRunner(process.execPath);
    const result = await runner.run(process.cwd(), [
      '-e',
      [
        'process.stdout.write(',
        '"https://alice:secret@example.com/a.git?access_token=token123"',
        ');',
        'process.stderr.write(',
        '"https://bob:password@example.com/b.git?token=token456"',
        ');',
        'process.exitCode=7;',
      ].join(''),
    ], { allowFailure: true });

    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe(
      'https://***:***@example.com/a.git?access_token=***',
    );
    expect(result.stderr).toBe(
      'https://***:***@example.com/b.git?token=***',
    );
  });

  it('机器解析通过显式窄接口取得未经改写的标准输出', async () => {
    const runner = new GitRunner(process.execPath);
    const machineText =
      'https://alice:secret@example.com/path?access_token=token123\u0000';
    const result = await runner.runForMachineParsing(process.cwd(), [
      '-e',
      `process.stdout.write(${JSON.stringify(machineText)})`,
    ]);

    expect(result.rawStdout).toBe(machineText);
    expect(Object.keys(result)).toEqual(['rawStdout']);
  });
});
