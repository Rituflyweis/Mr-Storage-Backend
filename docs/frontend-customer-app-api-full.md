# Customer app — full API reference

**Production base:** `https://mr-storage-backend-025k.onrender.com/api`  
**Postman:** `customer-app.postman_collection.json` (saved example responses per route)  
**Supplementary notes:** `docs/customer-panel-api-notes-jul-2026.md`

---

## Conventions

### Response envelope

All JSON responses use:

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Errors: `{ "success": false, "message": "Human-readable error" }` with HTTP `4xx` / `5xx`.

### Auth

| Area | Header |
|------|--------|
| **Portal** (`/api/customer/*` except noted) | `Authorization: Bearer <accessToken>` |
| **Auth login / refresh / forgot** | No token |

JWT payload includes `type: "customer"` and customer `_id`.

### Portal login gate

`POST /api/customer/auth/login` returns **403** until:

1. At least one project has **`isRaisedToPO === true`**, and  
2. Customer has a **paid invoice ≥ ~30%** of project quote value.

### IDs

- **`leadId`** = project Mongo `_id` (same as staff “lead”).
- **`jobId`** = display project code (e.g. `PRO-023`, `2026001`).

---

# Part 1 — Authentication (`/api/customer/auth`)

No Bearer token unless noted.

## 1.1 Login

```http
POST /api/customer/auth/login
Content-Type: application/json
```

**Request**

```json
{
  "email": "customer1@example.com",
  "password": "Test@1234"
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "customer": {
      "_id": "507f1f77bcf86cd799439011",
      "firstName": "John",
      "email": "customer1@example.com",
      "customerId": "CUST-001",
      "photo": null
    }
  }
}
```

**Response `403` (portal not active)**

```json
{
  "success": false,
  "message": "Your project portal is not yet active. It will be available after your 30% deposit is confirmed."
}
```

---

## 1.2 Refresh access token

```http
POST /api/customer/auth/refresh
Content-Type: application/json
```

**Request**

```json
{
  "refreshToken": "<refreshToken from login>"
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

## 1.3 Change password (logged in)

```http
PUT /api/customer/auth/change-password
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request**

```json
{
  "currentPassword": "Test@1234",
  "newPassword": "NewSecurePass1"
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Password updated successfully",
  "data": {}
}
```

---

## 1.4 Forgot password → OTP → reset

**Step A — request OTP**

```http
POST /api/customer/auth/forgot-password
Content-Type: application/json
```

```json
{ "email": "customer1@example.com" }
```

```json
{
  "success": true,
  "message": "If that email exists, an OTP has been sent",
  "data": { "sent": true, "warning": null }
}
```

**Step B — verify OTP**

```http
POST /api/customer/auth/verify-otp
Content-Type: application/json
```

```json
{
  "email": "customer1@example.com",
  "otp": "123456"
}
```

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "resetToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Step C — set new password**

```http
POST /api/customer/auth/reset-password
Content-Type: application/json
```

```json
{
  "resetToken": "<from verify-otp>",
  "newPassword": "NewSecurePass1"
}
```

```json
{
  "success": true,
  "message": "Password reset successfully",
  "data": {}
}
```

---

# Part 2 — Portal (`/api/customer`)

All routes below require **`Authorization: Bearer <accessToken>`**.

---

## 2.1 Upload (S3 presign)

```http
POST /api/customer/upload/presigned-url
Content-Type: application/json
```

**Request**

```json
{
  "fileName": "payment-proof.pdf",
  "fileType": "application/pdf",
  "folder": "documents"
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "uploadUrl": "https://bucket.s3.region.amazonaws.com/...",
    "fileUrl": "https://bucket.s3.region.amazonaws.com/documents/uuid.pdf",
    "key": "documents/uuid.pdf"
  }
}
```

Upload file with `PUT` to `uploadUrl`, then send `fileUrl` in payment-proof or chat attachments as required.

---

## 2.2 Profile

| Method | Path | Description |
|--------|------|-------------|
| GET | `/profile` | Current customer profile |
| PUT | `/profile` | Update name, email, phone, photo |

**GET `/profile` — response `data`**

```json
{
  "profile": {
    "_id": "507f1f77bcf86cd799439011",
    "customerId": "CUST-001",
    "name": "John Smith",
    "firstName": "John",
    "lastName": "Smith",
    "email": "customer1@example.com",
    "phone": { "number": "5551234567", "countryCode": "+1" },
    "mobile": "",
    "photo": null,
    "company": "",
    "location": "",
    "isActive": true,
    "source": "chat",
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-06-01T12:00:00.000Z"
  },
  "customer": { }
}
```

