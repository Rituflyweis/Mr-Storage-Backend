# SM Quoting Tool — Backend API Integration Guide (v7)

A guide for integrating the **Mr-Storage-Backend** quoting APIs into a React frontend.
Every payload below is taken from the backend's actual controller output (verified by
`scripts/test-v7-flow.js`).

---

## 1. Basics

**Base URL** — your deployment, e.g. `https://mr-storage-backend-025k.onrender.com`
**Prefix** — sales users call `/api/sales/...`; admins may use `/api/admin/...` (same handlers).
This guide uses `${BASE}/api/sales`.

**Auth** — JWT Bearer on every call except login. Header: `Authorization: Bearer <accessToken>`.

**Response envelope** — every endpoint (except the two "store read" endpoints, see §9) wraps data:
```json
{ "success": true, "message": "Change order created", "data": { /* payload */ } }
```
**Error envelope**
```json
{ "success": false, "message": "amount is required" }
```
HTTP codes: `200` ok, `201` created, `400` bad request, `401` unauthorized (bad/expired token),
`403` forbidden (not owner/admin), `404` not found.

**Content-Type** — `application/json` for all bodies here (file uploads are sent base64 in JSON, not multipart).

---

## 2. Auth

### POST `${BASE}/api/auth/login`
Request
```json
{ "email": "travis@sm.com", "password": "secret" }
```
Response
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "role": "admin",
    "user": { "_id": "U1", "name": "Travis", "email": "travis@sm.com", "role": "admin", "isMainAdmin": true }
  }
}
```
Store `accessToken` (and `user`) client-side. On `401`, call `POST /api/auth/refresh` with
`{ "refreshToken }` to get a new `accessToken`, then retry.

### Minimal React API client
```js
// api.js
const BASE = import.meta.env.VITE_API_BASE; // e.g. https://...onrender.com
let token = localStorage.getItem('sm_token') || '';

export function setToken(t) { token = t; localStorage.setItem('sm_token', t); }

export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`${BASE}/api/sales${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.message || `HTTP ${res.status}`);
  return raw ? json : json.data;        // `raw` for the store endpoints in §9
}

