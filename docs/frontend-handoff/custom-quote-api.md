# Frontend handoff — Custom Quote API

Wire the **Custom Quote** screen (manual estimate, no shipper file) to the backend.

**Reference UI (source of truth for fields + math + document layout):**

| File | What to mirror |
|------|----------------|
| [`SM-QuotingTool-API.html`](../../SM-QuotingTool-API.html) | Sidebar → **Custom Quote** (`#page-custom`) |
| Same file · `cogsCalcCustom()` / `renderCustomQuote()` | Live calc + printable HTML (~L8600–8720) |
| Backend port | `src/services/quoting/customQuoteEngine.js`, `customQuoteDocument.js` |

**Related:** document preview + **full JSON schemas** → [`custom-quote-preview-schemas-fe.md`](./custom-quote-preview-schemas-fe.md) · full v7 quoting [`docs/API_INTEGRATION.md`](../API_INTEGRATION.md) · PEMB [`pemb-quoting-extraction-api.md`](./pemb-quoting-extraction-api.md)

---

## 1. What Custom Quote is

Build a sell price from **manual costs + target margin** (or a fixed sell override).  
No Excel shipper parse, no PEMB weight engine.

**Formula (exact, HTML + API):**

```
totalCost = matCost + freight + laborCost
sell      = sellOverride  OR  totalCost / (1 - marginPct/100)
profit    = sell - totalCost
profPct   = profit / sell * 100
```

---

## 2. Base URL & auth

| Environment | API base |
|-------------|----------|
| **Render** | `https://mr-storage-backend-025k.onrender.com` |
| **Local** | `http://localhost:5001` |

| Role | Prefix |
|------|--------|
| Sales | `/api/sales/custom-quotes` |
| Admin | `/api/admin/custom-quotes` (same handlers) |

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Login: `POST /api/auth/login` → use `data.accessToken`.

**Envelope**

```json
{ "success": true, "message": "...", "data": { } }
```

```json
{ "success": false, "message": "..." }
```

---

## 3. UI → API field map

Mirror these inputs from `SM-QuotingTool-API.html` `#page-custom`:

| HTML element id | API field | Notes |
|-----------------|-----------|--------|
| `cq-customer` | `customer` | Company / prepared-for |
| `cq-location` | `location` | City, State |
| `cq-size` | `size` | e.g. `80x120x16 PEMB` |
| `cq-scope` | `scope` | `supply` \| `both` \| `install` |
| `cq-mat-cost` | `matCost` | number |
| `cq-freight` | `freight` | number |
| `cq-labor-cost` | `laborCost` | number |
| `cq-margin-pct` | `marginPct` | default `20` |
| `cq-sell-override` | `sellOverride` | optional; if > 0 wins over margin |
| `cq-expdays` | `expDays` | default `15` |
| `cq-inclusions` | `inclusions` | array of strings (or newline string; API normalizes) |
| `cq-exclusions` | `exclusions` | same |
| (SOW fields) | `sow.overview` / `sow.delivery` / `sow.terms` | optional |
| (notes) | `additional` | optional free text |
| — | `company` | `"SM"` or `"SBD"` (logo/brand on PDF) |
| — | `leadId` | optional link to CRM lead |
| — | `status` | default `"Draft"` |

**HTML buttons**

| Button | Suggested API |
|--------|----------------|
| **Calculate** | `POST .../preview` → show sell / profit / margin |
| **Generate Quote** | create (or preview PDF/HTML) → show document |

---

## 4. Recommended frontend flow

```
┌─────────────────┐
│ Login (JWT)     │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Fill form       │  (customer, costs, margin / sellOverride, scope lines)
└────────┬────────┘
         ▼
┌─────────────────┐
│ POST /preview   │  ← live “Calculate” (no DB write)
└────────┬────────┘
         ▼
┌─────────────────┐
│ POST /          │  ← Save draft (optional leadId)
└────────┬────────┘
         ▼
┌─────────────────┐
│ GET|POST        │  ← Document HTML preview (saved id)
│ /:id/preview    │     PEMB equivalent: …/estimates/:id/documents/preview
└────────┬────────┘
         ▼
┌─────────────────┐
│ POST /:id/pdf   │  ← PDF download (or POST /pdf inline body)
└─────────────────┘
```

