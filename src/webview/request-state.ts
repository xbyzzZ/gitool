export type ScopedRequestMode = 'write' | 'host-prompt';

interface BeginScopedRequestInput {
  readonly repositoryId: string;
  readonly version: number;
  readonly sequence: number;
  readonly mode: ScopedRequestMode;
}

interface ScopedRequest {
  readonly repositoryId: string;
  readonly version: number;
  readonly requestId: string;
}

interface BeginScopedRequestResult {
  readonly scope: ScopedRequest;
  readonly pendingRequestId?: string;
}

export function beginScopedRequest(
  input: BeginScopedRequestInput,
): BeginScopedRequestResult {
  const prefix = input.mode === 'write' ? 'write' : 'prompt';
  const requestId = `${prefix}-${String(input.sequence)}`;
  return {
    scope: {
      repositoryId: input.repositoryId,
      version: input.version,
      requestId,
    },
    ...(input.mode === 'write' ? { pendingRequestId: requestId } : {}),
  };
}
