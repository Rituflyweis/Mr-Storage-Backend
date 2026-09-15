# Staff Forgot Password (OTP) — Frontend Contract (with `role`)

**Date:** 2026-09-15  
**Audience:** Admin, Sales, Plant, Account, Construction panel frontend  
**Scope:** Self-service reset while **logged out** (email OTP → verify → new password)

Customer portal is separate: **`/api/customer/auth/*`** — no `role` field.

---

## Overview

Three steps, no JWT required on steps 1–2:

| Step | Endpoint | Purpose |
|------|----------|---------|
| 1 | `POST /api/auth/forgot-password` | Send 6-digit OTP email |
| 2 | `POST /api/auth/verify-otp` | Verify OTP → get `resetToken` |
| 3 | `POST /api/auth/reset-password` | Set new password with `resetToken` |

**New behavior:** Steps **1** and **2** accept an optional **`role`** in the JSON body. When present, the backend only matches a user with that **exact staff role**. Same email can exist on different panels only if you use different roles in DB (one user = one role per email).

---

## Why send `role`?

Each panel should reset **its own** login, not another panel’s account that shares the same email.

| Panel | Send in body |
|-------|----------------|
| Admin | `"role": "admin"` |
| Sales | `"role": "sales"` |
| Plant | `"role": "plant"` |
| Account | `"role": "account"` |
| Construction | `"role": "construction"` |

If **`role` is omitted**, behavior is legacy: lookup by **email only** (any staff role).

---

## Allowed `role` values

Must match backend enum (case-insensitive after trim):

`admin` | `sales` | `construction` | `plant` | `account`

Invalid `role` → **400** validation error.

---

## Step 1 — Send OTP

### Request

```http
POST /api/auth/forgot-password
Content-Type: application/json
```

```json
{
  "email": "user@company.com",
  "role": "admin"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `email` | Yes | Valid email |
| `role` | **Recommended** per panel | Optional; scopes user lookup |

### Success — `200`

**User not found, wrong role, or inactive** (no OTP sent — anti-enumeration):

```json
{
  "success": true,
  "message": "If that email exists, an OTP has been sent",
  "data": {}
}
```

**User found, active, OTP stored, email send attempted:**

```json
{
  "success": true,
  "message": "If that email exists, an OTP has been sent",
  "data": {
    "sent": true,
    "warning": null
  }
}
```

**User found but SendGrid/email failed:**

```json
{
  "success": true,
  "message": "If that email exists, OTP delivery is delayed. Please try again shortly",
  "data": {
    "sent": false,
    "warning": "..."
  }
}
```

### Frontend guidance

1. Always show the same user-facing copy after step 1 (do not reveal whether the email exists).
2. To **gate the OTP screen** without leaking enumeration, only advance when `data.sent === true` (same pattern as sales vs admin before role scoping).
3. Store **`email`** and **`role`** in memory for step 2 (send the **same `role`** again).

### Validation error — `400`

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "path": "role", "msg": "role must be one of: admin, sales, construction, plant, account" }
  ]
}
```

---

## Step 2 — Verify OTP

### Request

```http
POST /api/auth/verify-otp
Content-Type: application/json
```

```json
{
  "email": "user@company.com",
  "otp": "483920",
  "role": "admin"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `email` | Yes | Same as step 1 |
| `otp` | Yes | Exactly 6 digits |
| `role` | **Same as step 1** if you sent it in step 1 | Optional but must match step 1 when used |

### Success — `200`

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "resetToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

- **`resetToken`**: JWT, **5 minutes**, purpose `password-reset`. Keep in memory only (not localStorage long-term).
- OTP is single-use; cleared after success.

### Errors — `400` / `401`

| HTTP | Message (examples) |
|------|---------------------|
| 400 | Invalid or expired OTP |
| 400 | OTP has expired. Please request a new one |
| 400 | Invalid OTP |
| 401 | Account deactivated message (inactive user) |

Wrong **`role`** vs step 1 behaves like invalid OTP (user not found for that query).

---

## Step 3 — Reset password

**No `role` in body** — identity comes from `resetToken`.

### Request

```http
POST /api/auth/reset-password
Content-Type: application/json
```

```json
{
  "resetToken": "<from step 2>",
  "newPassword": "NewSecurePass123"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `resetToken` | Yes | From verify-otp |
| `newPassword` | Yes | Min length **6** |

### Success — `200`

```json
{
  "success": true,
  "message": "Password reset successfully",
  "data": {}
}
```

Redirect user to that panel’s login screen.

### Errors — `400` / `401`

| HTTP | Message (examples) |
|------|---------------------|
| 400 | Invalid or expired reset token |
| 400 | OTP not verified. Please start over |
| 401 | Account deactivated |

---

## End-to-end example (admin panel)

```bash
# 1 — OTP (admin panel always sends role)
curl -X POST https://<API>/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"info@steelbuildingdepot.com","role":"admin"}'

# 2 — Verify (same role)
curl -X POST https://<API>/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"info@steelbuildingdepot.com","otp":"123456","role":"admin"}'

# 3 — New password
curl -X POST https://<API>/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"resetToken":"<token>","newPassword":"Steelman2026!"}'
```

---

## Timing

| Item | TTL |
|------|-----|
| OTP in email | **10 minutes** |
| `resetToken` | **5 minutes** |
| Resend OTP | Call step 1 again (invalidates previous OTP on that user) |

---

## Dev only

If `MASTER_OTP` is set in non-production env, that code can bypass OTP hash check in step 2. Not available in production.

---

## Not in this flow

| API | What it is |
|-----|------------|
| `POST /api/admin/employees/:userId/reset-password` | Admin resets **another** employee’s password (temp password email) |
| `PUT /api/auth/change-password` | Logged-in user changes password (needs Bearer token) |
| `POST /api/customer/auth/forgot-password` | Customer portal — **no `role`** |

---

## Checklist for frontend

- [ ] Each staff app passes fixed **`role`** on forgot-password and verify-otp.
- [ ] Use **`data.sent === true`** before showing OTP entry (optional but recommended).
- [ ] Pass the **same `email` + `role`** on verify-otp as on forgot-password.
- [ ] Do **not** send `role` on reset-password.
- [ ] Customer app keeps using `/api/customer/auth/*` without `role`.

---

## Related doc

Full staff + customer reference (older, less FE-focused): [`docs/forgot-password-api.md`](./forgot-password-api.md)
