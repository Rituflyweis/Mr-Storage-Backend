# Customer record documents — full API handoff (req/res + enums)

**Date:** 2026-10-19  
**Audience:** Frontend (admin, sales, account, plant, construction)  
**Base URL:** `/api`  
**Auth:** `Authorization: Bearer <staff JWT>`

This is the **single integration reference** for **staff-uploaded files on the Customer record** (`Customer.documents[]`). These files are **not tied to a project/lead** — they follow the customer across all their projects.

**Related but different APIs (do not mix):**

| Feature | Storage | Typical endpoints |
|---------|---------|-------------------|
| **Customer record documents** (this doc) | `Customer.documents[]` | `GET/POST/DELETE …/customers/:customerId/documents` |
| Project / lead attachments | `Lead.documents[]` | `POST /api/upload/leads/:leadId/documents` |
| Customer portal “Documents” hub | Aggregates drawings + lead docs per project | `GET /api/customer/documents` |
| Plant / merged drawings | `DrawingDocument`, plant buildings | `GET /api/admin/project-drawings`, etc. |

Cross-panel summary (drawings + delivery): [`frontend-cross-panel-drawings-customer-docs-2026-10-17.md`](./frontend-cross-panel-drawings-customer-docs-2026-10-17.md)

---

## 1. Enums

### 1.1 `category` — customer document type (required enum on upload)

Source: `CUSTOMER_DOCUMENT_CATEGORIES` in `src/config/constants.js` (also returned in list responses as `data.categories`).

| Value | Suggested UI label | Notes |
|-------|-------------------|--------|
| `rendering` | Rendering | 3D / visual renderings |
| `civil_drawing` | Civil drawing | Civil plans |
| `site_plan` | Site plan | Site layout |
| `structural` | Structural | Structural drawings |
| `other` | Other | **Default** when `category` omitted on POST |

**Rules:**

- POST/PUT validation: must be exactly one of the values above (snake_case).
- Mongoose default on new subdocuments: `other`.
- There are **no server-side `categoryLabel` fields** — map labels in the UI from this table.

### 1.2 Roles that can call each operation

| Role | List | Upload (POST) | Delete |
|------|------|---------------|--------|
| `admin` | Yes (all customers) | Yes | Yes |
| `sales` | Yes (customers with ≥1 lead where `assignedSales` = self) | Yes | Yes |
| `account` | Yes (customers with ≥1 lead) | No | No |
| `plant` | Yes (customers with ≥1 lead) | No | No |
| `construction` | Yes (customers with ≥1 lead) | No | No |

Staff JWT roles enum (for reference): `admin`, `sales`, `construction`, `plant`, `account`.

### 1.3 Audit actions (activity feeds — optional UI)

| Constant | String value | When |
|----------|--------------|------|
| `AUDIT_ACTIONS.CUSTOMER_DOCUMENT_ADDED` | `customer.document_added` | After successful POST |
| `AUDIT_ACTIONS.CUSTOMER_DOCUMENT_REMOVED` | `customer.document_removed` | After successful DELETE |

Audit payload includes `customerId`, `performedBy`, and `metadata` (`documentId`, `name`, `category` on add).

### 1.4 Project lead document `type` (NOT customer record — upload helper only)

If you use `POST /api/upload/leads/:leadId/documents` for **project** files, `type` must be one of:

`drawing`, `approval`, `general`, `contract`, `photo`, `video`, `other`

These are **not** valid `category` values on customer record documents.

---

## 2. Conventions

### 2.1 Response envelope

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
  "message": "Access denied"
}
```

Validation error (400):

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "type": "field", "msg": "Invalid value", "path": "category", "location": "body" }
  ]
}
```

### 2.2 Identifiers

- `:customerId` — MongoDB `_id` of the **Customer** document (not the human-readable `customerId` string field unless your UI already maps them; list/detail APIs use `_id` in paths).

### 2.3 Sort order

List API returns documents sorted **`uploadedAt` descending** (newest first).

### 2.4 `uploadedBy` population

On **GET list**, each document’s `uploadedBy` is populated with `{ name, email, role }` when set.

---

