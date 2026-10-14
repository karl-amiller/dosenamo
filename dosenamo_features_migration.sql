-- One-time upgrade for databases created from the earlier DOSENAMO MVP schema.
-- Run this before importing the updated dosenamo_mvp.sql. Do not rerun after
-- the columns and index below have been added.

USE dosenamo;

ALTER TABLE products
    MODIFY egg_type ENUM(
        'chicken', 'free_range', 'organic', 'duck', 'salted_duck',
        'quail', 'egg_whites', 'egg_yolks', 'other'
    ) NOT NULL DEFAULT 'chicken';

ALTER TABLE egg_batches
    ADD COLUMN grade_label ENUM('A', 'B', 'C', 'Ungraded') NOT NULL DEFAULT 'Ungraded' AFTER expiry_date;

ALTER TABLE subscription_items
    ADD COLUMN supplier_id INT UNSIGNED NULL AFTER product_id,
    ADD KEY idx_subscription_items_supplier (supplier_id),
    ADD CONSTRAINT fk_subscription_items_supplier
        FOREIGN KEY (supplier_id) REFERENCES farms (farm_id)
        ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE orders
    ADD UNIQUE KEY uq_orders_subscription_delivery (subscription_id, delivery_date);

ALTER TABLE trade_requests
    ADD COLUMN account_manager VARCHAR(100) NOT NULL
        DEFAULT 'DOSENAMO Trade Account Team' AFTER delivery_window;

CREATE TABLE IF NOT EXISTS delivery_zones (
    delivery_zone VARCHAR(50) NOT NULL,
    delivery_day ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') NOT NULL,
    delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 20.00,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (delivery_zone, delivery_day),
    CONSTRAINT chk_delivery_zone_fee CHECK (delivery_fee >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS farm_reviews (
    review_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    farm_id INT UNSIGNED NOT NULL,
    batch_code VARCHAR(50) NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    review_text VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (review_id),
    UNIQUE KEY uq_farm_review_user_batch (user_id, batch_code),
    KEY idx_farm_reviews_farm (farm_id, created_at),
    CONSTRAINT fk_farm_reviews_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_farm_reviews_farm FOREIGN KEY (farm_id)
        REFERENCES farms (farm_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_farm_review_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS breakage_claims (
    claim_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    batch_code VARCHAR(50) NULL,
    damaged_count TINYINT UNSIGNED NOT NULL,
    requested_resolution ENUM('credit', 'replacement') NOT NULL,
    notes VARCHAR(1000) NULL,
    status ENUM('pending', 'approved', 'declined', 'fulfilled') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (claim_id),
    KEY idx_breakage_claims_user (user_id, created_at),
    CONSTRAINT fk_breakage_claims_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_breakage_count CHECK (damaged_count > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    notification_type ENUM('reminder', 'delivery_update', 'account_update', 'claim_update') NOT NULL,
    dedupe_key VARCHAR(150) NOT NULL,
    message VARCHAR(500) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id),
    UNIQUE KEY uq_notifications_dedupe (user_id, dedupe_key),
    KEY idx_notifications_user (user_id, created_at),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;