export async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json?.data?.accessToken) throw new Error(json.message || 'Login failed');
  setToken(json.data.accessToken);
  return json.data.user;
}
```

---

## 3. PEMB quoting flow (shipper → compute → documents)

The canonical flow: **upload shipper → get pricing → tweak controls (re-compute) → generate documents**.

### 3.1 POST `/estimates/extract-shipper`
Parse an Xshipper `.xlsx` (base64) and return parsed categories + first pricing pass.
Request
```json
{
  "fileBase64": "<base64 of .xlsx>",
  "fileName": "acme-shipper.xlsx",
  "scope": "both",
  "roof": "screw-down",
  "install": "medium",
  "steelFinish": "red-iron",
  "blendPct": 50,
  "useManualSquareFootage": false,
  "squareFootage": 0
}
```
Response `data` (abridged)
```json
{
  "fileName": "acme-shipper.xlsx",
  "sheetCount": 7,
  "tabSummary": [ { "name": "Rigid Frames", "weightLbs": 42310, "category": "primary" } ],
  "totalWeightLbs": 64800,
  "squareFootage": 7200,
  "squareFootageMeta": { "selected": 7200, "source": "weight_formula", "formula": "round(totalWeightLbs / 9)" },
  "parsedCategories": { "primary": { "weight": 42310 }, "secondary": { "weight": 8900 }, "sheeting": { "weight": 9100 }, "...": {} },
  "weightByCategory": [ { "category": "Rigid Frames & Endwalls", "weightLbs": 42310, "rate": 1.71, "price": 72350.1 } ],
  "pricing": { /* see 3.2 */ },
  "fullQuote": { /* see 3.2 */ }
}
```
> Keep `parsedCategories` in state — it's the input to `/estimates/compute` for every live re-price.

### 3.2 POST `/estimates/compute`
Re-price when any control changes (scope, sliders, markups, steel finish, add-ons, staircase…).
Request
```json
{
  "parsedCategories": { "primary": { "weight": 42310 }, "secondary": { "weight": 8900 }, "sheeting": { "weight": 9100 } },
  "scope": "both",
  "roof": "screw-down",
  "install": "medium",
  "squareFootage": 7200,
  "blendPct": 50,
  "steelFinish": "red-iron",
  "matMuOverride": null,
  "freightOverride": null,
  "pembDrawings": 0,
  "pembIncludeErection": false,
  "deletedRowKeys": [],
  "concrete": { "include": true, "costSF": 7.25, "marginPct": 25 },
  "insulation": { "include": false },
  "salesTax": { "include": true, "rate": 7.0 },
  "pembAddOns": [ { "item": "Skylights", "cost": 1200, "markupPct": 25, "inQuote": true, "inSow": true } ],
  "staircase": { "count": 2, "unitCost": 35000, "stories": 2 }
}
```
Response `data`
```json
{
  "weightByCategory": [ /* ... */ ],
  "pricing": {
    "rows": [ { "cat": "primary", "label": "Rigid Frames & Endwalls", "wt": 42310, "rate": "$1.71/lb", "price": 72350.1, "_rowId": "Rigid_Frames___Endwalls__primary__0" } ],
    "matCost": 150000, "totWt": 64800, "freight": 8424, "trucks": 2,
    "instCost": 39600, "instSell": 61200,
    "totCost": 198024, "matSell": 205200, "totSell": 266400,
    "profit": 68376, "profPct": "25.7", "sfPrice": "37.00", "sf": 7200,
    "scope": "both", "roof": "screw-down", "blendLabel": "50% Quicken blend", "matMuApplied": 1.3
  },
  "fullQuote": {
    "buildingSubtotal": 266400,
    "concrete": { "include": true, "appliedSell": 69600, "profit": 17400 },
    "insulation": { "include": false },
    "salesTax": { "include": true, "rate": 7.0, "amount": 23534 },
    "pembAddOns": [ /* normalized */ ], "pembAddOnTotals": { "sell": 1500, "profit": 300 },
    "staircase": { "count": 2, "unitCost": 35000, "staircaseSell": 70000, "include": true },
    "grandTotal": 431034, "pricePerSf": "59.87", "totalProfit": 86076, "grandMargin": 20.0
  }
}
```
Key fields the UI shows: `fullQuote.grandTotal`, `fullQuote.grandMargin`, `pricing.totSell`,
`pricing.profPct`, `pricing.sfPrice`.

### 3.3 Documents
- `POST /estimates/documents/preview` → `{ quoteHtml, sowHtml, contractHtml, assembledHtml }` (strings; render in an iframe).
- `POST /estimates/documents/pdf` → `{ fileName, mimeType, fileBase64, sizeBytes }` (assembled PDF).

Body for either: the compute payload **plus** `pricingResult`/`fullQuote` (or `{ "estimateId": "<id>" }`
to pull a saved one), and optional `sections: ["quote","sow","contract","drawings"]`.

### 3.4 Other PEMB helpers
- `POST /estimates/cogs/preview` — body `{ pricingResult, cogsOverride }` → `{ preview }`
- `POST /estimates/margin/preview` — body `{ pricingResult, marginOverride }` → `{ preview }`
- `GET  /estimates/tax-lookup/:zip` → `{ zip, rate, jurisdiction }`
- `POST /estimates/extract-drawing` — body `{ fileBase64 }` (prelim PDF) → extracted fields

---

## 4. Storage flow
- `POST /estimates/extract-storage-cog` — body `{ fileBase64 }` → `{ buildings, doors, extras, storagePricing }`
- `POST /estimates/compute-storage` — body `{ storageData, shipping, drawings, installSellPerSf, installCostPerSf }` → `{ storagePricing }`

---

## 4.5 Saved estimates, pricing rules & history

### Estimate CRUD — `/estimates`
- `GET /estimates?jobType=&status=&search=&leadId=&page=1&limit=20` → `{ estimates: [...], pagination: { total, page, limit } }`. Sales users see only their own; admins see all. List rows omit heavy fields (categories, breakdown, drawings) for speed.
- `POST /estimates` — save a full quote. Body = the §3.2 compute payload **plus** `leadCompanyName`, `customerEmail`, `jobNumber`, `buildingSize`, `cityStateZip`, and optional `depositTerms`, `milestoneSchedule`, `multiStory`, `companyBrand`, `status`. Returns `{ estimate }` with all computed totals.
- `GET /estimates/:id` → `{ estimate }` (full, incl. `conversion` meta). `PUT /estimates/:id` (draft only — recomputes on save). `DELETE /estimates/:id`.
- `POST /estimates/:id/documents/pdf` — assembled PDF for a **saved** estimate (same output as `/documents/pdf`, but pulls the stored quote by id).

### Pricing Rules — `/pricing-rules`  (the "Pricing Rules" page; per-user rate table)
- `GET /pricing-rules` → `{ pricingRules: { ownerId, primary, secondary, hss, angle, opening, plate, sheet, ss, freight, truck, pembMu, storMu, bdCost, bdSell, ndCost, ndSell, cfCost, cfSell, redIron, galvSteel, mandoor, screwEach, "...": "all rates", customTabRules: [ { matchType, match, cat, method, rate } ] } }`. Auto-created with v7 defaults on first call.
- `PUT /pricing-rules` — body = any subset of fields to change → `{ pricingRules }`. These rates drive every `/compute` and `/extract-shipper` for that user, so load them when the quoting screen mounts and re-fetch after a save.

### History / dashboard summary — `GET /estimates/history/summary`
```json
{
  "thisMonth":   { "totalQuotes": 8,  "totalValue": 3250000,  "totalProfit": 712000,   "avgMargin": 21.9 },
  "thisQuarter": { "totalQuotes": 23, "totalValue": 9100000,  "totalProfit": 1980000,  "avgMargin": 21.4 },
  "ytd":         { "totalQuotes": 61, "totalValue": 24500000, "totalProfit": 5300000,  "avgMargin": 21.6 },
  "allTime":     { "totalQuotes": 140,"totalValue": 52000000, "totalProfit": 11200000, "avgMargin": 21.5 },
  "profitByCategory": [ { "jobType": "PEMB", "totalProfit": 9100000, "count": 110 }, { "jobType": "Storage", "totalProfit": 2100000, "count": 30 } ]
}
```
Sales users get their own numbers; admins get the whole org. (Numbers above are illustrative.)

---

## 5. Change Orders — `/change-orders`

### POST `/change-orders/preview` (stateless math, no save)
Request
```json
{ "origVal": 512500, "amount": 15000, "cost": 11000 }
```
Response `data`
```json
{ "origVal": 512500, "amount": 15000, "cost": 11000, "newTotal": 527500, "profit": 4000, "margin": 26.7 }
```
> Derive the sell from a markup instead: send `{ "origVal": 512500, "cost": 11000, "markup": 25 }`
> and `amount` comes back as `round(cost / (1 - markup/100))`.

### POST `/change-orders` (create)
Request
```json
{
  "estimateId": "EST1",
  "customer": "Acme Steel Co",
  "origDate": "June 1, 2026",
  "amount": 15000,
  "cost": 11000,
  "description": "Added one 30x50 bay + upgraded roof panel",
  "company": "SM"
}
```
> `amount` and `description` are required. `coNum` is assigned automatically (running from the last CO's
> `newTotal`, else the base quote total). Use `parentQuoteRef` instead of `estimateId` to attach a CO to a
> client-side quote id (the history library) rather than a stored estimate.

Response `data` (`201`)
```json
{
  "_id": "id_1", "estimateQuoteId": "EST1", "parentQuoteRef": "", "coNum": 1,
  "customer": "Acme Steel Co", "origDate": "June 1, 2026", "origVal": 512500,
  "amount": 15000, "cost": 11000, "profit": 4000, "margin": 26.7, "newTotal": 527500,
  "description": "Added one 30x50 bay + upgraded roof panel", "company": "SM",
  "employeeName": "Travis", "employeeRole": "admin"
}
```

### GET `/change-orders?estimateId=EST1`  (or `?parentQuoteRef=<id>`)
Response `data` → `{ "items": [ /* COs ascending by coNum */ ], "count": 1 }`

### PUT `/change-orders/:coId` — recomputes from the merged fields. DELETE `/change-orders/:coId` → `{ deleted: true }`.

### POST `/change-orders/:coId/pdf`
- Body `{ "format": "html" }` → `{ html }` (render in iframe / print).
- Body `{}` → `{ fileName, mimeType: "application/pdf", fileBase64, sizeBytes }`.
- Inline (no save): `POST /change-orders/pdf` with `{ co: {...}, priorCOs: [...], baseOrigVal }`.

---

## 6. Custom Quotes — `/custom-quotes`

### POST `/custom-quotes/preview`
Request
```json
{ "matCost": 100000, "freight": 5000, "laborCost": 20000, "marginPct": 20 }
```
Response `data`
```json
{ "matCost": 100000, "freight": 5000, "laborCost": 20000, "marginPct": 20, "sellOverride": null,
  "totalCost": 125000, "sell": 156250, "profit": 31250, "profPct": 20 }