(`customer` duplicates `profile`.)

**PUT `/profile` — request (any optional fields)**

```json
{
  "firstName": "John",
  "lastName": "Smith",
  "email": "john@example.com",
  "phone": "5551234567",
  "countryCode": "+1",
  "photo": "https://cdn.example.com/avatar.jpg"
}
```

---

## 2.3 Dashboard

```http
GET /api/customer/dashboard
```

**Response `data` (abbreviated)**

```json
{
  "activeProjects": 2,
  "closedProjects": 1,
  "drawingsAndApprovals": 12,
  "drawingsApprovalsBreakdown": {
    "pendingReview": 3,
    "pendingReviewSubtitle": "Building A",
    "approved": 8,
    "revisionReceived": 1,
    "itemsNeedingClarification": 0
  },
  "activeProjectOverview": {
    "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
    "projectName": "warehouse - Texas",
    "projectCode": "PRO-001",
    "siteLocation": "Austin, TX",
    "image": null,
    "progressPct": 45,
    "currentStage": "Frame Assembly",
    "nextMilestone": { "title": "Steel delivery", "targetDate": "2026-08-01T00:00:00.000Z" },
    "projectManager": { "name": "Sarah Lee", "phone": "+15551234567" }
  },
  "projectTimeline": 14,
  "totalProjectValue": 250000,
  "totalPaid": 75000,
  "totalPending": 25000,
  "upcomingInvoice": {
    "invoiceNumber": "INV-2026-0042",
    "totalAmount": 12500,
    "dueDate": "2026-07-15T00:00:00.000Z",
    "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
    "buildingType": "Warehouse",
    "location": "Austin, TX"
  },
  "deliveryTracking": {
    "inTransit": 1,
    "staged": 0,
    "ready": 2,
    "totalToday": 0,
    "upcomingDeliveries": 3,
    "deliveriesThisWeek": 1,
    "delayedDeliveries": 0,
    "rescheduledDeliveries": 0
  },
  "shipmentBreakdown": { "totalLoads": 4, "totalBundles": 18 },
  "ordersList": [],
  "notificationsFeed": [],
  "recentMessages": [],
  "nextDelivery": null
}
```

---

## 2.4 Projects

### List projects

```http
GET /api/customer/projects?tab=confirmed&search=&page=1&limit=20
```

| Query | Values |
|-------|--------|
| `tab` | `proposed` (no PO) · `confirmed` (PO raised) |
| `lifecycleStatus` | Any lead lifecycle stage |
| `search` | Project name or `jobId` |
| `page`, `limit` | Pagination |

**Response `data`**

