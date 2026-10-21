# Admin Tax & Filing — same APIs as Account

Share this folder with frontend for **Admin → Payments → Tax & Filling / State Wise / Project Wise** (same Figma as Account).

## Base path (Admin panel)

| Panel | Base path |
|-------|-----------|
| **Admin** (use this) | `/api/admin/financial-extra` |
| Account (reference) | `/api/account/financial-extra` |

Both mount the **same router and controller**. Path suffixes, query params, and JSON shapes are **identical** — only the prefix differs.

**Auth:** `Authorization: Bearer <token>` · role **`admin`** (Account users use the account prefix with role **`account`**).

**Prod:** `https://mr-storage-backend-025k.onrender.com`

**Legacy alias (still works, prefer `financial-extra`):** `/api/admin/financials/...`

## Do not use for Figma tax screens

- `GET/POST /api/account/tax` — legacy manual CRUD
- Ad-hoc admin-only stubs without enriched rows

## Docs

| File | Use |
|------|-----|
| [`frontend-admin-tax-same-as-account-api.md`](./frontend-admin-tax-same-as-account-api.md) | Admin base path + Figma screen → endpoint table |
| [`../account-tax/frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md`](../account-tax/frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md) | Full Figma wiring (replace base with `/api/admin/financial-extra`) |
| [`../account-tax/frontend-account-tax-full-api-handoff-2026-10-19.md`](../account-tax/frontend-account-tax-full-api-handoff-2026-10-19.md) | Every endpoint req/res (replace base path) |