```
> `sell = sellOverride || totalCost / (1 - marginPct/100)`. Send `sellOverride` to fix the price.

### POST `/custom-quotes` (create)
Request
```json
{
  "customer": "Bluebird LLC", "location": "Lincoln, NE", "size": "40x60x14",
  "scope": "both", "expDays": 15,
  "matCost": 100000, "freight": 5000, "laborCost": 20000, "marginPct": 20,
  "inclusions": ["PEMB kit", "Delivery"],
  "exclusions": ["Concrete", "Permits"],
  "sow": { "overview": "Supply + erect", "delivery": "8-10 weeks", "terms": "Net 30" },
  "additional": "Crane access required on site"
}
```
Response `data` (`201`) — the stored doc incl. computed `{ totalCost, sell, profit, profPct }` and `_id`.

### GET `/custom-quotes` → `{ items, count }` · GET/PUT/DELETE `/custom-quotes/:id`
### POST `/custom-quotes/:id/pdf` → PDF (or `{ "format": "html" }` for HTML). Inline: `POST /custom-quotes/pdf` with the full body.

---

## 7. Deposits, Milestones, Multi-story

### Previews (stateless)
`POST /estimates/deposit/preview`
```json
// req: { "grand": 512500, "pct": 30 }   (or { "grand": 512500, "flat": 200000 })
// res data:
{ "grand": 512500, "pct": 30, "deposit": 153750, "balance": 358750 }
```
`POST /estimates/milestones/preview`
```json
// req:
{ "grand": 500000, "rows": [ { "label": "Deposit", "amount": 150000 }, { "label": "Fabrication", "amount": 200000 }, { "label": "Delivery", "amount": 150000 } ] }
// res data:
{ "grand": 500000, "rows": [ /* +type:"fixed" */ ], "scheduled": 500000, "remaining": 0, "pct": 100, "fullyScheduled": true }
```
`POST /estimates/staircase/preview`
```json
// req: { "count": 2, "unitCost": 35000, "stories": 2 }
// res data: { "count": 2, "unitCost": 35000, "staircaseSell": 70000, "stories": 2, "include": true }
```

### Persist on an estimate (owner/admin only)
- `PUT /estimates/:estimateId/deposit` — body `{ pct?, flat?, note?, grand? }` → saved `depositTerms`
- `PUT /estimates/:estimateId/milestones` — body `{ rows: [...], note?, grand? }` → `{ rows, scheduled, remaining, pct }`
- `PUT /estimates/:estimateId/multi-story` — body `{ count, unitCost?, stories? }` → saved `multiStory`
> When `grand` is omitted the backend uses the estimate's own `fullQuoteResult.grandTotal`.

### Document PDFs
- `POST /estimates/documents/deposit-receipt/pdf` — body `{ estimateId }` **or** `{ quote: {...}, grand, pct|flat, note }`
- `POST /estimates/documents/milestones/pdf` — body `{ estimateId }` **or** `{ quote, grand, rows, note }`
Both return `{ fileName, mimeType, fileBase64, sizeBytes }` (or `{ html }` with `"format":"html"`).

---

## 8. Users roster (for an assignee / "prepared by" dropdown)
`GET /estimates/users`
```json
{ "items": [
  { "id": "U1", "name": "Travis", "email": "travis@sm.com", "role": "admin", "displayRole": "Owner", "isManager": true },
  { "id": "U2", "name": "Casey",  "email": "casey@sm.com",  "role": "sales", "displayRole": "Estimator", "isManager": false }
], "count": 2 }
```

---

## 9. Quote library (shared history) — `/quotes-store`

This is the server-side replacement for the old Firebase cache. The library is **shared** across
authenticated users. Records are stored verbatim — the frontend owns the record shape.

> ⚠️ The two GET endpoints return a **raw keyed object** (id → record), **not** the `{success,data}`
> envelope — this matches the old Firebase format. Use `raw: true` in the client helper, and read the
> object directly. The PUT/DELETE endpoints use the normal envelope.

### GET `/quotes-store/quotes` → `{ "<id>": record, ... }`
Quote record shape the UI reads/writes (HTML blob is stripped before saving):
```json
{
  "id": "1730000000001",
  "employee_name": "Travis",
  "customer": "Acme Steel Co",
  "grand_total": 512500,
  "profit": 120000,
  "sf": 7200,
  "status": "Draft",
  "updated_at": "2026-10-27T12:00:00Z",
  "state_data": { "jobType": "PEMB", "customer": "Acme Steel Co", "grandTotal": 512500, "...": "full client state" }
}
```
- `PUT /quotes-store/quotes/:id` — body = the full record (upsert) → `{ ok: true, id }`
- `DELETE /quotes-store/quotes/:id` → `{ ok: true, id }`
- `GET /quotes-store/change-orders` → `{ "<id>": coRecord }`
- `PUT /quotes-store/change-orders/:id`, `DELETE /quotes-store/change-orders/:id`

React example (note `raw`):
```js
// list history
const quotesObj = await api('/quotes-store/quotes', { raw: true });   // { id: record }
const quotes = Object.values(quotesObj).sort((a,b) => (b.updated_at||'').localeCompare(a.updated_at||''));
// save a quote
await api(`/quotes-store/quotes/${rec.id}`, { method: 'PUT', body: rec });
```

> **Two ways to store change orders.** The `/change-orders` model (§5) gives server-side math, numbering,
> and PDF. The `/quotes-store/change-orders` endpoint just persists the client CO blob alongside its quote
> (what the bundled HTML uses). Pick one per screen — for a fresh React build, prefer the structured
> `/change-orders` API.

---

## 10. React patterns

### A compute hook (debounced live re-price)
```js
function useCompute(parsedCategories, controls) {
  const [quote, setQuote] = useState(null);
  useEffect(() => {
    if (!parsedCategories) return;
    const t = setTimeout(async () => {
      const data = await api('/estimates/compute', { method: 'POST', body: { parsedCategories, ...controls } });
      setQuote(data); // { pricing, fullQuote, weightByCategory }
    }, 250);
    return () => clearTimeout(t);
  }, [parsedCategories, controls]);
  return quote;
}
```

### Download a PDF returned as base64
```js
function downloadBase64Pdf({ fileBase64, fileName, mimeType }) {
  const bytes = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}
