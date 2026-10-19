# Account → Costs panel — Manpower, Freight, Logistics, Rent actions

**Scope:** Mark paid + freight/logistics detail modals only. **No Avalara / tax changes.**

**Base:** `/api/account/costs`  
**Auth:** `Authorization: Bearer <token>` — roles **`admin`** or **`account`**.

**Production example:** `https://mr-storage-backend-025k.onrender.com`

Short paths (no `/records`) match the UI; long `/records/...` paths are aliases.

---

## 1. Manpower — Mark Paid

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

## 2. Freight — Detail modal & Mark Paid

**List row:** use `bidId` from `GET /freight/records` (Mongo id of selected `FreightBid`).

### 2.1 Detail (eye icon / modal)

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

### 2.2 Approve invoice (purple button)

```http
PATCH /api/account/costs/freight/64freightbid001/approve
Authorization: Bearer <token>
Content-Type: application/json
```

**Body (optional):** `{ "reviewNotes": "Approved for payment" }`

**Response `200`:** Updated detail; `invoiceStatus` → `"Approved"`, carrier `paymentStatus` → `"Invoiced"`, `actions.canApprove` / `canReject` → `false`.

**Alias:** `PATCH /api/account/costs/freight/records/:bidId/approve`

### 2.3 Reject invoice (grey button)

```http
PATCH /api/account/costs/freight/64freightbid001/reject
Authorization: Bearer <token>
Content-Type: application/json
```

**Body (optional):** `{ "reviewNotes": "Amount mismatch" }`

**Response `200`:** Updated detail; `paymentStatus` → `"Rejected"`.

**Alias:** `PATCH /api/account/costs/freight/records/:bidId/reject`

### 2.4 Mark paid (green button)

```http
PATCH /api/account/costs/freight/64freightbid001/mark-paid
Authorization: Bearer <token>
```

**Response `200`:** Updated detail; `paymentStatus` → `"Paid"`. Auto-approves if still under review (except when rejected).

**Alias:** `PATCH /api/account/costs/freight/records/:bidId/mark-paid`

### 2.5 Download invoice

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

## 3. Logistics — Detail modal & Mark Paid

**List row id:** `rows[].id` or `approvalId` (`PaymentApproval` `_id`).

### 3.1 Detail

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
    "loadId": "PR-2026-00042",
    "deliveryId": "DEL-1235",
    "deliveryMongoId": "64del...",
    "totalLogisticsCost": 4500,
    "totalLogisticsCostFormatted": 4500,
    "invoiceStatus": "Under Review",
    "paymentStatus": "Pending",
    "projectInformation": {
      "projectName": "ABC Logistics Warehouse",
      "leadId": "64lead...",
      "deliveryDate": "2026-03-25T00:00:00.000Z",
      "deliveryId": "DEL-1001"
    },
    "carrierInformation": {
      "carrier": "FastFreight Logistics",
      "logisticCost": 4500,
      "paymentStatus": "Pending"
    },
    "deliveryLink": {
      "deliveryStatus": "delivered",
      "documents": []
    },
    "invoiceDetails": {
      "invoiceNumber": "INV-45892",
      "invoiceDate": "2026-03-20T00:00:00.000Z",
      "paymentDueDate": "2026-04-01T00:00:00.000Z",
      "invoiceStatus": "Under Review",
      "amount": 4500,
      "downloadUrl": ""
    },
    "actions": {
      "canApprove": true,
      "canReject": true,
      "canMarkPaid": false,
      "canDownloadInvoice": false
    },
    "approvalStatus": "Pending"
  }
}
```

**Aliases:** `GET /logistics/records/:id/detail`

### 3.2 Approve / Reject / Mark paid / Download

Same pattern as freight (`:id` = approval id):

| Button | Method | Path |
|--------|--------|------|
| Approve | `PATCH` | `/api/account/costs/logistics/:id/approve` |
| Reject | `PATCH` | `/api/account/costs/logistics/:id/reject` |
| Mark paid | `PATCH` | `/api/account/costs/logistics/:id/mark-paid` |
| Download invoice | `GET` | `/api/account/costs/logistics/:id/invoice-download` |

Optional body on approve/reject: `{ "reviewNotes": "..." }`.

---

## 4. Rent — Mark Paid

**List row id:** `rows[].id` (Expense `_id`).

```http
PATCH /api/account/costs/rent/6ad252efd3c19e0410fa13d2/mark-paid
Authorization: Bearer <token>
```

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
    "leaseEnd": null,
    "daysRemaining": null,
    "status": "Paid",
    "paymentStatus": "paid",
    "project": ""
  }
}
```

**Alias:** `PATCH /api/account/costs/rent/records/:id/mark-paid`

---

## 5. Frontend wiring

| Screen | Control | Method | Path |
|--------|---------|--------|------|
| Manpower | Mark Paid | `PATCH` | `/costs/manpower/:id/mark-paid` |
| Freight | Open modal | `GET` | `/costs/freight/:bidId/detail` |
| Freight | Approve | `PATCH` | `/costs/freight/:bidId/approve` |
| Freight | Reject | `PATCH` | `/costs/freight/:bidId/reject` |
| Freight | Mark Paid | `PATCH` | `/costs/freight/:bidId/mark-paid` |
| Freight | Download invoice | `GET` | `/costs/freight/:bidId/invoice-download` |
| Logistics | Open modal | `GET` | `/costs/logistics/:id/detail` |
| Logistics | Approve / Reject / Mark paid / Download | `PATCH` / `GET` | `/costs/logistics/:id/approve`, `/reject`, `/mark-paid`, `/invoice-download` |
| Rent | Mark Paid | `PATCH` | `/costs/rent/:id/mark-paid` |

After mark-paid, refresh the list row or merge `data` into local state.

**List fields added**

- Freight / logistics rows: `paymentStatus` (`Paid` / `Unpaid`)
- Logistics: `approvalId` (same as `id`)
- Rent rows: richer `status`, `paymentStatus`, optional metadata fields when present on create

---

## 6. Errors

| HTTP | Body |
|------|------|
| `404` | `{ "success": false, "message": "... not found" }` |
| `401` | Unauthorized |

---

## 7. Backend files (this release)

- `src/services/accountCostsActions.service.js`
- `src/services/accountCostsPanel.service.js` (rent row + list tweaks, manpower/rent getters)
- `src/controllers/account/costs.controller.js`
- `src/routes/account/costs.routes.js`

Related (already live): salary mark-paid / payslip — see `frontend-account-salary-payslip-api-handoff-2026-10-19.md`.
