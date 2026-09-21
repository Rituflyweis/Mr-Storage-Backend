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
| **Domain** | Existing quotation, invoice, lead, plant, customer portal actions (unchanged) |
| **Construction** | Tasks, milestones, work logs, project steps (+ fallback for other construction POST/PUT/DELETE) |
| **Account** | Fallback `entity.*` for mutating `/api/account/*` routes without explicit audit |

## Checklist

- [ ] Admin Audit Log page: table + filters (`panel`, date range, search)
- [ ] Show `message` column for human-readable text
- [ ] Link `leadId` / `actor` to detail screens when present
