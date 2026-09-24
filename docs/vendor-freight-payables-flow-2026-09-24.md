# Vendor & freight payables — frontend guide

**Date:** 2026-09-24  
**Audience:** Frontend (plant, admin, account, public acceptance-upload page)  
**UAT base:** `https://mr-storage-backend-025k.onrender.com`

This doc covers the **whole AP (accounts payable) flow**: how a vendor/carrier gets a link, where the upload **token** comes from, how they upload an invoice PDF **without login**, then how admin / account / plant panels consume the invoice.

---

## 0. Quick map — who does what

| Actor | Auth | What they do |
|--------|------|----------------|
| **Plant** | JWT (`plant` or admin plant) | Approves vendor quote / awards freight bid → **creates upload token + emails link**. Later: **read-only** invoice list + stats. |
| **Vendor / carrier** | **No JWT** | Opens email link → public page with `:token` → upload PDF → submit amount. |
| **Admin** | JWT (`admin`) | Optional **manual** upload; **approve / reject** queue; comments; vendor/freight invoice lists. |
| **Account** | JWT (`account` or `admin`) | Payment queue → **mark paid / unpaid**; comments. |

```text
Plant approve/award ──email──► Vendor/Carrier public page (token)
                                      │
                                      ▼
                              Invoice (pending_admin_approval)
                                      │
                         Admin approve / reject
                                      │
                         Account mark paid / unpaid
```

---

## 1. Important: two different tokens (do not mix them)

Vendors and carriers already have **quote / bid** public pages. Payable invoice upload is a **separate** token and URL.

| Purpose | When created | Stored on | Email / FE path | Public API |
|---------|--------------|-----------|-----------------|------------|
| **Shipper quote upload** | Plant sends BOM to vendor | `ShipperRequest.token` | `{CLIENT_URL}/vendor-upload/{token}` (existing) | `/api/public/vendor-upload/:token` |
| **Freight bid submit** | Plant invites carriers | `FreightBid.token` | freight bid public page | `/api/public/freight-bids/:token` |
| **Payable invoice upload** | Plant **approves** shipper **or** **selects** freight bid | `ShipperRequest.payableUploadToken` **or** `FreightBid.payableUploadToken` | `{CLIENT_URL}/payable-invoice-upload/{token}` | `/api/public/payable-invoice-upload/:token` |

**Frontend rule**

- Route: **`/payable-invoice-upload/:token`** (public, no login).
- Read `token` from the URL path only.
- Call **`/api/public/payable-invoice-upload/...`** with that token.
- Do **not** call `vendor-upload` or `freight-bids` with this token — those use different tokens.

Backend resolves the payable token by looking up:

1. `ShipperRequest` where `payableUploadToken === token` → **vendor** invoice, or  
2. `FreightBid` where `payableUploadToken === token` → **freight** invoice.

---

## 2. Where does the payable upload token come from?

Frontend **does not** generate the token. Backend creates it when plant finishes the award step, then puts it in the email link.

### 2.1 Vendor path (after shipper quote approved)

**Plant action (authenticated):**

```http
POST /api/plant/shipper-requests/:requestId/approve
Authorization: Bearer <plant_or_admin_jwt>
```

Admin plant mirror: `POST /api/admin/plant/shipper-requests/:requestId/approve` (same controller).

**Backend side effects:**

1. Sets `ShipperRequest.status = approved`.
2. If missing, generates `ShipperRequest.payableUploadToken` (random hex).
3. Emails the **vendor** (`vendor.email`) with:

```text
{CLIENT_URL}/payable-invoice-upload/{payableUploadToken}
```

Example: `https://your-app.com/payable-invoice-upload/a1b2c3...`

**FE does not need the token from the approve API response for the public page** — the vendor gets it from the email. Plant UI only needs to show “approval + email sent” success.

### 2.2 Freight path (after bid selected / awarded)

**Plant action (authenticated):**

