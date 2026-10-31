# Custom Quote — document preview API & full schemas

Handoff for **HTML preview**, **PDF**, and **JSON shapes**. CRUD + form wiring stay in [`custom-quote-api.md`](./custom-quote-api.md).

**Base paths**

| Role | Prefix |
|------|--------|
| Sales | `/api/sales/custom-quotes` |
| Admin | `/api/admin/custom-quotes` |

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Envelope:** `{ "success": true, "message": "...", "data": { } }` · errors `{ "success": false, "message": "..." }`

**Render:** `https://mr-storage-backend-025k.onrender.com` · branch `shubham-changes-13-aug` (`f1a3e29`+)

---

## 1. PEMB vs custom — which preview route?

| Action | PEMB / Storage | Custom quote |
|--------|----------------|--------------|
| Load detail | `GET /api/sales/estimates/:estimateId` | `GET /api/sales/custom-quotes/:id` |
| History fallback | `GET /estimates/:id` may return `quoteKind: "custom"` + `customQuote` | Prefer `custom-quotes` GET |
| **Document preview** | `GET\|POST …/estimates/:estimateId/documents/preview` | **`GET\|POST …/custom-quotes/:id/preview`** |
| PDF | `POST …/estimates/:estimateId/documents/pdf` | `POST …/custom-quotes/:id/pdf` |

If history opens `/estimates/<id>` and the row has `quoteKind: "custom"`, do **not** call estimate document preview — use `custom-quotes/:id/preview`.

---

## 2. Document preview (primary)

Use for quote preview panel, history detail, print view.

### 2.1 GET — saved quote, no body

```http
GET /api/sales/custom-quotes/:id/preview
Authorization: Bearer <token>
```

### 2.2 POST — optional logo override

```http
POST /api/sales/custom-quotes/:id/preview
Authorization: Bearer <token>
Content-Type: application/json

{ "company": "SBD" }
```

`company`: `"SM"` \| `"SBD"` (defaults to saved `company` on the quote).

### 2.3 Response `200`

```json
{
  "success": true,
  "message": "Custom quote preview",
  "data": {
    "html": "<!DOCTYPE html><html>…<div class=\"quote-output\">…</div>…</html>",
    "quoteKind": "custom",
    "customQuoteId": "6ae5b3bd6fc20e73c10d08cf"
  }
}
```

| Field | Type | Notes |
|-------|------|--------|
| `html` | string | Full printable HTML (`quote-output` wrapper) |
| `quoteKind` | `"custom"` | Always on this route |
| `customQuoteId` | ObjectId | Same as saved `_id` |

**Errors:** `404` — unknown id; sales user does not own quote (admin can read all).

**Frontend:** inject `data.html` into iframe / shadow DOM / print window (same as PEMB `quoteHtml` from estimate preview).

**curl**

```bash
curl -s "https://mr-storage-backend-025k.onrender.com/api/sales/custom-quotes/6ae5b3bd6fc20e73c10d08cf/preview" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.html' > preview.html
```

---

## 3. Pricing preview (no HTML, no DB)

Live **Calculate** only — not the document preview.

```http
POST /api/sales/custom-quotes/preview
```

**Request**

```json
{
  "matCost": 100000,
  "freight": 5000,
  "laborCost": 20000,
  "marginPct": 20,
  "sellOverride": null
}
```

**Response `200` — `data` shape**

| Field | Type | Notes |
|-------|------|--------|
| `matCost` | number | Normalized |
| `freight` | number | |
| `laborCost` | number | |
| `marginPct` | number | Default 20 |
| `sellOverride` | number \| null | |
| `totalCost` | number | Rounded |
| `sell` | number | Rounded |
| `profit` | number | Rounded |
| `profPct` | number | One decimal |

Formula: `totalCost = mat + freight + labor`; `sell = sellOverride` if &gt; 0 else `totalCost / (1 - marginPct/100)`.

---

## 4. PDF & HTML via `/pdf` routes

Same HTML generator as §2. Use when you already integrated PDF endpoints only.

| Method | Path | Body | Result |
|--------|------|------|--------|
| `POST` | `/:id/pdf` | omit `format` | PDF base64 |
| `POST` | `/:id/pdf` | `{ "format": "html" }` | `{ html }` only (no `quoteKind`) |
| `POST` | `/pdf` | full quote fields (like create) | PDF or HTML from unsaved body |

### 4.1 HTML via PDF route

```json
{
  "success": true,
  "message": "Custom quote HTML",
  "data": {
    "html": "<!DOCTYPE html>..."
  }
}
```

### 4.2 PDF response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "fileName": "estimate-Bluebird_LLC.pdf",
    "mimeType": "application/pdf",
    "fileBase64": "JVBERi0xLjcK...",
    "sizeBytes": 48210
  }
}
```

Frontend: decode `fileBase64` → `Blob` → download.

---

## 5. Endpoint index (preview-related)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/preview` | Pricing math only |
| **`GET`** | **`/:id/preview`** | **Document HTML (saved id)** |
| **`POST`** | **`/:id/preview`** | **Document HTML; optional `{ company }`** |
| `POST` | `/:id/pdf` | PDF or `{ format: "html" }` |
| `POST` | `/pdf` | PDF/HTML from inline body (no save) |

Full CRUD examples: [`custom-quote-api.md` §5](./custom-quote-api.md).

---

## 6. Schema — `CustomQuote` (saved document)

