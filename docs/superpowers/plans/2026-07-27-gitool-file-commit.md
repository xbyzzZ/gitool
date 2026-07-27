# Gitool 文件提交插件实施计划

> **面向智能代理执行者：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐任务实施本计划。所有步骤使用复选框跟踪。

**目标：** 构建一个可安装的桌面版 VS Code 插件，在独立侧边栏中安全地按文件选择、提交、推送和舍弃未跟踪文件。

**架构：** Webview 只负责界面和声明式消息，扩展主机负责仓库状态、写操作互斥、Git 命令、废纸篓和 VS Code 内置 Git API。提交使用 `git commit --only` 严格限定路径，推送使用内置 Git API 复用认证。

**技术栈：** TypeScript 6.0.3、Node.js 22、VS Code API 1.125、esbuild 0.28.1、Vitest 4.1.10、ESLint 10.8、`@vscode/test-electron` 3.1、`@vscode/vsce` 3.9.2。

## 全局约束

- 插件名称为 `Gitool`，中文显示名为“Gitool 文件提交”。
- 只支持桌面版 VS Code 1.125.0 及以上，不声明 `browser` 入口。
- 支持 macOS、Windows、Linux，以及 SSH、WSL、Dev Container 扩展主机。
- 所有用户可见文案、代码注释、README、CHANGELOG 和 Git 提交信息使用简体中文。
- 首版只支持按文件提交，不支持同一文件内部按代码块提交。
- 已跟踪变更首次默认选中；未跟踪文件首次和刷新后默认不自动选中。
- 未跟踪文件只能在二次确认后移入系统废纸篓。
- 未选文件的工作区内容和暂存状态必须保持不变。
- 被选文件按当前完整内容提交，其自身暂存和未暂存区分被提交消耗。
- 所有 Git 调用使用参数数组，不经过 Shell。
- 工作区未受信任、仓库存在冲突或状态版本过期时禁止写操作。
- 不使用 `reset --hard`、`checkout`、静默失败或自动回滚已成功创建的提交。
- 所有远程 URL、Git 错误和日志必须遮蔽凭据。
- 每个任务严格执行测试先行：先观察目标测试因缺少行为而失败，再写最小实现。

---

## 文件结构

```text
.
├── .gitignore
├── .vscodeignore
├── CHANGELOG.md
├── README.md
├── eslint.config.mjs
├── esbuild.mjs
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── media/
│   ├── icon.svg
│   ├── main.css
│   └── main.js                 # esbuild 生成，不提交源映射
├── src/
│   ├── extension.ts
│   ├── domain/
│   │   ├── change-model.ts
│   │   ├── selection-store.ts
│   │   └── view-model.ts
│   ├── git/
│   │   ├── builtin-git-api.ts
│   │   ├── git-runner.ts
│   │   └── git-types.ts
│   ├── services/
│   │   ├── commit-service.ts
│   │   ├── operation-lock.ts
│   │   ├── push-service.ts
│   │   ├── remote-service.ts
│   │   ├── repository-service.ts
│   │   └── trash-service.ts
│   └── webview/
│       ├── client.ts
│       ├── messages.ts
│       ├── render.ts
│       └── view-provider.ts
├── test/
│   ├── helpers/
│   │   ├── git-repository.ts
│   │   └── test-doubles.ts
│   ├── integration/
│   │   ├── commit-service.test.ts
│   │   └── remote-push.test.ts
│   ├── unit/
│   │   ├── change-model.test.ts
│   │   ├── git-runner.test.ts
│   │   ├── messages.test.ts
│   │   ├── operation-lock.test.ts
│   │   ├── render.test.ts
│   │   ├── repository-service.test.ts
│   │   ├── selection-store.test.ts
│   │   └── trash-service.test.ts
│   └── vscode/
│       ├── run-tests.ts
│       └── suite/
│           ├── extension.test.ts
│           └── index.ts
└── docs/superpowers/
    ├── plans/2026-07-27-gitool-file-commit.md
    └── specs/2026-07-27-gitool-file-commit-design.md
```

---

### 任务 1：建立可复现工具链和变更领域模型

**文件：**

- 创建：`package.json`
- 创建：`package-lock.json`
- 创建：`tsconfig.json`
- 创建：`vitest.config.ts`
- 创建：`eslint.config.mjs`
- 创建：`esbuild.mjs`
- 创建：`.gitignore`
- 创建：`.vscodeignore`
- 创建：`src/domain/change-model.ts`
- 测试：`test/unit/change-model.test.ts`

**接口：**

- 产出：`ChangeKind`、`ChangeLayer`、`RawChange`、`FileChange`。
- 产出：`mergeChanges(indexChanges, workingChanges, untrackedChanges): FileChange[]`。
- 规则：重命名项同时保留 `path` 和 `originalPath`；同一路径暂存和未暂存状态合并成一个条目。

- [ ] **步骤 1：创建工具链配置**

`package.json` 使用以下关键内容：

