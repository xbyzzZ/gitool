export interface ManualWorkspaceCommandInput {
  readonly codeCommand: string;
  readonly extensionDevelopmentPath: string;
  readonly workspaceFile: string;
  readonly userDataDirectory: string;
  readonly extensionsDirectory: string;
  readonly fixtureRoot: string;
}

export interface ManualWorkspaceCommands {
  readonly launch: string;
  readonly cleanup: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'"\'"\'')}'`;
}

export function manualWorkspaceCommands(
  input: ManualWorkspaceCommandInput,
): ManualWorkspaceCommands {
  return {
    launch: [
      shellQuote(input.codeCommand),
      '--new-window',
      shellQuote(`--user-data-dir=${input.userDataDirectory}`),
      shellQuote(`--extensions-dir=${input.extensionsDirectory}`),
      shellQuote(
        `--extensionDevelopmentPath=${input.extensionDevelopmentPath}`,
      ),
      shellQuote(input.workspaceFile),
    ].join(' '),
    cleanup: `npm run cleanup:vscode-gui -- ${
      shellQuote(input.fixtureRoot)
    }`,
  };
}
