# Plant Panel — Backend Implementation Document (FINAL)
**Based on actual codebase: Mr_Storage_Backend + SM_DT_COST_260224a.xlsx (1,385 items)**
**Version: merged from plant_panel_implementation_doc + smdt_bom_schema_api_document**

---

## HOW TO READ THIS DOCUMENT

- **CHANGE** = modify an existing file
- **NEW** = create a new file entirely
- **ADD TO** = add content to an existing file without touching the rest

Codebase patterns used throughout:
- Auth: `verifyToken` (`src/middleware/auth.js`) + `roleGuard` (`src/middleware/roleGuard.js`)
- Responses: `success()`, `created()`, `badRequest()`, `notFound()`, `forbidden()` from `src/utils/apiResponse.js`
- S3 uploads: presigned URL pattern from `src/controllers/common/upload.controller.js` — reuse as-is
- Claude: `@anthropic-ai/sdk` already installed, follow pattern in `src/services/ai/chat.service.js`
- Async wrapper: `asyncHandler` from `src/utils/asyncHandler.js`

---

## PART 1 — CHANGES TO EXISTING FILES

---

### 1.1 CHANGE: `src/models/Building.js`

The existing schema has no `drawings` field. Add it after the `status` field:

```js
drawings: [
  {
    versionNumber:   { type: Number, required: true },
    fileUrl:         { type: String, required: true },
    fileName:        { type: String, required: true },
    status: {
      type: String,
      enum: ['pending_review', 'approved', 'rejected'],
      default: 'pending_review',
    },
    rejectionReason: { type: String, default: '' },
    uploadedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt:      { type: Date, default: Date.now },
    reviewedAt:      { type: Date, default: null },
  },
],
```

---

### 1.2 CHANGE: `src/config/constants.js`

**Extend `BUILDING_STATUSES`** (find existing array and replace):
```js
const BUILDING_STATUSES = [
  'pending', 'drawing_pending', 'drawing_uploaded',
  'drawing_approved', 'drawing_rejected',
  'bom_pending', 'bom_approved', 'bom_confirmed',
  'completed',
]
```

**Add new constants** before `module.exports`:
```js
// ── Plant Panel ───────────────────────────────────────────────────────────────
const BOM_JOB_STATUSES         = ['queued', 'processing', 'completed', 'failed']
const VENDOR_STATUSES          = ['active', 'inactive']
const CARRIER_STATUSES         = ['active', 'inactive']
const SMDT_COST_UNITS          = ['FT', 'LB', 'EA']
const SHIPPER_REQUEST_STATUSES = [
  'sent', 'submitted',
  'comparison_processing', 'comparison_completed', 'comparison_failed',
  'approved', 'rejected', 'resubmit_requested',
]

const SMDT_CATEGORIES = [
  'Insulation', 'Joist', 'Panels', 'TRIM', 'Mastic', 'Screws',
  'ABolts', 'CLIPS', 'Cable', 'Flange_Brace', 'Jambs', 'DCOL',
  'ZGIRT', 'OPEN CHANNEL', 'EaveStruts', 'ACCESSORIES', 'SKTLIGHT',
  'ANGL1', 'TS_PANEL', 'frames',
]
// ^ These are the exact 20 sheet names from the SMDT Excel file.
// 1,385 total items. TRIM=555, EaveStruts=336, frames=5.
```

**Add to `AUDIT_TYPES` array** (add `'plant'` to the existing array):
```js
const AUDIT_TYPES = [
  'lead', 'invoice', 'quotation', 'meeting',
  'followup', 'user', 'escalation', 'po', 'chat', 'activity',
  'plant',  // ← ADD THIS
]
```

**Add to `AUDIT_ACTIONS` object**:
```js
// Drawing
DRAWING_UPLOADED:          'drawing.uploaded',
DRAWING_REVIEWED:          'drawing.reviewed',
// BOM
BOM_JOB_STARTED:           'bom.job_started',
BOM_JOB_COMPLETED:         'bom.job_completed',
BOM_CONFIRMED:             'bom.confirmed',
CONSOLIDATED_BOM_GENERATED:'bom.consolidated_generated',
CONSOLIDATED_BOM_SENT:     'bom.consolidated_sent',
// Shipper
SHIPPER_SUBMITTED:         'shipper.submitted',
SHIPPER_APPROVED:          'shipper.approved',
SHIPPER_RESUBMIT:          'shipper.resubmit_requested',
// Vendor / Carrier
VENDOR_CREATED:            'vendor.created',
VENDOR_UPDATED:            'vendor.updated',
CARRIER_CREATED:           'carrier.created',
CARRIER_UPDATED:           'carrier.updated',
// SMDT
SMDT_BULK_UPLOADED:        'smdt.bulk_uploaded',
SMDT_ITEM_ADDED:           'smdt.item_added',
SMDT_ITEM_UPDATED:         'smdt.item_updated',
SMDT_ITEM_DELETED:         'smdt.item_deleted',
```

**Add to `module.exports`**:
```js
BOM_JOB_STATUSES,
VENDOR_STATUSES,
CARRIER_STATUSES,
SMDT_COST_UNITS,
SMDT_CATEGORIES,
SHIPPER_REQUEST_STATUSES,
```


**Add load planning constants** before `module.exports`:
```js
const BUNDLE_PLAN_STATUSES       = ['draft', 'generated', 'confirmed', 'cancelled']
const PACKING_LIST_PLAN_STATUSES = ['draft', 'generated', 'confirmed', 'cancelled']
const BUNDLE_STATUSES            = ['draft', 'confirmed', 'assigned_to_truck', 'loaded']
const PACKING_LIST_STATUSES      = ['draft', 'confirmed', 'delivery_created', 'dispatched', 'delivered', 'cancelled']

const BUNDLE_TYPES = ['panels', 'trim', 'framing', 'fasteners', 'accessories', 'mixed', 'custom']
const STACK_LEVELS = ['bottom', 'middle', 'top', 'any']

const PLANT_TRUCK_TYPES = {
  SEMI_53: {
    label: '53 ft Semi',
    maxWeight: 45000,
    hardMaxWeight: 48000,
    maxLengthFeet: 53,
  },
  HOTSHOT_40: {
    label: '40 ft Hot Shot',
    maxWeight: 18000,
    hardMaxWeight: 18000,
    maxLengthFeet: 40,
  },
}

const DELIVERY_STATUSES = [
  'draft', 'bidding_sent', 'carrier_selected', 'scheduled',
  'in_transit', 'delivered', 'cancelled',
]

const FREIGHT_BID_STATUSES = ['sent', 'submitted', 'selected', 'rejected', 'expired']
```

**Add to `AUDIT_ACTIONS` object**:
```js
// Load Planning
BUNDLE_PLAN_GENERATED:        'bundle_plan.generated',
BUNDLE_PLAN_CONFIRMED:        'bundle_plan.confirmed',
PACKING_LIST_PLAN_GENERATED:  'packing_list_plan.generated',
PACKING_LIST_PLAN_CONFIRMED:  'packing_list_plan.confirmed',
DELIVERY_CREATED:             'delivery.created',
FREIGHT_BIDS_SENT:            'freight_bids.sent',
FREIGHT_BID_SELECTED:         'freight_bid.selected',
```

**Add to `module.exports`**:
```js
BUNDLE_PLAN_STATUSES,
PACKING_LIST_PLAN_STATUSES,
BUNDLE_STATUSES,
PACKING_LIST_STATUSES,
BUNDLE_TYPES,
STACK_LEVELS,
PLANT_TRUCK_TYPES,
DELIVERY_STATUSES,
FREIGHT_BID_STATUSES,
```

---

## PART 2 — NEW MODEL FILES

---

### 2.1 REPLACE / ADD: SMDT cost master models

The old single `SMDTItem` flat schema is not enough. SMDT cost data must be **versioned**, because old BOM jobs must remain auditable even after a new cost list is uploaded.

#### 2.1.1 NEW: `src/models/SMDTCostVersion.js`

```js
const mongoose = require('mongoose')

const SMDTCostVersionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sourceFileName: { type: String, default: '' },
    sourceFileUrl: { type: String, default: '' },
    effectiveDate: { type: Date, default: null },
    isActive: { type: Boolean, default: false, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    stats: {
      totalItems: { type: Number, default: 0 },
      inserted: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      skippedRows: { type: Number, default: 0 },
      duplicateRows: { type: Number, default: 0 },
      sheets: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
  },
  { timestamps: true }
)

SMDTCostVersionSchema.index({ isActive: 1, createdAt: -1 })
module.exports = mongoose.model('SMDTCostVersion', SMDTCostVersionSchema)
```

#### 2.1.2 REPLACE: `src/models/SMDTItem.js`

```js
const mongoose = require('mongoose')

const SMDTItemSchema = new mongoose.Schema(
  {
    costVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SMDTCostVersion', required: true, index: true },

    category: { type: String, required: true, trim: true, index: true },

    partName: { type: String, required: true, trim: true },
    partNameNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },

    // null only for frames sheet. '--' is a real/default SMDT color, not empty.
    partColor: { type: String, default: null, trim: true },
    partColorNormalized: { type: String, default: null, trim: true, uppercase: true, index: true },

    costUnit: { type: String, enum: ['FT', 'LB', 'EA'], required: true },
    mbsCost: { type: Number, required: true },
    currentMarketCost: { type: Number, default: null },

    // Non-standard SMDT sheets
    laborCost: { type: Number, default: 0 },
    additionalCost: { type: Number, default: 0 },
    materialCost: { type: Number, default: 0 },
    extraMinCost: { type: Number, default: 0 },
    extraMaxCost: { type: Number, default: 0 },

    isFrameType: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    description: { type: String, default: '' },

    rawRow: { type: mongoose.Schema.Types.Mixed, default: null },
    rowNumber: { type: Number, default: null },

    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastImportedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

SMDTItemSchema.index(
  { costVersionId: 1, category: 1, partNameNormalized: 1, partColorNormalized: 1 },
  { unique: true }
)
SMDTItemSchema.index({ costVersionId: 1, partNameNormalized: 1 })
SMDTItemSchema.index({ costVersionId: 1, category: 1 })
SMDTItemSchema.index({ partName: 'text', description: 'text' })

module.exports = mongoose.model('SMDTItem', SMDTItemSchema)
```

#### 2.1.3 NEW: `src/models/SMDTColorAlias.js`

```js
const mongoose = require('mongoose')

const SMDTColorAliasSchema = new mongoose.Schema(
  {
    inputColor: { type: String, required: true, trim: true },
    inputColorNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },
    smdtColor: { type: String, required: true, trim: true },
    smdtColorNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

SMDTColorAliasSchema.index({ inputColorNormalized: 1, smdtColorNormalized: 1 }, { unique: true })
module.exports = mongoose.model('SMDTColorAlias', SMDTColorAliasSchema)
```

#### 2.1.4 NEW: `src/models/SMDTPartAlias.js`

```js
const mongoose = require('mongoose')

const SMDTPartAliasSchema = new mongoose.Schema(
  {
    inputPart: { type: String, required: true, trim: true },
    inputPartNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },
    smdtPartName: { type: String, required: true, trim: true },
    smdtPartNameNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },
    category: { type: String, default: null, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

SMDTPartAliasSchema.index({ inputPartNormalized: 1, category: 1 }, { unique: true })
module.exports = mongoose.model('SMDTPartAlias', SMDTPartAliasSchema)
```

---

### 2.2 NEW: `src/models/BOMJob.js`

```js
const mongoose = require('mongoose')

/**
 * One job per BOM file upload per building.
 * Claude does ALL extraction + SMDT matching asynchronously.
 * Frontend polls GET /api/plant/bom/job/:jobId/status until status = completed | failed.
 */
const BOMJobSchema = new mongoose.Schema(
  {
    leadId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    buildingId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Building', required: true },
    buildingNumber: { type: Number, required: true },
    uploadedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    fileName:   { type: String, required: true },
    fileUrl:    { type: String, required: true },
    fileFormat: { type: String, enum: ['ods', 'xlsx', 'xls'], required: true },

    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
    },

    // Set after Claude completes extraction + matching
    totalSheets:    { type: Number, default: 0 },
    totalItems:     { type: Number, default: 0 },
    matchedItems:   { type: Number, default: 0 },
    unmatchedItems: { type: Number, default: 0 },
    frameItems:     { type: Number, default: 0 },
    skippedRows:    { type: Number, default: 0 },

    errorMessage: { type: String, default: null },

    // Plant must confirm all items are priced before BOM can be consolidated
    isConfirmed: { type: Boolean, default: false },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },

    processingStartedAt: { type: Date, default: null },
    processingEndedAt:   { type: Date, default: null },
  },
  { timestamps: true }
)

BOMJobSchema.index({ leadId: 1, buildingId: 1 })
BOMJobSchema.index({ status: 1 })

module.exports = mongoose.model('BOMJob', BOMJobSchema)
```

---

### 2.3 REPLACE: `src/models/BOMItem.js`

```js
const mongoose = require('mongoose')

const BOMItemSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', required: true },
    bomJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'BOMJob', required: true },
    smdtCostVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SMDTCostVersion', default: null },

    sourceSheetName: { type: String, default: '' },
    category: { type: String, default: '' },
    rowNumber: { type: Number, default: null },

    quantity: { type: Number, default: null },
    markId: { type: String, default: '' },
    description: { type: String, default: '' },

    partCode: { type: String, default: null },
    partCodeNormalized: { type: String, default: null, index: true },
    partColor: { type: String, default: null },
    partColorNormalized: { type: String, default: null, index: true },
    resolvedSmdtColor: { type: String, default: null },

    lengthRaw: { type: String, default: null },
    lengthFeet: { type: Number, default: null },
    weight: { type: Number, default: null },
    type: { type: String, default: null },
    gauge: { type: String, default: null },
    angle: { type: String, default: null },

    isFrameType: { type: Boolean, default: false },
    isBuyout: { type: Boolean, default: false },
    rawRow: { type: mongoose.Schema.Types.Mixed, default: null },

    smdtItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'SMDTItem', default: null },
    matchStatus: { type: String, enum: ['matched', 'unmatched', 'ambiguous', 'skipped'], default: 'unmatched', index: true },
    matchConfidence: { type: String, enum: ['exact', 'part_alias', 'color_fallback', 'part_only', 'none'], default: 'none' },
    matchReason: { type: String, default: '' },
    matchCandidates: { type: [mongoose.Schema.Types.Mixed], default: [] },

    costUnit: { type: String, enum: ['FT', 'LB', 'EA'], default: null },
    smdtUnitCost: { type: Number, default: null },
    smdtTotalCost: { type: Number, default: null },

    isManuallyPriced: { type: Boolean, default: false },
    manualUnitCost: { type: Number, default: null },
    manualTotalCost: { type: Number, default: null },
    manualPriceSavedToSMDT: { type: Boolean, default: false },

    isPriced: { type: Boolean, default: false, index: true },
    finalUnitCost: { type: Number, default: null },
    finalTotalCost: { type: Number, default: null },
  },
  { timestamps: true }
)

BOMItemSchema.index({ bomJobId: 1 })
BOMItemSchema.index({ leadId: 1, buildingId: 1 })
BOMItemSchema.index({ partCodeNormalized: 1, partColorNormalized: 1 })
BOMItemSchema.index({ matchStatus: 1, isPriced: 1 })

module.exports = mongoose.model('BOMItem', BOMItemSchema)
```

---

### 2.4 NEW: `src/models/ConsolidatedBOM.js`

```js
const mongoose = require('mongoose')

const ConsolidatedItemSchema = new mongoose.Schema(
  {
    partCode:        { type: String, default: null },
    partColor:       { type: String, default: null },
    description:     { type: String, default: '' },
    category:        { type: String, default: '' },
    costUnit:        { type: String, enum: ['FT', 'LB', 'EA'], default: null },
    totalQty:        { type: Number, default: 0 },
    totalLengthFeet: { type: Number, default: 0 },
    totalWeight:     { type: Number, default: 0 },
    totalCost:       { type: Number, default: 0 },
    buildings:       { type: [Number], default: [] },
    markIds:         { type: [String], default: [] },
  },
  { _id: true }
)

const SentVendorSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    sentAt:   { type: Date, default: Date.now },
    token:    { type: String, required: true },
  },
  { _id: true }
)

const ConsolidatedBOMSchema = new mongoose.Schema(
  {
    leadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['draft', 'sent_to_vendor', 'vendor_submitted', 'approved'],
      default: 'draft',
    },
    fileUrl:       { type: String, default: null },
    totalCost:     { type: Number, default: 0 },
    items:         { type: [ConsolidatedItemSchema], default: [] },
    sentToVendors: { type: [SentVendorSchema], default: [] },
  },
  { timestamps: true }
)

ConsolidatedBOMSchema.index({ leadId: 1 })
module.exports = mongoose.model('ConsolidatedBOM', ConsolidatedBOMSchema)
```

