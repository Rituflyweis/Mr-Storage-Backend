# Profile API — Staff & Customer (Frontend)

**Date:** 2026-09-17  
**Audience:** Admin, Plant, Construction, Sales, Account, Customer portal frontend

---

## Staff panels (admin, plant, construction, sales, account)

Same endpoints for all staff roles — use the panel’s **staff JWT** from `POST /api/auth/login`.

| | |
|---|---|
| **Get** | `GET /api/profile` |
| **Update** | `PUT /api/profile` |
| **Change password** | `PUT /api/profile/password` (unchanged) |

> Not under `/api/admin/profile` or `/api/plant/profile` — shared **`/api/profile`**.

### GET `/api/profile`

```http
GET /api/profile
Authorization: Bearer <staff_access_token>
```

**200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "profile": {
      "_id": "...",
      "name": "Jane Plant",
      "email": "jane@company.com",
      "phone": "+1 555-0100",
      "mobile": "+1 555-0199",
      "avatar": "",
      "role": "plant",
      "department": "Plant",
      "isActive": true,
      "notificationSettings": { },
      "createdAt": "...",
      "updatedAt": "..."
    },
    "user": { }
  }
}
```

`user` is a duplicate of `profile` (for backward compatibility).  
`mobile` is optional — empty string if not set.  
Admin users also include `isMainAdmin`.

Password is **never** returned.

---

### PUT `/api/profile`

Send **only fields to change** (at least one required).

```http
PUT /api/profile
Authorization: Bearer <staff_access_token>
Content-Type: application/json
```

```json
{
  "name": "Jane Plant",
  "email": "jane.new@company.com",
  "phone": "+1 555-0100",
  "mobile": "+1 555-0199"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `name` | No | Non-empty if sent |
| `email` | No | Must be unique across staff users |
| `phone` | No | String |
| `mobile` | No | Optional secondary number; may be `""` to clear |
| `avatar` | No | URL string |

**200**

```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "profile": { },
    "user": { }
  }
}
```

**Errors**

| HTTP | When |
|------|------|
| 400 | No fields sent; empty name; email in use |
| 401 | Missing/invalid token |
| 403 | Not a staff role |

---

## Customer portal

| | |
|---|---|
| **Get** | `GET /api/customer/profile` |
| **Update** | `PUT /api/customer/profile` |

Customer JWT from `POST /api/customer/auth/login`.

### GET `/api/customer/profile`

```http
GET /api/customer/profile
Authorization: Bearer <customer_access_token>
```

**200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "profile": {
      "_id": "...",
      "customerId": "CUST-0001",
      "name": "Arjun Kumar",
      "firstName": "Arjun",
      "lastName": "Kumar",
      "email": "arjun@example.com",
      "phone": { "number": "9876543210", "countryCode": "+91" },
      "mobile": "",
      "photo": null,
      "company": "",
      "location": "",
      "isActive": true,
      "source": "chat",
      "passwordChangedAt": null,
      "createdAt": "...",
      "updatedAt": "..."
    },
    "customer": { }
  }
}
```

`customer` duplicates `profile`. `passwordChangedAt: null` = still on default phone password.

---

### PUT `/api/customer/profile`

```json
{
  "name": "Arjun Kumar",
  "email": "arjun.new@example.com",
  "phone": "9876543210",
  "countryCode": "+91",
  "mobile": "+91 9988776655"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `name` | No | Full name; first space splits into first/last |
| `firstName` | No | Alternative to `name` |
| `lastName` | No | Optional with `firstName` |
| `email` | No | Must be unique |
| `phone` | No | String **or** `{ "number": "...", "countryCode": "+91" }` |
| `countryCode` | No | Used with string `phone` (default `+1`) |
| `mobile` | No | Optional; may be `""` to clear |
| `photo` | No | URL |

**200** — same shape as GET with updated `profile` / `customer`.

**Errors:** 400 validation, email in use, empty name, missing phone number when updating phone.

---

## Frontend checklist

### Staff (admin / plant / construction / sales / account)

- [ ] Settings → Profile: `GET /api/profile`
- [ ] Save: `PUT /api/profile` with changed fields only
- [ ] Show `phone` and optional `mobile` fields
- [ ] Password: `PUT /api/profile/password` or `PUT /api/auth/change-password`

### Customer

- [ ] `GET /api/customer/profile` — bind `name`, `email`, `phone`, `mobile`
- [ ] `PUT /api/customer/profile` — send `phone` + `countryCode` or nested phone object
- [ ] `mobile` field optional in UI

---

## Examples

```bash
# Staff — plant user
curl -s "https://<API>/api/profile" -H "Authorization: Bearer <token>"

curl -s -X PUT "https://<API>/api/profile" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Plant","phone":"+1 555-0100","mobile":"+1 555-0199"}'

# Customer
curl -s "https://<API>/api/customer/profile" -H "Authorization: Bearer <customer_token>"

curl -s -X PUT "https://<API>/api/customer/profile" \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Arjun K","email":"arjun@example.com","phone":"9876543210","countryCode":"+91","mobile":""}'
```
