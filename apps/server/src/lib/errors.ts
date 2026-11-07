import type { FieldIssue } from '@wag/shared';
import type { ZodError, ZodType } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: FieldIssue[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: FieldIssue[]) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const validationError = (details: FieldIssue[], message = 'Проверьте введённые данные') =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Требуется авторизация через Telegram') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Недостаточно прав') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Не найдено') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);

export function zodIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Валидирует входные данные и бросает 400 с понятными сообщениями. */
export function parseInput<T extends ZodType>(schema: T, data: unknown): T['_output'] {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw validationError(zodIssues(result.error));
  return result.data;
}
