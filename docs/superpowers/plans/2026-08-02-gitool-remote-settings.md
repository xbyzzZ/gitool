# Gitool 远程设置添加功能实施计划

> **面向代理执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施；所有步骤使用复选框跟踪。

**目标：** 修复无远程仓库点击远程设置只闪烁并报错的问题，使其可以直接添加默认远程 `origin`。

**架构：** 在 `RemoteService` 增加经过写后校验和失败回滚的 `add` 原语，由 `RepositoryWriteCoordinator` 复用现有写入校验、操作锁和 `remote` 状态。`GitoolViewProvider` 根据真实仓库远程列表选择“添加 origin”或“修改已有远程”，Webview 消息和客户端按钮事件保持不变。

**技术栈：** TypeScript 6、VS Code Extension API、内置 Git CLI、Vitest 4、esbuild、vsce。

## 全局约束

- 新增远程名称固定为 `origin`，本次不支持自定义名称、删除或重命名。
- 已有远程继续使用现有选择并修改 URL 的流程。
- 用户取消输入或确认时安静结束，不写入失败状态。
- Git 写入必须经过工作区信任、仓库版本、真实快照和操作锁校验。
- URL 含凭据时，用户可见文本和服务返回值必须脱敏。
- 所有代码注释、测试名称、错误消息和 Git 提交信息使用简体中文。
- 不修改或提交用户的 `.serena/` 目录。

---

### 任务 1：实现可校验、可回滚的远程添加原语

**文件：**
- 修改：`src/services/remote-service.ts`
- 测试：`test/integration/remote-push.test.ts`

**接口：**
- 消费：`GitRunner.run(repositoryRoot, args)`、`GitRunner.runForMachineParsing(repositoryRoot, args)`。
- 产出：`RemoteService.add(repositoryRoot: string, name: string, url: string): Promise<RemoteInfo>`。

- [ ] **步骤 1：编写添加远程的失败集成测试**

在 `RemoteService` 测试组中增加真实 Git 仓库用例，手工断言返回值和 Git 配置：

```ts
it('添加 origin 后重新读取并核对 URL', async () => {
  const repository = await createRepository();
  const remote = await createBareRemote();
  const service = new RemoteService(new GitRunner());

  await expect(service.add(repository.root, 'origin', remote))
    .resolves.toEqual({ name: 'origin', url: remote });
  expect(await repository.git('remote', 'get-url', 'origin')).toBe(remote);
});
```

再增加两个边界用例：空白 URL 抛出“远程 URL 不能为空”；已有 `origin` 时抛出“远程 origin 已存在”，且原 URL 不变。

- [ ] **步骤 2：运行测试确认因缺少 `add` 失败**

运行：`npx vitest run test/integration/remote-push.test.ts`

预期：TypeScript 转换或测试执行失败，明确指出 `RemoteService.add` 不存在。

- [ ] **步骤 3：实现最小添加与写后校验**

在 `RemoteService` 增加：

```ts
async add(
  repositoryRoot: string,
  name: string,
  url: string,
): Promise<RemoteInfo> {
  if (name.trim().length === 0) {
    throw new RangeError('远程名称不能为空');
  }
  if (url.trim().length === 0) {
    throw new RangeError('远程 URL 不能为空');
  }
  const remotes = await this.getRemotes(repositoryRoot);
  if (remotes.some((remote) => remote.name === name)) {
    throw new Error(`远程 ${name} 已存在`);
  }
  await this.git.run(repositoryRoot, ['remote', 'add', '--', name, url]);
  if (!await remoteUrlMatches(this.git, repositoryRoot, name, url)) {
    await this.rollbackAddedRemote(repositoryRoot, name);
    throw new Error(`远程 ${name} URL 写入后核对失败`);
  }
  return { name, url: redactSensitiveText(url) };
}
```

`rollbackAddedRemote` 使用 `git remote remove -- <name>`；若清理也失败，抛出同时包含“核对失败”和“回滚失败”的错误，不静默吞掉异常。

- [ ] **步骤 4：增加校验失败回滚测试并运行绿灯**

创建受控 `GitRunner` 测试替身：记录 `remote add` 和 `remote remove` 参数，让机器读取返回不同 URL。断言调用顺序为添加、读取、移除，并断言最终错误包含“URL 写入后核对失败”。

运行：`npx vitest run test/integration/remote-push.test.ts`

预期：该文件全部通过。

- [ ] **步骤 5：提交服务原语**

```bash
git add src/services/remote-service.ts test/integration/remote-push.test.ts
git commit -m "功能：支持安全添加远程仓库"
```

### 任务 2：把添加远程接入仓库写入协调器

**文件：**
- 修改：`src/services/repository-write-coordinator.ts`
- 修改：`src/services/repository-service.ts`
- 测试：`test/unit/repository-service.test.ts`

**接口：**
- 消费：任务 1 的 `RemoteService.add(repositoryRoot, name, url)`。
- 产出：`AddRemoteRequest` 和 `RepositoryService.addRemote(request): Promise<RemoteInfo>`。

- [ ] **步骤 1：扩展测试替身并编写失败测试**

将测试服务替身拆分为 `setRemoteUrl` 和 `addRemote` 两个 mock，并传入：

```ts
remoteService: {
  setUrl: setRemoteUrl,
  add: addRemote,
}
```

增加成功用例：

