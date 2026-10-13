# Plant panel — Carrier ID & Vendor/Shipper ID APIs (ready for integration)

**To:** Frontend (Plant + Admin plant)  
**From:** Backend  
**Prod base:** `https://mr-storage-backend-025k.onrender.com/api`  
**Auth:** `Authorization: Bearer {plantOrAdminToken}`  
**Envelope:** `{ "success": true, "message": "Success", "data": { … } }`

---

## Summary

You asked for APIs to **preview auto-generated IDs** on the create forms and to **save user-edited IDs** on create. That is live on the paths below (after deploy from `shubham-changes-13-aug`).

| UI label | Stored field | Format | Preview endpoint |
|----------|--------------|--------|------------------|
| Carrier ID | `carrierCode` | `CAR-0001`, … | `GET …/carriers/next-code` |
| Vendor ID / Shipper ID | `vendorCode` | `VND-0001`, … | `GET …/vendors/next-code` |

**Shippers** are **`Vendor`** master records — there is no separate shipper entity. Use `vendorCode` (response also includes `shipperVendorCode` with the same value for labels that say “Shipper ID”).

---

## 1. Preview next ID (open create modal)

Call when the user opens **Add carrier** or **Add vendor/shipper**. The ID is **not reserved** until `POST` succeeds.

### Plant role

```http
GET /api/plant/carriers/next-code
GET /api/plant/vendors/next-code
```

### Admin role (same controllers)

```http
GET /api/admin/plant/carriers/next-code
GET /api/admin/plant/vendors/next-code
```

### Example — carrier

```bash
curl -s "https://mr-storage-backend-025k.onrender.com/api/plant/carriers/next-code" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carrierCode": "CAR-0042"
  }
}
```

### Example — vendor / shipper

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

**Race / duplicate:** If two users submit the same custom code, the second gets `400` with message like `Carrier code already in use` / `Vendor code already in use`. Refresh `next-code` or prompt the user to change the ID.

---

## 2. Create — auto ID or edited ID

Existing create endpoints unchanged; they already supported optional codes — now documented + preview endpoints added.

### Carrier — `POST /api/plant/carriers`

| Field | Required | Notes |
|--------|----------|--------|
| `carrierName` | Yes | |
| `email` | Yes | Must be unique |
| `carrierCode` | No | Omit → next `CAR-####`. Send value → **saved as provided** if unique |

```json
{
  "carrierName": "Express Freight Co",
  "email": "dispatch@example.com",
  "carrierCode": "CAR-0099",
  "contactName": "Tom Reed",
  "serviceType": "Hotshot",
  "serviceArea": "Texas"
}
```

### Vendor / shipper — `POST /api/plant/vendors`

| Field | Required | Notes |
|--------|----------|--------|
| `vendorName` | Yes | |
| `email` | Yes | Must be unique |
| `vendorCode` | No | Omit → next `VND-####` |

**Accepted aliases for the code on create** (mapped to `vendorCode` server-side):

- `vendorCode`
- `shipperCode`
- `shipperVendorCode`
- `shipperId` (legacy alias — human-readable code, not Mongo `_id`)

```json
{
  "vendorName": "ABC Steel",
  "email": "quotes@abcsteel.com",
  "shipperCode": "VND-0100",
  "vendorType": "steel",
  "materialTypes": ["panels", "trim"]
}
```

**Response:** `201` with full `carrier` / `vendor` object including the saved code.

---

## 3. Update code after create

| Action | Method | Path | Body |
|--------|--------|------|------|
| Edit carrier ID | `PUT` | `/api/plant/carriers/:carrierId` | `{ "carrierCode": "CAR-0101" }` (+ other fields optional) |
| Edit vendor/shipper ID | `PUT` | `/api/plant/vendors/:vendorId` | `{ "vendorCode": "VND-0101" }` |

Same routes under `/api/admin/plant/...` for admin JWT.

---

## 4. Recommended UI flow

1. User opens create form → `GET …/next-code` → pre-fill ID field (**editable**).
2. User edits ID if needed → `POST` with `carrierCode` or `vendorCode` / `shipperCode`.
3. On success, show returned `carrierCode` / `vendorCode` from response.
4. On `400` duplicate code → re-fetch `next-code` or show validation on the ID field.

---

## 5. Postman

Updated in repo:

- `plant-panel.postman_collection.json` — **Next Vendor / Shipper Code**, **Next Carrier Code**, create examples with custom codes.
- `postman_collection.json` — **Admin Plant — Vendors / Carriers** — same requests.

---

## 6. Longer reference

[`frontend-plant-vendor-carrier-next-code-api.md`](./frontend-plant-vendor-carrier-next-code-api.md) · [`plant-panel-api.md`](./plant-panel-api.md) (index rows 22A, 27A)

---

**Questions:** Ping backend if you need a dedicated `GET /api/plant/shippers/next-code` alias only (today `vendors/next-code` is the shipper ID source).
