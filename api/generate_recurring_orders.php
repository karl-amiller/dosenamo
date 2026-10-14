<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

function nextDateAfter(string $date, string $frequency, string $deliveryDay): string {
    $next = new DateTimeImmutable($date);
    $next = $next->modify(match ($frequency) {
        'biweekly' => '+14 days',
        'monthly' => '+1 month',
        default => '+7 days',
    });
    while (strtolower($next->format('l')) !== $deliveryDay) {
        $next = $next->modify('+1 day');
    }
    return $next->format('Y-m-d');
}

$pdo = null;
$created = 0;
$skipped = 0;

try {
    $pdo = db();
    $pdo->beginTransaction();
    $reminders = $pdo->prepare(
        "INSERT IGNORE INTO notifications (user_id, notification_type, dedupe_key, message)
         SELECT s.user_id, 'reminder',
                CONCAT('reminder:', s.subscription_id, ':', s.next_delivery_date),
                CONCAT('Delivery reminder: your ', s.delivery_zone,
                       ' route is scheduled for ', DATE_FORMAT(s.next_delivery_date, '%b %e'), '.')
         FROM subscriptions s
         WHERE s.status = 'active'
           AND DATEDIFF(s.next_delivery_date, CURDATE()) BETWEEN 0 AND 2"
    );
    $reminders->execute();
    $dueStmt = $pdo->query(
        "SELECT subscription_id, user_id, frequency, delivery_day,
                delivery_window, delivery_address, delivery_zone, next_delivery_date
         FROM subscriptions
         WHERE status = 'active' AND next_delivery_date <= CURDATE()
         ORDER BY delivery_zone, delivery_day, next_delivery_date, subscription_id
         FOR UPDATE"
    );
    $subscriptions = $dueStmt->fetchAll();

    foreach ($subscriptions as $subscription) {
        $itemStmt = $pdo->prepare(
            'SELECT si.product_id, si.supplier_id, si.quantity, si.unit_price,
                    p.stock_quantity, p.is_available
             FROM subscription_items si
             JOIN products p ON p.product_id = si.product_id
             WHERE si.subscription_id = ?'
        );
        $itemStmt->execute([(int)$subscription['subscription_id']]);
        $item = $itemStmt->fetch();
        if (!$item) throw new RuntimeException('A due subscription has no product item.');

        $deliveryDate = $subscription['next_delivery_date'];
        $existingOrder = $pdo->prepare(
            'SELECT order_id FROM orders WHERE subscription_id = ? AND delivery_date = ?'
        );
        $existingOrder->execute([(int)$subscription['subscription_id'], $deliveryDate]);

        if (!$existingOrder->fetchColumn()) {
            if (!(int)$item['is_available'] || (int)$item['stock_quantity'] < (int)$item['quantity']) {
                $notification = $pdo->prepare(
                    "INSERT IGNORE INTO notifications (user_id, notification_type, dedupe_key, message)
                     VALUES (?, 'account_update', ?, ?)"
                );
                $notification->execute([
                    (int)$subscription['user_id'],
                    'stock:' . $subscription['subscription_id'] . ':' . $deliveryDate,
                    'A scheduled delivery needs attention because the selected product is unavailable or out of stock.'
                ]);
                $skipped++;
                continue;
            }

            $feeStmt = $pdo->prepare(
                'SELECT delivery_fee FROM delivery_zones
                 WHERE delivery_zone = ? AND delivery_day = ? AND is_active = 1'
            );
            $feeStmt->execute([$subscription['delivery_zone'], $subscription['delivery_day']]);
            $deliveryFee = $feeStmt->fetchColumn();
            if ($deliveryFee === false) throw new RuntimeException('A due subscription has no active district route.');

            $batchStmt = $pdo->prepare(
                'SELECT batch_id FROM egg_batches
                 WHERE product_id = ? AND quantity_remaining > 0
                   AND (? IS NULL OR farm_id = ?)
                 ORDER BY received_date DESC, batch_id DESC LIMIT 1'
            );
            $batchStmt->execute([
                (int)$item['product_id'],
                $item['supplier_id'],
                $item['supplier_id']
            ]);
            $batchId = $batchStmt->fetchColumn();
            if ($batchId === false) {
                $notification = $pdo->prepare(
                    "INSERT IGNORE INTO notifications (user_id, notification_type, dedupe_key, message)
                     VALUES (?, 'account_update', ?, ?)"
                );
                $notification->execute([
                    (int)$subscription['user_id'],
                    'batch:' . $subscription['subscription_id'] . ':' . $deliveryDate,
                    'A scheduled delivery is waiting for a traceable batch from the selected supplier.'
                ]);
                $skipped++;
                continue;
            }

            $stockStmt = $pdo->prepare(
                'UPDATE products SET stock_quantity = stock_quantity - ?
                 WHERE product_id = ? AND stock_quantity >= ? AND is_available = 1'
            );
            $stockStmt->execute([
                (int)$item['quantity'],
                (int)$item['product_id'],
                (int)$item['quantity']
            ]);
            if ($stockStmt->rowCount() !== 1) {
                $skipped++;
                continue;
            }

            $total = ((float)$item['unit_price'] * (int)$item['quantity']) + (float)$deliveryFee;
            $orderStmt = $pdo->prepare(
                "INSERT INTO orders (user_id, subscription_id, delivery_date, delivery_window,
                    delivery_zone, delivery_address, delivery_fee, total_amount, order_status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')"
            );
            $orderStmt->execute([
                (int)$subscription['user_id'],
                (int)$subscription['subscription_id'],
                $deliveryDate,
                $subscription['delivery_window'],
                $subscription['delivery_zone'],
                $subscription['delivery_address'],
                $deliveryFee,
                $total
            ]);
            $orderId = (int)$pdo->lastInsertId();

            $orderItemStmt = $pdo->prepare(
                'INSERT INTO order_items (order_id, product_id, batch_id, quantity, unit_price, subtotal)
                 VALUES (?, ?, ?, ?, ?, ?)'
            );
            $orderItemStmt->execute([
                $orderId,
                (int)$item['product_id'],
                (int)$batchId,
                (int)$item['quantity'],
                $item['unit_price'],
                (float)$item['unit_price'] * (int)$item['quantity']
            ]);

            $notification = $pdo->prepare(
                "INSERT INTO notifications (user_id, notification_type, dedupe_key, message)
                 VALUES (?, 'delivery_update', ?, ?)"
            );
            $notification->execute([
                (int)$subscription['user_id'],
                'order:' . $orderId . ':confirmed',
                "Delivery order #$orderId for $deliveryDate is confirmed."
            ]);
            $created++;
        }

        $nextDate = nextDateAfter(
            $deliveryDate,
            $subscription['frequency'],
            $subscription['delivery_day']
        );
        $advance = $pdo->prepare(
            'UPDATE subscriptions SET next_delivery_date = ? WHERE subscription_id = ?'
        );
        $advance->execute([$nextDate, (int)$subscription['subscription_id']]);
    }

    $pdo->commit();
    fwrite(STDOUT, json_encode([
        'success' => true,
        'orders_created' => $created,
        'subscriptions_waiting_for_stock' => $skipped
    ], JSON_UNESCAPED_SLASHES) . PHP_EOL);
} catch (Throwable $error) {
    if ($pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    error_log('DOSENAMO recurring order generation failed: ' . $error->getMessage());
    fwrite(STDERR, 'Recurring order generation failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