```http
POST /api/plant/freight-bids/:bidId/select
Authorization: Bearer <plant_or_admin_jwt>
```

Admin plant: `POST /api/admin/plant/freight-bids/:bidId/select` (or deliveries bid select — same award flow).

**Backend side effects:**

1. Sets bid `status = selected`, delivery confirmed.
2. If missing, generates `FreightBid.payableUploadToken`.
3. Emails the **carrier** with:

```text
{CLIENT_URL}/payable-invoice-upload/{payableUploadToken}
```

### 2.3 Admin manual upload (no public token)

Admin can create a payable invoice **without** email token:

```http
POST /api/admin/invoices/payables/vendor
POST /api/admin/invoices/payables/freight-carrier
```

Body includes `documentUrl` (already uploaded file URL). Status starts at `pending_admin_approval` → another admin approves in the queue. **No public page / no token.**

---

## 3. Public acceptance upload page (full FE flow)

**Auth:** none. No `Authorization` header.  
**Page route (FE):** `/payable-invoice-upload/:token`  
**API base:** `/api/public/payable-invoice-upload/:token`

Same UX pattern as existing **vendor quote upload** and **freight bid** public pages.

### 3.1 Step A — Bootstrap (load page)

```http
GET /api/public/payable-invoice-upload/:token
```

**Success `200` — common fields**

| Field | Use |
|--------|-----|
| `requiresAuth` | Always `false` |
| `invoiceType` | `"vendor"` \| `"freight_carrier"` — pick UI variant |
| `uploadKind` | Same as invoiceType |
| `projectName`, `jobId`, `leadId` | Header |
| `payeeName` | Vendor or carrier name |
| `suggestedAmount` | Prefill amount (quote value or awarded bid) |
| `alreadySubmitted` | If `true`, disable form (invoice already created) |
| `existingInvoiceId` | Prior invoice id when already submitted |

**Vendor-only extras:** `shipperRequest`, `vendor`, `project`, `approvedQuote` (quote file URLs, amounts).  
**Freight-only extras:** `delivery`, `freightBid`, `carrier`, `awardedBid`, load fields (`pickupLocation`, `bundlePlan`, `bundles`, `packingLists`, …) — same richness as freight bid public page.

**Errors (no JWT):**

| HTTP | Meaning |
|------|---------|
| `400` | Invalid/expired token, quote not approved yet, bid not awarded, etc. |

Show the API `message` on the page.

### 3.2 Step B — Presign (get S3 upload URL)

```http
POST /api/public/payable-invoice-upload/:token/presigned-url
Content-Type: application/json

{
  "fileName": "invoice.pdf",
  "fileType": "application/pdf",
  "folder": "payable-invoices"
}
```

**Response `data`:**

```json
{
  "uploadUrl": "https://s3....presigned...",
  "fileUrl": "https://bucket.s3.region.amazonaws.com/payable-invoices/.../uuid.pdf",
  "key": "payable-invoices/.../uuid.pdf"
}
```

### 3.3 Step C — PUT file to S3

```http
PUT {uploadUrl}
Content-Type: application/pdf

<raw file bytes>
```

Use the **same** `Content-Type` as `fileType`. No Authorization header on this PUT (presigned).

### 3.4 Step D — Submit invoice

```http
POST /api/public/payable-invoice-upload/:token
Content-Type: application/json

{
  "documentUrl": "<fileUrl from presign>",
  "documentFileName": "invoice.pdf",
  "totalAmount": 45000,
  "description": "Optional",
  "vendorInvoiceNumber": "Their INV-123",
  "daysToPay": 30
}
```

| Body field | Required | Notes |
|------------|----------|--------|
| `documentUrl` | Yes | Must be the `fileUrl` from presign (after successful PUT) |
| `totalAmount` | Yes | Number |
| `documentFileName` | No | Display name |
| `description` | No | |
| `vendorInvoiceNumber` | No | Their reference |
| `daysToPay` | No | Default 30 |

**Response `201`:**