List / edit / delete from a “My custom quotes” screen using GET/PUT/DELETE.

**Quote history (unified):** Saved custom quotes also appear on  
`GET /api/sales/estimates` (same table as PEMB/Storage) with:

| Field | Value |
|-------|--------|
| `quoteKind` | `"custom"` |
| `customQuoteId` | same as `_id` |
| `jobType` | `"Custom"` |
| `leadCompanyName` | `customer` |
| `grandTotal` | `sell` |

Open row → custom quote editor (`/custom-quotes/:id`), not estimate routes.  
Filter: `?jobType=Custom`. Dashboard KPIs: `GET /estimates/history/summary` includes custom quotes.

**Preview & schemas:** see [`custom-quote-preview-schemas-fe.md`](./custom-quote-preview-schemas-fe.md) (`GET|POST /:id/preview`, full `CustomQuote` + history shapes).

---

## 5. Endpoints (examples)

Base path below: `${BASE}/api/sales/custom-quotes`

### 5.1 Preview math (no persist)

`POST /preview`

**Request**

```json
{
  "matCost": 100000,
  "freight": 5000,
  "laborCost": 20000,
  "marginPct": 20
}
```

With fixed sell:

```json
{
  "matCost": 100000,
  "freight": 5000,
  "laborCost": 20000,
  "marginPct": 20,
  "sellOverride": 160000
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Custom quote preview",
  "data": {
    "matCost": 100000,
    "freight": 5000,
    "laborCost": 20000,
    "marginPct": 20,
    "sellOverride": null,
    "totalCost": 125000,
    "sell": 156250,
    "profit": 31250,
    "profPct": 20
  }
}
```

> Example: `125000 / (1 - 0.20) = 156250`.

---

### 5.2 Create (save)

`POST /`

**Request**

```json
{
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
  "inclusions": [
    "Supply and delivery of PEMB",
    "All trim and accessories",
    "Anchor bolt plan"
  ],
  "exclusions": [
    "Foundation and concrete",
    "Electrical and plumbing"
  ],
  "sow": {
    "overview": "Supply and erect pre-engineered metal building per plans.",
    "delivery": "8–10 weeks after deposit and approved drawings.",
    "terms": "Net 30 on progress billings."
  },
  "additional": "Crane access required on site.",
  "company": "SM",
  "status": "Draft",
  "leadId": null
}
```

**Response `201`**

```json
{
  "success": true,
  "message": "Custom quote created",
  "data": {
    "_id": "671f0a1b2c3d4e5f67890123",
    "createdBy": "671e...",
    "leadId": null,
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
    "inclusions": [
      "Supply and delivery of PEMB",
      "All trim and accessories",
      "Anchor bolt plan"
    ],
    "exclusions": [
      "Foundation and concrete",
      "Electrical and plumbing"
    ],
    "sow": {
      "overview": "Supply and erect pre-engineered metal building per plans.",
      "delivery": "8–10 weeks after deposit and approved drawings.",
      "terms": "Net 30 on progress billings."
    },
    "additional": "Crane access required on site.",
    "company": "SM",
    "status": "Draft",
    "employeeName": "Casey",
    "employeeRole": "sales",
    "createdAt": "2026-10-28T07:30:00.000Z",
    "updatedAt": "2026-10-28T07:30:00.000Z"
  }
}
```

Server stamps `employeeName` / `employeeRole` from the JWT user and recomputes `totalCost` / `sell` / `profit` / `profPct`.

---

### 5.3 List

`GET /`

**Response `200`**

