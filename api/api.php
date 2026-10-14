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
function nextDeliveryDate(string $day, ?string $after = null): string {
    $date = new DateTimeImmutable($after ?: 'today');
    while (strtolower($date->format('l')) !== $day || $date->format('Y-m-d') <= date('Y-m-d')) {
        $date = $date->modify('+1 day');
    }
    return $date->format('Y-m-d');
}
function routeFee(PDO $pdo, string $zone, string $day): float {
    $stmt = $pdo->prepare('SELECT delivery_fee FROM delivery_zones WHERE delivery_zone = ? AND delivery_day = ? AND is_active = 1');
    $stmt->execute([$zone, $day]);
    $fee = $stmt->fetchColumn();
    if ($fee === false) respond(['success' => false, 'message' => 'That district does not deliver on the selected day.'], 422);
    return (float)$fee;
}
function releaseScheduledOrders(PDO $pdo, int $subscriptionId, string $newStatus, ?string $deliveryDate = null): void {
    $dateFilter = $deliveryDate === null ? '' : ' AND o.delivery_date = ?';
    $dateParams = $deliveryDate === null ? [$subscriptionId] : [$subscriptionId, $deliveryDate];
    $items = $pdo->prepare(
        "SELECT oi.product_id, SUM(oi.quantity) AS quantity
         FROM order_items oi JOIN orders o ON o.order_id = oi.order_id
         WHERE o.subscription_id = ? AND o.delivery_date >= CURDATE()
           AND o.order_status IN ('pending', 'confirmed')$dateFilter
         GROUP BY oi.product_id"
    );
    $items->execute($dateParams);
    $restore = $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?');
    foreach ($items->fetchAll() as $item) {
        $restore->execute([(int)$item['quantity'], (int)$item['product_id']]);
    }
    $orders = $pdo->prepare(
        "UPDATE orders SET order_status = ?
         WHERE subscription_id = ? AND delivery_date >= CURDATE()
           AND order_status IN ('pending', 'confirmed')" . ($deliveryDate === null ? '' : ' AND delivery_date = ?')
    );
    $orders->execute($deliveryDate === null
        ? [$newStatus, $subscriptionId]
        : [$newStatus, $subscriptionId, $deliveryDate]);
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

    if ($action === 'zones') {
        $stmt = $pdo->query("SELECT delivery_zone, delivery_day, delivery_fee FROM delivery_zones WHERE is_active = 1 ORDER BY delivery_zone, FIELD(delivery_day, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday')");
        respond(['success' => true, 'zones' => $stmt->fetchAll()]);
    }

    if ($action === 'route_batches') {
        $stmt = $pdo->query(
            "SELECT z.delivery_zone, z.delivery_day, z.delivery_fee,
                    COUNT(DISTINCT CASE WHEN s.status = 'active' THEN s.subscription_id END) AS active_subscriptions
             FROM delivery_zones z
             LEFT JOIN subscriptions s ON s.delivery_zone = z.delivery_zone
                AND s.delivery_day = z.delivery_day AND s.next_delivery_date >= CURDATE()
             WHERE z.is_active = 1
             GROUP BY z.delivery_zone, z.delivery_day, z.delivery_fee
             ORDER BY z.delivery_zone, FIELD(z.delivery_day, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday')"
        );
        respond(['success' => true, 'routes' => $stmt->fetchAll()]);
    }

    if ($action === 'farms') {
        $stmt = $pdo->query(
            "SELECT f.farm_id, f.farm_name, f.partner_type, f.address, f.latitude,
                    f.longitude, f.contact_number, f.opening_hours,
                    products.products_summary,
                    COALESCE(r.rating, 0) AS rating, COALESCE(r.review_count, 0) AS review_count
             FROM farms f
             LEFT JOIN (
                 SELECT b.farm_id, GROUP_CONCAT(DISTINCT p.product_name ORDER BY p.product_name SEPARATOR ', ') AS products_summary
                 FROM egg_batches b JOIN products p ON p.product_id = b.product_id
                 GROUP BY b.farm_id
             ) products ON products.farm_id = f.farm_id
             LEFT JOIN (SELECT farm_id, ROUND(AVG(rating), 1) AS rating, COUNT(*) AS review_count
                        FROM farm_reviews GROUP BY farm_id) r ON r.farm_id = f.farm_id
             WHERE f.is_active = 1 ORDER BY f.farm_id"
        );
        $farms = $stmt->fetchAll();
        foreach ($farms as $i => &$farm) {
            $farm['map_x'] = [30, 62, 80, 20, 55][$i % 5];
            $farm['map_y'] = [30, 22, 55, 70, 78][$i % 5];
        }
        unset($farm);
        respond(['success' => true, 'farms' => $farms]);
    }

    if ($action === 'batch') {
        $code = strtoupper(trim((string)($_GET['code'] ?? '')));
        if ($code === '' || strlen($code) > 50) respond(['success' => false, 'message' => 'Enter a valid batch code.'], 422);
        $stmt = $pdo->prepare("SELECT b.batch_id, b.batch_code, b.laying_date, b.received_date, b.graded_date, b.packed_date, b.expiry_date, b.grade_label, b.quantity_received, b.quantity_remaining, p.product_name, f.farm_id, f.farm_name, f.address FROM egg_batches b JOIN products p ON p.product_id = b.product_id JOIN farms f ON f.farm_id = b.farm_id WHERE b.batch_code = ?");
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
                s.delivery_day, s.delivery_window, s.next_delivery_date, s.delivery_zone, s.delivery_address,
                si.product_id, si.quantity, p.product_name, p.egg_type,
                p.size_name, p.unit, p.units_per_tray, p.price, si.supplier_id,
                selected_farm.farm_name AS preferred_supplier_name
            FROM subscriptions s
            JOIN subscription_items si ON si.subscription_id = s.subscription_id
            JOIN products p ON p.product_id = si.product_id
            LEFT JOIN farms selected_farm ON selected_farm.farm_id = si.supplier_id
            WHERE s.user_id = ?
              AND s.status IN ('active', 'paused')
              AND s.next_delivery_date IS NOT NULL
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
        if (mb_strlen($window) > 30) respond(['success' => false, 'message' => 'Delivery window is too long.'], 422);
        $supplierId = isset($data['supplier_id']) && $data['supplier_id'] !== ''
            ? filter_var($data['supplier_id'], FILTER_VALIDATE_INT)
            : null;
        if ($supplierId === false || ($supplierId !== null && $supplierId < 1)) respond(['success' => false, 'message' => 'Invalid supplier.'], 422);
        routeFee($pdo, $zone, $day);
        $productStmt = $pdo->prepare('SELECT price, is_available, stock_quantity FROM products WHERE product_id = ?');
        $productStmt->execute([$productId]);
        $product = $productStmt->fetch();
        if (!$product || !(int)$product['is_available']) respond(['success' => false, 'message' => 'That product is unavailable.'], 422);
        if ((int)$product['stock_quantity'] < $quantity) respond(['success' => false, 'message' => 'There is not enough stock for that quantity.'], 422);
        if ($supplierId !== null) {
            $farmStmt = $pdo->prepare('SELECT farm_id FROM farms WHERE farm_id = ? AND is_active = 1');
            $farmStmt->execute([$supplierId]);
            if (!$farmStmt->fetchColumn()) respond(['success' => false, 'message' => 'That supplier is unavailable.'], 422);
        }
        $nextDate = nextDeliveryDate($day);
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("INSERT INTO subscriptions (user_id, frequency, delivery_day, delivery_window, delivery_address, delivery_zone, status, start_date, next_delivery_date) VALUES (?, ?, ?, ?, ?, ?, 'active', CURDATE(), ?)");
        $stmt->execute([$userId, $frequency, $day, $window, $address, $zone, $nextDate]);
        $subscriptionId = (int)$pdo->lastInsertId();
        $item = $pdo->prepare('INSERT INTO subscription_items (subscription_id, product_id, supplier_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)');
        $item->execute([$subscriptionId, $productId, $supplierId, $quantity, $product['price']]);
        $pdo->commit();
        respond(['success' => true, 'subscription_id' => $subscriptionId, 'message' => 'Subscription created.']);
    }

    if ($action === 'update_subscription' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $userId = requiredInt($data, 'user_id');
        $subscriptionId = requiredInt($data, 'subscription_id');
        $productId = requiredInt($data, 'product_id');
        $quantity = requiredInt($data, 'quantity');
        $frequency = (string)($data['frequency'] ?? '');
        $day = strtolower((string)($data['delivery_day'] ?? ''));
        $zone = cleanString($data, 'delivery_zone', 50);
        $address = cleanString($data, 'delivery_address', 1000);
        $window = trim((string)($data['delivery_window'] ?? ''));
        $supplierId = isset($data['supplier_id']) && $data['supplier_id'] !== ''
            ? filter_var($data['supplier_id'], FILTER_VALIDATE_INT)
            : null;
        if (!in_array($frequency, ['weekly', 'biweekly', 'monthly'], true)) respond(['success' => false, 'message' => 'Invalid delivery frequency.'], 422);
        if (!in_array($day, ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], true)) respond(['success' => false, 'message' => 'Invalid delivery day.'], 422);
        if (mb_strlen($window) > 30 || $supplierId === false || ($supplierId !== null && $supplierId < 1)) respond(['success' => false, 'message' => 'Invalid delivery details.'], 422);
        routeFee($pdo, $zone, $day);

        $productStmt = $pdo->prepare('SELECT price, is_available FROM products WHERE product_id = ?');
        $productStmt->execute([$productId]);
        $product = $productStmt->fetch();
        if (!$product || !(int)$product['is_available']) respond(['success' => false, 'message' => 'That product is unavailable.'], 422);
        if ($supplierId !== null) {
            $farmStmt = $pdo->prepare('SELECT farm_id FROM farms WHERE farm_id = ? AND is_active = 1');
            $farmStmt->execute([$supplierId]);
            if (!$farmStmt->fetchColumn()) respond(['success' => false, 'message' => 'That supplier is unavailable.'], 422);
        }
        $check = $pdo->prepare("SELECT next_delivery_date FROM subscriptions WHERE subscription_id = ? AND user_id = ? AND status IN ('active','paused')");
        $check->execute([$subscriptionId, $userId]);
        $current = $check->fetch();
        if (!$current) respond(['success' => false, 'message' => 'Subscription not found.'], 404);
        $nextDate = nextDeliveryDate($day, $current['next_delivery_date']);

        $pdo->beginTransaction();
        releaseScheduledOrders($pdo, $subscriptionId, 'cancelled');
        $update = $pdo->prepare('UPDATE subscriptions SET frequency = ?, delivery_day = ?, delivery_window = ?, delivery_address = ?, delivery_zone = ?, next_delivery_date = ? WHERE subscription_id = ? AND user_id = ?');
        $update->execute([$frequency, $day, $window, $address, $zone, $nextDate, $subscriptionId, $userId]);
        $item = $pdo->prepare('UPDATE subscription_items SET product_id = ?, supplier_id = ?, quantity = ?, unit_price = ? WHERE subscription_id = ?');
        $item->execute([$productId, $supplierId, $quantity, $product['price'], $subscriptionId]);
        $pdo->commit();
        respond(['success' => true, 'message' => 'Subscription updated.']);
    }

    if ($action === 'subscription_status' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $userId = requiredInt($data, 'user_id');
        $subscriptionId = requiredInt($data, 'subscription_id');
        $status = (string)($data['status'] ?? '');
        if (!in_array($status, ['active', 'paused', 'cancelled'], true)) respond(['success' => false, 'message' => 'Invalid subscription status.'], 422);
        $check = $pdo->prepare('SELECT delivery_day, next_delivery_date FROM subscriptions WHERE subscription_id = ? AND user_id = ?');
        $check->execute([$subscriptionId, $userId]);
        $subscription = $check->fetch();
        if (!$subscription) respond(['success' => false, 'message' => 'Subscription not found.'], 404);
        $nextDate = $status === 'active' &&
            (!$subscription['next_delivery_date'] || $subscription['next_delivery_date'] < date('Y-m-d'))
            ? nextDeliveryDate($subscription['delivery_day'])
            : $subscription['next_delivery_date'];
        $pdo->beginTransaction();
        if ($status === 'paused' || $status === 'cancelled') {
            releaseScheduledOrders($pdo, $subscriptionId, 'cancelled');
        }
        $stmt = $pdo->prepare('UPDATE subscriptions SET status = ?, next_delivery_date = ? WHERE subscription_id = ? AND user_id = ?');
        $stmt->execute([$status, $nextDate, $subscriptionId, $userId]);
        $notification = $pdo->prepare("INSERT IGNORE INTO notifications (user_id, notification_type, dedupe_key, message) VALUES (?, 'account_update', ?, ?)");
        $notification->execute([$userId, "subscription:$subscriptionId:$status:" . date('YmdHis'), "Subscription #$subscriptionId was " . ($status === 'active' ? 'resumed' : $status) . '.']);
        $pdo->commit();
        respond(['success' => true, 'message' => 'Subscription status updated.']);
    }

    if ($action === 'skip_delivery' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $userId = requiredInt($data, 'user_id');
        $subscriptionId = requiredInt($data, 'subscription_id');
        $stmt = $pdo->prepare("SELECT subscription_id, frequency, delivery_day, next_delivery_date, status FROM subscriptions WHERE subscription_id = ? AND user_id = ?");
        $stmt->execute([$subscriptionId, $userId]);
        $subscription = $stmt->fetch();
        if (!$subscription) respond(['success' => false, 'message' => 'Subscription not found.'], 404);
        if ($subscription['status'] !== 'active') respond(['success' => false, 'message' => 'Only active subscriptions can skip a delivery.'], 422);
        $pdo->beginTransaction();
        $date = $subscription['next_delivery_date'] ?: date('Y-m-d');
        releaseScheduledOrders($pdo, $subscriptionId, 'skipped', $date);
        $interval = match ($subscription['frequency']) {
            'biweekly' => '+14 days',
            'monthly' => '+1 month',
            default => '+7 days',
        };
        $candidate = (new DateTimeImmutable($date))->modify($interval);
        while (strtolower($candidate->format('l')) !== $subscription['delivery_day']) $candidate = $candidate->modify('+1 day');
        while ($candidate->format('Y-m-d') <= date('Y-m-d')) $candidate = $candidate->modify('+7 days');
        $next = $candidate->format('Y-m-d');
        $update = $pdo->prepare('UPDATE subscriptions SET next_delivery_date = ? WHERE subscription_id = ? AND user_id = ?');
        $update->execute([$next, $subscriptionId, $userId]);
        $notification = $pdo->prepare("INSERT IGNORE INTO notifications (user_id, notification_type, dedupe_key, message) VALUES (?, 'account_update', ?, ?)");
        $notification->execute([$userId, "skip:$subscriptionId:$date", "Your delivery for $date was skipped."]);
        $pdo->commit();
        respond(['success' => true, 'message' => 'Next delivery skipped; next date updated.']);
    }

    if ($action === 'delivery_orders') {
        $userId = filter_var($_GET['user_id'] ?? null, FILTER_VALIDATE_INT);
        if ($userId === false || $userId === null || $userId < 1) respond(['success' => false, 'message' => 'Invalid user ID.'], 422);
        $stmt = $pdo->prepare(
            "SELECT o.order_id, o.delivery_date, o.delivery_window, o.order_status,
                    oi.quantity, p.product_name, b.batch_code, b.laying_date,
                    b.received_date, b.graded_date, b.packed_date, b.expiry_date,
                    b.grade_label, f.farm_name
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.order_id
             JOIN products p ON p.product_id = oi.product_id
             LEFT JOIN egg_batches b ON b.batch_id = oi.batch_id
             LEFT JOIN farms f ON f.farm_id = b.farm_id
             WHERE o.user_id = ?
             ORDER BY
                CASE WHEN o.order_status IN ('pending', 'confirmed', 'packed', 'out_for_delivery') THEN 0 ELSE 1 END,
                CASE WHEN o.order_status IN ('pending', 'confirmed', 'packed', 'out_for_delivery') THEN o.delivery_date END ASC,
                CASE WHEN o.order_status NOT IN ('pending', 'confirmed', 'packed', 'out_for_delivery') THEN o.delivery_date END DESC,
                o.order_id DESC
             LIMIT 20"
        );
        $stmt->execute([(int)$userId]);
        respond(['success' => true, 'deliveries' => $stmt->fetchAll()]);
    }

    if ($action === 'notifications') {
        $userId = filter_var($_GET['user_id'] ?? null, FILTER_VALIDATE_INT);
        if ($userId === false || $userId === null || $userId < 1) respond(['success' => false, 'message' => 'Invalid user ID.'], 422);
        $reminders = $pdo->prepare(
            "INSERT IGNORE INTO notifications (user_id, notification_type, dedupe_key, message)
             SELECT s.user_id, 'reminder',
                    CONCAT('reminder:', s.subscription_id, ':', s.next_delivery_date),
                    CONCAT('Delivery reminder: your ', s.delivery_zone,
                           ' route is scheduled for ', DATE_FORMAT(s.next_delivery_date, '%b %e'), '.')
             FROM subscriptions s
             WHERE s.user_id = ? AND s.status = 'active'
               AND DATEDIFF(s.next_delivery_date, CURDATE()) BETWEEN 0 AND 2"
        );
        $reminders->execute([(int)$userId]);
        $stmt = $pdo->prepare('SELECT notification_id, notification_type, message, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, notification_id DESC LIMIT 20');
        $stmt->execute([(int)$userId]);
        respond(['success' => true, 'notifications' => $stmt->fetchAll()]);
    }

    if ($action === 'farm_reviews') {
        $farmId = filter_var($_GET['farm_id'] ?? null, FILTER_VALIDATE_INT);
        if ($farmId === false || $farmId === null || $farmId < 1) respond(['success' => false, 'message' => 'Invalid farm ID.'], 422);
        $stmt = $pdo->prepare('SELECT rating, review_text, created_at FROM farm_reviews WHERE farm_id = ? ORDER BY created_at DESC LIMIT 10');
        $stmt->execute([(int)$farmId]);
        respond(['success' => true, 'reviews' => $stmt->fetchAll()]);
    }

    if ($action === 'submit_review' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $userId = requiredInt($data, 'user_id');
        $batchCode = strtoupper(cleanString($data, 'batch_code', 50));
        $rating = filter_var($data['rating'] ?? null, FILTER_VALIDATE_INT);
        if ($rating === false || $rating < 1 || $rating > 5) respond(['success' => false, 'message' => 'Choose a rating from 1 to 5.'], 422);
        $reviewText = trim((string)($data['review_text'] ?? ''));
        if (mb_strlen($reviewText) > 1000) respond(['success' => false, 'message' => 'Review is too long.'], 422);
        $batchStmt = $pdo->prepare('SELECT farm_id FROM egg_batches WHERE batch_code = ?');
        $batchStmt->execute([$batchCode]);
        $farmId = $batchStmt->fetchColumn();
        if ($farmId === false) respond(['success' => false, 'message' => 'Batch not found.'], 404);
        $stmt = $pdo->prepare(
            'INSERT INTO farm_reviews (user_id, farm_id, batch_code, rating, review_text)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE farm_id = VALUES(farm_id), rating = VALUES(rating), review_text = VALUES(review_text)'
        );
        $stmt->execute([$userId, (int)$farmId, $batchCode, $rating, $reviewText ?: null]);
        respond(['success' => true, 'message' => 'Your review has been saved.']);
    }

    if ($action === 'breakage_claim' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $userId = requiredInt($data, 'user_id');
        $damagedCount = requiredInt($data, 'damaged_count');
        if ($damagedCount > 60) respond(['success' => false, 'message' => 'Damaged egg count cannot exceed 60.'], 422);
        $resolution = (string)($data['requested_resolution'] ?? '');
        if (!in_array($resolution, ['credit', 'replacement'], true)) respond(['success' => false, 'message' => 'Choose a credit or replacement.'], 422);
        $batchCode = strtoupper(trim((string)($data['batch_code'] ?? '')));
        if ($batchCode !== '') {
            $checkBatch = $pdo->prepare('SELECT batch_id FROM egg_batches WHERE batch_code = ?');
            $checkBatch->execute([$batchCode]);
            if (!$checkBatch->fetchColumn()) respond(['success' => false, 'message' => 'Batch not found.'], 404);
        }
        $notes = trim((string)($data['notes'] ?? ''));
        if (mb_strlen($notes) > 1000) respond(['success' => false, 'message' => 'Claim notes are too long.'], 422);
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('INSERT INTO breakage_claims (user_id, batch_code, damaged_count, requested_resolution, notes) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$userId, $batchCode ?: null, $damagedCount, $resolution, $notes ?: null]);
        $claimId = (int)$pdo->lastInsertId();
        $notification = $pdo->prepare("INSERT INTO notifications (user_id, notification_type, dedupe_key, message) VALUES (?, 'claim_update', ?, ?)");
        $notification->execute([$userId, "claim:$claimId", "Breakage claim #$claimId is awaiting review."]);
        $pdo->commit();
        respond(['success' => true, 'claim_id' => $claimId, 'message' => 'Claim received. Our team will review your request.']);
    }

    if ($action === 'trade_request' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = body();
        $userId = requiredInt($data, 'user_id');
        $productId = requiredInt($data, 'product_id');
        $businessName = cleanString($data, 'business_name', 150);
        $trays = requiredInt($data, 'trays_per_delivery');
        $deliveries = requiredInt($data, 'deliveries_per_week');
        if ($deliveries > 7) respond(['success' => false, 'message' => 'Deliveries per week cannot exceed 7.'], 422);
        $window = trim((string)($data['delivery_window'] ?? ''));
        if (mb_strlen($window) > 30) respond(['success' => false, 'message' => 'Delivery window is too long.'], 422);
        $productStmt = $pdo->prepare('SELECT price, is_available FROM products WHERE product_id = ?');
        $productStmt->execute([$productId]);
        $product = $productStmt->fetch();
        if (!$product || !(int)$product['is_available']) respond(['success' => false, 'message' => 'That product is unavailable.'], 422);
        $discount = $trays >= 30 ? 0.12 : ($trays >= 16 ? 0.08 : ($trays >= 6 ? 0.05 : 0));
        $quotedUnitPrice = round((float)$product['price'] * (1 - $discount), 2);
        $manager = 'DOSENAMO Trade Account Team';
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('INSERT INTO trade_requests (user_id, product_id, business_name, trays_per_delivery, deliveries_per_week, delivery_window, quoted_unit_price, account_manager) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$userId, $productId, $businessName, $trays, $deliveries, $window, $quotedUnitPrice, $manager]);
        $requestId = (int)$pdo->lastInsertId();
        $notification = $pdo->prepare("INSERT INTO notifications (user_id, notification_type, dedupe_key, message) VALUES (?, 'account_update', ?, ?)");
        $notification->execute([$userId, "trade-request:$requestId", "Trade account request #$requestId was sent to $manager."]);
        $pdo->commit();
        respond(['success' => true, 'request_id' => $requestId, 'account_manager' => $manager, 'message' => 'Trade request saved.']);
    }

    respond(['success' => false, 'message' => 'Unknown action.'], 404);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    error_log('DOSENAMO API error: ' . $e->getMessage());
    respond(['success' => false, 'message' => 'Server/database error. Check api/config.php, import the SQL file, and review the PHP error log.'], 500);
}
