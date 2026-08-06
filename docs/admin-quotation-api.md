# Admin — Quotation API

Guide for creating, editing, and sending quotations from the **Admin panel**.

**Base path:** `/api/quotations`  
**Auth:** `Authorization: Bearer <admin_jwt>` — role must be `admin`  
**Mounted in:** `src/routes/common/index.js` → `src/routes/common/quotation.routes.js`  
**Controller:** `src/controllers/common/quotation.controller.js`  
**Model:** `src/models/Quotation.js`

Admin uses the **shared** quotation API (same as sales). Admin can create quotations for **any** lead. Sales users are restricted to leads where `assignedSales = req.user._id`.

---

## Standard response envelope

**Success**

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

**Error**

```json
{
  "success": false,
  "message": "Human-readable error"
}
```


| HTTP  | When                                                   |
| ----- | ------------------------------------------------------ |
| `201` | Quotation created (`POST /api/quotations`)             |
| `400` | Validation failed, or edit/send on non-draft quotation |
| `401` | Missing / invalid JWT                                  |
| `403` | Sales user accessing another rep's lead                |
| `404` | Lead or quotation not found                            |


---

## Quotation lifecycle

```
GET lead detail (prefill)
        ↓
POST /api/quotations          → status: draft
        ↓
PUT /api/quotations/:id       → edit draft (repeat as needed)
        ↓
POST /api/quotations/:id/send   → status: sent (locked)
        ↓
GET /api/quotations/:id/summary → AI summary (optional)
```


| Step | Action                          | Endpoint                                                                |
| ---- | ------------------------------- | ----------------------------------------------------------------------- |
| 1    | Load lead + AI prefill data     | `GET /api/admin/leads/:leadId/detail`                                   |
| 2    | Create quotation as **draft**   | `POST /api/quotations`                                                  |
| 3    | View / edit draft               | `GET /api/quotations/:quotationId` · `PUT /api/quotations/:quotationId` |
| 4    | Send to customer                | `POST /api/quotations/:quotationId/send`                                |
| 5    | AI summary (after send)         | `GET /api/quotations/:quotationId/summary`                              |
| —    | List all versions for a project | `GET /api/leads/:leadId/quotations`                                     |


**Status values:** `draft` → `sent` → `accepted` | `rejected`

After **send**, the quotation is locked. To revise, create a **new** quotation on the same lead. Use `GET /api/leads/:leadId/quotations` and pick the latest by `versionNumber` / `createdAt`.

---

## Step 1 — Prefill from lead

```http
GET /api/admin/leads/:leadId/detail
Authorization: Bearer <admin_jwt>
```

Use these lead fields to prefill the quotation form:


| Lead field                              | Use for                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `aiQuoteData.priceMin` / `priceMax`     | Suggested price range                                    |
| `aiQuoteData.details`                   | sqft, roof type, region hints                            |
| `buildingType`, `location`, `roofStyle` | Project header                                           |
| `width`, `length`, `height`             | Dimensions                                               |
| `quoteValue`                            | Pipeline estimate (separate from formal quotation price) |


Example `aiQuoteData`:

```json
{
  "aiQuoteData": {
    "priceMin": 250000,
    "priceMax": 300000,
    "complexity": 3,
    "basis": "Standard commercial 5000sqft warehouse",
    "details": { "sqft": "5000", "roofType": "Gable", "region": "Southeast" }
  }
}
```

AI data is **reference only**. Quotations are always created manually by admin/sales.

---

## Step 2 — Create quotation

```http
POST /api/quotations
Authorization: Bearer <admin_jwt>
Content-Type: application/json
```

### Required fields


| Field    | Type     | Notes                                      |
| -------- | -------- | ------------------------------------------ |
| `leadId` | ObjectId | Only field validated as required on create |


### Server-managed (do not send)


| Field                                                        | Behavior                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `customerId`                                                 | **Ignored** — taken from `lead.customerId`               |
| `quoteNumber`                                                | **Ignored** — auto-generated (`QUO-0001`, `QUO-0002`, …) |
| `createdBy`                                                  | Set to logged-in user                                    |
| `totalArea`, `totalCOGS`, `markupValue`, `finalPrice`, `psf` | **Auto-calculated** (see below)                          |


### Auto-pricing (server-side)

Never trust client values for computed pricing fields. Server calculates on create and on PUT when pricing inputs change:

```
totalArea   = width × length
totalCOGS   = materialCost + freightCost
markupValue = totalCOGS × (markupPercent / 100)
finalPrice  = totalCOGS + markupValue
psf         = finalPrice / totalArea   (null if totalArea is 0)
```

### Side effects on create

- `lead.isQuoteReady = true`
- `lead.quoteValue = quotation.basePrice` (when `basePrice` is provided)
- Audit log: `QUOTATION_CREATED`