---

### 2.5 NEW: `src/models/ShipperRequest.js`

```js
const mongoose = require('mongoose')

/**
 * Sent to a material Vendor asking them to upload their shipper file + quote.
 * Public upload link: GET/POST /api/public/vendor-upload/:token
 *
 * Revision/resubmission flow:
 * - Vendor submits quote file
 * - Plant runs compare API
 * - Backend stores auto-generated exceptions
 * - Plant approves OR requests resubmission using saved exceptions/manual note
 * - Vendor can upload corrected file again when status = resubmit_requested
 */
const ExceptionSchema = new mongoose.Schema(
  {
    partCode:    { type: String, default: '' },
    description: { type: String, default: '' },
    expected:    { type: mongoose.Schema.Types.Mixed, default: null },
    received:    { type: mongoose.Schema.Types.Mixed, default: null },
    issueType: {
      type: String,
      enum: [
        'missing',
        'qty_mismatch',
        'length_mismatch',
        'weight_mismatch',
        'price_mismatch',
        'extra',
        'ambiguous',
      ],
      default: 'missing',
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    reason: { type: String, default: '' },
    source: {
      type: String,
      enum: ['manual', 'auto_compare'],
      default: 'manual',
    },
  },
  { _id: true }
)

const ShipperRequestSchema = new mongoose.Schema(
  {
    leadId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    consolidatedBOMId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedBOM', required: true },
    vendorId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    token:             { type: String, required: true, unique: true },
    tokenExpiresAt:    { type: Date, default: null },
    ourFileUrl:        { type: String, default: null },
    sentAt:            { type: Date, default: Date.now },

    status: {
      type: String,
      enum: [
        'sent', 'submitted',
        'comparison_processing', 'comparison_completed', 'comparison_failed',
        'approved', 'rejected', 'resubmit_requested',
      ],
      default: 'sent',
    },

    // Vendor fills these via public upload link
    submittedFileUrl:  { type: String, default: null },
    submittedAt:       { type: Date, default: null },
    submittedFileName: { type: String, default: '' },
    submittedFileType: {
      type: String,
      enum: ['pdf', 'xlsx', 'xls', 'csv', 'unknown'],
      default: 'unknown',
    },
    quoteValue:        { type: Number, default: null },

    // Auto comparison result against ConsolidatedBOM.items
    comparisonStatus: {
      type: String,
      enum: ['not_started', 'processing', 'completed', 'failed'],
      default: 'not_started',
    },
    comparisonSummary: {
      expectedLines:     { type: Number, default: 0 },
      vendorLines:       { type: Number, default: 0 },
      matchedLines:      { type: Number, default: 0 },
      missingItems:      { type: Number, default: 0 },
      extraItems:        { type: Number, default: 0 },
      qtyMismatches:     { type: Number, default: 0 },
      lengthMismatches:  { type: Number, default: 0 },
      weightMismatches:  { type: Number, default: 0 },
      priceMismatches:   { type: Number, default: 0 },
      ambiguousMatches:  { type: Number, default: 0 },
    },
    comparisonRanAt: { type: Date, default: null },
    comparisonError: { type: String, default: null },

    // Plant review
    manualReviewNote: { type: String, default: '' },
    exceptions:       { type: [ExceptionSchema], default: [] },
    reviewedAt:       { type: Date, default: null },
    reviewedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

ShipperRequestSchema.index({ token: 1 }, { unique: true })
ShipperRequestSchema.index({ leadId: 1 })
ShipperRequestSchema.index({ vendorId: 1 })
ShipperRequestSchema.index({ consolidatedBOMId: 1 })
ShipperRequestSchema.index({ status: 1, comparisonStatus: 1 })

module.exports = mongoose.model('ShipperRequest', ShipperRequestSchema)
```

---

### 2.6 NEW: `src/models/Vendor.js`

```js
const mongoose = require('mongoose')

// Material vendors (steel, panels etc.) — NOT freight carriers
const VendorSchema = new mongoose.Schema(
  {
    vendorCode:    { type: String, unique: true },
    // Auto-generated on create: "VND-0001", "VND-0002" etc.

    vendorName:    { type: String, required: true, trim: true },
    contactName:   { type: String, default: '' },
    email:         { type: String, required: true, trim: true, lowercase: true },
    phone:         { type: String, default: '' },
    address:       { type: String, default: '' },
    vendorType: {
      type: String,
      enum: ['steel', 'insulation', 'panels', 'trim', 'hardware', 'other'],
      default: 'other',
    },
    materialTypes: { type: [String], default: [] },
    notes:         { type: String, default: '' },
    status:        { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
)

VendorSchema.index({ status: 1 })
VendorSchema.index({ email: 1 }, { unique: true })

module.exports = mongoose.model('Vendor', VendorSchema)
```

---

### 2.7 NEW: `src/models/FreightCarrier.js`

```js
const mongoose = require('mongoose')

const FreightCarrierSchema = new mongoose.Schema(
  {
    carrierCode: { type: String, unique: true },
    // Auto-generated: "CAR-0001", "CAR-0002" etc.

    carrierName:              { type: String, required: true, trim: true },
    contactName:              { type: String, default: '' },
    email:                    { type: String, required: true, trim: true, lowercase: true },
    phone:                    { type: String, default: '' },
    address:                  { type: String, default: '' },
    notes:                    { type: String, default: '' },
    status:                   { type: String, enum: ['active', 'inactive'], default: 'active' },
    totalDeliveriesCompleted: { type: Number, default: 0 },
  },
  { timestamps: true }
)

FreightCarrierSchema.index({ status: 1 })
FreightCarrierSchema.index({ email: 1 }, { unique: true })

module.exports = mongoose.model('FreightCarrier', FreightCarrierSchema)
```

---


### 2.8 NEW: `src/models/VendorQuoteLine.js`

Stores every extracted line from the vendor-uploaded quote file. This is required for auditability; otherwise the system can say there is a mismatch but cannot show exactly which vendor row caused it.

```js
const mongoose = require('mongoose')

const VendorQuoteLineSchema = new mongoose.Schema(
  {
    shipperRequestId:  { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    leadId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    consolidatedBOMId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedBOM', required: true, index: true },
    vendorId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },

    pageNumber:   { type: Number, default: null },
    rowNumber:    { type: Number, default: null },
    vendorLineNo: { type: String, default: '' },

    qty: { type: Number, default: null },

    partCode:           { type: String, default: null },
    partCodeNormalized: { type: String, default: null, index: true },

    description: { type: String, default: '' },

    pieceMark:           { type: String, default: '' },
    pieceMarkNormalized: { type: String, default: '', index: true },

    color:           { type: String, default: null },
    colorNormalized: { type: String, default: null, index: true },

    lengthText: { type: String, default: null },
    lengthFeet: { type: Number, default: null },
    weight:     { type: Number, default: null },

    unitPrice: { type: Number, default: null },
    priceUnit: {
      type: String,
      enum: ['EA', 'FT', 'LB', 'LOT', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    amount: { type: Number, default: null },

    punchInfo: { type: String, default: '' },
    bendInfo:  { type: String, default: '' },
    notes:     { type: String, default: '' },

    extractionMethod: {
      type: String,
      enum: ['pdf_text', 'ocr', 'claude', 'excel', 'hybrid'],
      default: 'hybrid',
    },
    extractionConfidence: { type: Number, min: 0, max: 1, default: null },
    warnings:             { type: [String], default: [] },

    rawText: { type: String, default: '' },
    rawRow:  { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
)

VendorQuoteLineSchema.index({ shipperRequestId: 1 })
VendorQuoteLineSchema.index({ shipperRequestId: 1, partCodeNormalized: 1, lengthFeet: 1 })
VendorQuoteLineSchema.index({ partCodeNormalized: 1, colorNormalized: 1 })
VendorQuoteLineSchema.index({ pieceMarkNormalized: 1 })

module.exports = mongoose.model('VendorQuoteLine', VendorQuoteLineSchema)
```

---

### 2.9 NEW: `src/models/QuoteComparisonResult.js`

Stores deterministic comparison results between `ConsolidatedBOM.items` and extracted `VendorQuoteLine` rows.

```js
const mongoose = require('mongoose')

const QuoteComparisonResultSchema = new mongoose.Schema(
  {
    shipperRequestId:  { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    leadId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    consolidatedBOMId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedBOM', required: true, index: true },
    vendorId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },

    consolidatedItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
    vendorQuoteLineId:  { type: mongoose.Schema.Types.ObjectId, ref: 'VendorQuoteLine', default: null },

    status: {
      type: String,
      enum: [
        'matched',
        'missing_in_vendor_quote',
        'extra_in_vendor_quote',
        'qty_mismatch',
        'length_mismatch',
        'weight_mismatch',
        'part_mismatch',
        'price_mismatch',
        'ambiguous_match',
      ],
      required: true,
      index: true,
    },

    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },

    expected: {
      partCode:    { type: String, default: null },
      partColor:   { type: String, default: null },
      description: { type: String, default: '' },
      qty:         { type: Number, default: null },
      lengthFeet:  { type: Number, default: null },
      weight:      { type: Number, default: null },
      costUnit:    { type: String, default: null },
      unitCost:    { type: Number, default: null },
      totalCost:   { type: Number, default: null },
      markIds:     { type: [String], default: [] },
    },

    received: {
      partCode:    { type: String, default: null },
      partColor:   { type: String, default: null },
      description: { type: String, default: '' },
      qty:         { type: Number, default: null },
      lengthFeet:  { type: Number, default: null },
      weight:      { type: Number, default: null },
      priceUnit:   { type: String, default: null },
      unitPrice:   { type: Number, default: null },
      amount:      { type: Number, default: null },
      pieceMark:   { type: String, default: '' },
    },

    difference: {
      qtyDiff:       { type: Number, default: null },
      lengthDiff:    { type: Number, default: null },
      weightDiff:    { type: Number, default: null },
      unitPriceDiff: { type: Number, default: null },
      amountDiff:    { type: Number, default: null },
    },

    matchConfidence: { type: Number, min: 0, max: 1, default: null },
    matchMethod: {
      type: String,
      enum: [
        'exact_part_color_length',
        'part_length_grouped',
        'part_only_grouped',
        'piece_mark',
        'alias',
        'description_ai_suggestion',
        'none',
      ],
      default: 'none',
    },
    reason: { type: String, default: '' },
  },
  { timestamps: true }
)

QuoteComparisonResultSchema.index({ shipperRequestId: 1 })
QuoteComparisonResultSchema.index({ status: 1 })
QuoteComparisonResultSchema.index({ severity: 1 })
QuoteComparisonResultSchema.index({ consolidatedBOMId: 1, vendorId: 1 })

module.exports = mongoose.model('QuoteComparisonResult', QuoteComparisonResultSchema)
```

---



### 2.10 NEW: `src/models/BundlePlan.js`

One bundle plan is generated after a `ShipperRequest` is approved. It is based on the accepted vendor shipper / quote lines stored in `VendorQuoteLine`.

```js
const mongoose = require('mongoose')

const BundlePlanSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    planNumber: { type: String, required: true, unique: true },

    status: {
      type: String,
      enum: ['draft', 'generated', 'confirmed', 'cancelled'],
      default: 'generated',
      index: true,
    },

    totalSourceItems: { type: Number, default: 0 },
    totalBundles: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    maxLengthFeet: { type: Number, default: 0 },

    warnings: { type: [String], default: [] },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

BundlePlanSchema.index({ shipperRequestId: 1 }, { unique: true })
module.exports = mongoose.model('BundlePlan', BundlePlanSchema)
```

---

### 2.11 NEW: `src/models/Bundle.js`

A bundle is a physical group of one or more vendor quote / shipper lines. The stacking fields are generated by the backend algorithm first, then shown to plant users for manual verification and edits.

```js
const mongoose = require('mongoose')

const BundleItemSchema = new mongoose.Schema(
  {
    vendorQuoteLineId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorQuoteLine', required: true, index: true },
    partCode: { type: String, default: '' },
    description: { type: String, default: '' },
    category: { type: String, default: '' },
    color: { type: String, default: '' },
    qty: { type: Number, required: true },
    lengthFeet: { type: Number, default: null },
    widthFeet: { type: Number, default: null },
    heightFeet: { type: Number, default: null },
    weight: { type: Number, default: 0 },
    markIds: { type: [String], default: [] },
    sourceLineSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
)

const BundleSchema = new mongoose.Schema(
  {
    bundlePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'BundlePlan', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },

    bundleNo: { type: String, required: true, index: true },
    bundleType: {
      type: String,
      enum: ['panels', 'trim', 'framing', 'fasteners', 'accessories', 'mixed', 'custom'],
      default: 'mixed',
      index: true,
    },
    title: { type: String, default: '' },
    items: { type: [BundleItemSchema], default: [] },

    totalQty: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    maxLengthFeet: { type: Number, default: 0 },
    estimatedWidthFeet: { type: Number, default: null },
    estimatedHeightFeet: { type: Number, default: null },

    packingListId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackingList', default: null, index: true },

    status: {
      type: String,
      enum: ['draft', 'confirmed', 'assigned_to_truck', 'loaded'],
      default: 'draft',
      index: true,
    },

    stacking: {
      stackLevel: { type: String, enum: ['bottom', 'middle', 'top', 'any'], default: 'any' },
      canStackOnTop: { type: Boolean, default: true },
      canHaveItemsStackedOnIt: { type: Boolean, default: true },
      isFragile: { type: Boolean, default: false },
      mustStayFlat: { type: Boolean, default: false },
      keepDry: { type: Boolean, default: false },
      requiresEdgeProtection: { type: Boolean, default: false },
      loadingPriority: { type: Number, default: 50 },
      unloadingPriority: { type: Number, default: 50 },
      stackingNotes: { type: String, default: '' },
    },

    loadSequence: { type: Number, default: null },
    handlingInstruction: { type: String, default: '' },
    warnings: { type: [String], default: [] },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

BundleSchema.index({ bundlePlanId: 1, bundleNo: 1 }, { unique: true })
module.exports = mongoose.model('Bundle', BundleSchema)
```

---

### 2.12 NEW: `src/models/PackingListPlan.js`

`PackingListPlan` is the truck-load plan master. There is no separate `LoadingPlan` model. In this business flow, **Packing List = Truck Load Plan**.

```js
const mongoose = require('mongoose')

const PackingListPlanSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    bundlePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'BundlePlan', required: true, index: true },

    planNumber: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['draft', 'generated', 'confirmed', 'cancelled'],
      default: 'generated',
      index: true,
    },

    totalPackingLists: { type: Number, default: 0 },
    totalBundles: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    maxLengthFeet: { type: Number, default: 0 },

    truckSummary: {
      semi53Count: { type: Number, default: 0 },
      hotshot40Count: { type: Number, default: 0 },
      totalTrucks: { type: Number, default: 0 },
    },

    warnings: { type: [String], default: [] },
    overrideReason: { type: String, default: '' },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

PackingListPlanSchema.index({ bundlePlanId: 1 }, { unique: true })
module.exports = mongoose.model('PackingListPlan', PackingListPlanSchema)
```

---

### 2.13 NEW: `src/models/PackingList.js`

Each packing list represents one truck load. Example: `PL-001 / TRUCK-1 / SEMI_53`, `PL-002 / TRUCK-2 / HOTSHOT_40`.

```js
const mongoose = require('mongoose')

const PackingListSchema = new mongoose.Schema(
  {
    packingListPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackingListPlan', required: true, index: true },
    bundlePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'BundlePlan', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },

    packingListNo: { type: String, required: true, index: true },
    truckNo: { type: String, required: true },
    truckType: { type: String, enum: ['SEMI_53', 'HOTSHOT_40'], required: true, index: true },
    truckLabel: { type: String, default: '' },
    maxTruckWeight: { type: Number, required: true },
    hardMaxTruckWeight: { type: Number, default: null },
    maxTruckLengthFeet: { type: Number, required: true },

    bundleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' }],
    totalBundles: { type: Number, default: 0 },
    totalItems: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    maxLengthFeet: { type: Number, default: 0 },

    loadLayout: {
      bottomLayerBundleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' }],
      middleLayerBundleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' }],
      topLayerBundleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' }],
      loadingNotes: { type: String, default: '' },
    },

    warnings: { type: [String], default: [] },
    overrideReason: { type: String, default: '' },
    status: {
      type: String,
      enum: ['draft', 'confirmed', 'delivery_created', 'dispatched', 'delivered', 'cancelled'],
      default: 'draft',
      index: true,
    },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

PackingListSchema.index({ packingListPlanId: 1, packingListNo: 1 }, { unique: true })
module.exports = mongoose.model('PackingList', PackingListSchema)
```

