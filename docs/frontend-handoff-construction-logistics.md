# Frontend handoff — Construction logistics APIs (Sep 2026)

**For:** Construction panel — Delivery tracking, Labels, Bundle scan, Packing lists, Dispatch verification  
**Backend:** `https://mr-storage-backend-025k.onrender.com`  
**Branch / deploy:** `shubham-changes-13-aug` · commit **`1de6bed`** (live on Render)  
**Auth:** `Authorization: Bearer <token>` · roles **`construction`** or **`admin`**

---

## What changed (summary)

| Screen | Before | Now |
|--------|--------|-----|
| **Delivery tracking** | Basic list only | **Filters API**, more query params, **`search`**, **`sortBy`**, **Excel export** |
| **Labels** | List ignored `sortBy` / limited filters | **`sortBy`**, **`status`**, **`search`**, **`enums` in response**, **export** |
| **Bundle scan** | Fixed status set; no `sortBy`/`status`/`search` | **`sortBy`**, **`status`** (UI enum), **`search`**, **export** |
| **Packing lists** | Partial filters | **`sortBy`**, full **`status`** enum, **`search`** (incl. project), export **matches list filters** |
| **Dispatch verification** | List ignored FE `sortBy`/`status` | **`sortBy`**, **`status`** (UI enum), **`search`**, **export** |

**No breaking changes** to existing list URLs — new query params are optional. New routes are additive.

---

## New endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/construction/deliveries/filters` | Dropdown data for delivery filter bar |
| GET | `/api/construction/deliveries/export` | Excel download |
| GET | `/api/construction/labels/export` | Excel download |
| GET | `/api/construction/bundle-scan/export` | Excel download |
| GET | `/api/construction/dispatch-verification/export` | Excel download |

**Already existed (updated behavior):**

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/construction/deliveries` | Extended filters + search + sort |
| GET | `/api/construction/labels` | sortBy, status, search, `enums` |
| GET | `/api/construction/bundle-scan` | sortBy, status, search, `enums` |
| GET | `/api/construction/packing-lists` | sortBy, search, `enums`; export aligned |
| GET | `/api/construction/packing-lists/export` | Same query as list |
| GET | `/api/construction/dispatch-verification` | sortBy, status, search, `enums` |

**Unchanged (reference for dispatch flow):**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/construction/dispatch-verification/:loadId` | Load detail + bundles |
| POST | `/api/construction/dispatch-verification/:loadId/verify-load` | Mark weight/loading verified |
| POST | `/api/construction/dispatch-verification/:loadId/confirm-dispatch` | Dispatch after verify |

---

## 1. Delivery tracking

### List

```http
GET /api/construction/deliveries?page=1&limit=20&sortBy=Latest&search=DEL-2026
```

**Query parameters**

| Param | Type | Notes |
|-------|------|--------|
| `search` | string | Matches delivery #, material type, description, load title (`loadDescription`), site location |
| `status` or `deliveryStatus` | string | e.g. `scheduled`, `confirmed`, `in_transit`, `delivered`, … (not `draft`) |
| `leadId` or `projectId` | ObjectId | Filter by project |
| `materialType` | string | Exact |
| `siteDestination` | string | Substring on delivery location |
| `transporter` | string | Carrier name (substring) |
| `driver` | string | Driver/contact name (substring) |
| `startDate`, `endDate` | ISO date | Filter on `deliveryDate` |
| `sortBy` | enum | `Latest` (default), `Oldest`, `Weight`, `DeliveryDate` |
| `page`, `limit` | number | Pagination |

### Filters (populate dropdowns)

```http
GET /api/construction/deliveries/filters
```

**Response includes:** `deliveryStatuses`, `siteDestinations`, `transporters`, `drivers`, `sortBy`, and `relatedEnums` for other logistics screens.

### Export

```http
GET /api/construction/deliveries/export?<same query as list>
```

- **Content-Type:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Filename:** `construction-deliveries.xlsx`
- **FE pattern:** blob download; pass the **same** query string as the current list/filter state.

---

## 2. Label printing

### List

```http
GET /api/construction/labels?page=1&limit=10&sortBy=Latest&status=pending&search=
```

**`sortBy` enum:** `Latest` · `Oldest` · `Weight` · `BundleNo`

**`status` enum (two modes):**

1. **Label UI (recommended for print queue):** `pending` · `printed` · `all`  
   - `pending` → label not printed  
   - `printed` → `labelPrinted === true`
2. **Or bundle lifecycle:** `draft`, `confirmed`, `assigned_to_truck`, `staged`, `loaded`

**`search`:** bundle number, bundle title, project name, job ID  

**Response:** `{ bundles, total, stats, page, limit, enums: { sortBy, labelStatus, bundleStatus } }`

### Export

```http
GET /api/construction/labels/export?<same query as list>
```

→ `bundle-labels.xlsx`

---

## 3. Bundle scan

### List

```http
GET /api/construction/bundle-scan?page=1&limit=10&sortBy=Weight&status=pending&search=
```

