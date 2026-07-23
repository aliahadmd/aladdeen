import type { AppError, ErrorCode, Result } from '@shared/contracts'

export class FluidError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: string
  ) {
    super(message)
    this.name = 'FluidError'
  }
}

export function toAppError(error: unknown, fallback: ErrorCode = 'INTERNAL'): AppError {
  if (error instanceof FluidError) {
    return { code: error.code, message: error.message, details: error.details }
  }

  if (error instanceof Error) {
    const candidate = error as NodeJS.ErrnoException
    if (candidate.code === 'ENOENT') return { code: 'NOT_FOUND', message: 'The file no longer exists.' }
    if (candidate.code === 'EACCES' || candidate.code === 'EPERM') {
      return { code: 'PERMISSION_DENIED', message: 'FluidMD does not have permission to complete that action.' }
    }
    if (candidate.code === 'EEXIST') return { code: 'ALREADY_EXISTS', message: 'An item with that name already exists.' }
    return { code: fallback, message: error.message || 'Something went wrong.' }
  }

  return { code: fallback, message: 'Something went wrong.' }
}

export async function asResult<T>(operation: () => Promise<T>, fallback?: ErrorCode): Promise<Result<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error: toAppError(error, fallback) }
  }
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}