---

### 2.14 NEW: `src/models/Delivery.js`

Delivery is created only after the PackingListPlan / Truck Load Plan is confirmed.

```js
const mongoose = require('mongoose')

const DeliverySchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    bundlePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'BundlePlan', required: true, index: true },
    packingListPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackingListPlan', required: true, index: true },

    deliveryNumber: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['draft', 'bidding_sent', 'carrier_selected', 'scheduled', 'in_transit', 'delivered', 'cancelled'],
      default: 'draft',
      index: true,
    },

    pickupLocation: { type: String, default: '' },
    deliveryLocation: { type: String, default: '' },
    pickupDate: { type: Date, default: null },
    expectedDeliveryDate: { type: Date, default: null },

    totalWeight: { type: Number, default: 0 },
    totalBundles: { type: Number, default: 0 },
    totalPackingLists: { type: Number, default: 0 },
    truckSummary: {
      semi53Count: { type: Number, default: 0 },
      hotshot40Count: { type: Number, default: 0 },
      totalTrucks: { type: Number, default: 0 },
    },
    packingListIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PackingList' }],
    selectedCarrierBidId: { type: mongoose.Schema.Types.ObjectId, ref: 'FreightBid', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

DeliverySchema.index({ packingListPlanId: 1 }, { unique: true })
module.exports = mongoose.model('Delivery', DeliverySchema)
```

---

### 2.15 NEW: `src/models/FreightBid.js`

Each selected freight carrier receives one bid request for the delivery.

```js
const mongoose = require('mongoose')

const FreightBidSchema = new mongoose.Schema(
  {
    deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
    carrierId: { type: mongoose.Schema.Types.ObjectId, ref: 'FreightCarrier', required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: ['sent', 'submitted', 'selected', 'rejected', 'expired'],
      default: 'sent',
      index: true,
    },

    quotedAmount: { type: Number, default: null },
    currency: { type: String, default: 'USD' },
    estimatedPickupDate: { type: Date, default: null },
    estimatedDeliveryDate: { type: Date, default: null },
    carrierNotes: { type: String, default: '' },
    submittedAt: { type: Date, default: null },
    sentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
)

FreightBidSchema.index({ deliveryId: 1, carrierId: 1 }, { unique: true })
module.exports = mongoose.model('FreightBid', FreightBidSchema)
```


## PART 3 — NEW SERVICE FILES

---

### 3.1 REPLACE: `src/services/plant/smdt.service.js`

This import must create a `SMDTCostVersion` first, then store all rows as version-linked `SMDTItem` records. Hard truth: importing into one flat table will break historical pricing.

```js
const ExcelJS = require('exceljs')
const https = require('https')
const http = require('http')
const SMDTCostVersion = require('../../models/SMDTCostVersion')
const SMDTItem = require('../../models/SMDTItem')

const cleanStr = (val) => {
  if (val == null) return null
  const s = String(val).replace(/^'+/, '').replace(/'+$/, '').trim()
  return s || null
}

const normalizeCode = (val) => {
  const s = cleanStr(val)
  if (!s) return null
  return s.toUpperCase().replace(/\s+/g, '')
}

const toNum = (val, fallback = null) => {
  if (val == null || val === '') return fallback
  const n = Number(String(val).replace(/[$,]/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

const isAnnotationRow = (partName) => {
  if (!partName) return true
  const lower = partName.toLowerCase()
  return ['need to', 'ft -', 'ea -', 'lb -', 'cost unit', 'added cost', 'color prefix'].some(p => lower.startsWith(p))
}

const downloadBuffer = (url) => new Promise((resolve, reject) => {
  const lib = url.startsWith('https') ? https : http
  lib.get(url, (res) => {
    const chunks = []
    res.on('data', c => chunks.push(c))
    res.on('end', () => resolve(Buffer.concat(chunks)))
    res.on('error', reject)
  }).on('error', reject)
})

const importSMDTFromUrl = async (fileUrl, uploadedBy, options = {}) => {
  const buffer = await downloadBuffer(fileUrl)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const version = await SMDTCostVersion.create({
    name: options.name || `SMDT Cost ${new Date().toISOString().slice(0, 10)}`,
    sourceFileName: options.fileName || '',
    sourceFileUrl: fileUrl,
    effectiveDate: options.effectiveDate || null,
    uploadedBy,
    isActive: false,
  })

  const stats = { inserted: 0, updated: 0, skippedRows: 0, duplicateRows: 0, totalItems: 0, sheets: [] }
  const skipSheets = ['Sheet1', 'Sheet2', 'Sheet3']
  const now = new Date()

  for (const worksheet of workbook.worksheets) {
    const sheetName = worksheet.name
    if (skipSheets.includes(sheetName)) continue

    const rows = []
    worksheet.eachRow((row) => {
      const vals = []
      row.eachCell({ includeEmpty: true }, (cell) => vals.push(cell.text || cell.value || null))
      rows.push(vals)
    })

    if (rows.length < 2) continue

    const isFrameSheet = sheetName === 'frames'
    const sheetStats = { name: sheetName, inserted: 0, updated: 0, skippedRows: 0 }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const partName = cleanStr(row[0])
      if (!partName || isAnnotationRow(partName)) { sheetStats.skippedRows++; stats.skippedRows++; continue }

      const partColor = isFrameSheet ? null : (cleanStr(row[1]) || '--')
      const costUnit = normalizeCode(isFrameSheet ? row[1] : row[2])
      const mbsCost = toNum(isFrameSheet ? row[2] : row[3])
      const currentMarketCost = toNum(isFrameSheet ? row[3] : row[4])

      if (!['FT', 'LB', 'EA'].includes(costUnit) || mbsCost == null) {
        sheetStats.skippedRows++; stats.skippedRows++; continue
      }

      const doc = {
        costVersionId: version._id,
        category: sheetName,
        partName,
        partNameNormalized: normalizeCode(partName),
        partColor,
        partColorNormalized: isFrameSheet ? null : normalizeCode(partColor),
        costUnit,
        mbsCost,
        currentMarketCost,
        isFrameType: isFrameSheet,
        isActive: true,
        rawRow: row,
        rowNumber: i + 1,
        lastImportedAt: now,
      }

      const existing = await SMDTItem.findOneAndUpdate(
        { costVersionId: version._id, category: sheetName, partNameNormalized: doc.partNameNormalized, partColorNormalized: doc.partColorNormalized },
        { $set: doc },
        { upsert: true, new: false }
      )

      if (existing) { sheetStats.updated++; stats.updated++ } else { sheetStats.inserted++; stats.inserted++ }
      stats.totalItems++
    }
    stats.sheets.push(sheetStats)
  }

  version.stats = stats
  await version.save()

  if (options.activate === true) {
    await SMDTCostVersion.updateMany({ _id: { $ne: version._id } }, { $set: { isActive: false } })
    version.isActive = true
    await version.save()
  }

  return { version, stats }
}

module.exports = { importSMDTFromUrl, cleanStr, normalizeCode }
```

---

### 3.2 REPLACE: `src/services/plant/bom.service.js`

Do not let Claude calculate pricing. The correct backend flow is:

1. Parse Excel/ODS rows deterministically.
2. Normalize part, color, length, qty, and weight.
3. Match against active SMDT cost version.
4. Calculate with code using `EA`, `FT`, or `LB` formula.
5. Use Claude only as fallback when the file layout is too messy to parse normally.

```js
const Anthropic = require('@anthropic-ai/sdk')
const https = require('https')
const http = require('http')
const ExcelJS = require('exceljs')
const env = require('../../config/env')
const SMDTCostVersion = require('../../models/SMDTCostVersion')
const SMDTItem = require('../../models/SMDTItem')
const SMDTColorAlias = require('../../models/SMDTColorAlias')
const SMDTPartAlias = require('../../models/SMDTPartAlias')
const BOMItem = require('../../models/BOMItem')
const BOMJob = require('../../models/BOMJob')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const cleanStr = (val) => val == null ? null : String(val).replace(/^'+/, '').replace(/'+$/, '').trim() || null
const normalizeCode = (val) => cleanStr(val)?.toUpperCase().replace(/\s+/g, '') || null
const toNum = (val, fallback = null) => {
  if (val == null || val === '') return fallback
  const n = Number(String(val).replace(/[$,]/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

const parseLengthToFeet = (value) => {
  if (!value) return null
  const str = String(value).replace(/[“”]/g, '"').replace(/[’]/g, "'").trim()
  let feet = 0, inches = 0
  const feetMatch = str.match(/(\d+(?:\.\d+)?)\s*'/)
  if (feetMatch) feet = Number(feetMatch[1])
  const afterFeet = str.includes("'") ? str.split("'").slice(1).join("'") : str
  const mixed = afterFeet.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/)
  if (mixed) inches += Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  else {
    const whole = afterFeet.match(/(\d+(?:\.\d+)?)(?=\s*"|\s|$)/)
    const frac = afterFeet.match(/(\d+)\s*\/\s*(\d+)/)
    if (whole && !afterFeet.includes('/')) inches += Number(whole[1])
    if (frac) inches += Number(frac[1]) / Number(frac[2])
  }
  if (!feetMatch && str.includes('"')) return inches / 12
  return feet + inches / 12
}

const calculateTotalCost = ({ costUnit, unitCost, quantity, lengthFeet, weight }) => {
  if (unitCost == null) return null
  if (costUnit === 'EA') return Number(quantity || 0) * unitCost
  if (costUnit === 'FT') return lengthFeet == null ? null : Number(quantity || 0) * Number(lengthFeet) * unitCost
  if (costUnit === 'LB') return Number(weight || 0) * unitCost
  return null
}

const downloadBuffer = (url) => new Promise((resolve, reject) => {
  const lib = url.startsWith('https') ? https : http
  lib.get(url, (res) => {
    const chunks = []
    res.on('data', c => chunks.push(c))
    res.on('end', () => resolve(Buffer.concat(chunks)))
    res.on('error', reject)
  }).on('error', reject)
})

const findHeaderRow = (rows) => {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i].map(normalizeCode)
    if (r.includes('QTY') && (r.includes('PART') || r.includes('DESCRIPTION') || r.includes('MBIP/N'))) return i
  }
  return -1
}

const col = (headers, aliases) => headers.findIndex(h => aliases.includes(h))

const extractBOMItemsFromWorkbook = async (buffer, fileName) => {
  const workbook = new ExcelJS.Workbook()
  const ext = fileName.split('.').pop().toLowerCase()
  if (ext === 'ods') await workbook.ods.load(buffer)
  else await workbook.xlsx.load(buffer)

  const items = []
  let skippedRows = 0

  workbook.eachSheet((ws) => {
    if (['COVER_SHEET', 'Sheet1', 'Sheet2', 'Sheet3'].includes(ws.name)) return
    const rows = []
    ws.eachRow((row) => {
      const vals = []
      row.eachCell({ includeEmpty: true }, c => vals.push(c.text || c.value || null))
      rows.push(vals)
    })

    const headerIdx = findHeaderRow(rows)
    if (headerIdx < 0) return
    const h = rows[headerIdx].map(normalizeCode)
    const iQty = col(h, ['QTY', 'QUANTITY'])
    const iMark = col(h, ['MARK', 'MARKID', 'PIECEMARK'])
    const iDesc = col(h, ['DESCRIPTION', 'DESC'])
    const iPart = col(h, ['PART', 'PARTCODE', 'MBIP/N', 'ITEM'])
    const iColor = col(h, ['COLOR', 'COLOUR', 'FINISH'])
    const iLength = col(h, ['LENGTH', 'LEN'])
    const iWeight = col(h, ['WEIGHT', 'WT'])
    const iGauge = col(h, ['THICK', 'GAUGE'])
    const iAngle = col(h, ['ANGLE'])
    const iType = col(h, ['TYPE'])

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r]
      const joined = row.map(v => cleanStr(v) || '').join(' ').toLowerCase()
      if (!joined.trim() || joined.includes('total weight') || joined.startsWith('total')) { skippedRows++; continue }

      const quantity = toNum(row[iQty])
      if (!quantity || quantity <= 0) { skippedRows++; continue }

      const partCode = iPart >= 0 ? cleanStr(row[iPart]) : null
      const partColor = iColor >= 0 ? cleanStr(row[iColor]) : null
      const lengthRaw = iLength >= 0 ? cleanStr(row[iLength]) : null

      items.push({
        sourceSheetName: ws.name,
        category: ws.name,
        rowNumber: r + 1,
        quantity,
        markId: iMark >= 0 ? cleanStr(row[iMark]) || '' : '',
        description: iDesc >= 0 ? cleanStr(row[iDesc]) || '' : '',
        partCode,
        partCodeNormalized: normalizeCode(partCode),
        partColor,
        partColorNormalized: normalizeCode(partColor),
        lengthRaw,
        lengthFeet: parseLengthToFeet(lengthRaw),
        weight: iWeight >= 0 ? toNum(row[iWeight]) : null,
        gauge: iGauge >= 0 ? cleanStr(row[iGauge]) : null,
        angle: iAngle >= 0 ? cleanStr(row[iAngle]) : null,
        type: iType >= 0 ? cleanStr(row[iType]) : null,
        isFrameType: /frame|column|rafter|opening framing/i.test(ws.name),
        isBuyout: !partCode || ['BUYOUT', '-', 'N/A'].includes(normalizeCode(partCode)),
        rawRow: row,
      })
    }
  })

  return { items, skippedRows }
}

const resolveColor = async (color) => {
  if (!color) return null
  const alias = await SMDTColorAlias.findOne({ inputColorNormalized: color, isActive: true }).lean()
  return alias ? alias.smdtColorNormalized : color
}

const resolvePart = async (item) => {
  if (!item.partCodeNormalized) return null
  const alias = await SMDTPartAlias.findOne({
    inputPartNormalized: item.partCodeNormalized,
    isActive: true,
    $or: [{ category: item.category }, { category: null }],
  }).lean()
  return alias ? alias.smdtPartNameNormalized : item.partCodeNormalized
}

const matchSingleBOMItemToSMDT = async (item, costVersionId) => {
  if (item.isFrameType || item.isBuyout || !item.partCodeNormalized) {
    return { matchStatus: 'unmatched', matchConfidence: 'none', matchReason: 'Manual pricing required' }
  }

  const part = await resolvePart(item)
  const color = await resolveColor(item.partColorNormalized)
  const base = { costVersionId, partNameNormalized: part, isActive: true }

  let match = color ? await SMDTItem.findOne({ ...base, partColorNormalized: color }).lean() : null
  let matchConfidence = match ? (part === item.partCodeNormalized ? 'exact' : 'part_alias') : 'none'
  let matchReason = match ? 'Matched by part and color' : ''

  if (!match) {
    match = await SMDTItem.findOne({ ...base, partColorNormalized: '--' }).lean()
    if (match) { matchConfidence = 'color_fallback'; matchReason = 'Matched by part and -- color fallback' }
  }

  if (!match) {
    const candidates = await SMDTItem.find(base).limit(5).lean()
    if (candidates.length === 1) { match = candidates[0]; matchConfidence = 'part_only'; matchReason = 'Matched by part only' }
    else if (candidates.length > 1) return { matchStatus: 'ambiguous', matchConfidence: 'none', matchReason: 'Multiple SMDT candidates found', matchCandidates: candidates }
  }

  if (!match) return { matchStatus: 'unmatched', matchConfidence: 'none', matchReason: 'No SMDT match found' }

  const unitCost = match.currentMarketCost != null ? match.currentMarketCost : match.mbsCost
  const total = calculateTotalCost({ costUnit: match.costUnit, unitCost, quantity: item.quantity, lengthFeet: item.lengthFeet, weight: item.weight })

  return {
    matchStatus: total == null ? 'unmatched' : 'matched',
    matchConfidence,
    matchReason: total == null ? `Matched but missing value required for ${match.costUnit}` : matchReason,
    smdtItemId: match._id,
    resolvedSmdtColor: match.partColor,
    costUnit: match.costUnit,
    smdtUnitCost: unitCost,
    smdtTotalCost: total,
  }
}

const processBOMJob = async (jobId, fileUrl, fileName, leadId, buildingId, buildingNumber, uploadedBy) => {
  await BOMJob.findByIdAndUpdate(jobId, { status: 'processing', processingStartedAt: new Date() })

  try {
    const buffer = await downloadBuffer(fileUrl)
    const activeVersion = await SMDTCostVersion.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()
    if (!activeVersion) throw new Error('No active SMDT cost version found')

    const { items: rawItems, skippedRows } = await extractBOMItemsFromWorkbook(buffer, fileName)
    const docs = []

    for (const item of rawItems) {
      const match = await matchSingleBOMItemToSMDT(item, activeVersion._id)
      const isPriced = match.matchStatus === 'matched' && match.smdtTotalCost != null
      docs.push({
        leadId, buildingId, bomJobId: jobId, smdtCostVersionId: activeVersion._id,
        ...item,
        ...match,
        isPriced,
        finalUnitCost: isPriced ? match.smdtUnitCost : null,
        finalTotalCost: isPriced ? match.smdtTotalCost : null,
      })
    }

    await BOMItem.deleteMany({ bomJobId: jobId })
    if (docs.length) await BOMItem.insertMany(docs, { ordered: false })

    const totalItems = docs.length
    const frameItems = docs.filter(i => i.isFrameType).length
    const matchedItems = docs.filter(i => i.matchStatus === 'matched').length
    const unmatchedItems = docs.filter(i => i.matchStatus === 'unmatched').length
    const totalSheets = new Set(docs.map(i => i.sourceSheetName)).size

    await BOMJob.findByIdAndUpdate(jobId, {
      status: 'completed', totalSheets, totalItems, matchedItems, unmatchedItems, frameItems, skippedRows,
      processingEndedAt: new Date(),
    })

    if (global.io) {
      global.io.of('/admin').to(`user:${uploadedBy}`).emit('bom_extraction_complete', {
        jobId, buildingNumber, totalItems, matchedItems, unmatchedItems, frameItems,
      })
    }
  } catch (err) {
    await BOMJob.findByIdAndUpdate(jobId, { status: 'failed', errorMessage: err.message, processingEndedAt: new Date() })
    if (global.io) global.io.of('/admin').to(`user:${uploadedBy}`).emit('bom_extraction_failed', { jobId, buildingNumber, error: err.message })
  }
}

module.exports = { processBOMJob, extractBOMItemsFromWorkbook, matchSingleBOMItemToSMDT, parseLengthToFeet, calculateTotalCost }
```

