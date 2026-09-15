# Staff Forgot Password (OTP) — Frontend Contract (with `role`)

**Date:** 2026-09-15 (updated)  
**Audience:** Admin, Sales, Plant, Account, Construction panel frontend  
**Scope:** Self-service reset while **logged out** (email OTP → verify → new password)

Customer portal is separate: **`/api/customer/auth/*`** — no `role` field.

**Base URL (UAT example):** `https://mr-storage-backend-025k.onrender.com`

---

## Overview

Three steps, no JWT required on steps 1–2:

| Step | Endpoint | Purpose |
|------|----------|---------|
| 1 | `POST /api/auth/forgot-password` | Send 6-digit OTP email |
| 2 | `POST /api/auth/verify-otp` | Verify OTP → get `resetToken` |
| 3 | `POST /api/auth/reset-password` | Set new password with `resetToken` |

Steps **1** and **2** accept an optional **`role`** in the JSON body. When present:

- OTP is only issued for a user whose **`email` + `role`** match.
- If the email exists but **`role` does not match** that user → **400** with a clear message (see below).
- If the email is **not registered** (or user is **inactive**) → **200** with generic message and **`data: {}`** (no OTP).

If **`role` is omitted**, lookup is by **email only** (legacy; any staff role).

---

## Why send `role`?

Each panel resets **its own** login, not another panel’s account that shares the same email.

| Panel | Send in body |
|-------|----------------|
| Admin | `"role": "admin"` |
| Sales | `"role": "sales"` |
| Plant | `"role": "plant"` |
| Account | `"role": "account"` |
| Construction | `"role": "construction"` |

---

## Allowed `role` values

Must match backend enum (case-insensitive after trim):

`admin` | `sales` | `construction` | `plant` | `account`

Invalid `role` string → **400** validation error (see bottom of Step 1).

---

## Step 1 — Send OTP — response matrix

Use this table to drive UI after **`POST /api/auth/forgot-password`**.

| Situation | HTTP | `success` | `message` | `data` | OTP sent? | UI |
|-----------|------|-----------|-----------|--------|-----------|-----|
| Email **not registered** | 200 | `true` | If that email exists, an OTP has been sent | `{}` | No | Neutral copy; **do not** open OTP screen |
| Email registered but **inactive** | 200 | `true` | Same as above | `{}` | No | Same as above |
| Email registered, **wrong `role`** for panel | 400 | `false` | **Role and email do not match** | — | No | Show error on form |
| Email + **correct `role`**, email OK | 200 | `true` | If that email exists… | `{ sent: true, warning: null }` | Yes | Go to OTP screen |
| Match but SendGrid failed | 200 | `true` | OTP delivery is delayed… | `{ sent: false, warning: "..." }` | Stored, may not arrive | Warn user; optional retry step 1 |

**Example — plant user, admin panel (wrong role):**

```http
POST /api/auth/forgot-password
```

```json
{ "email": "react6@flyweis.technology", "role": "admin" }
```

```json
{
  "success": false,
  "message": "Role and email do not match"
}
```

**Example — email not in database:**

```json
{ "email": "notregistered@example.com", "role": "admin" }
```

```json
{
  "success": true,
  "message": "If that email exists, an OTP has been sent",
  "data": {}
}
```

**Example — success, OTP sent:**

```json
{ "email": "react6@flyweis.technology", "role": "plant" }
```

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
| `role` | **Required per panel** (recommended) | Must match the panel the user is on |

### Frontend guidance (step 1)

1. **`success === false`** and message **Role and email do not match** → show error; stay on email step.
2. **`success === true`** and **`data` is `{}`** → show neutral “If an account exists for this panel, check your email” (or similar); **do not** advance to OTP.
3. **`success === true`** and **`data.sent === true`** → advance to OTP step.
4. Store **`email`** and **`role`** for step 2 (same values).

### Validation error — `400` (invalid `role` or email format)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "path": "role",
      "msg": "role must be one of: admin, sales, construction, plant, account"
    }
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
| `role` | Same as step 1 if used in step 1 | Optional only if step 1 omitted `role` |

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

- **`resetToken`**: JWT, **5 minutes**, purpose `password-reset`. Keep in memory only.
- OTP is single-use; cleared after success.

### Errors

| HTTP | When | Message (examples) |
|------|------|---------------------|
| 400 | Wrong **`role`** for that email | **Role and email do not match** |
| 400 | Bad/expired OTP | Invalid or expired OTP / Invalid OTP / OTP has expired… |
| 401 | Inactive user | Account deactivated message |

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

Redirect to that panel’s login screen.

### Errors — `400` / `401`

| HTTP | Message (examples) |
|------|---------------------|
| 400 | Invalid or expired reset token |
| 400 | OTP not verified. Please start over |
| 401 | Account deactivated |

---

## End-to-end example (admin panel)

```bash
# 1 — OTP (always send role for staff panels)
curl -X POST https://mr-storage-backend-025k.onrender.com/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"info@steelbuildingdepot.com","role":"admin"}'

# 2 — Verify (same role)
curl -X POST https://mr-storage-backend-025k.onrender.com/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"info@steelbuildingdepot.com","otp":"123456","role":"admin"}'

# 3 — New password
curl -X POST https://mr-storage-backend-025k.onrender.com/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"resetToken":"<token>","newPassword":"Steelman2026!"}'
```

---

## Timing

| Item | TTL |
|------|-----|
| OTP in email | **10 minutes** |
| `resetToken` | **5 minutes** |
| Resend OTP | Call step 1 again (replaces previous OTP on that user) |

---

## Dev only

If `MASTER_OTP` is set in non-production env, that code can bypass OTP hash check in step 2. Not available in production.

---

## Related admin APIs (not self-service OTP)

| API | What it is |
|-----|------------|
| `POST /api/admin/employees/:userId/reset-password` | Admin auto-generates temp password + email |
| `PUT /api/admin/employees/:userId/password` | Admin sets password + email new password — see [`frontend-admin-employee-update-password-2026-09-15.md`](./frontend-admin-employee-update-password-2026-09-15.md) |
| `PUT /api/auth/change-password` | Logged-in user changes password (Bearer token) |
| `POST /api/customer/auth/forgot-password` | Customer portal — **no `role`** |

---

## Frontend checklist

- [ ] Each staff app sends fixed **`role`** on forgot-password and verify-otp.
- [ ] On step 1: **400** → show role mismatch; **`data.sent === true`** → OTP screen; **`data: {}`** → neutral message only.
- [ ] Pass the **same `email` + `role`** on verify-otp as on forgot-password.
- [ ] Do **not** send `role` on reset-password.
- [ ] Customer app uses `/api/customer/auth/*` without `role`.

---

## Related doc

Older full reference: [`docs/forgot-password-api.md`](./forgot-password-api.md)
