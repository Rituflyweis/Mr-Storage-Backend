# Account → Expenses → Salary (mark paid, delete, payslip)

**Scope:** Salary cost panel only. No Avalara / tax engine changes.

**Base path:** `/api/account/costs`  
**Auth:** `Authorization: Bearer <token>` — roles **`admin`** or **`account`**.

**Production host (example):** `https://mr-storage-backend-025k.onrender.com`

---

## Why two URL shapes?

The UI calls short paths **without** `/records`. The backend supports **both**:

| UI / short | Docs / long |
|------------|-------------|
| `/salary/:id/mark-paid` | `/salary/records/:id/mark-paid` |
| `/salary/:id` (DELETE) | `/salary/records/:id` (DELETE) |
| `/salary/:id/generate-payslip` | `/salary/records/:id/generate-payslip` |
| `/salary/:id/payslip` | `/salary/records/:id/payslip` |

List/create unchanged: `GET/POST /salary/records`, `GET /salary/summary`.

---

## 1. List salary rows (context)

```http
GET /api/account/costs/salary/records?page=1&limit=10
Authorization: Bearer <token>
```

**Response `200`**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "rows": [
      {
        "id": "6ad2552bd3c19e0410fa17d5",
        "expenseId": "EXP-2026-0042",
        "employeeName": "Jane Smith",
        "employeeId": "EMP-A1B2",
        "designation": "Accountant",
        "netSalary": 4500,
        "status": "Unpaid",
        "adminApproval": "Pending",
        "date": "2026-10-01T00:00:00.000Z",
        "paymentStatus": "pending",
        "payslipGeneratedAt": null,
        "hasPayslip": false,
        "payslipFileName": ""
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

---

## 2. Mark paid

**Button:** “Mark Paid”

```http
PATCH /api/account/costs/salary/6ad2552bd3c19e0410fa17d5/mark-paid
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:** empty `{}` or omit body.

**Response `200`**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "id": "6ad2552bd3c19e0410fa17d5",
    "expenseId": "EXP-2026-0042",
    "employeeName": "Jane Smith",
    "employeeId": "EMP-A1B2",
    "designation": "Accountant",
    "netSalary": 4500,
    "status": "Paid",
    "adminApproval": "Approved",
    "date": "2026-10-01T00:00:00.000Z",
    "paymentStatus": "paid",
    "payslipGeneratedAt": null,
    "hasPayslip": false,
    "payslipFileName": ""
  }
}
```

**Errors**

| Status | Example |
|--------|---------|
| `404` | `{ "success": false, "message": "Salary entry not found" }` |
| `401` | Unauthorized |

**Alternate path:** `PATCH /api/account/costs/salary/records/:id/mark-paid`

---

## 3. Delete salary row

**Button:** trash icon

```http
DELETE /api/account/costs/salary/6ad252efd3c19e0410fa13d2
Authorization: Bearer <token>
```

**Response `200`**

```json
{
  "success": true,
  "message": "Deleted",
  "data": {}
}
```

Soft-delete: `Expense.isActive` → `false` (row disappears from list).

**Errors:** `404` if id missing or already deleted.

**Alternate path:** `DELETE /api/account/costs/salary/records/:id`

---

## 4. Generate payslip

**Button:** “Generate Slip”

```http
POST /api/account/costs/salary/6ad2552bd3c19e0410fa17d5/generate-payslip
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:** empty `{}` or omit.

**Response `200`**

```json
{
  "success": true,
  "message": "Payslip generated",
  "data": {
    "id": "6ad2552bd3c19e0410fa17d5",
    "expenseId": "EXP-2026-0042",
    "employeeName": "Jane Smith",
    "employeeId": "EMP-A1B2",
    "designation": "Accountant",
    "netSalary": 4500,
    "status": "Paid",
    "adminApproval": "Approved",
    "date": "2026-10-01T00:00:00.000Z",
    "paymentStatus": "paid",
    "payslipGeneratedAt": "2026-10-19T06:00:00.000Z",
    "hasPayslip": true,
    "payslipFileName": "payslip-EXP-2026-0042.pdf",
    "downloadPath": "/api/account/costs/salary/6ad2552bd3c19e0410fa17d5/payslip"
  }
}
```

**Frontend:** After success, enable view/download using `downloadPath` (prepend API host).

**Alternate path:** `POST /api/account/costs/salary/records/:id/generate-payslip`

---

## 5. View / download payslip (PDF)

**Button:** eye icon — open in new tab or download.

```http
GET /api/account/costs/salary/6ad2552bd3c19e0410fa17d5/payslip
Authorization: Bearer <token>
```

**Response `200`**

- `Content-Type: application/pdf`
- `Content-Disposition: inline; filename="payslip-EXP-2026-0042.pdf"`
- Body: raw PDF bytes (not JSON)

**Example (fetch + blob URL):**

```javascript
const res = await fetch(
  `${API_BASE}/api/account/costs/salary/${rowId}/payslip`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const blob = await res.blob();
window.open(URL.createObjectURL(blob), '_blank');
```

**Notes**

- PDF is generated on the fly from the salary expense (employee name, ID, designation, net salary, date, paid status).
- `POST …/generate-payslip` sets `payslipGeneratedAt` / `hasPayslip` on the row; `GET …/payslip` works even if generate was not called first.

**Alternate path:** `GET /api/account/costs/salary/records/:id/payslip`

---

## 6. Frontend wiring checklist

| UI control | Method | Path |
|------------|--------|------|
| Mark Paid | `PATCH` | `/api/account/costs/salary/:id/mark-paid` |
| Delete | `DELETE` | `/api/account/costs/salary/:id` |
| Generate Slip | `POST` | `/api/account/costs/salary/:id/generate-payslip` |
| View payslip | `GET` | `/api/account/costs/salary/:id/payslip` |

Refresh list after mark-paid / delete / generate so `status` and `hasPayslip` stay in sync.

---

## 7. Backend files (this release only)

- `src/routes/account/costs.routes.js` — routes + aliases
- `src/controllers/account/costs.controller.js` — handlers
- `src/services/accountCostsPanel.service.js` — row fields + `getSalaryRecordById`
- `src/services/accountSalaryPayslip.service.js` — PDF generation (PDFKit)

No changes to Avalara, tax orchestrator, or invoice tax commit in this release.
