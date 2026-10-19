# Account → Costs panel — Salary, Rent, Manpower, Freight, Logistics

**Scope:** Expenses submenu action buttons (Figma). **No Avalara / tax changes.**

**Base:** `/api/account/costs`  
**Auth:** `Authorization: Bearer <token>` — roles **`admin`** or **`account`**.

**Production example:** `https://mr-storage-backend-025k.onrender.com`

Short paths (no `/records`) match the UI; long `/records/...` paths are aliases.

### Quick reference (Figma buttons)

| Tab | UI button | Method | Path |
|-----|-----------|--------|------|
| **Salary** | **Generate Slip** (dark) | `POST` | `/api/account/costs/salary/:id/generate-payslip` |
| **Salary** | **Mark Paid** (blue) | `PATCH` | `/api/account/costs/salary/:id/mark-paid` |
| **Salary** | View payslip (eye) | `GET` | `/api/account/costs/salary/:id/payslip` |
| **Rent** | **Mark Paid** (upcoming table) | `PATCH` | `/api/account/costs/rent/:id/mark-paid` |
| Manpower | Mark Paid | `PATCH` | `/api/account/costs/manpower/:id/mark-paid` |
| Freight | Modal actions | various | §4 |
| Logistics | Modal actions | various | §5 |

List endpoints: `GET /costs/salary/records`, `GET /costs/rent/records`, etc.

---

## 1. Salary — Generate payslip & Mark Paid

**List row id:** `rows[].id` from `GET /api/account/costs/salary/records`.

Figma shows two **Payslip** columns: **Generate Slip** on unpaid rows, **Mark Paid** on others — both use the same row `id`.

### 1.1 Generate payslip

**Button:** “Generate Slip”

```http
POST /api/account/costs/salary/6ad2552bd3c19e0410fa17d5/generate-payslip
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:** `{}` or omit.

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
    "status": "Unpaid",
    "adminApproval": "Pending",
    "date": "2026-10-01T00:00:00.000Z",
    "paymentStatus": "pending",
    "payslipGeneratedAt": "2026-10-19T06:00:00.000Z",
    "hasPayslip": true,
    "payslipFileName": "payslip-EXP-2026-0042.pdf",
    "downloadPath": "/api/account/costs/salary/6ad2552bd3c19e0410fa17d5/payslip"
  }
}
```

**Alias:** `POST /api/account/costs/salary/records/:id/generate-payslip`

### 1.2 View / download payslip (eye icon)

```http
GET /api/account/costs/salary/6ad2552bd3c19e0410fa17d5/payslip
Authorization: Bearer <token>
```

**Response:** `200` with `Content-Type: application/pdf` (binary PDF, not JSON).

```javascript
const res = await fetch(`${API_BASE}/api/account/costs/salary/${rowId}/payslip`, {
  headers: { Authorization: `Bearer ${token}` },
});
window.open(URL.createObjectURL(await res.blob()), '_blank');
```

**Alias:** `GET /api/account/costs/salary/records/:id/payslip`

### 1.3 Mark paid (salary)

```http
PATCH /api/account/costs/salary/6ad2552bd3c19e0410fa17d5/mark-paid
Authorization: Bearer <token>
```

**Response `200`:** Updated salary row; `status` → `"Paid"`, `paymentStatus` → `"paid"`.

**Alias:** `PATCH /api/account/costs/salary/records/:id/mark-paid`

Also: `DELETE /api/account/costs/salary/:id` (trash icon).

---

## 2. Rent — Mark Paid

**List row id:** `rows[].id` from `GET /api/account/costs/rent/records` (use **Upcoming Rent Payments** row id for the blue **Mark Paid** button).

```http
PATCH /api/account/costs/rent/6ad252efd3c19e0410fa13d2/mark-paid
Authorization: Bearer <token>
```

**Body:** `{}` or omit.

**Response `200`**

