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

# [Mr_Storage_Backend] recent context, 2026-05-16 4:17pm GMT+5:30

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (18,905t read) | 715,930t work | 97% savings

### May 15, 2026
S110 Admin Panel Sales Panel V2 API audit — verify all APIs from plan doc exist, are implemented, and are in Postman collection (May 15 at 3:02 AM)
S118 Investigate and explain the full lead onboarding, stage progression, and salesperson assignment flow in Mr_Storage_Backend, including how to manually add and advance a lead. (May 15 at 1:49 PM)
1016 8:32p 🔵 Postman Collection Reveals Full API Surface and Domain Model ("Construction AI")
1017 " 🔵 Customer Portal: Phone Number as Initial Password Confirmed in Postman Examples
1018 8:34p 🔵 Package Stack: Express 5, Mongoose 8, Anthropic SDK 0.39, AWS S3 SDK v3
1019 " 🔵 Runtime Environment: Node.js v24.12.0; Only AGENTS.md Modified in Working Tree
### May 16, 2026
1036 12:54a 🔵 Chatbot Handles Lead Progression Through Stages 0–3
1037 " 🔵 Lead Lifecycle Uses Named String Stages, Not Numeric Indexes
1038 " 🔵 Chatbot Owns Leads Until isHandedToSales Flag; Sales Handoff via Round-Robin Service
1039 12:55a 🔵 AI Scoring Service Advances Lead Lifecycle Stages with Advance-Only Guard
1040 " 🔵 Claude Chat Service Uses QUOTE_DATA Marker Protocol to Embed Structured JSON in Responses
1041 " 🔵 Sales Rep Can Freely Update lifecycleStatus; No Advance-Only Guard in Sales Controller
1042 12:56a 🔵 Lead Mongoose Schema — Complete Field Map Including AI and State Flag Fields
1043 " 🔵 Mr_Storage_Backend Lead Onboarding Entry Points via Public Routes
1044 " 🔵 Lead Onboarding Flow: chatInit Controller Logic in Mr_Storage_Backend
1045 " 🔵 Round-Robin Salesperson Auto-Assignment Service
1046 " 🔵 AI Chat Service Extracts QUOTE_DATA from Claude Response to Trigger Sales Handoff
1047 12:57a 🔵 Complete Lead Lifecycle Stages and Stage Progression Rules in Mr_Storage_Backend
1048 " 🔵 Chat Socket Handler Triggers Sales Handoff When AI Returns QUOTE_DATA
S119 Understand lead onboarding, stage progression, and salesperson assignment in Mr_Storage_Backend; create a way to manually test the full flow end-to-end. (May 16 at 12:57 AM)
1049 12:59a 🔵 Complete Socket.IO customer_message Handler: 10-Step Pipeline with Post-Handoff AI Silence
1050 " 🔵 Socket.IO Namespace Architecture: /chat (Public) and /admin (Authenticated)
1051 1:00a 🟣 Created test-chat.html: Browser-Based Lead Onboarding and Chat Pipeline Tester
S120 Provide a step-by-step test script with exact chat messages to trigger the full lead pipeline: onboarding → stage progression → QUOTE_DATA → sales handoff. (May 16 at 1:01 AM)
S121 How lead onboarding, stage progression, and sales assignment works in Mr_Storage_Backend — and how to manually add a lead and move it through stages (May 16 at 1:01 AM)
S122 Lead Detail V2 API response validation — cross-checking GET /api/sales/leads/:leadId/detail response against admin_panel_sales_panel_v2.md spec (May 16 at 1:04 AM)
1052 1:27a 🔵 Sales API — Leads Endpoints Documented in Postman Collection
1053 1:47a 🔵 Mr_Storage_Backend Sales Leads API Endpoints in Postman Collection
1054 1:56a 🔵 Lead Detail API Response Structure — Steel Warehouse CRM
1055 2:00a 🔵 Customer Response Missing `company` and `location` Fields vs API Spec
1056 " 🔵 Root Cause Found: `company` and `location` Fields Not Defined in Customer Schema
1057 " 🔵 Controller Already Selects `company` and `location` — Schema Is the Only Missing Piece
1058 2:01a 🔵 Admin `getLeadDetail` Fetches Full Customer Document with `.lean()` — Bypasses `toJSON` Password Strip
1059 2:15a 🔵 Lead Detail V2 API Response Structure Validated
S123 Lead Detail V2 API validation and Customer schema fix — adding missing `company` and `location` fields to Customer model (May 16 at 2:15 AM)
1060 " 🔵 Customer Schema Missing `company` and `location` Fields
1061 " 🔵 Lead Controller Selects `company` and `location` from Customer — Schema Gap Confirmed
S124 Audit and fix all API implementations in Mr_Storage_Backend against the admin_panel_sales_panel_v2.md specification — covering schema changes (Part 1), Sales Panel APIs (Part 2), Admin Panel APIs (Part 3), and Common APIs (Part 4) (May 16 at 2:16 AM)
1062 4:02a 🔵 Mr_Storage_Backend Route and Controller Structure Mapped
1063 4:03a 🔵 Sales Panel API Spec (admin_panel_sales_panel_v2.md Part 2) Fully Catalogued
1064 " 🔵 Sales Dashboard Routes Implement All Required Endpoints Plus Two Extra
1065 " 🔵 Sales Lead Routes Correctly Follow Static-Before-Parameterized Ordering
1066 " 🔵 Sales Follow-up and Customer Routes Fully Implement All Spec Endpoints
1067 " 🔵 AI Script Generator Fully Implemented with Anthropic SDK and AIScriptSession Persistence
1068 " 🔵 Quotation Controller Missing Server-Side COGS Auto-Calculations Required by Spec
1069 " 🔵 Admin Panel (Part 3) APIs Fully Implemented Across All Route Files
1070 " 🔵 Data Models for Building, ProjectBudget, and POOrder Match Spec Requirements
S125 Fix all critical bugs in Mr_Storage_Backend quotation controller identified during the admin_panel_sales_panel_v2.md audit — specifically: missing quoteNumber generation, missing server-side COGS auto-calculations, incomplete ALLOWED list in updateQuotation, missing versionNumber increment, and missing auto-recalculation on update (May 16 at 4:05 AM)
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
S129 Investigate API errors and verify whether failing endpoints exist in the Postman spec for Mr_Storage_Backend (May 16 at 11:47 AM)
**Investigated**: - src/routes/admin/customer.routes.js — full route definitions and ordering
    - src/routes/admin/index.js — admin namespace middleware and sub-router map
    - src/controllers/admin/customer.controller.js — all 6 controller methods
    - src/middleware/errorHandler.js — Mongoose error handling patterns
    - src/middleware/ directory — complete middleware inventory
    - app.js — full Express middleware stack and route namespace registration
    - postman_collection.json — cross-referenced all customer endpoints against spec
    - package.json — project dependencies and npm scripts

