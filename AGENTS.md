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

# [Mr_Storage_Backend] recent context, 2026-05-16 8:49pm GMT+5:30

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (18,633t read) | 764,890t work | 98% savings

### May 16, 2026
1055 2:00a 🔵 Customer Response Missing `company` and `location` Fields vs API Spec
1056 " 🔵 Root Cause Found: `company` and `location` Fields Not Defined in Customer Schema
1057 " 🔵 Controller Already Selects `company` and `location` — Schema Is the Only Missing Piece
1058 2:01a 🔵 Admin `getLeadDetail` Fetches Full Customer Document with `.lean()` — Bypasses `toJSON` Password Strip
1059 2:15a 🔵 Lead Detail V2 API Response Structure Validated
1060 " 🔵 Customer Schema Missing `company` and `location` Fields
1061 " 🔵 Lead Controller Selects `company` and `location` from Customer — Schema Gap Confirmed
1062 4:02a 🔵 Mr_Storage_Backend Route and Controller Structure Mapped
1063 4:03a 🔵 Sales Panel API Spec (admin_panel_sales_panel_v2.md Part 2) Fully Catalogued
1064 " 🔵 Sales Dashboard Routes Implement All Required Endpoints Plus Two Extra
1065 " 🔵 Sales Lead Routes Correctly Follow Static-Before-Parameterized Ordering
1066 " 🔵 Sales Follow-up and Customer Routes Fully Implement All Spec Endpoints
1067 " 🔵 AI Script Generator Fully Implemented with Anthropic SDK and AIScriptSession Persistence
1068 " 🔵 Quotation Controller Missing Server-Side COGS Auto-Calculations Required by Spec
1069 " 🔵 Admin Panel (Part 3) APIs Fully Implemented Across All Route Files
1070 " 🔵 Data Models for Building, ProjectBudget, and POOrder Match Spec Requirements
1077 11:43a 🔵 Admin Customer Routes Structure in Mr_Storage_Backend
1078 " 🔵 Admin Route Index: Full Route Map and Auth Middleware Chain
1079 " 🔵 Admin Customer Controller: Full Implementation Details
1080 " 🔵 Mr_Storage_Backend app.js: Full API Route Map and Middleware Stack
1081 11:44a 🔵 Global Error Handler: Mongoose and HTTP Error Response Patterns
1082 11:45a 🔵 No ObjectId Validation Middleware Exists in Mr_Storage_Backend
1083 " 🔵 Complete Middleware Inventory for Mr_Storage_Backend
1084 11:46a 🔵 Static Route Order Confirmed Correct; No Postman Collection Found
1085 11:47a 🔵 Postman Collection Found at Project Root as postman_collection.json
1086 " 🔵 Postman Spec Confirms Customer Stats and Projects APIs Exist for Both Admin and Sales
1088 " 🔵 Mr_Storage_Backend Uses Anthropic SDK and AWS S3 as Dependencies
1171 4:15p 🔵 Sales createProject endpoint — required vs auto-populated fields analysis
1172 4:24p 🔵 Sales Panel v2 — Project Creation API Field Population Question
1173 4:25p 🔵 Sales `createProject` API — Required Fields, Auto-Populated Fields, and Resulting Lead Document Shape
S132 Sales Panel v2 — Investigate and fix project creation API field handling for POST /api/sales/customers/:customerId/projects (May 16 at 4:25 PM)
1174 4:26p 🔴 Added Missing `height` Field to Lead Schema
1175 4:27p 🔴 Fixed `height` Field Silently Dropped in `createProject` Controller
1176 " 🔵 Admin `createProject` (Lead.create) Also Missing Dimension Fields
S133 Diagnosing mismatch between GET /api/sales/customers/:customerId/projects API response and the UI display requirements in Mr_Storage_Backend (May 16 at 4:27 PM)
1177 4:31p 🔵 API Response for Customer Projects Doesn't Match UI Requirements
1178 " 🔵 Lifecycle Stage Constants Defined in Mr_Storage_Backend
1179 " 🔵 Full LIFECYCLE_STAGES Enum and Related Constants in Mr_Storage_Backend
S134 Explaining the logic behind GET /api/sales/customers/:customerId/projects and resolving the UI vs API mismatch for project stage/progress/status display (May 16 at 4:31 PM)
S135 Analyze API response structure vs UI column requirements for customer projects listing — focus on structure, not data (May 16 at 4:34 PM)
1180 4:38p ⚖️ User Preference: Prioritize Structure Over Data
S136 Verify that the projects list API response structure matches the spec defined in admin_panel_sales_panel_v2.md (May 16 at 4:38 PM)
1181 4:42p 🔵 API Response Structure Spec for Projects List Endpoint
S137 Fix missing numberOfBuildings field in legacy Lead documents to make API responses match spec (May 16 at 4:42 PM)
1182 4:43p 🔵 Mr_Storage_Backend Config Directory Structure
1183 4:44p 🟣 Lead Defaults Backfill Migration Script Created
S138 Audit admin customer detail API response against frontend UI — verify correctness of displayed project data for customer CUST-0005 (May 16 at 4:44 PM)
1184 4:55p 🔵 Admin Customer Detail API Response Structure — Project Fields Review
1185 " 🔵 Admin Customer Controller — Four Distinct Customer/Project Endpoints
S139 Audit and fix admin customer API endpoints — security and spec compliance issues in Mr_Storage_Backend (May 16 at 4:55 PM)
1186 4:56p 🔴 Fixed `getCustomerDetail` — Removed Password Leak, Restructured Response to Match Spec
1187 4:57p 🔴 Fixed Password Leak in `getAllCustomers` List Endpoint
S140 Frontend UI column audit against Lead schema — JOB ID and END DATE columns have no backend backing fields (May 16 at 4:57 PM)
1188 6:37p ✅ Fields Added and Documented in not_present_in_spec.md
1189 " 🟣 New generateJobId Utility Created for Lead Model
1190 " 🟣 Lead Model Extended with jobId and endDate Fields
1191 " 🔵 All Lead.create Call Sites Mapped Across Mr_Storage_Backend
1192 6:38p ⚖️ jobId Auto-Assignment Moved to Mongoose pre('save') Middleware
1193 " 🟣 jobId Backfill Migration Run — 14 Existing Leads Assigned PRO-XXX IDs
S141 Add jobId and endDate fields to Lead model and document them in not_present_in_spec.md (May 16 at 6:39 PM)
**Investigated**: - Existing `generateCustomerId.js` utility pattern (sequential ID generation from last DB record)
    - All 9 `Lead.create` call sites across 6 controller files (public, sales/customer, sales/lead, admin/customer, admin/lead, customerPortal)
    - Existing migration script `scripts/migrate-lead-defaults.js` for prior field backfills
    - Lead model indexes and schema structure

