# Admin — System audit logs API (Frontend)

**Date:** 2026-09-21

## List audit logs

```http
GET /api/admin/audit-logs
Authorization: Bearer <admin_access_token>
```

### Query parameters

| Param | Notes |
|-------|--------|
| `panel` | `admin`, `sales`, `plant`, `construction`, `account`, `customer`, `public` |
| `type` | `auth`, `lead`, `invoice`, `construction`, `user`, … (see `AUDIT_TYPES`) |
| `action` | e.g. `auth.login.success`, `quotation.created`, `entity.updated` |
| `actorId` | Staff or customer Mongo id |
| `performedBy` | Staff user id (legacy field) |
| `leadId` | Filter by project |
| `customerId` | Filter by customer |
| `from` / `to` | ISO8601 date range on `createdAt` |
| `search` | Matches action, path, panel, entityType |
| `page` | Default 1 |
| `limit` | Default 50, max 200 |

### Response `200`

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "_id": "...",
        "type": "auth",
        "action": "auth.login.success",
        "panel": "admin",
        "actorType": "staff",
        "actorId": "...",
        "performedBy": "...",
        "path": "/api/auth/login",
        "httpMethod": "POST",
        "metadata": { "email": "...", "role": "admin", "ip": "..." },
        "createdAt": "...",
        "message": "Logged in (Admin)",
        "actor": {
          "type": "staff",
          "_id": "...",
          "name": "Admin",
          "email": "admin@construction.com",
          "role": "admin"
        }
      }
    ],
    "total": 120,
    "page": 1,
    "limit": 50,
    "pages": 3
  }
}
```

## What is logged today

| Source | Examples |
|--------|----------|
| **Auth** | Staff/customer login success & failure, logout, password change, profile update |
| **Domain** | Specific actions (`quotation.created`, `lead.edited`, …) wherever handlers call `auditService.log` |
| **Fallback** | Any successful **POST/PUT/PATCH/DELETE** under `/api/*` or `/sales/*` that did not already log gets `entity.created` / `entity.updated` / `entity.deleted` with route + actor |
| **Dedup** | Request-scoped context ensures explicit domain logs do **not** also create a fallback row |

**Not logged:** GET/read routes, login/refresh exact paths, presigned-url/download/export/webhook paths, failed responses (4xx/5xx).

## Checklist

- [ ] Admin Audit Log page: table + filters (`panel`, date range, search)
- [ ] Show `message` column for human-readable text
- [ ] Link `leadId` / `actor` to detail screens when present
