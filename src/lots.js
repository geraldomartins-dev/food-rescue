import { z } from 'zod';
import { pool } from './database.js';
import { HttpError } from './http.js';

export const lotSchema = z.object({
  estabelecimentoDoadorId: z.coerce.number().int().positive(),
  titulo: z.string().trim().min(3).max(140),
  descricao: z.string().trim().max(1000).optional(),
  categoria: z.enum(['frutas_verduras', 'graos_cereais', 'padaria', 'laticinios',
    'carnes', 'refeicoes_prontas', 'bebidas', 'outros']),
  quantidade: z.coerce.number().positive().max(999999999),
  unidade: z.enum(['kg', 'g', 'l', 'ml', 'unidade', 'caixa', 'porcao']),
  validadeEm: z.iso.datetime(),
  retiradaInicioEm: z.iso.datetime(),
  retiradaFimEm: z.iso.datetime(),
  observacoesArmazenamento: z.string().trim().max(500).optional()
}).strict().superRefine((data, context) => {
  const now = new Date();
  if (new Date(data.validadeEm) <= now) context.addIssue({ code: 'custom', path: ['validadeEm'], message: 'A validade deve estar no futuro.' });
  if (new Date(data.retiradaFimEm) < new Date(data.retiradaInicioEm)) {
    context.addIssue({ code: 'custom', path: ['retiradaFimEm'], message: 'Fim da retirada anterior ao início.' });
  }
});

export async function createLot(input, userId) {
  const [owners] = await pool.execute(
    `SELECT id FROM estabelecimentos
     WHERE id=? AND usuario_responsavel_id=? AND tipo='doador' AND ativo=1`,
    [input.estabelecimentoDoadorId, userId]);
  if (!owners.length) throw new HttpError(403, 'ESTABLISHMENT_NOT_OWNED', 'Estabelecimento doador inválido.');

  const [result] = await pool.execute(
    `INSERT INTO lotes_alimentos
     (estabelecimento_doador_id,cadastrado_por_id,titulo,descricao,categoria,quantidade,
      unidade,validade_em,retirada_inicio_em,retirada_fim_em,observacoes_armazenamento)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [input.estabelecimentoDoadorId, userId, input.titulo, input.descricao ?? null,
      input.categoria, input.quantidade, input.unidade, new Date(input.validadeEm),
      new Date(input.retiradaInicioEm), new Date(input.retiradaFimEm),
      input.observacoesArmazenamento ?? null]);
  return { id: result.insertId, status: 'disponivel' };
}

export async function listAvailableLots() {
  const [rows] = await pool.execute(
    `SELECT l.id,l.titulo,l.descricao,l.categoria,l.quantidade,l.unidade,l.validade_em,
            l.retirada_inicio_em,l.retirada_fim_em,e.nome_fantasia,e.cidade,e.uf
     FROM lotes_alimentos l JOIN estabelecimentos e ON e.id=l.estabelecimento_doador_id
     WHERE l.status='disponivel' AND l.validade_em>UTC_TIMESTAMP(3) AND e.ativo=1
     ORDER BY l.validade_em ASC LIMIT 100`);
  return rows;
}
