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

# [Mr_Storage_Backend] recent context, 2026-05-14 6:34pm GMT+5:30

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 43 obs (16,985t read) | 470,579t work | 96% savings

### May 14, 2026
S85 Major backend expansion of Mr_Storage_Backend — caveman-mode rapid development of new controllers and endpoints (May 14 at 2:21 PM)
S84 Caveman mode activation request (May 14 at 2:21 PM)
825 2:22p 🔵 Mr_Storage_Backend Route Structure Mapped
826 " 🔵 Sales Lead Controller: Full Business Logic Mapped
827 " 🔵 Sales FollowUp Controller: KPI Endpoint is Stub
828 2:23p 🔵 Admin Lead Controller: CSV Import, Round-Robin, and Smart Re-assignment
829 " 🔵 Admin Customer Controller: Aggregates Financial Summary on Detail View
830 " 🔵 Invoice Controller: PO Number Carry-Forward and Role-Based Access Guard
831 " 🔵 Payment Schedule Controller: Auto-Rolls Up to Invoice Paid When All Installments Complete
832 " 🔵 Quotation Controller: AI Summary Generation and Lifecycle Advancement on Send
833 " 🔵 Admin PO Controller: Approval Syncs Status to Lead Document
834 " 🔵 Admin Dashboard: AI vs Human Tracking and MongoDB Aggregation for Pipeline Metrics
835 " 🔵 File Upload: S3 Presigned URL Flow with Lead Document Registry
836 2:24p 🔵 PaymentSchedule Model Uses 'stages' But Controller Uses 'payments' — Schema Mismatch
837 " 🔵 Lead Model: Full Schema with AI Scoring, Document Registry, and Lifecycle State Flags
838 " 🔵 Sales Route Index Wires 'Dead' Controller Methods Inline — Not Actually Dead
839 " 🔵 Building and ProjectBudget Models Defined But Have No Routes or Controllers
840 2:25p 🔵 Common Routes Index Also Wires 'Dead' getLeadQuotations and getLeadInvoices Inline
841 " 🔵 Sequential ID Generation Utilities Have Race Condition Risk
842 " ⚖️ AuditLog Model is INSERT-ONLY by Design
843 " 🔵 Five User Roles Defined But Only Admin and Sales Have Routes
844 2:26p 🟣 Sales Lead Controller Massively Expanded: 8 New Endpoints Including Building Management, CSV Import/Export, and Activity Logging
845 " 🟣 Sales FollowUp Controller: AI Script Assistant Added Using Claude API, KPI Stub Replaced with Real Analytics
846 2:27p 🟣 New Sales Customer Controller Created: Scoped Customer Management for Sales Role
847 2:28p 🟣 Admin Lead Controller Expanded: Budget Management, Lead Termination, AI Leads View, Signed Contracts, and Terminated Leads Endpoints
S86 Caveman mode — Sales Lead Management API endpoints implemented for Mr_Storage_Backend (May 14 at 2:29 PM)
848 2:30p 🟣 Sales Lead Routes Fully Wired: All New Controller Methods Now Have API Endpoints
S87 Caveman-style sales module backend implementation — Part 2 of multi-part feature build for Mr_Storage_Backend (May 14 at 3:38 PM)
849 4:22p 🟣 Sales Follow-Up Routes Expanded with Analytics and AI Script Endpoints
850 4:23p 🔵 Sales Routes Index Structure in Mr_Storage_Backend
851 " 🟣 Sales Routes Index Updated: Customers Sub-Router and Quotations Endpoint Added
852 " 🟣 New Customer Routes File Created for Sales Module
853 5:06p 🟣 Sales Module: Follow-up and Customer Controllers/Routes Added
854 6:26p 🔵 Mr_Storage_Backend API Plan Contains 88 Planned APIs
S88 API Plan vs. Implementation Progress Audit — Mr_Storage_Backend (admin_panel_sales_panel_v2.md) (May 14 at 6:26 PM)
855 6:28p 🔵 Mr_Storage_Backend API Implementation Coverage Audit
856 " 🔵 Mr_Storage_Backend: Implemented NEW and CHANGE Endpoints Inventory
857 " 🔵 Sales Lead Controller: Full Implementation Details
858 " 🔵 Sales Followup Controller: AI Script via Anthropic SDK + Analytics
859 " 🔵 Route-Spec Mismatches: Admin PO Assign and Admin Customer Projects
860 6:29p 🔵 Corrected API Coverage: 69/83 Matched After Including sales/customer.routes.js
861 " 🔵 Sales Customer Controller: Ownership-Scoped Customer Management
862 " 🔵 Mr_Storage_Backend Full Project Structure
863 6:31p 🔵 Admin Lead Controller: Budget, Terminate, and Lifecycle Views Implemented but Not Routed
864 " 🔵 Admin Customer Controller: Missing createCustomer and getCustomerStats Handlers
865 " 🔵 Common Quotation Controller: AI Summary Generation and Lifecycle Advancement on Send
866 " 🔵 Common Invoice and Payment Controllers: PO Number Reuse and Payment Rollup Logic
867 " 🔵 Sales Dashboard Controller: Full v2 Implementation with Trend Windowing Utility

Access 471k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>