# SM Quoting Tool — Backend v6 → v7 conversion

This backend was already a port of **SM-QuotingTool v6**. These changes bring it to
**v7 parity** with the client MVP (the Netlify build) and add **server-side persistence**
for the features the MVP previously kept only in the browser. The core PEMB/storage quote
math, default pricing rules, and shipper item matchers were already in sync and are unchanged.

## New pricing/engine modules (pure, unit-tested)
- `services/quoting/changeOrderEngine.js` — change-order math (`newTotal`, profit, margin, markup→sell, CO numbering)
- `services/quoting/customQuoteEngine.js` — custom quote (`sell = sellOverride || totalCost/(1-margin)`)
- `services/quoting/depositMilestoneEngine.js` — deposit (pct/flat) + milestone schedule totals
- `services/quoting/staircase.js` — multi-story staircase sell (`count × unitCost`, default 35000)
- `services/quoting/quotePricingOrchestrator.js` — now folds `staircase` sell into `grandTotal`

All formulas verified against the MVP by `scripts/test-v7-parity.js` (run: `node scripts/test-v7-parity.js`).

## New document generators (print-ready HTML → PDF via puppeteer)
- `changeOrderDocument.js`, `customQuoteDocument.js`, `depositMilestoneDocument.js`
- `companyInfo.js` (SM / SBD brands), `htmlPdf.js` (shared renderer)

## New models
- `ChangeOrder`, `CustomQuote`, `SavedQuote` (the shared quote-library store)
- `EstimateQuote` extended: `depositTerms`, `milestoneSchedule`, `milestoneNote`, `multiStory`,
  `companyBrand`, `companyLogoUrl`, `employeeName`, `employeeRole`

## New endpoints (under `/api/sales/...`, also `/api/admin/...`)
Change orders — `/change-orders` (GET list, POST create), `/change-orders/:coId` (PUT/DELETE),
`/change-orders/preview` (math), `/change-orders/:coId/pdf`, `/change-orders/pdf`
Custom quotes — `/custom-quotes` (GET/POST), `/custom-quotes/:id` (GET/PUT/DELETE),
`/custom-quotes/preview`, `/custom-quotes/:id/pdf`
Estimate extras — `/estimates/deposit/preview`, `/estimates/milestones/preview`,
`/estimates/staircase/preview`, `/estimates/users` (roster for the PIN UX),
`/estimates/:id/deposit` (PUT), `/estimates/:id/milestones` (PUT), `/estimates/:id/multi-story` (PUT),
`/estimates/documents/deposit-receipt/pdf`, `/estimates/documents/milestones/pdf`
Quote library (Firebase replacement) — `/quotes-store/quotes` (GET), `/quotes-store/quotes/:id` (PUT/DELETE),
`/quotes-store/change-orders` (GET), `/quotes-store/change-orders/:id` (PUT/DELETE)

## Frontend — `SM-QuotingTool-API.html`
This is now the **full v7 MVP** app plus a small backend-integration layer (top-right "Backend"
panel). It computes client-side exactly like the MVP and **persists the shared quote library +
change orders to the backend** via `/quotes-store` (replacing Firebase). Connect with email+password
(calls `/api/auth/login`) or paste a JWT. With no connection it runs on the local cache, unchanged.

## Known minor follow-ups
- The main quote/SOW/contract PDFs still use the generator's built-in logo; CO/custom/deposit/
  milestone docs already honor `companyBrand`/logo. Wiring `companyBrand` into the main docs is a
  small optional enhancement.
- Change orders exist both as a structured model (`/change-orders`, with PDF) and inside the
  shared library the MVP writes to (`/quotes-store/change-orders`). The MVP frontend uses the
  latter; API consumers can use the former.