---

### 3.3 NEW: `src/services/plant/consolidator.service.js`

Generates the shipper Excel file sent to vendors. Contains ALL extracted BOM items so vendors can respond to every line.

```js
const ExcelJS  = require('exceljs')
const BOMItem  = require('../../models/BOMItem')

/**
 * Generates consolidated BOM Excel with 3 sheets:
 *  - Summary: project metadata
 *  - BOM Items: every extracted item grouped by category
 *  - Vendor Quote: pre-populated part list for vendor to fill in pricing
 *
 * ALL items are included regardless of pricing status so vendors
 * can respond to every line item without gaps.
 */
const generateConsolidatedExcel = async (lead, buildingsWithJobs) => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StoragePro'

  // ── Sheet 1: Summary ───────────────────────────────────────────────────────
  const summary = workbook.addWorksheet('Summary')
  const summaryRows = [
    ['Project Name', lead.projectName],
    ['Job ID',       lead.jobId],
    ['Location',     lead.location || ''],
    ['Buildings',    buildingsWithJobs.length],
    ['Generated',    new Date().toLocaleDateString()],
  ]
  summaryRows.forEach(r => summary.addRow(r))
  summary.getColumn(1).width = 18
  summary.getColumn(2).width = 30

  // ── Collect all BOM items ──────────────────────────────────────────────────
  const buildingIds = buildingsWithJobs.map(b => b._id)
  const allItems    = await BOMItem.find({
    buildingId: { $in: buildingIds },
    isPriced:   true,
  }).sort({ category: 1, markId: 1 }).lean()

  const buildingMap = {}
  buildingsWithJobs.forEach(b => { buildingMap[String(b._id)] = b.buildingNumber })

  // ── Sheet 2: BOM Items ─────────────────────────────────────────────────────
  const itemSheet = workbook.addWorksheet('BOM Items')
  const itemHeaders = [
    'Building #', 'Category', 'Mark ID', 'Description',
    'Part Code', 'Color', 'Qty', 'Length (ft)', 'Weight (lbs)',
    'Cost Unit', 'Unit Cost', 'Total Cost', 'Notes',
  ]
  const itemHeaderRow = itemSheet.addRow(itemHeaders)
  itemHeaderRow.font = { bold: true }
  itemHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }

  let grandTotal = 0
  allItems.forEach(item => {
    itemSheet.addRow([
      buildingMap[String(item.buildingId)] || '',
      item.category,
      item.markId,
      item.description,
      item.partCode    || '',
      item.partColor   || '',
      item.quantity    || '',
      item.lengthFeet  || '',
      item.weight      || '',
      item.costUnit    || '',
      item.finalUnitCost  != null ? item.finalUnitCost.toFixed(4)  : '',
      item.finalTotalCost != null ? item.finalTotalCost.toFixed(2) : '',
      item.isManuallyPriced ? 'Manual price' : '',
    ])
    grandTotal += item.finalTotalCost || 0
  })

  // Total row
  itemSheet.addRow([])
  const totalRow = itemSheet.addRow(['', '', '', '', '', '', '', '', '', '', 'TOTAL', grandTotal.toFixed(2)])
  totalRow.font = { bold: true }

  itemSheet.columns.forEach(col => { col.width = Math.max(col.width || 8, 14) })

  // ── Sheet 3: Vendor Quote ─────────────────────────────────────────────────
  const vendorSheet = workbook.addWorksheet('Vendor Quote')
  const vendorHeaders = [
    'Part Code', 'Color', 'Description', 'Our Qty (EA)',
    'Our Length (ft)', 'Our Weight (lbs)', 'Cost Unit',
    'Vendor Unit Price', 'Vendor Total', 'Notes',
  ]
  const vendorHeaderRow = vendorSheet.addRow(vendorHeaders)
  vendorHeaderRow.font = { bold: true }
  vendorHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCE5FF' } }

  allItems.forEach(item => {
    vendorSheet.addRow([
      item.partCode   || '',
      item.partColor  || '',
      item.description,
      item.quantity   || '',
      item.lengthFeet || '',
      item.weight     || '',
      item.costUnit   || '',
      '',  // vendor fills this
      '',  // vendor fills this
      '',
    ])
  })
  vendorSheet.columns.forEach(col => { col.width = Math.max(col.width || 8, 16) })

  const buffer = await workbook.xlsx.writeBuffer()
  return { buffer, totalCost: grandTotal, itemCount: allItems.length }
}

// Group items by (partCode + partColor) for consolidated view
const groupItemsForConsolidation = (items, buildingMap) => {
  const map = new Map()

  items.forEach(item => {
    const key = `${item.partCode || '_'}|${item.partColor || '_'}`
    if (!map.has(key)) {
      map.set(key, {
        partCode:        item.partCode,
        partColor:       item.partColor,
        description:     item.description,
        category:        item.category,
        costUnit:        item.costUnit,
        totalQty:        0,
        totalLengthFeet: 0,
        totalWeight:     0,
        totalCost:       0,
        buildings:       new Set(),
        markIds:         [],
      })
    }
    const g = map.get(key)
    g.totalQty        += item.quantity        || 0
    g.totalLengthFeet += item.lengthFeet       || 0
    g.totalWeight     += item.weight           || 0
    g.totalCost       += item.finalTotalCost   || 0
    g.buildings.add(buildingMap[String(item.buildingId)] || 0)
    g.markIds.push(item.markId)
  })

  return Array.from(map.values()).map(g => ({
    ...g,
    buildings: [...g.buildings].sort(),
  }))
}

module.exports = { generateConsolidatedExcel, groupItemsForConsolidation }
```

---


### 3.4 NEW: `src/services/plant/shipperComparison.service.js`

Compares the stored `ConsolidatedBOM.items` against the vendor-uploaded PDF/Excel quote. Claude is used only for messy PDF extraction. The final comparison must be deterministic backend logic.

```js
const ShipperRequest        = require('../../models/ShipperRequest')
const ConsolidatedBOM       = require('../../models/ConsolidatedBOM')
const VendorQuoteLine       = require('../../models/VendorQuoteLine')
const QuoteComparisonResult = require('../../models/QuoteComparisonResult')

/**
 * Main function called by POST /api/plant/shipper-requests/:requestId/compare
 */
const compareShipperRequest = async (requestId, performedBy) => {
  const request = await ShipperRequest.findById(requestId)
  if (!request) throw new Error('Shipper request not found')
  if (!request.submittedFileUrl) throw new Error('Vendor has not submitted a file yet')

  await ShipperRequest.findByIdAndUpdate(requestId, {
    status: 'comparison_processing',
    comparisonStatus: 'processing',
    comparisonError: null,
  })

  try {
    const consolidatedBOM = await ConsolidatedBOM.findById(request.consolidatedBOMId).lean()
    if (!consolidatedBOM) throw new Error('Consolidated BOM not found')

    // 1. Extract vendor quote lines from PDF/Excel
    const vendorLines = await extractVendorQuoteLines({
      fileUrl: request.submittedFileUrl,
      fileName: request.submittedFileName,
      request,
    })

    // 2. Clear old comparison data for this request before rerun
    await VendorQuoteLine.deleteMany({ shipperRequestId: request._id })
    await QuoteComparisonResult.deleteMany({ shipperRequestId: request._id })

    const vendorDocs = await VendorQuoteLine.insertMany(vendorLines, { ordered: false })

    // 3. Normalize expected and received rows
    const expectedItems = normalizeExpectedBomItems(consolidatedBOM.items || [])
    const receivedItems = normalizeVendorQuoteLines(vendorDocs)

    // 4. Deterministic comparison
    const { results, summary, exceptions } = compareExpectedVsVendor(expectedItems, receivedItems, request)

    await QuoteComparisonResult.insertMany(results, { ordered: false })

    // 5. Store summary and auto-generated exceptions on ShipperRequest for review/resubmit flow
    await ShipperRequest.findByIdAndUpdate(requestId, {
      status: 'comparison_completed',
      comparisonStatus: 'completed',
      comparisonSummary: summary,
      comparisonRanAt: new Date(),
      comparisonError: null,
      exceptions,
    })

    return { summary, exceptions }
  } catch (err) {
    await ShipperRequest.findByIdAndUpdate(requestId, {
      status: 'comparison_failed',
      comparisonStatus: 'failed',
      comparisonError: err.message,
    })
    throw err
  }
}

const extractVendorQuoteLines = async ({ fileUrl, fileName, request }) => {
  const ext = (fileName || '').split('.').pop().toLowerCase()

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return extractExcelQuoteLines(fileUrl, request)
  }

  if (ext === 'pdf') {
    return extractPdfQuoteLinesWithClaude(fileUrl, request)
  }

  throw new Error('Unsupported vendor quote file type')
}

const normalizeExpectedBomItems = (items) => {
  return items.map(item => ({
    consolidatedItemId: item._id,
    partCode: item.partCode || null,
    partCodeNormalized: normalizeKey(item.partCode),
    partColor: item.partColor || null,
    partColorNormalized: normalizeKey(item.partColor),
    description: item.description || '',
    qty: Number(item.totalQty || 0),
    lengthFeet: Number(item.totalLengthFeet || 0),
    weight: Number(item.totalWeight || 0),
    costUnit: item.costUnit || null,
    unitCost: item.unitCost || null,
    totalCost: item.totalCost || 0,
    markIds: item.markIds || [],
  }))
}

const normalizeVendorQuoteLines = (lines) => {
  return lines.map(line => ({
    vendorQuoteLineId: line._id,
    partCode: line.partCode || null,
    partCodeNormalized: normalizeKey(line.partCode),
    partColor: line.color || null,
    partColorNormalized: normalizeKey(line.color),
    description: line.description || '',
    qty: Number(line.qty || 0),
    lengthFeet: Number(line.lengthFeet || 0),
    weight: Number(line.weight || 0),
    priceUnit: line.priceUnit || 'UNKNOWN',
    unitPrice: line.unitPrice || null,
    amount: line.amount || null,
    pieceMark: line.pieceMark || '',
  }))
}

const compareExpectedVsVendor = (expectedItems, receivedItems, request) => {
  const results = []
  const exceptions = []
  const usedVendorIds = new Set()

  for (const expected of expectedItems) {
    const match = findBestVendorMatch(expected, receivedItems, usedVendorIds)

    if (!match) {
      results.push(buildResult('missing_in_vendor_quote', 'critical', expected, null, request, 'Expected item was not found in vendor quote'))
      exceptions.push(buildException('missing', 'critical', expected, null, 'Expected item was not found in vendor quote'))
      continue
    }

    usedVendorIds.add(String(match.vendorQuoteLineId))

    const mismatches = detectMismatches(expected, match)
    if (!mismatches.length) {
      results.push(buildResult('matched', 'low', expected, match, request, 'Matched successfully'))
      continue
    }

    for (const mm of mismatches) {
      results.push(buildResult(mm.status, mm.severity, expected, match, request, mm.reason))
      exceptions.push(buildException(mm.issueType, mm.severity, expected, match, mm.reason))
    }
  }

  // Vendor extra lines
  for (const received of receivedItems) {
    if (!usedVendorIds.has(String(received.vendorQuoteLineId))) {
      results.push(buildResult('extra_in_vendor_quote', 'medium', null, received, request, 'Vendor quoted an extra item not present in Consolidated BOM'))
      exceptions.push(buildException('extra', 'medium', null, received, 'Vendor quoted an extra item not present in Consolidated BOM'))
    }
  }

  const summary = buildSummary(expectedItems, receivedItems, results)
  return { results, summary, exceptions }
}

// Match priority: exact part+color+length → part+length → part only → mark/description suggestions later
const findBestVendorMatch = (expected, receivedItems, usedVendorIds) => {
  const candidates = receivedItems.filter(r => !usedVendorIds.has(String(r.vendorQuoteLineId)))

  return candidates.find(r =>
    r.partCodeNormalized === expected.partCodeNormalized &&
    r.partColorNormalized === expected.partColorNormalized &&
    close(r.lengthFeet, expected.lengthFeet)
  ) || candidates.find(r =>
    r.partCodeNormalized === expected.partCodeNormalized &&
    close(r.lengthFeet, expected.lengthFeet)
  ) || candidates.find(r =>
    r.partCodeNormalized === expected.partCodeNormalized
  ) || null
}

const detectMismatches = (expected, received) => {
  const issues = []

  if (Math.abs((expected.qty || 0) - (received.qty || 0)) > 0) {
    issues.push({ status: 'qty_mismatch', issueType: 'qty_mismatch', severity: 'critical', reason: 'Vendor quantity does not match expected quantity' })
  }

  if (!close(expected.lengthFeet, received.lengthFeet, 0.02)) {
    issues.push({ status: 'length_mismatch', issueType: 'length_mismatch', severity: 'high', reason: 'Vendor length does not match expected length' })
  }

  if (expected.weight && received.weight && Math.abs(expected.weight - received.weight) > 2) {
    issues.push({ status: 'weight_mismatch', issueType: 'weight_mismatch', severity: 'medium', reason: 'Vendor weight does not match expected weight' })
  }

  if (expected.unitCost != null && received.unitPrice != null && Math.abs(expected.unitCost - received.unitPrice) > 0.01) {
    issues.push({ status: 'price_mismatch', issueType: 'price_mismatch', severity: 'medium', reason: 'Vendor unit price differs from expected unit price' })
  }

  return issues
}

const buildSummary = (expectedItems, receivedItems, results) => ({
  expectedLines:    expectedItems.length,
  vendorLines:      receivedItems.length,
  matchedLines:     results.filter(r => r.status === 'matched').length,
  missingItems:     results.filter(r => r.status === 'missing_in_vendor_quote').length,
  extraItems:       results.filter(r => r.status === 'extra_in_vendor_quote').length,
  qtyMismatches:    results.filter(r => r.status === 'qty_mismatch').length,
  lengthMismatches: results.filter(r => r.status === 'length_mismatch').length,
  weightMismatches: results.filter(r => r.status === 'weight_mismatch').length,
  priceMismatches:  results.filter(r => r.status === 'price_mismatch').length,
  ambiguousMatches: results.filter(r => r.status === 'ambiguous_match').length,
})

const buildResult = (status, severity, expected, received, request, reason) => ({
  shipperRequestId: request._id,
  leadId: request.leadId,
  consolidatedBOMId: request.consolidatedBOMId,
  vendorId: request.vendorId,
  consolidatedItemId: expected?.consolidatedItemId || null,
  vendorQuoteLineId: received?.vendorQuoteLineId || null,
  status,
  severity,
  expected: expected || {},
  received: received || {},
  difference: {
    qtyDiff: received && expected ? (received.qty || 0) - (expected.qty || 0) : null,
    lengthDiff: received && expected ? (received.lengthFeet || 0) - (expected.lengthFeet || 0) : null,
    weightDiff: received && expected ? (received.weight || 0) - (expected.weight || 0) : null,
    unitPriceDiff: received && expected && received.unitPrice != null && expected.unitCost != null ? received.unitPrice - expected.unitCost : null,
    amountDiff: received && expected && received.amount != null && expected.totalCost != null ? received.amount - expected.totalCost : null,
  },
  matchMethod: received ? 'part_length_grouped' : 'none',
  matchConfidence: received ? 0.9 : 0,
  reason,
})

const buildException = (issueType, severity, expected, received, reason) => ({
  partCode: expected?.partCode || received?.partCode || '',
  description: expected?.description || received?.description || '',
  expected: expected || null,
  received: received || null,
  issueType,
  severity,
  reason,
  source: 'auto_compare',
})

const normalizeKey = (v) => (v == null ? '' : String(v).trim().toUpperCase().replace(/\s+/g, ''))
const close = (a, b, tolerance = 0.02) => Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance

// Implement these with ExcelJS + Claude PDF extraction following existing Claude service pattern
const extractExcelQuoteLines = async () => { throw new Error('extractExcelQuoteLines not implemented') }
const extractPdfQuoteLinesWithClaude = async () => { throw new Error('extractPdfQuoteLinesWithClaude not implemented') }

module.exports = { compareShipperRequest }
```