```json
{
  "success": true,
  "message": "Marked as paid",
  "data": {
    "id": "6ad252efd3c19e0410fa13d2",
    "expenseId": "EXP-2026-0200",
    "property": "Main Plant",
    "type": "Plant",
    "location": "Ahmedabad",
    "landlord": "Rajesh Properties",
    "monthlyRent": 214000,
    "amount": 214000,
    "date": "2026-10-01T00:00:00.000Z",
    "dueDate": "2026-10-05T00:00:00.000Z",
    "rentPeriod": "Oct 2026",
    "status": "Paid",
    "paymentStatus": "paid",
    "project": ""
  }
}
```

**Alias:** `PATCH /api/account/costs/rent/records/:id/mark-paid`

---

## 3. Manpower — Mark Paid

**List row id:** `rows[].id` (Expense `_id`).

```http
PATCH /api/account/costs/manpower/6ad2552bd3c19e0410fa17d5/mark-paid
Authorization: Bearer <token>
```

**Body:** `{}` or omit.

**Response `200`**

```json
{
  "success": true,
  "message": "Marked as paid",
  "data": {
    "id": "6ad2552bd3c19e0410fa17d5",
    "expenseId": "EXP-2026-0101",
    "date": "2026-06-20T00:00:00.000Z",
    "employee": {
      "userId": "64abc...",
      "name": "John Worker",
      "designation": "Labor"
    },
    "project": "SMDT Warehouse",
    "leadId": "64def...",
    "hours": 8,
    "otHours": 1,
    "ratePerHour": 120,
    "totalCost": 1140,
    "status": "Paid",
    "paymentStatus": "paid"
  }
}
```

**Alias:** `PATCH /api/account/costs/manpower/records/:id/mark-paid`

---

## 4. Freight — Detail modal & actions

**List row:** use `bidId` from `GET /freight/records` (Mongo id of selected `FreightBid`).

### 4.1 Detail (eye icon / modal)

```http
GET /api/account/costs/freight/64freightbid001/detail
Authorization: Bearer <token>
```

**Response `200` (shape for Figma modal)**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "bidId": "64freightbid001",
    "freightRequestId": "FR-00001",
    "totalLoads": 2,
    "totalFreightCost": 4500,
    "totalFreightCostFormatted": 4500,
    "paymentStatus": "Pending",
    "invoiceStatus": "Pending",
    "status": "Pending",
    "bidSummary": {
      "awardedCarrier": "FastFreight Logistics",
      "awardedBid": 4500,
      "averageBid": 4850,
      "highestBid": 5100,
      "savings": 350,
      "savingsPct": 6.86
    },
    "costComparison": [
      { "bidId": "64freightbid001", "carrierName": "FastFreight Logistics", "amount": 4500, "selected": true },
      { "bidId": "64freightbid002", "carrierName": "Other Carrier", "amount": 5100, "selected": false }
    ],
    "projectInformation": {
      "projectName": "ABC Logistics Warehouse",
      "leadId": "64lead...",
      "deliveryDate": "2026-03-25T00:00:00.000Z",
      "deliveryId": "DEL-1001",
      "deliveryMongoId": "64del..."
    },
    "carrierInformation": {
      "carrier": "FastFreight Logistics",
      "carrierId": "64carrier...",
      "freightCost": 4500,
      "paymentStatus": "Pending"
    },
    "deliveryLink": {
      "deliveryStatus": "delivered",
      "documents": [
        { "label": "Proof of Delivery (POD)", "url": "https://...", "type": "pod" },
        { "label": "Delivery Receipt", "url": "https://...", "type": "attachment" }
      ]
    },
    "invoiceDetails": {
      "invoiceNumber": "INV-45892",
      "invoiceDate": "2026-03-25T00:00:00.000Z",
      "paymentDueDate": "2026-04-01T00:00:00.000Z",
      "invoiceStatus": "Under Review",
      "amount": 4500,
      "downloadUrl": ""
    },
    "costComparisonSummary": {
      "awardedBid": 4500,
      "invoicedAmount": 4500,
      "variance": 0
    },
    "approvalId": "64approval...",
    "actions": {
      "canApprove": true,
      "canReject": true,
      "canMarkPaid": true,
      "canDownloadInvoice": true
    }
  }
}
```

Use `data.actions.*` to show/hide **Approve**, **Reject**, **Mark paid**, **Download invoice** in the modal.

**Alias:** `GET /api/account/costs/freight/records/:bidId/detail`

### 4.2 Approve invoice (purple button)

```http
PATCH /api/account/costs/freight/64freightbid001/approve
Authorization: Bearer <token>
Content-Type: application/json
```

**Body (optional):** `{ "reviewNotes": "Approved for payment" }`

**Response `200`:** Updated detail; `invoiceStatus` → `"Approved"`, carrier `paymentStatus` → `"Invoiced"`, `actions.canApprove` / `canReject` → `false`.

**Alias:** `PATCH /api/account/costs/freight/records/:bidId/approve`

### 4.3 Reject invoice (grey button)

```http
PATCH /api/account/costs/freight/64freightbid001/reject
Authorization: Bearer <token>
Content-Type: application/json
```

**Body (optional):** `{ "reviewNotes": "Amount mismatch" }`

**Response `200`:** Updated detail; `paymentStatus` → `"Rejected"`.

**Alias:** `PATCH /api/account/costs/freight/records/:bidId/reject`

### 4.4 Mark paid (green button)

```http
PATCH /api/account/costs/freight/64freightbid001/mark-paid
Authorization: Bearer <token>
```

**Response `200`:** Updated detail; `paymentStatus` → `"Paid"`. Auto-approves if still under review (except when rejected).

**Alias:** `PATCH /api/account/costs/freight/records/:bidId/mark-paid`

### 4.5 Download invoice

```http
GET /api/account/costs/freight/64freightbid001/invoice-download
Authorization: Bearer <token>
```

**Response:** `302` redirect to S3/https when `Invoice.documentUrl` is set; otherwise `200`:

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "downloadUrl": "https://...",
    "invoiceNumber": "INV-45892"
  }
}
```

