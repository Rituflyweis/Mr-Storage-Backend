# Customer App — Building Quotation API (frontend handoff)

Integration guide for the **project building quotation** tab: sales estimate → formal quotation → send to customer → preview / approve / reject.

**Not the same as material order quotations** (`/order-quotations/*`). Those are coil/material RFQ quotes from the plant flow.

**Related**

- Full customer portal reference: [`frontend-customer-app-api-full.md`](./frontend-customer-app-api-full.md) (§ Building quotation tab)
- Sales send / approval (backend-only for sales/admin): [`frontend-api-delta-2026-09-10-quotation-approval-versions.md`](./frontend-api-delta-2026-09-10-quotation-approval-versions.md)
- Preview CSS if rendering HTML fragments: [`quotation-preview-stylesheet-for-frontend.md`](./quotation-preview-stylesheet-for-frontend.md)
- Staff photos/videos (same payload shape): [`frontend-lead-photos-videos-api.md`](./frontend-lead-photos-videos-api.md)
- Postman: `customer-app.postman_collection.json` → **Projects → Quotation**

---

## Base URL & auth

| Item | Value |
|------|--------|
| Base | `{BASE_URL}/api/customer` |
| Example prod | `https://mr-storage-backend-025k.onrender.com/api/customer` |
| Login | `POST /api/customer/auth/login` → `data.accessToken` |
| Protected routes | `Authorization: Bearer <accessToken>` |

JWT must be a **customer** token (`type: "customer"`). The project `leadId` must belong to the logged-in customer.

---

## Response envelope (JSON routes)

Success:

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Error:

```json
{
  "success": false,
  "message": "Human-readable error"
}
```

| HTTP | Typical meaning |
|------|------------------|
| 401 | Missing or invalid token |
| 403 | Project does not belong to this customer |
| 404 | Project or quotation not found (see messages below) |
| 400 | Invalid action (e.g. already accepted) |

**Preview and PDF routes return raw HTML or PDF bytes**, not the JSON envelope.

---

## Product flow (what the customer sees)

1. Sales creates a quotation (often from an estimate). Admin approves it; sales **sends** it (`status` → `sent`).
2. Until send, customer may get **`availability: "pending"`** on `GET …/quotation` (quote exists but no document yet).
3. After send, customer gets **`availability: "ready"`** with links to the **same assembled document** as the sales quoting generator.
4. Customer may **approve** (`status` → `accepted`) or **reject** (`status` → `rejected`, optional reason).

Customer-visible quotation statuses: **`sent`**, **`accepted`**, **`rejected`**.  
Draft / pending admin approval are **not** exposed as a full quote document.

---

## Endpoints overview

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/projects/:leadId/quotation` | Quotation tab metadata + preview URLs |
| GET | `/projects/:leadId/quotation/preview` | Full HTML document (WebView) |
| GET | `/projects/:leadId/quotation/pdf` | PDF download / in-app viewer |
| POST | `/projects/:leadId/quotation/approve` | Customer accepts quotation |
| POST | `/projects/:leadId/quotation/reject` | Customer rejects quotation |

Path param **`leadId`** = project Mongo `_id` (e.g. `6ac4e5e6570533c2c601ed40`).

---

## 1. GET quotation metadata

Powers the quotation tab: availability, summary fields, preview links, optional AI summary.

```http
GET /api/customer/projects/{leadId}/quotation
Authorization: Bearer {accessToken}
```

### cURL

```bash
curl -s "{BASE_URL}/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation" \
  -H "Authorization: Bearer {accessToken}"
```

### Response `200` — `availability: "ready"`

Customer can open preview/PDF and show approve/reject when `quotation.status === "sent"`.

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "availability": "ready",
    "quotation": {
      "_id": "67890abcdef1234567890abc",
      "leadId": "6ac4e5e6570533c2c601ed40",
      "customerId": "507f1f77bcf86cd799439011",
      "sourceEstimateId": "67890abcdef1234567890def",
      "quoteNumber": "QT-2026-0042",
      "proposalDate": "2026-09-15T10:00:00.000Z",
      "validTill": "2026-10-15T00:00:00.000Z",
      "buildingType": "Warehouse",
      "location": "123 Industrial Blvd, Austin, TX",
      "sqft": "5000",
      "width": 50,
      "length": 100,
      "height": 18,
      "currency": "USD",
      "finalPrice": 125000,
      "basePrice": 118000,
      "status": "sent",
      "sentAt": "2026-09-16T14:30:00.000Z",
      "versionNumber": 2,
      "assignedSalesperson": {
        "_id": "507f1f77bcf86cd799439012",
        "name": "Jane Sales",
        "email": "jane.sales@example.com"
      },
      "approval": {
        "status": "approved",
        "reviewedAt": "2026-09-16T12:00:00.000Z"
      },
      "sourceEstimate": {
        "_id": "67890abcdef1234567890def",
        "status": "quoted",
        "jobType": "PEB",
        "squareFootage": 5000,
        "grandTotal": 125000,
        "updatedAt": "2026-09-15T11:00:00.000Z"
      },
      "createdAt": "2026-09-10T08:00:00.000Z",
      "updatedAt": "2026-09-16T14:30:00.000Z"
    },
    "quoteSummary": {
      "summary": "50×100×18 warehouse, galvalume roof and walls, includes freight to site…",
      "generatedAt": "2026-09-16T14:35:00.000Z"
    },
    "documentMeta": {
      "source": "estimate",
      "sourceEstimateId": "67890abcdef1234567890def",
      "hasPricingData": true,
      "previewPath": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/preview",
      "pdfPath": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/pdf",
      "htmlPreviewLink": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/preview?format=html",
      "pdfLink": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/pdf",
      "defaultSections": ["quote", "sow", "contract", "drawings"]
    },
    "preview": {
      "htmlUrl": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/preview?format=html",
      "pdfUrl": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/pdf",
      "defaultSections": ["quote", "sow", "contract", "drawings"],
      "useGeneratorPreview": true
    },
    "message": null
  }
}
```

