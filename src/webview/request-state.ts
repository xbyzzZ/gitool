export type ScopedRequestMode = 'write' | 'ai' | 'host-prompt';
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
  readonly pendingRequestId?: string;
  readonly pendingPresentation?: PendingRequestPresentation;
}

export function beginScopedRequest(
  input: BeginScopedRequestInput,
): BeginScopedRequestResult {
  const prefix = input.mode === 'host-prompt' ? 'prompt' : input.mode;
  const requestId = `${prefix}-${String(input.sequence)}`;
  return {
    scope: {
      repositoryId: input.repositoryId,
      version: input.version,
      requestId,
    },
    ...(input.mode === 'host-prompt' ? {} : {
      pendingRequestId: requestId,
      pendingPresentation: input.mode === 'ai'
        ? 'ai-button' as const
        : 'global-status' as const,
    }),
  };
}