```ts
await expect(service.addRemote({
  repositoryId: root,
  version: 0,
  remote: 'origin',
  url: 'https://example.test/repo.git',
})).resolves.toEqual({
  name: 'origin',
  url: 'https://example.test/repo.git',
});
expect(addRemote).toHaveBeenCalledWith(
  root,
  'origin',
  'https://example.test/repo.git',
);
```

同步把 `addRemote` 加入“未信任工作区”和“冲突文件”写入口测试，断言下游未被调用。

- [ ] **步骤 2：运行测试确认新接口不存在**

运行：`npx vitest run test/unit/repository-service.test.ts`

预期：失败并指出 `RepositoryService.addRemote` 或远程端口 `add` 不存在。

- [ ] **步骤 3：实现协调器与服务接口**

在远程端口增加：

```ts
add(repositoryRoot: string, name: string, url: string): Promise<RemoteInfo>;
```

增加请求类型：

```ts
export interface AddRemoteRequest extends RepositoryVersionRequest {
  readonly remote: string;
  readonly url: string;
}
```

协调器的 `addRemote` 必须通过 `runValidatedWrite`，并在 `runOperation(state, 'remote', ...)` 中调用端口；`RepositoryService.addRemote` 只委托协调器。

- [ ] **步骤 4：验证成功、失败和写入门禁**

运行：`npx vitest run test/unit/repository-service.test.ts`

预期：全部通过，添加失败时 `operation` 为：

```ts
{
  kind: 'failed',
  action: 'remote',
  message: '远程添加失败',
}
```

- [ ] **步骤 5：提交协调器接入**

```bash
git add src/services/repository-write-coordinator.ts src/services/repository-service.ts test/unit/repository-service.test.ts
git commit -m "功能：接入远程添加写入链路"
```

### 任务 3：修复无远程时的三个点交互

**文件：**
- 修改：`src/webview/view-provider.ts`
- 测试：`test/unit/view-provider.test.ts`

**接口：**
- 消费：任务 2 的 `RepositoryService.addRemote(request)`。
- 产出：现有 `editRemoteUrl` Webview 消息在无远程时新增 `origin`，已有远程时保持原行为。

- [ ] **步骤 1：编写无远程添加 origin 的失败测试**

给服务替身增加 `addRemote` mock。让 `getRepository` 返回空远程，模拟输入与确认：

```ts
vscodeMocks.showInputBox.mockResolvedValue(
  'https://example.test/repo.git',
);
vscodeMocks.showWarningMessage.mockResolvedValue('确认添加');
```

发送现有 `editRemoteUrl` 消息后断言：

```ts
expect(created.addRemote).toHaveBeenCalledWith({
  repositoryId: '/workspace/repo',
  version: 0,
  remote: 'origin',
  url: 'https://example.test/repo.git',
});
expect(created.reportFailure).not.toHaveBeenCalled();
```

- [ ] **步骤 2：运行测试确认仍报告“没有可修改的远程”**

运行：`npx vitest run test/unit/view-provider.test.ts`

预期：失败；`addRemote` 未调用，`reportFailure` 收到当前旧错误。

- [ ] **步骤 3：实现添加 origin 的宿主交互**

当 `repository.state.remotes.length === 0` 时调用私有 `addRemote(repositoryId, version)`：

1. `showInputBox` 标题为“Gitool：添加远程 origin”，提示输入完整 URL，启用 `ignoreFocusOut`，使用现有空白校验。
2. 输入取消时直接返回。
3. `showWarningMessage` 使用模态确认，URL 通过 `redactSensitiveText` 展示。
4. 确认文本不是“确认添加”时直接返回。
5. 调用 `service.addRemote({ repositoryId, version, remote: 'origin', url: url.trim() })`，然后调用 `service.refresh()`。

已有远程分支保持现有选择、敏感 URL 不回填、确认修改和刷新行为。

- [ ] **步骤 4：增加取消和既有远程回归测试**

分别覆盖输入框取消、确认框取消，断言 `addRemote`、`setRemoteUrl` 和 `reportFailure` 均未调用。保留并运行现有凭据遮蔽测试，确认修改流程未回归。

运行：`npx vitest run test/unit/view-provider.test.ts`

预期：全部通过。

- [ ] **步骤 5：提交交互修复**

```bash
git add src/webview/view-provider.ts test/unit/view-provider.test.ts
git commit -m "修复：无远程时引导添加 origin"
```

### 任务 4：完成全量验证与交付打包

**文件：**
- 验证：`package.json`
- 产物：`gitool-file-commit-0.2.0.vsix`

**接口：**
- 消费：任务 1 至任务 3 的所有提交。
- 产出：通过检查并可安装的 0.2.0 VSIX；不推送远程。

- [ ] **步骤 1：运行全量质量检查**

运行：`npm run check`

预期：类型检查、ESLint 和全部 Vitest 测试通过，失败数为 0。

- [ ] **步骤 2：运行 VS Code Extension Host 测试**

运行：`npm run test:vscode`

预期：Extension Host 测试全部通过。若环境启动失败，记录原始错误并明确区分环境阻断与功能失败。

- [ ] **步骤 3：重新打包 VSIX**

运行：`npm run package`

预期：生成 `/Users/xbyzzz/code_home/work_space/gitool/gitool-file-commit-0.2.0.vsix`，`vsce` 返回成功。

- [ ] **步骤 4：核验差异、提交边界和产物摘要**

运行：

```bash
git diff --check
git status --short
git log -4 --oneline
shasum -a 256 gitool-file-commit-0.2.0.vsix
```

预期：工作区只保留用户的 `?? .serena/`；功能代码均已提交；报告 VSIX SHA-256；不执行 `git push`。
