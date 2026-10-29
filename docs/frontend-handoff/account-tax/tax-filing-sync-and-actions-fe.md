# Tax Filing — Sync + Prepare / Pay / File (FE handoff)

**Date:** 29 Oct 2026 (updated: unified Pay + `isPrepared`)  
**Base:** `https://mr-storage-backend-025k.onrender.com`  
**Prefix:** `/api/account/financial-extra`  
**Auth:** `Authorization: Bearer <account|admin token>`

---

## 1. Sync Now — `POST …/tax-filing/sync`

| Path | Status |
|------|--------|
| `POST /api/account/financial-extra/state-wise-tax/sync` | Canonical |
| `POST /api/account/financial-extra/tax-filing/sync` | Alias — same handler |

No request body required. On success, refetch `GET …/tax-filing` + `GET …/tax-filing/stats`.

---

## 2. List — prepared flag

`GET /api/account/financial-extra/tax-filing?page=1&limit=10`

Each row in `pendingFiling` / `filed` (and list items) now includes:

| Key | Type | Meaning |
|-----|------|---------|
| `isPrepared` | `boolean` | `true` after Prepare Filing was opened at least once |
| `prepared` | `boolean` | Same as `isPrepared` (alias) |
| `preparedAt` | `string \| null` | ISO timestamp when prepared |

**FE:** Use `isPrepared` (or `prepared`) to show “Prepared” vs “Not prepared” on the table without calling detail first.

---

## 3. Row actions

**Base:** `/api/account/financial-extra/tax-filing/:taxId/...`  
`:taxId` = Tax record `_id` from `GET …/tax-filing`.

| UI control | Method | Path |
|------------|--------|------|
| Review Details | `GET` | `/tax-filing/:taxId/detail` |
| Prepare Filing | `GET` | `/tax-filing/:taxId/prepare` |
| **Pay Tax / Pay Now** | `POST` | `/tax-filing/:taxId/pay` |
| Download receipt | `GET` | `/tax-filing/:taxId/receipt` |
| Mark as filed (manual) | `PUT` | `/tax-filing/:taxId/file` |

`POST …/approve` still works as an **alias of pay** (same handler). Prefer **`/pay` only** — staging vs prod is decided on the backend.

### End-to-end UI flow

```text
┌─ Tax & Filing page ─────────────────────────────────────┐
│  [ Sync Now ] → POST /tax-filing/sync                   │
│  Table ← GET /tax-filing  (use row.isPrepared)          │
└────────────────────────┬────────────────────────────────┘
                         │ open row
                         ▼
              GET /tax-filing/:taxId/detail
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   GET .../prepare   POST .../pay    PUT .../file
   (sets isPrepared) (Pay Tax —      (Mark filed —
                      backend picks    only if not paid)
                      Avalara/local)
                         │
                         ▼
              GET .../receipt  (after paid)
              Refetch GET /tax-filing + /stats
```

---

### 3.1 Prepare Filing — `GET …/prepare`

**When:** User clicks **Prepare Filing**.

**Effect:** Returns worksheet / filing summary **and** persists `preparedAt` so list `isPrepared` becomes `true`. Does **not** pay or file.

```http
GET /api/account/financial-extra/tax-filing/:taxId/prepare
```

Response includes `isPrepared: true`, `preparedAt`, plus `detail` / `tax`.

---

### 3.2 Review Details — `GET …/detail`

```http
GET /api/account/financial-extra/tax-filing/:taxId/detail
```

Useful fields:

- `detail.uiStatus` → `{ code, label, tone }`
- `detail.breakdown` → collected / paid / payable
- `detail.payNow.enabled` / `payNow.amount` / `payNow.endpoint` (`"pay"`)
- `isPrepared` / `prepared` / `preparedAt`
- `avalara.returnsConfigured` — informational only; FE does **not** choose path

---

### 3.3 Pay Tax — single endpoint `POST …/pay`

**Always call:**

```http
POST /api/account/financial-extra/tax-filing/:taxId/pay
Content-Type: application/json

{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

**Backend chooses mode:**

| Env | Behavior | Response `data.mode` |
|-----|----------|----------------------|
| Avalara Returns configured (prod) | `approveFilings` then mark paid | `"avalara"` |
| Staging / Returns not configured | Local ledger mark paid | `"local"` |

`POST …/approve` is the same handler (legacy alias). Do **not** branch on environment in the FE.

After success: `GET …/receipt` (optional `?format=pdf`).

---

### 3.4 Mark as filed — `PUT …/file`

Manual close when remitted **outside** Pay Tax. Fails with `"Tax already filed"` if already paid.

**Do not call `file` after a successful `pay`.**

---

## 4. Cheat sheet

| Step | Side effect |
|------|-------------|
| **Sync** | Refresh tax data |
| **Prepare** | Worksheet + sets `isPrepared` |
| **Detail** | Read-only (+ `isPrepared`) |
| **Pay** | Remit → `paid` (Avalara or local — backend) |
| **File** | Manual → `paid` (only if not already paid) |
| **Receipt** | After paid |

---

## 5. Suggested row buttons

```text
[ Review Details ]  → GET  .../detail
[ Prepare Filing ]  → GET  .../prepare     (then list shows isPrepared)
[ Pay Tax ]         → POST .../pay         (always — no staging/prod branch)
[ Receipt ]         → GET  .../receipt     (after paid)
[ Mark filed ]      → PUT  .../file        (only if not paid yet)
```

---

## 6. Quick curl

```bash
BASE=https://mr-storage-backend-025k.onrender.com/api/account/financial-extra
TOKEN=…
TAX_ID=…

curl -s -X POST "$BASE/tax-filing/sync" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/tax-filing?page=1&limit=10" -H "Authorization: Bearer $TOKEN"
# → each row: isPrepared, prepared, preparedAt

curl -s "$BASE/tax-filing/$TAX_ID/detail" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/tax-filing/$TAX_ID/prepare" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$BASE/tax-filing/$TAX_ID/pay" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"paymentMethod":"ACH ending in 4851","notificationEmail":"accounts@example.com"}'
curl -s "$BASE/tax-filing/$TAX_ID/receipt" -H "Authorization: Bearer $TOKEN"
```

---

## 7. Related docs

- Longer UI flow: [`tax-filing-ui-action-flow.md`](./tax-filing-ui-action-flow.md)  
- Avalara / address gap notes: [`frontend-gap-changes-tax-address-avalara-2026-10-19.md`](./frontend-gap-changes-tax-address-avalara-2026-10-19.md)  