---



### 3.5 NEW: `src/services/plant/loadPlanning.service.js`

This service generates the Bundle Plan and the Packing List / Truck Load Plan. It must be deterministic backend logic. Do not use Claude for truck planning or stacking decisions.

```js
const TRUCK_TYPES = {
  SEMI_53: { truckType: 'SEMI_53', label: '53 ft Semi', maxWeight: 45000, hardMaxWeight: 48000, maxLengthFeet: 53 },
  HOTSHOT_40: { truckType: 'HOTSHOT_40', label: '40 ft Hot Shot', maxWeight: 18000, hardMaxWeight: 18000, maxLengthFeet: 40 },
}

const BUNDLE_LIMITS = {
  maxBundleWeight: 6000,
  preferredBundleWeight: 3500,
  maxBundleLengthFeet: 53,
}

const normalizeText = (value) => String(value || '').trim().toUpperCase()

const classifyBundleType = (line) => {
  const text = normalizeText(`${line.category || ''} ${line.partCode || ''} ${line.description || ''}`)
  if (text.includes('PANEL') || text.includes('SHEETING') || text.includes('R-LOC') || text.includes('PBR')) return 'panels'
  if (text.includes('TRIM') || text.includes('FLASH') || text.includes('GUTTER') || text.includes('DOWNSPOUT')) return 'trim'
  if (text.includes('SCREW') || text.includes('BOLT') || text.includes('FASTENER') || text.includes('ANCHOR')) return 'fasteners'
  if (text.includes('CEE') || text.includes('ZEE') || text.includes('PURLIN') || text.includes('GIRT') || text.includes('JAMB') || text.includes('HEADER')) return 'framing'
  if (text.includes('INSULATION') || text.includes('SKYLIGHT') || text.includes('ACCESSORY')) return 'accessories'
  return 'mixed'
}

const getLengthBucket = (lengthFeet) => {
  const len = Number(lengthFeet || 0)
  if (!len) return 'NO_LENGTH'
  if (len <= 4) return '0_4'
  if (len <= 8) return '4_8'
  if (len <= 12) return '8_12'
  if (len <= 20) return '12_20'
  if (len <= 30) return '20_30'
  if (len <= 40) return '30_40'
  if (len <= 53) return '40_53'
  return 'OVERSIZE'
}

const getDefaultStackingRules = (bundleType) => {
  switch (bundleType) {
    case 'framing':
      return { stackLevel: 'bottom', canStackOnTop: true, canHaveItemsStackedOnIt: true, isFragile: false, mustStayFlat: false, keepDry: false, requiresEdgeProtection: false, loadingPriority: 10, unloadingPriority: 50, stackingNotes: 'Heavy structural bundle. Load low/bottom.' }
    case 'panels':
      return { stackLevel: 'middle', canStackOnTop: false, canHaveItemsStackedOnIt: false, isFragile: true, mustStayFlat: true, keepDry: true, requiresEdgeProtection: true, loadingPriority: 30, unloadingPriority: 40, stackingNotes: 'Panels must stay flat/protected.' }
    case 'trim':
      return { stackLevel: 'top', canStackOnTop: false, canHaveItemsStackedOnIt: false, isFragile: true, mustStayFlat: true, keepDry: true, requiresEdgeProtection: true, loadingPriority: 70, unloadingPriority: 20, stackingNotes: 'Trim should not be crushed.' }
    case 'fasteners':
      return { stackLevel: 'top', canStackOnTop: true, canHaveItemsStackedOnIt: false, isFragile: false, mustStayFlat: false, keepDry: true, requiresEdgeProtection: false, loadingPriority: 80, unloadingPriority: 10, stackingNotes: 'Small boxed items.' }
    case 'accessories':
      return { stackLevel: 'top', canStackOnTop: false, canHaveItemsStackedOnIt: false, isFragile: true, mustStayFlat: false, keepDry: true, requiresEdgeProtection: false, loadingPriority: 75, unloadingPriority: 15, stackingNotes: 'Accessory bundle. Verify manually.' }
    default:
      return { stackLevel: 'any', canStackOnTop: true, canHaveItemsStackedOnIt: true, isFragile: false, mustStayFlat: false, keepDry: false, requiresEdgeProtection: false, loadingPriority: 50, unloadingPriority: 50, stackingNotes: '' }
  }
}

const buildBundleKey = (line) => {
  const type = classifyBundleType(line)
  const color = normalizeText(line.colorNormalized || line.color || 'NO_COLOR')
  if (['fasteners', 'accessories'].includes(type)) return `${type}|${color}`
  return `${type}|${color}|${getLengthBucket(line.lengthFeet)}`
}

const toBundleItem = (line) => ({
  vendorQuoteLineId: line._id,
  partCode: line.partCode || '',
  description: line.description || '',
  category: line.category || '',
  color: line.color || '',
  qty: Number(line.qty || 0),
  lengthFeet: line.lengthFeet || null,
  widthFeet: line.widthFeet || null,
  heightFeet: line.heightFeet || null,
  weight: Number(line.weight || 0),
  markIds: line.pieceMark ? [line.pieceMark] : [],
  sourceLineSnapshot: line,
})

const getBundleWarnings = (bundle) => {
  const warnings = []
  if (bundle.maxLengthFeet > 53) warnings.push('Bundle length exceeds 53 ft truck limit')
  if (bundle.totalWeight > BUNDLE_LIMITS.maxBundleWeight) warnings.push('Bundle exceeds recommended 6,000 lbs weight')
  if (bundle.stacking.keepDry) warnings.push('Keep dry')
  if (bundle.stacking.requiresEdgeProtection) warnings.push('Edge protection required')
  if (bundle.stacking.mustStayFlat) warnings.push('Must stay flat')
  if (bundle.stacking.canHaveItemsStackedOnIt === false) warnings.push('Do not stack other bundles on this bundle')
  return warnings
}

const createEmptyBundle = (counter, bundleType) => ({
  bundleNo: `B-${String(counter).padStart(3, '0')}`,
  bundleType,
  title: `${bundleType.toUpperCase()} Bundle`,
  items: [],
  totalQty: 0,
  totalWeight: 0,
  maxLengthFeet: 0,
  estimatedWidthFeet: 0,
  estimatedHeightFeet: 0,
  stacking: getDefaultStackingRules(bundleType),
  loadSequence: null,
  handlingInstruction: '',
  warnings: [],
  status: 'draft',
})

const finalizeBundle = (bundle) => ({ ...bundle, warnings: getBundleWarnings(bundle) })

const generateBundlesFromVendorLines = (vendorLines) => {
  const groups = new Map()
  for (const line of vendorLines) {
    const key = buildBundleKey(line)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(line)
  }

  const bundles = []
  let counter = 1

  for (const [key, lines] of groups.entries()) {
    const bundleType = key.split('|')[0]
    const sorted = [...lines].sort((a, b) => (b.lengthFeet || 0) - (a.lengthFeet || 0) || (b.weight || 0) - (a.weight || 0))
    let bundle = createEmptyBundle(counter++, bundleType)

    for (const line of sorted) {
      const lineWeight = Number(line.weight || 0)
      const lineLength = Number(line.lengthFeet || 0)
      const exceedsWeight = bundle.items.length > 0 && bundle.totalWeight + lineWeight > BUNDLE_LIMITS.maxBundleWeight
      const exceedsLength = Math.max(bundle.maxLengthFeet, lineLength) > BUNDLE_LIMITS.maxBundleLengthFeet

      if (exceedsWeight || exceedsLength) {
        bundles.push(finalizeBundle(bundle))
        bundle = createEmptyBundle(counter++, bundleType)
      }

      bundle.items.push(toBundleItem(line))
      bundle.totalQty += Number(line.qty || 0)
      bundle.totalWeight += lineWeight
      bundle.maxLengthFeet = Math.max(bundle.maxLengthFeet, lineLength)
      bundle.estimatedWidthFeet = Math.max(bundle.estimatedWidthFeet || 0, line.widthFeet || 0)
      bundle.estimatedHeightFeet = Math.max(bundle.estimatedHeightFeet || 0, line.heightFeet || 0)
    }

    if (bundle.items.length > 0) bundles.push(finalizeBundle(bundle))
  }

  return bundles
}

const selectTruckTypeForBundle = (bundle) => {
  const weight = Number(bundle.totalWeight || 0)
  const length = Number(bundle.maxLengthFeet || 0)
  if (length <= 40 && weight <= 18000) return TRUCK_TYPES.HOTSHOT_40
  if (length <= 53 && weight <= 45000) return TRUCK_TYPES.SEMI_53
  return null
}

const canFitBundleInPackingList = (packingList, bundle) => {
  const newWeight = packingList.totalWeight + Number(bundle.totalWeight || 0)
  const newLength = Math.max(packingList.maxLengthFeet || 0, bundle.maxLengthFeet || 0)
  return newWeight <= packingList.maxTruckWeight && newLength <= packingList.maxTruckLengthFeet
}

const createEmptyPackingList = (counter, truckConfig) => ({
  packingListNo: `PL-${String(counter).padStart(3, '0')}`,
  truckNo: `TRUCK-${counter}`,
  truckType: truckConfig.truckType,
  truckLabel: truckConfig.label,
  maxTruckWeight: truckConfig.maxWeight,
  hardMaxTruckWeight: truckConfig.hardMaxWeight,
  maxTruckLengthFeet: truckConfig.maxLengthFeet,
  bundleIds: [],
  bundles: [],
  totalBundles: 0,
  totalItems: 0,
  totalWeight: 0,
  maxLengthFeet: 0,
  loadLayout: { bottomLayerBundleIds: [], middleLayerBundleIds: [], topLayerBundleIds: [], loadingNotes: '' },
  warnings: [],
  status: 'draft',
})

const addBundleToPackingList = (packingList, bundle) => {
  packingList.bundleIds.push(bundle._id)
  packingList.bundles.push(bundle)
  packingList.totalBundles += 1
  packingList.totalItems += bundle.items?.length || 0
  packingList.totalWeight += Number(bundle.totalWeight || 0)
  packingList.maxLengthFeet = Math.max(packingList.maxLengthFeet || 0, bundle.maxLengthFeet || 0)
}

const assignLoadSequence = (bundles) => [...bundles]
  .sort((a, b) => (a.stacking?.loadingPriority || 50) - (b.stacking?.loadingPriority || 50) || (b.totalWeight || 0) - (a.totalWeight || 0) || (b.maxLengthFeet || 0) - (a.maxLengthFeet || 0))
  .map((bundle, index) => ({ ...bundle, loadSequence: index + 1 }))

const assignPackingListLayers = (bundles) => {
  const layout = { bottomLayerBundleIds: [], middleLayerBundleIds: [], topLayerBundleIds: [], loadingNotes: 'Heavy framing at bottom, panels protected, trim/accessories on top.' }
  for (const bundle of assignLoadSequence(bundles)) {
    const level = bundle.stacking?.stackLevel || 'any'
    if (level === 'bottom') layout.bottomLayerBundleIds.push(bundle._id)
    else if (level === 'middle') layout.middleLayerBundleIds.push(bundle._id)
    else if (level === 'top') layout.topLayerBundleIds.push(bundle._id)
    else if ((bundle.totalWeight || 0) > 3000) layout.bottomLayerBundleIds.push(bundle._id)
    else if (bundle.stacking?.isFragile) layout.topLayerBundleIds.push(bundle._id)
    else layout.middleLayerBundleIds.push(bundle._id)
  }
  return layout
}

const getPackingListWarnings = (packingList) => {
  const warnings = []
  if (packingList.totalWeight > packingList.maxTruckWeight) warnings.push(`Truck exceeds safe weight capacity by ${packingList.totalWeight - packingList.maxTruckWeight} lbs`)
  if (packingList.hardMaxTruckWeight && packingList.totalWeight > packingList.hardMaxTruckWeight) warnings.push(`Truck exceeds hard maximum weight by ${packingList.totalWeight - packingList.hardMaxTruckWeight} lbs`)
  if (packingList.totalWeight > packingList.maxTruckWeight * 0.95) warnings.push('Truck is above 95% safe capacity')
  if (packingList.maxLengthFeet > packingList.maxTruckLengthFeet) warnings.push(`Bundle length exceeds truck length by ${packingList.maxLengthFeet - packingList.maxTruckLengthFeet} ft`)
  for (const bundle of packingList.bundles || []) warnings.push(...(bundle.warnings || []).map(w => `${bundle.bundleNo}: ${w}`))
  return [...new Set(warnings)]
}

const finalizePackingLists = (packingLists) => packingLists.map((packingList) => {
  packingList.loadLayout = assignPackingListLayers(packingList.bundles || [])
  packingList.warnings = getPackingListWarnings(packingList)
  delete packingList.bundles
  return packingList
})

const generateMixedTruckPackingLists = (bundles) => {
  const sorted = [...bundles].sort((a, b) => (b.maxLengthFeet || 0) - (a.maxLengthFeet || 0) || (b.totalWeight || 0) - (a.totalWeight || 0))
  const packingLists = []
  let counter = 1

  for (const bundle of sorted) {
    let placed = false

    // Try existing trucks first. This allows mixed efficiency: one semi can take the big load, a hot shot can take small leftover bundles.
    for (const packingList of packingLists) {
      if (canFitBundleInPackingList(packingList, bundle)) {
        addBundleToPackingList(packingList, bundle)
        placed = true
        break
      }
    }

    if (placed) continue

    const truckConfig = selectTruckTypeForBundle(bundle)
    if (!truckConfig) throw new Error(`No truck can carry bundle ${bundle.bundleNo}. Weight=${bundle.totalWeight}, Length=${bundle.maxLengthFeet}`)

    const packingList = createEmptyPackingList(counter++, truckConfig)
    addBundleToPackingList(packingList, bundle)
    packingLists.push(packingList)
  }

  return finalizePackingLists(packingLists)
}

module.exports = {
  TRUCK_TYPES,
  generateBundlesFromVendorLines,
  generateMixedTruckPackingLists,
  assignLoadSequence,
  assignPackingListLayers,
}
```

**Implementation rule:** `generateMixedTruckPackingLists()` returns generated packing lists only. The controller is responsible for creating `PackingListPlan`, inserting `PackingList` records, updating each `Bundle.packingListId`, and recalculating summary fields.


## PART 4 — API ENDPOINTS

**Auth on all `/api/plant/*`:** `verifyToken + roleGuard(['plant'])`

---

### 4.1 GET `/api/upload/presigned-url` — S3 Presigned URL

**EXISTING — no changes needed.** Used by frontend before every file upload (drawings, BOM files, SMDT files, vendor files).

**Request:**
```json
{ "fileName": "bom-b1.ods", "fileType": "application/vnd.oasis.opendocument.spreadsheet", "folder": "bom" }
```
Folder options: `"bom"`, `"drawings"`, `"smdt"`, `"vendor-files"`, `"documents"`

**Response:**
```json
{ "data": { "uploadUrl": "https://...", "fileUrl": "https://bucket.s3.../bom/uuid.ods", "key": "bom/uuid.ods" } }
```

---

### 4.2 GET `/api/plant/dashboard/stats`

**Query:** `?startDate=&endDate=`

**Logic:** POOrder.find({ assignedTo: req.user._id, status:'approved' }) → leadIds → parallel counts across Building, BOMJob, Delivery

**Response:**
```json
{
  "success": true,
  "data": {
    "totalProjects": 12,
    "inProduction": 4,
    "readyToDispatch": 3,
    "dispatchedToday": 2,
    "pendingApproval": 3
  }
}
```
- `inProduction` = buildings with confirmed BOM but no confirmed PackingListPlan / Truck Load Plan
- `readyToDispatch` = PackingListPlan confirmed, no Delivery created yet
- `dispatchedToday` = Deliveries with status `in_transit` or `delivered` updated today
- `pendingApproval` = buildings with any drawing at `pending_review`

