# DOSENAMO MVP — MySQL-connected prototype

This package contains the original DOSENAMO UI plus a small PHP/PDO API that reads and writes to MySQL.

## Included
- `index.html`, `styles.css`, `app.js` — front end
- `api/api.php` — API endpoints used by the UI
- `api/config.php` — MySQL connection settings
- `dosenamo_mvp.sql` — database, tables, and sample records
- `README.md` — setup steps

## Requirements
- XAMPP (Apache + PHP + MySQL/MariaDB) or another PHP server with PDO MySQL enabled
- MySQL 8+ recommended

## Setup using XAMPP
1. Extract the entire `dosenamo_connected` folder into `C:\xampp\htdocs\dosenamo_connected`.
2. Start Apache and MySQL in the XAMPP Control Panel.
3. Open `http://localhost/phpmyadmin`.
4. Choose **Import**, select `dosenamo_mvp.sql`, then click **Import/Go**.
5. Open `api/config.php`. For a default local XAMPP setup, `root` with an empty password is common. Change `DB_USER` and `DB_PASS` if your MySQL setup differs.
6. Visit `http://localhost/dosenamo_connected/`.
7. Test the API directly at `http://localhost/dosenamo_connected/api/api.php?action=health`. A successful response looks like `{"success":true,"database":"dosenamo"}`.

## What now uses the database
- Product choices are loaded from `products`.
- Farms and shops are loaded from `farms`.
- Batch lookup reads from `egg_batches`, `products`, and `farms`.
- Starting a subscription inserts a row into `subscriptions` and `subscription_items`.
- Pause and skip actions update subscription records.
- Trade account requests are saved in `trade_requests`.

## Important MVP limitations
- The current UI has no login screen. For demonstration only, write actions use demo `user_id = 1` created by the SQL seed. Do not deploy this publicly until real authentication and server-side session checks are implemented.
- Demo address and delivery zone are placeholders in `app.js`; replace them with a real checkout/address form.
- The PHP API validates basic inputs, but production deployment needs authentication/authorization, CSRF protections where applicable, rate limiting, proper error monitoring, and privacy/security review.
- Subscription creation saves the plan, but recurring orders still need a scheduled backend job/cron task. The database does not create future orders automatically.
- Map distances, ratings, and reviews are display placeholders; farm addresses and coordinates are database fields but sample coordinates are not populated.
- The product price is stored in the database. The database-backed product list treats each product row as a sellable variant; create separate product rows for each size/price combination you offer.
- No payment gateway is connected.


## Home subscriptions (updated)

The Home delivery list is loaded from MySQL using `action=upcoming_subscriptions`. It shows active subscriptions for demo user ID 1 with upcoming delivery dates, sorted by the next delivery date. The Skip and Pause buttons target the earliest upcoming active subscription and refresh the list after a successful action.

Keep `api/config.php` in the `api` folder. For default XAMPP settings, the database is `dosenamo`, user is `root`, and password is blank; adjust the credentials if your MySQL setup differs. Open the project through Apache, for example `http://localhost/dosenamo_connected/`, not by opening `index.html` as a local file.
