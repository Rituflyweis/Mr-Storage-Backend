# EstimateId-first quoting (FE handoff)

**Status:** **Built** — backend routes live.  
**Audience:** Frontend (Ahmadullah) + Sales quoting owners.  
**Goal:** Upload shipper (or Storage COG) **once** with `leadId` → get `estimateId` → all later work keys off that id only. Never re-send `fileBase64` or a fat extract blob after step 1.

---

## 1. Target shape (shipped)

```text
User picks lead + uploads shipper file
        │
        ▼
POST  …/estimates/from-shipper
  body: { leadId, fileBase64, fileName?, job options… }
        │
        ▼
Server: parse → price → create EstimateQuote (draft)
        │
        ▼
Returns: { estimateId, squareFootage, pricing summary, estimate… }
        │
        ▼
Everything else uses estimateId only
  (incl. POST …/estimates/:estimateId/compute)
```

### FE rule (after step 1)

| Do | Don’t |
|----|--------|
| `GET /estimates/:estimateId` to hydrate UI | Re-post `fileBase64` on compute / preview / save |
| Small option bodies on `POST /:estimateId/compute` / `PUT` | Thread full `parsedCategories` on every call |
| Preview / PDF / milestones with `{ estimateId }` or path `/:estimateId/...` | Build preview from a stale client-only blob after save |
| New file upload → new estimate (or explicit “replace shipper” later) | Treat extract response as the long-lived source of truth |

---

## 2. New APIs

Base: `/api/sales/estimates` (auth required).

### 2a. PEMB — create draft from shipper

```http
POST /api/sales/estimates/from-shipper
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "leadId": "<mongoId>",
  "fileBase64": "<xlsx base64>",
  "fileName": "Paris TN.xlsx",
  "jobType": "PEMB",
  "scope": "both",
  "roof": "SD",
  "steelFinish": "red-iron",
  "companyBrand": "SBD"
}
```

**201 response `data` (key fields):**

| Field | Notes |
|-------|--------|
| `estimateId` | Use for all subsequent calls |
| `estimate` | Full draft document (totals applied) |
| `squareFootage` / `squareFootageMeta` | Same as extract-shipper |
| `parsedCategories`, `pricing`, `fullQuote`, weights | For initial UI paint; do not re-post file |

Lead header (company, email, address, job #) is filled from the lead/customer when omitted on the body.

### 2b. Storage — create draft from COG

```http
POST /api/sales/estimates/from-storage-cog
```

Same idea: `{ leadId, fileBase64, fileName?, … }` → draft with `jobType: "Storage"`, `storageData` + `storagePricing` stored.

### 2c. Recompute by estimate id

```http
POST /api/sales/estimates/:estimateId/compute
```

**Body:** small options only (no file, no required `parsedCategories`). Examples:

```json
{
  "squareFootage": 1505,
  "sf": 1505,
  "scope": "both",
  "steelFinish": "galvalume",
  "roof": "SSR",
  "install": "medium",
  "blendPct": 50,
  "salesTax": { "rate": 0.0825 },
  "cogsOverride": null
}
```

- Uses stored `parsedCategories` (PEMB) or `storageData` (Storage).
- Only **`draft`** estimates can be recomputed.
- Response: `{ estimateId, estimate, pricing?, fullQuote? }` or storage pricing for Storage jobs.

---

## 3. What still exists (legacy / optional)

| Capability | Path | Notes |
|------------|------|--------|
| Extract only (no create) | `POST …/extract-shipper`, `…/extract-storage-cog` | Still available if FE needs preview-before-save |
| Stateless compute | `POST …/compute`, `…/compute-storage` | Still needs categories / storageData in body |
| Create draft manually | `POST …/estimates` | Unchanged |
| Load / update / delete | `GET\|PUT\|DELETE …/:estimateId` | Unchanged |
| Preview / PDF / milestones by id | `…/:estimateId/documents/*`, milestones, deposit | Unchanged |

---

## 4. Call map after `estimateId`

| Action | Request | Status |
|--------|---------|--------|
| Open / refresh | `GET /estimates/:estimateId` | Ready |
| Change SF / markup / finish | `POST /estimates/:estimateId/compute` | **Ready** |
| Apply concrete / tax / addons / margin | `PUT /estimates/:estimateId` | Ready |
| Deposit / milestones | `PUT …/:estimateId/deposit`, `…/milestones` | Ready |
| Quote HTML / PDF | `…/:estimateId/documents/preview\|pdf` | Ready |
| Replace shipper on same draft | TBD | Not built — new file → new estimate for now |

---

## 5. FE checklist

- [x] First step: lead + file → `estimateId` via `from-shipper` / `from-storage-cog`
- [x] After id exists, UI never sends `fileBase64` again unless user uploads a **new** file
- [x] Preview / PDF / milestones / history use **`estimateId` only**
- [x] Recompute: `POST …/:estimateId/compute` with small options
- [ ] Confirm product: new shipper file = **new estimate** (replace API later)

---

## 6. Related docs

- Extract/compute details: [`pemb-quoting-extraction-api.md`](./pemb-quoting-extraction-api.md)
- Integration narrative: [`../quoting-tool-frontend-integration-flow.md`](../quoting-tool-frontend-integration-flow.md)
- Milestone / history by id: [`milestone-payments-quote-preview.md`](./milestone-payments-quote-preview.md)
- Shipper SF/weight extract: [`shipper-weight-sf-updated-response.md`](./shipper-weight-sf-updated-response.md)
