# Admin Tax & Filing — API parity with Account panel

**Date:** 2026-10-21  
**Audience:** Admin panel frontend  
**Base:** `https://mr-storage-backend-025k.onrender.com/api/admin/financial-extra`  
**Auth:** Bearer · **`admin`**

Admin **Payments** tax screens use the **same backend** as Account. Copy Account integration code and change the API prefix from `/api/account/financial-extra` to `/api/admin/financial-extra`.

---

## Figma screen → endpoint (Admin prefix)

Replace `{base}` with `/api/admin/financial-extra`.

### Tax & Filling (Sales Tax & Filling)

| UI | Method & path |
|----|----------------|
| KPI cards | `GET {base}/tax-filing/stats?state=&projectId=&clientId=&startDate=&endDate=` |
| State / Project / Client / Date filters | `GET {base}/tax-filing/filters` |
| Pending Filing tab | `GET {base}/tax-filing?page=&limit=&state=&projectId=&clientId=&startDate=&endDate=&search=` → `pendingFiling[]` |
| Filing History tab | Same list call → `filingHistory[]` |
| Export | `GET {base}/tax-filing/export?…` |
| Review Details / Prepare Filing | `GET {base}/tax-filing/:taxId/prepare`, `GET {base}/tax-filing/:taxId/detail` |
| Texas / state detail modal, Pay Now | `GET {base}/tax-filing/:taxId/detail` → `POST {base}/tax-filing/:taxId/pay` or `POST {base}/tax-filing/:taxId/approve` (Avalara) |
| Mark filed | `PUT {base}/tax-filing/:taxId/file` |
| Receipt / download | `GET {base}/tax-filing/:taxId/receipt` or `?format=pdf` |
| Manage Notifications | `GET` / `PUT {base}/tax-filing/notification-settings` |

### State Wise Tax

| UI | Method & path |
|----|----------------|
| KPI row | `GET {base}/state-wise-tax/stats?projectId=&startDate=&endDate=&state=` |
| Table | `GET {base}/state-wise-tax?…` |
| Sync Now | `POST {base}/state-wise-tax/sync` |
| Compliance / empty state | `GET {base}/tax-compliance/status` |
| Upcoming Filing Deadlines | `GET {base}/state-wise-tax/upcoming-deadlines?projectId=&limit=` |
| Pay Tax / View Details | Row `taxRecordId` → `detail` + `pay` / `approve` |
| Export | `GET {base}/state-wise-tax/export?…` |

### Project Wise Tax

| UI | Method & path |
|----|----------------|
| KPI row | `GET {base}/project-wise-tax/stats?projectId=&startDate=&endDate=` |
| Table (paginated) | `GET {base}/project-wise-tax?page=&limit=&projectId=&startDate=&endDate=` |
| Sync Now | `POST {base}/state-wise-tax/sync` (shared rollup) |
| Upcoming deadlines | `GET {base}/state-wise-tax/upcoming-deadlines?…` |
| Pay Tax / View Details | Row `taxRecordId` |
| Export | `GET {base}/project-wise-tax/export?…` |

### Payments sub-nav (same bundle)

| Screen | Paths under `{base}` |
|--------|----------------------|
| Payment Approval | `GET/POST payment-approvals`, `PUT payment-approvals/:id/review`, `…/filters`, `…/export` |
| Payment Status | `GET payment-status`, `GET payment-status/export` |

---

## Response shapes (shared with Account)

- List rows: enriched with `status: { code, label, tone }`, `daysUntilDueLabel`, `salesTaxRateLabel`
- Detail modal: `breakdown`, `payNow`, `recentActivity`, Avalara partner copy
- Many responses include `meta`: `provider`, `syncState`, `lastSyncedAt`, `canSync`

Full field-level examples: [`../account-tax/frontend-account-tax-full-api-handoff-2026-10-19.md`](../account-tax/frontend-account-tax-full-api-handoff-2026-10-19.md) — read paths as **`/api/admin/financial-extra`** instead of `/api/account/financial-extra`.

---

## Quick smoke (Admin token)

```bash
BASE="https://mr-storage-backend-025k.onrender.com/api/admin/financial-extra"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/tax-compliance/status"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/tax-filing/stats"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/tax-filing/filters"
```

---

## Account vs Admin (for one codebase)

```typescript
const taxBase =
  panel === 'admin'
    ? '/api/admin/financial-extra'
    : '/api/account/financial-extra'
// Same paths after taxBase: `/tax-filing/stats`, `/state-wise-tax`, etc.
```

Admin may **also** call `/api/account/financial-extra` with an admin token (role allowed), but use the admin prefix in the Admin app for clarity.
