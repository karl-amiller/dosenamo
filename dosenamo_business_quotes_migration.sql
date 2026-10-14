-- One-time upgrade for a DOSENAMO database that already has the feature tables
-- and account_manager column from dosenamo_features_migration.sql.
-- Fresh databases already receive these fields from dosenamo_mvp.sql.

USE dosenamo;

ALTER TABLE trade_requests
    ADD COLUMN product_id INT UNSIGNED NULL AFTER user_id,
    ADD COLUMN quoted_unit_price DECIMAL(10,2) NULL AFTER delivery_window,
    ADD KEY idx_trade_requests_product (product_id),
    ADD CONSTRAINT fk_trade_requests_product FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE SET NULL;
