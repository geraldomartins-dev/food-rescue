USE food_rescue;
CREATE TABLE IF NOT EXISTS outbox_eventos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo VARCHAR(80) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pendente','processando','enviado','falha') NOT NULL DEFAULT 'pendente',
  tentativas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  disponivel_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  bloqueado_em DATETIME(3) NULL,
  enviado_em DATETIME(3) NULL,
  ultimo_erro VARCHAR(1000) NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_outbox_processamento (status, disponivel_em, criado_em)
) ENGINE=InnoDB;
