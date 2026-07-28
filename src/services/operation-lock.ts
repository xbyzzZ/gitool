export class RepositoryOperationLock {
  private readonly activeRepositoryIds = new Set<string>();

  async runExclusive<T>(
    repositoryId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    if (this.activeRepositoryIds.has(repositoryId)) {
      throw new Error('仓库正在执行写操作');
    }

    this.activeRepositoryIds.add(repositoryId);
    try {
      return await action();
    } finally {
      this.activeRepositoryIds.delete(repositoryId);
    }
  }
}
