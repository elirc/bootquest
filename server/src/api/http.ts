import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import type { ApiErrorBody, ApiErrorCode } from '@bootquest/shared/api';

/** An error that maps onto a JSON {error:{code,message}} response. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly issues?: { path: string; message: string }[];

  constructor(status: number, code: ApiErrorCode, message: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (issues) this.issues = issues;
  }
}

/** Zod-validate one request part; failures become 400 VALIDATION with per-field issues. */
export function validate<Out, In>(schema: ZodType<Out, ZodTypeDef, In>, value: unknown, where: 'body' | 'params' | 'query'): Out {
  const r = schema.safeParse(value ?? {});
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({ path: [where, ...i.path].join('.'), message: i.message }));
  throw new HttpError(400, 'VALIDATION', `invalid request ${where}`, issues);
}

/**
 * Deep JSON hygiene for everything that leaves the server: null-prototype
 * objects (node:sqlite rows) become plain objects, BigInt becomes Number
 * (refusing unsafe values), undefined object members are dropped.
 */
export function toPlain(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`integer ${value} exceeds Number.MAX_SAFE_INTEGER`);
    }
    return Number(value);
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (value !== null && typeof value === 'object') {
    if (value instanceof Date) return value.getTime();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = toPlain(v);
    }
    return out;
  }
  return value;
}

export function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(toPlain(body));
}

/** Express 4 does not catch rejected promises — route them to the error handler. */
export function asyncRoute(fn: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };
}

export function errorBody(code: ApiErrorCode, message: string, issues?: { path: string; message: string }[]): ApiErrorBody {
  return { error: issues ? { code, message, issues } : { code, message } };
}
