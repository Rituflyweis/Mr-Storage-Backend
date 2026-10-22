# Admin — Payments (Tax, Approvals, Status)

**Prod:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <token>` · role **`admin`**

| Figma sub-nav | Doc |
|---------------|-----|
| Tax & Filing / State / Project Wise | [`../admin-tax/README.md`](../admin-tax/README.md) |
| **Payment Approvals** | [`payment-approvals-api.md`](./payment-approvals-api.md) |
| Payment Status | [`payment-approvals-api.md`](./payment-approvals-api.md) § Payment Status |

**Recommended for Payment Approvals UI:** use **`/api/account/financial/payment-approvals/*`** (enriched list, detail modal, full review actions). **`admin`** role is allowed on Account financial routes.

Legacy/simple admin mount: **`/api/admin/financial-extra/payment-approvals/*`** (same data model, narrower review API).
