# Arquitetura inicial da API REST

Base URL: `/api/v1`. JSON em todas as rotas, exceto o download do PDF. Datas seguem ISO 8601 em UTC. Listagens usam `?page=1&limit=20` (máximo 100).

## Convenções e pipeline

`requestId -> helmet/CORS/rate limit -> JSON limit -> autenticação JWT -> RBAC -> validação/sanitização -> controller -> service/transação -> repository parametrizado -> auditoria -> error handler`

- Access token JWT curto (por exemplo, 15 minutos); refresh token rotativo e armazenado como hash em tabela própria quando essa etapa for implementada.
- Senhas com `bcrypt` e custo configurável; nunca entram em logs ou respostas.
- Validação por schema com rejeição de campos desconhecidos. Sanitização não substitui queries parametrizadas.
- O service concentra regras e transações; controllers não acessam MySQL diretamente.
- Erros seguem `{ "error": { "code", "message", "details?", "requestId" } }`.
- `409 Conflict` representa lote já reservado ou mudança concorrente; `403` representa falta de permissão/posse.

## Autenticação e conta

| Método | Rota | Acesso | Finalidade |
|---|---|---|---|
| POST | `/auth/cadastro` | Público | Cria usuário doador ou ONG e registra aceite de privacidade |
| POST | `/auth/login` | Público | Autentica e emite tokens |
| POST | `/auth/refresh` | Refresh token | Rotaciona tokens |
| POST | `/auth/logout` | Autenticado | Revoga a sessão atual |
| GET | `/usuarios/me` | Autenticado | Retorna o próprio perfil |
| PATCH | `/usuarios/me` | Autenticado | Atualiza campos permitidos |
| DELETE | `/usuarios/me` | Autenticado | Solicita anonimização/exclusão conforme retenção legal |
| GET | `/usuarios/me/dados` | Autenticado | Exportação/portabilidade dos dados pessoais |

## Estabelecimentos

| Método | Rota | Acesso | Finalidade |
|---|---|---|---|
| POST | `/estabelecimentos` | Doador, ONG | Cadastra estabelecimento compatível com o perfil |
| GET | `/estabelecimentos/meus` | Doador, ONG | Lista estabelecimentos do usuário |
| GET | `/estabelecimentos/:id` | Dono, admin | Consulta detalhes completos |
| PATCH | `/estabelecimentos/:id` | Dono, admin | Atualiza estabelecimento |
| PATCH | `/estabelecimentos/:id/status` | Admin | Ativa/inativa cadastro |

## Lotes de alimentos

| Método | Rota | Acesso | Finalidade |
|---|---|---|---|
| POST | `/lotes` | Doador | Cadastra lote em estabelecimento próprio |
| GET | `/lotes` | ONG, admin | Busca lotes disponíveis por categoria, validade e localização |
| GET | `/lotes/meus` | Doador | Lista lotes dos estabelecimentos próprios |
| GET | `/lotes/:id` | Autenticado | Exibe lote, ocultando dados não necessários |
| PATCH | `/lotes/:id` | Doador dono | Edita somente lote ainda disponível |
| POST | `/lotes/:id/cancelamento` | Doador dono, admin | Cancela lote conforme regras de estado |

## Resgates

| Método | Rota | Acesso | Finalidade |
|---|---|---|---|
| POST | `/lotes/:loteId/solicitacoes` | ONG | Registra interesse da ONG |
| GET | `/solicitacoes/minhas` | ONG | Lista solicitações da própria ONG |
| GET | `/lotes/:loteId/solicitacoes` | Doador dono, admin | Lista interessados no lote |
| POST | `/solicitacoes/:id/reserva` | Doador dono, admin | Reserva atomicamente o lote para uma solicitação |
| POST | `/solicitacoes/:id/confirmacao` | Doador dono, ONG escolhida, admin | Confirma entrega com idempotência e gera comprovante |
| POST | `/solicitacoes/:id/cancelamento` | Participante, admin | Cancela, respeitando a máquina de estados |
| GET | `/solicitacoes/:id/comprovante` | Participantes, admin | Baixa PDF por resposta autenticada ou URL assinada curta |

### Transação crítica de reserva

O endpoint `POST /solicitacoes/:id/reserva` executa no service, na mesma conexão MySQL:

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
START TRANSACTION;

SELECT s.id, s.status, s.lote_id, l.status AS lote_status, l.validade_em
FROM solicitacoes_resgate s
JOIN lotes_alimentos l ON l.id = s.lote_id
WHERE s.id = ?
FOR UPDATE;

-- A aplicação valida: solicitação='solicitada', lote='disponivel' e não vencido.
UPDATE lotes_alimentos
SET status = 'reservado', versao = versao + 1
WHERE id = ? AND status = 'disponivel';

-- Exigir affectedRows = 1; caso contrário, ROLLBACK e HTTP 409.
UPDATE solicitacoes_resgate
SET status = 'reservada', reservada_em = UTC_TIMESTAMP(3),
    reserva_expira_em = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 HOUR)
WHERE id = ? AND status = 'solicitada';

-- Rejeitar/expirar as demais solicitações abertas e inserir log antes do COMMIT.
COMMIT;
```

Qualquer erro causa `ROLLBACK`. O lock serializa concorrentes; o `UPDATE ... WHERE status` impede transição obsoleta; e `uk_solicitacoes_reserva_exclusiva` é a última barreira de integridade. Deadlock/timeout deve gerar rollback e, no máximo, poucas retentativas com jitter.

## Administração e auditoria

| Método | Rota | Acesso | Finalidade |
|---|---|---|---|
| GET | `/admin/usuarios` | Admin | Consulta cadastros com filtros e minimização de dados |
| PATCH | `/admin/usuarios/:id/status` | Admin | Ativa/inativa usuário e audita a ação |
| GET | `/admin/auditoria` | Admin | Consulta paginada de logs |
| GET | `/admin/relatorios/resgates.pdf` | Admin | Gera relatório PDF com filtros |

## Confirmação e PDF

`POST /solicitacoes/:id/confirmacao` deve exigir um header `Idempotency-Key`, bloquear a solicitação e o lote com `FOR UPDATE`, mudar os estados para `confirmada`/`resgatado`, gravar UUID do comprovante e confirmar a transação. A geração do PDF e o e-mail devem ocorrer depois do commit por job/outbox; assim, falha externa não desfaz a entrega. O PDF contém apenas os dados necessários e fica em storage privado.

## Próximos ajustes de persistência

Antes da implementação de autenticação, acrescentar tabelas para `sessoes_refresh`, `tokens_verificacao`, `idempotency_keys` e `outbox_eventos`. Elas foram mantidas fora do DDL de domínio inicial para preservar o recorte solicitado, mas são necessárias para uma solução de produção robusta.
