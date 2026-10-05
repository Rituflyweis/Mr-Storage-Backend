# Account panel — Payments (Figma)

Auth: **`Authorization: Bearer <token>`** — roles **`account`** or **`admin`**.  
Envelope: `{ "success", "message", "data" }`.

---

## A. All Payments (Payment Overview)

Base: **`/api/account/payments`**

### A1. Stats (top 4 cards)

```http
GET /api/account/payments/stats?period=month HTTP/1.1
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalOrderValue": 1230000,
    "totalReceived": 845000,
    "outstanding": 385000,
    "totalWipProfit": 233000
  }
}
```

Alias: `GET /api/account/payments/overview` returns the same totals under `data.summary` plus the flat fields.

Date filters: `period=today|week|month` or `startDate` / `endDate` (filters WIP records by `createdAt`).

---

### A2. Orders & payment summary (list)

```http
GET /api/account/payments/orders?search=john&status=In%20progress&page=1&limit=20 HTTP/1.1
Authorization: Bearer <token>
```

| Query | Description |
|--------|-------------|
| `search` | Customer name, email, project name, job/quote id, location |
| `status` | `all`, `in_progress`, `started`, `completed`, or labels `In progress`, `Started`, `Completed` |
| `period` / dates | Same as stats |

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalOrderValue": 1230000,
      "totalReceived": 845000,
      "outstanding": 385000,
      "totalWipProfit": 233000
    },
    "orders": [
      {
        "wipId": "67a1b2c3d4e5f6789012345a",
        "leadId": "67a1b2c3d4e5f6789012345b",
        "orderDetails": {
          "customerName": "John Doe",
          "orderId": "Q-2025-1047",
          "quoteOrderId": "Q-2025-1047",
          "location": "Workshop, Texas"
        },
        "orderValue": 450000,
        "currentCost": 361000,
        "paymentBreakdown": {
          "deposit": 135000,
          "progress": 135000,
          "final": 0
        },
        "outstanding": 135000,
        "profit": 89000,
        "marginPct": 19.8,
        "status": "In progress",
        "statusCode": "in_progress",
        "totalReceived": 270000
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

Export WIP Excel (existing): `GET /api/account/financial-extra/wip-profits/export`

Create WIP via list API: `POST /api/account/payments/orders` (see A4).

---

### A3. Order detail / view modal

```http
GET /api/account/payments/orders/67a1b2c3d4e5f6789012345a HTTP/1.1
Authorization: Bearer <token>
```

Accepts **WIP `_id`**, **lead `_id`**, or **job id** (`Q-2025-1047`).

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "wipId": "67a1b2c3d4e5f6789012345a",
    "leadId": "67a1b2c3d4e5f6789012345b",
    "orderDetails": { "customerName": "John Doe", "orderId": "QUO-990-009", "quoteOrderId": "QUO-990-009", "location": "Workshop, Texas" },
    "orderValue": 450000,
    "currentCost": 361000,
    "paymentBreakdown": { "deposit": 46013.25, "progress": 46013.25, "final": 0 },
    "outstanding": 0,
    "profit": 23900,
    "marginPct": 5.3,
    "status": "In progress",
    "statusCode": "in_progress",
    "totalReceived": 92026.5,
    "profile": {
      "quoteId": "QUO-990-009",
      "quoteOrderId": "QUO-990-009",
      "customerName": "John Doe",
      "orderValue": 450000,
      "projectName": "ABC Building",
      "location": "Workshop, Texas"
    },
    "financials": {
      "deposit": 46013.25,
      "progress": 46013.25,
      "final": 0,
      "profit": 23900,
      "outstanding": 0,
      "totalPayable": 0,
      "totalReceived": 92026.5,
      "marginPct": 5.3
    },
    "paymentStatus": "In progress",
    "paymentStatusCode": "in_progress",
    "notes": "",
    "payments": [],
    "updatedAt": "2025-03-28T10:00:00.000Z",
    "createdAt": "2025-01-10T08:00:00.000Z"
  }
}
```

---

### A4. Add / update payment (form)

**Create** (Add Order Payment):

```http
POST /api/account/payments/orders HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{
  "quoteOrderId": "Q-2025-1047",
  "orderValue": 450900,
  "currentCost": 361000,
  "depositPaid": 135000,
  "progressPaid": 135000,
  "finalPaid": 135000,
  "status": "in_progress",
  "notes": ""
}
```

**Update** (Update Payment screen):

```http
PUT /api/account/payments/orders/Q-2025-1047 HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderValue": 450900,
  "depositPaid": 135000,
  "progressPaid": 135000,
  "finalPaid": 135000,
  "status": "in_progress"
}
```

`profit`, `marginPct`, and `outstanding` are **recalculated server-side**:

- `totalReceived = deposit + progress + final`
- `outstanding = orderValue - totalReceived`
- `wipProfit = totalReceived - currentCost`
- `marginPct = (wipProfit / orderValue) × 100`

`status` enum: `in_progress` | `started` | `completed` | `on_hold`.

If `currentCost` is omitted on create, server sums active **expenses** on the project.

---

## B. Payment Approvals

Base: **`/api/account/financial/payment-approvals`**

### B1. Stats

```http
GET /api/account/financial/payment-approvals/stats HTTP/1.1
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "pendingApproval": 2,
    "underReview": 2,
    "approved": 1,
    "disputed": 1
  }
}
```

---

### B2. Approval queue (list)

```http
GET /api/account/financial/payment-approvals?search=FastTruck&status=pending&payeeType=carrier&project=67a1...&startDate=2024-04-01&endDate=2024-04-30&page=1&limit=20 HTTP/1.1
Authorization: Bearer <token>
```

| Query | Description |
|--------|-------------|
| `search` | Company, invoice #, payment id, project name |
| `status` | `pending`, `under_review`, `approved`, `disputed`, `rejected` |
| `payeeType` / `paymentStatus` | `carrier`, `vendor`, `delivery_company`, … |
| `project` | Lead `_id` |
| `startDate` / `endDate` | Filter on **due date** |

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "pendingApproval": 2,
      "underReview": 2,
      "approved": 1,
      "disputed": 1
    },
    "approvals": [
      {
        "approvalId": "67a1b2c3d4e5f6789012345c",
        "invoiceType": "Carrier",
        "invoiceTypeCode": "carrier",
        "companyName": "FastTruck Logistics",
        "invoiceNumber": "INV-2024-0345",
        "project": { "leadId": "67a1...", "projectName": "Downtown Plaza", "jobId": "2025003" },
        "amount": 4500,
        "dueDate": "2024-04-15T00:00:00.000Z",
        "linkedTo": "Load: LD-0789",
        "linkedType": "freight_bid",
        "linkedId": "67a1...",
        "status": "pending",
        "statusLabel": "Pending",
        "category": "vendor_payment"
      }
    ],
    "total": 6,
    "page": 1,
    "limit": 20
  }
}
```

