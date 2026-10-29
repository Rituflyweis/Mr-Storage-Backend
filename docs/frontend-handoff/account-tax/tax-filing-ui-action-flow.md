# Tax & Filing — UI action flow (prepare / pay / file)

**Base:** `/api/account/financial-extra` (admin: `/api/admin/financial-extra`)  
**Auth:** `Authorization: Bearer <token>` — roles `account` | `admin`

---

## Screen map (Tax & Filing tab)

```text
┌─────────────────────────────────────────────────────────────┐
│  Tax & Filing                                               │
│  [ Sync Now ]  →  POST /tax-filing/sync                     │
│                                                             │
│  KPI cards  ← GET /tax-filing/stats                         │
│  Filters    ← GET /tax-filing/filters                       │
│  Table      ← GET /tax-filing  → pendingFiling[] / filed[]  │
│               row.isPrepared  → already prepared or not     │
└─────────────────────────────────────────────────────────────┘
         │
         │ row actions
         ▼
```

| UI control (typical) | API |
|----------------------|-----|
| **Sync Now** | `POST /tax-filing/sync` or `POST /state-wise-tax/sync` |
| Open row / **Review Details** | `GET /tax-filing/:taxId/detail` |
| **Prepare Filing** | `GET /tax-filing/:taxId/prepare` |
| **Pay Tax / Pay Now** | `POST /tax-filing/:taxId/pay` *(backend picks Avalara vs local)* |
| **Download receipt** | `GET /tax-filing/:taxId/receipt` |
| **Mark as filed** / complete | `PUT /tax-filing/:taxId/file` |

`:taxId` = Tax record `_id` from the list row.  
`POST …/approve` is a legacy alias of `…/pay` — same behavior.

---

## List: already prepared?

`GET /tax-filing` rows include:

- `isPrepared` / `prepared` — `true` after Prepare Filing was opened
- `preparedAt` — ISO timestamp or `null`

Use this to badge/disable Prepare without an extra call.

---

## End-to-end flow

```text
1. Sync Now
   POST .../tax-filing/sync
   → refetch GET /tax-filing + /tax-filing/stats

2. User opens a pending row
   GET .../tax-filing/:taxId/detail
   → modal: period, amounts, uiStatus, payNow.enabled, isPrepared

3. Prepare Filing (optional)
   GET .../tax-filing/:taxId/prepare
   → worksheet + persists preparedAt (list isPrepared → true)
   → does not mark paid

4. Pay Tax (always one endpoint)
   POST .../tax-filing/:taxId/pay
   Body: { "paymentMethod": "ACH ending in 4851", "notificationEmail": "…" }
   → backend: Avalara Returns if configured, else local
   → data.mode = "avalara" | "local"
   → optional: GET .../receipt

5. Manual Mark filed (only if never paid via Pay Tax)
   PUT .../file
```

---

## 1. Prepare Filing — `GET /tax-filing/:taxId/prepare`

Returns the worksheet **and** sets `preparedAt` (idempotent). Does not charge or file.

**FE:** Open prepare modal → CTA continues to `POST …/pay`.

---

## 2. Review Details — `GET /tax-filing/:taxId/detail`

- `detail.uiStatus`, `detail.breakdown`, `detail.payNow` (`endpoint: "pay"`)
- `isPrepared` / `preparedAt`
- `avalara.returnsConfigured` — informational; FE does not branch on it

---

## 3. Pay Tax — `POST /tax-filing/:taxId/pay`

**Always use `/pay`.** Staging vs prod is handled by the backend (`isReturnsConfigured()`).

```http
POST /api/account/financial-extra/tax-filing/:taxId/pay
Content-Type: application/json

{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

After success: show `data.payment` → optional receipt → refetch list.

---

## 4. Mark filed — `PUT /tax-filing/:taxId/file`

Manual close when remitted outside Pay Tax. Returns **400** if already paid — hide when status is paid.

---

## Suggested button order

```text
[ Review Details ] → GET  .../detail
[ Prepare Filing ] → GET  .../prepare   (sets isPrepared)
[ Pay Tax ]        → POST .../pay       (always)
[ Receipt ]        → GET  .../receipt   (after paid)
[ Mark filed ]     → PUT  .../file      (only if not yet paid)
```

---

## Sync vs prepare vs pay vs file

```text
Sync     = pull Avalara/invoice rollups into Tax records
Prepare  = worksheet + mark isPrepared
Detail   = Review Details modal
Pay      = remit (Avalara or local — backend) → paid
File     = manual mark paid without Pay Tax → paid
```

**Pay** and **File** are alternatives — don’t call both.

---

## Quick curl

```bash
BASE=https://mr-storage-backend-025k.onrender.com/api/account/financial-extra
TOKEN=…
TAX_ID=…

curl -s -X POST "$BASE/tax-filing/sync" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/tax-filing?page=1&limit=10" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/tax-filing/$TAX_ID/detail" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/tax-filing/$TAX_ID/prepare" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$BASE/tax-filing/$TAX_ID/pay" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"paymentMethod":"ACH ending in 4851","notificationEmail":"accounts@example.com"}'
```