**Learned**: - The Lead model uses a pre-save Mongoose middleware approach (not controller-level utility calls) to auto-assign sequential IDs — avoids modifying all 9 call sites
    - Sparse + unique index on jobId correctly handles null defaults (MongoDB sparse indexes skip null values, preventing unique constraint violations on existing nulls)
    - The bulk import path at `admin/lead.controller.js:254` uses a minimal payload and bypasses Mongoose middleware — it will NOT auto-assign jobId
    - The existing migration script was already in place for prior field backfills (numberOfBuildings, height) and was idempotent-safe to extend
    - 14 Lead documents existed in the database with no jobId before backfill

**Completed**: - Created `src/utils/generateJobId.js` — sequential PRO-XXX ID generator querying Lead model
    - Added `jobId` (String, default null) and `endDate` (Date, default null) fields to `src/models/Lead.js`
    - Added `LeadSchema.pre('save')` middleware to auto-assign PRO-XXX jobId on new Lead documents
    - Added `LeadSchema.index({ jobId: 1 }, { unique: true, sparse: true })` for uniqueness enforcement
    - Extended `scripts/migrate-lead-defaults.js` with jobId backfill phase (chronological assignment)
    - Ran migration successfully — 14 existing leads assigned PRO-001 through PRO-014
    - Updated `not_present_in_spec.md` to document all 3 non-spec fields: `height`, `jobId`, and `endDate`

**Next Steps**: Session appears complete. All requested work has been delivered: fields added to model, auto-assignment implemented via pre-save hook, existing data backfilled, and spec-gap documentation updated.


Access 765k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>