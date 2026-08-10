export interface AiModelSelection {
  readonly id: string;
  readonly name: string;
}

export interface AiModelSelectionPersistence {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

const storageKey = 'gitool.aiModelSelections';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSelection(value: unknown): AiModelSelection | undefined {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.id.trim().length === 0
    || typeof value.name !== 'string'
    || value.name.trim().length === 0) {
    return undefined;
  }
  return { id: value.id, name: value.name };
}

function readSelections(value: unknown): Record<string, AiModelSelection> {
  if (!isRecord(value)) {
    return {};
  }
  const selections: Record<string, AiModelSelection> = {};
  for (const [repositoryId, candidate] of Object.entries(value)) {
    const selection = readSelection(candidate);
    if (selection !== undefined) {
      selections[repositoryId] = selection;
    }
  }
  return selections;
}

export class AiModelSelectionStore {
  private pendingUpdate: Promise<void> = Promise.resolve();

  constructor(private readonly persistence: AiModelSelectionPersistence) {}

  get(repositoryId: string): AiModelSelection | undefined {
    return readSelections(
      this.persistence.get(storageKey),
    )[repositoryId];
  }

  set(
    repositoryId: string,
    selection: AiModelSelection | undefined,
  ): Promise<void> {
    const update = this.pendingUpdate.then(async () => {
      const current = readSelections(this.persistence.get(storageKey));
      const remaining = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== repositoryId),
      );
      const next = selection === undefined
        ? remaining
        : { ...remaining, [repositoryId]: selection };
      await this.persistence.update(storageKey, next);
    });
    this.pendingUpdate = update.catch(() => undefined);
    return update;
  }
}
