-- Food Rescue - MySQL 8.0+
-- Execute com um usuário autorizado a criar o banco e as tabelas.

CREATE DATABASE IF NOT EXISTS food_rescue
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE food_rescue;

CREATE TABLE usuarios (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  perfil ENUM('doador', 'ong', 'admin') NOT NULL,
  telefone VARCHAR(20) NULL,
  documento_hash CHAR(64) NULL COMMENT 'Hash para busca/deduplicacao; nao guardar documento em claro',
  documento_criptografado VARBINARY(512) NULL COMMENT 'Opcional; criptografia em nivel de aplicacao',
  consentimento_privacidade_em DATETIME(3) NULL,
  versao_politica_privacidade VARCHAR(20) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  email_verificado_em DATETIME(3) NULL,
  ultimo_login_em DATETIME(3) NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_usuarios_email (email),
  KEY idx_usuarios_perfil_ativo (perfil, ativo)
) ENGINE=InnoDB;

CREATE TABLE estabelecimentos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_responsavel_id BIGINT UNSIGNED NOT NULL,
  tipo ENUM('doador', 'ong') NOT NULL,
  nome_fantasia VARCHAR(160) NOT NULL,
  razao_social VARCHAR(160) NULL,
  documento_hash CHAR(64) NOT NULL,
  documento_criptografado VARBINARY(512) NULL,
  email_contato VARCHAR(254) NULL,
  telefone_contato VARCHAR(20) NULL,
  cep CHAR(8) NOT NULL,
  logradouro VARCHAR(180) NOT NULL,
  numero VARCHAR(20) NOT NULL,
  complemento VARCHAR(100) NULL,
  bairro VARCHAR(100) NOT NULL,
  cidade VARCHAR(100) NOT NULL,
  uf CHAR(2) NOT NULL,
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_estabelecimentos_documento_hash (documento_hash),
  KEY idx_estabelecimentos_responsavel (usuario_responsavel_id),
  KEY idx_estabelecimentos_localizacao (uf, cidade, ativo),
  CONSTRAINT fk_estabelecimentos_responsavel
    FOREIGN KEY (usuario_responsavel_id) REFERENCES usuarios (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE lotes_alimentos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  estabelecimento_doador_id BIGINT UNSIGNED NOT NULL,
  cadastrado_por_id BIGINT UNSIGNED NOT NULL,
  titulo VARCHAR(140) NOT NULL,
  descricao VARCHAR(1000) NULL,
  categoria ENUM(
    'frutas_verduras', 'graos_cereais', 'padaria', 'laticinios',
    'carnes', 'refeicoes_prontas', 'bebidas', 'outros'
  ) NOT NULL,
  quantidade DECIMAL(12, 3) NOT NULL,
  unidade ENUM('kg', 'g', 'l', 'ml', 'unidade', 'caixa', 'porcao') NOT NULL,
  validade_em DATETIME(3) NOT NULL,
  retirada_inicio_em DATETIME(3) NOT NULL,
  retirada_fim_em DATETIME(3) NOT NULL,
  observacoes_armazenamento VARCHAR(500) NULL,
  status ENUM('disponivel', 'reservado', 'resgatado', 'cancelado', 'expirado')
    NOT NULL DEFAULT 'disponivel',
  versao INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Suporte adicional a controle otimista',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_lotes_estabelecimento (estabelecimento_doador_id, criado_em),
  KEY idx_lotes_busca (status, validade_em, categoria),
  KEY idx_lotes_retirada (status, retirada_inicio_em, retirada_fim_em),
  CONSTRAINT chk_lotes_quantidade CHECK (quantidade > 0),
  CONSTRAINT chk_lotes_janela_retirada CHECK (retirada_fim_em >= retirada_inicio_em),
  CONSTRAINT fk_lotes_estabelecimento
    FOREIGN KEY (estabelecimento_doador_id) REFERENCES estabelecimentos (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lotes_cadastrado_por
    FOREIGN KEY (cadastrado_por_id) REFERENCES usuarios (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE solicitacoes_resgate (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lote_id BIGINT UNSIGNED NOT NULL,
  estabelecimento_ong_id BIGINT UNSIGNED NOT NULL,
  solicitante_id BIGINT UNSIGNED NOT NULL,
  status ENUM('solicitada', 'reservada', 'confirmada', 'cancelada', 'rejeitada', 'expirada')
    NOT NULL DEFAULT 'solicitada',
  mensagem VARCHAR(500) NULL,
  reservada_em DATETIME(3) NULL,
  reserva_expira_em DATETIME(3) NULL,
  confirmada_em DATETIME(3) NULL,
  cancelada_em DATETIME(3) NULL,
  motivo_cancelamento VARCHAR(500) NULL,
  codigo_comprovante CHAR(36) NULL,
  comprovante_pdf_chave VARCHAR(500) NULL COMMENT 'Chave privada no storage; nao URL publica',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  -- Uma reserva confirmada/ativa por lote. Solicitacoes concorrentes ainda podem existir.
  lote_reserva_exclusiva BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN status IN ('reservada', 'confirmada') THEN lote_id ELSE NULL END
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_solicitacoes_reserva_exclusiva (lote_reserva_exclusiva),
  UNIQUE KEY uk_solicitacoes_comprovante (codigo_comprovante),
  KEY idx_solicitacoes_lote_status (lote_id, status, criado_em),
  KEY idx_solicitacoes_ong_status (estabelecimento_ong_id, status, criado_em),
  KEY idx_solicitacoes_expiracao (status, reserva_expira_em),
  CONSTRAINT chk_solicitacoes_reserva_datas CHECK (
    (status <> 'reservada') OR (reservada_em IS NOT NULL AND reserva_expira_em IS NOT NULL)
  ),
  CONSTRAINT chk_solicitacoes_confirmacao CHECK (
    (status <> 'confirmada') OR (confirmada_em IS NOT NULL AND codigo_comprovante IS NOT NULL)
  ),
  CONSTRAINT fk_solicitacoes_lote
    FOREIGN KEY (lote_id) REFERENCES lotes_alimentos (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitacoes_ong
    FOREIGN KEY (estabelecimento_ong_id) REFERENCES estabelecimentos (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitacoes_solicitante
    FOREIGN KEY (solicitante_id) REFERENCES usuarios (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE logs_auditoria (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NULL,
  acao VARCHAR(80) NOT NULL,
  entidade VARCHAR(80) NOT NULL,
  entidade_id BIGINT UNSIGNED NULL,
  resultado ENUM('sucesso', 'falha') NOT NULL,
  ip_hash CHAR(64) NULL COMMENT 'Preferir hash com salt rotativo ou truncamento',
  user_agent VARCHAR(500) NULL,
  correlation_id CHAR(36) NOT NULL,
  dados_anteriores JSON NULL COMMENT 'Somente campos nao sensiveis e estritamente necessarios',
  dados_novos JSON NULL COMMENT 'Nunca registrar senha, token ou documento em claro',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_logs_usuario_data (usuario_id, criado_em),
  KEY idx_logs_entidade_data (entidade, entidade_id, criado_em),
  KEY idx_logs_correlation (correlation_id),
  KEY idx_logs_retencao (criado_em),
  CONSTRAINT fk_logs_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB;
