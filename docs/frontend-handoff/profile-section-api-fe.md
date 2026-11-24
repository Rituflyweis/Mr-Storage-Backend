# Profile section API (staff)

**Auth:** `Authorization: Bearer <staff JWT>`  
Roles: `admin` | `sales` | `plant` | `construction` | `account`  
**Base:** `https://mr-storage-backend-025k.onrender.com`

Shared under `/api/profile` (not `/api/admin/profile`).

---

## Endpoints

| Action | Method | Path |
|--------|--------|------|
| **Get profile** (includes notification settings) | `GET` | `/api/profile` |
| Update profile | `PUT` | `/api/profile` |
| Change password | `PUT` | `/api/profile/password` |
| Update notification toggles | `PUT` | `/api/profile/notification-settings` |

**There is no `GET /api/profile/notification-settings`.**  
Load toggles from **`GET /api/profile` → `data.profile.notificationSettings`**.

---

## 1. GET `/api/profile`

```http
GET /api/profile
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "profile": {
      "_id": "67a1…",
      "name": "Jane Doe",
      "email": "jane@company.com",
      "phone": "+1 555-0100",
      "mobile": "+1 555-0199",
      "avatar": "",
      "role": "sales",
      "department": "Sales",
      "isActive": true,
      "notificationSettings": {
        "twoFactorAuth": false,
        "emailNotification": true,
        "smsNotification": false,
        "dashboardNotifications": true,
        "weeklyEmailReports": false,
        "systemAlerts": true,
        "loginAlertsViaMail": true
      },
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-10-30T08:00:00.000Z"
    },
    "user": { }
  }
}
```

`user` is a duplicate of `profile` (legacy).  
Admin also gets `isMainAdmin: true|false`.  
Password is never returned.

### Profile field schema

| Field | Type | Notes |
|-------|------|--------|
| `_id` | ObjectId | User id |
| `name` | string | Display name |
| `email` | string | Unique |
| `phone` | string | Primary phone |
| `mobile` | string | Optional; may be `""` |
| `avatar` | string | URL or empty |
| `role` | string | Staff role enum |
| `department` | string | |
| `isActive` | boolean | |
| `isMainAdmin` | boolean | Admin only |
| `notificationSettings` | object | See below |
| `createdAt` / `updatedAt` | ISO date | |

### `notificationSettings` schema

| Key | Type | Default | UI meaning |
|-----|------|---------|------------|
| `twoFactorAuth` | boolean | `false` | 2FA |
| `emailNotification` | boolean | `true` | Email notifications |
| `smsNotification` | boolean | `false` | SMS |
| `dashboardNotifications` | boolean | `true` | In-app / dashboard |
| `weeklyEmailReports` | boolean | `false` | Weekly email reports |
| `systemAlerts` | boolean | `true` | System alerts |
| `loginAlertsViaMail` | boolean | `true` | Login alerts by email |

---

## 2. PUT `/api/profile`

Send **only fields to change** (at least one).

```http
PUT /api/profile
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "name": "Jane Doe",
  "email": "jane.new@company.com",
  "phone": "+1 555-0100",
  "mobile": "+1 555-0199",
  "avatar": "https://…"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `name` | No | Non-empty if sent |
| `email` | No | Must be unique |
| `phone` | No | |
| `mobile` | No | `""` clears |
| `avatar` | No | URL string |

**200** — same shape as GET (`profile` + `user`).

| HTTP | When |
|------|------|
| 400 | No fields / empty name / email in use |
| 401 | Bad token |

---

## 3. PUT `/api/profile/password`

```json
{
  "currentPassword": "…",
  "newPassword": "…"
}
```

Both required. **200** `{ "success": true, "data": {}, "message": "Password updated" }`.

---

## 4. PUT `/api/profile/notification-settings`

**No GET for this path** — update only. Partial body OK (only send keys to change).

```http
PUT /api/profile/notification-settings
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "emailNotification": true,
  "smsNotification": false,
  "dashboardNotifications": true,
  "weeklyEmailReports": true,
  "systemAlerts": true,
  "loginAlertsViaMail": false,
  "twoFactorAuth": false
}
```

Allowed keys (others ignored):  
`twoFactorAuth`, `emailNotification`, `smsNotification`, `dashboardNotifications`, `weeklyEmailReports`, `systemAlerts`, `loginAlertsViaMail`.

Values coerced to boolean.

### Response `200`

```json
{
  "success": true,
  "message": "Settings updated",
  "data": {
    "notificationSettings": {
      "twoFactorAuth": false,
      "emailNotification": true,
      "smsNotification": false,
      "dashboardNotifications": true,
      "weeklyEmailReports": true,
      "systemAlerts": true,
      "loginAlertsViaMail": false
    }
  }
}
```

After save, you can also re-`GET /api/profile` — settings are on `profile.notificationSettings`.

---

## FE checklist

- [ ] Settings screen load → `GET /api/profile`
- [ ] Bind toggles from `data.profile.notificationSettings`
- [ ] Save toggles → `PUT /api/profile/notification-settings` (partial OK)
- [ ] Save name/email/phone → `PUT /api/profile`
- [ ] Password → `PUT /api/profile/password`
- [ ] Do **not** call `GET /api/profile/notification-settings` (does not exist)

---

## Related

- Broader profile notes: [`../frontend-profile-api-2026-09-17.md`](../frontend-profile-api-2026-09-17.md)
- Customer portal profile: `GET|PUT /api/customer/profile` (no staff notificationSettings)
