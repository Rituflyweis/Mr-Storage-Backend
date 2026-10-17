# Account panel — Project invoices row actions (Mark as Paid, Follow up)

**Date:** 2026-10-17  
**Audience:** Account panel · **Project detail → View Invoices** table  
**Base:** `https://mr-storage-backend-025k.onrender.com`  
**Prefix:** `/api/account/invoices`  
**Auth:** `Authorization: Bearer <token>` · roles **`admin`** | **`account`**

**Related (read-only list):** [`frontend-account-project-detail-api.md`](./frontend-account-project-detail-api.md) §2

---

## Screen → API map

| Figma row status | Button | Method | Path |
|------------------|--------|--------|------|
| **Pending** | Mark as Paid | `PUT` | `/api/account/invoices/:invoiceId/mark-paid` |
| **Overdue** (and unpaid pending) | Follow up | `POST` | `/api/account/invoices/:invoiceId/follow-up` |
| **Paid** | — | — | No action API |

Use **`invoiceId`** from `GET /api/account/projects/:projectId/invoices/records` → `records[].invoiceId`.

---

## 1. Mark as Paid

```http
PUT /api/account/invoices/67a1b2c3d4e5f67890123481/mark-paid
Authorization: Bearer <token>
```

No body required.

### Success `200`

```json
{
  "success": true,
  "message": "Invoice marked as paid",
  "data": {
    "invoice": {
      "_id": "67a1b2c3d4e5f67890123481",
      "status": "paid",
      "paidAt": "2026-10-17T10:00:00.000Z",
      "paidBy": "67a1b2c3d4e5f67890123450",
      "invoiceNumber": "INV-1003",
      "totalAmount": 8000
    }
  }
}
```

### Errors

| HTTP | When |
|------|------|
| `404` | Invoice not found |
| `400` | Already paid or cancelled |
| `401` / `403` | Missing or invalid token / role |

After success, refresh:

- `GET /api/account/projects/:projectId/invoices/summary`
- `GET /api/account/projects/:projectId/invoices/records`

---

## 2. Follow up (payment reminder)

Sends a **payment reminder** to the customer (email when SendGrid/SMTP is configured, plus **customer portal in-app** notification). Creates a **`PaymentFollowUp`** record for internal tracking.

```http
POST /api/account/invoices/67a1b2c3d4e5f67890123481/follow-up
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Optional custom reminder text",
  "subject": "Optional email subject",
  "nextFollowUp": "2026-10-24T14:00:00.000Z"
}
```

| Body field | Required | Description |
|------------|----------|-------------|
| `message` | No | Email / notification body; server default mentions invoice #, amount, project, due date |
| `subject` | No | Email subject; default `Payment reminder: Invoice {invoiceNumber}` |
| `nextFollowUp` | No | ISO datetime stored on `PaymentFollowUp.nextFollowUp` for internal scheduling |

### Success `200`

```json
{
  "success": true,
  "message": "Payment follow-up sent",
  "data": {
    "invoiceId": "67a1b2c3d4e5f67890123481",
    "invoiceNumber": "INV-1003",
    "leadId": "67a1b2c3d4e5f6789012345a",
    "statusLabel": "Overdue",
    "channels": {
      "email": true,
      "inApp": true
    },
    "paymentFollowUpId": "68f0123456789abcdef01234",
    "sentAt": "2026-10-17T10:05:00.000Z"
  }
}
```

| Field | Meaning |
|-------|---------|
| `channels.email` | `true` if customer has email and mailer is configured |
| `channels.inApp` | `true` if customer notification row was created |
| `statusLabel` | `Overdue` or `Pending` (UI hint only) |

At least one channel must succeed; otherwise `400`.

### Errors

| HTTP | When |
|------|------|
| `404` | Invoice, project, or customer missing |
| `400` | Paid / cancelled invoice; vendor or carrier payable invoice; delivery failed (no email config and notification failed) |
| `400` | Invalid `invoiceId` or body validation |

### UI notes

- Show **Follow up** for unpaid customer invoices (table `status` **Pending** or **Overdue**).
- Disable while request in flight; toast from `message` on success.
- Optional: show which channels succeeded using `data.channels`.

---

## 3. List endpoints (unchanged)

```http
GET /api/account/projects/:projectId/invoices/summary?startDate=&endDate=
GET /api/account/projects/:projectId/invoices/records?page=1&limit=20&search=&paymentStatus=&sortBy=dueDate&sortOrder=desc
```

---

## 4. curl smoke test

```bash
BASE=http://127.0.0.1:5001
TOKEN="$(curl -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"account@flyweis.test","password":"Account@1234"}' \
  | jq -r '.data.accessToken')"
INV="<invoiceId from records>"

curl -s -X POST "$BASE/api/account/invoices/$INV/follow-up" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Please remit payment at your earliest convenience."}' | jq .

curl -s -X PUT "$BASE/api/account/invoices/$INV/mark-paid" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

*Backend: `accountInvoiceFollowUp.service.js`, `account/invoice.controller.js`, `account/invoice.routes.js`*
