# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start with nodemon (development)
npm start         # Production server
npm run seed      # Seed first admin user + RoundRobinTracker (run once on fresh DB)
npm run create-user  # Create additional users (admin, sales, etc.)
```

No lint or test commands exist in this project.

## Architecture

Node.js + Express 5 backend for a construction/storage business with AI-powered sales automation.

**Stack:** MongoDB/Mongoose 8, Socket.io 4, Anthropic Codex (Codex-sonnet-4-20250514), JWT auth, AWS S3, Nodemailer.

**Entry points:**
- [server.js](server.js) — HTTP + Socket.io bootstrap
- [app.js](app.js) — Express middleware and route mounting

**Source layout:**

| Directory | Purpose |
|---|---|
| `src/config/` | `env.js` (validates + exports all env vars), `db.js`, `constants.js` (roles, lead stages, audit action strings) |
| `src/models/` | 14 Mongoose schemas |
| `src/routes/` | Organized by role: `auth`, `public`, `admin/*`, `sales/*`, `common/*` |
| `src/controllers/` | Business logic matching route groups |
| `src/middleware/` | `verifyToken`, `roleGuard`, error handler, validation |
| `src/services/` | AI chat, Socket.io handlers, email, audit logging, round-robin assignment |
| `src/utils/` | ID generation, API response helpers, date ranges |

## Authentication

JWT access + refresh tokens. `verifyToken` middleware attaches `req.user = { _id, email, role, name }`. `roleGuard(allowedRoles)` follows for protected routes. No server-side token blacklist — logout is client-side only.

## API Route Map

| Prefix | Auth | Roles |
|---|---|---|
| `/api/auth` | None | Login, refresh, logout, change password |
| `/api/public` | None | Chat init, chat history |
| `/api/admin/*` | JWT | admin |
| `/api/sales/*` | JWT | sales |
| `/api/quotations/*`, `/api/invoices/*`, `/api/payment-schedules/*`, `/api/upload/*` | JWT | admin, sales |

## Core Chat Flow

1. Customer POSTs `/api/public/chat/init` → creates Customer + Lead documents, returns `customerId` + `leadId`
2. Customer connects to Socket.io `/chat` namespace, emits `customer_message`
3. Codex AI responds and scores the lead (5-item breakdown stored on Lead)
4. When AI outputs `QUOTE_DATA:{...}` in its response:
   - Draft Quotation created, `lead.isQuoteReady = true`
   - Round-robin assigns an active sales employee
   - Customer notified via socket they're connected to a sales rep
   - Subsequent messages route to assigned sales employee
5. Admin/sales staff monitor via `/admin` Socket.io namespace (JWT required in `handshake.auth.token`)

## Socket.io Namespaces

| Namespace | Auth | Purpose |
|---|---|---|
| `/chat` | None | Customer ↔ AI/sales |
| `/admin` | JWT | Internal staff monitoring, notifications |

## Key Design Decisions

- **Context trimming:** Codex context trimmed by character limits — all limits configurable via env vars (set to 0 for full history in dev). See `src/services/ai/chat.service.js`.
- **No job queues:** AI scoring runs as fire-and-forget. Retriggers on next message if server crashes mid-job.
- **Round-robin edge case:** If no active sales employees exist, admin is notified via socket and must manually assign.
- **Overdue follow-ups:** Computed at query time (`followUpDate < now AND status = pending`), not stored as status.
- **AuditLog:** Insert-only. All action strings must come from `src/config/constants.js`.
- **Returning customer:** Any Customer with more than one Lead document.

## Environment Setup

Copy `.env.example` to `.env`. Required vars: `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ANTHROPIC_API_KEY`, AWS S3 credentials, SMTP credentials. All parsed and validated in `src/config/env.js` at startup.

Default seed admin: `admin@construction.com` / `Admin@123` (overridable via env vars).


<claude-mem-context>
# Memory Context

# [Mr_Storage_Backend] recent context, 2026-05-18 8:41pm GMT+5:30

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (19,648t read) | 485,781t work | 96% savings

### May 16, 2026
S134 Explaining the logic behind GET /api/sales/customers/:customerId/projects and resolving the UI vs API mismatch for project stage/progress/status display (May 16 at 4:31 PM)
S135 Analyze API response structure vs UI column requirements for customer projects listing — focus on structure, not data (May 16 at 4:34 PM)
S136 Verify that the projects list API response structure matches the spec defined in admin_panel_sales_panel_v2.md (May 16 at 4:38 PM)
S137 Fix missing numberOfBuildings field in legacy Lead documents to make API responses match spec (May 16 at 4:42 PM)
S138 Audit admin customer detail API response against frontend UI — verify correctness of displayed project data for customer CUST-0005 (May 16 at 4:44 PM)
S139 Audit and fix admin customer API endpoints — security and spec compliance issues in Mr_Storage_Backend (May 16 at 4:55 PM)
S140 Frontend UI column audit against Lead schema — JOB ID and END DATE columns have no backend backing fields (May 16 at 4:57 PM)
S141 Add jobId and endDate fields to Lead model and document them in not_present_in_spec.md (May 16 at 4:57 PM)
S171 Trace the full request flow of GET /api/sales/followups/communication-timeline (May 16 at 6:39 PM)
### May 18, 2026
1443 3:23p 🔵 No Automated Reminder System Exists — Follow-Up "Reminders" Are Pull-Only
1444 " 🔵 Follow-Up API Endpoints Split Between v1 (EXISTS) and v2 (NEW) in Spec
1445 " 🔵 Shared buildDateFilter Utility Normalizes Date Ranges Across All Controllers
1442 " 🔵 logActivity Endpoint: Full Business Flow Confirmed
S172 Business flow for creating data in the communication timeline feature of Mr_Storage_Backend (May 18 at 3:23 PM)
1446 3:24p 🔵 Admin and Sales Follow-Up Route Sets Are Asymmetric — KPI Endpoint Missing in Sales Routes
1447 3:27p 🔵 Admin Employees API Has Partial Role Filtering
1448 3:28p 🔵 Admin Employees API Role Filter Confirmed on GET /
1449 3:47p 🔵 PO Order API — Quotation ID and Invoice ID Source Query
1450 " 🔵 PO Order Route Structure in Mr_Storage_Backend
1451 3:48p 🔵 PO Order API — quotationId and invoiceId Must Come from Lead-Scoped Quotation and Invoice Endpoints
1452 " 🔵 getLeadDetail Is the Single Source for Both quotationId and invoiceId
1453 3:49p 🔵 GET /api/sales/quotations Filters by Creator, Not by Lead
1454 4:40p ⚖️ Frontend Lead Detail Fetching Strategy Discussion
1465 4:57p ⚖️ PO API Redesign: Accept Only poNumber with Backend Auto-Resolution
1466 4:58p 🔵 Mr_Storage_Backend: PO, Invoice, and Quotation Data Model Structure
1467 " 🔵 Current PO API Contract: Frontend Must Supply invoiceId and quotationId
1468 " ✅ PO Route Validators: Removed invoiceId and quotationId Body Requirements
1469 " 🟣 Backend Auto-Resolution of invoiceId and quotationId for PO Order Creation
1470 4:59p 🔵 Three Documentation Files Contain Stale PO Order API Contract
1471 " ✅ API_REFERENCE.md Updated to Reflect New Thin PO Order Request Contract
1472 " ✅ API Flow Docs Updated for New PO Order Contract in Two Locations Each
1473 " ✅ All Three API Documentation Files Now Reflect Thin PO Order Contract
1474 5:00p ✅ PO API Redesign Fully Complete: No Stale Contract Remaining in Any Doc
1475 " 🟣 PO API Redesign Complete: Full Diff Summary of All Changes
1483 5:46p 🔵 Sales Panel API Structure in Mr_Storage_Backend
1484 " 🔵 Sales Panel Follow-up API — Full Route and Controller Map
1485 " 🔵 Sales Panel Router — Top-Level Route Structure with Role Guard
1486 " 🔵 Invoice API Spans Multiple Panels — Common, Account, and Sales Controllers
1487 5:47p 🔵 Mr_Storage_Backend Top-Level API Route Map
1488 " 🔵 Complete Sales Panel API Endpoint Inventory
1489 " 🔵 FollowUp Model Schema — Overdue Status is Computed, Not Stored
1490 " 🔵 Sales Lead Detail API Aggregates 9 Data Sources in a Single Response
1491 " 🔵 Admin vs Sales Follow-Up Route Differences
1492 " 🔵 Quotation API — Server-Side Auto-Calculations and Version Tracking
1493 " 🔵 Payment Schedule API — One Schedule Per Lead with Strict Stage Validation
1494 " 🔵 Invoice Notify Endpoint Planned in Docs but Not Implemented in Codebase
1495 5:48p 🔵 Mr_Storage_Backend Complete Enum Constants and Audit Action Registry
1496 6:01p 🔵 Mr_Storage_Backend Postman Collection Files Located
1497 " ✅ Postman "Raise PO Order" Request Body Cleaned Up — Removed invoiceId and quotationId Fields
1498 " 🔵 Lead Detail API Already Returns Invoices as Payment Records
1499 " 🔵 getLeadDetail Already Fetches Invoices in Parallel Query
1500 6:02p 🔵 getLeadDetail Returns Payments Block Derived Entirely from Invoices
1501 " 🔵 Pending Payment Status Is Always Derived from Invoice Status and DueDate, Never Stored Separately
1518 7:17p 🔵 Mr_Storage_Backend Project Structure Identified
1519 8:15p ⚖️ Instruction to Follow Only admin_panel_sales_panel_v2.md
1520 8:16p 🔵 admin_panel_sales_panel_v2.md Spec: Payment, Invoice, Follow-Up, and KPI Coverage
1521 8:17p 🔵 Sales Panel API Surface Fully Mapped from Spec (Lines 500–760)
1522 " 🔵 Admin Panel API Surface Mapped: Customers, Project Detail, Leads, PO Orders (Lines 760–980)
1523 " 🔵 Spec Constants and Audit Actions: All Enum Changes in v2
1524 " 🔵 Common APIs: Invoice and Payment Schedule Changes in v2 (Part 4)

Access 486k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>