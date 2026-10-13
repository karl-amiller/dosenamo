<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/config.php';

function respond(array $payload, int $status = 200): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}
function requiredInt(array $data, string $key): int {
    $value = filter_var($data[$key] ?? null, FILTER_VALIDATE_INT);
    if ($value === false || $value < 1) respond(['success' => false, 'message' => "Invalid {$key}."], 422);
    return (int)$value;
}
function cleanString(array $data, string $key, int $max = 255): string {
    $value = trim((string)($data[$key] ?? ''));
    if ($value === '' || mb_strlen($value) > $max) respond(['success' => false, 'message' => "Invalid {$key}."], 422);
    return $value;
}

try {
    $pdo = db();
    $action = (string)($_GET['action'] ?? '');

    if ($action === 'health') {
        $pdo->query('SELECT 1');
        respond(['success' => true, 'database' => DB_NAME]);
    }

    if ($action === 'products') {
        $stmt = $pdo->query("SELECT product_id, product_name, egg_type, size_name, weight_min_g, weight_max_g, unit, units_per_tray, price, stock_quantity, is_available FROM products WHERE is_available = 1 ORDER BY product_id");
        respond(['success' => true, 'products' => $stmt->fetchAll()]);
    }

    if ($action === 'farms') {
        $stmt = $pdo->query("SELECT farm_id, farm_name, partner_type, address, latitude, longitude, contact_number, opening_hours FROM farms WHERE is_active = 1 ORDER BY farm_id");
        $farms = $stmt->fetchAll();
        // These fields are display-only placeholders until distance/rating data is implemented.
        foreach ($farms as $i => &$farm) {
            $farm['map_x'] = [30, 62, 80, 20, 55][$i % 5];
            $farm['map_y'] = [30, 22, 55, 70, 78][$i % 5];
            $farm['distance_km'] = null;
            $farm['rating'] = null;
            $farm['review_count'] = null;
            $farm['products_summary'] = 'Partner products';
        }
        unset($farm);
        respond(['success' => true, 'farms' => $farms]);
    }

    if ($action === 'batch') {
        $code = strtoupper(trim((string)($_GET['code'] ?? '')));
        if ($code === '' || strlen($code) > 50) respond(['success' => false, 'message' => 'Enter a valid batch code.'], 422);
        $stmt = $pdo->prepare("SELECT b.batch_id, b.batch_code, b.laying_date, b.received_date, b.graded_date, b.packed_date, b.expiry_date, b.quantity_received, b.quantity_remaining, p.product_name, f.farm_id, f.farm_name, f.address FROM egg_batches b JOIN products p ON p.product_id = b.product_id JOIN farms f ON f.farm_id = b.farm_id WHERE b.batch_code = ?");
        $stmt->execute([$code]);
        $batch = $stmt->fetch();
        if (!$batch) respond(['success' => false, 'message' => 'No batch was found for that code. Check the code printed on the tray.'], 404);
        respond(['success' => true, 'batch' => $batch]);
    }

    if ($action === 'my_subscription') {
        $userId = filter_var($_GET['user_id'] ?? null, FILTER_VALIDATE_INT);
        if ($userId === false || $userId === null || $userId < 1) {
            respond(['success' => false, 'message' => 'Invalid user ID.'], 422);
        }

        $stmt = $pdo->prepare(
            "SELECT s.subscription_id, s.user_id, s.status, s.frequency, s.delivery_day,
                    s.delivery_window, s.next_delivery_date, s.delivery_address, s.delivery_zone
             FROM subscriptions s
             WHERE s.user_id = ?
               AND s.status = 'active'
             ORDER BY s.next_delivery_date ASC, s.subscription_id ASC
             LIMIT 1"
        );
        $stmt->execute([(int)$userId]);
        $subscription = $stmt->fetch();

        respond(['success' => true, 'subscription' => $subscription ?: null]);
    }

    // Upcoming active subscriptions for the Home screen.
    if ($action === 'upcoming_subscriptions') {
        $userId = filter_var($_GET['user_id'] ?? null, FILTER_VALIDATE_INT);
        if ($userId === false || $userId === null || $userId < 1) {
            respond(['success' => false, 'message' => 'Invalid user ID.'], 422);
        }

        $sql = "
            SELECT
                s.subscription_id, s.user_id, s.status, s.frequency,
                s.delivery_day, s.delivery_window, s.next_delivery_date,
                si.product_id, si.quantity, p.product_name, p.egg_type,
                p.size_name, p.price,
                (
                    SELECT f.farm_name
                    FROM egg_batches b
                    JOIN farms f ON f.farm_id = b.farm_id
                    WHERE b.product_id = p.product_id
                    ORDER BY b.received_date DESC, b.batch_id DESC
                    LIMIT 1
                ) AS farm_name
            FROM subscriptions s
            JOIN subscription_items si ON si.subscription_id = s.subscription_id
            JOIN products p ON p.product_id = si.product_id
            WHERE s.user_id = ?
              AND s.status = 'active'
              AND s.next_delivery_date >= CURDATE()
            ORDER BY s.next_delivery_date ASC, s.subscription_id ASC
        ";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([(int)$userId]);
        respond(['success' => true, 'subscriptions' => $stmt->fetchAll()]);
    }

    if ($action === 'create_subscription' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $userId = requiredInt($data, 'user_id');
        $productId = requiredInt($data, 'product_id');
        $quantity = requiredInt($data, 'quantity');
        $frequency = (string)($data['frequency'] ?? 'weekly');
        $day = strtolower((string)($data['delivery_day'] ?? 'tuesday'));
        $allowedFrequency = ['weekly', 'biweekly', 'monthly'];
        $allowedDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
        if (!in_array($frequency, $allowedFrequency, true)) respond(['success' => false, 'message' => 'Invalid delivery frequency.'], 422);
        if (!in_array($day, $allowedDays, true)) respond(['success' => false, 'message' => 'Invalid delivery day.'], 422);
        $address = cleanString($data, 'delivery_address', 1000);
        $zone = cleanString($data, 'delivery_zone', 50);
        $window = trim((string)($data['delivery_window'] ?? ''));
        $productStmt = $pdo->prepare('SELECT price, is_available, stock_quantity FROM products WHERE product_id = ?');
        $productStmt->execute([$productId]);
        $product = $productStmt->fetch();
        if (!$product || !(int)$product['is_available']) respond(['success' => false, 'message' => 'That product is unavailable.'], 422);
        if ((int)$product['stock_quantity'] < $quantity) respond(['success' => false, 'message' => 'There is not enough stock for that quantity.'], 422);
        $nextDate = new DateTimeImmutable('today');
        while (strtolower($nextDate->format('l')) !== $day) $nextDate = $nextDate->modify('+1 day');
        if ($nextDate->format('Y-m-d') <= date('Y-m-d')) {
            $nextDate = $nextDate->modify('+7 days');
        }
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("INSERT INTO subscriptions (user_id, frequency, delivery_day, delivery_window, delivery_address, delivery_zone, status, start_date, next_delivery_date) VALUES (?, ?, ?, ?, ?, ?, 'active', CURDATE(), ?)");
        $stmt->execute([$userId, $frequency, $day, $window, $address, $zone, $nextDate->format('Y-m-d')]);
        $subscriptionId = (int)$pdo->lastInsertId();
        $item = $pdo->prepare('INSERT INTO subscription_items (subscription_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)');
        $item->execute([$subscriptionId, $productId, $quantity, $product['price']]);
        $pdo->commit();
        respond(['success' => true, 'subscription_id' => $subscriptionId, 'message' => 'Subscription created.']);
    }

    if ($action === 'subscription_status' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $subscriptionId = requiredInt($data, 'subscription_id');
        $status = (string)($data['status'] ?? '');
        if (!in_array($status, ['active', 'paused', 'cancelled'], true)) respond(['success' => false, 'message' => 'Invalid subscription status.'], 422);
        $stmt = $pdo->prepare('UPDATE subscriptions SET status = ? WHERE subscription_id = ?');
        $stmt->execute([$status, $subscriptionId]);
        if (!$stmt->rowCount()) {
            $check = $pdo->prepare('SELECT subscription_id FROM subscriptions WHERE subscription_id = ?');
            $check->execute([$subscriptionId]);
            if (!$check->fetch()) respond(['success' => false, 'message' => 'Subscription not found.'], 404);
        }
        respond(['success' => true, 'message' => 'Subscription status updated.']);
    }

    if ($action === 'skip_delivery' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $subscriptionId = requiredInt($data, 'subscription_id');
        $stmt = $pdo->prepare("SELECT subscription_id, frequency, next_delivery_date, status FROM subscriptions WHERE subscription_id = ?");
        $stmt->execute([$subscriptionId]);
        $subscription = $stmt->fetch();
        if (!$subscription) respond(['success' => false, 'message' => 'Subscription not found.'], 404);
        if ($subscription['status'] !== 'active') respond(['success' => false, 'message' => 'Only active subscriptions can skip a delivery.'], 422);
        $pdo->beginTransaction();
        $date = $subscription['next_delivery_date'] ?: date('Y-m-d');
        $orderStmt = $pdo->prepare("UPDATE orders SET order_status = 'skipped' WHERE subscription_id = ? AND delivery_date = ? AND order_status IN ('pending','confirmed')");
        $orderStmt->execute([$subscriptionId, $date]);
        $interval = match ($subscription['frequency']) {
            'biweekly' => '+14 days',
            'monthly' => '+1 month',
            default => '+7 days',
        };
        $next = (new DateTimeImmutable($date))->modify($interval)->format('Y-m-d');
        $update = $pdo->prepare('UPDATE subscriptions SET next_delivery_date = ? WHERE subscription_id = ?');
        $update->execute([$next, $subscriptionId]);
        $pdo->commit();
        respond(['success' => true, 'message' => 'Next delivery skipped; next date updated.']);
    }

    if ($action === 'trade_request' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $userId = requiredInt($data, 'user_id');
        $businessName = cleanString($data, 'business_name', 150);
        $trays = requiredInt($data, 'trays_per_delivery');
        $deliveries = requiredInt($data, 'deliveries_per_week');
        $window = trim((string)($data['delivery_window'] ?? ''));
        $stmt = $pdo->prepare('INSERT INTO trade_requests (user_id, business_name, trays_per_delivery, deliveries_per_week, delivery_window) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$userId, $businessName, $trays, $deliveries, $window]);
        respond(['success' => true, 'request_id' => (int)$pdo->lastInsertId(), 'message' => 'Trade request saved.']);
    }

    respond(['success' => false, 'message' => 'Unknown action.'], 404);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    error_log('DOSENAMO API error: ' . $e->getMessage());
    respond(['success' => false, 'message' => 'Server/database error. Check api/config.php, import the SQL file, and review the PHP error log.'], 500);
}
