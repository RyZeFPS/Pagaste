export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function readableError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) return new AppError('UNKNOWN', error.message);
  return new AppError('UNKNOWN', 'Unexpected error');
}