---

## Full request body example

```json
{
  "leadId": "665a00000000000000001001",

  "proposalDate": "2026-06-15T00:00:00.000Z",
  "validity": "30 days from proposal date",
  "preparedBy": "Admin User",
  "assignedSalesperson": "665a00000000000000002001",
  "margin": 12.5,

  "buildingType": "Commercial Warehouse",
  "basePrice": 250000,
  "maxPrice": 300000,
  "sqft": "5000",
  "width": 100,
  "length": 50,
  "height": 18,
  "currency": "USD",
  "roofStyle": "Gable",
  "validTill": "2026-07-15T00:00:00.000Z",
  "location": "Austin, TX",
  "windLoad": "90 mph",
  "snowLoad": "20 psf",
  "paymentTerms": "30% deposit, 70% on delivery",
  "companyName": "Mr Storage Inc.",
  "estimatedDelivery": "12–16 weeks",

  "leftEaveHeight": 18,
  "rightEaveHeight": 18,
  "roofSlope": "1:12",

  "frameType": "Rigid Frame",
  "endwallType": "Standard",
  "girtType": "Bypass",
  "purlinType": "Z-Purlin",
  "bracingType": "Rod Bracing",

  "roofPanel": "26GA PBR",
  "wallPanelType": "26GA PBR",
  "roofColor": "Galvalume",
  "wallColor": "White",
  "trimColor": "Charcoal",
  "baseAngle": "Standard",

  "insulation": [
    { "insulationType": "roof", "thickness": "4 inch", "material": "Fiberglass" },
    { "insulationType": "wall", "thickness": "3 inch", "material": "Fiberglass" }
  ],

  "shippingCost": 8500,
  "deliveryType": "Flatbed",
  "shippingIncluded": false,

  "materialCost": 180000,
  "freightCost": 12000,
  "markupPercent": 15,

  "doors": [
    {
      "doorCategory": "rolling",
      "doorType": "Sectional",
      "size": "12x14",
      "qty": 2,
      "notes": "Motorized"
    },
    {
      "doorCategory": "personnel",
      "doorType": "Walk-in",
      "size": "3x7",
      "qty": 1,
      "notes": ""
    }
  ],

  "includedMaterials": [
    { "name": "Primary frame", "description": "Weld-ready rigid frame", "quantity": 1 },
    { "name": "Roof panels", "description": "26GA PBR panels", "quantity": 5000 }
  ],

  "optionalAddOns": [
    { "name": "Skylights", "description": "4×4 polycarbonate", "price": 4500 },
    { "name": "Gutters", "description": "Full perimeter", "price": 3200 }
  ],

  "includedComponents": [
    "Anchor bolts",
    "Trim package",
    "Erection drawings"
  ],

  "exclusions": [
    "Concrete foundation",
    "Permits and fees",
    "Crane rental"
  ],

  "specialNote": "Price valid for 30 days. Subject to site survey.",
  "clientNotes": "Customer requested white walls and charcoal trim.",
  "internalNotes": "Negotiated from AI estimate 250k–300k.",
  "priorityLevel": "high",
  "changeNote": "Initial draft",

  "status": "draft"
}
```

---

## Field reference

All fields below are optional on create except `leadId`.

### Project header


| Field                 | Type     | Default | Notes            |
| --------------------- | -------- | ------- | ---------------- |
| `proposalDate`        | ISO date | now     |                  |
| `validity`            | string   | `""`    | e.g. `"30 days"` |
| `preparedBy`          | string   | `""`    | Display name     |
| `assignedSalesperson` | ObjectId | null    | Ref `User`       |
| `margin`              | number   | `0`     |                  |


### Building / site


| Field               | Type     | Default |
| ------------------- | -------- | ------- |
| `buildingType`      | string   | `""`    |
| `basePrice`         | number   | `0`     |
| `maxPrice`          | number   | `0`     |
| `sqft`              | string   | `""`    |
| `width`             | number   | null    |
| `length`            | number   | null    |
| `height`            | number   | null    |
| `currency`          | string   | `"USD"` |
| `roofStyle`         | string   | `""`    |
| `validTill`         | ISO date | null    |
| `location`          | string   | `""`    |
| `windLoad`          | string   | `""`    |
| `snowLoad`          | string   | `""`    |
| `paymentTerms`      | string   | `""`    |
| `companyName`       | string   | `""`    |
| `estimatedDelivery` | string   | `""`    |
| `leftEaveHeight`    | number   | null    |
| `rightEaveHeight`   | number   | null    |
| `roofSlope`         | string   | `""`    |


### Structure & engineering


