/**
 * Standard error envelope for all services.
 * Every error response across the organisation uses this shape.
 * Do not modify per service.
 */

export interface ErrorDetail {
  field?: string
  message: string
}

export interface ErrorEnvelope {
  error: {
    code: string        // Machine-readable. Consumers switch on this, not HTTP status.
    message: string     // Human-readable. For developers, not end users.
    requestId: string   // Every error is traceable.
    details: ErrorDetail[]  // Field-level errors e.g. validation failures.
  }
}

/**
 * Factory — build a consistent error response anywhere in the codebase.
 */
export function buildError(
  code: string,
  message: string,
  requestId: string,
  details: ErrorDetail[] = []
): ErrorEnvelope {
  return {
    error: { code, message, requestId, details },
  }
}
