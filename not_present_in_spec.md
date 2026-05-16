1. Added `height` field to Lead model and included it in `createProject` (sales controller).
2. Added `jobId` field to Lead model — auto-generated as `PRO-001`, `PRO-002`, ... via pre-save hook. Unique + sparse index. Backfilled on all existing leads.
3. Added `endDate` field (Date, default null) to Lead model — set manually to indicate project completion date.