**Notes for UI**

- `quotation.internalNotes` is **never** returned.
- `quotation.approval` is **customer-safe** (status + `reviewedAt` only).
- `quotation` may include additional spec fields (doors, insulation, etc.) when present on the record.
- Use **`data.preview.htmlUrl`** / **`data.preview.pdfUrl`** — prepend `{BASE_URL}` (no `/api` duplication if base already includes `/api`).

### Response `200` — `availability: "pending"`

Quotation row exists but sales has not sent it yet. Show waiting copy; do not call preview/PDF (they will 404).

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "availability": "pending",
    "quotation": null,
    "quoteSummary": null,
    "documentMeta": {
      "source": "estimate",
      "sourceEstimateId": "67890abcdef1234567890def",
      "hasPricingData": true,
      "previewPath": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/preview",
      "pdfPath": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/pdf",
      "htmlPreviewLink": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/preview?format=html",
      "pdfLink": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/pdf",
      "defaultSections": ["quote", "sow", "contract", "drawings"]
    },
    "preview": null,
    "message": "Your formal quotation is being prepared. You will see the full preview here once your sales representative sends it."
  }
}
```

### Response `404`

| `message` | Meaning |
|-----------|---------|
| `Project not found` | Bad `leadId` or not owned by customer |
| `No quotation found for this project` | No quotation document for this project/customer |

---

## 2. GET HTML preview

Returns a **full HTML page** (inline styles). Same assembly as sales `GET /api/quotations/:id/pdf?format=html`.

```http
GET /api/customer/projects/{leadId}/quotation/preview?format=html
Authorization: Bearer {accessToken}
```

Optional query:

| Query | Description |
|-------|-------------|
| `format` | Use `html` (default when loading preview route as HTML) |
| `sections` | Comma-separated subset of `quote`, `sow`, `contract`, `drawings`. Default: all four. |

Example with sections:

```http
GET /api/customer/projects/{leadId}/quotation/preview?format=html&sections=quote,sow
```

### cURL

```bash
curl -s "{BASE_URL}/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/preview?format=html" \
  -H "Authorization: Bearer {accessToken}"
```

### Response `200`

- **Content-Type:** `text/html; charset=utf-8`
- **Body:** HTML string (not JSON)

### Response `404`

```json
{
  "success": false,
  "message": "No quotation available to preview yet"
}
```

(JSON 404 when quotation is not in `sent` / `accepted` / `rejected`.)

**Mobile WebView:** load `{BASE_URL}{preview.htmlUrl}` and inject the `Authorization` header (or fetch HTML in native code and load `loadDataWithBaseURL`). Cookies alone are not used for customer JWT.

---

## 3. GET PDF

```http
GET /api/customer/projects/{leadId}/quotation/pdf
Authorization: Bearer {accessToken}
```

Optional: `?sections=quote,sow,contract,drawings` (same as preview).

### cURL

```bash
curl -s "{BASE_URL}/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/pdf" \
  -H "Authorization: Bearer {accessToken}" \
  -o Quotation.pdf
