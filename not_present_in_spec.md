1. Added `height` field to Lead model and included it in `createProject` (sales controller).
2. Added `jobId` field to Lead model — auto-generated as `PRO-001`, `PRO-002`, ... via pre-save hook. Unique + sparse index. Backfilled on all existing leads.
3. Added `endDate` field (Date, default null) to Lead model — set manually to indicate project completion date.
4. Enhanced `POST /api/sales/leads` to support UI payload aliases not in v2 spec:
   - Email: `customerEmail` OR `email` OR `emailAddress`
   - Name: `customerName` OR `firstName + lastName`
   - Phone: `customerPhone` OR `phone` OR `phoneNumber`
   - Building type: `buildingType` OR `projectType` OR `structureType`
   - Location: `location` OR `city` OR `projectLocation` OR `siteLocation` OR `companyLocation` (fallback: `TBD`)
   - Country code: `customerCountryCode` OR `countryCode` OR `phoneCountryCode` (fallback: `+91`)
5. `POST /api/sales/leads` now auto-generates `projectName` if missing (based on company/name + building type + timestamp), so lead creation succeeds with current Sales UI form.
6. Duplicate-project guard for sales lead creation now runs only when explicit `projectName` is provided in request body.
7. `POST /api/sales/leads` now persists additional UI-mapped fields:
   - `notes` → `Lead.notes`
   - `estimatedValue` → `Lead.quoteValue`
   - `height` saved along with `width` and `length`