```json
{
  "stats": {
    "total": 3,
    "active": 2,
    "workInProgress": 1,
    "cancelled": 0,
    "proposed": 1,
    "confirmed": 2
  },
  "projects": [
    {
      "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
      "jobId": "PRO-001",
      "projectName": "warehouse - Texas",
      "businessUnit": { "key": "storage_materials", "label": "Storage Materials" },
      "buildingType": "Warehouse",
      "location": "Austin, TX",
      "lifecycleStatus": "fabrication_started",
      "quoteValue": 250000,
      "isQuoteReady": true,
      "isRaisedToPO": true,
      "source": "customer_portal",
      "progressPct": 45,
      "manager": { "name": "Sarah Lee", "email": "sarah@example.com" },
      "plannedStartDate": "2026-05-01T00:00:00.000Z",
      "endDate": "2026-12-01T00:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### Create project (enquiry form)

```http
POST /api/customer/projects
Content-Type: application/json
```

**Request**

```json
{
  "projectName": "New Warehouse Phase 2",
  "buildingType": "Warehouse",
  "expectedStartDate": "2026-09-01",
  "targetCompletionDate": "2027-03-01",
  "fullAddress": "123 Industrial Blvd",
  "city": "Dallas",
  "state": "TX",
  "pincode": "75201",
  "width": 60,
  "length": 120,
  "height": 18,
  "doors": 2,
  "windows": 4,
  "insulation": 1,
  "description": "Second building on same site"
}
```

**Response `201`**

```json
{
  "success": true,
  "message": "Project created",
  "data": {
    "lead": {
      "_id": "68f1a2b3c4d5e6f7a8b9c0d2",
      "jobId": "2026042",
      "projectName": "New Warehouse Phase 2",
      "lifecycleStatus": "initial_contact",
      "source": "customer_portal"
    }
  }
}
```

### Project detail

```http
GET /api/customer/projects/:leadId
```

**Response `data` (structure)**

```json
{
  "lead": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
    "jobId": "PRO-001",
    "projectName": "warehouse - Texas",
    "buildingType": "Warehouse",
    "location": "Austin, TX",
    "lifecycleStatus": "fabrication_started",
    "quoteValue": 250000,
    "buildingsCount": 4,
    "isRaisedToPO": true,
    "poNumber": "PO-1001"
  },
  "projectSteps": {
    "steps": [
      {
        "key": "initial_contact",
        "label": "Initial Contact",
        "status": "completed",
        "date": "2026-01-10T00:00:00.000Z",
        "completionPct": 100,
        "currentStage": "",
        "notes": "",
        "attachments": []
      }
    ],
    "currentStepNumber": 12,
    "totalSteps": 21,
    "currentStepLabel": "Fabrication Started",
    "overallProgressPct": 57
  },
  "orders": {
    "recent": [],
    "counts": { "newOrders": 1, "pending": 2, "completed": 1 }
  },
  "quotation": null,
  "quoteSummary": null,
  "invoices": [],
  "paymentSchedule": {
    "totalAmount": 250000,
    "payments": [
      {
        "_id": "…",
        "name": "Deposit 30%",
        "amount": 75000,
        "amountType": "fixed",
        "dueDate": "2026-02-01T00:00:00.000Z",
        "status": "paid",
        "invoiceId": "…",
        "paidAt": "2026-02-05T00:00:00.000Z"
      }
    ]
  },
  "navigation": {
    "previous": { "_id": "…", "jobId": "PRO-002", "projectName": "…" },
    "next": null
  }
}
```

> **Note:** `projectSteps` uses **21 granular lifecycle stages** (sales + plant), not a 5-step bucket.

### Other project routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/projects/:leadId/stats` | KPIs + `projectSteps` |
| GET | `/projects/:leadId/tracking` | Tracking tab: steps, tasks, milestones, timeline |
| GET | `/projects/:leadId/rfq` | RFQ / requirements |
| PUT | `/projects/:leadId/rfq` | Update RFQ fields |
| GET | `/projects/:leadId/quotation` | Building quotation tab — **sales generator preview** (see below) |
| GET | `/projects/:leadId/quotation/preview` | Assembled HTML (`?format=html`, optional `?sections=quote,sow,contract,drawings`) |
| GET | `/projects/:leadId/quotation/pdf` | Same document as PDF |
| POST | `/projects/:leadId/quotation/approve` | Approve quotation |
| POST | `/projects/:leadId/quotation/reject` | Reject with reason |

### Building quotation tab (`GET …/quotation`)

Uses the **same assembled document** as the sales panel quoting generator (`EstimateQuote` → `Quotation` with `sourceEstimateId`, sent via `POST /api/quotations/:id/send`).

**`availability`:**

| Value | UI |
|--------|-----|
| `ready` | Show preview; use `preview.htmlUrl` in WebView or `iframe` with customer Bearer token |
| `pending` | Quote exists but not sent yet — show waiting message (`message` field) |
| `none` | 404 — no quotation on project |

**Example `ready` (abbreviated):**

```json
{
  "success": true,
  "data": {
    "availability": "ready",
    "quotation": {
      "_id": "…",
      "quoteNumber": "QT-2026-0042",
      "status": "sent",
      "sourceEstimate": { "_id": "…", "grandTotal": 125000, "squareFootage": 5000 },
      "assignedSalesperson": { "name": "Jane Sales", "email": "jane@…" }
    },
    "quoteSummary": { "summary": "AI plain-text summary…", "generatedAt": "…" },
    "documentMeta": {
      "source": "estimate",
      "hasPricingData": true,
      "htmlPreviewLink": "/api/customer/projects/6ac4…/quotation/preview?format=html",
      "pdfLink": "/api/customer/projects/6ac4…/quotation/pdf"
    },
    "preview": {
      "htmlUrl": "/api/customer/projects/6ac4…/quotation/preview?format=html",
      "pdfUrl": "/api/customer/projects/6ac4…/quotation/pdf",
      "defaultSections": ["quote", "sow", "contract", "drawings"],
      "useGeneratorPreview": true
    }
  }
}
```

**Preview:** `GET {baseUrl}{preview.htmlUrl}` with `Authorization: Bearer <customerToken>`. Returns full HTML including styles (same as sales `GET /api/quotations/:id/pdf?format=html`).