```

### Response `200`

- **Content-Type:** `application/pdf`
- **Content-Disposition:** `inline; filename="Quotation-QT-2026-0042.pdf"`
- **Body:** PDF bytes

### Response `404`

Same JSON error as preview when nothing to show.

---

## 4. POST approve quotation

Only when latest **customer-visible** quotation has `status: "sent"`.

```http
POST /api/customer/projects/{leadId}/quotation/approve
Authorization: Bearer {accessToken}
Content-Type: application/json
```

**Request body:** empty object `{}` or omit body.

### cURL

```bash
curl -s -X POST "{BASE_URL}/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/approve" \
  -H "Authorization: Bearer {accessToken}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "message": "Quotation accepted",
    "quotation": {
      "_id": "67890abcdef1234567890abc",
      "status": "accepted"
    }
  }
}
```

### Response `400`

```json
{
  "success": false,
  "message": "Quotation is already accepted"
}
```

### Response `404`

```json
{
  "success": false,
  "message": "No quotation available to approve"
}
```

---

## 5. POST reject quotation

```http
POST /api/customer/projects/{leadId}/quotation/reject
Authorization: Bearer {accessToken}
Content-Type: application/json
```

### Request body

```json
{
  "reason": "Pricing exceeds approved budget; please revise scope."
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `reason` | No | Stored on quotation `clientNotes` |

### cURL

```bash
curl -s -X POST "{BASE_URL}/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/reject" \
  -H "Authorization: Bearer {accessToken}" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Need revised freight terms"}'
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "message": "Quotation rejected",
    "quotation": {
      "_id": "67890abcdef1234567890abc",
      "status": "rejected"
    }
  }
}
```

### Response `400`

```json
{
  "success": false,
  "message": "Quotation is already rejected"
}
```

---

## Optional: project detail embed

`GET /api/customer/projects/:leadId` includes a **subset** of the same view when a **sent+** quotation exists:

| Field | Content |
|-------|---------|
| `data.quotation` | Sanitized quotation (null if not sent yet) |
| `data.quotationPreview` | Same shape as `data.preview` on `GET …/quotation` |
| `data.quotationDocumentMeta` | Same as `documentMeta` |
| `data.quoteSummary` | AI summary when generated |

For **“being prepared”** (`pending`), use **`GET …/quotation`** — project detail does **not** surface pending quotes (only customer-visible rows).

---

## UI checklist

| Step | Action |
|------|--------|
| 1 | On quotation tab mount, `GET /projects/{leadId}/quotation` |
| 2 | Switch on `data.availability`: `ready` → preview; `pending` → `data.message`; handle 404 |
| 3 | Preview: authenticated GET to `data.preview.htmlUrl` or PDF URL |
| 4 | Show Approve/Reject only if `data.quotation.status === "sent"` |
| 5 | After approve/reject, refresh `GET …/quotation` and update badges |
| 6 | Do not use sales/admin routes (`/api/quotations/*`) from the customer app |

---

## Project photos & videos

Site **photos and videos** uploaded by staff live on `Lead.documents[]` with `type: "photo"` or `"video"`. They are **not** the drawing approval flow (`DrawingDocument`).

Customer app uses the **same JSON shape** as Construction / Admin / Sales / Plant:

```http
GET /api/customer/projects/{leadId}/media
Authorization: Bearer {accessToken}
```

**Query (optional):** `?type=photo` or `?type=video`. Omit → both.

### cURL

```bash
curl -s "{BASE_URL}/api/customer/projects/6ac4e5e6570533c2c601ed40/media" \
  -H "Authorization: Bearer {accessToken}"
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6ac4e5e6570533c2c601ed40",
    "projectId": "PRO-023",
    "projectName": "ABC Logistics Warehouse",
    "documents": [
      {
        "_id": "67890abcdef1234567890abc",
        "url": "https://bucket.s3.region.amazonaws.com/media/site-photo.jpg",
        "name": "site-photo.jpg",
        "type": "photo",
        "uploadedAt": "2026-09-20T10:15:00.000Z",
        "requiresApproval": false,
        "approvalStatus": null,
        "reviewedAt": null,
        "uploadedBy": {
          "_id": "507f1f77bcf86cd799439012",
          "name": "Site Manager",
          "email": "manager@example.com",
          "role": "construction"
        }
      }
    ],
    "photos": [],
    "videos": [],
    "total": 1,
    "photoCount": 1,
    "videoCount": 0
  }
}
```

| Field | Notes |
|-------|--------|
| `documents` | All media (or filtered by `type`) |
| `photos` / `videos` | Convenience splits of `documents` |
| `requiresApproval` | Always `false` for media — show tiles immediately |
| `uploadedBy` | Staff user who uploaded (read-only for customer) |

Empty project (no uploads yet): `200` with `"documents": []`, `"total": 0`.

### Errors

| HTTP | `message` |
|------|-----------|
| 401 | Unauthorized |
| 403 | This project does not belong to your account |
| 404 | Project not found |
| 400 | `type must be one of: photo, video` |

### Customer cannot upload

There is **no** `POST /api/customer/projects/:leadId/media`. Upload remains staff-only (Construction / Admin / Sales / Plant). Customers **view** only.

### Legacy fallbacks (avoid for new UI)

Older screens may still use:

- `GET /api/customer/projects/:leadId/drawings` → `embeddedDocuments` (`fileUrl`, `documentType`)
- `GET /api/customer/documents?type=photo|video` → cross-project list mixed with drawings

Prefer **`GET …/media`** for one project so the payload matches staff panels.

---

## Material order quotations (separate feature)

Per-project table of **coil/material** quotes:

```http
GET /api/customer/projects/{leadId}/order-quotations?page=1&limit=20
```

Query filters: `buildingLabel`, `status`, `dateFrom`, `dateTo`.

Detail / approve / reject use `/api/customer/order-quotations/:quotationId` — different model from building quotation above. See `frontend-customer-app-api-full.md` for order quotation payloads.
