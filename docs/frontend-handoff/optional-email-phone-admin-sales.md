# Admin and sales — email and phone are optional

**Date:** 20 Nov 2026  
**Panels:** Admin, Sales  
**Auth:** `Authorization: Bearer <accessToken>`

Email and phone are no longer required when staff manually add a customer or a lead. The fields stay on the forms. If the user fills them in, the API validates and saves them. If the user leaves them blank, the customer is stored with neither field, and staff can add them later from lead detail or customer detail.

This replaces the older contract in `docs/admin-create-basic-customer-api.md` and `docs/frontend-handoff/sales-manual-add-lead-api-fe.md`, where `email` and `phone` were required on customer create.

---

## What the UI should change

1. Remove the required marker and client-side “email and phone are required” checks on:
   - Admin: Add customer, Add customer + project, Add lead, Add project
   - Sales: Add customer, Add lead, Add project
2. Keep the inputs. Submit whatever the user typed, including empty strings.
3. On lead detail and customer detail, show a blank state when `email` or `phone` is missing. Do not show a placeholder address or a generated phone.
4. Lead edit and customer edit must allow saving an email, a phone, or both onto a customer that has neither.
5. A form that posts every field should keep sending `email: ""` and `phone: ""` when those boxes are empty. The API treats that as “leave the saved value alone.” It does not clear a contact, and it does not fail the rest of the save (project name, notes, first name, and so on).
6. Disable or hide customer-portal actions that need a login until a phone exists. The first saved phone becomes the customer’s initial password. Until then the customer has no password.

Excel import follows the same rule. A sheet row with no owner/developer email and no phone creates a customer with those fields omitted. The leads list and customer detail must tolerate that.

---

## Customer contact shape

`email` is a string. `phone` is an object.

```json
{
  "email": "jane@example.com",
  "phone": { "number": "5551234567", "countryCode": "+1" }
}
```

When the customer has no email, `email` is absent. When the customer has no phone, `phone` is absent. Check for a missing value, not only `""`.

`password` is never returned.

---

## Endpoints

| Action | Admin | Sales |
|---|---|---|
| Customer only | `POST /api/admin/customers/basic` | `POST /api/sales/customers/basic` |
| Customer + first project | `POST /api/admin/customers` | — |
| Lead for an existing customer | `POST /api/admin/leads` | `POST /api/sales/leads` |
| Project for an existing customer | `POST /api/admin/customers/:customerId/leads` | `POST /api/sales/customers/:customerId/projects` |
| Edit lead, including contact | `PUT /api/admin/leads/:leadId` | `PUT /api/sales/leads/:leadId` |
| Edit customer contact | `PUT /api/admin/customers/:customerId` | `PUT /api/sales/customers/:customerId` |
| Lead detail | `GET /api/admin/leads/:leadId/detail` | `GET /api/sales/leads/:leadId/detail` |
| Customer detail | `GET /api/admin/customers/:customerId` | `GET /api/sales/customers/:customerId` |

Sales can edit a lead only when it is assigned to that sales user. Sales can edit a customer only when that customer is in their portfolio (assigned lead, or a customer they created). Otherwise the API returns **403** `Access denied`.

There is still no `GET /api/admin/leads/:leadId` without `/detail`. Lead detail is the `/detail` path above.

---

## Create rules

### Still required

| Flow | Required body |
|---|---|
| Customer only | `firstName` |
| Customer + project, add lead, add project | `firstName` only on the customer+project call. `projectName` and `buildingType` on every lead/project call. `customerId` when the customer already exists. |

### Optional on every create above

| Field | When blank (`""`, omitted, or whitespace) | When filled |
|---|---|---|
| `email` | Not stored | Trimmed, lowercased, must be a valid email, must not already belong to another customer |
| `phone` | Not stored. No password is created | Stored as `phone.number`. `countryCode` defaults to `+1` when omitted. The phone is hashed as the initial password |
| `countryCode` | Ignored when there is no phone | Saved with the phone |

### Admin — customer + first project

`POST /api/admin/customers`

```json
{
  "firstName": "Jane Smith",
  "email": "",
  "phone": "",
  "projectName": "80x100 PEMB",
  "buildingType": "PEMB"
}
```

