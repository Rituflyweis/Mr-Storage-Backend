# Invoice billing address & bank details (all panels)

**Date:** 2026-10-17  
**Scope:** Every `Invoice` document (customer AR, vendor, freight carrier, misc payables).

## Fields (stored on invoice)

| Field | Purpose |
|-------|---------|
| `billingAddress` | Seller / remitter (company) address on PDFs |
| `recipientAddress` | Bill-to (customer) or payee (vendor/carrier) |
| `bankDetails` | Wire / ACH instructions |

### `billingAddress` / `recipientAddress`

```json
{
  "companyName": "STEEL BUILDING DEPOT",
  "line1": "1851 Madison Ave Suite 300",
  "line2": "",
  "city": "Council Bluffs",
  "state": "IA",
  "postalCode": "51503",
  "country": "United States",
  "lines": ["1851 Madison Ave Suite 300", "Council Bluffs, IA 51503"]
}
```

### `bankDetails`

```json
{
  "bankName": "Example Bank",
  "accountName": "Steel Building Depot LLC",
  "accountNumber": "****1234",
  "routingNumber": "021000021",
  "swiftCode": "",
  "iban": "",
  "branchAddress": "",
  "paymentInstructions": "Include invoice number in memo."
}
```

**Server defaults** (when omitted on create): from env `INVOICE_COMPANY_*` and `INVOICE_BANK_*`.  
**Legacy invoices:** list/detail/PDF responses fall back to defaults when fields are empty.

---

## Customer invoices (admin / sales)

| Action | Method | Path |
|--------|--------|------|
| Defaults for forms | GET | `/api/common/invoices/billing-defaults` (roles: **admin**, **sales**, **account**) |
| Same (account base) | GET | `/api/account/invoices/billing-defaults` |

**Example — billing defaults**

```http
GET /api/common/invoices/billing-defaults
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "billingAddress": {
      "companyName": "STEEL BUILDING DEPOT",
      "line1": "1851 Madison Ave Suite 300",
      "line2": "",
      "city": "Council Bluffs",
      "state": "IA",
      "postalCode": "51503",
      "country": "United States",
      "lines": ["1851 Madison Ave Suite 300", "Council Bluffs, IA", "51503", "United States"]
    },
    "bankDetails": { "bankName": "", "accountName": "", "accountNumber": "", "routingNumber": "" },
    "recipientAddress": { "companyName": "", "line1": "", "city": "", "state": "", "postalCode": "", "country": "", "lines": [] }
  }
}
```

| Create | POST | `/api/common/leads/:leadId/invoices` |
| Update | PUT | `/api/common/invoices/:invoiceId` |
| Detail | GET | `/api/common/invoices/:invoiceId` |
| List | GET | `/api/common/invoices`, `/api/common/leads/:leadId/invoices` |

Include `billingAddress`, `recipientAddress`, `bankDetails` in POST/PUT body.

**Billing-only update:** PUT with only address/bank fields works even when invoice is **paid** (no line-item revision).

Account project lists: `GET /api/account/invoice-management/project/records` and `GET /api/account/projects/:id/invoices/records` include the three objects on each row.

---

## Payables (vendor / carrier / misc)

| Action | Method | Path |
|--------|--------|------|
| Create vendor | POST | `/api/admin/payables/vendor` |
| Create carrier | POST | `/api/admin/payables/freight-carrier` |
| Create misc | POST | `/api/account/invoice-management/miscellaneous` |
| Update billing | PUT | `/api/admin/payables/:invoiceId/billing` |
| Update billing (account) | PUT | `/api/account/payables/:invoiceId/billing` |
| Detail | GET | `/api/admin/payables/:invoiceId`, `/api/account/payables/:invoiceId` |

Payable list rows (`buildPayableListRow`) and account invoice-management vendor/carrier/misc tables include `billingAddress`, `bankDetails`, `recipientAddress`.

---

## PDF & email

Customer invoice PDF (`GET /api/account/invoices/:invoiceId/pdf`) and send-invoice email use stored `billingAddress`, `bankDetails`, and `recipientAddress` when set.

---

## Env (ops)

Optional Render/env vars:

- `INVOICE_BANK_NAME`, `INVOICE_BANK_ACCOUNT_NAME`, `INVOICE_BANK_ACCOUNT_NUMBER`
- `INVOICE_BANK_ROUTING_NUMBER`, `INVOICE_BANK_SWIFT`, `INVOICE_BANK_IBAN`
- `INVOICE_BANK_BRANCH_ADDRESS`, `INVOICE_BANK_PAYMENT_INSTRUCTIONS`

Existing: `INVOICE_COMPANY_NAME`, `INVOICE_COMPANY_ADDRESS` (pipe-separated lines), etc.