Styles-only handoff if FE renders fragments: [`docs/quotation-preview-stylesheet-for-frontend.md`](./quotation-preview-stylesheet-for-frontend.md).
| GET | `/projects/:leadId/payments/summary` | Payment summary for project |
| POST | `/projects/:leadId/cancel` | `{ "reason": "…" }` |
| GET | `/projects/:leadId/drawings` | Flat drawings list |
| GET | `/projects/:leadId/buildings` | Buildings with doc counts |
| GET | `/projects/:leadId/buildings/:buildingLabel` | Drawings + documents split |
| POST | `/projects/:leadId/drawings/:docId/approve` | Approve drawing |
| POST | `/projects/:leadId/drawings/:docId/request-revision` | Request revision |
| POST | `/projects/:leadId/drawings/:docId/comments` | `{ "text": "…" }` |
| GET | `/projects/:leadId/activity` | Audit activity feed |
| GET | `/projects/:leadId/notes` | Staff notes (customer-safe) |
| GET | `/projects/:leadId/followups` | Follow-ups |
| GET | `/projects/:leadId/meetings` | Meetings |
| GET | `/projects/:leadId/orders` | Material orders list |
| POST | `/projects/:leadId/orders` | Create material order |
| GET | `/projects/:leadId/orders/:orderId` | Order detail |
| POST | `/projects/:leadId/orders/:orderId/cancel` | Cancel order |
| GET | `/projects/:leadId/order-quotations` | Order quotations for project |

**POST `/projects/:leadId/orders` — example request**

```json
{
  "requestedItems": [
    {
      "coilType": "26GA",
      "color": "Galvalume",
      "lengthFeet": 20,
      "quantity": 10
    }
  ],
  "notes": "Rush if possible"
}
```

---

## 2.5 Drawings (cross-project)

```http
GET /api/customer/drawings
```

**Response `data`**

```json
{
  "projects": [
    {
      "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
      "projectName": "warehouse - Texas",
      "jobId": "PRO-001",
      "location": "Austin, TX",
      "numberOfBuildings": 4,
      "totalDrawings": 24,
      "lastUpdate": "2026-06-20T14:00:00.000Z"
    }
  ]
}
```

---

## 2.6 Documents

```http
GET /api/customer/documents?leadId=&type=
```

Returns customer-visible documents across projects (quotations, invoices, drawings metadata, etc.) — see Postman for full row shape.

---

## 2.7 Payments & invoices

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/payments/stats` | Aggregate payment stats |
| GET | `/payments/invoice-stats` | Invoice KPIs |
| GET | `/payments` | Payment history list |
| GET | `/payments/invoices` | Invoice list |
| GET | `/payments/invoices/:invoiceId` | Invoice detail |
| POST | `/payments/invoices/:invoiceId/payment-proof` | Submit proof of payment |
| GET | `/payments/tax-report` | Tax report data |

**GET `/payments/invoices` — query:** `leadId`, `status`, `page`, `limit`

**POST payment proof — request**

```json
{
  "amount": 12500,
  "paidAt": "2026-07-01",
  "reference": "Wire ref 998877",
  "proofUrl": "https://bucket.s3.../proof.pdf",
  "notes": "Paid from business account"
}
```

---

## 2.8 Deliveries

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/deliveries` | Schedule list |
| GET | `/deliveries/summary` | Summary counts |
| GET | `/deliveries/:id` | Detail **or** schedule row (smart dispatch) |
| GET | `/deliveries/:deliveryId/calendar` | ICS-related calendar meta |
| GET | `/deliveries/:deliveryId/calendar/details` | Calendar event details |
| GET | `/deliveries/:deliveryId/download` | Delivery info PDF |
| GET | `/deliveries/:deliveryId/download/packing-list` | Packing list PDF |
| GET | `/deliveries/:deliveryId/download/instructions` | Instructions PDF |
| POST | `/deliveries/:deliveryId/contact-driver` | Email driver |
| POST | `/deliveries/:deliveryId/contact-driver/sms` | SMS driver |
| POST | `/deliveries/:deliveryId/contact-company` | Email carrier |
| POST | `/deliveries/:deliveryId/contact-company/sms` | SMS carrier |
| POST | `/deliveries/:deliveryId/confirmation-email` | Send confirmation |
| POST | `/deliveries/:deliveryId/request-callback` | Request callback |
| POST | `/deliveries/:deliveryId/acknowledge-reschedule` | Ack reschedule |
| GET | `/deliveries/:deliveryId/documents` | Related documents |
| POST | `/deliveries/:deliveryId/confirm-site-ready` | Site ready |
| POST | `/deliveries/:deliveryId/confirm-equipment` | Equipment confirmed |

**GET `/deliveries` — response row (typical)**

