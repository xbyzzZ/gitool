export type ScopedRequestMode = 'write' | 'ai';
export type PendingRequestPresentation = 'global-status' | 'ai-button';

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
  readonly pendingRequestId: string;
  readonly pendingPresentation: PendingRequestPresentation;
}

export function beginScopedRequest(
  input: BeginScopedRequestInput,
): BeginScopedRequestResult {
  const requestId = `${input.mode}-${String(input.sequence)}`;
  return {
    scope: {
      repositoryId: input.repositoryId,
      version: input.version,
      requestId,
    },
    pendingRequestId: requestId,
    pendingPresentation: input.mode === 'ai'
      ? 'ai-button' as const
      : 'global-status' as const,
  };
}