```json
{
  "name": "gitool-file-commit",
  "displayName": "Gitool 文件提交",
  "description": "像 PyCharm 一样按文件选择、提交和推送 Git 变更",
  "version": "0.1.0",
  "publisher": "xbyzzz",
  "license": "MIT",
  "engines": {
    "vscode": "^1.125.0"
  },
  "categories": ["SCM Providers"],
  "activationEvents": ["onView:gitool.commitView"],
  "main": "./dist/extension.js",
  "scripts": {
    "vscode:prepublish": "npm run build",
    "clean": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true});require('node:fs').rmSync('media/main.js',{force:true})\"",
    "check": "npm run typecheck && npm run lint && npm test",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:vscode": "npm run build && node ./dist/test/vscode/run-tests.js",
    "build": "node esbuild.mjs",
    "package": "npm run check && npm run build && vsce package --no-dependencies"
  },
  "devDependencies": {
    "@types/mocha": "10.0.10",
    "@types/node": "26.1.1",
    "@types/vscode": "1.125.0",
    "@vscode/test-electron": "3.1.0",
    "@vscode/vsce": "3.9.2",
    "esbuild": "0.28.1",
    "eslint": "10.8.0",
    "mocha": "11.7.6",
    "typescript": "6.0.3",
    "typescript-eslint": "8.65.0",
    "vitest": "4.1.10"
  }
}
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["node", "vscode", "mocha"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'test/unit/**/*.test.ts',
      'test/integration/**/*.test.ts',
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
```

`eslint.config.mjs`：

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'media/main.js', 'coverage/**', '.vscode-test/**'],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
```

`esbuild.mjs` 使用 `build` 分三组输出：

```js
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

const builds = [];

if (existsSync('src/extension.ts')) {
  builds.push(build({
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    sourcemap: false,
    target: 'node22',
  }));
}

if (existsSync('src/webview/client.ts')) {
  builds.push(build({
    entryPoints: ['src/webview/client.ts'],
    outfile: 'media/main.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    sourcemap: false,
    target: 'es2022',
  }));
}

const vscodeTestEntries = [
  'test/vscode/run-tests.ts',
  'test/vscode/suite/index.ts',
  'test/vscode/suite/extension.test.ts',
].filter(existsSync);

if (vscodeTestEntries.length > 0) {
  builds.push(build({
    entryPoints: vscodeTestEntries,
    outbase: '.',
    outdir: 'dist',
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    sourcemap: false,
    target: 'node22',
  }));
}