## 3. Endpoints by panel

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/admin/customers/:customerId/documents` | admin |
| POST | `/api/admin/customers/:customerId/documents` | admin |
| DELETE | `/api/admin/customers/:customerId/documents/:docId` | admin |
| GET | `/api/sales/customers/:customerId/documents` | sales |
| POST | `/api/sales/customers/:customerId/documents` | sales |
| DELETE | `/api/sales/customers/:customerId/documents/:docId` | sales |
| GET | `/api/account/customers/:customerId/documents` | account |
| GET | `/api/plant/customers/:customerId/documents` | plant |
| GET | `/api/construction/customers/:customerId/documents` | construction, admin* |

\*Construction routes are mounted with `roleGuard(['construction', 'admin'])`, so admins may also call the construction-prefixed GET.

---

## 4. List documents

```http
GET /api/sales/customers/507f1f77bcf86cd799439011/documents
Authorization: Bearer <token>
```

**200 `data`:**

```json
{
  "customerId": "507f1f77bcf86cd799439011",
  "total": 2,
  "categories": [
    "rendering",
    "civil_drawing",
    "site_plan",
    "structural",
    "other"
  ],
  "documents": [
    {
      "_id": "65a1b2c3d4e5f6789012345a",
      "name": "site-plan-v2.pdf",
      "fileUrl": "https://your-bucket.s3.us-east-1.amazonaws.com/documents/uuid.pdf",
      "fileType": "application/pdf",
      "fileSize": 890000,
      "category": "site_plan",
      "notes": "Latest from architect",
      "uploadedBy": {
        "_id": "507f191e810c19729de860ea",
        "name": "Jane Sales",
        "email": "jane@example.com",
        "role": "sales"
      },
      "uploadedAt": "2026-10-15T14:22:00.000Z"
    }
  ]
}
```

**Errors:**

| Status | `message` (typical) |
|--------|---------------------|
| 404 | `Customer not found` |
| 403 | `Access denied` (sales: no assigned lead for customer; account/plant/construction: no lead linked) |

**UI:** Use `data.categories` for upload/edit dropdowns so the client stays in sync with the server enum.

---

## 5. Upload flow (sales / admin)

Files are **not** sent as multipart to these routes. Use S3 presigned upload, then register the URL.

### Step A — Presigned URL

```http
POST /api/upload/presigned-url
Authorization: Bearer <token>
Content-Type: application/json
```

Allowed roles for presign: `admin`, `sales`, `plant`, `construction` (account **cannot** presign on this route).

**Body:**

```json
{
  "fileName": "site-plan-v2.pdf",
  "fileType": "application/pdf",
  "folder": "documents"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `fileName` | Yes | Used to derive file extension |
| `fileType` | Yes | S3 `Content-Type` |
| `folder` | No | Default `"documents"` — recommended for customer record files |

**200 `data`:**

```json
{
  "uploadUrl": "https://…presigned PUT URL…",
  "fileUrl": "https://bucket.s3.region.amazonaws.com/documents/uuid.pdf",
  "key": "documents/uuid.pdf"
}
```

### Step B — PUT file to S3

```http
PUT <uploadUrl>
Content-Type: application/pdf

<binary>
```

Do not send the staff JWT on the S3 PUT unless your bucket policy requires it.

### Step C — Register on customer

```http
POST /api/sales/customers/507f1f77bcf86cd799439011/documents
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**

```json
{
  "name": "site-plan-v2.pdf",
  "fileUrl": "https://bucket.s3.region.amazonaws.com/documents/uuid.pdf",
  "fileType": "application/pdf",
  "fileSize": 890000,
  "category": "site_plan",
  "notes": "Optional note"
}
```

| Field | Required | Validation |
|-------|----------|------------|
| `name` | Yes | Non-empty string |
| `fileUrl` | Yes | Non-empty string (HTTPS URL from presign step) |
| `fileType` | No | String; stored as-is |
| `fileSize` | No | Number; defaults to `0` |
| `category` | No | Must be in enum; defaults to `other` |
| `notes` | No | String |

**200 `data`:**

```json
{
  "document": {
    "_id": "65a1b2c3d4e5f6789012345b",
    "name": "site-plan-v2.pdf",
    "fileUrl": "https://…",
    "fileType": "application/pdf",
    "fileSize": 890000,
    "category": "site_plan",
    "notes": "",
    "uploadedBy": "507f191e810c19729de860ea",
    "uploadedAt": "2026-10-19T10:00:00.000Z"
  }
}
```

**Note:** POST response returns `uploadedBy` as ObjectId string (not populated). Refresh list if you need populated uploader.

**Errors:**

| Status | `message` (typical) |
|--------|---------------------|
| 400 | `name and fileUrl are required` |
| 400 | `category must be one of: rendering, civil_drawing, site_plan, structural, other` |
| 400 | `Validation failed` (+ `errors` array) |
| 403 | `Only sales can upload customer documents` (wrong role) |
| 403 | `Access denied` |
| 404 | `Customer not found` |

There is **no backend file size cap** on the register step; size limits are S3 / client policy.

---

## 6. Delete document

```http
DELETE /api/admin/customers/507f1f77bcf86cd799439011/documents/65a1b2c3d4e5f6789012345a
Authorization: Bearer <token>
```

**200:**

```json
{
  "success": true,
  "message": "Document removed",
  "data": null
}
```

**Errors:**

| Status | `message` (typical) |
|--------|---------------------|
| 404 | `Document not found` |
| 404 | `Customer not found` |
| 403 | Same as upload |

Deleting removes the subdocument from Mongo only; **S3 objects are not deleted** by this API.

---

## 7. Access control (implementation summary)

```
admin     → any customer
sales     → Lead.exists({ customerId, assignedSales: user._id })
account,
plant,
construction → Lead.exists({ customerId })  (read-only list)
```

Upload/delete: `admin` and `sales` only (same sales scoping as list for sales).

---

## 8. Frontend checklist

- [ ] Customer profile “Documents” tab: **GET** for account / plant / construction; **GET + POST + DELETE** for admin / sales (sales scoped).
- [ ] Category dropdown from `data.categories` or static table in §1.1 (must match server).
- [ ] Upload: presign → S3 PUT → POST register (§5).
- [ ] Do not use `contract` or lead-only types as customer `category` (invalid).
- [ ] Distinguish from customer app `GET /api/customer/documents` (project-scoped hub).
- [ ] `:customerId` in path = Customer `_id`.

---

## 9. Source files (backend)

| File | Purpose |
|------|---------|
| `src/controllers/common/customerDocument.controller.js` | List / add / delete |
| `src/models/Customer.js` | `CustomerDocumentSchema` |
| `src/config/constants.js` | `CUSTOMER_DOCUMENT_CATEGORIES` |
| `src/routes/admin/customer.routes.js` | Admin CRUD |
| `src/routes/sales/customer.routes.js` | Sales CRUD |
| `src/routes/account/customer.routes.js` | Account read |
| `src/routes/common/customerDocumentsRead.routes.js` | Plant / construction read mount |
