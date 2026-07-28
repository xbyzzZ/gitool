export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface GitRunOptions {
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly allowFailure?: boolean;
}
