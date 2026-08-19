import { pool } from './database.js';
import { HttpError } from './http.js';
import crypto from 'node:crypto';
import { generateReceiptPdf } from './receipt-pdf.js';

export async function requestRescue({ loteId, estabelecimentoOngId, userId, mensagem }) {
  const [ongs] = await pool.execute(
    `SELECT id FROM estabelecimentos
     WHERE id=? AND usuario_responsavel_id=? AND tipo='ong' AND ativo=1`,
    [estabelecimentoOngId, userId]);
  if (!ongs.length) throw new HttpError(403, 'ONG_NOT_OWNED', 'Estabelecimento ONG inválido.');

  const [lots] = await pool.execute(
    "SELECT id FROM lotes_alimentos WHERE id=? AND status='disponivel' AND validade_em>UTC_TIMESTAMP(3)",
    [loteId]);
  if (!lots.length) throw new HttpError(409, 'LOT_UNAVAILABLE', 'Lote indisponível para resgate.');

  const [existing] = await pool.execute(
    `SELECT id FROM solicitacoes_resgate
     WHERE lote_id=? AND estabelecimento_ong_id=? AND status IN ('solicitada','reservada') LIMIT 1`,
    [loteId, estabelecimentoOngId]);
  if (existing.length) throw new HttpError(409, 'REQUEST_ALREADY_EXISTS', 'A ONG já solicitou este lote.');

  const [result] = await pool.execute(
    `INSERT INTO solicitacoes_resgate (lote_id,estabelecimento_ong_id,solicitante_id,mensagem)
     VALUES (?,?,?,?)`, [loteId, estabelecimentoOngId, userId, mensagem ?? null]);
  return { id: result.insertId, status: 'solicitada' };
}

export async function reserveRescue({ requestId, userId, admin }) {
  const db = await pool.getConnection();
  try {
    await db.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await db.beginTransaction();
    const [rows] = await db.execute(
      `SELECT s.id,s.status,s.lote_id,l.status lote_status,l.validade_em,e.usuario_responsavel_id
       FROM solicitacoes_resgate s JOIN lotes_alimentos l ON l.id=s.lote_id
       JOIN estabelecimentos e ON e.id=l.estabelecimento_doador_id WHERE s.id=? FOR UPDATE`, [requestId]);
    const rescue = rows[0];
    if (!rescue) throw new HttpError(404, 'RESCUE_NOT_FOUND', 'Solicitação não encontrada.');
    if (!admin && rescue.usuario_responsavel_id !== userId) throw new HttpError(403, 'FORBIDDEN', 'Solicitação de outro doador.');
    if (rescue.status !== 'solicitada' || rescue.lote_status !== 'disponivel' || new Date(rescue.validade_em) <= new Date()) {
      throw new HttpError(409, 'LOT_UNAVAILABLE', 'Lote indisponível.');
    }
    const [updated] = await db.execute(
      "UPDATE lotes_alimentos SET status='reservado',versao=versao+1 WHERE id=? AND status='disponivel'", [rescue.lote_id]);
    if (updated.affectedRows !== 1) throw new HttpError(409, 'LOT_UNAVAILABLE', 'Outra ONG reservou o lote.');
    await db.execute(
      "UPDATE solicitacoes_resgate SET status='reservada',reservada_em=UTC_TIMESTAMP(3),reserva_expira_em=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 HOUR) WHERE id=?", [requestId]);
    await db.execute(
      "UPDATE solicitacoes_resgate SET status='rejeitada' WHERE lote_id=? AND id<>? AND status='solicitada'", [rescue.lote_id, requestId]);
    await db.commit(); return { id: requestId, status: 'reservada' };
  } catch (e) {
    await db.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'LOT_UNAVAILABLE', 'Outra ONG reservou o lote.');
    throw e;
  } finally { db.release(); }
}