| Field         | Type   |
| ------------- | ------ |
| `frameType`   | string |
| `endwallType` | string |
| `girtType`    | string |
| `purlinType`  | string |
| `bracingType` | string |


### Material specifications


| Field           | Type   |
| --------------- | ------ |
| `roofPanel`     | string |
| `wallPanelType` | string |
| `roofColor`     | string |
| `wallColor`     | string |
| `trimColor`     | string |
| `baseAngle`     | string |


### Insulation

`insulation[]` — each item:


| Field            | Type                | Required |
| ---------------- | ------------------- | -------- |
| `insulationType` | `"roof"` | `"wall"` | yes      |
| `thickness`      | string              | no       |
| `material`       | string              | no       |


### Freight / shipping


| Field              | Type    | Default |
| ------------------ | ------- | ------- |
| `shippingCost`     | number  | `0`     |
| `deliveryType`     | string  | `""`    |
| `shippingIncluded` | boolean | `false` |


### COGS + pricing (inputs for auto-calc)


| Field           | Type   | Default |
| --------------- | ------ | ------- |
| `materialCost`  | number | `0`     |
| `freightCost`   | number | `0`     |
| `markupPercent` | number | `0`     |


**Computed (read-only on response):** `totalArea`, `totalCOGS`, `markupValue`, `finalPrice`, `psf`

### Doors

`doors[]` — each item:


| Field          | Type                        | Required    |
| -------------- | --------------------------- | ----------- |
| `doorCategory` | `"rolling"` | `"personnel"` | yes         |
| `doorType`     | string                      | no          |
| `size`         | string                      | no          |
| `qty`          | number                      | default `1` |
| `notes`        | string                      | no          |


### Line items & lists


| Field                | Shape                               |
| -------------------- | ----------------------------------- |
| `includedMaterials`  | `[{ name, description, quantity }]` |
| `optionalAddOns`     | `[{ name, description, price }]`    |
| `includedComponents` | `[string]`                          |
| `exclusions`         | `[string]`                          |


### Notes & meta


| Field           | Type                                 | Notes                      |
| --------------- | ------------------------------------ | -------------------------- |
| `specialNote`   | string                               | Shown on customer email    |
| `clientNotes`   | string                               | Customer-facing notes      |
| `internalNotes` | string                               | **Not** sent to customer   |
| `priorityLevel` | `low` | `medium` | `high` | `urgent` | default `medium`           |
| `status`        | `draft` | `sent`                     | default `draft` on create  |
| `changeNote`    | string                               | Version change description |


---