---

### 4.3 GET `/api/plant/dashboard/shipper-files`

**Query:** `?startDate=&endDate=&page=1&limit=5`
*(Same endpoint powers dashboard widget (limit=5) and "View All" page (higher limit))*

**Response:**
```json
{
  "success": true,
  "data": {
    "shipperFiles": [
      {
        "_id": "...",
        "leadId": "...",
        "projectName": "ABC Warehouse",
        "vendorName": "ABC Steel",
        "vendorCode": "VND-0001",
        "fileName": "SHP-1044.xlsx",
        "uploadDate": "2025-02-22T00:00:00Z",
        "quoteValue": 2100,
        "status": "submitted",
        "fileUrl": "https://..."
      }
    ],
    "total": 24,
    "page": 1,
    "limit": 5
  }
}
```

---

### 4.4 GET `/api/plant/dashboard/alerts`

**Query:** `?startDate=&endDate=&page=1&limit=10`

**Response:**
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "type": "shipper_submitted",
        "message": "New shipper file received for ABC Warehouse",
        "timestamp": "2025-03-15T17:00:14Z",
        "leadId": "...",
        "icon": "file"
      }
    ],
    "total": 38,
    "page": 1,
    "limit": 10
  }
}
```

---

### 4.5 GET `/api/plant/dashboard/drawing-status`

**Query:** `?startDate=&endDate=&page=1&limit=10`

**Response:**
```json
{
  "success": true,
  "data": {
    "drawings": [
      {
        "buildingId": "...", "leadId": "...",
        "projectName": "ABC Warehouse", "customerName": "John Smith",
        "fileName": "Drawing-v2.pdf", "sentDate": "2025-02-22T00:00:00Z",
        "status": "pending_review", "versionNumber": 2, "fileUrl": "https://..."
      }
    ],
    "total": 18, "page": 1, "limit": 10
  }
}
```

---

### 4.6 GET `/api/plant/projects/stats`

**Query:** `?startDate=&endDate=`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalProjects": 24,
    "activeProjects": 18,
    "pendingCustomerApproval": 4,
    "cancelledProjects": 2
  }
}
```

---

### 4.7 GET `/api/plant/projects`

**Query:** `?startDate=&endDate=&page=1&limit=20&search=&status=&buildingType=`

**Response:**
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "_id": "leadId", "projectName": "ABC Warehouse", "jobId": "PRO-001",
        "location": "Texas, USA", "buildingType": "Commercial",
        "customer": { "firstName": "John", "lastName": "Smith" },
        "numberOfBuildings": 3, "quoteValue": 125000,
        "lifecycleStatus": "converted_to_po",
        "drawingStatus": "pending",
        "bomStatus": "partial",
        "createdAt": "2025-01-15T00:00:00Z"
      }
    ],
    "total": 24, "page": 1, "limit": 20
  }
}
```
`drawingStatus`: `all_approved | pending | rejected | none`
`bomStatus`: `all_confirmed | partial | none`

---

### 4.8 GET `/api/plant/projects/:leadId/detail`

**Guard:** POOrder must exist `{ leadId, assignedTo: req.user._id, status:'approved' }`

**Response:**
```json
{
  "success": true,
  "data": {
    "lead": {
      "_id": "...", "projectName": "ABC Warehouse", "jobId": "PRO-001",
      "buildingType": "Commercial", "quoteValue": 125000, "location": "Texas, USA",
      "lifecycleStatus": "converted_to_po",
      "lifecycleHistory": [
        { "stage": "initial_contact", "changedAt": "2025-01-10T00:00:00Z", "changedBy": { "name": "Sarah Sales" } }
      ],
      "numberOfBuildings": 2, "endDate": "2025-06-30T00:00:00Z", "createdAt": "2025-01-15T00:00:00Z"
    },
    "customer": {
      "firstName": "John", "lastName": "Smith",
      "email": "john@example.com", "phone": { "number": "5551234567", "countryCode": "+1" }
    },
    "assignedSales": { "name": "Sarah Sales", "email": "sarah@co.com" },
    "buildings": [
      {
        "_id": "...", "buildingNumber": 1, "status": "bom_pending",
        "drawings": [
          {
            "versionNumber": 2, "fileUrl": "https://...", "fileName": "building1-v2.pdf",
            "status": "pending_review", "uploadedAt": "2025-03-10T00:00:00Z",
            "reviewedAt": null, "rejectionReason": ""
          }
        ],
        "latestDrawingStatus": "pending_review",
        "bomJob": {
          "_id": "...", "status": "completed", "fileName": "bom-b1.ods",
          "totalItems": 120, "matchedItems": 97, "unmatchedItems": 15,
          "frameItems": 8, "isConfirmed": false
        }
      }
    ],
    "invoices": [
      { "_id": "...", "invoiceNumber": "INV-001", "totalAmount": 62500, "status": "sent" }
    ],
    "consolidatedBOM": null,
    "shipperRequests": [],
    "activityLog": [
      {
        "action": "drawing.uploaded", "performedBy": { "name": "Jane Plant" },
        "metadata": { "buildingNumber": 1, "versionNumber": 2 }, "createdAt": "2025-03-10T12:00:00Z"
      }
    ]
  }
}
```

---

### 4.9 PUT `/api/plant/projects/:leadId/lifecycle`

**Body:** `{ "lifecycleStatus": "in_production", "note": "Started manufacturing" }`

**Logic:** Update lead.lifecycleStatus, push to lifecycleHistory, audit log

**Response:**
```json
{ "success": true, "data": { "leadId": "...", "lifecycleStatus": "in_production" } }
```

---

### 4.10 POST `/api/plant/projects/:leadId/buildings/:buildingId/drawings`

*(Call AFTER S3 upload completes — registers the URL only)*

**Body:** `{ "fileUrl": "https://...", "fileName": "building1-v2.pdf" }`

**Logic:**
1. Find max versionNumber in building.drawings → push new entry at versionNumber+1
2. Email customer: "Drawing ready for review — {projectName} Building {N}"
3. Audit log: `drawing.uploaded`

**Response 201:**
```json
{
  "success": true,
  "data": {
    "drawing": {
      "versionNumber": 2, "fileUrl": "https://...", "fileName": "building1-v2.pdf",
      "status": "pending_review", "uploadedAt": "2025-03-10T12:00:00Z"
    }
  }
}
```

---

### 4.11 GET `/api/plant/projects/:leadId/buildings/:buildingId/drawings`

**Response:**
```json
{
  "success": true,
  "data": {
    "buildingNumber": 1,
    "drawings": [
      {
        "versionNumber": 2, "fileUrl": "https://...", "fileName": "building1-v2.pdf",
        "status": "pending_review", "uploadedAt": "2025-03-10T12:00:00Z",
        "reviewedAt": null, "rejectionReason": ""
      }
    ],
    "currentStatus": "pending_review",
    "latestVersion": 2
  }
}
```

---

### 4.12 PUT `/api/customer/buildings/:buildingId/drawings/:versionNumber/review`

**Auth:** Customer JWT  
**Body:** `{ "action": "approved" | "rejected", "rejectionReason": "..." }`

**Logic:** Update drawing status + reviewedAt; socket emit `drawing_reviewed` to plant user

**Response:**
```json
{
  "success": true,
  "data": {
    "buildingId": "...", "versionNumber": 2, "status": "rejected",
    "rejectionReason": "Column heights don't match spec", "reviewedAt": "2025-03-11T08:00:00Z"
  }
}
```

---

### 4.13 POST `/api/plant/bom/upload`

*(Call AFTER S3 upload — immediately returns jobId and starts async extraction)*

**Body:**
```json
{
  "leadId": "...", "buildingId": "...",
  "fileUrl": "https://bucket.s3.amazonaws.com/bom/uuid.ods",
  "fileName": "bom-building1.ods", "fileFormat": "ods"
}
```

**Logic:**
1. Validate building belongs to plant user's POOrder
2. Delete any existing BOMJob + BOMItems for this `buildingId` (re-upload replaces everything)
3. Create BOMJob `{ status: 'queued', ... }`
4. Return 201 immediately
5. Fire-and-forget (do NOT await): `bomService.processBOMJob(jobId, fileUrl, ...)`

**Response 201:**
```json
{
  "success": true,
  "data": {
    "jobId": "...",
    "status": "queued",
    "message": "BOM extraction started. You will be notified when complete."
  }
}
```

---

### 4.14 GET `/api/plant/bom/job/:jobId/status`

*(Frontend polls every 2s while status is queued or processing)*

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "...", "status": "completed",
    "totalSheets": 29, "totalItems": 320,
    "matchedItems": 285, "unmatchedItems": 27, "frameItems": 8,
    "processingStartedAt": "2025-03-10T12:00:05Z",
    "processingEndedAt": "2025-03-10T12:00:18Z"
  }
}
```

---

### 4.15 GET `/api/plant/bom/:jobId`

**Query:** `?filter=all|unpriced|frames|matched&page=1&limit=50`

**Response:**
```json
{
  "success": true,
  "data": {
    "bomJob": {
      "_id": "...", "buildingNumber": 1, "fileName": "bom-building1.ods",
      "status": "completed", "isConfirmed": false,
      "totalItems": 320, "matchedItems": 285, "unmatchedItems": 27, "frameItems": 8
    },
    "itemsByCategory": {
      "STUDS_&_TOP_CHANNELS": [
        {
          "_id": "...", "markId": "S6-1", "description": "CEE Stud",
          "partCode": "C62514", "partColor": "RO",
          "quantity": 1, "lengthFeet": 0.48, "weight": 1.33, "gauge": "14 GA",
          "costUnit": "FT", "smdtUnitCost": 2.48, "smdtTotalCost": 1.19,
          "isPriced": true, "isManuallyPriced": false, "matchConfidence": "exact",
          "finalUnitCost": 2.48, "finalTotalCost": 1.19
        }
      ],
      "frames": [
        {
          "_id": "...", "markId": "RF1-1", "description": "Rafter",
          "weight": 245, "isFrameType": true, "isPriced": false
        }
      ]
    },
    "summary": {
      "totalItems": 320, "pricedItems": 285, "unpricedItems": 35,
      "frameItems": 8, "totalCost": 48250.75, "isFullyPriced": false
    },
    "total": 320, "page": 1, "limit": 50
  }
}
```

---

### 4.16 PUT `/api/plant/bom/items/:bomItemId/price`

**Body:**
```json
{ "manualUnitCost": 1.68, "saveToSMDT": true }
```

**Logic:**
1. Calculate `manualTotalCost` based on `costUnit`:
   - `FT`: `manualUnitCost × lengthFeet × quantity`
   - `LB`: `manualUnitCost × weight`
   - `EA`: `manualUnitCost × quantity`
   - Frame items with no costUnit: default to weight (LB logic)
2. Set `isPriced=true`, `isManuallyPriced=true`, `finalUnitCost`, `finalTotalCost`
3. If `saveToSMDT=true` and `partCode` exists:
```js
await SMDTItem.findOneAndUpdate(
  { partName: partCode, partColor: partColor || null, category },
  {
    $set: { mbsCost: manualUnitCost, costUnit, isActive: true },
    $setOnInsert: { partName: partCode, partColor: partColor || null, category, isFrameType: false, addedBy: req.user._id }
  },
  { upsert: true }
)
item.manualPriceSavedToSMDT = true
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bomItem": {
      "_id": "...", "markId": "RF1-1",
      "isPriced": true, "isManuallyPriced": true,
      "manualUnitCost": 1.68, "manualTotalCost": 411.60,
      "finalUnitCost": 1.68, "finalTotalCost": 411.60,
      "manualPriceSavedToSMDT": true
    }
  }
}
```

---

### 4.17 POST `/api/plant/bom/:buildingId/confirm`

**Guard:** ALL BOMItems for this building must have `isPriced=true`

**Response 400:**
```json
{ "success": false, "message": "8 items still need pricing", "errors": { "unpricedMarkIds": ["RF1-1","RF1-2"] } }
```

**Response 200:**
```json
{ "success": true, "data": { "buildingId": "...", "buildingNumber": 1, "isConfirmed": true, "totalCost": 48250.75 } }
```

---

### 4.18 POST `/api/plant/projects/:leadId/consolidated-bom/generate`

**Guard:** All buildings for this lead must have `BOMJob.isConfirmed=true`

**Logic:**
1. Load all BOMItems for lead where `isPriced=true`
2. Call `consolidator.generateConsolidatedExcel(lead, buildings)`
3. Upload Excel buffer to S3 → get fileUrl
4. `groupItemsForConsolidation()` to build items array
5. `ConsolidatedBOM.findOneAndReplace({ leadId }, newDoc, { upsert: true })`

**Response:**
```json
{
  "success": true,
  "data": {
    "consolidatedBOM": {
      "_id": "...", "status": "draft",
      "fileUrl": "https://bucket.s3.amazonaws.com/consolidated/uuid.xlsx",
      "totalCost": 87450.25, "itemCount": 48
    }
  }
}
```

---

### 4.19 GET `/api/plant/projects/:leadId/consolidated-bom`

**Response:**
```json
{
  "success": true,
  "data": {
    "consolidatedBOM": {
      "_id": "...", "status": "sent_to_vendor", "fileUrl": "https://...", "totalCost": 87450.25,
      "items": [
        {
          "partCode": "C62514", "partColor": "RO", "description": "CEE Stud",
          "category": "STUDS_&_TOP_CHANNELS", "costUnit": "FT",
          "totalQty": 45, "totalLengthFeet": 320.5, "totalWeight": 892.3, "totalCost": 795.64,
          "buildings": [1, 2], "markIds": ["S6-1","S6-3"]
        }
      ],
      "sentToVendors": [
        { "vendorId": { "vendorName": "ABC Steel" }, "sentAt": "2025-03-10T00:00:00Z" }
      ]
    }
  }
}
```

---

### 4.20 POST `/api/plant/projects/:leadId/consolidated-bom/send`

**Body:** `{ "vendorIds": ["vendorId1", "vendorId2"] }`

**Logic:**
1. For each vendorId: `token = crypto.randomBytes(32).toString('hex')`
2. Create ShipperRequest per vendor
3. Email vendor: BOM Excel attached + public upload URL `{CLIENT_URL}/vendor-upload/{token}`
4. `consolidatedBOM.status = 'sent_to_vendor'`

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Sent to 2 vendors",
    "shipperRequests": [
      { "_id": "...", "vendorId": "...", "vendorName": "ABC Steel", "status": "sent" }
    ]
  }
}
```

---

### 4.21 GET `/api/plant/shipper-files`

**Query:** `?startDate=&endDate=&page=1&limit=20`

**Response:**
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "leadId": "...", "projectName": "ABC Warehouse",
        "totalVendorsSent": 3, "submitted": 2, "pending": 1,
        "shipperRequests": [
          {
            "_id": "...", "vendorId": { "vendorName": "ABC Steel" },
            "status": "submitted", "sentAt": "2025-03-01T00:00:00Z",
            "submittedAt": "2025-03-05T00:00:00Z", "submittedFileName": "SHP-1044.xlsx",
            "submittedFileUrl": "https://...", "quoteValue": 2100, "exceptionsCount": 0
          }
        ]
      }
    ],
    "total": 12, "page": 1, "limit": 20
  }
}
```

---

### 4.22 GET `/api/plant/shipper-requests/:requestId`

**Response:** Full ShipperRequest populated with `vendorId`, `leadId`

---

### 4.23 POST `/api/plant/shipper-requests/:requestId/approve`

**Body:** `{}`  
**Response:** `{ "data": { "requestId": "...", "status": "approved", "reviewedAt": "..." } }`

---

### 4.24 POST `/api/plant/shipper-requests/:requestId/exceptions`

Stores manual review exceptions. Exceptions can also be auto-generated by the compare API below.

**Body:**
```json
{
  "note": "Several items missing",
  "exceptions": [
    {
      "partCode": "C62514",
      "description": "CEE Stud",
      "expected": { "qty": 25, "lf": 320.5 },
      "received": { "qty": 20, "lf": 256.4 },
      "issueType": "qty_mismatch",
      "severity": "critical",
      "reason": "Vendor quoted lower quantity than expected"
    }
  ]
}
```

**Logic:**
1. Validate plant user can access the ShipperRequest lead.
2. Replace or append `exceptions` based on controller choice.
3. Save `manualReviewNote = note`.
4. Keep status unchanged unless frontend separately calls approve/resubmit.

**Response:** Updated ShipperRequest with exceptions array

---

### 4.24A POST `/api/plant/shipper-requests/:requestId/compare`

