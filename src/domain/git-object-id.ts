const fullGitObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function isFullGitObjectId(value: unknown): value is string {
  return typeof value === 'string' && fullGitObjectIdPattern.test(value);
}
