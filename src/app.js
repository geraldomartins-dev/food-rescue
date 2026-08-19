import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { env } from './config.js';
import { pool } from './database.js';
import { authenticate, authorize, createRefreshSession, emailSchema, login, loginSchema, register, registerSchema,
  requestEmailVerification, requestPasswordReset, resetPassword, resetPasswordSchema, revokeRefreshSession,
  rotateRefreshSession, tokenSchema, verifyEmail } from './auth.js';
import { asyncHandler, HttpError } from './http.js';
import { confirmRescue, findReceipt, listRescues, requestRescue, reserveRescue } from './rescues.js';
import { receiptPath } from './receipt-pdf.js';
import { createEstablishment, establishmentSchema, listOwnEstablishments } from './establishments.js';
import { createLot, listAvailableLots, lotSchema } from './lots.js';
import { getAdminMetrics, getReportData, listAuditLogs, listUsers, setUserStatus, userStatusSchema } from './admin.js';
import { generateAdminReportPdf } from './admin-report-pdf.js';

export const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { req.id = req.get('x-request-id') || crypto.randomUUID(); res.set('x-request-id', req.id); next(); });
app.use(helmet()); app.use(cors({ origin: env.APP_ORIGIN, credentials: true })); app.use(express.json({ limit: '100kb' }));
app.use(express.static('public', { extensions: ['html'], maxAge: env.NODE_ENV === 'production' ? '1h' : 0 }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
const validateBody = (schema) => (req, _res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return next(new HttpError(422, 'VALIDATION_ERROR', 'Dados inválidos.', parsed.error.issues));
  req.validated = parsed.data; next();
};
const idSchema = z.coerce.number().int().positive();
const readCookie = (req, name) => Object.fromEntries((req.get('cookie') || '').split(';').map((part) => part.trim().split('=')))[name];
const refreshCookie = { httpOnly: true, sameSite: 'strict', secure: env.NODE_ENV === 'production', path: '/api/v1/auth', maxAge: env.REFRESH_TOKEN_DAYS * 86400000 };
const sessionMetadata = (req) => ({ userAgent: req.get('user-agent')?.slice(0, 500) });
async function attachRefresh(req, res, result) {
  const refresh = await createRefreshSession(result.user.id, sessionMetadata(req));
  res.cookie('fr_refresh', refresh, refreshCookie); return result;
}

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/v1/admin/metricas', authenticate, authorize('admin'), asyncHandler(async (_req, res) => res.json({ data: await getAdminMetrics() })));
app.get('/api/v1/admin/usuarios', authenticate, authorize('admin'), asyncHandler(async (_req, res) => res.json({ data: await listUsers() })));
app.patch('/api/v1/admin/usuarios/:id/status', authenticate, authorize('admin'), validateBody(userStatusSchema), asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id); if (!id.success) throw new HttpError(422, 'VALIDATION_ERROR', 'ID inválido.');
  res.json({ data: await setUserStatus({ targetId: id.data, ativo: req.validated.ativo, adminId: req.user.id, correlationId: req.id }) });
}));
app.get('/api/v1/admin/auditoria', authenticate, authorize('admin'), asyncHandler(async (_req, res) => res.json({ data: await listAuditLogs() })));
app.get('/api/v1/admin/relatorios/resgates.pdf', authenticate, authorize('admin'), asyncHandler(async (_req, res) => {
  const pdf = await generateAdminReportPdf(await getReportData());
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="relatorio-resgates.pdf"', 'Content-Length': pdf.length });
  res.send(pdf);
}));
app.post('/api/v1/auth/cadastro', limiter, validateBody(registerSchema), asyncHandler(async (req, res) => {
  const result = await register(req.validated); await requestEmailVerification(result.user.id);
  res.status(201).json(await attachRefresh(req, res, result));
}));
app.post('/api/v1/auth/login', limiter, validateBody(loginSchema), asyncHandler(async (req, res) => res.json(await attachRefresh(req, res, await login(req.validated)))));
app.post('/api/v1/auth/refresh', limiter, asyncHandler(async (req, res) => {
  const result = await rotateRefreshSession(readCookie(req, 'fr_refresh'), sessionMetadata(req));
  res.cookie('fr_refresh', result.refreshToken, refreshCookie); delete result.refreshToken; res.json(result);
}));
app.post('/api/v1/auth/logout', asyncHandler(async (req, res) => {
  await revokeRefreshSession(readCookie(req, 'fr_refresh')); res.clearCookie('fr_refresh', refreshCookie); res.status(204).end();
}));
app.post('/api/v1/auth/verificar-email', validateBody(tokenSchema), asyncHandler(async (req, res) => { await verifyEmail(req.validated.token); res.json({ message: 'E-mail verificado.' }); }));
app.post('/api/v1/auth/reenviar-verificacao', authenticate, asyncHandler(async (req, res) => { await requestEmailVerification(req.user.id); res.status(202).json({ message: 'Verificação enviada.' }); }));
app.post('/api/v1/auth/esqueci-senha', limiter, validateBody(emailSchema), asyncHandler(async (req, res) => { await requestPasswordReset(req.validated.email); res.status(202).json({ message: 'Se a conta existir, as instruções serão enviadas.' }); }));
app.post('/api/v1/auth/redefinir-senha', limiter, validateBody(resetPasswordSchema), asyncHandler(async (req, res) => { await resetPassword(req.validated.token, req.validated.senha); res.json({ message: 'Senha redefinida.' }); }));
app.post('/api/v1/estabelecimentos', authenticate, authorize('doador', 'ong'), validateBody(establishmentSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createEstablishment(req.validated, req.user) });
}));
app.get('/api/v1/estabelecimentos/meus', authenticate, authorize('doador', 'ong'), asyncHandler(async (req, res) => {
  res.json({ data: await listOwnEstablishments(req.user.id) });
}));
app.get('/api/v1/lotes', authenticate, authorize('ong', 'admin'), asyncHandler(async (_req, res) => {
  res.json({ data: await listAvailableLots() });
}));
app.post('/api/v1/lotes', authenticate, authorize('doador'), validateBody(lotSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createLot(req.validated, req.user.id) });
}));
app.post('/api/v1/lotes/:loteId/solicitacoes', authenticate, authorize('ong'), asyncHandler(async (req, res) => {
  const loteId = idSchema.safeParse(req.params.loteId);
  const body = z.object({ estabelecimentoOngId: idSchema, mensagem: z.string().trim().max(500).optional() }).strict().safeParse(req.body);
  if (!loteId.success || !body.success) throw new HttpError(422, 'VALIDATION_ERROR', 'Dados inválidos.');
  res.status(201).json({ data: await requestRescue({ loteId: loteId.data, estabelecimentoOngId: body.data.estabelecimentoOngId, userId: req.user.id, mensagem: body.data.mensagem }) });
}));
app.post('/api/v1/solicitacoes/:id/reserva', authenticate, authorize('doador', 'admin'), asyncHandler(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(422, 'VALIDATION_ERROR', 'ID inválido.');
  res.json({ data: await reserveRescue({ requestId: parsed.data, userId: req.user.id, admin: req.user.role === 'admin' }) });
}));
app.get('/api/v1/solicitacoes/minhas', authenticate, authorize('doador', 'ong', 'admin'), asyncHandler(async (req, res) => {
  res.json({ data: await listRescues(req.user) });
}));
app.post('/api/v1/solicitacoes/:id/confirmacao', authenticate, authorize('doador', 'ong', 'admin'), asyncHandler(async (req, res) => {
  const requestId = idSchema.safeParse(req.params.id);
  const idempotencyKey = req.get('idempotency-key');
  if (!requestId.success) throw new HttpError(422, 'VALIDATION_ERROR', 'ID inválido.');
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Envie o header Idempotency-Key.');
  }
  const result = await confirmRescue({ requestId: requestId.data, user: req.user, correlationId: req.id });
  res.json({ data: { id: result.id, status: result.status, codigoComprovante: result.codigoComprovante,
    comprovanteUrl: `/api/v1/solicitacoes/${result.id}/comprovante` } });
}));
app.get('/api/v1/solicitacoes/:id/comprovante', authenticate, authorize('doador', 'ong', 'admin'), asyncHandler(async (req, res) => {
  const requestId = idSchema.safeParse(req.params.id);
  if (!requestId.success) throw new HttpError(422, 'VALIDATION_ERROR', 'ID inválido.');
  const code = await findReceipt({ requestId: requestId.data, user: req.user });
  res.type('application/pdf').sendFile(receiptPath(code));
}));
app.use((req, _res, next) => next(new HttpError(404, 'ROUTE_NOT_FOUND', `Rota não encontrada: ${req.method} ${req.path}`)));
app.use((error, req, res, _next) => {
  const known = error instanceof HttpError; if (!known) console.error(`[${req.id}]`, error);
  res.status(known ? error.status : 500).json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Erro interno do servidor.', ...(known && error.details ? { details: error.details } : {}), requestId: req.id } });
});
