-- DOSENAMO MVP Database
-- MySQL 8.0+
-- Creates a starter database for users, products, farms, egg batches,
-- recurring subscriptions, orders, and order items.
--
-- Import using phpMyAdmin or MySQL Workbench.
-- This script creates the database and tables but does not create a login
-- account or insert demo data.

CREATE DATABASE IF NOT EXISTS dosenamo
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE dosenamo;

-- 1. Customer and business accounts
CREATE TABLE IF NOT EXISTS users (
    user_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NULL,
    account_type ENUM('household', 'business') NOT NULL DEFAULT 'household',
    business_name VARCHAR(150) NULL,
    address TEXT NULL,
    delivery_zone VARCHAR(50) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_delivery_zone (delivery_zone)
) ENGINE=InnoDB;

-- 2. Products: egg type, size, packaging and current selling price.
-- If prices differ by size/packaging, create a separate product row for each
-- sellable combination in this MVP.
CREATE TABLE IF NOT EXISTS products (
    product_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_name VARCHAR(100) NOT NULL,
    egg_type ENUM('chicken', 'free_range', 'organic', 'duck', 'salted_duck', 'quail', 'egg_whites', 'egg_yolks', 'other')
        NOT NULL DEFAULT 'chicken',
    size_name ENUM('peewee', 'small', 'medium', 'large', 'extra_large', 'jumbo', 'mixed', 'not_applicable')
        NOT NULL DEFAULT 'large',
    weight_min_g DECIMAL(6,2) NULL,
    weight_max_g DECIMAL(6,2) NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'tray',
    units_per_tray INT UNSIGNED NOT NULL DEFAULT 30,
    price DECIMAL(10,2) NOT NULL,
    stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
    is_available TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id),
    KEY idx_products_type_size (egg_type, size_name),
    KEY idx_products_available (is_available),
    CONSTRAINT chk_products_price CHECK (price >= 0),
    CONSTRAINT chk_products_weights CHECK (
        weight_min_g IS NULL OR weight_max_g IS NULL OR weight_max_g >= weight_min_g
    )
) ENGINE=InnoDB;

-- 3. Partner farms and shops for discovery and traceability.
CREATE TABLE IF NOT EXISTS farms (
    farm_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    farm_name VARCHAR(150) NOT NULL,
    partner_type ENUM('farm', 'shop') NOT NULL DEFAULT 'farm',
    address TEXT NOT NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    contact_number VARCHAR(20) NULL,
    opening_hours VARCHAR(150) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (farm_id),
    KEY idx_farms_active (is_active),
    CONSTRAINT chk_farms_latitude CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
    CONSTRAINT chk_farms_longitude CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
) ENGINE=InnoDB;

-- 4. Egg batches for farm-to-door freshness traceability.
CREATE TABLE IF NOT EXISTS egg_batches (
    batch_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    batch_code VARCHAR(50) NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    farm_id INT UNSIGNED NOT NULL,
    laying_date DATE NULL,
    received_date DATE NOT NULL,
    graded_date DATE NULL,
    packed_date DATE NULL,
    expiry_date DATE NULL,
    grade_label ENUM('A', 'B', 'C', 'Ungraded') NOT NULL DEFAULT 'Ungraded',
    quantity_received INT UNSIGNED NOT NULL DEFAULT 0,
    quantity_remaining INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (batch_id),
    UNIQUE KEY uq_egg_batches_code (batch_code),
    KEY idx_batches_product (product_id),
    KEY idx_batches_farm (farm_id),
    KEY idx_batches_received_date (received_date),
    CONSTRAINT fk_batches_product FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_batches_farm FOREIGN KEY (farm_id)
        REFERENCES farms (farm_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_batches_quantity CHECK (quantity_remaining <= quantity_received)
) ENGINE=InnoDB;

-- 5. Recurring subscriptions.
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    frequency ENUM('weekly', 'biweekly', 'monthly') NOT NULL DEFAULT 'weekly',
    delivery_day ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') NOT NULL,
    delivery_window VARCHAR(30) NULL,
    delivery_address TEXT NOT NULL,
    delivery_zone VARCHAR(50) NOT NULL,
    status ENUM('active', 'paused', 'cancelled') NOT NULL DEFAULT 'active',
    start_date DATE NOT NULL,
    next_delivery_date DATE NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (subscription_id),
    KEY idx_subscriptions_user (user_id),
    KEY idx_subscriptions_due (status, next_delivery_date),
    KEY idx_subscriptions_zone_day (delivery_zone, delivery_day),
    CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id)
        REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 6. Products and quantities belonging to each subscription.
