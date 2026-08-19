import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from './config.js';
import { pool } from './database.js';
import { HttpError } from './http.js';
import crypto from 'node:crypto';

export const registerSchema = z.object({
  nome: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(254),
  senha: z.string().min(10).max(72), perfil: z.enum(['doador', 'ong']),
  telefone: z.string().trim().min(8).max(20).optional(),
  versaoPoliticaPrivacidade: z.string().trim().min(1).max(20), aceitouPoliticaPrivacidade: z.literal(true)
}).strict();
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254), senha: z.string().min(1).max(72)
}).strict();
export const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
export const tokenSchema = z.object({ token: z.string().min(32).max(256) }).strict();
export const resetPasswordSchema = tokenSchema.extend({ senha: z.string().min(10).max(72) });

const token = (user) => jwt.sign({ role: user.perfil }, env.JWT_SECRET, {
  algorithm: 'HS256', subject: String(user.id), issuer: 'food-rescue-api',
  audience: 'food-rescue-web', expiresIn: env.JWT_EXPIRES_IN
});
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const opaqueToken = () => crypto.randomBytes(48).toString('base64url');

export async function createRefreshSession(userId, metadata = {}) {
  const raw = opaqueToken(); const id = crypto.randomUUID();
  await pool.execute(`INSERT INTO sessoes_refresh
    (id,usuario_id,token_hash,expira_em,user_agent,ip_hash)
    VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? DAY),?,?)`,
  [id, userId, hash(raw), env.REFRESH_TOKEN_DAYS, metadata.userAgent ?? null, metadata.ipHash ?? null]);
  return raw;
}

