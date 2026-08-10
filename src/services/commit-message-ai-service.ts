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
  readonly name: string;
  readonly vendor: string;
  readonly family: string;
  readonly version: string;
  readonly maxInputTokens: number;
  readonly countTokens?: (
    text: string,
    signal?: AbortSignal,
  ) => Promise<number>;
}

export interface GenerateCommitMessageRequest {
  readonly repositoryRoot: string;
  readonly selectedPaths: readonly string[];
  readonly density: CommitMessageDensity;
  readonly modelId?: string;
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

function languageModelError(error: unknown): Error {
  const record = typeof error === 'object' && error !== null
    ? error as { readonly code?: unknown; readonly name?: unknown }
    : {};
  const code = typeof record.code === 'string'
    ? record.code
    : typeof record.name === 'string'
      ? record.name
      : '';
  if (code.includes('NoPermissions')) {
    return new Error('未授权 Gitool 使用 VS Code AI 模型，请在授权提示中允许后重试');
  }
  if (code.includes('Blocked')) {
    return new Error('VS Code AI 模型当前不可用或已达到使用限制，请稍后重试');
  }
  if (code.includes('NotFound')) {
    return new Error('所选 VS Code AI 模型已不可用，请重新生成');
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function fitPromptToModel(
  density: CommitMessageDensity,
  context: AiSelectedChangeContext,
  model: AiLanguageModel,
  signal?: AbortSignal,
): Promise<string> {
  let maximumDiffLength = 64 * 1024;
  let prompt = buildCommitMessagePrompt(density, context);
  if (model.countTokens === undefined) {
    return prompt;
  }
  const tokenLimit = Math.max(256, Math.floor(model.maxInputTokens * 0.8));
  while (await model.countTokens(prompt, signal) > tokenLimit
    && maximumDiffLength > 1024) {
    throwIfAborted(signal);
    maximumDiffLength = Math.floor(maximumDiffLength / 2);
    prompt = buildCommitMessagePrompt(density, {
      ...context,
      files: context.files.map((file) => file.diff === undefined
        ? file
        : {
            ...file,
            diff: file.diff.length <= maximumDiffLength
              ? file.diff
              : `${file.diff.slice(0, maximumDiffLength)}\n[差异已按模型上下文限制截断]`,
          }),
    });
  }
  if (await model.countTokens(prompt, signal) > tokenLimit) {
    throw new Error('所选变更超过当前 VS Code AI 模型的上下文限制，请减少文件后重试');
  }
  return prompt;
}

export class CommitMessageAiService {
  constructor(private readonly dependencies: CommitMessageAiDependencies) {}

  async listModels(): Promise<readonly AiLanguageModel[]> {
    return await this.dependencies.selectModels();
  }

  async generate(
    request: GenerateCommitMessageRequest,
    signal?: AbortSignal,
  ): Promise<GenerateCommitMessageResult> {
    if (request.selectedPaths.length === 0) {
      throw new Error('至少选择一个文件后才能生成提交信息');
    }
    throwIfAborted(signal);
    const models = await this.listModels();
    const model = request.modelId === undefined
      ? (models.find((candidate) => candidate.vendor === 'copilot') ?? models[0])
      : models.find((candidate) => candidate.id === request.modelId);
    if (model === undefined) {
      if (request.modelId !== undefined) {
        throw new Error('此前选择的 VS Code AI 模型已不可用，请重新选择模型');
      }
      throw new Error('VS Code 当前没有可用的 AI 模型');
    }
    const context = await this.dependencies.readSelectedDiff({
      repositoryRoot: request.repositoryRoot,
      selectedPaths: request.selectedPaths,
    });
    const prompt = await fitPromptToModel(
      request.density,
      context,
      model,
      signal,
    );
    let response: string;
    try {
      response = await this.dependencies.sendRequest(model, prompt, signal);
    } catch (error) {
      throw languageModelError(error);
    }
    throwIfAborted(signal);
    return {
      message: normalizeGeneratedMessage(response),
      excluded: context.excluded,
      modelId: model.id,
    };
  }
}
