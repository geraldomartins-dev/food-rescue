USE food_rescue;
CREATE TABLE IF NOT EXISTS sessoes_refresh (
  id CHAR(36) NOT NULL, usuario_id BIGINT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL,
  expira_em DATETIME(3) NOT NULL, revogada_em DATETIME(3) NULL, substituida_por CHAR(36) NULL,
  user_agent VARCHAR(500) NULL, ip_hash CHAR(64) NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), ultimo_uso_em DATETIME(3) NULL,
  PRIMARY KEY(id), UNIQUE KEY uk_refresh_hash(token_hash), KEY idx_refresh_user(usuario_id,expira_em),
  CONSTRAINT fk_refresh_usuario FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS tokens_usuario (
  id CHAR(36) NOT NULL, usuario_id BIGINT UNSIGNED NOT NULL,
  tipo ENUM('verificacao_email','recuperacao_senha') NOT NULL, token_hash CHAR(64) NOT NULL,
  expira_em DATETIME(3) NOT NULL, usado_em DATETIME(3) NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id), UNIQUE KEY uk_tokens_usuario_hash(token_hash),
  KEY idx_tokens_usuario(usuario_id,tipo,expira_em),
  CONSTRAINT fk_tokens_usuario FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;