// const pdf = await api(`/change-orders/${coId}/pdf`, { method: 'POST', body: {} });
// downloadBase64Pdf(pdf);
```

### Render an HTML document in an iframe (preview)
```js
const { html } = await api(`/custom-quotes/${id}/pdf`, { method: 'POST', body: { format: 'html' } });
<iframe srcDoc={html} style={{ width: '100%', height: '80vh', border: 0 }} />
```

### Upload a shipper file (base64 in JSON)
```js
const b64 = await new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej;
  r.readAsDataURL(file);
});
const data = await api('/estimates/extract-shipper', { method: 'POST', body: { fileBase64: b64, fileName: file.name, scope, roof, install, steelFinish } });
```

---

## 11. Endpoint quick reference  (all prefixed with `${BASE}/api/sales`)

| Area | Method & path | Purpose |
|---|---|---|
| Auth | `POST /api/auth/login` | get JWT (note: under `/api/auth`, not `/api/sales`) |
| Shipper | `POST /estimates/extract-shipper` | parse xlsx → categories + pricing |
| Compute | `POST /estimates/compute` | live PEMB re-price |
| Storage | `POST /estimates/extract-storage-cog` · `POST /estimates/compute-storage` | storage quotes |
| Overrides | `POST /estimates/cogs/preview` · `POST /estimates/margin/preview` | cost/margin previews |
| Tax | `GET /estimates/tax-lookup/:zip` | sales-tax rate |
| Docs | `POST /estimates/documents/preview` · `/documents/pdf` | quote/SOW/contract |
| Estimates CRUD | `GET/POST /estimates` · `GET/PUT/DELETE /estimates/:id` · `POST /estimates/:id/documents/pdf` | saved estimates |
| Pricing rules | `GET/PUT /pricing-rules` | per-user rate table (Pricing page) |
| History | `GET /estimates/history/summary` | dashboard totals (month/qtr/ytd/all) |
| Deposit | `POST /estimates/deposit/preview` · `PUT /estimates/:id/deposit` · `POST /estimates/documents/deposit-receipt/pdf` | deposits |
| Milestones | `POST /estimates/milestones/preview` · `PUT /estimates/:id/milestones` · `POST /estimates/documents/milestones/pdf` | billing schedule |
| Multi-story | `POST /estimates/staircase/preview` · `PUT /estimates/:id/multi-story` | staircase costing |
| Users | `GET /estimates/users` | roster |
| Change orders | `POST /change-orders/preview` · `GET/POST /change-orders` · `PUT/DELETE /change-orders/:coId` · `POST /change-orders/:coId/pdf` | COs |
| Custom quotes | `POST /custom-quotes/preview` · `GET/POST /custom-quotes` · `GET/PUT/DELETE /custom-quotes/:id` · `POST /custom-quotes/:id/pdf` | custom quotes |
| Library | `GET/PUT/DELETE /quotes-store/quotes[/:id]` · `GET/PUT/DELETE /quotes-store/change-orders[/:id]` | shared history (raw keyed objects) |

---

*Verification: `node scripts/test-v7-parity.js` (formula parity) and `node scripts/test-v7-flow.js`
(request→controller→response flow with an in-memory store) both pass. Shapes above are captured from
those runs and the controller source. Compute §3.2 numbers are illustrative; run a real shipper to get exact values.*
