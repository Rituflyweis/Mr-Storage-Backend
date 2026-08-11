# Form Submission API — Frontend Integration Guide

Documentation for the **quote form** and **inquiry form** endpoints, including the new customer-panel check and error handling.

**Base path:** `/api/v1`
**Auth:** Not required (public)

---

## Overview

When a user submits a website form, the backend:

1. Looks up customer by **email OR phone**
2. If customer exists and has an **active customer panel project** → returns **409**
3. Otherwise creates a **new lead** every time (does not update old leads)
4. Sends an **internal notification email** to `info@steelbuildingdepot.com` (not to the customer)
5. Saves form data (`Quotes` / `Inquire`)

**Not affected:** `POST /api/public/chat/init` (AI chat) — unchanged.

---

## Customer panel check (409)

A customer is blocked from submitting a new form project if they already have **at least one lead** with:

| Field | Value |
|--------|--------|
| `isRaisedToPO` | `true` |
| `isTerminated` | `false` |

If blocked, frontend should show the panel message and direct the user to the **customer portal** to create a new project there.

---

## Decision flow

```
Form submit
  │
  ├─ Customer NOT found by email or phone
  │    → Create customer + new lead + notify info@
  │    → 200 Success
  │
  └─ Customer found
       │
       ├─ Has PO lead (isRaisedToPO=true, isTerminated=false)
       │    → 409 - redirect to customer panel
       │
       └─ No such lead
            → Create new lead + notify info@
            → 200 Success
```

---

## 1) Quote Request Form

### `POST /api/v1/user/sendQuotesRequest`

### Request body

| Field | Type | Required | Notes |
|--------|------|----------|--------|
| `firstName` | string | ✅ | |
| `phoneNumber` | string | ✅ | Digits only stored (non-digits stripped) |
| `email` | string | ⚠️ | Required when creating a **new** customer |
| `lastName` | string | | |
| `countryCode` | string | | Default `+1` |
| `buildingTypeId` | string | | MongoDB `_id` of building type; backend resolves to name on lead |
| `width` | number/string | | |
| `length` | number/string | | |
| `height` | number/string | | |
| `roofPitch` | string | | |
| `zipCode` | string | | |
| `company` | string | | |
| `siteAddress` | string | | |
| `city` | string | | |
| `state` | string | | |
| `country` | string | | |
| `zip` | string | | |
| `notes` | string | | |
| `intendedUse` | string | | Saved as lead `projectName` |

### Success — `200`

```json
{
  "status": 200,
  "message": "Quote request send successfully",
  "data": {
    "_id": "...",
    "buildingTypeId": "69fc8572e866a57d001534a0",
    "customerId": "...",
    "leadId": "...",
    "firstName": "Test",
    "lastName": "",
    "email": "user@example.com",
    "phoneNumber": "19991499999",
    "width": "40",
    "length": "60",
    "height": "14",
    "createdAt": "2026-07-27T12:00:42.681Z",
    "updatedAt": "2026-07-27T12:00:42.681Z"
  }
}
```

**Frontend:** Show success message. A new lead is always created (`data.leadId`).

---

## 2) Inquiry Form

### `POST /api/v1/user/sendInquire`

### Request body

| Field | Type | Required | Notes |
|--------|------|----------|--------|
| `name` | string | ✅ | First name |
| `email` | string | ✅ | |
| `phone` | string | ✅ | |
| `lastName` | string | | |
| `countryCode` | string | | Default `+1` |
| `message` | string | | Saved on lead `notes` |

### Success — `200`

```json
{
  "message": "send Inquire successfully ",
  "data": {
    "_id": "...",
    "name": "Test",
    "email": "user@example.com",
    "phone": "19991499999",
    "message": "I need a quote for...",
    "customerId": "...",
    "leadId": "...",
    "createdAt": "..."
  }
}
```

> **Note:** Response shape differs slightly from quote form (`status` field not included on inquire success).

---

## Error Responses

All errors use:

```json
{
  "status": <http_code>,
  "message": "<human readable message>"
}
```

### `400` — Validation / Missing Fields

| Endpoint | When | Message |
|----------|------|---------|
| `sendQuotesRequest` | Missing `firstName` or `phoneNumber` | `firstName and phoneNumber are required to create lead from quote request` |
| `sendQuotesRequest` | New customer but no `email` | `email is required to create a new customer` |
| `sendInquire` | Missing `name`, `email`, or `phone` | `name, email and phone are required to create lead enquiry` |

**Frontend:** Show `message` under the form / inline validation.

---

### `409` — Active Customer Panel Exists (NEW)

Returned when email or phone matches an existing customer who already has a PO-raised, non-terminated project.

```json
{
  "status": 409,
  "message": "You have an existing customer panel, please visit there to create a new project"
}
```

**Frontend handling (recommended):**

```javascript
if (response.status === 409) {
  // Show message from response.message
  // Redirect or show CTA to customer portal login
  // Do NOT treat as generic error
}
```

**UI suggestion:**
- Title: "You already have an active project"
- Body: use `response.message`
- Primary button: "Go to Customer Panel" → portal login URL
- Do not allow resubmit on the public form for this case

---

## Frontend Handling — Example Code

```javascript
async function submitQuoteForm(payload) {
  const res = await fetch('/api/v1/user/sendQuotesRequest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await res.json()

  if (res.status === 200) {
    // Success — new lead created
    // data.data.leadId is available
    showSuccess('Quote request submitted successfully')
    return
  }

  if (res.status === 409) {
    showPanelRedirectMessage(data.message)
    redirectToCustomerPortal()
    return
  }

  if (res.status === 400) {
    showValidationError(data.message)
    return
  }

  showGenericError('Something went wrong. Please try again.')
}
```

Same pattern applies to `sendInquire`.

---

## Behavior Changes (vs Old Frontend Assumptions)

| Topic | Old behavior | New behavior |
|--------|----------------|---------------|
| Existing customer | Could update existing open lead | **Always creates a new lead** |
| Email on form | Only sent for brand-new customers | **Sent on every successful form submit** (to `info@steelbuildingdepot.com`) |
| PO customers | Could still submit form | **Blocked with 409** |
| `buildingType` on lead | Sometimes stored as MongoDB ID | Stored as **building type name** (resolved from `buildingTypeId`) |
| Customer lookup | Email or phone | Still **email OR phone** |

---

## What Is NOT Returned to Frontend

- Internal enquiry email send status (failure is logged server-side only; API still returns 200 if lead was created)
- `isNewCustomer` flag (not in response; both paths return 200 the same way)

---

## Related Endpoint (Unchanged)

### `POST /api/public/chat/init`

AI chat contact form — **different flow**, no 409 panel check. Keep existing chat handling as-is.

---

## Quick Test Matrix

| Scenario | Expected HTTP | Expected UI |
|----------|---------------|-------------|
| New email + phone | `200` | Success toast |
| Existing customer, no PO project | `200` | Success toast (new lead created) |
| Existing customer, PO raised + not terminated | `409` | Panel redirect message |
| Quote form missing phone | `400` | Validation error |
| Quote form new user without email | `400` | Ask for email |
| Inquiry missing email | `400` | Validation error |
