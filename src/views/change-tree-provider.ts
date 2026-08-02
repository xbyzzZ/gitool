import { basename, dirname } from 'node:path/posix';
import * as vscode from 'vscode';
import type { FileChange } from '../domain/change-model.js';
import {
  groupChanges,
  type ChangeDirectoryGroup,
  type ChangeSection,
  type ChangeSectionKind,
} from '../domain/change-groups.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { BuiltinRepository } from '../git/builtin-git-api.js';

export interface ChangeTreeService {
  readonly onDidChange: vscode.Event<void>;
  getViewModel(): RepositoryViewModel;
  getRepository(id: string): BuiltinRepository | undefined;
  setFileSelected(fileId: string, selected: boolean): RepositoryViewModel;
  setGroup(
    group: 'tracked' | 'untracked',
    selected: boolean,
  ): RepositoryViewModel;
}

export interface ChangeSectionNode {
  readonly kind: 'section';
  readonly section: ChangeSectionKind;
  readonly value: ChangeSection;
}

export interface ChangeDirectoryNode {
  readonly kind: 'directory';
  readonly section: ChangeSectionKind;
  readonly value: ChangeDirectoryGroup;
}

export interface ChangeFileNode {
  readonly kind: 'file';
  readonly repositoryId: string;
  readonly section: ChangeSectionKind;
  readonly change: FileChange;
}

export type ChangeTreeNode =
  | ChangeSectionNode
  | ChangeDirectoryNode
  | ChangeFileNode;

const sectionLabels: Readonly<Record<ChangeSectionKind, string>> = {
  tracked: '已跟踪变更',
  untracked: '未跟踪文件',
  conflicted: '冲突文件',
};

const changeLabels: Readonly<Record<FileChange['kind'], string>> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  'type-changed': 'T',
  conflicted: '!',
  untracked: '?',
};

function layerLabel(change: FileChange): string {
  if (change.untracked) {
    return '未跟踪';
  }
  if (change.staged && change.unstaged) {
    return '已暂存 + 未暂存';
  }
  return change.staged ? '已暂存' : '未暂存';
}

function sectionCheckboxState(
  section: ChangeSection,
  selectedIds: ReadonlySet<string>,
): vscode.TreeItemCheckboxState {
  const files = section.directories.flatMap((directory) => directory.files);
  return files.length > 0 && files.every((file) => selectedIds.has(file.id))
    ? vscode.TreeItemCheckboxState.Checked
    : vscode.TreeItemCheckboxState.Unchecked;
}

export class ChangeTreeProvider
implements vscode.TreeDataProvider<ChangeTreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<
    ChangeTreeNode | undefined
  >();
  private readonly serviceListener: vscode.Disposable;
  private tree: vscode.TreeView<ChangeTreeNode> | undefined;

  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly service: ChangeTreeService) {
    this.serviceListener = service.onDidChange(() => {
      this.updateDescription();
      this.changed.fire(undefined);
    });
  }

  getTreeItem(node: ChangeTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'section':
        return this.sectionItem(node);
      case 'directory':
        return this.directoryItem(node);
      case 'file':
        return this.fileItem(node);
    }
  }

  getChildren(node?: ChangeTreeNode): ChangeTreeNode[] {
    if (node === undefined) {
      return groupChanges(this.service.getViewModel().changes).map((section) => ({
        kind: 'section',
        section: section.kind,
        value: section,
      }));
    }
    if (node.kind === 'section') {
      return node.value.directories.map((directory) => ({
        kind: 'directory',
        section: node.section,
        value: directory,
      }));
    }
    if (node.kind === 'directory') {
      const repositoryId = this.service.getViewModel().currentRepositoryId;
      if (repositoryId === undefined) {
        return [];
      }
      return node.value.files.map((change) => ({
        kind: 'file',
        repositoryId,
        section: node.section,
        change,
      }));
    }
    return [];
  }

  bindCheckboxes(tree: vscode.TreeView<ChangeTreeNode>): vscode.Disposable {
    this.tree = tree;
    this.updateDescription();
    const listener = tree.onDidChangeCheckboxState((event) => {
      for (const [node, state] of event.items) {
        const selected = state === vscode.TreeItemCheckboxState.Checked;
        if (node.kind === 'file' && !node.change.conflicted) {
          this.service.setFileSelected(node.change.id, selected);
        } else if (node.kind === 'section'
          && (node.section === 'tracked' || node.section === 'untracked')) {
          this.service.setGroup(node.section, selected);
        }
      }
    });
    return {
      dispose: () => {
        listener.dispose();
        if (this.tree === tree) {
          this.tree = undefined;
        }
      },
    };
  }

  dispose(): void {
    this.tree = undefined;
    this.serviceListener.dispose();
    this.changed.dispose();
  }

  private sectionItem(node: ChangeSectionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      sectionLabels[node.section],
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.description = String(node.value.fileCount);
    if (node.section !== 'conflicted') {
      item.checkboxState = sectionCheckboxState(
        node.value,
        new Set(this.service.getViewModel().selectedIds),
      );
    }
    item.contextValue = `gitool.${node.section}Section`;
    return item;
  }

  private directoryItem(node: ChangeDirectoryNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.value.path === '.' ? '根目录' : node.value.path,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.description = String(node.value.files.length);
    item.contextValue = 'gitool.changeDirectory';
    return item;
  }

  private fileItem(node: ChangeFileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      basename(node.change.path),
      vscode.TreeItemCollapsibleState.None,
    );
    const repository = this.service.getRepository(node.repositoryId);
    if (repository !== undefined) {
      item.resourceUri = vscode.Uri.joinPath(
        repository.rootUri,
        node.change.path,
      );
      item.iconPath = vscode.ThemeIcon.File;
    }
    const directory = dirname(node.change.path);
    item.description = [
      ...(directory === '.' ? [] : [directory]),
      layerLabel(node.change),
      ...(node.change.untracked ? [] : [changeLabels[node.change.kind]]),
    ].join(' · ');
    item.tooltip = node.change.originalPath === undefined
      ? node.change.path
      : `${node.change.originalPath} → ${node.change.path}`;
    if (!node.change.conflicted) {
      item.checkboxState = this.service.getViewModel().selectedIds.includes(
        node.change.id,
      )
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
    }
    item.contextValue = node.change.untracked
      ? 'gitool.untrackedFile'
      : node.change.conflicted
        ? 'gitool.conflictedFile'
        : 'gitool.changedFile';
    item.command = {
      command: 'gitool.openChange',
      title: '打开文件变更',
      arguments: [node],
    };
    return item;
  }

  private updateDescription(): void {
    if (this.tree === undefined) {
      return;
    }
    const model = this.service.getViewModel();
    this.tree.description = `已选择 ${String(model.selectedIds.length)} / ${String(model.changeCount)} 个文件`;
  }
}
