# Freight / Awarded Loads — search by client & project (FE)

**Date:** 29 Oct 2026  
**Auth:** `Authorization: Bearer <plant|admin token>`

Plant and admin share the same handlers. Use `/api/plant/...` or `/api/admin/plant/...`.

---

## What changed

`search` query param now matches:

| Match | Fields |
|-------|--------|
| **Client** | Customer first name, last name, full name (`"Jane Doe"`), email |
| **Project** | Lead `projectName`, `jobId` |

Also still matches existing fields on each endpoint (delivery # / locations / token / carrier where those lists already supported them).

No new endpoints. No path changes. Pass `search` as before.

---

## Endpoints

| Screen | Method | Path |
|--------|--------|------|
| Freight Loads (delivery rows) | `GET` | `…/deliveries/freight` |
| Awarded Loads (delivery rows) | `GET` | `…/deliveries/awarded` |
| Freight Loads (bid rows) | `GET` | `…/freight-loads` |
| Awarded Loads (bid rows) | `GET` | `…/awarded-loads` |
| Exports | `GET` | `…/freight-loads/export`, `…/awarded-loads/export` |

---

## Query

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Free text — client name and/or project name / job id |

Other filters unchanged (`page`, `limit`, `projectId`, `customerId`, `carrierId`, dates, `status`, etc.).

---

## Examples

```http
GET /api/plant/deliveries/freight?page=1&limit=20&search=Jane
GET /api/admin/plant/deliveries/awarded?search=Warehouse
GET /api/plant/freight-loads?search=John%20Doe
GET /api/admin/plant/awarded-loads?search=PRO-001
```

```bash
BASE=https://mr-storage-backend-025k.onrender.com/api/plant
TOKEN=…

curl -s "$BASE/deliveries/freight?search=Jane" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/deliveries/awarded?search=Warehouse" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/freight-loads?search=John%20Doe" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/awarded-loads?search=PRO-001" -H "Authorization: Bearer $TOKEN"
```

Admin: swap `/api/plant` → `/api/admin/plant`.

---

## FE wiring

1. Bind the search input to query param `search`.
2. Debounce → refetch list (and export with the same `search` if used).
3. Clear `search` to show the full list again.
4. Optional: keep using `projectId` / `customerId` dropdowns for exact filters; `search` is free-text across client + project.

---

## Related docs

- Freight loads API: [`docs/frontend-freight-loads-api.md`](../frontend-freight-loads-api.md)  
- Awarded loads API: [`docs/frontend-awarded-loads-api.md`](../frontend-awarded-loads-api.md)  
