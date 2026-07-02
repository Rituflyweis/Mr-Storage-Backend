# Staff Page Activity — Frontend Integration Guide

Track **UI navigation** across staff panels (Admin, Sales, Plant, Accounts, Construction): log page visits from each panel app and read per-user last active time, last page, and last visit per panel.

**Backend model:** `src/models/UserPageActivity.js`  
**Backend service:** `src/services/pageActivity.service.js`  
**Last updated:** 2026-06-30

---

## Overview

| Concern | Detail |
|---------|--------|
| **Purpose** | Know where staff users are in the app (route-level), not CRM business actions |
| **Storage** | One rolling snapshot document per user (`UserPageActivity`) — not a full visit history |
| **Panels** | Frontend apps keyed by role: `admin`, `sales`, `plant`, `account`, `construction` |
| **User ID** | Always taken from JWT on write — never send `userId` in the POST body |

### vs employee audit log

| Feature | Page activity (this doc) | Employee audit log |
|---------|--------------------------|-------------------|
| Endpoint | `POST /api/activity/page-visit` | — |
| Admin list | `GET /api/admin/activity/page-visits` | `GET /api/admin/employees/audit-log` |
| Tracks | UI route navigation | CRM actions (quotation, invoice, lead update, …) |
| Source | `UserPageActivity` | `AuditLog` |

Use **both** on the admin employees screen: audit log for “last CRM action”, page activity for “last seen on Sales → /leads”.

---

## Common conventions

| Item | Value |
|------|--------|
| **Base URL (production)** | `https://flyweistechnology.com` |
| **Base URL (local)** | `http://localhost:<PORT>` |
| **Auth** | `Authorization: Bearer <jwt_token>` |
| **Success wrapper** | `{ "success": true, "message": "...", "data": { ... } }` |
| **Error wrapper** | `{ "success": false, "message": "..." }` |
| **Validation errors** | `{ "success": false, "message": "...", "errors": [ ... ] }` |

### Panel values (`panel` field)

Must match one of the staff role slugs:

| `panel` value | UI label |
|---------------|----------|
| `admin` | Admin |
| `sales` | Sales |
| `construction` | Construction |
| `plant` | Plant |
| `account` | Accounts |

Each panel frontend app sends its **own fixed** `panel` value on every log call.

### Page value (`page` field)

Frontend route path string, e.g. `/dashboard`, `/leads`, `/leads/665a…/detail`.  
Max length: **500** characters.

---

## Index

| # | Method | Endpoint | Role | Purpose |
|---|--------|----------|------|---------|
| 1 | POST | `/api/activity/page-visit` | All staff | Log a page visit |
| 2 | GET | `/api/activity/me` | All staff | Current user’s activity snapshot |
| 3 | GET | `/api/admin/activity/page-visits` | `admin` | All users’ activity (paginated) |

---

## Data model — `UserPageActivity`

One document per staff user (created on first page visit).

| Field | Type | Description |
|-------|------|-------------|
| `userId` | ObjectId | Ref `User` (unique) |
| `lastActiveAt` | ISO date \| null | Most recent visit in any panel |
| `panels.<role>.lastVisitedAt` | ISO date | Last visit in that panel |
| `panels.<role>.lastPage` | string | Last route in that panel |
| `lastPage.panel` | string | Panel of the most recent visit globally |
| `lastPage.page` | string | Route of the most recent visit globally |
| `lastPage.visitedAt` | ISO date | Timestamp of the most recent visit globally |

Panels with no visits return `null` in API responses (not empty objects).

---

# 1. `POST /api/activity/page-visit`

| | |
|---|---|
| **Roles** | `admin`, `sales`, `construction`, `plant`, `account` |
| **UI** | Call on route change from any staff panel app |

### Path parameters

None.

### Request body

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `panel` | string | Yes | One of: `admin`, `sales`, `construction`, `plant`, `account` |
| `page` | string | Yes | Route path, non-empty, max 500 chars |

