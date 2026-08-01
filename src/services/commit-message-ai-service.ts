export type CommitMessageDensity = 'compact' | 'standard' | 'detailed';

export interface AiSelectedFileContext {
  readonly path: string;
  readonly status: string;
  readonly diff?: string;
}

export interface AiExcludedFile {
  readonly path: string;
  readonly reason: string;
}

export interface AiSelectedChangeContext {
  readonly files: readonly AiSelectedFileContext[];
  readonly excluded: readonly AiExcludedFile[];
}

export interface AiLanguageModel {
  readonly id: string;
  readonly maxInputTokens: number;
}

export interface GenerateCommitMessageRequest {
  readonly repositoryRoot: string;
  readonly selectedPaths: readonly string[];
  readonly density: CommitMessageDensity;
}

export interface GenerateCommitMessageResult {
  readonly message: string;
  readonly excluded: readonly AiExcludedFile[];
  readonly modelId: string;
}

export interface CommitMessageAiDependencies {
  readonly selectModels: () => Promise<readonly AiLanguageModel[]>;
  readonly readSelectedDiff: (
    request: Pick<GenerateCommitMessageRequest, 'repositoryRoot' | 'selectedPaths'>,
  ) => Promise<AiSelectedChangeContext>;
  readonly sendRequest: (
    model: AiLanguageModel,
    prompt: string,
    signal?: AbortSignal,
  ) => Promise<string>;
}

const densityInstructions: Readonly<Record<CommitMessageDensity, string>> = {
  compact: '只输出一行中文提交标题，不生成正文。',
  standard: '输出一行中文标题，并在正文列出 2–4 条关键变化。',
  detailed: '输出中文标题和详细正文，说明行为与兼容影响；不得虚构已执行的测试、部署或验收。',
};

export function buildCommitMessagePrompt(
  density: CommitMessageDensity,
  context: AiSelectedChangeContext,
): string {
  const files = context.files.map((file) => [
    `文件：${file.path}`,
    `状态：${file.status}`,
    ...(file.diff === undefined ? [] : ['差异：', file.diff]),
  ].join('\n')).join('\n\n');
  return [
    '请根据以下已选文件变更生成 Git 提交信息。',
    '使用简体中文，保持“类型：摘要”的风格。',
    '不得输出 Markdown 代码围栏，不得描述未提供的文件。',
    densityInstructions[density],
    '',
    files,
  ].join('\n');
}

export function normalizeGeneratedMessage(input: string): string {
  let normalized = input.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/u.exec(normalized);
  if (fenced?.[1] !== undefined) {
    normalized = fenced[1].trim();
  }
  if (normalized.length === 0) {
    throw new Error('AI 未生成有效的提交信息');
  }
  return normalized;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new Error('AI 提交信息生成已取消');
  }
}

export class CommitMessageAiService {
  constructor(private readonly dependencies: CommitMessageAiDependencies) {}

  async generate(
    request: GenerateCommitMessageRequest,
    signal?: AbortSignal,
  ): Promise<GenerateCommitMessageResult> {
    if (request.selectedPaths.length === 0) {
      throw new Error('至少选择一个文件后才能生成提交信息');
    }
    throwIfAborted(signal);
    const models = await this.dependencies.selectModels();
    const model = models[0];
    if (model === undefined) {
      throw new Error('VS Code 当前没有可用的 AI 模型');
    }
    const context = await this.dependencies.readSelectedDiff({
      repositoryRoot: request.repositoryRoot,
      selectedPaths: request.selectedPaths,
    });
    const prompt = buildCommitMessagePrompt(request.density, context);
    const response = await this.dependencies.sendRequest(model, prompt, signal);
    throwIfAborted(signal);
    return {
      message: normalizeGeneratedMessage(response),
      excluded: context.excluded,
      modelId: model.id,
    };
  }
}
