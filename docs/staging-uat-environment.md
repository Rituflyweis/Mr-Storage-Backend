# Staging / UAT environment — all panels

**Do not commit real `MONGO_URI` passwords to git.** Copy secrets from **Render** or your local **`.env`**.

---

## Architecture

| Topic | Detail |
|--------|--------|
| **Panels** | Admin, Sales, Account, Plant, Construction, Customer — **same backend, same MongoDB** |
| **Not separate DBs** | There is one `MONGO_URI`; panels differ by **JWT role** (`admin`, `sales`, `account`, `plant`, `construction`) or **customer** token |

---

## API (UAT / staging)

| Item | Value |
|------|--------|
| **Host** | `https://mr-storage-backend-025k.onrender.com` |
| **API base** | `https://mr-storage-backend-025k.onrender.com/api` |
| **Staff auth** | `POST /api/auth/login` |
| **Customer auth** | `POST /api/customer/auth/login` |
| **Refresh** | `POST /api/auth/refresh` (staff) |

Example staff login:

```bash
curl -s -X POST "https://mr-storage-backend-025k.onrender.com/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<password>"}'
```

Use `data.accessToken` as `Authorization: Bearer …` on all panel APIs.

---

## MongoDB (shared database)

| Item | Where |
|------|--------|
| **Env var** | `MONGO_URI` |
| **Render** | Dashboard → **mr-storage-backend-025k** (UAT) → **Environment** → `MONGO_URI` |
| **Local** | `Mr-Storage-Backend/.env` → `MONGO_URI` |
| **Atlas** | Same URI; manage users under **Database Access**, IP under **Network Access** |

**Format (replace placeholders):**

```text
mongodb+srv://<DB_USER>:<DB_PASSWORD>@<cluster>.mongodb.net/<DATABASE_NAME>?appName=Cluster0
```

**Staging UAT database name:** `staging` (path in `MONGO_URI` before `?`). **Do not use `dev2` for staging/UAT** unless a service is explicitly pointed there.

Confirm Render **mr-storage-backend-025k** → Environment → `MONGO_URI` ends with `/staging?…`.

**Compass / mongosh:** paste full `MONGO_URI` from Render or `.env` (never commit the file).

---

## Staff panel logins (same DB, `users` collection)

These are **application** accounts (not MongoDB users). Which emails exist on UAT depends on what was seeded on that Atlas DB.

### Commonly used on UAT (scripts / Postman)

| Panel | Role | Email | Password | Notes |
|--------|------|--------|----------|--------|
| Admin (+ can call most routes) | `admin` | `admin@construction.com` | `Admin@123` | `node scripts/ensureAdminConstruction.js` |
| Admin (staging) | `admin` | `info@steelbuildingdepot.com` | *(set in Atlas / team vault — not in git)* | **`staging`** DB only |
| Sales | `sales` | `sales1@example.com` | `sales@1234` | See `docs/sales-quotation-api-2026-08-28.md` |

### Full role set from `scripts/seed.js` (after `node scripts/seed.js` on that DB)

| Panel | Role | Email | Password |
|--------|------|--------|----------|
| Admin | `admin` | `admin@flyweis.test` | `Admin@1234` |
| Sales | `sales` | `sales@flyweis.test` | `Sales@1234` |
| Plant | `plant` | `plant@flyweis.test` | `Plant@1234` |
| Account | `account` | `account@flyweis.test` | `Account@1234` |
| Construction | `construction` | `construction@flyweis.test` | `Const@1234` |

Login endpoint for all staff rows: `POST /api/auth/login` with `{ "email", "password" }`.

---

## Customer panel

| Item | Detail |
|------|--------|
| **Auth** | `POST /api/customer/auth/login` |
| **Credentials** | **Per customer** in `customers` collection (email + password), not one global staging password |
| **Example flow** | `docs/frontend-customer-app-api-full.md` |

---

## Panel → API prefix (same host)

| Panel | Example route prefix |
|--------|----------------------|
| Admin | `/api/admin/…` |
| Sales | `/api/sales/…` |
| Account | `/api/account/…` |
| Plant | `/api/plant/…` |
| Construction | `/api/construction/…` |
| Customer | `/api/customer/…` |
| Shared (sales + admin) | `/api/invoices/…`, `/api/quotations/…`, `/api/payment-schedules/…` |

See `docs/frontend-handoff/multi-panel-backlog-api.md` for a route map.

---

## Other Render env vars (not Mongo)

Set on the same Render service (see `render.yaml` for names): `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SENDGRID_API_KEY`, AWS S3 keys, etc. **Staff/customer JWTs** come from login responses, not from env.

---

## Security

- Rotate Atlas and Render secrets outside git.
- Do not paste production or UAT `MONGO_URI` into Slack/WhatsApp; share via Render team access or 1Password.
- `.env` is local-only and must stay **untracked**.

---

## Related docs

- `docs/frontend-handoff/multi-panel-backlog-api.md` — UAT base URL + features  
- `docs/quoting-tool-frontend-integration-flow.md` — quoting on Render  
- `scripts/seed.js` — seed all `@flyweis.test` staff users  
