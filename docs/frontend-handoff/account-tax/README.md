# Account Tax & Filing — frontend handoff bundle

Share this **folder** with frontend for the Account panel taxation section (Figma: Tax & Filling, State Wise, Project Wise).

**Base path:** `/api/account/financial-extra`  
**Admin panel (same APIs):** `/api/admin/financial-extra` — see [`../admin-tax/README.md`](../admin-tax/README.md)  
**Auth:** `Bearer` token · roles **`account`**, **`admin`**

## Read order

| # | File | Use |
|---|------|-----|
| **Share one file** | [`../frontend-avalara-tax-complete-handoff.md`](../frontend-avalara-tax-complete-handoff.md) | **Give frontend dev this only** — full doc in one place |
| 0 | [`frontend-avalara-compatibility-complete-handoff.md`](./frontend-avalara-compatibility-complete-handoff.md) | Short index + themes (superseded by single file above) |
| 1 | [`frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md`](./frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md) | Figma screen → API map, actions, checklist |
| 2 | [`frontend-account-tax-full-api-handoff-2026-10-19.md`](./frontend-account-tax-full-api-handoff-2026-10-19.md) | Every endpoint, req/res examples, errors |
| 3 | [`frontend-gap-changes-tax-address-avalara-2026-10-19.md`](./frontend-gap-changes-tax-address-avalara-2026-10-19.md) | Short migration checklist (addresses + tax UI + sync) |

**Prod API:** `https://mr-storage-backend-025k.onrender.com`

For Sales invoice tax + structured addresses (outside Account tax pages), see also  
[`../../avalara-full-changes-master-handoff-2026-10-19.md`](../../avalara-full-changes-master-handoff-2026-10-19.md) in the parent `docs/` folder.
