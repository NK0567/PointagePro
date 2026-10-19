import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4500),
  jwtSecret: required('JWT_SECRET'),
  rpId: process.env.RP_ID ?? 'localhost',
  rpName: process.env.RP_NAME ?? 'PointagePro',
  origin: process.env.APP_ORIGIN ?? 'http://localhost:5250',
  isProd: process.env.NODE_ENV === 'production',
  sessionHours: 12,
};