`userId` is **not** accepted — the server uses `req.user._id` from the JWT.

### Example request

```http
POST /api/activity/page-visit
Authorization: Bearer <staff_jwt>
Content-Type: application/json

{
  "panel": "sales",
  "page": "/leads/665a00000000000000001001"
}
```

### Response `data`

```json
{
  "lastActiveAt": "2026-06-30T10:15:00.000Z",
  "panel": "sales",
  "page": "/leads/665a00000000000000001001"
}
```

### Errors

| Status | When |
|--------|------|
| 401 | Missing or invalid JWT |
| 403 | Role not in allowed staff roles |
| 400 | Invalid `panel` or missing/empty `page` |

### Server behavior

Upserts `UserPageActivity` for the authenticated user:

1. Sets `lastActiveAt` to now
2. Updates `panels.<panel>.lastVisitedAt` and `panels.<panel>.lastPage`
3. Sets global `lastPage` to `{ panel, page, visitedAt: now }`

---

# 2. `GET /api/activity/me`

| | |
|---|---|
| **Roles** | `admin`, `sales`, `construction`, `plant`, `account` |
| **UI** | Optional — show current user their own last activity |

### Path parameters

None.

### Query parameters

None.

### Request body

None.

### Example request

```http
GET /api/activity/me
Authorization: Bearer <staff_jwt>
```

### Response `data`

```json
{
  "userId": "665a00000000000000000101",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "role": "sales",
  "panel": "Sales",
  "lastActiveAt": "2026-06-30T10:15:00.000Z",
  "lastPage": {
    "panel": "sales",
    "page": "/leads/665a00000000000000001001",
    "visitedAt": "2026-06-30T10:15:00.000Z"
  },
  "panels": {
    "admin": null,
    "sales": {
      "lastVisitedAt": "2026-06-30T10:15:00.000Z",
      "lastPage": "/leads/665a00000000000000001001"
    },
    "construction": null,
    "plant": {
      "lastVisitedAt": "2026-06-29T14:00:00.000Z",
      "lastPage": "/projects"
    },
    "account": null
  }
}
```

| Field | Notes |
|-------|--------|
| `panel` | Human label for the user’s **assigned role** (not necessarily the panel they last visited) |
| `lastPage` | Most recent page across **all** panels |
| `panels.<role>` | Last visit in that panel, or `null` if never visited |

If the user has never logged a page visit, `lastActiveAt`, `lastPage`, and all `panels.*` values are `null`.

---

# 3. `GET /api/admin/activity/page-visits`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin → Employees (or activity dashboard) — user-wise last active + per-panel breakdown |

### Path parameters

None.

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `role` | string | No | Filter users by role: `admin`, `sales`, `construction`, `plant`, `account` |
| `isActive` | string | No | `true` or `false` — filter by `User.isActive` |
| `search` | string | No | Name or email (case-insensitive) |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20`, max `100` |

### Request body

None.

### Example requests

```http
GET /api/admin/activity/page-visits?page=1&limit=20
GET /api/admin/activity/page-visits?role=sales&isActive=true
GET /api/admin/activity/page-visits?search=jane&page=1&limit=20
```

### Response `data`

Sorted by **`lastActiveAt` descending** (users with no activity last, then alphabetically by name).

```json
{
  "items": [
    {
      "userId": "665a00000000000000000101",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "role": "sales",
      "panel": "Sales",
      "lastActiveAt": "2026-06-30T10:15:00.000Z",
      "lastPage": {
        "panel": "sales",
        "page": "/leads/665a00000000000000001001",
        "visitedAt": "2026-06-30T10:15:00.000Z"
      },
      "panels": {
        "admin": null,
        "sales": {
          "lastVisitedAt": "2026-06-30T10:15:00.000Z",
          "lastPage": "/leads/665a00000000000000001001"
        },
        "construction": null,
        "plant": null,
        "account": null
      }
    },
    {
      "userId": "665a00000000000000000202",
      "name": "New Hire",
      "email": "new@example.com",
      "role": "plant",
      "panel": "Plant",
      "lastActiveAt": null,
      "lastPage": null,
      "panels": {
        "admin": null,
        "sales": null,
        "construction": null,
        "plant": null,
        "account": null
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

| Field | Notes |
|-------|--------|
| `panel` | Label for the user’s assigned **role** |
| `lastActiveAt` | Last navigation event in any panel |
| `lastPage` | Global most recent page (any panel) |
| `panels.<role>` | Per-panel last visit, or `null` |

---

## Frontend integration

### Log visits (all panel apps)

Call on meaningful route changes. Debounce (~30s) or dedupe identical `{ panel, page }` to reduce noise.

```javascript
const PANEL = 'sales' // fixed per app build

async function logPageVisit(pathname) {
  await fetch(`${API_BASE}/api/activity/page-visit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ panel: PANEL, page: pathname }),
  })
}

