# Admin — Create Basic Customer API

Frontend reference for creating a **customer only** (no project/lead).  
Use this when admin needs to register a person before adding projects later.

---

## Endpoint

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `/api/admin/customers/basic` |
| **Auth** | Required — **admin** role only |
| **Header** | `Authorization: Bearer <accessToken>` |
| **Content-Type** | `application/json` |

Base URL examples:
- Local: `http://localhost:5001/api/admin/customers/basic`
- Production: `https://flyweistechnology.com/api/admin/customers/basic`

---

## vs `POST /api/admin/customers`

| | `POST /customers/basic` | `POST /customers` |
|---|-------------------------|-------------------|
| Creates customer | Yes | Yes |
| Creates lead/project | **No** | Yes (first project) |
| Required fields | name, email, phone | name, email, phone + project fields |
| Use when | Customer exists before any project | Customer + first project in one step |

To add a project later:

`POST /api/admin/customers/:customerId/leads`

---

## Request body

### Required

| Field | Type | Rules |
|-------|------|--------|
| `firstName` | string | Non-empty after trim |
| `email` | string | Valid email; normalized to lowercase |
| `phone` | string | Non-empty after trim (digits or formatted) |

### Optional

| Field | Type | Rules | Default |
|-------|------|--------|---------|
| `countryCode` | string | Trimmed | `""` (empty string) |

### Example

```json
{
  "firstName": "John Smith",
  "email": "john.smith@example.com",
  "phone": "5551234567",
  "countryCode": "+1"
}
```

Minimal (no country code):

```json
{
  "firstName": "John Smith",
  "email": "john.smith@example.com",
  "phone": "5551234567"
}
```

---

## Success response

**HTTP 201**

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "customer": {
      "_id": "6a31307eb0bd7da16e808e74",
      "customerId": "CUS-0042",
      "firstName": "John Smith",
      "lastName": "",
      "email": "john.smith@example.com",
      "phone": {
        "number": "5551234567",
        "countryCode": "+1"
      },
      "photo": null,
      "isActive": true,
      "isOnline": false,
      "onlineAt": null,
      "lastSeenAt": null,
      "source": "manual",
      "company": "",
      "location": "",
      "createdAt": "2026-06-16T14:30:00.000Z",
      "updatedAt": "2026-06-16T14:30:00.000Z"
    }
  }
}
```

Notes:
- `password` is **never** returned (`toJSON` strips it).
- Server sets `source: "manual"`.
- Initial login password is derived from **phone** (hashed server-side). Customer portal login uses email + phone as password unless changed.

---

## Error responses

### 400 — Duplicate email

```json
{
  "success": false,
  "message": "Customer with this email already exists"
}
```

### 400 — Validation (express-validator)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid value" }
  ]
}
```

Common validation failures:
- Missing `firstName`, `email`, or `phone`
- Invalid email format

### 401 — No / invalid token

```json
{
  "success": false,
  "message": "Unauthorized"
}
```

### 403 — Not admin

```json
{
  "success": false,
  "message": "Forbidden"
}
```

---

## Frontend implementation checklist

1. Admin login → store `accessToken`.
2. Form fields: **Name**, **Email**, **Phone**, optional **Country code**.
3. Submit → `POST /api/admin/customers/basic` with JSON body above.
4. On **201**: use `data.customer._id` for navigation or “Add project” flow.
5. On duplicate email: show `message` to user.
6. Do **not** call `POST /api/admin/customers` unless you also collect project fields.

### Sample `fetch`

```javascript
const res = await fetch(`${API_BASE}/api/admin/customers/basic`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    firstName: form.firstName,
    email: form.email,
    phone: form.phone,
    countryCode: form.countryCode || '+1',
  }),
})

const json = await res.json()
if (!json.success) throw new Error(json.message)

const customerId = json.data.customer._id
```

---

## Related endpoints

| Action | Endpoint |
|--------|----------|
| List customers | `GET /api/admin/customers` |
| Customer detail | `GET /api/admin/customers/:customerId` |
| Add project to customer | `POST /api/admin/customers/:customerId/leads` |
| Update customer | `PUT /api/admin/customers/:customerId` |
| Create customer + first project | `POST /api/admin/customers` |