Compares the vendor-uploaded quote/shipper file against the stored `ConsolidatedBOM.items`.

**Body:** `{}`

No expected BOM data should be sent from frontend. Backend already has:
```txt
requestId → ShipperRequest
ShipperRequest → consolidatedBOMId
ConsolidatedBOM → expected items
ShipperRequest → submittedFileUrl
```

**Logic:**
1. Validate plant user can access this ShipperRequest's lead.
2. Ensure ShipperRequest has `submittedFileUrl`.
3. Set:
```js
status = 'comparison_processing'
comparisonStatus = 'processing'
comparisonError = null
```
4. Load `ConsolidatedBOM.items` as expected items.
5. Extract vendor quote lines:
   - PDF → text/OCR/Claude extraction into strict JSON
   - Excel/CSV → deterministic parser
6. Store extracted rows in `VendorQuoteLine`.
7. Compare expected vs vendor lines by priority:
```txt
1. exact partCode + color + length
2. partCode + length grouped quantity
3. partCode grouped quantity
4. piece mark / alias / description-assisted suggestion
5. unmatched expected = missing
6. unmatched vendor = extra
```
8. Store detailed rows in `QuoteComparisonResult`.
9. Copy review-ready mismatch items into `ShipperRequest.exceptions` with `source='auto_compare'`.
10. Save `comparisonSummary`, `comparisonRanAt`, and status:
```js
status = 'comparison_completed'
comparisonStatus = 'completed'
```
11. If extraction/comparison fails, save:
```js
status = 'comparison_failed'
comparisonStatus = 'failed'
comparisonError = err.message
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "requestId": "...",
    "comparisonStatus": "completed",
    "summary": {
      "expectedLines": 48,
      "vendorLines": 47,
      "matchedLines": 43,
      "missingItems": 2,
      "extraItems": 1,
      "qtyMismatches": 1,
      "lengthMismatches": 0,
      "weightMismatches": 0,
      "priceMismatches": 3,
      "ambiguousMatches": 1
    },
    "exceptions": [
      {
        "issueType": "missing",
        "severity": "critical",
        "partCode": "PC16-RO-8X3.5",
        "description": "16Ga CEE Purlin Red Oxide",
        "expected": { "qty": 28, "lengthFeet": 6.9792, "weight": 621 },
        "received": null,
        "reason": "Expected item was not found in vendor quote"
      }
    ]
  }
}
```

**Important:** Claude is allowed to extract messy PDF rows. Claude must not make the final pass/fail decision. Final comparison is backend code.

---

### 4.25 POST `/api/plant/shipper-requests/:requestId/request-resubmit`

**Body:** `{ "note": "Please correct qty on C62514" }`

**Logic:**
1. Validate plant user can access the ShipperRequest lead.
2. Use saved `exceptions` from manual review and/or auto-compare to explain issues.
3. Set `status='resubmit_requested'`.
4. Save `manualReviewNote = note`.
5. Email vendor with:
   - note
   - mismatch summary
   - public upload link
6. Vendor can upload corrected file again using same token while status is `resubmit_requested`.

**Response:** `{ "data": { "requestId": "...", "status": "resubmit_requested" } }`

---



### 4.25A POST `/api/plant/shipper-requests/:requestId/bundle-plan/generate`

Generates the Bundle Plan from the approved vendor shipper / quote lines.

**Preconditions:**
```txt
ShipperRequest.status = approved
VendorQuoteLine rows exist for this shipperRequestId
No confirmed BundlePlan already exists for this shipperRequestId
```

**Body:** `{}`

**Logic:**
1. Validate plant user can access the ShipperRequest lead.
2. Load `VendorQuoteLine.find({ shipperRequestId: requestId })`.
3. Call `loadPlanning.service.generateBundlesFromVendorLines(vendorLines)`.
4. Create `BundlePlan` with totals.
5. Insert `Bundle` records.
6. Save algorithm-generated stacking fields, warnings, load sequence defaults, and handling notes.
7. Audit log `bundle_plan.generated`.

**Response 201:**
```json
{
  "success": true,
  "data": {
    "bundlePlan": {
      "_id": "...",
      "planNumber": "BP-0001",
      "status": "generated",
      "totalBundles": 12,
      "totalWeight": 38400,
      "maxLengthFeet": 48
    },
    "bundles": [
      {
        "_id": "...",
        "bundleNo": "B-001",
        "bundleType": "framing",
        "totalWeight": 6200,
        "maxLengthFeet": 48,
        "stacking": { "stackLevel": "bottom", "loadingPriority": 10 },
        "warnings": []
      }
    ]
  }
}
```

---

### 4.25B GET `/api/plant/bundle-plans/:bundlePlanId`

Returns the bundle plan with all bundles and summary totals.

**Response:**
```json
{
  "success": true,
  "data": {
    "bundlePlan": {},
    "bundles": [],
    "summary": {
      "totalBundles": 12,
      "totalWeight": 38400,
      "maxLengthFeet": 48,
      "warnings": []
    }
  }
}
```

---

### 4.25C GET `/api/plant/bundles/:bundleId`

Returns one bundle with its items and the packing list / delivery context if already assigned.

**Response:**
```json
{
  "success": true,
  "data": {
    "bundle": {},
    "items": [],
    "packingList": {},
    "delivery": {}
  }
}
```

---

### 4.25D PUT `/api/plant/bundles/:bundleId`

Allows plant users to edit bundle details before BundlePlan confirmation.

**Editable fields:**
```txt
items
bundleType
title
stacking
loadSequence
handlingInstruction
notes
```

**Logic:**
1. Block edit if `BundlePlan.status = confirmed` unless the next stages are cancelled/reset.
2. Recalculate `totalQty`, `totalWeight`, `maxLengthFeet`, and warnings.
3. Save updated bundle.
4. Recalculate BundlePlan summary.

**Important:** If any bundle is edited after a PackingListPlan exists, backend must cancel/reset the existing PackingListPlan because truck planning becomes stale.

---

### 4.25E POST `/api/plant/bundle-plans/:bundlePlanId/confirm`

Confirms the Bundle Plan.

**Validation before confirmation:**
```txt
Every VendorQuoteLine qty must be fully assigned.
No VendorQuoteLine qty can be over-assigned.
Warnings can remain, but must be visible to frontend.
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bundlePlanId": "...",
    "status": "confirmed",
    "confirmedAt": "2026-05-26T00:00:00.000Z"
  }
}
```

---

### 4.25F POST `/api/plant/bundle-plans/:bundlePlanId/packing-list-plan/generate`

Generates the Packing List / Truck Load Plan. In this system, **Packing List = Truck Load Plan**. Do not create a separate LoadingPlan.

**Preconditions:**
```txt
BundlePlan.status = confirmed
Confirmed Bundle rows exist
No confirmed PackingListPlan already exists for this bundlePlanId
```

**Body:** `{}`

**Logic:**
1. Load all confirmed bundles under the BundlePlan.
2. Call `loadPlanning.service.generateMixedTruckPackingLists(bundles)`.
3. Use only the two allowed truck types:
```txt
SEMI_53    → 53 ft, 45,000 lbs safe, 48,000 lbs hard max
HOTSHOT_40 → 40 ft, 18,000 lbs max
```
4. Create `PackingListPlan`.
5. Insert `PackingList` records, each representing one truck load.
6. Update each `Bundle.packingListId`.
7. Store truck summary: semi count, hot shot count, total trucks.
8. Audit log `packing_list_plan.generated`.

**Response 201:**
```json
{
  "success": true,
  "data": {
    "packingListPlan": {
      "_id": "...",
      "planNumber": "PLP-0001",
      "status": "generated",
      "totalPackingLists": 2,
      "totalBundles": 18,
      "totalWeight": 62400,
      "truckSummary": {
        "semi53Count": 1,
        "hotshot40Count": 1,
        "totalTrucks": 2
      }
    },
    "packingLists": [
      {
        "packingListNo": "PL-001",
        "truckNo": "TRUCK-1",
        "truckType": "SEMI_53",
        "truckLabel": "53 ft Semi",
        "totalWeight": 44200,
        "maxLengthFeet": 51,
        "totalBundles": 12,
        "warnings": ["Truck is above 95% safe capacity"]
      },
      {
        "packingListNo": "PL-002",
        "truckNo": "TRUCK-2",
        "truckType": "HOTSHOT_40",
        "truckLabel": "40 ft Hot Shot",
        "totalWeight": 18200,
        "maxLengthFeet": 32,
        "totalBundles": 6,
        "warnings": []
      }
    ]
  }
}
```

---

### 4.25G GET `/api/plant/packing-list-plans/:packingListPlanId`

Returns the overall truck plan summary and all truck-wise packing lists.

**Response:**
```json
{
  "success": true,
  "data": {
    "packingListPlan": {},
    "packingLists": [],
    "summary": {
      "totalWeight": 62400,
      "totalBundles": 18,
      "totalPackingLists": 2,
      "truckSummary": {
        "semi53Count": 1,
        "hotshot40Count": 1,
        "totalTrucks": 2
      },
      "warnings": []
    }
  }
}
```

---

### 4.25H GET `/api/plant/packing-lists/:packingListId`

Returns one truck-wise packing list with all bundles and items inside it.

**Response:**
```json
{
  "success": true,
  "data": {
    "packingList": {},
    "truckInfo": {
      "truckType": "SEMI_53",
      "truckLabel": "53 ft Semi",
      "totalWeight": 44200,
      "maxTruckWeight": 45000,
      "hardMaxTruckWeight": 48000,
      "maxTruckLengthFeet": 53
    },
    "bundles": [],
    "items": [],
    "loadLayout": {
      "bottomLayer": [],
      "middleLayer": [],
      "topLayer": []
    },
    "delivery": {}
  }
}
```

---

### 4.25I PUT `/api/plant/packing-lists/:packingListId`

Allows plant users to manually edit truck load details before confirmation.

**Editable fields:**
```txt
truckType
bundleIds
loadLayout
loadingNotes
overrideReason
notes
```

**Logic:**
1. If truck type changes, update truck capacity fields from `PLANT_TRUCK_TYPES`.
2. Recalculate `totalBundles`, `totalItems`, `totalWeight`, and `maxLengthFeet`.
3. Recalculate warnings.
4. Update `Bundle.packingListId` assignments.
5. Recalculate PackingListPlan summary.

**Hard blocks:**
```txt
HOTSHOT_40 cannot exceed 18,000 lbs.
HOTSHOT_40 cannot exceed 40 ft.
SEMI_53 cannot exceed 48,000 lbs hard max.
SEMI_53 cannot exceed 53 ft.
```

**Override required:**
```txt
SEMI_53 above 45,000 lbs safe capacity but <= 48,000 lbs hard max.
Truck above 95% capacity.
Stacking warnings accepted manually.
```

---

### 4.25J POST `/api/plant/packing-list-plans/:packingListPlanId/confirm`

Confirms the truck-wise Packing List Plan.

**Validation before confirmation:**
```txt
Every confirmed Bundle must be assigned to exactly one PackingList.
Every PackingList must have a valid truckType.
Truck hard capacity violations must be blocked.
Warnings can be confirmed only when overrideReason exists where required.
```

**Response:**
```json
{
  "success": true,
  "data": {
    "packingListPlanId": "...",
    "status": "confirmed",
    "confirmedAt": "2026-05-26T00:00:00.000Z",
    "summary": {
      "totalWeight": 62400,
      "totalBundles": 18,
      "truckSummary": {
        "semi53Count": 1,
        "hotshot40Count": 1,
        "totalTrucks": 2
      }
    }
  }
}
```

---

### 4.25K POST `/api/plant/packing-list-plans/:packingListPlanId/delivery/create`

Creates a delivery from the confirmed Packing List / Truck Load Plan.

**Preconditions:**
```txt
PackingListPlan.status = confirmed
No Delivery already exists for this packingListPlanId
```

**Body:**
```json
{
  "pickupLocation": "Plant address",
  "deliveryLocation": "Project site address",
  "pickupDate": "2026-05-30T00:00:00.000Z",
  "expectedDeliveryDate": "2026-06-02T00:00:00.000Z",
  "notes": "Call before pickup"
}
```

**Logic:**
1. Load PackingListPlan and PackingLists.
2. Create Delivery with total weight, total bundles, total packing lists, and truck summary.
3. Attach all PackingList IDs.
4. Mark PackingLists as `delivery_created`.
5. Audit log `delivery.created`.

---

### 4.25L POST `/api/plant/deliveries/:deliveryId/send-bids`

Sends freight bidding requests to selected freight carriers.

**Body:**
```json
{
  "carrierIds": ["carrierId1", "carrierId2"],
  "expiresAt": "2026-05-29T18:00:00.000Z"
}
```

**Logic:**
1. Validate delivery exists and is not cancelled.
2. For each carrier, generate token using `crypto.randomBytes(32).toString('hex')`.
3. Create `FreightBid` rows.
4. Email each carrier a public bid link.
5. Email includes: project/customer/location, pickup/delivery location, total weight, total bundles, truck requirement summary, packing list/truck plan link or PDF, expected pickup date.
6. Set `Delivery.status = bidding_sent`.
7. Audit log `freight_bids.sent`.

---

### 4.25M GET `/api/plant/deliveries/:deliveryId/bids`

Returns all freight carrier bids for a delivery.

---

### 4.25N POST `/api/plant/freight-bids/:bidId/select`

Selects one submitted freight bid and rejects the others.

**Logic:**
1. Set selected bid status to `selected`.
2. Set other bids for same delivery to `rejected`.
3. Set `Delivery.selectedCarrierBidId`.
4. Set `Delivery.status = carrier_selected`.
5. Audit log `freight_bid.selected`.

---

### 4.25O GET `/api/public/freight-bids/:token`

Public carrier quote page data. No auth.

**Response includes:**
```txt
Delivery summary
Pickup location
Delivery location
Truck requirement summary
Total weight
Total bundles
Packing list/truck load summary
```

---

### 4.25P POST `/api/public/freight-bids/:token/submit`

Carrier submits quote amount and date notes from public page.

**Body:**
```json
{
  "quotedAmount": 2450,
  "currency": "USD",
  "estimatedPickupDate": "2026-05-30T00:00:00.000Z",
  "estimatedDeliveryDate": "2026-06-02T00:00:00.000Z",
  "carrierNotes": "Rate valid for 48 hours"
}
```


### 4.26 GET `/api/plant/vendors`

**Query:** `?status=active|inactive&vendorType=&search=&page=1&limit=20`

**Response:**
```json
{
  "success": true,
  "data": {
    "vendors": [
      {
        "_id": "...", "vendorCode": "VND-0001", "vendorName": "ABC Steel",
        "contactName": "Mike Johnson", "email": "mike@abcsteel.com",
        "phone": "5551234567", "vendorType": "steel",
        "materialTypes": ["Steel", "Panels"], "status": "active",
        "activeOrders": 3, "completedOrders": 12
      }
    ],
    "total": 8
  }
}
```

---

### 4.27 POST `/api/plant/vendors`

**Body:**
```json
{
  "vendorName": "Metro Steel", "email": "orders@metrosteel.com", "phone": "5559876543",
  "contactName": "Sara Lee", "address": "123 Steel Ave, Houston TX",
  "vendorType": "steel", "materialTypes": ["Steel", "Insulation"], "notes": ""
}
```
**Logic:** Auto-generate `vendorCode = "VND-" + zero-padded sequential number`

**Response 201:** `{ "data": { "vendor": { "_id": "...", "vendorCode": "VND-0009", ... } } }`

---

### 4.28 GET `/api/plant/vendors/:vendorId`

Returns vendor + `shipperHistory` (past ShipperRequests with projectName, status, quoteValue, date)

---

### 4.29 PUT `/api/plant/vendors/:vendorId` / PATCH `/api/plant/vendors/:vendorId/toggle-status`

Standard update / toggle between active and inactive.

---

### 4.30 GET, POST, GET single, PUT, PATCH — `/api/plant/carriers`

Same structure as vendor endpoints. `carrierCode` auto-generated as `"CAR-0001"` etc.

GET list includes `totalDeliveriesCompleted` and `activeDeliveries` count.

GET single returns carrier + `bids` (past FreightBids) + `deliveries` + `totalFreightCost`

---

### 4.31 GET `/api/public/vendor-upload/:token`

**No auth.**

**Response:**
```json
{ "data": { "projectName": "ABC Warehouse", "vendorName": "ABC Steel", "status": "sent", "isExpired": false } }
```

---

### 4.32 GET `/api/public/vendor-upload/:token/presigned-url`

**Query:** `?fileName=SHP-1044.xlsx&fileType=application/vnd.openxmlformats...`

**Guard:** token must exist, status must be `sent` or `resubmit_requested`

