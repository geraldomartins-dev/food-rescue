import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from './config.js';
import { pool } from './database.js';
import { HttpError } from './http.js';

export const establishmentSchema = z.object({
  tipo: z.enum(['doador', 'ong']),
  nomeFantasia: z.string().trim().min(2).max(160),
  razaoSocial: z.string().trim().max(160).optional(),
  documento: z.string().transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 11 || value.length === 14, 'CPF/CNPJ inválido.'),
  emailContato: z.string().trim().toLowerCase().email().max(254).optional(),
  telefoneContato: z.string().trim().min(8).max(20).optional(),
  cep: z.string().transform((value) => value.replace(/\D/g, '')).refine((value) => value.length === 8, 'CEP inválido.'),
  logradouro: z.string().trim().min(2).max(180),
  numero: z.string().trim().min(1).max(20),
  complemento: z.string().trim().max(100).optional(),
  bairro: z.string().trim().min(2).max(100),
  cidade: z.string().trim().min(2).max(100),
  uf: z.string().trim().toUpperCase().length(2),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional()
}).strict();

export async function createEstablishment(input, user) {
  if (input.tipo !== user.role) {
    throw new HttpError(403, 'INVALID_ESTABLISHMENT_TYPE', 'O tipo deve corresponder ao perfil do usuário.');
  }
  const documentHash = crypto.createHmac('sha256', env.DATA_HASH_SECRET).update(input.documento).digest('hex');
  try {
    const [result] = await pool.execute(
      `INSERT INTO estabelecimentos
       (usuario_responsavel_id,tipo,nome_fantasia,razao_social,documento_hash,email_contato,
        telefone_contato,cep,logradouro,numero,complemento,bairro,cidade,uf,latitude,longitude)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [user.id, input.tipo, input.nomeFantasia, input.razaoSocial ?? null, documentHash,
        input.emailContato ?? null, input.telefoneContato ?? null, input.cep, input.logradouro,
        input.numero, input.complemento ?? null, input.bairro, input.cidade, input.uf,
        input.latitude ?? null, input.longitude ?? null]);
    return { id: result.insertId, tipo: input.tipo, nomeFantasia: input.nomeFantasia };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'DOCUMENT_ALREADY_EXISTS', 'Documento já vinculado a um estabelecimento.');
    }
    throw error;
  }
}

export async function listOwnEstablishments(userId) {
  const [rows] = await pool.execute(
    `SELECT id,tipo,nome_fantasia,razao_social,email_contato,telefone_contato,cep,
            logradouro,numero,complemento,bairro,cidade,uf,latitude,longitude,ativo,criado_em
     FROM estabelecimentos WHERE usuario_responsavel_id=? ORDER BY criado_em DESC`, [userId]);
  return rows;
}
