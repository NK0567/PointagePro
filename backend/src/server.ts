import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Prisma } from '@prisma/client';
import { config } from './config';
import { HttpError } from './lib/errors';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { kioskRouter, terminalRouter } from './routes/kiosk';
import { meRouter } from './routes/me';
import { reportsRouter } from './routes/reports';

const app = express();
app.set('trust proxy', 1); // derrière Nginx en production
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Protection CSRF : les requêtes qui modifient des données doivent venir du frontend.
app.use((req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/api/terminal/')) return next();
  const origin = req.header('origin');
  if (origin && origin !== config.origin) return next(new HttpError(403, 'Origine non autorisée', 'BAD_ORIGIN'));
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/admin', adminRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/kiosk', kioskRouter);
app.use('/api/terminal', terminalRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue' }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Cette valeur existe déjà (matricule, e-mail…)', code: 'DUPLICATE' });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ressource introuvable', code: 'NOT_FOUND' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// BigInt (compteur WebAuthn) → JSON
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

app.listen(config.port, '127.0.0.1', () => {
  console.log(`PointagePro API → http://localhost:${config.port}/api  (origine attendue : ${config.origin})`);
});
