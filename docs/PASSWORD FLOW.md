# Password Flow

Two separate flows depending on whether the user is logged in or not.

---

## Flow 1 — Forgot Password (OTP Reset)

Use when the user is **logged out** and has forgotten their password.
Works for all panels — admin, sales, accounts, and customer.

**Endpoints — Staff (admin / sales / accounts)**
```
POST /api/auth/forgot-password
POST /api/auth/verify-otp
POST /api/auth/reset-password
```

**Endpoints — Customer panel**
```
POST /api/customer/auth/forgot-password
POST /api/customer/auth/verify-otp
POST /api/customer/auth/reset-password
```

---

### Step 1 — Request OTP

User enters their email on the "Forgot Password" screen.

```
POST /api/auth/forgot-password
{ "email": "admin@company.com" }
```

Server generates a 6-digit OTP → hashes it → saves to the user record with a 10-minute expiry → sends it to the email address.

Always returns `200` with the same message regardless of whether the email exists (prevents account enumeration).

```json
{ "message": "If that email exists, an OTP has been sent" }
```

> Always show the user: *"If that email is registered, you'll receive a 6-digit code shortly."* Do not change the message based on the response.

---

### Step 2 — Verify OTP

User receives the email and enters the 6-digit code.

```
POST /api/auth/verify-otp
{ "email": "admin@company.com", "otp": "483920" }
```

Server checks:
1. OTP exists on this account
2. OTP has not expired (10-minute window)
3. OTP matches the stored hash

If all pass — OTP is deleted (single use), account is flagged `resetOtpVerified = true`, and a short-lived **reset token** (JWT, 5 minutes) is returned.

```json
{ "message": "OTP verified successfully", "data": { "resetToken": "eyJhbGci..." } }
```

Store `resetToken` in memory only — not in localStorage. It is only needed for Step 3.

**Errors**
- `400 — Invalid OTP` — wrong code entered
- `400 — OTP has expired. Please request a new one` — 10-minute window passed; user must go back to Step 1

---

### Step 3 — Reset Password

User enters and confirms their new password. Send the `resetToken` from Step 2.

```
POST /api/auth/reset-password
{ "resetToken": "eyJhbGci...", "newPassword": "NewPass@456" }
```

Server verifies the reset token (signature + 5-minute expiry + `purpose: 'password-reset'` claim), confirms `resetOtpVerified = true`, then:
- Hashes and saves the new password
- Sets `passwordChangedAt = now`
- Clears all OTP/reset fields from the record

```json
{ "message": "Password reset successfully" }
```

Redirect the user to the login screen.

**Errors**
- `400 — Invalid or expired reset token` — token expired (5 min) or tampered; user must restart from Step 1
- `400 — OTP not verified. Please start over` — should not happen in normal flow

---

### Why the reset token?

Without it, anyone who knows a user's email could skip Steps 1–2 and call `reset-password` directly. The reset token is cryptographic proof that OTP verification was completed — the server only issues it after Step 2 passes.

---

### Expiry summary

| | Expiry | On expiry |
|---|---|---|
| OTP (email code) | 10 minutes | Call `forgot-password` again |
| Reset token (JWT) | 5 minutes | Restart the entire flow |

---

## Flow 2 — Change Password (Logged In)

Use when the user **knows their current password** and wants to change it. Requires a valid access token.

**Endpoints**
```
PUT /api/auth/change-password          — staff (admin, sales, accounts)
PUT /api/customer/auth/change-password — customer panel
```

**Request body**
```json
{ "currentPassword": "OldPass@123", "newPassword": "NewPass@456" }
```

Server verifies `currentPassword` against the stored hash. If it matches, hashes and saves `newPassword`, sets `passwordChangedAt = now`.

```json
{ "message": "Password updated successfully" }
```

**Errors**
- `400 — Current password is incorrect`
- `401` — access token missing or expired (user must log in first)

> **Customer first-time login:** New customers are created with their phone number as the default password. `passwordChangedAt: null` on their profile means they have never changed it. Show a prompt on first login directing them to this endpoint.
