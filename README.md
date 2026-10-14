# DOSENAMO MVP — MySQL-connected prototype

This package contains a PHP/PDO API and a responsive interface for household
subscriptions, local supplier discovery, and business delivery requests.

## Included
- `index.html`, `styles.css`, `app.js` — responsive interface and client logic
- `api/api.php` — database-backed API endpoints
- `api/config.php` — MySQL connection settings
- `dosenamo_mvp.sql` — fresh-install schema and sample records
- `dosenamo_features_migration.sql` — one-time upgrade for the earlier schema
- `dosenamo_business_quotes_migration.sql` — quote fields for databases already upgraded with feature tables
- `api/generate_recurring_orders.php` — daily CLI job for due subscriptions

## Setup with XAMPP
1. Extract the folder into `C:\xampp\htdocs\dosenamo_connected`.
2. Start Apache and MySQL in the XAMPP Control Panel.
3. Import `dosenamo_mvp.sql` through phpMyAdmin for a fresh database.
4. Set the database credentials in `api/config.php`.
5. Open `http://localhost/dosenamo_connected/`.
6. Confirm `http://localhost/dosenamo_connected/api/api.php?action=health`
   responds with a successful database status.

For an existing database created from the earlier MVP schema, back it up first,
import `dosenamo_features_migration.sql` once, then import the updated
`dosenamo_business_quotes_migration.sql` once, and import the updated
`dosenamo_mvp.sql` to seed the fixed district routes and liquid egg products.
Do not run the one-time migration on a fresh or already upgraded database.

## Feature workflows
- Subscriptions save product, quantity, district, fixed route day, supplier,
  frequency, and delivery window. Each plan can be changed, skipped, paused,
  resumed, or cancelled.
- District schedules and fees come from `delivery_zones`. The app groups
  routes by district and day and validates that a chosen route is active.
- Generated delivery orders link to an egg batch so the history can show its
  laying date, source farm, and grade.
- Batch grades use the shared A/B/C/ungraded labels. Reviews are linked to a
  delivered batch, displayed on supplier profiles, and aggregated into farm
  ratings.
- Breakage claims are saved with a requested account credit or replacement.
- Supplier farms and shops come from the database. The schematic map is a
  directory aid; directions open OpenStreetMap using saved coordinates or the
  partner's address.
- Product rows are sellable variants, including shell eggs, specialty eggs,
  and bottled whites and yolks. Create one row for each size/price combination.
- Business requests save volume, product, estimated bulk price, weekly
  frequency, custom delivery window, and account-team assignment.
- Reminders and delivery, claim, and account updates are persisted in the
  in-app notification list.

## Scheduled orders and notifications
Schedule `api/generate_recurring_orders.php` to run daily. On Windows, create a
Task Scheduler job that executes:

`C:\xampp\php\php.exe C:\xampp\htdocs\dosenamo_connected\api\generate_recurring_orders.php`

The job creates due orders when stock and a traceable matching batch are
available, reserves product stock, advances the subscription, and records
upcoming in-app reminders. Email, SMS, and push delivery are not configured.
If inventory or a matching supplier batch is unavailable, the scheduled order
waits and an account update is recorded.

## Prototype limitations
- There is no login screen. Writes use demo `user_id = 1`; do not deploy
  publicly until real authentication and server-side ownership checks are
  integrated. API write endpoints validate ownership where a user ID is
  supplied, but demo identity is not an authentication system.
- The checkout address is a demo placeholder. Replace it with an address form
  before real deliveries.
- The map is schematic and sample farm coordinates are empty. Populate verified
  locations and supplier/product associations before using it for navigation
  or fulfilment.
- Grades are stored consistently, but partner farms must agree on and follow a
  grading procedure. Breakage claims are pending manual review; fulfilment is
  not automated.
- Business requests route to the shared DOSENAMO Trade Account Team. A named
  individual account manager is not configured in this prototype.
- Pricing is estimated from database product prices and MVP volume tiers. A
  trade request is not a final contract or payment.
- The interface groups related decisions and summaries into consistent cards,
  uses restrained emphasis instead of a dense form layout, and keeps primary
  interactive targets at least 44px high for touch use.
- Production deployment also needs CSRF protection where applicable, rate
  limiting, proper error monitoring, and a privacy/security review.