export async function confirmRescue({ requestId, user, correlationId }) {
  const db = await pool.getConnection();
  let receipt;
  try {
    await db.beginTransaction();
    const [rows] = await db.execute(
      `SELECT s.id,s.status,s.codigo_comprovante,s.confirmada_em,l.id lote_id,l.status lote_status,
              l.titulo,l.categoria,l.quantidade,l.unidade,d.nome_fantasia estabelecimento_doador,
              d.usuario_responsavel_id doador_usuario_id,d.cidade,d.uf,
              o.nome_fantasia estabelecimento_ong,o.usuario_responsavel_id ong_usuario_id,
              ud.email doador_email,uo.email ong_email
       FROM solicitacoes_resgate s JOIN lotes_alimentos l ON l.id=s.lote_id
       JOIN estabelecimentos d ON d.id=l.estabelecimento_doador_id
       JOIN estabelecimentos o ON o.id=s.estabelecimento_ong_id
       JOIN usuarios ud ON ud.id=d.usuario_responsavel_id
       JOIN usuarios uo ON uo.id=o.usuario_responsavel_id
       WHERE s.id=? FOR UPDATE`, [requestId]);
    const rescue = rows[0];
    if (!rescue) throw new HttpError(404, 'RESCUE_NOT_FOUND', 'Solicitação não encontrada.');
    const participant = user.role === 'admin' || user.id === rescue.doador_usuario_id || user.id === rescue.ong_usuario_id;
    if (!participant) throw new HttpError(403, 'FORBIDDEN', 'Você não participa deste resgate.');

    if (rescue.status === 'confirmada') {
      receipt = { ...rescue, codigoComprovante: rescue.codigo_comprovante,
        confirmadaEm: rescue.confirmada_em, estabelecimentoDoador: rescue.estabelecimento_doador,
        estabelecimentoOng: rescue.estabelecimento_ong };
      await db.commit();
    } else {
      if (rescue.status !== 'reservada' || rescue.lote_status !== 'reservado') {
        throw new HttpError(409, 'INVALID_RESCUE_STATE', 'Somente uma reserva ativa pode ser confirmada.');
      }
      const code = crypto.randomUUID();
      await db.execute(
        `UPDATE solicitacoes_resgate SET status='confirmada',confirmada_em=UTC_TIMESTAMP(3),
         codigo_comprovante=? WHERE id=? AND status='reservada'`, [code, requestId]);
      await db.execute("UPDATE lotes_alimentos SET status='resgatado',versao=versao+1 WHERE id=? AND status='reservado'", [rescue.lote_id]);
      await db.execute(
        `INSERT INTO logs_auditoria (usuario_id,acao,entidade,entidade_id,resultado,correlation_id,dados_novos)
         VALUES (?,'confirmar_resgate','solicitacoes_resgate',?,'sucesso',?,JSON_OBJECT('status','confirmada','comprovante',?))`,
        [user.id, requestId, correlationId, code]);
      await db.execute(
        `INSERT INTO outbox_eventos (tipo,payload) VALUES ('resgate_confirmado',JSON_OBJECT(
         'solicitacaoId',?,'codigoComprovante',?,'titulo',?,'quantidade',?,'unidade',?,
         'destinatarios',JSON_ARRAY(?,?)))`,
        [requestId, code, rescue.titulo, rescue.quantidade, rescue.unidade,
          rescue.doador_email, rescue.ong_email]);
      await db.commit();
      receipt = { ...rescue, codigoComprovante: code, confirmadaEm: new Date(),
        estabelecimentoDoador: rescue.estabelecimento_doador, estabelecimentoOng: rescue.estabelecimento_ong };
    }
  } catch (error) {
    await db.rollback(); throw error;
  } finally { db.release(); }

  const pdfPath = await generateReceiptPdf(receipt);
  await pool.execute('UPDATE solicitacoes_resgate SET comprovante_pdf_chave=? WHERE id=?',
    [`comprovantes/${receipt.codigoComprovante}.pdf`, requestId]);
  return { id: requestId, status: 'confirmada', codigoComprovante: receipt.codigoComprovante, pdfPath };
}

export async function findReceipt({ requestId, user }) {
  const [rows] = await pool.execute(
    `SELECT s.codigo_comprovante,d.usuario_responsavel_id doador_usuario_id,
            o.usuario_responsavel_id ong_usuario_id
     FROM solicitacoes_resgate s JOIN lotes_alimentos l ON l.id=s.lote_id
     JOIN estabelecimentos d ON d.id=l.estabelecimento_doador_id
     JOIN estabelecimentos o ON o.id=s.estabelecimento_ong_id
     WHERE s.id=? AND s.status='confirmada'`, [requestId]);
  const receipt = rows[0];
  if (!receipt) throw new HttpError(404, 'RECEIPT_NOT_FOUND', 'Comprovante não encontrado.');
  if (user.role !== 'admin' && user.id !== receipt.doador_usuario_id && user.id !== receipt.ong_usuario_id) {
    throw new HttpError(403, 'FORBIDDEN', 'Você não participa deste resgate.');
  }
  return receipt.codigo_comprovante;
}

export async function listRescues(user) {
  let ownership;
  const params = [];
  if (user.role === 'doador') {
    ownership = 'd.usuario_responsavel_id=?'; params.push(user.id);
  } else if (user.role === 'ong') {
    ownership = 'o.usuario_responsavel_id=?'; params.push(user.id);
  } else {
    ownership = '1=1';
  }
  const [rows] = await pool.execute(
    `SELECT s.id,s.status,s.mensagem,s.criado_em,s.reservada_em,s.reserva_expira_em,
            s.confirmada_em,s.codigo_comprovante,l.id lote_id,l.titulo,l.categoria,
            l.quantidade,l.unidade,l.validade_em,d.nome_fantasia estabelecimento_doador,
            o.nome_fantasia estabelecimento_ong
     FROM solicitacoes_resgate s JOIN lotes_alimentos l ON l.id=s.lote_id
     JOIN estabelecimentos d ON d.id=l.estabelecimento_doador_id
     JOIN estabelecimentos o ON o.id=s.estabelecimento_ong_id
     WHERE ${ownership} ORDER BY s.criado_em DESC LIMIT 100`, params);
  return rows;
}