```json
{
  "success": true,
  "message": "Invoice submitted for admin approval",
  "data": {
    "invoiceId": "...",
    "invoiceNumber": "VINV-2026-1005",
    "payableStatus": "pending_admin_approval",
    "alreadySubmitted": true,
    "row": { }
  }
}
```

**One submission per token.** Second submit → `400` “An invoice was already submitted…”. Bootstrap will show `alreadySubmitted: true`.

### 3.5 Pseudo-code (public page)

```javascript
const token = params.token // from /payable-invoice-upload/:token

// 1) Bootstrap
const info = await fetch(`/api/public/payable-invoice-upload/${token}`).then(r => r.json())
if (!info.success) showError(info.message)
if (info.data.alreadySubmitted) disableForm()

// 2) User picks PDF + amount
const { uploadUrl, fileUrl } = (await fetch(
  `/api/public/payable-invoice-upload/${token}/presigned-url`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, fileType: file.type || 'application/pdf' }) }
).then(r => r.json())).data

// 3) Upload to S3
await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })

// 4) Submit
await fetch(`/api/public/payable-invoice-upload/${token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    documentUrl: fileUrl,
    documentFileName: file.name,
    totalAmount: Number(amount),
  }),
})
```

---

## 4. Status lifecycle (UI labels)

| `payableWorkflow.status` / list `payableStatus` | Meaning | Typical UI |
|--------------------------------------------------|---------|------------|
| `pending_admin_approval` | Just uploaded (public or admin manual) | Admin: Approve / Reject · list: **Awaiting admin** |
| `approved_for_payment` | Admin approved | Account: ready to pay · **Pending** |
| `rejected` | Admin rejected | Show reason |
| `paid` | Account marked paid | **Completed** |
| `unpaid` | Reopened after paid | Treat like pending payment |

**Sources (`payableWorkflow.source`):**

| Value | Created by |
|--------|------------|
| `acceptance_upload` | Public page (email token) |
| `admin_manual` | Admin Upload Invoice form |

List rows also expose **`paymentLabel`**: `Awaiting admin` | `Pending` | `Completed` | `Rejected` | `—`.

---

## 5. End-to-end flows (by scenario)

### Flow A — Vendor invoice via acceptance email

```text
1. Plant compares shipper quotes
2. POST /api/plant/shipper-requests/:id/approve
3. Backend sets payableUploadToken + emails vendor
4. Vendor opens /payable-invoice-upload/:token (no login)
5. GET bootstrap → POST presign → PUT S3 → POST submit
6. Invoice appears in admin approval queue (pending_admin_approval)
7. Admin PUT .../approve
8. Account sees it in payables queue → PUT .../mark-paid
9. Plant can see it on GET /api/plant/payables/vendor (read-only)
```

### Flow B — Freight carrier invoice via award email

```text
1. Plant selects freight bid
2. POST /api/plant/freight-bids/:bidId/select
3. Backend sets payableUploadToken + emails carrier
4. Carrier opens same public page + APIs (token resolves to freight)
5. Submit → invoiceType freight_carrier
6. Same admin approve → account pay → plant list under .../payables/freight-carrier
```

### Flow C — Admin uploads invoice manually

```text
1. Admin uploads PDF (use your existing staff S3/presign if any), then:
2. POST /api/admin/invoices/payables/vendor  (or .../freight-carrier)
3. Status pending_admin_approval
4. Admin approve → account pay (same as A/B from step 7)
```

### Flow D — Comments

Admin and account both post comments on the **same** invoice; both see the thread on detail GET.

---

## 6. Admin panel APIs

**Auth:** `Authorization: Bearer <admin_jwt>`  
**Prefix:** `/api/admin/invoices/payables`

| UI | Method | Path |
|----|--------|------|
| Filter enums | `GET` | `/filters` |
| Approval queue (default pending) | `GET` | `/approval-queue?invoiceType=vendor&page=1&limit=20` |
| Manual vendor create | `POST` | `/vendor` |
| Manual freight create | `POST` | `/freight-carrier` |
| Detail (full data) | `GET` | `/:invoiceId` |
| Approve | `PUT` | `/:invoiceId/approve` |
| Reject | `PUT` | `/:invoiceId/reject` |
| Comment | `POST` | `/:invoiceId/comments` |

### Manual create (vendor) body

```json
{
  "leadId": "<mongoId>",
  "vendorId": "<mongoId>",
  "totalAmount": 12000,
  "category": "service",
  "description": "Steel materials",
  "date": "2026-09-24",
  "daysToPay": 30,
  "documentUrl": "https://.../file.pdf",
  "documentFileName": "file.pdf"
}
```

Freight: use `carrierId` instead of `vendorId`.

**Reject:** `{ "reason": "Amount does not match PO" }`  
**Comment:** `{ "text": "Please confirm W-9" }`

### Detail response `data`

| Key | Contents |
|-----|----------|
| `invoice` | Full Invoice + populated lead, vendor/carrier, shipperRequest / freightBid / delivery (tokens stripped) |
| `row` | Flat table row |
| `delivery` | Linked delivery when present |
| `loadDetails` | `{ bundlePlan, packingListPlan, bundles, packingLists }` |

### Existing admin list screens (same paths, richer rows)

| Screen | GET |
|--------|-----|
| Vendor invoices | `/api/admin/invoices/vendor?payableStatus=&projectId=&search=&page=&limit=` |
| Freight carrier | `/api/admin/invoices/freight-carrier` (same query) |
| Export | `/api/admin/invoices/vendor/export`, `.../freight-carrier/export` |

Optional `payableStatus`: `pending_admin_approval` | `approved_for_payment` | `rejected` | `paid` | `unpaid`.

Each list item includes at least: `_id`, `invoiceNumber`, `payableStatus`, `paymentLabel`, `documentUrl`, `amount` / `totalAmount`, project + payee names.

---

## 7. Account panel APIs

**Auth:** `Authorization: Bearer <account_or_admin_jwt>`  
**Prefix:** `/api/account/payables`

| UI | Method | Path |
|----|--------|------|
| Filters | `GET` | `/filters` |
| Payment queue + stats | `GET` | `?invoiceType=vendor&payableStatus=&page=1&limit=20` |
| Detail | `GET` | `/:invoiceId` |
| Mark paid | `PUT` | `/:invoiceId/mark-paid` |
| Mark unpaid | `PUT` | `/:invoiceId/mark-unpaid` |
| Comment | `POST` | `/:invoiceId/comments` |

Default list statuses: `approved_for_payment`, `paid`, `unpaid`.

**Mark paid (optional body):** `{ "paymentMethod": "bank_transfer" }`

**List `stats` example:**

```json
{
  "pendingPayment": 3,
  "pendingAmount": 67500,
  "paid": 10,
  "paidAmount": 240000,
  "unpaid": 1,
  "unpaidAmount": 5000
}
```

**Legacy note:** `GET /api/account/financial/invoices/vendor` still uses old `PaymentApproval`. New UI should use **`/api/account/payables`**.

---

## 8. Plant panel APIs (read-only invoices)

**Auth:** plant JWT → `/api/plant/...` · admin plant → `/api/admin/plant/...` (same handlers).

Plant **does not** create payables here. Creation = public email upload or admin manual. Plant only **lists / views** after shipper approve / freight award triggered the email.

| Screen | Method | Path |
|--------|--------|------|
| Filters | `GET` | `.../payables/filters` |
| Vendor list + stats | `GET` | `.../payables/vendor` |
| Freight list + stats | `GET` | `.../payables/freight-carrier` |
| Detail | `GET` | `.../payables/:invoiceId` |

**Query:** `page`, `limit`, `projectId`, `payableStatus`, `status`, `startDate`, `endDate`, `search`.

**Example:** `GET /api/plant/payables/vendor?page=1&limit=20`

**Response:** `{ stats, invoices[], total, page, limit }` — use `stats` for cards, `invoices` for table.  
**Project filter dropdown:** existing `GET /api/plant/projects`.

---

## 9. Comparison with existing public quote / bid flows

| Step | Vendor quote (existing) | Freight bid (existing) | Payable invoice (this feature) |
|------|-------------------------|------------------------|--------------------------------|
| Token source | Plant “send to vendor” | Plant invite carriers | Plant **approve** / **select bid** |
| FE route | `/vendor-upload/:token` | freight bid page | `/payable-invoice-upload/:token` |
| Bootstrap | `GET /api/public/vendor-upload/:token` | `GET /api/public/freight-bids/:token` | `GET /api/public/payable-invoice-upload/:token` |
| Presign | `POST .../presigned-url` | (bid has no PDF usually) | `POST .../presigned-url` |
| Submit | `POST .../vendor-upload/:token` | `POST .../freight-bids/:token/submit` | `POST .../payable-invoice-upload/:token` |
| JWT? | No | No | No |

Implement the payable public page by **copying the vendor-upload upload UX**, but point all calls at `payable-invoice-upload` and bind amount to invoice `totalAmount`.

---

## 10. Data model cheat sheet

| Field | Notes |
|--------|--------|
| `invoiceType` | `vendor` \| `freight_carrier` |
| `vendorId` / `carrierId` | Payee |
| `leadId` | Project |
| `payableWorkflow.status` | Lifecycle (see §4) |
| `payableWorkflow.source` | `acceptance_upload` \| `admin_manual` |
| `payableWorkflow.documentUrl` | PDF |
| `payableWorkflow.shipperRequestId` / `freightBidId` / `deliveryId` | Links |
| `payableWorkflow.comments[]` | `{ text, authorRole, authorId, createdAt }` |

Numbers: **`VINV-{year}-{seq}`** (vendor), **`FINV-{year}-{seq}`** (freight).

---

## 11. Frontend checklist

### Public page `/payable-invoice-upload/:token`

- [ ] No Bearer header — only URL `:token`
- [ ] Do not reuse `vendor-upload` or `freight-bids` APIs with this token
- [ ] Bootstrap → branch UI on `invoiceType` / `uploadKind`
- [ ] If `alreadySubmitted`, show success / disable resubmit
- [ ] Presign → PUT S3 → POST submit with `documentUrl` + `totalAmount`
- [ ] Prefill amount from `suggestedAmount`

### Plant

- [ ] Approve shipper / select freight bid as today (emails go out automatically)
- [ ] Vendor invoices tab → `GET .../payables/vendor`
- [ ] Freight invoices tab → `GET .../payables/freight-carrier`
- [ ] Detail / open PDF → `GET .../payables/:invoiceId` → `documentUrl`
- [ ] No plant create/approve/pay for this flow

### Admin

- [ ] Approval queue → `GET .../payables/approval-queue`
- [ ] Approve / Reject
- [ ] Optional Upload Invoice → POST vendor / freight-carrier
- [ ] Lists → filter `payableStatus`; show `paymentLabel` + `documentUrl`
- [ ] Comments on detail

### Account

- [ ] Queue → `GET /api/account/payables`
- [ ] Mark paid / unpaid
- [ ] Comments
- [ ] Prefer this over legacy financial vendor invoices API

---

## 12. Plant triggers (token + email)

| Event | Authenticated API | Token field | Email link |
|--------|-------------------|-------------|------------|
| Vendor quote approved | `POST /api/plant/shipper-requests/:requestId/approve` | `ShipperRequest.payableUploadToken` | `{CLIENT_URL}/payable-invoice-upload/{token}` |
| Freight bid selected | `POST /api/plant/freight-bids/:bidId/select` | `FreightBid.payableUploadToken` | same path |

Admin plant routes under `/api/admin/plant/...` call the same handlers.