Returned by create / get / update / list `items[]`.

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|--------|
| `_id` | ObjectId | auto | — | Use as `customQuoteId` in history |
| `createdBy` | ObjectId | yes | — | User ref |
| `leadId` | ObjectId \| null | no | `null` | CRM lead |
| `customer` | string | no | `""` | Prepared-for / company |
| `location` | string | no | `""` | City, state |
| `size` | string | no | `""` | Building description |
| `scope` | string | no | `"both"` | `supply` \| `both` \| `install` |
| `expDays` | number | no | `15` | Quote expiration days |
| `matCost` | number | no | `0` | |
| `freight` | number | no | `0` | |
| `laborCost` | number | no | `0` | |
| `marginPct` | number | no | `20` | Target margin % |
| `sellOverride` | number \| null | no | `null` | If &gt; 0, wins over margin formula |
| `totalCost` | number | no | `0` | **Computed** on save |
| `sell` | number | no | `0` | **Computed** |
| `profit` | number | no | `0` | **Computed** |
| `profPct` | number | no | `0` | **Computed** |
| `inclusions` | string[] | no | `[]` | Scope bullets |
| `exclusions` | string[] | no | `[]` | |
| `sow.overview` | string | no | `""` | |
| `sow.delivery` | string | no | `""` | |
| `sow.terms` | string | no | `""` | |
| `additional` | string | no | `""` | Free text |
| `company` | string | no | `"SM"` | `SM` \| `SBD` |
| `status` | string | no | `"Draft"` | |
| `employeeName` | string | no | `""` | From JWT on create/update |
| `employeeRole` | string | no | `""` | From JWT |
| `createdAt` | ISO date | auto | — | |
| `updatedAt` | ISO date | auto | — | |

### 6.1 Create / update request body

Same fields as above **except** omit: `_id`, `createdBy`, `employeeName`, `employeeRole`, `createdAt`, `updatedAt`.

Computed fields may be sent but are **recomputed** on save.

**Aliases:** `sow_overview`, `sow_delivery`, `sow_terms` instead of `sow.*`.

**Lines:** `inclusions` / `exclusions` may be a newline **string**; API normalizes to `string[]`.

### 6.2 Example GET `data` (full document)

```json
{
  "_id": "6ae5b3bd6fc20e73c10d08cf",
  "createdBy": "671e99887766554433221100",
  "leadId": "6ae2f9ad092ad19ea4e41889",
  "customer": "Bluebird LLC",
  "location": "Lincoln, NE",
  "size": "40x60x14",
  "scope": "both",
  "expDays": 15,
  "matCost": 100000,
  "freight": 5000,
  "laborCost": 20000,
  "marginPct": 20,
  "sellOverride": null,
  "totalCost": 125000,
  "sell": 156250,
  "profit": 31250,
  "profPct": 20,
  "inclusions": ["Supply and delivery of PEMB"],
  "exclusions": ["Foundation and concrete"],
  "sow": { "overview": "…", "delivery": "…", "terms": "…" },
  "additional": "",
  "company": "SM",
  "status": "Draft",
  "employeeName": "Casey",
  "employeeRole": "sales",
  "createdAt": "2026-10-30T12:00:00.000Z",
  "updatedAt": "2026-10-30T12:00:00.000Z"
}
```

---

## 7. Schema — history row (`GET /api/sales/estimates`)

Custom quotes are merged into the estimate list.

| Field | Value for custom |
|-------|------------------|
| `quoteKind` | `"custom"` |
| `customQuoteId` | same as `_id` |
| `jobType` | `"Custom"` |
| `leadCompanyName` | `customer` |
| `cityStateZip` | `location` |
| `buildingSize` | `size` |
| `grandTotal` | `sell` |
| `totalSell` | `sell` |
| `profit` | `profit` |
| `marginPercent` | `profPct` |
| `conversion` | Not linked to `Quotation` yet |

Filter: `GET /api/sales/estimates?jobType=Custom` · KPIs: `GET /api/sales/estimates/history/summary`.

---

## 8. React snippet (document preview)

```js
const { html, quoteKind, customQuoteId } = await api(
  `/custom-quotes/${id}/preview`,
  { method: 'GET', token }
);
// Render html in iframe; branch UI on quoteKind === 'custom'
```

Pricing calculate: `POST /custom-quotes/preview` — see §3.

---

## 9. FE checklist (preview)

- [ ] History / detail: `quoteKind === "custom"` → `GET /custom-quotes/:id/preview`, not estimate documents preview  
- [ ] Optional brand toggle → `POST /:id/preview` with `{ company }`  
- [ ] Calculate button → `POST /preview` (pricing only, no `html`)  
- [ ] PDF download → `POST /:id/pdf` without `format`  

---

## 10. Convert to quotation (approval path)

Custom quotes are **not** `EstimateQuote` rows — do **not** call `from-estimate` with a custom `_id`.

```http
POST /api/quotations/from-custom-quote/:customQuoteId
Authorization: Bearer <token>
Content-Type: application/json

{ "leadId": "<optional if already on custom quote>" }
```

**Response `201`** — `{ quotation, sourceCustomQuote, requiresSubmitForApproval }` (same approval flow as PEMB).

**Errors**

| Case | Message |
|------|---------|
| Wrong route (`from-estimate` + custom id) | `400` — use `from-custom-quote` |
| No lead | `400` — provide `body.leadId` |
| Missing / not owned | `404` Custom quote not found |

---

*Last updated: 2026-10-31*
