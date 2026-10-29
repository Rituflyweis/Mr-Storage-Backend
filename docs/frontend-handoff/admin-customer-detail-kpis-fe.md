# Admin / Sales — Customer detail KPIs

**Date:** 29 Oct 2026  
**Issue:** Admin Customer Info showed Total Paid / Pending / Invoices / Revenue all **$0** while the same customer’s project (e.g. BRANDON CUTTS / $64,163) and Sales views had real numbers.

---

## API

```http
GET /api/admin/customers/:customerId
GET /api/sales/customers/:customerId
Authorization: Bearer <token>
```

`:customerId` = Mongo `_id` **or** display code `CUS-00277`.

---

## Bind KPIs from (any of these — same values)

| Card | Preferred | Aliases |
|------|-----------|---------|
| Total Paid | `data.financials.totalPaid` | `data.totalPaid`, `data.kpis.totalPaid`, `data.customerRevenue.totalReceived` |
| Pending Payment | `data.financials.pendingPayment` | `data.pendingPayment`, `data.customerRevenue.outstandingAmount` |
| Total Invoices | `data.financials.totalInvoices` | `data.totalInvoices` |
| Revenue Generated | `data.financials.revenueGenerated` | `data.revenueGenerated`, `data.customerRevenue.totalQuotedValue` (when unpaid) |

### Example (Madhu / INV-0071 paid)

```json
{
  "success": true,
  "data": {
    "customer": {
      "_id": "6ae2f983092ad19ea4e417b4",
      "customerId": "CUS-00277",
      "firstName": "Madhu Jain",
      "email": "madhu@flyweis.technology",
      "address": ""
    },
    "financials": {
      "totalPaid": 64163,
      "pendingPayment": 0,
      "totalInvoices": 1,
      "revenueGenerated": 64163,
      "totalInvoiced": 64163,
      "totalQuotedValue": 64163,
      "overdueAmount": 0
    },
    "totalPaid": 64163,
    "pendingPayment": 0,
    "totalInvoices": 1,
    "revenueGenerated": 64163,
    "customerRevenue": {
      "totalQuotedValue": 64163,
      "totalInvoiced": 64163,
      "totalReceived": 64163,
      "outstandingAmount": 0,
      "overdue": 0
    }
  }
}
```

**Do not** hardcode KPIs to `0` when `financials` is missing — refetch detail after projects load.

Projects table remains `GET …/customers/:customerId/projects` (budget / quoteValue).