export async function rotateRefreshSession(raw, metadata = {}) {
  if (!raw) throw new HttpError(401, 'REFRESH_REQUIRED', 'Sessão expirada. Entre novamente.');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [rows] = await db.execute(`SELECT s.id,s.usuario_id,s.revogada_em,s.expira_em,u.nome,u.email,u.perfil,u.ativo
      FROM sessoes_refresh s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token_hash=? FOR UPDATE`, [hash(raw)]);
    const session = rows[0];
    if (!session || session.revogada_em || new Date(session.expira_em) <= new Date() || !session.ativo) {
      throw new HttpError(401, 'INVALID_REFRESH', 'Sessão inválida ou expirada.');
    }
    const nextRaw = opaqueToken(); const nextId = crypto.randomUUID();
    await db.execute(`INSERT INTO sessoes_refresh (id,usuario_id,token_hash,expira_em,user_agent,ip_hash)
      VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? DAY),?,?)`,
    [nextId, session.usuario_id, hash(nextRaw), env.REFRESH_TOKEN_DAYS, metadata.userAgent ?? null, metadata.ipHash ?? null]);
    await db.execute('UPDATE sessoes_refresh SET revogada_em=UTC_TIMESTAMP(3),substituida_por=?,ultimo_uso_em=UTC_TIMESTAMP(3) WHERE id=?', [nextId, session.id]);
    await db.commit();
    const user = { id: session.usuario_id, nome: session.nome, email: session.email, perfil: session.perfil };
    return { user, accessToken: token(user), refreshToken: nextRaw };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

export async function revokeRefreshSession(raw) {
  if (raw) await pool.execute('UPDATE sessoes_refresh SET revogada_em=COALESCE(revogada_em,UTC_TIMESTAMP(3)) WHERE token_hash=?', [hash(raw)]);
}

async function createActionToken(userId, tipo, hours) {
  const raw = opaqueToken();
  await pool.execute(`INSERT INTO tokens_usuario (id,usuario_id,tipo,token_hash,expira_em)
    VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? HOUR))`, [crypto.randomUUID(), userId, tipo, hash(raw), hours]);
  return raw;
}

export async function requestEmailVerification(userId) {
  const [users] = await pool.execute('SELECT email FROM usuarios WHERE id=?', [userId]);
  if (!users[0]) throw new HttpError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.');
  const raw = await createActionToken(userId, 'verificacao_email', 24);
  await pool.execute("INSERT INTO outbox_eventos(tipo,payload) VALUES('verificacao_email',JSON_OBJECT('email',?,'token',?))", [users[0].email, raw]);
  return raw;
}
export async function verifyEmail(raw) {
  const db = await pool.getConnection(); try { await db.beginTransaction();
    const [rows] = await db.execute("SELECT id,usuario_id FROM tokens_usuario WHERE token_hash=? AND tipo='verificacao_email' AND usado_em IS NULL AND expira_em>UTC_TIMESTAMP(3) FOR UPDATE", [hash(raw)]);
    if (!rows[0]) throw new HttpError(400, 'INVALID_TOKEN', 'Token inválido ou expirado.');
    await db.execute('UPDATE usuarios SET email_verificado_em=UTC_TIMESTAMP(3) WHERE id=?', [rows[0].usuario_id]);
    await db.execute('UPDATE tokens_usuario SET usado_em=UTC_TIMESTAMP(3) WHERE id=?', [rows[0].id]); await db.commit();
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}
export async function requestPasswordReset(email) {
  const [rows] = await pool.execute('SELECT id FROM usuarios WHERE email=? AND ativo=1', [email]);
  if (!rows[0]) return null;
  const raw = await createActionToken(rows[0].id, 'recuperacao_senha', 1);
  await pool.execute("INSERT INTO outbox_eventos(tipo,payload) VALUES('recuperacao_senha',JSON_OBJECT('email',?,'token',?))", [email, raw]);
  return raw;
}
export async function resetPassword(raw, senha) {
  const db = await pool.getConnection(); try { await db.beginTransaction();
    const [rows] = await db.execute("SELECT id,usuario_id FROM tokens_usuario WHERE token_hash=? AND tipo='recuperacao_senha' AND usado_em IS NULL AND expira_em>UTC_TIMESTAMP(3) FOR UPDATE", [hash(raw)]);
    if (!rows[0]) throw new HttpError(400, 'INVALID_TOKEN', 'Token inválido ou expirado.');
    const senhaHash = await bcrypt.hash(senha, env.BCRYPT_ROUNDS);
    await db.execute('UPDATE usuarios SET senha_hash=? WHERE id=?', [senhaHash, rows[0].usuario_id]);
    await db.execute('UPDATE tokens_usuario SET usado_em=UTC_TIMESTAMP(3) WHERE id=?', [rows[0].id]);
    await db.execute('UPDATE sessoes_refresh SET revogada_em=COALESCE(revogada_em,UTC_TIMESTAMP(3)) WHERE usuario_id=?', [rows[0].usuario_id]);
    await db.commit();
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

export async function register(input) {
  const hash = await bcrypt.hash(input.senha, env.BCRYPT_ROUNDS);
  try {
    const [r] = await pool.execute(
      `INSERT INTO usuarios (nome,email,senha_hash,perfil,telefone,consentimento_privacidade_em,versao_politica_privacidade)
       VALUES (?,?,?,?,?,UTC_TIMESTAMP(3),?)`,
      [input.nome, input.email, hash, input.perfil, input.telefone ?? null, input.versaoPoliticaPrivacidade]);
    const user = { id: r.insertId, nome: input.nome, email: input.email, perfil: input.perfil };
    return { user, accessToken: token(user) };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'EMAIL_ALREADY_EXISTS', 'E-mail já cadastrado.');
    throw e;
  }
}

export async function login(input) {
  const [rows] = await pool.execute(
    'SELECT id,nome,email,senha_hash,perfil,ativo FROM usuarios WHERE email=? LIMIT 1', [input.email]);
  const user = rows[0];
  if (!user || !user.ativo || !(await bcrypt.compare(input.senha, user.senha_hash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
  }
  await pool.execute('UPDATE usuarios SET ultimo_login_em=UTC_TIMESTAMP(3) WHERE id=?', [user.id]);
  const publicUser = { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil };
  return { user: publicUser, accessToken: token(user) };
}

export function authenticate(req, _res, next) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return next(new HttpError(401, 'AUTH_REQUIRED', 'Autenticação necessária.'));
  try {
    const p = jwt.verify(header.slice(7), env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'food-rescue-api', audience: 'food-rescue-web'
    });
    req.user = { id: Number(p.sub), role: p.role }; next();
  } catch { next(new HttpError(401, 'INVALID_TOKEN', 'Token inválido ou expirado.')); }
}
export const authorize = (...roles) => (req, _res, next) => roles.includes(req.user?.role)
  ? next() : next(new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.'));
