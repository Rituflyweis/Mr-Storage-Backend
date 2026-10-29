# Tax Filing — Pay modal FE notes (shareable)

**Date:** 29 Oct 2026  
**Base:** `https://mr-storage-backend-025k.onrender.com`  
**Prefix:** `/api/account/financial-extra`  
**Auth:** `Authorization: Bearer <account|admin token>`

---

## What changed for Pay Tax

Use **one endpoint only**:

```http
POST /api/account/financial-extra/tax-filing/:taxId/pay
```

- Do **not** branch staging → `/pay` vs prod → `/approve`.
- Backend picks Avalara vs local from Returns config.
- `POST …/approve` still works as an alias of `/pay` (same handler). Prefer `/pay`.
- Response includes `data.mode`: `"avalara"` | `"local"` (optional UI badge).

---

## Pay modal — required FE changes

1. Confirm button → always `POST …/tax-filing/:taxId/pay`.
2. Remove env / `avalara.returnsConfigured` logic that chose `/approve` vs `/pay`.
3. Body unchanged (see below).
4. On success → show success modal from `data.payment`, then optional receipt + refetch list/stats.
5. Do **not** call `PUT …/file` after a successful pay.

---

## Request body

```http
POST /api/account/financial-extra/tax-filing/:taxId/pay
Content-Type: application/json

{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `paymentMethod` | Optional | Free-text **label** for UI / receipt / email. Not a live bank picker from Avalara. |
| `notificationEmail` | Optional | Confirmation email + PDF when SendGrid / reminders are on. |

If `paymentMethod` is omitted, backend defaults to `"ACH (via Avalara)"` (Avalara mode) or `"Manual"` (local mode).

---

## How to show payment method

Backend does **not** return linked bank accounts or Avalara funding options.

Avalara remittance uses the company funding POA already configured in Avalara. Approving a filing does **not** take an ACH/card selection from our API.

**FE approach (matches Figma):**

| UI piece | Source |
|----------|--------|
| Amount / Pay $X | `detail.payNow.amount` from `GET …/detail` |
| Enable/disable Pay | `detail.payNow.enabled` |
| Avalara partner badge | `detail.payNow.providerLabel` |
| Payment method display | FE shows a fixed/Figma-style line (e.g. `ACH ending in 4851`) **or** a simple dropdown/text the user picks |
| Send to API | Same string as `paymentMethod` in the POST body |
| Notify email | Input; can prefill from tax notification settings if already loaded |

So: **show method in the modal on the FE → POST that label → echo it on success.**

---

## Success modal mapping

Example `data`:

```json
{
  "payment": {
    "amountPaid": 14550,
    "filingPeriod": { "start": "2025-05-01T00:00:00.000Z", "end": "2025-05-31T00:00:00.000Z" },
    "paymentMethod": "ACH ending in 4851",
    "confirmationNumber": "Tx-2025-0619-8421",
    "status": "processing",
    "estimatedSettlement": "1-3 business days",
    "notificationEmail": "accounts@acmeindustries.com"
  },
  "tax": { "status": "paid", "confirmationNumber": "Tx-2025-0619-8421" },
  "mode": "avalara"
}
```

| Success UI | Field |
|------------|--------|
| Amount paid | `payment.amountPaid` |
| Filing period | `payment.filingPeriod` |
| Payment method | `payment.paymentMethod` (echo of what you sent) |
| Confirmation # | `payment.confirmationNumber` |
| Status | `payment.status` |
| Settlement note | `payment.estimatedSettlement` |
| Mode badge (optional) | `mode` → `avalara` / `local` |
| Download receipt | `GET …/tax-filing/:taxId/receipt?format=pdf` |

---

## Detail payload helpers (open modal)

```http
GET /api/account/financial-extra/tax-filing/:taxId/detail
```

Useful:

- `detail.payNow.enabled` / `amount` / `providerLabel` / `endpoint` (`"pay"`)
- `detail.breakdown` — collected / paid / payable
- `isPrepared` / `preparedAt` — not required for pay modal itself

---

## List: already prepared? (separate from pay modal)

`GET …/tax-filing` rows include:

- `isPrepared` / `prepared` — `true` after Prepare Filing
- `preparedAt` — ISO or `null`

Prepare: `GET …/tax-filing/:taxId/prepare` (sets the flag; does not pay).

---

## Suggested flow

```text
Review Details → GET .../detail
Prepare Filing → GET .../prepare   (optional; sets isPrepared)
Pay Tax        → POST .../pay      (always)
Success modal  ← data.payment
Receipt        → GET .../receipt   (optional)
Refetch        → GET .../tax-filing + /stats
```

---

## Quick curl

```bash
BASE=https://mr-storage-backend-025k.onrender.com/api/account/financial-extra
TOKEN=…
TAX_ID=…

curl -s "$BASE/tax-filing/$TAX_ID/detail" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$BASE/tax-filing/$TAX_ID/pay" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"paymentMethod":"ACH ending in 4851","notificationEmail":"accounts@example.com"}'
curl -s "$BASE/tax-filing/$TAX_ID/receipt?format=pdf" -H "Authorization: Bearer $TOKEN"
```

---

## Related

- Full sync + actions: [`tax-filing-sync-and-actions-fe.md`](./tax-filing-sync-and-actions-fe.md)
- UI flow: [`tax-filing-ui-action-flow.md`](./tax-filing-ui-action-flow.md)
