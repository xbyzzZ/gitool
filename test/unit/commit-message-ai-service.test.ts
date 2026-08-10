import { describe, expect, it, vi } from 'vitest';
import {
  buildCommitMessagePrompt,
  CommitMessageAiService,
  normalizeGeneratedMessage,
  type AiSelectedChangeContext,
} from '../../src/services/commit-message-ai-service.js';

const context: AiSelectedChangeContext = {
  files: [{ path: 'src/a.ts', status: 'M', diff: '+export const a = 1;' }],
  excluded: [],
};

describe('AI 提交信息服务', () => {
  it('为三档密度生成互不混淆的中文约束', () => {
    expect(buildCommitMessagePrompt('compact', context)).toContain('只输出一行');
    expect(buildCommitMessagePrompt('standard', context)).toContain('2–4 条');
    expect(buildCommitMessagePrompt('detailed', context)).toContain(
      '不得虚构已执行的测试',
    );
  });

  it('提示中只包含传入的已选文件上下文', () => {
    const prompt = buildCommitMessagePrompt('compact', context);

    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('+export const a = 1;');
    expect(prompt).not.toContain('unselected.ts');
  });

  it('清理 Markdown 围栏并拒绝空结果', () => {
    expect(normalizeGeneratedMessage('```text\n修复：示例\n```')).toBe(
      '修复：示例',
    );
    expect(() => normalizeGeneratedMessage('   ')).toThrow(
      'AI 未生成有效的提交信息',
    );
  });

  it('没有可用模型时返回明确错误且不发送请求', async () => {
    const sendRequest = vi.fn();
    const service = new CommitMessageAiService({
      selectModels: () => Promise.resolve([]),
      readSelectedDiff: () => Promise.resolve(context),
      sendRequest,
    });

    await expect(service.generate({
      repositoryRoot: '/repo',
      selectedPaths: ['src/a.ts'],
      density: 'compact',
    })).rejects.toThrow('VS Code 当前没有可用的 AI 模型');
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('使用第一个可用模型并返回可编辑文本和排除清单', async () => {
    const excludedContext: AiSelectedChangeContext = {
      ...context,
      excluded: [{ path: 'large.bin', reason: '二进制文件' }],
    };
    const model = {
      id: 'model-1',
      name: '模型一',
      vendor: 'copilot',
      family: 'family-1',
      version: '1',
      maxInputTokens: 8192,
    };
    const sendRequest = vi.fn(() => Promise.resolve('修复：更新提交工作台'));
    const service = new CommitMessageAiService({
      selectModels: () => Promise.resolve([model]),
      readSelectedDiff: () => Promise.resolve(excludedContext),
      sendRequest,
    });

    await expect(service.generate({
      repositoryRoot: '/repo',
      selectedPaths: ['src/a.ts', 'large.bin'],
      density: 'standard',
    })).resolves.toEqual({
      message: '修复：更新提交工作台',
      excluded: [{ path: 'large.bin', reason: '二进制文件' }],
      modelId: 'model-1',
    });
    expect(sendRequest).toHaveBeenCalledOnce();
  });

  it('枚举可供用户选择的模型描述', async () => {
    const models = [{
      id: 'model-1',
      name: '模型一',
      vendor: 'copilot',
      family: 'family-1',
      version: '1',
      maxInputTokens: 8192,
    }];
    const service = new CommitMessageAiService({
      selectModels: () => Promise.resolve(models),
      readSelectedDiff: () => Promise.resolve(context),
      sendRequest: () => Promise.resolve('不会使用'),
    });

    await expect(service.listModels()).resolves.toEqual(models);
  });

  it('严格使用用户指定的可用模型', async () => {
    const models = [
      {
        id: 'model-1', name: '模型一', vendor: 'copilot',
        family: 'family-1', version: '1', maxInputTokens: 8192,
      },
      {
        id: 'model-2', name: '模型二', vendor: 'copilot',
        family: 'family-2', version: '2', maxInputTokens: 16_384,
      },
    ];
    const sendRequest = vi.fn(() => Promise.resolve('功能：指定模型'));
    const service = new CommitMessageAiService({
      selectModels: () => Promise.resolve(models),
      readSelectedDiff: () => Promise.resolve(context),
      sendRequest,
    });

    await expect(service.generate({
      repositoryRoot: '/repo',
      selectedPaths: ['src/a.ts'],
      density: 'standard',
      modelId: 'model-2',
    })).resolves.toMatchObject({ modelId: 'model-2' });
    expect(sendRequest).toHaveBeenCalledWith(
      models[1],
      expect.any(String),
      undefined,
    );
  });

  it('自动模式在全部可用模型中优先使用 Copilot', async () => {
    const models = [
      {
        id: 'other-model', name: '其他模型', vendor: 'other',
        family: 'family-1', version: '1', maxInputTokens: 8192,
      },
      {
        id: 'copilot-model', name: 'Copilot 模型', vendor: 'copilot',
        family: 'family-2', version: '2', maxInputTokens: 16_384,
      },
    ];
    const sendRequest = vi.fn(() => Promise.resolve('功能：自动模型'));
    const service = new CommitMessageAiService({
      selectModels: () => Promise.resolve(models),
      readSelectedDiff: () => Promise.resolve(context),
      sendRequest,
    });

    await expect(service.generate({
      repositoryRoot: '/repo',
      selectedPaths: ['src/a.ts'],
      density: 'standard',
    })).resolves.toMatchObject({ modelId: 'copilot-model' });
    expect(sendRequest).toHaveBeenCalledWith(
      models[1],
      expect.any(String),
      undefined,
    );
  });

  it('用户指定的模型失效时拒绝静默切换', async () => {
    const sendRequest = vi.fn();
    const service = new CommitMessageAiService({
      selectModels: () => Promise.resolve([{
        id: 'model-1', name: '模型一', vendor: 'copilot',
        family: 'family-1', version: '1', maxInputTokens: 8192,
      }]),
      readSelectedDiff: () => Promise.resolve(context),
      sendRequest,
    });

    await expect(service.generate({
      repositoryRoot: '/repo',
      selectedPaths: ['src/a.ts'],
      density: 'standard',
      modelId: 'model-2',
    })).rejects.toThrow('此前选择的 VS Code AI 模型已不可用');
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('拒绝没有已选文件的生成请求', async () => {
    const service = new CommitMessageAiService({
      selectModels: () => Promise.resolve([{
        id: 'model', name: '模型', vendor: 'copilot',
        family: 'family', version: '1', maxInputTokens: 8192,
      }]),
      readSelectedDiff: () => Promise.resolve(context),
      sendRequest: () => Promise.resolve('不会使用'),
    });

    await expect(service.generate({
      repositoryRoot: '/repo',
      selectedPaths: [],
      density: 'compact',
    })).rejects.toThrow('至少选择一个文件后才能生成提交信息');
  });
});
