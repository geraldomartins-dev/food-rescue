import 'dotenv/config';
import { z } from 'zod';

const result = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_NAME: z.string().default('food_rescue'),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  JWT_SECRET: z.string().min(32),
  DATA_HASH_SECRET: z.string().min(32).optional(),
  JWT_EXPIRES_IN: z.string().default('15m'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.string().transform((value) => value === 'true').default('false'),
  SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('Food Rescue <no-reply@foodrescue.local>'),
  EMAIL_WORKER_ENABLED: z.string().transform((value) => value !== 'false').default('true'),
  EMAIL_WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000)
  ,REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30)
}).safeParse(process.env);

if (!result.success) {
  throw new Error(`Ambiente inválido: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
}
export const env = Object.freeze({
  ...result.data,
  DATA_HASH_SECRET: result.data.DATA_HASH_SECRET ?? result.data.JWT_SECRET
});
