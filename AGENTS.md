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

# [Mr_Storage_Backend] recent context, 2026-05-20 1:23am GMT+5:30

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (14,348t read) | 519,391t work | 97% savings

### May 19, 2026
1707 7:56p 🟣 FE integration guide created for Sales ↔ Lead chat system
1712 10:50p ✅ getCustomerDetail strips invoices from response and removes sort
1713 10:51p 🔴 createQuotation enforces server-side customerId from lead, ignores client-supplied value
1714 " 🔵 Quotation POST route validator still requires customerId despite controller ignoring it
1715 " 🔴 Removed redundant customerId validator from quotation POST route
1716 " ✅ Postman collection updated to remove customerId from Create Quotation request body
1717 11:28p 🔵 sendQuotation Controller Lifecycle Stage Transition Logic
1718 11:42p 🔵 Payment Controller createSchedule Function Signature Traced
1719 " 🔵 Full Payment Schedule Creation Logic in Mr_Storage_Backend
1720 11:43p 🔴 totalAmount Now Falls Back to lead.quoteValue When Not Provided
1721 " 🔵 Payment Route Still Validates totalAmount as Required Numeric
1722 " 🔴 Route Validator Updated to Allow Optional totalAmount
1723 " 🔵 Payment Schedules API Mounted at /api/payment-schedules
1724 11:44p 🔵 updatePOStatus Sets poStatus and Conditionally Advances lifecycleStatus
1725 " 🔵 updatePOStatus Full Logic: Approval Advances Lead Lifecycle and Pushes History
1726 11:51p 🔵 assignPOOrder Controller Located in Mr_Storage_Backend
S219 E11 — createEmployee refactored to auto-generate temp password and email credentials to new employee (May 19 at 11:51 PM)
1727 11:54p 🔵 createEmployee Controller Found — No Email Notification on Creation
1728 " 🔵 createEmployee Full Logic — Sales Role Triggers Round-Robin Rebuild
1729 " 🔵 Mailer Service Has No Employee Credentials Email Function
1730 " 🟣 sendEmployeeCredentials Added to Mailer Service
1731 " 🔵 Email Template Design System — Brand Colors and Structure Pattern
1732 11:55p 🟣 employee-credentials.html Email Template Created
1733 " 🟣 Mailer Imported into Employee Controller for Credential Emails
1734 " 🟣 createEmployee Refactored to Auto-Generate Temporary Password and Email Credentials
S220 E12: Upgrade GET /api/admin/escalations with pagination, field projection, and assignedSales filter (May 19 at 11:55 PM)
### May 20, 2026
1735 12:51a 🔵 Admin Escalation Controller: Resolve and Reassign Flow
1736 " 🟣 getAllEscalations Enhanced with Pagination, Field Projection, and assignedSales Filter
1737 " ✅ Postman Collection Updated for Escalations Pagination and assignedSales Filter
S221 E13: Add search filter to GET /api/admin/employees by name or email (May 20 at 12:52 AM)
1738 12:52a 🔵 Admin Employee Controller: getAllEmployees Already Has Pagination and Filters
1739 12:53a 🟣 getAllEmployees Gains Case-Insensitive Search Filter by Name or Email
1740 " ✅ Postman Collection Updated for List Employees with Full Filter Set
S222 E13 clarification: search filter composes with existing role/isActive/page/limit filters via AND logic (May 20 at 12:53 AM)
S223 E13 Postman clarification: all 5 employee list params added as disabled-by-default, offer to enable them (May 20 at 12:55 AM)
S224 E14: POST /api/sales/leads createLead — strict customer duplicate check + new fields (already implemented, no change needed) (May 20 at 12:55 AM)
S225 Verify Postman collection was updated — specifically confirming the Sales "Create Lead" request body fields (May 20 at 12:56 AM)
1741 1:01a 🔵 Postman Collection Contains Duplicate "Create Lead" Entries
S226 Implement N1: standalone Resolve Escalation endpoint — new PUT /api/admin/escalations/:escalationId/resolve route, controller, and Postman entry (May 20 at 1:01 AM)
1742 " 🔵 Escalation Routes Missing "Resolve" Endpoint Despite Constant Existing
1743 " 🟣 Implemented resolveEscalation Endpoint for Admin Escalation Module
1744 1:02a ✅ Postman Collection Updated with "Resolve Escalation" Request
S227 Implement N2: GET /api/admin/followups — list all follow-ups with per-employee aggregation, filtering, and pagination (May 20 at 1:02 AM)
1745 " 🔵 Admin Follow-up KPI Endpoint Returns Hardcoded Placeholder Data
1746 " 🟣 Added getAllFollowups Controller with Per-Employee Aggregation
1747 " 🟣 Registered GET / Route for getAllFollowups in Admin Follow-up Router
1748 " ✅ Postman Collection Updated with "List Follow-ups" Admin Endpoint
1749 1:03a 🔵 Admin Employee Routes Are Fully Wired — No Missing Endpoints
1750 " 🟣 Added deactivateEmployee, toggleStatus, and resetPassword to Employee Controller
1751 1:04a 🟣 Registered Toggle Status and Reset Password Routes in Admin Employee Router
1752 1:07a 🔵 Mr_Storage_Backend Admin Routes Structure
1753 " 🟣 Financial Overview Controller Created
1754 " 🟣 Financial Admin Route Registered
1755 " 🟣 Financial Routes Mounted in Admin Router
1756 " 🔵 Postman Collection Structure Mapping
1757 1:08a ✅ Postman Collection Updated with Admin Financials Section
S228 N5: Implement GET /api/admin/financials/overview endpoint with financial KPI aggregation (May 20 at 1:08 AM)
1758 " 🟣 Per-Project Financial Breakdown Handler Added
1759 " 🟣 Per-Project Financial Route Registered
1760 " ✅ Postman Collection Updated with Per-Project P&L Request

Access 519k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>