**Learned**: - Both GET /api/admin/customers/stats and GET /api/admin/customers/:customerId/projects ARE in the Postman spec
    - The "Invalid _id: stats" error is a classic Express route ordering bug — /:customerId matched "stats" before the /stats static route was loaded, meaning the server was running stale code
    - Route file has correct ordering (static /stats at line 8, parameterized /:customerId at line 26), so the code itself is fine
    - No ObjectId validation middleware exists — invalid IDs fall through to Mongoose CastError → HTTP 400
    - Two separate auth middlewares exist: auth.js for admin/staff and customerAuth.js for customer portal
    - Admin routes globally protected by verifyToken + roleGuard(['admin']) in the index router
    - createCustomerWithLead uses phone number as initial password (hashed with bcrypt)
    - Project has @anthropic-ai/sdk and AWS S3 SDK as runtime dependencies
    - Postman collection lives at project root as postman_collection.json (not in a subdirectory)
    - Sales namespace mirrors admin customer endpoints: /api/sales/customers/stats and /api/sales/customers/:customerId/projects also in spec

**Completed**: - Root cause of both API errors identified: server was running old code before /stats route and /projects route were added
    - Confirmed all reported endpoints exist in both the codebase and the Postman spec
    - Verified route ordering is correct in the current code
    - Confirmed fix: restart the server with `npm run dev` to pick up current file state

**Next Steps**: - User advised to kill nodemon and run `npm run dev` to resolve both errors
    - No code changes needed — the implementation is correct
    - Potentially investigate sales customer routes to verify parity with admin routes if further errors arise


Access 716k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>