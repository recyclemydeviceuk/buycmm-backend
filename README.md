# BuyUpon backend

Node 20+ · TypeScript · Express · MongoDB driver. Serves the storefront
(`/api/buy/*`) and the admin panel (`/api/buy/admin/*`). Both contracts are in
[`../API_CONTRACT.md`](../API_CONTRACT.md).

```bash
npm install
cp .env.example .env     # then fill in the values (see below)
npm run seed             # products from src/data/catalogue.json + roles, settings, owner admins
npm run db:wipe -- --yes # clears orders, reviews, enquiries, subscribers, activity (keeps products/settings/team)
npm run dev              # http://localhost:8010 (tsx watch)
npm run build && npm start
```

Deploy on Render: build command `npm ci && npm run build`, start command `npm start`,
health check `/health`, Node 22 (`.node-version`). `render.yaml` lists every environment
variable; set the secret ones in the dashboard. Build-time packages (`typescript`,
`@types/*`) are in `dependencies` because Render installs with `NODE_ENV=production`.

## Isolation from the sell site

The sell site and this API share one Atlas cluster and the same credentials, but
this API only ever writes to the database named in `BUY_DB_NAME` (`buyupon`).
It refuses to start if that equals `SELL_DB_NAME`. The only read of the sell
database is in the seed, which copies device photo URLs from its `devices`
collection. Nothing in the sell site is modified.

Collections in `buyupon`: `products`, `orders`, `reviews`, `enquiries`,
`subscribers`, `settings`, `admins`, `roles`, `otps` (TTL), `activity`,
`customer_notes`.

## Environment

Copied from the sell backend's `.env`: `MONGODB_URI`, `JWT_SECRET`,
`BREVO_API_KEY`, `FROM_EMAIL_Brevo`, `FROM_NAME_Brevo`, `OTP_EXPIRY_MINUTES`.
New for the buy side:

| Variable | Purpose |
| --- | --- |
| `BUY_DB_NAME` / `SELL_DB_NAME` | Buy database (written) and sell database (read-only, seed only) |
| `BUY_ADMIN_EMAILS` | Comma-separated emails created as Owner admins at startup |
| `CORS_ORIGIN` | Storefront and admin origins |
| `STOREFRONT_URL`, `ADMIN_URL` | Used in emails (tracking link, "open in admin") |
| `SUPPORT_EMAIL`, `ADMIN_NOTIFY_EMAIL` | Reply-to, and where new order / enquiry / review alerts go |
| `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Server-side capture and refunds. Required: without them checkout returns 503 and the storefront shows payments as unavailable |

## What it does

- **Catalogue**: products with the storage × network × grade variant matrix; facets, search, sort and paging with the same semantics as the storefront's mock adapter; featured rail and related models from settings.
- **Checkout**: validates every line against live stock, recomputes totals server-side, captures the PayPal order for that total, then decrements stock atomically (a variant cannot go negative under concurrent checkouts; if reservation fails after capture the payment is refunded). Sends the confirmation email and an admin alert.
- **Orders**: `confirmed → packing → dispatched → delivered`, plus `cancelled` / `returned` which restock and refund the remaining balance via PayPal. Tracking is required before dispatch. Dispatch, delivery, cancellation and refund emails. Internal notes, flags, re-sent emails, VAT invoice, editable delivery details, full timeline.
- **Admin auth**: emailed six-digit code (Brevo) and nothing else; the code is never returned by the API. 5 attempts, 10-minute expiry, JWT bearer tokens. Admins and roles live in the database; every admin route checks a permission from `src/lib/permissions.ts` (kept in sync with the admin UI).
- **Reviews**: storefront submissions land as `pending`; approving recalculates the product's public rating. **Enquiries**: contact form → acknowledgement + admin alert; replies from the admin are emailed. **Newsletter**: subscribe/unsubscribe. **Settings** (delivery, networks, storages, grade copy, featured, PayPal mode, notifications), **team & roles**, **activity log**, **dashboard** analytics and **global search**.

Rate limits: 300 requests / 15 min per IP overall; 30 / 15 min on checkout, contact, newsletter and reviews; 10 / 15 min on OTP endpoints.
