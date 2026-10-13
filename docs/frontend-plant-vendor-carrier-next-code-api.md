# Plant panel — next Carrier ID & Vendor/Shipper ID

**Roles:** `plant`, `admin` (admin uses `/api/admin/plant/...`)  
**Auth:** `Authorization: Bearer {token}`

Shippers in the product are **`Vendor`** records. The human-readable ID is **`vendorCode`** (`VND-0001`, …). The UI may label it “Shipper ID” or “Vendor ID” — same field.

Freight carriers use **`carrierCode`** (`CAR-0001`, …).

---

## Preview next ID (create form)

Call when opening **Add carrier** or **Add vendor/shipper**. The code is **not reserved** until `POST` succeeds. If two users create at once with the same preview, the second `POST` without a custom code gets the next available code; a duplicate custom code returns `400`.

| Entity | Plant | Admin |
|--------|--------|--------|
| Carrier | `GET /api/plant/carriers/next-code` | `GET /api/admin/plant/carriers/next-code` |
| Vendor / shipper | `GET /api/plant/vendors/next-code` | `GET /api/admin/plant/vendors/next-code` |

### Carrier response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carrierCode": "CAR-0042"
  }
}
```

### Vendor / shipper response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendorCode": "VND-0015",
    "shipperVendorCode": "VND-0015"
  }
}
```

---

## Create with auto or custom ID

### Carrier — `POST /api/plant/carriers`

| Field | Required | Notes |
|--------|----------|--------|
| `carrierName` | Yes | |
| `email` | Yes | Unique |
| `carrierCode` | No | If omitted or empty → next `CAR-####`. If provided → saved as-is if unique |
| … | | Other fields unchanged |

**Custom ID example**

```json
{
  "carrierName": "Express Freight Co",
  "email": "dispatch@example.com",
  "carrierCode": "CAR-0099"
}
```

### Vendor / shipper — `POST /api/plant/vendors`

| Field | Required | Notes |
|--------|----------|--------|
| `vendorName` | Yes | |
| `email` | Yes | Unique |
| `vendorCode` | No | Auto `VND-####` if omitted. Aliases accepted on create: `shipperCode`, `shipperVendorCode`, `shipperId`, `vendor_code` |
| … | | Other fields unchanged |

**Custom ID example**

```json
{
  "vendorName": "ABC Steel",
  "email": "quotes@abcsteel.com",
  "shipperCode": "VND-0100"
}
```

---

## Update ID after create

- `PUT /api/plant/carriers/:carrierId` — optional `carrierCode` (unique)
- `PUT /api/plant/vendors/:vendorId` — optional `vendorCode` (unique)

---

## Suggested FE flow

1. `GET …/next-code` → pre-fill read-only or editable ID field.
2. User may edit the ID before submit.
3. `POST` with `carrierCode` / `vendorCode` (or `shipperCode` for vendors).
4. On `400` “code already in use”, refresh next-code or ask user to change the ID.
