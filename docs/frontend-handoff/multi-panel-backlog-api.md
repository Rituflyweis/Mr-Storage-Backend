# Frontend handoff — Multi-panel backlog (Accounts / Admin / Sales / Plant / Construction / Global)

**Base:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <accessToken>`  
**Envelope:** `{ "success": true|false, "message": "…", "data": { } }`

This document maps every backlog item to the API to use, status, and any new fields shipped in this pass.

---

## 1. Accounts Panel

### 1.1.1 Customers listing (exclude bulk-import lead stubs)

| | |
|--|--|
| **Status** | Ready |
| **API** | `GET /api/account/customers` (+ `/stats`) |
| **Default** | **Real customers only** — excludes `source: "import"` and `@imports.mrstorage.internal` stubs created by lead bulk import |
| **Query** | `search`, `period` / `startDate` / `endDate`, `page`, `limit` |
| **Optional** | `imported=true` → only import stubs; `source=` → exact source |
| **Row fields** | `source`, `isImported` (plus existing name/email/phone/projects) |

Bulk Excel import still creates a Customer row so Lead can reference `customerId`, but **Accounts → Customers** does not treat those as customers unless `?imported=true`.

### 1.1.2 Project invoices — summary / records (was 404)

| | |
|--|--|
| **Status** | Ready (route mounted; unauthenticated call returns **401**, not 404) |
| **APIs** | `GET /api/account/projects/:projectId/invoices/summary` |
| | `GET /api/account/projects/:projectId/invoices/records` |
| **Role** | `admin` \| `account` |

`projectId` = Lead `_id` (24-char hex).

### 1.2.1 All Payments — customer search

| | |
|--|--|
| **Status** | Ready |
| **API** | `GET /api/account/payments/orders?search=` |
| **Search** | Lead `projectName` / `jobId` / `location` **and** customer first/last name / email |

### 1.2.2 Payment Approval — category enum (icon mapping)

| | |
|--|--|
| **Status** | Ready |
| **List** | `GET /api/account/financial/payment-approvals` → each row has `category`, `categoryLabel` |
| **Filters** | `GET /api/account/financial/payment-approvals/filters` |

**Filter payload (new):**

```json
{
  "categories": [
    { "code": "vendor_payment", "label": "Vendor Payment" },
    { "code": "shipper_payment", "label": "Shipper Payment" },
    { "code": "equipment", "label": "Equipment" },
    { "code": "other_expenses", "label": "Other Expenses" }
  ],
  "categoryEnum": ["vendor_payment", "shipper_payment", "equipment", "other_expenses"],
  "payeeTypes": [],
  "statuses": [],
  "workflowStages": [],
  "projects": []
}
```

Optional list filter: `?category=vendor_payment`.

### 1.3.1 Invoice details — Access denied (account role)

| | |
|--|--|
| **Status** | Fixed |
| **Preferred (account panel)** | `GET /api/account/invoices/:invoiceId` |
| **Also allowed** | `GET /api/invoices/:invoiceId` for roles `admin` \| `sales` \| **`account`** |

Write/approve/send routes on `/api/invoices/*` remain `admin` \| `sales` only.

### 1.4.1 Pay Tax (Avalara)

| | |
|--|--|
| **Status** | Ready — use financial-extra (not legacy `/api/account/tax`) |
| **Prefix** | `/api/account/financial-extra/tax-filing` |
| **Key ops** | list / stats / filters / export / `:taxId/prepare` / `POST …/pay` / `POST …/approve` / `PUT …/file` |

---

## 2. Admin Panel

### 2.1.1 Main Dashboard

| | |
|--|--|
| **Status** | Ready |
| **Doc** | [`admin-dashboard-figma-api.md`](./admin-dashboard-figma-api.md) |
| **API** | `GET /api/admin/dashboard/overview?period=month` (+ section routes) |

### 2.2.1 Construction — Upcoming Schedule

| | |
|--|--|
| **Status** | Ready |
| **API** | `GET /api/admin/construction/overview` |
| **Fields** | `upcomingDeadlines[]` and alias **`upcomingSchedule[]`** (`projectName`, `location`, `endDate` / `expectedCloseDate`) |

### 2.2.2 Construction — Available filters

| | |
|--|--|
| **Status** | Ready (new) |
| **API** | `GET /api/admin/construction/overview/filters` |
| **Returns** | `projects`, `statuses` (lifecycle), `buildings`, `businessUnits` |

Overview query params: `projectId`, `buildingLabel`, `status`, `startDate`, `endDate`.

### 2.2.3 Shipper / drawing files — S3 AccessDenied

| | |
|--|--|
| **Status** | Ready (download presign) |
| **API** | `POST /api/upload/download-presigned-url` or `GET …?fileUrl=` / `?key=` |
| **Body** | `{ "fileUrl": "<stored S3 URL>" }` **or** `{ "key": "folder/uuid.ext" }` |
| **Response** | `{ downloadUrl, key, expiresIn }` |
| **Roles** | `admin`, `sales`, `account`, `plant`, `construction` |

Do **not** open the raw `fileUrl` in the browser for private buckets — exchange it for `downloadUrl` first.

### 2.3.1 Plant — Mismatch report card

| | |
|--|--|
| **Status** | Ready |
| **APIs** | `GET /api/admin/plant/dashboard/mismatch-summary` |
| | `GET /api/admin/plant/dashboard/mismatch-report` |

### 2.3.2 Plant — All projects searchable by customer name

| | |
|--|--|
| **Status** | Fixed |
| **API** | `GET /api/plant/projects?search=` (also admin plant projects) |
| **Search** | `projectName`, `jobId`, **and customer first/last/email/company** |

---

## 3. Sales Panel

### 3.1.1 Engineering Drawings override

| | |
|--|--|
| **Status** | Ready |
| **Canonical** | `pembDrawings` (number) on compute / create / update estimate |
| **Aliases** | `drawingsOverride`, `engineeringDrawings` (body or `quoteControls.*`) |

### 3.1.2 Custom Quote

| | |
|--|--|
| **Status** | Ready |
| **API** | `/api/sales/custom-quotes` (+ admin mirror) |
| **Doc** | [`custom-quote-api.md`](./custom-quote-api.md) |

### 3.1.3 Quote History action modals

| Action | APIs |
|--------|------|
| Change Order | `/api/sales/change-orders`, `/api/sales/quotes-store/change-orders` |
| Request Deposit | `POST /api/sales/estimates/deposit/preview`, `PUT /api/sales/estimates/:id/deposit`, deposit PDF |
| Milestones | `POST /api/sales/estimates/milestones/preview`, `PUT /api/sales/estimates/:id/milestones`, milestones PDF |

### 3.1.4 Quote logo — Steel Building vs Storage Materials

| | |
|--|--|
| **Status** | Ready |
| **API** | `POST /api/sales/estimates/documents/preview` (and PDF / save estimate) |
| **Field** | `company` or `companyBrand`: **`SBD`** (Steel Building Depot) \| **`SM`** (Storage Materials) |
| **Aliases** | `steel` / `steel building` → SBD; `storage` / `storage material(s)` → SM |
| **Persist** | `companyBrand` on create/update estimate; history preview hydrates from estimate |
| **Optional** | `companyLogoUrl` / `logoUrl` to override wordmark with an image URL |

FE: add a **logo brand toggle** on the Quote tab (independent of Job Type PEMB/Storage). Pass the selected brand on every preview/recompute call.

---

## 4. Plant Panel

### 4.1.1 Freight Loads & Awarded Loads filters

| | |
|--|--|
| **Status** | Ready |
| **Freight** | `GET /api/plant/freight-loads/filters` |
| **Awarded** | `GET /api/plant/awarded-loads/filters` (same options; new alias) |
| **Admin** | Same under `/api/admin/plant/...` |

---

## 5. Construction Panel

### 5.1.1 / 5.1.2 Dashboard — Upcoming Schedule + Project Timeline

| | |
|--|--|
| **Status** | Ready |
| **API** | `GET /api/construction/dashboard` |
| **Fields** | `upcomingDeadlines` / **`upcomingSchedule`**, `projectTimelineOverall[]` |
| **Filters** | `GET /api/construction/dashboard/filters` |

### 5.2.1 Bundle Scan — Projects search

| | |
|--|--|
| **Status** | Ready |
| **API** | `GET /api/construction/bundle-scan/projects?search=` |

### 5.3 Bundle Scan — Loads (stats / search / sort / filter)

| | |
|--|--|
| **Status** | Enhanced |
| **API** | `GET /api/construction/bundle-scan/projects/:leadId/loads` |
| **Query** | `page`, `limit`, `status`, **`search`**, **`sortBy`**, **`sortOrder`** (`asc`\|`desc`) |
| **sortBy** | `updatedAt` \| `packingListNo` \| `status` \| `totalBundles` \| `totalWeight` |
| **Response** | `loads[]` (+ `mismatchCount`, `hasMismatch`), **`stats`**, **`filters`** |

### 5.4 Bundle Scan — Load bundles (status + mismatch)

| | |
|--|--|
| **Status** | Enhanced |
| **API** | `GET /api/construction/bundle-scan/loads/:packingListId/bundles` |
| **Query** | `labelPending`, `status`, `mismatch=true` |
| **Row fields** | `status`, `hasMismatch`, `mismatchNotes`, `mismatchReportedAt`, `mismatchItemCount` |
| **Also** | top-level `stats` |

### 5.5 Bundle mismatch details

| | |
|--|--|
| **Status** | Enhanced |
| **API** | `GET /api/construction/bundles/:bundleId` |
| **Fields** | `mismatchNotes`, **`mismatchItems`**, **`mismatchReportedAt`**, **`hasMismatch`** |
| **Report** | `POST /api/construction/bundles/:bundleId/report-mismatch` |

---

## 6. Global — Profile

| | |
|--|--|
| **Status** | Ready |
| **GET** | `GET /api/profile` |
| **PUT** | `PUT /api/profile` — body: `name`, `email`, `phone`, `mobile`, `avatar` |
| **Password** | `PUT /api/profile/password` |
| **Notifications** | `PUT /api/profile/notification-settings` |
| **Roles** | `admin`, `sales`, `account`, `plant`, `construction` |

**GET shape:** `_id`, `name`, `email`, `phone`, `mobile`, `avatar`, `role`, `department`, `isActive`, `notificationSettings`, timestamps (+ `isMainAdmin` for admin).

---

## Quick FE checklist

1. Project invoices: call `/api/account/projects/:id/invoices/summary` with account token.
2. Invoice detail: use `/api/account/invoices/:id` or `/api/invoices/:id` (account now allowed).
3. Payment approval icons: map from `/payment-approvals/filters` → `categories[].code`.
4. Private S3 files: always call `/api/upload/download-presigned-url` before opening.
5. Bundle-scan loads: wire `stats` + `search` / `sortBy` / `status`.
6. Tax Pay: `/api/account/financial-extra/tax-filing*`, not `/api/account/tax`.
7. Admin main dashboard: see `admin-dashboard-figma-api.md`.
