import type { FileChange } from './change-model.js';

interface RepositorySelection {
  knownIds: Set<string>;
  selectedIds: Set<string>;
  manuallyTouchedIds: Set<string>;
}

export class SelectionStore {
  private readonly selections = new Map<string, RepositorySelection>();

  reconcile(repositoryId: string, changes: readonly FileChange[]): ReadonlySet<string> {
    const selection = this.getSelection(repositoryId);
    const currentIds = new Set(changes.map((change) => change.id));

    this.removeMissingIds(selection.knownIds, currentIds);
    this.removeMissingIds(selection.selectedIds, currentIds);
    this.removeMissingIds(selection.manuallyTouchedIds, currentIds);

    for (const change of changes) {
      if (!selection.knownIds.has(change.id)) {
        selection.knownIds.add(change.id);
        if (!selection.manuallyTouchedIds.has(change.id)
          && !change.untracked
          && !change.conflicted) {
          selection.selectedIds.add(change.id);
        }
      }
    }

    return new Set(selection.selectedIds);
  }

  setSelected(repositoryId: string, fileId: string, selected: boolean): void {
    const selection = this.getSelection(repositoryId);
    selection.manuallyTouchedIds.add(fileId);
    if (selected) {
      selection.selectedIds.add(fileId);
    } else {
      selection.selectedIds.delete(fileId);
    }
  }

  setGroup(repositoryId: string, fileIds: readonly string[], selected: boolean): void {
    for (const fileId of fileIds) {
      this.setSelected(repositoryId, fileId, selected);
    }
  }

  private getSelection(repositoryId: string): RepositorySelection {
    const existing = this.selections.get(repositoryId);
    if (existing !== undefined) {
      return existing;
    }

    const selection: RepositorySelection = {
      knownIds: new Set<string>(),
      selectedIds: new Set<string>(),
      manuallyTouchedIds: new Set<string>(),
    };
    this.selections.set(repositoryId, selection);
    return selection;
  }

  private removeMissingIds(ids: Set<string>, currentIds: ReadonlySet<string>): void {
    for (const id of ids) {
      if (!currentIds.has(id)) {
        ids.delete(id);
      }
    }
  }
}
