# Construction panel — logistics (deliveries, labels, scan, packing, dispatch)

**Base:** `https://mr-storage-backend-025k.onrender.com/api/construction`  
**Auth:** Bearer token · roles `construction` | `admin`

List responses include an **`enums`** object (where noted) so the app can bind filters without hard-coding.

---

## 1. Delivery tracking

### List

`GET /deliveries`

| Query | Notes |
|-------|--------|
| `search` | `deliveryNumber`, `materialType`, `description`, `loadDescription`, `deliveryLocation` |
| `status` or `deliveryStatus` | Any non-`draft` value from `DELIVERY_STATUSES` |
| `leadId` / `projectId` | Project filter |
| `materialType` | Exact match |
| `siteDestination` | Substring on `deliveryLocation` |
| `transporter`, `driver` | Resolved via freight carrier / bid |
| `startDate`, `endDate` | On `deliveryDate` |
| `sortBy` | `Latest` (default), `Oldest`, `Weight`, `DeliveryDate` |
| `page`, `limit` | Pagination |

### Filter dropdowns

`GET /deliveries/filters` → `deliveryStatuses`, `siteDestinations`, `transporters`, `drivers`, `sortBy`, plus related enums for other logistics screens.

### Export

`GET /deliveries/export` — same query params as list → Excel (`construction-deliveries.xlsx`).

---

## 2. Label printing

### List

`GET /labels?sortBy=Latest&status=pending&search=&page=1&limit=10`

| Query | Notes |
|-------|--------|
| `sortBy` | `Latest`, `Oldest`, `Weight`, `BundleNo` |
| `status` | **Label UI:** `pending` \| `printed` \| `all` — **or** bundle DB status: `draft`, `confirmed`, `assigned_to_truck`, `staged`, `loaded` |
| `search` | `bundleNo`, `title`, project name / `jobId` |
| `leadId` | Optional project scope |

### Export

`GET /labels/export` — same filters → `bundle-labels.xlsx`.

---

## 3. Bundle scan

### List

`GET /bundle-scan?sortBy=Weight&status=pending&search=&page=1&limit=10`

| `sortBy` | Sort |
|----------|------|
| `Latest` | `updatedAt` desc (default) |
| `Oldest` | `updatedAt` asc |
| `Weight` | `totalWeight` desc |

| `status` (UI) | Maps to bundle statuses |
|---------------|-------------------------|
| `pending` | `draft`, `confirmed` |
| `staged` | `staged` |
| `on_truck` | `assigned_to_truck` |
| `loaded` | `loaded` |
| `all` | All of the above |

`search` — same as labels (bundle #, title, project).

### Export

`GET /bundle-scan/export` — same query → `bundle-scan.xlsx`.

---

## 4. Packing lists

### List

`GET /packing-lists?sortBy=Latest&status=confirmed&search=&page=1&limit=10`

| `sortBy` | `Latest`, `Oldest`, `Weight`, `PackingListNo` |
| `status` | `draft`, `confirmed`, `ready`, `loading`, `delivery_created`, `dispatched`, `delivered`, `cancelled` |
| `search` | `packingListNo`, truck label/no, destination, project name / jobId |
| `leadId` | Optional |

### Export

`GET /packing-lists/export` — same query → `packing-lists.xlsx` (already existed; now aligned with list filters).

---

## 5. Dispatch verification

### List

`GET /dispatch-verification?sortBy=Oldest&status=pending&page=1&limit=10`

| `sortBy` | `Latest`, `Oldest`, `Weight`, `PackingListNo` |
| `status` (UI) | Meaning |
|---------------|---------|
| `pending` | Load not fully verified (`weightVerified` or `loadingVerified` false) |
| `verified` | Both verified, not yet `dispatched` |
| `dispatched` | Packing list status `dispatched` |
| `all` | All loads in dispatch workflow |

`search` — packing list #, truck, destination.

### Export

`GET /dispatch-verification/export` — same query → `dispatch-verification.xlsx`.

### Detail — `GET /dispatch-verification/:loadId`

Returns one **load** (packing list): truck, destination, planned vs actual weight, verification flags, and **per-bundle** rows (`bundleNo`, weight, status, `verified`).

Use for the dispatch verification **detail** screen before sign-off.

### Verify load — `POST /dispatch-verification/:loadId/verify-load`

Body (optional): `{ "actualWeight": 55789.2 }`

Sets `weightVerified` and `loadingVerified` to true, stores `actualWeight`, `verifiedAt`, `verifiedBy`. Required before **confirm dispatch**.

Does **not** change packing list status to dispatched by itself.

### Confirm dispatch — `POST /dispatch-verification/:loadId/confirm-dispatch`

Requires load to be verified first. Sets packing list `status` to `dispatched` and `dispatchedAt`.

---

## Search summary

| Endpoint | Search fields |
|----------|----------------|
| `/deliveries` | Delivery #, material, descriptions, site location |
| `/labels`, `/bundle-scan` | Bundle #, title, project name, jobId |
| `/packing-lists`, `/dispatch-verification` | PL #, truck, destination, project name, jobId |

Export endpoints honor the **same** query string as their list API.