```json
{
  "deliveries": [
    {
      "deliveryId": "68f…",
      "deliveryNumber": "DEL-2026-0012",
      "status": "in_transit",
      "deliveryDate": "2026-07-20T00:00:00.000Z",
      "project": {
        "leadId": "68f1…",
        "projectName": "warehouse - Texas",
        "jobId": "PRO-001"
      },
      "carrier": { "name": "ABC Freight", "phone": "+1…" },
      "loadWeight": 42000,
      "description": "Primary frame steel"
    }
  ],
  "total": 1
}
```

---

## 2.9 Material orders & order quotations

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/material-orders/summary` | Dashboard-style order counts |
| GET | `/quotations/summary` | Order quotation summary (coil orders — **not** building RFQ) |
| GET | `/order-quotations/:quotationId` | Order quotation detail |
| POST | `/order-quotations/:quotationId/approve` | Approve |
| POST | `/order-quotations/:quotationId/reject` | `{ "reason": "…" }` |

---

## 2.10 Bundle scan (QR)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/bundles/scan` | `{ "bundleId": "PRO-001-BND-001" \| ObjectId, "project": "PRO-001" }` |
| GET | `/bundles/:bundleId` | Bundle detail |
| POST | `/bundles/:bundleId/report-issue` | Report issue |
| POST | `/bundles/:bundleId/contact-support` | Contact support |
| GET | `/bundles/:bundleId/download` | Contents PDF |
| GET | `/bundles/:bundleId/download/packing-list` | Packing list PDF |

**POST `/bundles/scan` — response (example)**

```json
{
  "success": true,
  "data": {
    "bundleId": "68f…",
    "bundleNo": "PRO-001-BND-001",
    "bundleType": "panels",
    "title": "Wall panels batch 1",
    "totalWeight": 4200,
    "status": "assigned_to_truck",
    "items": []
  }
}
```

---

## 2.11 Chat

Channels: **`project`** · **`finance`** · **`construction`**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/chat/presence` | Online presence |
| GET | `/chat/channels?leadId=` | Available channels for project |
| GET | `/chat/:channel/messages?leadId=&page=&limit=` | Message history |
| POST | `/chat/:channel/messages` | Send message |

**POST message — request**

```json
{
  "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
  "content": "When is the next delivery window?"
}
```

**GET messages — response (example)**

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "_id": "68f…",
        "channel": "project",
        "content": "Your drawings were approved.",
        "senderType": "staff",
        "senderName": "Sarah Lee",
        "createdAt": "2026-06-18T09:00:00.000Z"
      }
    ],
    "total": 15,
    "page": 1,
    "limit": 50
  }
}
```

---

## 2.12 Notifications

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/notifications?filter=all\|unread\|drawings\|finance\|meetings` | List |
| GET | `/notifications/unread-count` | Badge count |
| PUT | `/notifications/read-all` | Mark all read |
| PUT | `/notifications/:id/read` | Mark one read |

**GET `/notifications` — row example**

```json
{
  "notifications": [
    {
      "_id": "68f…",
      "title": "Drawing approved",
      "body": "Structural drawing for Building A was approved.",
      "type": "drawing",
      "read": false,
      "leadId": "68f1…",
      "createdAt": "2026-06-20T10:00:00.000Z"
    }
  ],
  "total": 4
}
```

---

# Part 3 — Error codes (common)

| HTTP | Meaning |
|------|---------|
| 400 | Validation / bad body |
| 401 | Missing or invalid token |
| 403 | Portal inactive or project not owned by customer |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate email on profile update) |

---

# Part 4 — Testing

- Import **`customer-app.postman_collection.json`** + **`customer-app.postman_environment.json`**.
- Set `baseUrl` to `https://mr-storage-backend-025k.onrender.com/api`.
- Run **Login**; collection scripts store `customerToken`.
- Seed / activate portal: `node scripts/activateCustomer1.js` (local against your DB).

---

# Part 5 — Endpoint index (quick lookup)

### Auth
`POST /customer/auth/login` · `refresh` · `forgot-password` · `verify-otp` · `reset-password` · `PUT change-password`

### Portal
`POST upload/presigned-url` · `GET|PUT profile` · `GET dashboard`  
`GET|POST projects` · `GET projects/:leadId` (+ all `:leadId/*` sub-routes in §2.4)  
`GET drawings` · `GET documents`  
`GET payments/*` · `GET deliveries/*` · `POST deliveries/:id/*`  
`GET material-orders/summary` · `GET quotations/summary` · `GET|POST order-quotations/:id/*`  
`POST|GET bundles/*`  
`GET|POST chat/*` · `GET|PUT notifications/*`

All paths are prefixed with **`/api/customer`** (auth under **`/api/customer/auth`**).