**201**

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "customer": {
      "_id": "...",
      "customerId": "CUS-00310",
      "firstName": "Jane Smith",
      "source": "manual"
    },
    "lead": {
      "_id": "...",
      "jobId": "2026270",
      "projectName": "80x100 PEMB",
      "buildingType": "PEMB",
      "customerId": "..."
    }
  }
}
```

The same call with an email and phone returns those fields on `data.customer`:

```json
{
  "email": "jane@example.com",
  "phone": { "number": "5551234567", "countryCode": "+1" }
}
```

### Admin and sales — customer only

`POST /api/admin/customers/basic`  
`POST /api/sales/customers/basic`

```json
{ "firstName": "Jane Smith", "email": "", "phone": "" }
```

**201** `data.customer`. Sales sets `createdBySales` to the logged-in user. No lead is created.

### Add a lead or project

Contact fields are optional here too. If `email` or `phone` is non-empty, it is written onto the existing customer before the lead is created. A blank value does not change the customer.

```json
{
  "customerId": "<customer _id>",
  "projectName": "50x50 PEMB",
  "buildingType": "PEMB",
  "email": "",
  "phone": ""
}
```

`POST /api/admin/customers/:customerId/leads` and `POST /api/sales/customers/:customerId/projects` use the same project body without `customerId` in the body (it is in the path).

**201** `data.lead`.

Sales add-lead still assigns the lead to the logged-in sales user. Do not send `assignedSales`.

---

## Edit rules

Send only the contact fields that the screen is saving, or send the whole form. Both work.

| Body | Result |
|---|---|
| `{ "email": "jane@example.com", "phone": "5551234567", "countryCode": "+1" }` | Saves both. Lead edit can send this **with no project field**. |
| `{ "email": "jane@example.com", "phone": "" }` | Saves the email. Existing phone stays. If there was no phone, it stays empty. |
| `{ "phone": "5551234567", "email": "" }` | Saves the phone. Existing email stays. |
| `{ "projectName": "New name", "email": "", "phone": "" }` | Renames the lead. Contact is unchanged. |
| `{ "email": "taken@example.com" }` | **400** `Customer with this email already exists`. Nothing is saved. |
| `{ "email": "not-an-email" }` | **400** `Validation failed`. |

A blank box does **not** delete an email or phone. To change a value, send the new non-empty value.

`countryCode` alone, with no phone number on the customer and no `phone` in the body, is ignored. Send `phone` and `countryCode` together when adding a phone.

### Lead edit

`PUT /api/admin/leads/:leadId`  
`PUT /api/sales/leads/:leadId`

**200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "lead": { "_id": "...", "projectName": "80x100 PEMB" },
    "customer": {
      "_id": "...",
      "customerId": "CUS-00310",
      "firstName": "Jane Smith",
      "email": "jane@example.com",
      "phone": { "number": "5551234567", "countryCode": "+1" }
    }
  }
}
```

`customer` is included when the body contained `email`, `phone`, or `countryCode`.

### Customer edit

`PUT /api/admin/customers/:customerId`  
`PUT /api/sales/customers/:customerId`

```json
{ "email": "jane@example.com", "phone": "5551234567", "countryCode": "+1" }
```

`firstName` remains optional on edit and still cannot be saved as an empty string.

**200** `data.customer` with the same contact shape.

At least one of `firstName`, `email`, or `phone` must be present in the body. Empty strings count as present, so a form that always posts those keys is fine.

---

## Read the contact back

Lead detail (`GET .../leads/:leadId/detail`) returns `data.customer` with `email` and `phone` selected. Use this for the lead detail screen.

Customer detail returns `data.customer`.

Suggested display:

| `customer.email` | `customer.phone?.number` | UI |
|---|---|---|
| missing | missing | “No email” and “No phone”, plus an edit action |
| set | missing | Show the email only |
| missing | set | Show `countryCode` + `number` |
| set | set | Show both |

Do not call, text, or email from the UI when the matching field is missing. The API already refuses an outbound email with no To address, and it skips an outbound call when there is no phone.

---

## Errors

Validation errors use **400**:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "msg": "email must be a valid email", "path": "email", "location": "body" }
  ]
}
```

Duplicate email uses **400** and no `errors` array:

```json
{ "success": false, "message": "Customer with this email already exists" }
```

Other messages the form can surface:

| Status | Message | When |
|---|---|---|
| 400 | `firstName cannot be empty` | Customer edit sent a blank name |
| 400 | `A project with this name already exists for this customer...` | Duplicate project name for that customer |
| 404 | `Customer not found` / `Lead not found` | Bad id |
| 403 | `Access denied` | Sales user does not own that lead or customer |

---

## Frontend checklist

- [ ] Add-customer and add-lead forms submit with empty email and phone.
- [ ] Client validation allows empty email and empty phone, and still checks email format when the box is not empty.
- [ ] Lead list, lead detail, and customer detail render customers that have no `email` and no `phone`.
- [ ] Lead detail edit can save email and phone by themselves.
- [ ] Customer detail edit can save email only, phone only, or both.
- [ ] Saving a project-field change while the contact boxes are empty does not show an error and does not clear a contact that was already saved.
- [ ] Duplicate email shows `Customer with this email already exists`.
- [ ] Import result rows with no contact open in detail without a fake `@imports.mrstorage.internal` address or a `900…` phone.
