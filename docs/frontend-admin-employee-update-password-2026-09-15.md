# Admin — Update Employee Password API (Frontend)

**Date:** 2026-09-15  
**Audience:** Admin panel frontend  
**Purpose:** Admin sets a new password for a staff employee; backend emails the **plain-text new password** to the employee via SendGrid.

---

## Endpoint

| | |
|---|---|
| **Method** | `PUT` |
| **Path** | `/api/admin/employees/:userId/password` |
| **Auth** | Admin JWT — `Authorization: Bearer <accessToken>` |

`:userId` = MongoDB `_id` of the employee (same id as employee list / profile).

**Scope:** Employees only (`sales`, `plant`, `construction`, `account`). Admin users are managed under `/api/admin/admins/*`, not this route.

---

## Request

```http
PUT /api/admin/employees/69e61375e2dc3d6e7468ca3d/password
Content-Type: application/json
Authorization: Bearer <admin_access_token>
```

```json
{
  "newPassword": "Steelman2026!"
}
```

| Field | Required | Validation |
|-------|----------|------------|
| `newPassword` | Yes | Min **6** characters |

---

## Success — `200`

Password is **saved (hashed)** even if email fails; check `passwordEmailSent`.

```json
{
  "success": true,
  "message": "Employee password updated and emailed successfully",
  "data": {
    "userId": "69e61375e2dc3d6e7468ca3d",
    "email": "sales1@example.com",
    "passwordEmailSent": true,
    "passwordEmailWarning": null
  }
}
```

Email failed (SendGrid error):

```json
{
  "success": true,
  "message": "Password updated, but notification email could not be sent",
  "data": {
    "userId": "...",
    "email": "...",
    "passwordEmailSent": false,
    "passwordEmailWarning": "..."
  }
}
```

---

## Email (SendGrid)

- Template: `employee-password-updated`
- **To:** employee’s `email` on file
- **Subject:** `Your {Role} password has been updated`
- **Body includes:** email, **new password** (plain text), panel login link (`ADMIN_LOGIN_URL` / `SALES_LOGIN_URL` / `PLANT_LOGIN_URL` by role)

Requires `SENDGRID_API_KEY` (and from-address) on the server. If not configured → **400** before password is changed:

```json
{
  "success": false,
  "message": "Email service is not configured. Set SENDGRID_API_KEY."
}
```

---

## Side effects (backend)

- `passwordChangedAt` updated
- Forgot-password OTP fields cleared (`resetOtp`, etc.)
- Active sessions invalidated (`kickStaffSession`) — employee must log in again with the new password

---

## Errors

| HTTP | When |
|------|------|
| `400` | Inactive employee; validation (`newPassword` too short); SendGrid not configured |
| `401` | Missing/invalid token |
| `403` | Not admin |
| `404` | Employee not found |

Validation example:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "path": "newPassword", "msg": "newPassword must be at least 6 characters" }
  ]
}
```

---

## Related: auto-generated password (existing)

If the admin does **not** choose the password, use the existing endpoint:

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/admin/employees/:userId/reset-password` |
| **Body** | none |

Server generates a random temp password, saves it, and emails **`employee-credentials`** template (“Welcome / temp password”).

| Use case | Endpoint |
|----------|----------|
| Admin **types** the new password | `PUT .../password` + `{ newPassword }` |
| Admin **reset** with random password | `POST .../reset-password` |

---

## Example

```bash
curl -X PUT "https://<API>/api/admin/employees/69e61375e2dc3d6e7468ca3d/password" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"Steelman2026!"}'
```

---

## Frontend checklist

- [ ] Call `PUT /api/admin/employees/:userId/password` from employee profile / edit flow
- [ ] Show success toast from `message`; if `passwordEmailSent === false`, warn admin to share password manually
- [ ] Do **not** display `newPassword` in admin UI after submit unless product requires it (password is only in email)
- [ ] Use `POST .../reset-password` for “Generate & email temp password” button if needed
