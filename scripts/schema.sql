

CREATE DATABASE IF NOT EXISTS hotspot_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE hotspot_db;

-- -------------------------------------------------------------
-- Create application user (adjust password!)
-- -------------------------------------------------------------
CREATE USER IF NOT EXISTS 'hotspot_user'@'localhost'
  IDENTIFIED BY 'StrongPassword123!';
GRANT SELECT, INSERT, UPDATE, DELETE ON hotspot_db.* TO 'hotspot_user'@'localhost';
FLUSH PRIVILEGES;

-- -------------------------------------------------------------
-- Table: users
-- One row per unique phone number.
-- Profile reflects the currently active package.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  phone       VARCHAR(20)      NOT NULL,
  profile     VARCHAR(20)      NOT NULL COMMENT 'MikroTik hotspot profile',
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY  uq_users_phone   (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- Table: payments
-- One row per STK Push attempt. CheckoutRequestID links to callback.
-- mpesa_code has a unique index to prevent double-provisioning.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                    CHAR(36)         NOT NULL COMMENT 'UUID v4',
  phone                 VARCHAR(20)      NOT NULL,
  amount                DECIMAL(10,2)    NOT NULL DEFAULT 0,
  package_key           VARCHAR(20)      NOT NULL COMMENT 'e.g. 1hr, 6hr, 24hr, 7day',
  checkout_request_id   VARCHAR(100)     NULL     COMMENT 'Daraja CheckoutRequestID',
  mpesa_code            VARCHAR(20)      NULL     COMMENT 'MpesaReceiptNumber (e.g. QJK...)',
  status                ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  result_desc           VARCHAR(255)     NULL,
  created_at            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY  uq_payments_mpesa_code    (mpesa_code),
  UNIQUE KEY  uq_payments_checkout_id   (checkout_request_id),
  INDEX       idx_payments_phone        (phone),
  INDEX       idx_payments_status       (status),
  INDEX       idx_payments_created_at   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- Table: sessions
-- Tracks each provisioning event (login). Logout is updated
-- either by a MikroTik webhook or a periodic sync job.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED  NOT NULL,
  login_time        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logout_time       DATETIME         NULL,
  package_key       VARCHAR(20)      NOT NULL,
  mikrotik_profile  VARCHAR(20)      NOT NULL,
  created_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_sessions_user_id    (user_id),
  INDEX idx_sessions_login_time (login_time),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- Table: provisioning_failures
-- Written when payment succeeds but MikroTik API call fails.
-- Admin resolves these manually via /admin/failures.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provisioning_failures (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  payment_id  CHAR(36)         NOT NULL,
  phone       VARCHAR(20)      NOT NULL,
  profile     VARCHAR(20)      NOT NULL,
  error       TEXT             NOT NULL,
  resolved    TINYINT(1)       NOT NULL DEFAULT 0,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pf_resolved   (resolved),
  INDEX idx_pf_phone      (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- Useful views for reporting
-- -------------------------------------------------------------

-- Daily revenue
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
  DATE(created_at)   AS day,
  COUNT(*)           AS transactions,
  SUM(amount)        AS total_kes,
  package_key
FROM payments
WHERE status = 'completed'
GROUP BY DATE(created_at), package_key
ORDER BY day DESC;

-- Active users (rough — based on most recent session per user)
CREATE OR REPLACE VIEW v_active_sessions AS
SELECT
  u.phone,
  u.profile,
  s.login_time,
  s.package_key,
  TIMESTAMPDIFF(MINUTE, s.login_time, NOW()) AS minutes_online
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.logout_time IS NULL
ORDER BY s.login_time DESC;
