# Admin Customer List — Status shows Inactive for everyone

**Date:** 29 Oct 2026  
**Symptom:** Stats show **Active Customers: 24**, but every table row shows **Inactive**.

---

## Cause

DB / stats use `Customer.isActive === true` (correct).

List API historically returned only:

```json
{ "status": "active" }
```

and **did not** include `isActive`.

If FE renders:

```js
row.isActive ? 'Active' : 'Inactive'
```

then `undefined` is falsy → **every row looks Inactive**.

---

## Backend fix (after deploy)

`GET /api/admin/customers` (and any list using `mapCustomerListRow`) now returns:

```json
{
  "_id": "…",
  "customerId": "CUS-00277",
  "customerName": "Madhu Jain",
  "email": "madhu@flyweis.technology",
  "phone": { "number": "…", "countryCode": "+1" },
  "totalProjects": 1,
  "isActive": true,
  "status": "active",
  "statusLabel": "Active"
}
```

| Field | Use |
|-------|-----|
| `isActive` | Boolean badge / filter |
| `status` | `"active"` \| `"inactive"` |
| `statusLabel` | `"Active"` \| `"Inactive"` (ready for UI text) |

---

## FE wiring

Prefer any of:

```js
row.statusLabel
// or
row.isActive ? 'Active' : 'Inactive'
// or
row.status === 'active' ? 'Active' : 'Inactive'
```

Do **not** require exact `'Active'` on `status` (API sends lowercase `active`).

Filter “All Status” / Active / Inactive → query `?isActive=true` or `?scope=active` (existing).

---

## Verify

Madhu Jain (`CUS-00277`) and others in the screenshot are `isActive: true` in DB. After deploy + FE bind to `isActive` or `statusLabel`, rows should show **Active** to match the **24 Active Customers** card.
