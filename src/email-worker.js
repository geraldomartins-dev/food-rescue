import nodemailer from 'nodemailer';
import { env } from './config.js';
import { pool } from './database.js';

const transport = env.SMTP_HOST ? nodemailer.createTransport({
  host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
}) : nodemailer.createTransport({ jsonTransport: true });

async function claimEvent() {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [rows] = await db.execute(
      `SELECT id,tipo,payload FROM outbox_eventos
       WHERE (status='pendente' OR (status='processando' AND bloqueado_em<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)))
       AND disponivel_em<=UTC_TIMESTAMP(3) AND tentativas<5 ORDER BY criado_em LIMIT 1 FOR UPDATE`);
    const event = rows[0];
    if (!event) { await db.commit(); return null; }
    await db.execute("UPDATE outbox_eventos SET status='processando',bloqueado_em=UTC_TIMESTAMP(3),tentativas=tentativas+1 WHERE id=?", [event.id]);
    await db.commit(); return event;
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

export async function processEmailOutboxOnce() {
  const event = await claimEvent();
  if (!event) return false;
  try {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
    let message;
    if (event.tipo === 'resgate_confirmado') message = { to: payload.destinatarios,
      subject: `Food Rescue - resgate confirmado: ${payload.titulo}`,
      text: `Resgate confirmado: ${payload.quantidade} ${payload.unidade} de ${payload.titulo}.\nComprovante: ${payload.codigoComprovante}` };
    else if (event.tipo === 'verificacao_email') message = { to: payload.email, subject: 'Food Rescue - verifique seu e-mail',
      text: `Confirme seu e-mail: ${env.APP_ORIGIN}/?verificar=${encodeURIComponent(payload.token)}` };
    else if (event.tipo === 'recuperacao_senha') message = { to: payload.email, subject: 'Food Rescue - redefinição de senha',
      text: `Redefina sua senha: ${env.APP_ORIGIN}/?redefinir=${encodeURIComponent(payload.token)}` };
    else throw new Error(`Evento desconhecido: ${event.tipo}`);
    const info = await transport.sendMail({ from: env.EMAIL_FROM, ...message });
    if (!env.SMTP_HOST && env.NODE_ENV !== 'test') console.log(`E-mail local simulado processado: evento ${event.id}`);
    await pool.execute("UPDATE outbox_eventos SET status='enviado',enviado_em=UTC_TIMESTAMP(3),ultimo_erro=NULL,payload=JSON_OBJECT('redigido',TRUE) WHERE id=?", [event.id]);
  } catch (error) {
    await pool.execute(`UPDATE outbox_eventos SET status=IF(tentativas>=5,'falha','pendente'),
      disponivel_em=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL POW(2,tentativas) MINUTE),ultimo_erro=? WHERE id=?`,
    [String(error.message).slice(0, 1000), event.id]);
  }
  return true;
}

export function startEmailWorker() {
  if (!env.EMAIL_WORKER_ENABLED) return () => {};
  let running = false;
  const run = async () => { if (running) return; running = true;
    try { while (await processEmailOutboxOnce()) {} }
    catch (error) { console.error('Falha no worker de e-mail:', error.message); }
    finally { running = false; }
  };
  void run(); const timer = setInterval(run, env.EMAIL_WORKER_INTERVAL_MS); timer.unref();
  return () => clearInterval(timer);
}
