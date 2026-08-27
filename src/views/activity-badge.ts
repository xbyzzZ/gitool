import * as vscode from 'vscode';
import type { RepositoryViewModel } from '../domain/view-model.js';

// WebviewView.badge 要等用户点开 Gitool、resolveWebviewView 之后才存在。
// 隐藏树视图在 activate 时就能 createTreeView，徽标才能出现在活动栏图标上。
export const activityBadgeViewId = 'gitool.activityBadge';

export interface ActivityBadgeService {
  readonly onDidChange: vscode.Event<void>;
  getViewModel(): Pick<RepositoryViewModel, 'changeCount'>;
}

export function activityBadgeFor(count: number): vscode.ViewBadge | undefined {
  if (count === 0) {
    return undefined;
  }
  return {
    value: count,
    tooltip: `Gitool：${String(count)} 个变更文件`,
  };
}

export class ActivityBadge implements vscode.Disposable {
  static readonly viewId: string = activityBadgeViewId;

  private readonly tree: vscode.TreeView<string>;
  private readonly listener: vscode.Disposable;

  constructor(private readonly service: ActivityBadgeService) {
    this.tree = vscode.window.createTreeView(ActivityBadge.viewId, {
      treeDataProvider: {
        getTreeItem: (element: string) => new vscode.TreeItem(element),
        getChildren: () => [],
      },
    });
    this.listener = service.onDidChange(() => {
      this.update();
    });
    this.update();
  }

  dispose(): void {
    this.listener.dispose();
    this.tree.dispose();
  }

  private update(): void {
    this.tree.badge = activityBadgeFor(this.service.getViewModel().changeCount);
  }
}