await Promise.all(builds);
```

`.gitignore`：

```gitignore
node_modules/
dist/
media/main.js
coverage/
.vscode-test/
*.vsix
.DS_Store
```

`.vscodeignore`：

```gitignore
.git/**
.vscode-test/**
coverage/**
docs/**
src/**
test/**
node_modules/**
*.map
eslint.config.mjs
esbuild.mjs
tsconfig.json
vitest.config.ts
```

- [ ] **步骤 2：安装依赖并生成锁文件**

运行：

```bash
npm install
```

预期：退出码为 0，生成 `package-lock.json`，锁文件中 TypeScript 为 6.0.3。

- [ ] **步骤 3：先写变更合并失败测试**

`test/unit/change-model.test.ts` 至少包含：

```ts
import { describe, expect, it } from 'vitest';
import { mergeChanges } from '../../src/domain/change-model.js';

describe('mergeChanges', () => {
  it('把同一路径的暂存和未暂存修改合并为双状态文件', () => {
    const result = mergeChanges(
      [{ path: 'src/a.ts', kind: 'modified', layer: 'index' }],
      [{ path: 'src/a.ts', kind: 'modified', layer: 'working' }],
      [],
    );

    expect(result).toEqual([{
      id: 'src/a.ts',
      path: 'src/a.ts',
      kind: 'modified',
      staged: true,
      unstaged: true,
      untracked: false,
      conflicted: false,
      commitPaths: ['src/a.ts'],
    }]);
  });

  it('重命名文件的提交路径同时包含旧路径和新路径', () => {
    const result = mergeChanges(
      [],
      [{
        path: 'src/new.ts',
        originalPath: 'src/old.ts',
        kind: 'renamed',
        layer: 'working',
      }],
      [],
    );

    expect(result[0]?.commitPaths).toEqual(['src/old.ts', 'src/new.ts']);
  });
});
```

- [ ] **步骤 4：运行测试确认因缺少领域实现而失败**

运行：

```bash
npx vitest run test/unit/change-model.test.ts
```

预期：失败原因为无法导入 `src/domain/change-model.ts`，不是配置或语法错误。

- [ ] **步骤 5：实现最小领域模型**

`src/domain/change-model.ts` 定义：

```ts
export type ChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'type-changed'
  | 'conflicted'
  | 'untracked';

export type ChangeLayer = 'index' | 'working' | 'untracked';

export interface RawChange {
  readonly path: string;
  readonly originalPath?: string;
  readonly kind: ChangeKind;
  readonly layer: ChangeLayer;
}

export interface FileChange {
  readonly id: string;
  readonly path: string;
  readonly originalPath?: string;
  readonly kind: ChangeKind;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflicted: boolean;
  readonly commitPaths: readonly string[];
}

export function mergeChanges(
  indexChanges: readonly RawChange[],
  workingChanges: readonly RawChange[],
  untrackedChanges: readonly RawChange[],
): FileChange[] {
  // 按 path 合并；重命名条目的 commitPaths 为旧路径和新路径。
}
```

实现必须按路径稳定排序，并拒绝绝对路径、空路径和包含 NUL 的路径。

- [ ] **步骤 6：运行本任务验证**

运行：

```bash
npx vitest run test/unit/change-model.test.ts
npm run typecheck
npm run lint
```

预期：全部退出码为 0，无错误和警告。

- [ ] **步骤 7：提交任务 1**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts eslint.config.mjs esbuild.mjs .gitignore .vscodeignore src/domain/change-model.ts test/unit/change-model.test.ts
git commit -m "构建：建立插件工具链和变更模型"
```

---

### 任务 2：实现选择状态和仓库视图模型

**文件：**

- 创建：`src/domain/selection-store.ts`
- 创建：`src/domain/view-model.ts`
- 测试：`test/unit/selection-store.test.ts`

**接口：**

- 消耗：`FileChange`。
- 产出：`SelectionStore.reconcile(repositoryId, changes): ReadonlySet<string>`。
- 产出：`SelectionStore.setSelected(repositoryId, fileId, selected): void`。
- 产出：`SelectionStore.setGroup(repositoryId, fileIds, selected): void`。
- 产出：`RepositoryViewModel`、`RepositoryOption`、`OperationState`。

- [ ] **步骤 1：写默认选择和刷新保留的失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { SelectionStore } from '../../src/domain/selection-store.js';
import type { FileChange } from '../../src/domain/change-model.js';

const tracked = (path: string): FileChange => ({
  id: path,
  path,
  kind: 'modified',
  staged: false,
  unstaged: true,
  untracked: false,
  conflicted: false,
  commitPaths: [path],
});

const untracked = (path: string): FileChange => ({
  ...tracked(path),
  kind: 'untracked',
  untracked: true,
});

describe('SelectionStore', () => {
  it('首次选择已跟踪文件但不选择未跟踪文件', () => {
    const store = new SelectionStore();
    expect([...store.reconcile('repo', [
      tracked('a.ts'),
      untracked('secret.env'),
    ])]).toEqual(['a.ts']);
  });

  it('刷新保留人工取消并让新未跟踪文件保持未选', () => {
    const store = new SelectionStore();
    store.reconcile('repo', [tracked('a.ts')]);
    store.setSelected('repo', 'a.ts', false);

    expect([...store.reconcile('repo', [
      tracked('a.ts'),
      untracked('new.txt'),
    ])]).toEqual([]);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npx vitest run test/unit/selection-store.test.ts
```

预期：失败原因为 `SelectionStore` 尚未实现。

- [ ] **步骤 3：实现仓库隔离的选择存储**

实现时每个仓库保存：

```ts
interface RepositorySelection {
  knownIds: Set<string>;
  selectedIds: Set<string>;
  manuallyTouchedIds: Set<string>;
}
```

`reconcile` 规则：

- 移除已消失文件的全部状态。
- 新已跟踪且不冲突的文件默认选中。
- 新未跟踪或冲突文件默认不选中。
- 人工操作过且仍存在的文件保留选择。

- [ ] **步骤 4：定义传给 Webview 的只读视图模型**

`src/domain/view-model.ts` 至少包含：

```ts
export type OperationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly action: 'commit' | 'push' | 'trash' | 'remote' }
  | { readonly kind: 'commit-succeeded'; readonly commitHash: string }
  | { readonly kind: 'push-failed'; readonly commitHash: string; readonly message: string }
  | { readonly kind: 'failed'; readonly action: string; readonly message: string };

export interface RepositoryOption {
  readonly id: string;
  readonly label: string;
  readonly rootPath: string;
}

export interface RepositoryViewModel {
  readonly version: number;
  readonly trusted: boolean;
  readonly currentRepositoryId?: string;
  readonly repositories: readonly RepositoryOption[];
  readonly branch?: string;
  readonly upstream?: string;
  readonly detached: boolean;
  readonly changes: readonly FileChange[];
  readonly selectedIds: readonly string[];
  readonly commitMessage: string;
  readonly operation: OperationState;
}
```

- [ ] **步骤 5：运行本任务验证并提交**

```bash
npx vitest run test/unit/selection-store.test.ts
npm run typecheck
npm run lint
git add src/domain/selection-store.ts src/domain/view-model.ts test/unit/selection-store.test.ts
git commit -m "功能：实现文件选择和仓库视图状态"
```

---

### 任务 3：实现安全 Git 运行器和严格按路径提交

**文件：**

- 创建：`src/git/git-runner.ts`
- 创建：`src/git/git-types.ts`
- 创建：`src/services/commit-service.ts`
- 创建：`test/helpers/git-repository.ts`
- 测试：`test/unit/git-runner.test.ts`
- 测试：`test/integration/commit-service.test.ts`

**接口：**

- 产出：`GitRunner.run(repositoryRoot, args, options?): Promise<GitResult>`。
- 产出：`GitCommandError`，包含退出码、脱敏命令、脱敏标准错误。
- 产出：`redactSensitiveText(text): string`。
- 产出：`CommitService.commit(request): Promise<CommitResult>`。
- `CommitRequest` 包含仓库根目录、消息、文件项和状态版本复核函数。

- [ ] **步骤 1：创建真实 Git 测试助手**

`test/helpers/git-repository.ts` 提供：

```ts
export interface TestRepository {
  readonly root: string;
  write(relativePath: string, content: string): Promise<void>;
  remove(relativePath: string): Promise<void>;
  git(...args: string[]): Promise<string>;
  status(): Promise<string>;
  dispose(): Promise<void>;
}

export async function createTestRepository(): Promise<TestRepository>;
```

助手使用 `fs.mkdtemp` 创建临时目录，执行 `git init -b main`，只设置本地测试用户名和邮箱。`dispose` 只删除由该助手创建并验证过前缀的临时目录。

- [ ] **步骤 2：写严格提交的失败集成测试**

测试必须先覆盖核心风险：

```ts
it('只提交所选文件并保留未选文件的暂存内容', async () => {
  const repo = await createTestRepository();
  await repo.write('selected.txt', '初始\n');
  await repo.write('staged.txt', '初始\n');
  await repo.git('add', '.');
  await repo.git('commit', '-m', '初始提交');

  await repo.write('selected.txt', '本次提交\n');
  await repo.write('staged.txt', '保留暂存\n');
  await repo.git('add', 'staged.txt');

  const service = new CommitService(new GitRunner());
  const result = await service.commit({
    repositoryRoot: repo.root,
    message: '只提交选择项',
    expectedVersion: 1,
    verifyVersion: async () => true,
    files: [{
      id: 'selected.txt',
      path: 'selected.txt',
      kind: 'modified',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      commitPaths: ['selected.txt'],
    }],
  });

  expect(result.committedPaths).toEqual(['selected.txt']);
  expect(await repo.git('diff', '--cached', '--name-only')).toBe('staged.txt');
});
```

再写三个独立测试：

- 选中的未跟踪文件被提交，未选中的仍为未跟踪。
- 提交钩子返回非零时，选中的未跟踪文件恢复为未跟踪且工作区内容不变。
- 空格、中文和以短横线开头的文件名不会被解释为参数。

`test/unit/git-runner.test.ts` 验证 URL 凭据脱敏：

```ts
it('遮蔽 URL 中的用户名、密码和令牌', () => {
  expect(redactSensitiveText(
    '推送 https://alice:secret@example.com/a.git?access_token=token123',
  )).toBe(
    '推送 https://***:***@example.com/a.git?access_token=***',
  );
});
```

- [ ] **步骤 3：运行测试确认缺少实现**

```bash
npx vitest run test/unit/git-runner.test.ts test/integration/commit-service.test.ts
```

预期：失败原因为 `GitRunner` 或 `CommitService` 不存在。

- [ ] **步骤 4：实现无 Shell 的 Git 运行器**

`src/git/git-runner.ts` 使用 `child_process.spawn`：

```ts
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

export class GitRunner {
  constructor(private readonly gitPath = 'git') {}

  async run(
    repositoryRoot: string,
    args: readonly string[],
    options: GitRunOptions = {},
  ): Promise<GitResult>;
}
```

实现要求：

- `shell: false`。
- 工作目录固定为仓库根目录。
- 环境变量在 `process.env` 基础上合并，不替换必要系统变量。
- 收集标准输出和标准错误。
- 非零退出码默认抛出 `GitCommandError`。
- 错误对象在构造时调用统一 `redactSensitiveText`。

- [ ] **步骤 5：实现提交服务的最小安全事务**

`src/services/commit-service.ts` 定义：

```ts
export interface CommitRequest {
  readonly repositoryRoot: string;
  readonly message: string;
  readonly expectedVersion: number;
  readonly verifyVersion: (expectedVersion: number) => Promise<boolean>;
  readonly files: readonly FileChange[];
}

export interface CommitResult {
  readonly commitHash: string;
  readonly committedPaths: readonly string[];
}

export class CommitService {
  constructor(private readonly git: GitRunner) {}
  async commit(request: CommitRequest): Promise<CommitResult>;
}
```

实现顺序固定：

1. 校验消息、文件集合、冲突和状态版本。
2. 将 `commitPaths` 去重并稳定排序。
3. 对选中的未跟踪路径运行 `git add --intent-to-add -- <paths>`。
4. 使用 `mkdtemp` 创建临时目录，消息文件权限设为 `0o600`。
5. 运行 `git commit --only --file <message-file> -- <commitPaths>`。
6. 读取 `git rev-parse HEAD`。
7. 使用 `git diff-tree --root --no-commit-id --name-status -r -z HEAD` 解析实际路径。
8. 规范化重命名的旧、新路径后与预期路径集合严格相等比较。
9. `finally` 删除临时目录。

提交失败且存在原未跟踪路径时，运行：

```text
git rm --cached --quiet --ignore-unmatch -- <原未跟踪路径>
```

该清理只操作索引，不删除工作区文件。若主错误和清理错误同时发生，抛出的错误必须同时包含两个阶段，不能丢失根因。

- [ ] **步骤 6：运行红绿验证**

```bash
npx vitest run test/unit/git-runner.test.ts test/integration/commit-service.test.ts
npm run typecheck
npm run lint
```

预期：所有提交集成测试通过，测试临时目录全部清理。

- [ ] **步骤 7：提交任务 3**

```bash
git add src/git/git-runner.ts src/git/git-types.ts src/services/commit-service.ts test/helpers/git-repository.ts test/unit/git-runner.test.ts test/integration/commit-service.test.ts
git commit -m "功能：实现安全的按文件提交"
```

---

### 任务 4：实现远程 URL 修改和推送状态机

**文件：**

- 创建：`src/git/builtin-git-api.ts`
- 创建：`src/services/remote-service.ts`
- 创建：`src/services/push-service.ts`
- 创建：`test/helpers/test-doubles.ts`
- 测试：`test/integration/remote-push.test.ts`

**接口：**

- 产出：只包含本插件所需成员的 `BuiltinGitApi`、`BuiltinRepository` 类型。
- 产出：`RemoteService.getRemotes(root)`、`RemoteService.setUrl(root, name, url)`。
- 产出：`PushService.push(repository, request): Promise<PushResult>`。

- [ ] **步骤 1：写远程修改失败测试**

```ts
it('修改已有远程 URL 后重新读取结果', async () => {
  const repo = await createTestRepository();
  const remoteA = await createBareRemote();
  const remoteB = await createBareRemote();
  await repo.git('remote', 'add', 'origin', remoteA);

  const service = new RemoteService(new GitRunner());
  const result = await service.setUrl(repo.root, 'origin', remoteB);

  expect(result.name).toBe('origin');
  expect(result.url).toBe(remoteB);
  expect(await repo.git('remote', 'get-url', 'origin')).toBe(remoteB);
});

it('拒绝修改不存在的远程', async () => {
  const repo = await createTestRepository();
  const service = new RemoteService(new GitRunner());

  await expect(service.setUrl(repo.root, 'missing', 'https://example.com/a.git'))
    .rejects.toThrow('远程 missing 不存在');
});
```

- [ ] **步骤 2：写推送状态机失败测试**

使用 `FakeBuiltinRepository` 记录 `push` 参数：

```ts
it('无上游时推送同名分支并建立上游', async () => {
  const repository = new FakeBuiltinRepository({
    head: { name: 'feature/a' },
    remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git' }],
  });
  const service = new PushService();

  await service.push(repository, {
    selectedRemote: 'origin',
    localBranch: 'feature/a',
  });

  expect(repository.pushCalls).toEqual([{
    remoteName: 'origin',
    branchName: 'feature/a',
    setUpstream: true,
  }]);
});
```

另写测试确认已有上游时使用上游远程和分支；游离 `HEAD` 在调用 API 前失败。

- [ ] **步骤 3：运行测试确认失败**

```bash
npx vitest run test/integration/remote-push.test.ts
```

预期：失败原因为远程和推送服务尚未实现。

- [ ] **步骤 4：定义最小内置 Git API 边界**

`src/git/builtin-git-api.ts` 不复制整个 VS Code Git 类型，只定义：

```ts
export interface BuiltinRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface BuiltinHead {
  readonly name?: string;
  readonly upstream?: { readonly remote: string; readonly name: string };
}

export interface BuiltinRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD?: BuiltinHead;
    readonly remotes: readonly BuiltinRemote[];
    readonly indexChanges: readonly BuiltinChange[];
    readonly workingTreeChanges: readonly BuiltinChange[];
    readonly untrackedChanges: readonly BuiltinChange[];
    readonly mergeChanges: readonly BuiltinChange[];
    readonly onDidChange: vscode.Event<void>;
  };
  status(): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
}

export interface BuiltinGitApi {
  readonly git: { readonly path: string };
  readonly repositories: readonly BuiltinRepository[];
  readonly onDidOpenRepository: vscode.Event<BuiltinRepository>;
  readonly onDidCloseRepository: vscode.Event<BuiltinRepository>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}
```

扩展激活时通过 `vscode.extensions.getExtension('vscode.git')` 获取版本 1 API，并在禁用或缺失时返回中文错误。

- [ ] **步骤 5：实现远程和推送服务**

远程修改使用：

```text
git remote
git remote set-url <remote-name> <new-url>
git remote get-url <remote-name>
```

远程名必须先与 `git remote` 返回的精确条目匹配。新 URL 不能为空。写后读取不一致时抛出错误。

`PushService` 返回：

```ts
export type PushResult =
  | { readonly kind: 'pushed'; readonly remote: string; readonly branch: string }
  | { readonly kind: 'needs-remote'; readonly remotes: readonly string[] };
```

已有上游直接调用 `push(upstream.remote, upstream.name, false)`；无上游且尚未选择远程时返回 `needs-remote`；选择后调用 `push(remote, localBranch, true)`。

- [ ] **步骤 6：运行验证并提交**

```bash
npx vitest run test/integration/remote-push.test.ts
npm run typecheck
npm run lint
git add src/git/builtin-git-api.ts src/services/remote-service.ts src/services/push-service.ts test/helpers/test-doubles.ts test/integration/remote-push.test.ts
git commit -m "功能：实现远程修改和安全推送"
```

---

### 任务 5：实现仓库写锁和废纸篓服务

**文件：**

- 创建：`src/services/operation-lock.ts`
- 创建：`src/services/trash-service.ts`
- 测试：`test/unit/operation-lock.test.ts`
- 测试：`test/unit/trash-service.test.ts`

**接口：**

- 产出：`RepositoryOperationLock.runExclusive(repositoryId, action): Promise<T>`。
- 产出：`TrashService.moveToTrash(repositoryRoot, relativePaths): Promise<TrashResult>`。

- [ ] **步骤 1：写同仓库互斥和跨仓库并行的失败测试**

```ts
it('同一仓库有写操作时拒绝第二个写操作', async () => {
  const lock = new RepositoryOperationLock();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const first = lock.runExclusive('repo-a', async () => pending);

  await expect(lock.runExclusive('repo-a', async () => undefined))
    .rejects.toThrow('仓库正在执行写操作');

  release();
  await first;
});

it('不同仓库可以并行执行', async () => {
  const lock = new RepositoryOperationLock();
  await expect(Promise.all([
    lock.runExclusive('repo-a', async () => 'a'),
    lock.runExclusive('repo-b', async () => 'b'),
  ])).resolves.toEqual(['a', 'b']);
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
npx vitest run test/unit/operation-lock.test.ts test/unit/trash-service.test.ts
```

预期：失败原因为写锁尚未实现。

- [ ] **步骤 3：写废纸篓边界的失败测试**

使用注入的文件系统替身验证：

```ts
it('只把仓库内的具体文件移入废纸篓', async () => {
  const deleted: Array<{ path: string; useTrash: boolean }> = [];
  const service = new TrashService({
    confirm: async () => true,
    delete: async (uri, options) => {
      deleted.push({ path: uri.fsPath, useTrash: options.useTrash });
    },
  });

  const result = await service.moveToTrash('/workspace/repo', ['tmp/a.txt']);

  expect(result).toEqual({ kind: 'completed', succeeded: ['tmp/a.txt'], failed: [] });
  expect(deleted).toEqual([{
    path: '/workspace/repo/tmp/a.txt',
    useTrash: true,
  }]);
});

it('拒绝仓库外路径和目录递归删除', async () => {
  const service = new TrashService({
    confirm: async () => true,
    delete: async () => {
      throw new Error('路径校验必须在删除调用前完成');
    },
  });
  await expect(service.moveToTrash('/workspace/repo', ['../outside.txt']))
    .rejects.toThrow('目标不在当前仓库内');
});
```

- [ ] **步骤 4：实现写锁和废纸篓结果模型**

`TrashService` 构造函数注入确认函数和 `vscode.workspace.fs` 适配器，便于测试。执行规则：

- 只接受仓库内的相对路径。
- 使用 `path.resolve` 后再次确认目标位于仓库根目录下。
- 二次确认文案列出具体文件，确认按钮为“移入废纸篓”。
- 每个文件调用 `workspace.fs.delete(uri, { recursive: false, useTrash: true })`。
- 返回 `{ succeeded: string[], failed: Array<{ path, message }> }`。
- 用户取消返回明确的 `cancelled` 结果，不算错误。

- [ ] **步骤 5：运行验证并提交**

```bash
npx vitest run test/unit/operation-lock.test.ts test/unit/trash-service.test.ts
npm run typecheck
npm run lint
git add src/services/operation-lock.ts src/services/trash-service.ts test/unit/operation-lock.test.ts test/unit/trash-service.test.ts
git commit -m "功能：增加仓库写锁和废纸篓保护"
```

---

### 任务 6：实现仓库编排和消息协议

**文件：**

- 创建：`src/services/repository-service.ts`
- 创建：`src/webview/messages.ts`
- 测试：`test/unit/repository-service.test.ts`
- 测试：`test/unit/messages.test.ts`

**接口：**

- 消耗：内置 Git API、`mergeChanges`、`SelectionStore` 和各写服务。
- 产出：`RepositoryService.getViewModel()`、`selectRepository()`、`refresh()`。
- 产出：`parseWebviewMessage(input): WebviewMessage`。

- [ ] **步骤 1：写状态版本和过期拒绝的失败测试**

测试要求：

- 内置仓库状态事件触发后版本号递增。
- 切换仓库时返回对应选择和提交信息。
- 提交请求携带旧版本号时，在进入 `CommitService` 前被拒绝。
- 未信任工作区时所有写入口被拒绝。

核心断言：

```ts
await expect(service.commit({
  repositoryId: 'repo-a',
  version: 2,
  message: '提交',
  selectedIds: ['a.ts'],
})).rejects.toThrow('仓库状态已变化，请刷新后重试');
```

- [ ] **步骤 2：写 Webview 消息校验失败测试**

允许的消息类型固定为：

```ts
export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | { readonly type: 'selectRepository'; readonly repositoryId: string }
  | { readonly type: 'toggleFile'; readonly fileId: string; readonly selected: boolean }
  | { readonly type: 'setGroup'; readonly group: 'tracked' | 'untracked'; readonly selected: boolean }
  | { readonly type: 'setCommitMessage'; readonly message: string }
  | { readonly type: 'openDiff'; readonly fileId: string }
  | { readonly type: 'commit'; readonly version: number }
  | { readonly type: 'commitAndPush'; readonly version: number }
  | { readonly type: 'selectPushRemote'; readonly version: number; readonly remote: string }
  | { readonly type: 'retryPush'; readonly version: number }
  | { readonly type: 'trash'; readonly version: number; readonly fileIds: readonly string[] }
  | { readonly type: 'editRemoteUrl'; readonly version: number };
```

测试非法对象、未知类型、空 ID、非布尔选择值、负版本号和额外危险字段均被拒绝。

- [ ] **步骤 3：运行测试确认失败**

```bash
npx vitest run test/unit/repository-service.test.ts test/unit/messages.test.ts
```

- [ ] **步骤 4：实现仓库编排**

`RepositoryService` 必须：

- 使用规范化根路径作为稳定仓库 ID。
- 订阅打开、关闭和状态变化事件并正确释放监听器。
- 把内置 Git 状态枚举映射为 `RawChange`。
- 合并状态后调用 `SelectionStore.reconcile`。
- 每次有效状态变化递增版本号。
- 每个仓库独立保存提交信息。
- 所有写方法先检查信任、版本、仓库、冲突和锁。
- “提交并推送”只在 `CommitService` 成功后调用 `PushService`。
- 推送失败保存提交哈希和重试上下文，不重复调用提交服务。

- [ ] **步骤 5：实现严格消息解析**

不引入运行时校验库。使用 `isRecord`、`hasExactKeys`、`isNonEmptyString` 和 `isNonNegativeInteger` 构建判别联合解析器。解析失败抛出 `WebviewMessageError`，错误文案只描述字段，不回显完整输入。

- [ ] **步骤 6：运行验证并提交**

```bash
npx vitest run test/unit/repository-service.test.ts test/unit/messages.test.ts
npm run typecheck
npm run lint
git add src/services/repository-service.ts src/webview/messages.ts test/unit/repository-service.test.ts test/unit/messages.test.ts
git commit -m "功能：实现仓库编排和消息校验"
```

---

### 任务 7：实现 PyCharm 风格独立侧边栏

**文件：**

- 创建：`src/webview/render.ts`
- 创建：`src/webview/client.ts`
- 创建：`src/webview/view-provider.ts`
- 创建：`media/main.css`
- 创建：`media/icon.svg`
- 测试：`test/unit/render.test.ts`
- 修改：`package.json`

**接口：**

- 产出：`renderWebviewHtml(webview, extensionUri, nonce): string`。
- 产出：`GitoolViewProvider`，连接 `RepositoryService` 与 Webview。

- [ ] **步骤 1：写安全 HTML 和关键控件失败测试**

`test/unit/render.test.ts` 验证：

- CSP 包含 `default-src 'none'`。
- 脚本只允许当前 nonce。
- 存在仓库选择器、已跟踪分组、未跟踪分组、提交信息输入框、“提交”和“提交并推送”。
- 不把远程 URL、文件路径或提交信息直接拼进初始 HTML。

```ts
it('生成带严格 CSP 的固定壳页面', () => {
  const html = renderWebviewHtml(fakeWebview, fakeExtensionUri, 'nonce-123');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("script-src 'nonce-nonce-123'");
  expect(html).toContain('id="commit-message"');
  expect(html).toContain('提交并推送');
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
npx vitest run test/unit/render.test.ts
```

- [ ] **步骤 3：实现固定 HTML 壳和主题 CSS**

界面顺序固定为：

1. 仓库选择器、分支和上游摘要。
2. 已选择数量和刷新按钮。
3. 已跟踪变更分组。
4. 未跟踪文件分组。
5. 状态或错误区域。
6. 固定底部提交信息和两个按钮。

`media/main.css` 只使用 VS Code 主题变量，例如：

```css
body {
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
}

.commit-panel {
  position: sticky;
  bottom: 0;
  border-top: 1px solid var(--vscode-sideBar-border);
  background: var(--vscode-sideBar-background);
}

.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
```

所有按钮提供 `aria-label`，错误区域使用 `role="alert"`，操作状态使用 `aria-live="polite"`。

- [ ] **步骤 4：实现客户端单向状态渲染**

`src/webview/client.ts`：

- 启动后发送 `ready`。
- 只接收 `{ type: 'state', model }`。
- 每次收到状态后完整更新控件值和禁用状态。
- 文件路径使用 `textContent`，不使用 `innerHTML` 注入动态值。
- 提交信息输入做 150ms 防抖并发送 `setCommitMessage`。
- 勾选、分组、提交、推送、舍弃、打开 diff 和远程修改只发送声明式消息。
- 运行状态下禁用所有写操作。

- [ ] **步骤 5：实现 Webview 提供器**

`GitoolViewProvider`：

- `resolveWebviewView` 设置 `enableScripts: true` 和仅包含 `media` 的 `localResourceRoots`。
- 生成密码学随机 nonce。
- 接收消息后调用 `parseWebviewMessage`。
- `openDiff` 对修改文件调用 `vscode.diff(toGitUri(fileUri, 'HEAD'), fileUri)`；重命名文件使用旧路径的 `HEAD` URI 与新路径工作区 URI；已删除文件只打开其 `HEAD` URI；未跟踪文件打开普通编辑器。
- `trash` 把当前选择中的具体未跟踪文件传给 `TrashService`，拒绝已跟踪、目录或状态版本不匹配的条目。
- `editRemoteUrl` 依次使用 `showQuickPick` 选择已有远程、`showInputBox` 编辑当前 fetch URL、模态确认框确认，再调用 `RemoteService.setUrl`；取消任一步骤都不写配置。
- `commitAndPush` 遇到 `needs-remote` 时用 `showQuickPick` 展示已有远程，并以原提交哈希为上下文继续推送，不能再次调用提交服务。
- 捕获错误并通过 `RepositoryService` 转为中文操作状态。
- 订阅仓库视图模型变化并发送最新 `state`。
- Webview 销毁时释放所有订阅。

`package.json` 增加：

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "gitool",
        "title": "Gitool",
        "icon": "media/icon.svg"
      }]
    },
    "views": {
      "gitool": [{
        "type": "webview",
        "id": "gitool.commitView",
        "name": "文件提交"
      }]
    },
    "commands": [{
      "command": "gitool.refresh",
      "title": "Gitool：刷新仓库状态"
    }]
  }
}
```

- [ ] **步骤 6：运行验证并提交**

```bash
npx vitest run test/unit/render.test.ts
npm run typecheck
npm run lint
npm run build
git add package.json src/webview/render.ts src/webview/client.ts src/webview/view-provider.ts media/main.css media/icon.svg test/unit/render.test.ts
git commit -m "功能：实现文件提交侧边栏"
```

---

### 任务 8：完成扩展激活、VS Code 测试、中文文档和 VSIX

**文件：**

- 创建：`src/extension.ts`
- 创建：`test/vscode/run-tests.ts`
- 创建：`test/vscode/suite/index.ts`
- 创建：`test/vscode/suite/extension.test.ts`
- 创建：`README.md`
- 创建：`CHANGELOG.md`
- 修改：`package.json`

**接口：**

- 产出：`activate(context): Promise<GitoolRuntime>`。
- 产出：`deactivate(): void`。
- 产出：可安装的 `gitool-file-commit-0.1.0.vsix`。

- [ ] **步骤 1：写扩展激活失败测试**

`test/vscode/suite/extension.test.ts`：

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Gitool 扩展', () => {
  test('可以激活并注册刷新命令', async () => {
    const extension = vscode.extensions.getExtension('xbyzzz.gitool-file-commit');
    assert.ok(extension, '扩展应存在');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('gitool.refresh'));
  });
});
```

- [ ] **步骤 2：运行 VS Code 测试确认失败**

```bash
npm run test:vscode
```

预期：失败原因为扩展入口或命令尚未注册。

- [ ] **步骤 3：实现扩展激活和资源释放**

`src/extension.ts` 执行顺序：

1. 获取 `vscode.git` 扩展。
2. 若缺失或禁用，注册只显示明确错误的空视图，不抛出未处理异常。
3. 获取 API 版本 1。
4. 创建 `GitRunner`，Git 路径优先使用内置 API 的 `git.path`。
5. 创建领域存储、服务、写锁和 Webview 提供器。
6. 注册 `gitool.commitView` 和 `gitool.refresh`。
7. 把全部订阅加入 `context.subscriptions`。

工作区信任变化时立即刷新视图模型。

- [ ] **步骤 4：补齐 README 和 CHANGELOG**

`README.md` 必须包含：

- 功能概述。
- 安装 VSIX 的步骤。
- 独立侧边栏操作步骤。
- 未跟踪文件默认不提交的安全说明。
- 按文件提交对暂存区的精确影响。
- 无上游推送流程。
- 修改远程 URL 的范围。
- 浏览器版 VS Code 不支持。
- 本地开发、测试、构建和打包命令。

`CHANGELOG.md` 的 `0.1.0` 条目列出首版全部功能和限制。

- [ ] **步骤 5：运行全量自动验证**

依次运行：

```bash
npm run clean
npm run typecheck
npm run lint
npm test
npm run build
npm run test:vscode
npm run package
```

预期：

- 所有命令退出码为 0。
- Vitest 无失败测试。
- VS Code 扩展测试无失败测试。
- 生成 `gitool-file-commit-0.1.0.vsix`。

- [ ] **步骤 6：在 Extension Development Host 做真实交互验收**

使用一个专用临时工作区和两个本地仓库，逐项记录证据：

1. 仓库选择器显示两个仓库且只能选择一个。
2. 已跟踪文件默认选中，未跟踪文件默认不选中。
3. 刷新后未跟踪文件仍未选中。
4. 只勾选一个文件提交，其他暂存文件仍在暂存区。
5. 勾选未跟踪文件后可以提交。
6. 未跟踪文件经二次确认进入系统废纸篓。
7. “提交并推送”对本地裸远程建立上游。
8. 修改已有远程 URL 后界面显示新值。
9. 制造推送失败后，界面显示本地提交哈希和“重试推送”，且没有重复提交。

把测试工作区的仓库根目录、命令输出摘要和必要截图路径写入最终交付说明，不把临时仓库提交进项目。

- [ ] **步骤 7：核对 VSIX 内容**

```bash
npx vsce ls --no-dependencies
unzip -l gitool-file-commit-0.1.0.vsix
```

确认：

- 包含 `dist/extension.js`、`media/main.js`、`media/main.css`、`media/icon.svg`、`README.md`、`CHANGELOG.md`。
- 不包含 `src/`、`test/`、`.git/`、临时目录、测试仓库或凭据。

- [ ] **步骤 8：提交任务 8**

```bash
git add src/extension.ts test/vscode README.md CHANGELOG.md package.json package-lock.json
git commit -m "发布：完成 Gitool 0.1.0 插件"
```

---

## 最终自审清单

- [ ] 设计规格的每条验收标准都有对应任务和测试。
- [ ] 没有未定义的接口名、字段名或路径。
- [ ] 所有动态文件名都通过参数数组传递给 Git。
- [ ] 未跟踪文件默认选择规则同时有单元测试和真实验收。
- [ ] 未选暂存内容保留同时有真实 Git 集成测试和真实验收。
- [ ] 提交失败恢复和推送失败状态都有测试。
- [ ] 无上游推送和修改已有远程 URL 都有测试。
- [ ] 工作区信任、冲突、状态版本和写锁都在服务层强制执行。
- [ ] 敏感 URL 遮蔽覆盖日志、错误和界面。
- [ ] 全量测试、构建、VS Code 测试和 VSIX 打包均有新鲜输出。
