# Main Admin Management API

This module adds a **Main Admin** model on top of existing `admin` users.

- Any user with `role=admin` can access admin panel routes.
- Only the user marked as `isMainAdmin=true` can manage other admin users.
- All admin-management actions are audit logged.

Base path: `/api/admin/admins`

---

## Data Model Update

`User` model now includes:

- `isMainAdmin` (boolean, default `false`)

---

## Audit Actions Added

New audit action constants:

- `admin.main_assigned`
- `admin.created`
- `admin.updated`
- `admin.status_toggled`
- `admin.deleted`

These are written through `auditService.log(...)`.

---

## Endpoints

### 1) Set current admin as main admin (bootstrap)

`POST /api/admin/admins/set-main-self`

Use this once to mark the current logged-in admin as main admin.

Rules:
- Caller must have `role=admin`
- If a different main admin already exists, request is rejected

Response:
```json
{
  "success": true,
  "message": "Main admin access enabled",
  "data": {
    "admin": {
      "_id": "...",
      "role": "admin",
      "isMainAdmin": true
    }
  }
}
```

---

### 2) List all admin users

`GET /api/admin/admins`

Rules:
- Caller must be main admin

Response includes `admins[]` and summary counts.

---

### 3) Create admin user

`POST /api/admin/admins`

Rules:
- Caller must be main admin
- New user is created with `role="admin"` and `isMainAdmin=false`
- Credentials email is sent via mailer
- Audit logged as `admin.created`

Request:
```json
{
  "name": "Ops Admin 2",
  "email": "opsadmin2@example.com",
  "password": "TempPass@123",
  "phone": "9999999999"
}
```

---

### 4) Update admin user

`PUT /api/admin/admins/:adminId`

Rules:
- Caller must be main admin
- Cannot edit another main admin
- Main admin cannot be deactivated through this route
- Audit logged as `admin.updated`

Request (partial):
```json
{
  "name": "Ops Admin Two",
  "isActive": true
}
```

---

### 5) Toggle admin status

`PATCH /api/admin/admins/:adminId/toggle-status`

Rules:
- Caller must be main admin
- Main admin status cannot be toggled
- Audit logged as `admin.status_toggled`

---

### 6) Delete admin user

`DELETE /api/admin/admins/:adminId`

Rules:
- Caller must be main admin
- Main admin cannot be deleted
- Caller cannot delete own account
- Audit logged as `admin.deleted`

---

### 7) Transfer main admin

`POST /api/admin/admins/:adminId/transfer-main`

Rules:
- Caller must be current main admin
- Target must be active admin
- Caller is demoted (`isMainAdmin=false`), target promoted (`isMainAdmin=true`)
- Audit logged as `admin.main_assigned` with transfer metadata

---

## Guard Rails Added To Existing Employee APIs

`/api/admin/employees` mutations now enforce:

- Non-main admins **cannot** create/manage users with `role=admin`
- Main admin cannot be deactivated/deleted/toggled from employee endpoints
- Main admin password reset is blocked from employee reset endpoint

This prevents bypassing admin-management controls through old employee routes.

---

## Permission Matrix

- **Regular Admin (`role=admin`, `isMainAdmin=false`)**
  - Access admin panel features
  - Cannot create/edit/delete/toggle admin users

- **Main Admin (`role=admin`, `isMainAdmin=true`)**
  - Full admin-user management
  - Can transfer main admin to another active admin

---

## Notes

- Existing admin users remain valid; they will default to `isMainAdmin=false` until one admin calls `set-main-self`.
- Recommend setting main admin immediately after deployment.