```json
{
  "success": true,
  "message": "Custom quotes",
  "data": {
    "items": [ /* same shape as create data */ ],
    "count": 1
  }
}
```

**Sales:** only quotes where `createdBy = current user`.  
**Admin:** all custom quotes.

---

### 5.4 Get one

`GET /:id`

**Response `200`** — `{ success, message, data: <CustomQuote> }` — full field list in [`custom-quote-preview-schemas-fe.md` §6](./custom-quote-preview-schemas-fe.md).

**404** if missing. **403** if sales user does not own the quote.

---

### 5.5 Update

`PUT /:id`

**Request** — partial or full body (same fields as create). Server merges, recomputes sell/profit.

**Response `200`** — updated doc in `data`.

---

### 5.6 Delete

`DELETE /:id`

**Response `200`**

```json
{
  "success": true,
  "message": "Custom quote deleted",
  "data": { "deleted": true }
}
```

---

### 5.7 Document preview & PDF

→ [`custom-quote-preview-schemas-fe.md`](./custom-quote-preview-schemas-fe.md) (§2 document preview, §4 PDF/HTML).

Quick ref: **`GET|POST /custom-quotes/:id/preview`** → `{ html, quoteKind, customQuoteId }`.

---

## 6. Minimal React integration sketch

```js
const BASE = import.meta.env.VITE_API_BASE; // https://mr-storage-backend-025k.onrender.com
const sales = `${BASE}/api/sales`;

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${sales}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || res.statusText);
  return json.data;
}

// Calculate button
const preview = await api('/custom-quotes/preview', {
  method: 'POST',
  token,
  body: { matCost, freight, laborCost, marginPct, sellOverride },
});
// preview.sell, preview.profit, preview.profPct

// Save
const saved = await api('/custom-quotes', {
  method: 'POST',
  token,
  body: { customer, location, size, scope, expDays, matCost, freight, laborCost, marginPct, sellOverride, inclusions, exclusions, sow, additional, company: 'SM' },
});

// Document preview (preferred — same as history detail)
const { html } = await api(`/custom-quotes/${saved._id}/preview`, {
  method: 'GET',
  token,
});

// Or PDF route with format html (equivalent HTML)
// const { html } = await api(`/custom-quotes/${saved._id}/pdf`, {
//   method: 'POST', token, body: { format: 'html' },
// });
```

---

## 7. Scope values (HTML `<select id="cq-scope">`)

| Value | Label in UI / PDF |
|-------|-------------------|
| `supply` | Supply & Delivery Only |
| `both` | Supply, Delivery & Installation |
| `install` | Installation Only |

---

## 8. Checklist for FE

- [ ] Login → store JWT; call all routes with Bearer token  
- [ ] Form fields match table in §3 (same ids/semantics as HTML)  
- [ ] Calculate → `POST /preview` (pricing only)  
- [ ] Save → `POST /`; show `_id`, `sell`, `profit`  
- [ ] **Preview panel → `GET /custom-quotes/:id/preview`** (not `/estimates/.../documents/preview`)  
- [ ] History row: if `quoteKind === "custom"` → custom routes + editor  
- [ ] PDF download → `POST /:id/pdf` (no format) or inline `POST /pdf`  
- [ ] Pass `leadId` when opened from a lead  
- [ ] Compare totals against HTML tool **Custom Quote** page for the same inputs  

---

## 9. Not the same as

| Feature | Path | Notes |
|---------|------|--------|
| PEMB / shipper quote | `/api/sales/estimates/...` | Excel extract + pricing engine |
| Quote History library | `/api/sales/quotes-store/...` | Shared MVP quote library (HTML Save to History) |
| Change orders | `/api/sales/change-orders` | Adjustments on an existing quote |

Custom Quote is a **separate** resource: free-form costs → sell. Do not send shipper `parsedCategories` here.

---

*Last updated: 2026-10-31 — preview/schemas in [`custom-quote-preview-schemas-fe.md`](./custom-quote-preview-schemas-fe.md).*
