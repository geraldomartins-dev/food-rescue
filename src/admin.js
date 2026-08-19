import { z } from 'zod';
import { pool } from './database.js';
import { HttpError } from './http.js';

export const userStatusSchema = z.object({ ativo: z.boolean() }).strict();

export async function getAdminMetrics() {
  const [[users], [lots], [rescues], [donations]] = await Promise.all([
    pool.execute(`SELECT COUNT(*) total,
      SUM(perfil='doador') doadores,SUM(perfil='ong') ongs,SUM(perfil='admin') admins,
      SUM(ativo=1) ativos FROM usuarios`),
    pool.execute(`SELECT COUNT(*) total,SUM(status='disponivel') disponiveis,
      SUM(status='reservado') reservados,SUM(status='resgatado') resgatados FROM lotes_alimentos`),
    pool.execute(`SELECT COUNT(*) total,SUM(status='solicitada') solicitadas,
      SUM(status='reservada') reservadas,SUM(status='confirmada') confirmadas FROM solicitacoes_resgate`),
    pool.execute(`SELECT COUNT(*) entregas_confirmadas,COUNT(DISTINCT estabelecimento_ong_id) ongs_atendidas
      FROM solicitacoes_resgate WHERE status='confirmada'`)
  ]);
  return { usuarios: users[0], lotes: lots[0], resgates: rescues[0], impacto: donations[0] };
}

export async function listUsers() {
  const [rows] = await pool.execute(`SELECT id,nome,email,perfil,telefone,ativo,email_verificado_em,
    ultimo_login_em,criado_em FROM usuarios ORDER BY criado_em DESC LIMIT 100`);
  return rows;
}

export async function setUserStatus({ targetId, ativo, adminId, correlationId }) {
  if (targetId === adminId && !ativo) throw new HttpError(409, 'CANNOT_DISABLE_SELF', 'Você não pode desativar a própria conta.');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [result] = await db.execute('UPDATE usuarios SET ativo=? WHERE id=?', [ativo, targetId]);
    if (!result.affectedRows) throw new HttpError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.');
    await db.execute(`INSERT INTO logs_auditoria
      (usuario_id,acao,entidade,entidade_id,resultado,correlation_id,dados_novos)
      VALUES (?,'alterar_status_usuario','usuarios',?,'sucesso',?,JSON_OBJECT('ativo',?))`,
    [adminId, targetId, correlationId, ativo]);
    await db.commit(); return { id: targetId, ativo };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

export async function listAuditLogs() {
  const [rows] = await pool.execute(`SELECT l.id,l.acao,l.entidade,l.entidade_id,l.resultado,
    l.correlation_id,l.criado_em,u.nome usuario_nome,u.email usuario_email
    FROM logs_auditoria l LEFT JOIN usuarios u ON u.id=l.usuario_id
    ORDER BY l.criado_em DESC LIMIT 100`);
  return rows;
}

export async function getReportData() {
  const metrics = await getAdminMetrics();
  const [rescues] = await pool.execute(`SELECT s.id,s.confirmada_em,s.codigo_comprovante,
    l.titulo,l.categoria,l.quantidade,l.unidade,d.nome_fantasia doador,o.nome_fantasia ong,
    d.cidade,d.uf FROM solicitacoes_resgate s JOIN lotes_alimentos l ON l.id=s.lote_id
    JOIN estabelecimentos d ON d.id=l.estabelecimento_doador_id
    JOIN estabelecimentos o ON o.id=s.estabelecimento_ong_id
    WHERE s.status='confirmada' ORDER BY s.confirmada_em DESC LIMIT 200`);
  return { geradoEm: new Date(), metrics, rescues };
}