## Response `201` — create

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "quotation": {
      "_id": "665a00000000000000003001",
      "leadId": "665a00000000000000001001",
      "customerId": "665a00000000000000000501",
      "quoteNumber": "QUO-0042",
      "status": "draft",
      "versionNumber": 1,
      "width": 100,
      "length": 50,
      "materialCost": 180000,
      "freightCost": 12000,
      "markupPercent": 15,
      "totalArea": 5000,
      "totalCOGS": 192000,
      "markupValue": 28800,
      "finalPrice": 220800,
      "psf": 44.16,
      "createdBy": "665a00000000000000009999",
      "sentAt": null,
      "createdAt": "2026-06-15T10:00:00.000Z",
      "updatedAt": "2026-06-15T10:00:00.000Z"
    }
  }
}
```

---

## Step 3 — Get quotation

```http
GET /api/quotations/:quotationId
Authorization: Bearer <admin_jwt>
```

Returns the full quotation document.

---

## Step 3 — Edit draft

```http
PUT /api/quotations/:quotationId
Authorization: Bearer <admin_jwt>
Content-Type: application/json
```

- Only allowed while `status === "draft"` → otherwise **400** `"Only draft quotations can be edited"`
- Send any subset of editable fields (same as POST, except `quoteNumber` is never editable)
- `versionNumber` auto-increments on every save
- Pricing recalculated when `width`, `length`, `materialCost`, `freightCost`, or `markupPercent` change
- If `basePrice` changes, `lead.quoteValue` is synced

**Editable fields (PUT allow-list):**

`buildingType`, `basePrice`, `maxPrice`, `sqft`, `width`, `length`, `height`, `currency`, `roofStyle`, `validTill`, `location`, `windLoad`, `snowLoad`, `paymentTerms`, `companyName`, `estimatedDelivery`, `includedMaterials`, `optionalAddOns`, `specialNote`, `internalNotes`, `priorityLevel`, `proposalDate`, `validity`, `preparedBy`, `assignedSalesperson`, `margin`, `leftEaveHeight`, `rightEaveHeight`, `roofSlope`, `frameType`, `endwallType`, `girtType`, `purlinType`, `bracingType`, `roofPanel`, `wallPanelType`, `roofColor`, `wallColor`, `trimColor`, `baseAngle`, `insulation`, `shippingCost`, `deliveryType`, `shippingIncluded`, `materialCost`, `freightCost`, `markupPercent`, `doors`, `includedComponents`, `exclusions`, `clientNotes`, `changeNote`

---

## Step 4 — Send quotation

```http
POST /api/quotations/:quotationId/send
Authorization: Bearer <admin_jwt>
```

**No request body.**

This single call:

1. Sends Nodemailer email to the customer
2. Sets `status = "sent"`, `sentAt = now`
3. Advances `lead.lifecycleStatus` to `proposal_sent` (forward only — never regresses)
4. Generates AI plain-text summary in background (fire-and-forget)
5. Audit log: `QUOTATION_SENT`

**Response**

```json
{
  "success": true,
  "message": "Quotation sent successfully",
  "data": {
    "quotation": {
      "_id": "665a00000000000000003001",
      "status": "sent",
      "sentAt": "2026-06-15T11:30:00.000Z"
    }
  }
}
```

---

## Step 5 — AI summary

```http
GET /api/quotations/:quotationId/summary
Authorization: Bearer <admin_jwt>
```

Available after send. May return **404** briefly while AI generates.

```json
{
  "success": true,
  "data": {
    "summary": {
      "_id": "665a00000000000000004001",
      "quotationId": "665a00000000000000003001",
      "summary": "This quotation covers a 5000 sqft warehouse in Austin with a gable roof. Final price USD 220,800, delivery 12–16 weeks. Payment terms 30% deposit and 70% on delivery.",
      "generatedAt": "2026-06-15T11:30:05.000Z"
    }
  }
}
```

---

## List quotations for a project

```http
GET /api/leads/:leadId/quotations
Authorization: Bearer <admin_jwt>
```

Optional query: `startDate`, `endDate` (ISO) for date filtering.

```json
{
  "success": true,
  "data": {
    "quotations": [
      {
        "_id": "665a00000000000000003001",
        "quoteNumber": "QUO-0042",
        "status": "sent",
        "versionNumber": 3,
        "finalPrice": 220800,
        "createdAt": "2026-06-15T10:00:00.000Z",
        "createdBy": { "_id": "...", "name": "Admin User", "email": "admin@example.com" }
      }
    ]
  }
}
```

Sorted newest first (`createdAt` desc).

---

## Three different “prices” (do not mix)


| Meaning                      | Where it lives                         | How to edit                                                 |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| **Lead / pipeline value**    | `lead.quoteValue`                      | `PUT /api/admin/leads/:leadId`                              |
| **Formal quotation price**   | `Quotation.finalPrice` (+ COGS fields) | `PUT /api/quotations/:quotationId` while `status === draft` |
| **Invoice / billing amount** | `Invoice.totalAmount`, `lineItems`     | `PUT /api/invoices/:invoiceId` while `status === draft`     |


Changing `lead.quoteValue` does **not** update an existing quotation or invoice.

---

## Related admin endpoints


| Action                              | Endpoint                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Lead detail (prefill + aiQuoteData) | `GET /api/admin/leads/:leadId/detail`                                  |
| Edit lead pipeline value            | `PUT /api/admin/leads/:leadId` → `{ "quoteValue": 175000 }`            |
| Assign sales rep                    | `PUT /api/admin/leads/:leadId/assign` → `{ "employeeId": "<userId>" }` |
| Create invoice from quotation       | `POST /api/invoices` → include `quotationId`                           |
| List invoices for project           | `GET /api/leads/:leadId/invoices`                                      |


---

## Frontend checklist

- Load `GET /api/admin/leads/:leadId/detail` when opening create-quotation form
- Prefill from `aiQuoteData` + lead dimensions; let admin adjust before save
- `POST /api/quotations` with `status: "draft"` (or omit — draft is default)
- Do **not** send `customerId` or `quoteNumber`
- Show server-computed `finalPrice`, `psf`, `totalCOGS` from create/PUT response
- Allow repeated `PUT` while draft; block edits after send
- `POST .../send` with no body; then poll `GET .../summary` if needed
- For revisions after send, create a new quotation (new POST), not edit the sent one

---

## Source files


| File                                             | Purpose                                 |
| ------------------------------------------------ | --------------------------------------- |
| `src/controllers/common/quotation.controller.js` | create, update, send, summary, list     |
| `src/models/Quotation.js`                        | schema                                  |
| `src/routes/common/quotation.routes.js`          | route definitions                       |
| `src/routes/common/index.js`                     | auth guard (`admin`, `sales`)           |
| `src/utils/generateQuoteNumber.js`               | `QUO-0001` sequence                     |
| `src/config/constants.js`                        | `QUOTATION_STATUSES`, `PRIORITY_LEVELS` |