---

### B3. Payment details modal

```http
GET /api/account/financial/payment-approvals/67a1b2c3d4e5f6789012345c HTTP/1.1
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "approvalId": "67a1b2c3d4e5f6789012345c",
    "status": "pending",
    "statusLabel": "pending",
    "invoiceNumber": "INV-2024-0345",
    "invoiceType": "Carrier",
    "invoiceTypeCode": "carrier",
    "companyName": "FastTruck Logistics",
    "invoiceDetails": {
      "invoiceAmount": 4500,
      "status": "Pending Approval",
      "paymentDueDate": "2026-04-01T00:00:00.000Z",
      "paymentPriority": "medium"
    },
    "companyInformation": {
      "companyName": "FastTruck Logistics",
      "deliveryDate": "2026-03-25T00:00:00.000Z",
      "deliveryId": "DEL-1001"
    },
    "costBreakdown": {
      "baseFreight": 4005,
      "fuelSurcharge": 315,
      "handlingFee": 180,
      "total": 4500
    },
    "linkedTransaction": {
      "freightRequestId": "PAY-2024-001",
      "loadId": "LD-09876",
      "projectName": "Downtown Plaza",
      "linkedDeliveryId": "67a1...",
      "linkedDeliveryNumber": "DEL-9876",
      "route": "Austin → Houston"
    },
    "project": { "leadId": "67a1...", "projectName": "Downtown Plaza", "jobId": "2025003", "location": "TX" },
    "amount": 4500,
    "dueDate": "2026-04-01T00:00:00.000Z",
    "category": "vendor_payment",
    "notes": ""
  }
}
```

`costBreakdown` is derived from invoice amount when line items are not stored on `PaymentApproval`.

---

### B4. Review workflow

```http
PUT /api/account/financial/payment-approvals/:approvalId/review HTTP/1.1
Content-Type: application/json

{ "action": "under_review", "reviewNotes": "Checking freight docs" }
```

`action`: `under_review` | `approved` | `disputed` | `rejected`.

---

## FE routing map

| Figma screen | API |
|--------------|-----|
| Payment Overview cards | `GET /api/account/payments/stats` |
| Orders table | `GET /api/account/payments/orders` |
| View order modal | `GET /api/account/payments/orders/:id` |
| Update payment form | `PUT /api/account/payments/orders/:id` |
| Add order payment | `POST /api/account/payments/orders` |
| Approval stats | `GET /api/account/financial/payment-approvals/stats` or list `data.stats` |
| Approval table | `GET /api/account/financial/payment-approvals` |
| Payment details modal | `GET /api/account/financial/payment-approvals/:approvalId` |