**404** if no `payableInvoiceId` on the bid or no file URL.

**Alias:** `GET /api/account/costs/freight/records/:bidId/invoice-download`

---

## 5. Logistics — Detail modal (Figma parity with freight)

**List row id:** `rows[].id` or `approvalId` (`PaymentApproval` `_id`).  
**Header:** bind `loadId` + `deliveryRef` / `deliveryId` from detail (same as list `loadId` + `deliveryRef`).

### 5.1 Detail (eye icon → modal)

```http
GET /api/account/costs/logistics/64approval001/detail
Authorization: Bearer <token>
```

**Response `200`**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "id": "64approval001",
    "approvalId": "64approval001",
    "freightBidId": "64freightbid001",
    "loadId": "TRX-9876",
    "deliveryRef": "DEL-1235",
    "deliveryId": "DEL-1235",
    "deliveryMongoId": "64del...",
    "totalLogisticsCost": 4500,
    "totalLogisticsCostFormatted": 4500,
    "invoiceStatus": "Under Review",
    "paymentStatus": "Pending",
    "status": "Under Review",
    "projectInformation": {
      "projectName": "ABC Logistics Warehouse",
      "leadId": "64lead...",
      "deliveryDate": "2026-03-25T00:00:00.000Z",
      "deliveryId": "DEL-1001"
    },
    "carrierInformation": {
      "carrier": "FastFreight Logistics",
      "logisticCost": 4500,
      "paymentStatus": "Invoiced"
    },
    "deliveryLink": {
      "deliveryStatus": "delivered",
      "documents": [
        { "label": "Proof of Delivery (POD)", "url": "https://...", "type": "pod" },
        { "label": "Delivery Receipt", "url": "https://...", "type": "attachment" },
        { "label": "Bill of Lading", "url": "https://...", "type": "attachment" }
      ]
    },
    "costComparisonSummary": {
      "awardedBid": 4500,
      "invoicedAmount": 4500,
      "variance": 0
    },
    "invoiceDetails": {
      "invoiceId": "64inv...",
      "invoiceNumber": "INV-45892",
      "invoiceDate": "2026-03-25T00:00:00.000Z",
      "paymentDueDate": "2026-04-01T00:00:00.000Z",
      "invoiceStatus": "Under Review",
      "amount": 4500,
      "downloadUrl": "https://..."
    },
    "actions": {
      "canApprove": true,
      "canReject": true,
      "canMarkPaid": true,
      "canDownloadInvoice": true
    },
    "approvalStatus": "Pending"
  }
}
```

**UI mapping**

| Figma block | API field |
|-------------|-----------|
| Top green card — total + invoice/payment status | `totalLogisticsCost`, `invoiceStatus`, `paymentStatus` |
| Header Load ID / Delivery ID | `loadId`, `deliveryRef` |
| Project / Carrier / Delivery link columns | `projectInformation`, `carrierInformation`, `deliveryLink.documents` |
| Invoice Details box | `invoiceDetails` |
| Footer **Download Invoice** | `GET …/invoice-download` when `actions.canDownloadInvoice` |
| Optional Approve / Reject / Mark paid (same as freight invoice row) | `PATCH …/approve`, `/reject`, `/mark-paid` via `actions.*` |

**Alias:** `GET /api/account/costs/logistics/records/:id/detail`

### 5.2 Approve invoice

```http
PATCH /api/account/costs/logistics/64approval001/approve
Authorization: Bearer <token>
```

Optional body: `{ "reviewNotes": "Approved" }`. Returns updated detail; carrier `paymentStatus` → `"Invoiced"`.

### 5.3 Reject invoice

```http
PATCH /api/account/costs/logistics/64approval001/reject
Authorization: Bearer <token>
```

Optional body: `{ "reviewNotes": "Disputed amount" }`.

### 5.4 Mark paid

```http
PATCH /api/account/costs/logistics/64approval001/mark-paid
Authorization: Bearer <token>
```

Returns detail with `paymentStatus` → `"Paid"`.

### 5.5 Download invoice (footer blue button)

```http
GET /api/account/costs/logistics/64approval001/invoice-download
Authorization: Bearer <token>
```

`302` to `Invoice.documentUrl` when linked via freight bid / delivery; else `404` if no file.

**Aliases:** `/logistics/records/:id/approve`, `/reject`, `/mark-paid`, `/invoice-download`

---

## 6. Frontend wiring (full table)

| Screen | Control | Method | Path |
|--------|---------|--------|------|
| **Salary** | **Generate Slip** | `POST` | `/api/account/costs/salary/:id/generate-payslip` |
| **Salary** | **Mark Paid** | `PATCH` | `/api/account/costs/salary/:id/mark-paid` |
| **Salary** | View payslip | `GET` | `/api/account/costs/salary/:id/payslip` |
| **Rent** | **Mark Paid** | `PATCH` | `/api/account/costs/rent/:id/mark-paid` |
| Manpower | Mark Paid | `PATCH` | `/costs/manpower/:id/mark-paid` |
| Freight | Open modal | `GET` | `/costs/freight/:bidId/detail` |
| Freight | Approve | `PATCH` | `/costs/freight/:bidId/approve` |
| Freight | Reject | `PATCH` | `/costs/freight/:bidId/reject` |
| Freight | Mark Paid | `PATCH` | `/costs/freight/:bidId/mark-paid` |
| Freight | Download invoice | `GET` | `/costs/freight/:bidId/invoice-download` |
| Logistics | Open modal | `GET` | `/costs/logistics/:id/detail` |
| Logistics | Approve / Reject / Mark paid / Download | `PATCH` / `GET` | `/costs/logistics/:id/approve`, `/reject`, `/mark-paid`, `/invoice-download` |
After mark-paid / generate-payslip, refresh the list row or merge `data` into local state.

**List fields added**

- Freight / logistics rows: `paymentStatus` (`Paid` / `Unpaid`)
- Logistics: `approvalId` (same as `id`)
- Rent rows: richer `status`, `paymentStatus`, optional metadata fields when present on create

---

## 7. Errors

| HTTP | Body |
|------|------|
| `404` | `{ "success": false, "message": "... not found" }` |
| `401` | Unauthorized |

---

## 8. Backend files

- `src/routes/account/costs.routes.js` — all paths above
- `src/controllers/account/costs.controller.js`
- `src/services/accountCostsPanel.service.js` — salary / rent / manpower rows
- `src/services/accountSalaryPayslip.service.js` — salary PDF
- `src/services/accountCostsActions.service.js` — freight / logistics / rent mark-paid

Duplicate detail: `docs/frontend-account-salary-payslip-api-handoff-2026-10-19.md` (salary-only).
