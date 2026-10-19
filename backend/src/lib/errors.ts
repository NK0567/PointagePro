export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const badRequest = (msg: string, code?: string, extra?: Record<string, unknown>) => new HttpError(400, msg, code, extra);
export const forbidden = (msg = 'Accès refusé') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Ressource introuvable') => new HttpError(404, msg, 'NOT_FOUND');