CREATE TABLE IF NOT EXISTS subscription_items (
    subscription_item_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    subscription_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    supplier_id INT UNSIGNED NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (subscription_item_id),
    UNIQUE KEY uq_subscription_product (subscription_id, product_id),
    KEY idx_subscription_items_product (product_id),
    KEY idx_subscription_items_supplier (supplier_id),
    CONSTRAINT fk_subscription_items_subscription FOREIGN KEY (subscription_id)
        REFERENCES subscriptions (subscription_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_subscription_items_product FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_subscription_items_supplier FOREIGN KEY (supplier_id)
        REFERENCES farms (farm_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_subscription_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_subscription_items_price CHECK (unit_price >= 0)
) ENGINE=InnoDB;

-- 7. Individual orders/deliveries. Recurring orders are generated by backend logic.
CREATE TABLE IF NOT EXISTS orders (
    order_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    subscription_id INT UNSIGNED NULL,
    order_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivery_date DATE NOT NULL,
    delivery_window VARCHAR(30) NULL,
    delivery_zone VARCHAR(50) NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    payment_status ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    order_status ENUM('pending', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'cancelled', 'skipped')
        NOT NULL DEFAULT 'pending',
    notes TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (order_id),
    KEY idx_orders_user (user_id),
    KEY idx_orders_subscription (subscription_id),
    UNIQUE KEY uq_orders_subscription_delivery (subscription_id, delivery_date),
    KEY idx_orders_delivery_schedule (delivery_date, delivery_zone, order_status),
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
        REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_orders_subscription FOREIGN KEY (subscription_id)
        REFERENCES subscriptions (subscription_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_orders_delivery_fee CHECK (delivery_fee >= 0),
    CONSTRAINT chk_orders_total CHECK (total_amount >= 0)
) ENGINE=InnoDB;

-- 8. Products within each order. Optional batch link supports traceability.
CREATE TABLE IF NOT EXISTS order_items (
    order_item_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    batch_id INT UNSIGNED NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (order_item_id),
    KEY idx_order_items_order (order_id),
    KEY idx_order_items_product (product_id),
    KEY idx_order_items_batch (batch_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
        REFERENCES orders (order_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_order_items_batch FOREIGN KEY (batch_id)
        REFERENCES egg_batches (batch_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_order_items_price CHECK (unit_price >= 0),
    CONSTRAINT chk_order_items_subtotal CHECK (subtotal >= 0)
) ENGINE=InnoDB;

-- Optional starter queries:
-- SELECT * FROM products WHERE is_available = 1;
-- SELECT * FROM egg_batches WHERE batch_code = 'DN-0924-B17';
-- SELECT * FROM subscriptions WHERE status = 'active' AND next_delivery_date <= CURDATE();
-- SELECT * FROM orders WHERE delivery_date = CURDATE() ORDER BY delivery_zone;


-- Optional table used by the prototype's "Request trade account" button.
CREATE TABLE IF NOT EXISTS trade_requests (
    trade_request_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NULL,
    business_name VARCHAR(150) NOT NULL,
    trays_per_delivery INT UNSIGNED NOT NULL,
    deliveries_per_week TINYINT UNSIGNED NOT NULL,
    delivery_window VARCHAR(30) NULL,
    quoted_unit_price DECIMAL(10,2) NULL,
    account_manager VARCHAR(100) NOT NULL DEFAULT 'DOSENAMO Trade Account Team',
    status ENUM('pending', 'approved', 'declined') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (trade_request_id),
    KEY idx_trade_requests_user (user_id),
    CONSTRAINT fk_trade_requests_user FOREIGN KEY (user_id)
        REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_trade_requests_product FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_trade_trays CHECK (trays_per_delivery > 0),
    CONSTRAINT chk_trade_deliveries CHECK (deliveries_per_week > 0 AND deliveries_per_week <= 7)
) ENGINE=InnoDB;

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

-- Demo records for testing the prototype. Change these sample values before deployment.
-- Demo password is intentionally not provided: replace the hash with a PHP password_hash() value
-- if you implement login. The prototype currently uses user_id=1 for demo actions.
INSERT INTO users (user_id, full_name, email, password_hash, phone, account_type, business_name, address, delivery_zone)
VALUES (1, 'DOSENAMO Demo Customer', 'demo@dosenamo.local', 'REPLACE_WITH_PASSWORD_HASH', '09170000000', 'business', 'Santos Bakery', 'Demo address, District A', 'District A')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

INSERT INTO products (product_id, product_name, egg_type, size_name, unit, units_per_tray, price, stock_quantity, is_available)
VALUES
(1, 'Standard Medium Chicken Eggs', 'chicken', 'medium', 'tray', 30, 225.00, 500, 1),
(2, 'Free-range Large Chicken Eggs', 'free_range', 'large', 'tray', 30, 290.00, 300, 1),
(3, 'Duck Eggs', 'duck', 'large', 'tray', 30, 330.00, 200, 1),
(4, 'Salted Duck Eggs', 'salted_duck', 'not_applicable', 'tray', 30, 390.00, 150, 1),
(5, 'Quail Eggs', 'quail', 'not_applicable', 'tray', 60, 150.00, 250, 1),
(6, 'Liquid Egg Whites', 'egg_whites', 'not_applicable', 'bottle', 1, 180.00, 100, 1),
(7, 'Liquid Egg Yolks', 'egg_yolks', 'not_applicable', 'bottle', 1, 210.00, 100, 1)
ON DUPLICATE KEY UPDATE product_name = VALUES(product_name);

INSERT INTO farms (farm_id, farm_name, partner_type, address, latitude, longitude, contact_number, opening_hours, is_active)
VALUES
(1, 'Dela Cruz Farm', 'farm', 'Ilocos Region, Philippines', NULL, NULL, NULL, 'Mon-Sat, 7 AM-4 PM', 1),
(2, 'Ablan Poultry', 'farm', 'Ilocos Region, Philippines', NULL, NULL, NULL, 'Mon-Fri, 8 AM-5 PM', 1),
(3, 'Bantay Duck Farm', 'farm', 'Bantay, Ilocos Sur, Philippines', NULL, NULL, NULL, 'Tue-Sun, 6 AM-2 PM', 1),
(4, 'Tamayo Quail Shop', 'shop', 'Ilocos Region, Philippines', NULL, NULL, NULL, 'Daily, 8 AM-6 PM', 1),
(5, 'Vigan Egg Hub', 'shop', 'Vigan, Ilocos Sur, Philippines', NULL, NULL, NULL, 'Daily, 5 AM-7 PM', 1)
ON DUPLICATE KEY UPDATE farm_name = VALUES(farm_name);

INSERT INTO delivery_zones (delivery_zone, delivery_day, delivery_fee, is_active)
VALUES
('District A', 'tuesday', 20.00, 1),
('District A', 'friday', 20.00, 1),
('District B', 'wednesday', 20.00, 1),
('District B', 'saturday', 20.00, 1)
ON DUPLICATE KEY UPDATE delivery_fee = VALUES(delivery_fee), is_active = VALUES(is_active);

INSERT INTO egg_batches (batch_id, batch_code, product_id, farm_id, laying_date, received_date, graded_date, packed_date, expiry_date, grade_label, quantity_received, quantity_remaining)
VALUES
(1, 'DN-0924-B17', 1, 1, '2026-10-10', '2026-10-11', '2026-10-11', '2026-10-11', NULL, 'A', 240, 180),
(2, 'DN-0926-D03', 3, 3, '2026-10-08', '2026-10-10', '2026-10-10', '2026-10-10', NULL, 'A', 180, 120)
ON DUPLICATE KEY UPDATE batch_code = VALUES(batch_code), grade_label = VALUES(grade_label);
