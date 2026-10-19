import type { z, ZodTypeAny } from 'zod';
import { badRequest } from './errors';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(`${first.path.join('.') || 'données'} : ${first.message}`, 'VALIDATION');
  }
  return r.data;
}