**`sortBy` enum:** `Latest` · `Oldest` · `Weight`

| `sortBy` | Server sort |
|----------|-------------|
| `Latest` | `updatedAt` descending (default) |
| `Oldest` | `updatedAt` ascending |
| `Weight` | `totalWeight` descending |

**`status` enum (UI — send these from the app):**

| Value | Meaning (bundle DB statuses) |
|-------|------------------------------|
| `pending` | `draft`, `confirmed` |
| `staged` | `staged` |
| `on_truck` | `assigned_to_truck` |
| `loaded` | `loaded` |
| `all` | All of the above |

**`search`:** same as labels (bundle #, title, project).

**Response:** `{ bundles, total, stats, page, limit, enums: { sortBy, status } }`

### Export

```http
GET /api/construction/bundle-scan/export?<same query as list>
```

→ `bundle-scan.xlsx`

---

## 4. Packing lists

### List

```http
GET /api/construction/packing-lists?page=1&limit=10&sortBy=Latest&status=confirmed&search=
```

**`sortBy` enum:** `Latest` · `Oldest` · `Weight` · `PackingListNo`

**`status` enum (DB — use for filter pills):**

`draft` · `confirmed` · `ready` · `loading` · `delivery_created` · `dispatched` · `delivered` · `cancelled`

**`search`:** packing list #, truck label, truck number, destination, project name, job ID  
**`leadId`:** optional project scope

**Response:** `{ packingLists, total, stats, page, limit, enums: { sortBy, status } }`

### Export

```http
GET /api/construction/packing-lists/export?<same query as list>
```

→ `packing-lists.xlsx`

---

## 5. Dispatch verification

### List

```http
GET /api/construction/dispatch-verification?page=1&limit=10&sortBy=Oldest&status=pending&search=
```

**`sortBy` enum:** `Latest` · `Oldest` · `Weight` · `PackingListNo`

**`status` enum (UI — not the same as packing list status):**

| Value | Meaning |
|-------|---------|
| `pending` | `weightVerified` or `loadingVerified` is false |
| `verified` | Both verified, status not yet `dispatched` |
| `dispatched` | Packing list status is `dispatched` |
| `all` | All loads in dispatch workflow |

**`search`:** packing list #, truck, destination (and project via backend join).

**Response:** `{ loads, total, stats, page, limit, enums: { sortBy, status } }`  
Each load row includes `weightVerified`, `loadingVerified` where applicable.

### Export

```http
GET /api/construction/dispatch-verification/export?<same query as list>
```

→ `dispatch-verification.xlsx`

### Detail — `GET /dispatch-verification/:loadId`

Use **`loadId`** = packing list `_id` from the list row.

**Returns:** truck, destination, planned vs actual weight, verification flags, **array of bundles** (bundle #, weight, status, `verified`).

**Use for:** dispatch verification detail screen.

### Verify load — `POST /dispatch-verification/:loadId/verify-load`

```json
{ "actualWeight": 55789.2 }
```

`actualWeight` is optional. Sets `weightVerified` and `loadingVerified` to **true**. Does **not** set status to dispatched.

### Confirm dispatch — `POST /dispatch-verification/:loadId/confirm-dispatch`

Empty body or `{}`. **Requires** verify step first. Sets packing list status to **`dispatched`**.

**Suggested FE flow:** List → Detail → Verify load → Confirm dispatch.

---

## Search cheat sheet

| Endpoint | `search` matches |
|----------|-------------------|
| `/deliveries` | Delivery #, material, descriptions, site location |
| `/labels`, `/bundle-scan` | Bundle #, title, project name, jobId |
| `/packing-lists`, `/dispatch-verification` | PL #, truck, destination, project name, jobId |

---

## Export implementation (all screens)

1. Build query string from current filters (same as list API).
2. `GET` the export URL with `responseType: 'blob'` (axios) or `fetch` → `blob()`.
3. Trigger browser download from blob; use filename from `Content-Disposition` if present.

Example base:

```text
https://mr-storage-backend-025k.onrender.com/api/construction/deliveries/export?status=scheduled&sortBy=Latest
```

---

## Optional: bind enums from API

Several list responses include **`data.enums`** so the app does not hard-code filter options:

- Labels → `sortBy`, `labelStatus`, `bundleStatus`
- Bundle scan → `sortBy`, `status`
- Packing lists → `sortBy`, `status`
- Dispatch verification → `sortBy`, `status`
- Deliveries filters endpoint → full dropdown payload

---

## Related docs (same repo)

- [`frontend-construction-logistics-api.md`](./frontend-construction-logistics-api.md) — compact API reference  
- [`frontend-construction-add-delivery-api.md`](./frontend-construction-add-delivery-api.md) — Add Delivery modal  
- [`frontend-construction-manufacturing-api.md`](./frontend-construction-manufacturing-api.md) — Project manufacturing reads  

---

**Questions / issues:** If a filter returns empty unexpectedly, confirm enum casing (`Latest` not `latest`) and that export uses the identical query as the list call.