**Logic:** Same S3 presigned URL generation as existing `upload.controller.js`, `folder='vendor-files'`

**Response:** `{ "data": { "uploadUrl": "https://...", "fileUrl": "https://..." } }`

---

### 4.33 POST `/api/public/vendor-upload/:token`

*(Vendor registers their completed S3 upload)*

**Body:** `{ "fileUrl": "https://...", "fileName": "SHP-1044.xlsx", "quoteValue": 2100 }`

**Guard:** status must be `sent` or `resubmit_requested`

**Logic:** Update ShipperRequest fields, audit log, socket emit `shipper_file_submitted` to plant user

**Response:** `{ "data": { "message": "File submitted successfully. Thank you." } }`

---

### 4.34 POST `/api/admin/smdt/upload` — SMDT Bulk Upload via Excel

**Auth:** Admin only

**Flow:**
1. Frontend calls `POST /api/upload/presigned-url` `{ folder: "smdt" }` → gets S3 upload URL
2. Frontend uploads file directly to S3
3. Frontend calls this endpoint with the S3 URL

**Body:** `{ "fileUrl": "https://bucket.s3.amazonaws.com/smdt/uuid.xlsx" }`

**Logic:** Calls `smdt.service.js → importSMDTFromUrl(fileUrl, req.user._id)`

**Response:**
```json
{
  "success": true,
  "data": {
    "inserted": 820, "updated": 565, "skipped": 48, "total": 1385,
    "sheets": [
      { "name": "Insulation",  "inserted": 20,  "updated": 0,   "skipped": 1 },
      { "name": "TRIM",        "inserted": 400, "updated": 155, "skipped": 12 },
      { "name": "EaveStruts",  "inserted": 336, "updated": 0,   "skipped": 1 },
      { "name": "frames",      "inserted": 5,   "updated": 0,   "skipped": 0 }
    ]
  }
}
```

---

### 4.35 GET `/api/admin/smdt` — List SMDT Items

**Query:** `?category=TRIM&isFrameType=false&search=MLOC&isActive=true&page=1&limit=50`

**Logic:**
- `search` → `$text` search on partName/description (using text index)
- `category` → exact match
- `isActive=false` → include deactivated items
- Default `limit=50` (TRIM alone has 555 items — frontend must paginate)

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "_id": "...", "category": "TRIM", "partName": "RLGU6102", "partColor": "M ",
        "costUnit": "EA", "mbsCost": 26.19, "currentMarketCost": null,
        "laborCost": 0, "additionalCost": 0, "materialCost": 0,
        "description": "Standard Gutter", "isFrameType": false, "isActive": true,
        "addedBy": null, "lastImportedAt": "2025-03-10T00:00:00Z",
        "createdAt": "2025-03-10T00:00:00Z", "updatedAt": "2025-03-10T00:00:00Z"
      }
    ],
    "total": 555, "page": 1, "limit": 50,
    "categories": [
      "Insulation","Joist","Panels","TRIM","Mastic","Screws",
      "ABolts","CLIPS","Cable","Flange_Brace","Jambs","DCOL",
      "ZGIRT","OPEN CHANNEL","EaveStruts","ACCESSORIES","SKTLIGHT",
      "ANGL1","TS_PANEL","frames"
    ]
  }
}
```

---

### 4.36 GET `/api/admin/smdt/:itemId` — Single SMDT Item

**Response:** Full SMDTItem with populated `addedBy` and `lastUpdatedBy`

---

### 4.37 POST `/api/admin/smdt` — Add Single SMDT Item Manually

**Auth:** Admin only

**Body:**
```json
{
  "category": "TRIM",
  "partName": "CUSTOM_PART_01",
  "partColor": "M ",
  "costUnit": "FT",
  "mbsCost": 3.50,
  "currentMarketCost": 4.20,
  "description": "Custom trim piece"
}
```

**Logic:**
- Check for duplicate `{ partName, partColor, category }` → 400 if already exists
- `addedBy = req.user._id`
- `isActive = true`, `lastImportedAt = null`
- Audit log: `smdt.item_added`

**Response 201:**
```json
{
  "success": true,
  "data": {
    "item": {
      "_id": "...", "category": "TRIM", "partName": "CUSTOM_PART_01",
      "partColor": "M ", "costUnit": "FT", "mbsCost": 3.50,
      "isActive": true, "addedBy": { "name": "Admin User" }
    }
  }
}
```

---

### 4.38 PUT `/api/admin/smdt/:itemId` — Edit SMDT Item

**Body (all optional — only send fields that are changing):**
```json
{
  "mbsCost": 3.75,
  "currentMarketCost": 4.50,
  "costUnit": "FT",
  "description": "Updated description",
  "isActive": true
}
```

**Restriction:** Cannot change `partName`, `partColor`, or `category` via this endpoint.
Those are the unique identity fields — to change them, deactivate and create a new item.

**Logic:** Update allowed fields + `lastUpdatedBy = req.user._id` + audit log `smdt.item_updated`

**Response:**
```json
{
  "success": true,
  "data": {
    "item": {
      "_id": "...", "partName": "RLGU6102", "partColor": "M ",
      "mbsCost": 3.75, "lastUpdatedBy": { "name": "Admin User" }, "updatedAt": "2025-03-15T09:00:00Z"
    }
  }
}
```

---

### 4.39 DELETE `/api/admin/smdt/:itemId` — Deactivate SMDT Item

**Logic:** `item.isActive = false` — **NEVER hard delete SMDT data**

**Response:** `{ "success": true, "data": { "message": "Item deactivated", "itemId": "..." } }`

---

## PART 5 — ROUTE FILE REGISTRATIONS

### 5.1 NEW: `src/routes/plant/index.js`

```js
const router      = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard   = require('../../middleware/roleGuard')

router.use(verifyToken, roleGuard(['plant']))

router.use('/dashboard',        require('./dashboard.routes'))
router.use('/projects',         require('./project.routes'))
router.use('/bom',              require('./bom.routes'))
router.use('/shipper-files',    require('./shipper.routes'))
router.use('/shipper-requests', require('./shipper.routes'))
router.use('/vendors',          require('./vendor.routes'))
router.use('/carriers',         require('./carrier.routes'))

module.exports = router
```

### 5.2 NEW: `src/routes/admin/smdt.routes.js`

```js
const router   = require('express').Router()
const { body } = require('express-validator')
const ctrl     = require('../../controllers/admin/smdt.controller')
const validate = require('../../middleware/validate')

// Bulk upload via S3 URL (not multipart — use presigned URL flow)
router.post('/upload',
  [body('fileUrl').notEmpty().withMessage('fileUrl is required')],
  validate,
  ctrl.uploadSMDT
)

// List with filters + pagination
router.get('/', ctrl.listSMDT)

// Single item
router.get('/:itemId', ctrl.getSMDTItem)

// Manual single-item add
router.post('/',
  [
    body('category').notEmpty(),
    body('partName').notEmpty(),
    body('costUnit').isIn(['FT', 'LB', 'EA']),
    body('mbsCost').isNumeric(),
  ],
  validate,
  ctrl.addSMDTItem
)

// Edit (cost/description/isActive only — not identity fields)
router.put('/:itemId',
  [
    body('costUnit').optional().isIn(['FT', 'LB', 'EA']),
    body('mbsCost').optional().isNumeric(),
  ],
  validate,
  ctrl.updateSMDTItem
)

// Soft delete
router.delete('/:itemId', ctrl.deactivateSMDTItem)

module.exports = router
```

### 5.3 ADD TO: `app.js`

```js
// After existing /api/account line:
app.use('/api/plant', require('./src/routes/plant/index'))
```

### 5.4 ADD TO: `src/routes/admin/index.js`

```js
// After existing /financials line:
router.use('/smdt', require('./smdt.routes'))
```

### 5.5 ADD TO: `src/routes/public.routes.js`

```js
const vendorUploadCtrl = require('../controllers/public/vendorUpload.controller')
router.get('/vendor-upload/:token',               vendorUploadCtrl.getUploadInfo)
router.get('/vendor-upload/:token/presigned-url', vendorUploadCtrl.getPresignedUrl)
router.post('/vendor-upload/:token',              vendorUploadCtrl.submitUpload)
```

---



**ADD load planning routes to `src/routes/plant/index.js`:**
```js
router.use('/bundle-plans',       require('./bundlePlan.routes'))
router.use('/bundles',            require('./bundle.routes'))
router.use('/packing-list-plans', require('./packingListPlan.routes'))
router.use('/packing-lists',      require('./packingList.routes'))
router.use('/deliveries',         require('./delivery.routes'))
router.use('/freight-bids',       require('./freightBid.routes'))
```

**ADD nested route under shipper requests:**
```js
// POST /api/plant/shipper-requests/:requestId/bundle-plan/generate
```

**ADD public carrier bid routes:**
```js
router.use('/freight-bids', require('./publicFreightBid.routes'))
```

## PART 6 — NEW FILES TO CREATE (complete list)

**Models:**
```
src/models/SMDTItem.js
src/models/BOMJob.js
src/models/BOMItem.js
src/models/ConsolidatedBOM.js
src/models/ShipperRequest.js
src/models/Vendor.js
src/models/FreightCarrier.js
src/models/VendorQuoteLine.js
src/models/QuoteComparisonResult.js
```

**Services:**
```
src/services/plant/smdt.service.js
src/services/plant/bom.service.js
src/services/plant/consolidator.service.js
src/services/plant/shipperComparison.service.js
```

**Controllers:**
```
src/controllers/plant/dashboard.controller.js
src/controllers/plant/project.controller.js
src/controllers/plant/bom.controller.js
src/controllers/plant/shipper.controller.js
src/controllers/plant/vendor.controller.js
src/controllers/plant/carrier.controller.js
src/controllers/public/vendorUpload.controller.js
src/controllers/admin/smdt.controller.js
```

**Routes:**
```
src/routes/plant/index.js
src/routes/plant/dashboard.routes.js
src/routes/plant/project.routes.js
src/routes/plant/bom.routes.js
src/routes/plant/shipper.routes.js
src/routes/plant/vendor.routes.js
src/routes/plant/carrier.routes.js
src/routes/admin/smdt.routes.js
```

---



### Load planning model files
```txt
src/models/BundlePlan.js
src/models/Bundle.js
src/models/PackingListPlan.js
src/models/PackingList.js
src/models/Delivery.js
src/models/FreightBid.js
```

### Load planning service files
```txt
src/services/plant/loadPlanning.service.js
```

### Load planning controller files
```txt
src/controllers/plant/bundlePlan.controller.js
src/controllers/plant/bundle.controller.js
src/controllers/plant/packingListPlan.controller.js
src/controllers/plant/packingList.controller.js
src/controllers/plant/delivery.controller.js
src/controllers/plant/freightBid.controller.js
src/controllers/public/freightBidPublic.controller.js
```

### Load planning route files
```txt
src/routes/plant/bundlePlan.routes.js
src/routes/plant/bundle.routes.js
src/routes/plant/packingListPlan.routes.js
src/routes/plant/packingList.routes.js
src/routes/plant/delivery.routes.js
src/routes/plant/freightBid.routes.js
src/routes/public/freightBid.routes.js
```

## PART 7 — PACKAGE TO INSTALL

```bash
npm install exceljs
```

Already installed — no action needed:
`@anthropic-ai/sdk`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `uuid`, `crypto` (Node built-in)

---

## PART 8 — SOCKET EVENTS

All emitted to `/admin` namespace, targeted to specific plant user room:

| Event | Room | Trigger |
|---|---|---|
| `bom_extraction_complete` | `user:{plantUserId}` | Claude extraction job finished OK |
| `bom_extraction_failed` | `user:{plantUserId}` | Claude extraction job failed |
| `drawing_reviewed` | `user:{plantUserId}` | Customer approved or rejected a drawing |
| `shipper_file_submitted` | `user:{plantUserId}` | Vendor uploaded via public link |

---

## PART 9 — EMAIL TRIGGERS

| Trigger | To | Template |
|---|---|---|
| Drawing uploaded | Customer | "Drawing ready for review — {project} Building {N}" |
| Consolidated BOM sent | Vendor(s) | BOM Excel attached + public upload URL |
| Shipper resubmit requested | Vendor | Note text + public upload URL |

Add functions to `src/services/email/mailer.js` and create HTML templates in `src/services/email/templates/`.

---

## PART 10 — IMPLEMENTATION RULES (read before coding)

### 1. SMDT string cleaning is mandatory
Every `partName`, `partColor`, `costUnit` value in the real Excel file has inconsistent quoting.
The `cleanStr()` function in `smdt.service.js` handles all variants. Never skip it.

### 2. BOM job is strictly async
The `processBOMJob()` call in the upload controller must NOT be awaited.
Controller responds 201 immediately. Job runs in background. Frontend polls the status endpoint.

### 3. Re-upload clears old data
Before creating a new BOMJob for a building, delete the existing BOMJob + all BOMItems for that `buildingId`.
Plant may re-upload a corrected file — old extracted items must be replaced, not appended.

```js
await BOMItem.deleteMany({ buildingId })
await BOMJob.deleteMany({ buildingId })
```

### 4. ConsolidatedBOM is unique per lead
Schema has `unique: true` on `leadId`. On re-generation, use `findOneAndReplace` or delete+create.
Do NOT use `findOneAndUpdate` — it will conflict on the unique index.

### 5. Shipper file includes ALL items
The Excel sent to vendors must contain every extracted BOM item, including unpriced ones.
Vendors need to see the full list to respond with their packing/shipper file.
The `generateConsolidatedExcel()` function in `consolidator.service.js` does this correctly.

### 6. Claude BOM extraction max_tokens must be 16000
Large BOM files with 300+ items produce large JSON arrays.
16000 tokens ensures Claude can output the full result without truncation.

### 7. SMDT upload uses presigned URL, not multipart
`POST /api/admin/smdt/upload` expects `{ "fileUrl": "..." }` — an S3 URL.
Frontend uses the existing presigned URL flow first, then calls this endpoint.
Never add multipart parsing to this endpoint.

### 8. Public vendor-upload routes need tighter rate limiting
Add a specific `express-rate-limit` on the 3 public vendor-upload routes:
```js
const vendorUploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 })
router.use('/vendor-upload', vendorUploadLimiter)
```

### 9. Token generation
Use `crypto.randomBytes(32).toString('hex')` for all tokens.
This already matches the pattern used elsewhere in the codebase.

### 10. SMDT identity fields are immutable via PUT
`PUT /api/admin/smdt/:itemId` cannot change `partName`, `partColor`, or `category`.
These form the compound unique key. To change identity: deactivate the old item, create a new one.

### 11. Color normalization in SMDT matching
`'M '` and `'M'` are the same color in the file (trailing space vs no space).
Claude handles this in the matching prompt. The DB stores exactly what comes from the file after `cleanStr()`, so `'M '` is stored as `M ` (with trailing space). Claude is instructed to normalize on matching.

### 12. SMDT saveToSMDT from manual pricing teaches the database
When plant manually prices an unmatched BOM item and saves it to SMDT:
- The part is upserted into `SMDTItem` with `addedBy = req.user._id`
- Future BOM uploads for the same part will auto-match via Claude
- This is the self-improvement mechanism — the SMDT database grows from real usage


### 13. Packing List is the Truck Load Plan
Do not create `LoadingPlan` or `TruckLoad` models. In this implementation:
```txt
PackingListPlan = overall truck-load plan master
PackingList = one truck load / one packing list for one truck
```

### 14. Truck planning uses exactly two truck types
Only use:
```txt
SEMI_53     = 53 ft, 45,000 lbs safe capacity, 48,000 lbs hard max
HOTSHOT_40  = 40 ft, 18,000 lbs max
```

Mixed planning is allowed. Example: one semi for the main load and one hot shot for leftover small bundles.

### 15. Load planning is algorithm-generated, then plant-verified
Bundle grouping, stacking metadata, load sequence, warnings, and truck assignment are generated by deterministic backend rules first. Frontend must allow plant users to verify/edit before confirmation.

### 16. Do not use Claude for load planning
Claude may be used for messy PDF/Excel extraction only. Load planning uses structured data: category, length, weight, dimensions, bundle type, and truck capacity.

### 17. Hard capacity violations must be blocked
Warnings can be overridden with a reason. Hard violations cannot.
```txt
HOTSHOT_40 > 18,000 lbs = block
HOTSHOT_40 > 40 ft = block
SEMI_53 > 48,000 lbs = block
SEMI_53 > 53 ft = block
SEMI_53 > 45,000 lbs and <= 48,000 lbs = warning + override reason
```

### 18. Confirmed stage invalidation
If a confirmed BundlePlan is edited, any generated PackingListPlan and Delivery must be cancelled/reset. Otherwise the truck plan will be based on stale bundle data.