// React Router example
useEffect(() => {
  logPageVisit(location.pathname)
}, [location.pathname])
```

### Admin roster

```javascript
const res = await fetch(
  `${API_BASE}/api/admin/activity/page-visits?role=sales&page=1&limit=20`,
  { headers: { Authorization: `Bearer ${adminToken}` } }
)
const { data } = await res.json()
// data.items — user rows
// data.pagination — page, limit, total
```

### Suggested UI columns (admin)

| Column | Source field |
|--------|----------------|
| Name / email | `name`, `email` |
| Role | `panel` or `role` |
| Last active | `lastActiveAt` |
| Last page | `lastPage.page` (+ `lastPage.panel` if cross-panel) |
| Last Sales visit | `panels.sales?.lastVisitedAt` |
| Last Plant visit | `panels.plant?.lastVisitedAt` |
| Last Accounts visit | `panels.account?.lastVisitedAt` |

---

## Frontend checklist

### All staff panels (Admin, Sales, Plant, Accounts, Construction)

- [ ] Set a constant `panel` value matching the app (`sales`, `plant`, etc.)
- [ ] On route change → `POST /api/activity/page-visit` with `{ panel, page: pathname }`
- [ ] Do **not** send `userId` in the body
- [ ] Optional: debounce or skip duplicate consecutive paths

### Admin panel

- [ ] Load roster via `GET /api/admin/activity/page-visits`
- [ ] Support filters: `role`, `isActive`, `search`, pagination
- [ ] Show `lastActiveAt` and per-panel columns from `panels`
- [ ] Optionally combine with `GET /api/admin/employees/audit-log` for CRM last action

---

## Edge cases

| Case | Behavior |
|------|----------|
| User never visited any page | `lastActiveAt`, `lastPage`, and all `panels.*` are `null` |
| User visits same page again | Snapshot overwritten; timestamps refresh |
| User switches panels | Each panel block updated independently; `lastPage` reflects the latest global visit |
| Invalid `panel` in POST | 400 validation error |
| Non-admin calls admin list | 403 Forbidden |
| Customer JWT | Not supported — staff JWT only |

---

## Quick reference

| Action | Method | Endpoint |
|--------|--------|----------|
| Log page visit | POST | `/api/activity/page-visit` |
| Get my activity | GET | `/api/activity/me` |
| List all users (admin) | GET | `/api/admin/activity/page-visits` |
| CRM last action (existing) | GET | `/api/admin/employees/audit-log` |

---

## Backend file map

| File | Purpose |
|------|---------|
| `src/models/UserPageActivity.js` | Mongoose schema |
| `src/services/pageActivity.service.js` | Log + query logic |
| `src/controllers/common/pageActivity.controller.js` | POST + GET me |
| `src/controllers/admin/pageActivity.controller.js` | Admin list |
| `src/routes/common/pageActivity.routes.js` | Mounted at `/api/activity` |
| `src/routes/admin/pageActivity.routes.js` | Mounted at `/api/admin/activity` |
