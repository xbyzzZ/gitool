import { describe, expect, it } from 'vitest';
import { manualWorkspaceCommands } from '../vscode/manual-workspace.js';

describe('隔离 GUI 验收命令', () => {
  it('生成隔离启动命令和单根目录清理命令', () => {
    const commands = manualWorkspaceCommands({
      codeCommand: '/Applications/Visual Studio Code.app/bin/code',
      extensionDevelopmentPath: '/workspace/gitool',
      workspaceFile: '/tmp/gt-g-a/workspace.code-workspace',
      userDataDirectory: '/tmp/gt-g-a/user data',
      extensionsDirectory: '/tmp/gt-g-a/extensions',
      fixtureRoot: '/tmp/gt-g-a',
    });

    expect(commands.launch).toBe(
      '\'/Applications/Visual Studio Code.app/bin/code\' --new-window '
      + '\'--user-data-dir=/tmp/gt-g-a/user data\' '
      + '\'--extensions-dir=/tmp/gt-g-a/extensions\' '
      + '\'--extensionDevelopmentPath=/workspace/gitool\' '
      + '\'/tmp/gt-g-a/workspace.code-workspace\'',
    );
    expect(commands.cleanup).toBe(
      'npm run cleanup:vscode-gui -- \'/tmp/gt-g-a\'',
    );
  });
});
