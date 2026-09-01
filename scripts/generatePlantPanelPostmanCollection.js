#!/usr/bin/env node
/**
 * Generates plant-panel.postman_collection.json + plant-panel.postman_environment.json
 * Run: node scripts/generatePlantPanelPostmanCollection.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

const AUTH_HEADER = [{ key: 'Authorization', value: 'Bearer {{token}}' }]
const JSON_HEADER = [{ key: 'Content-Type', value: 'application/json' }]

function url(pathSegments, query = []) {
  const segs = Array.isArray(pathSegments) ? pathSegments : pathSegments.split('/').filter(Boolean)
  const raw = `{{baseUrl}}/${segs.join('/')}${query.length ? '?' + query.map((q) => `${q.key}=${q.value}`).join('&') : ''}`
  return {
    raw,
    host: ['{{baseUrl}}'],
    path: segs,
    ...(query.length ? { query } : {}),
  }
}

function exampleResponse(name, statusCode, body, req) {
  const statusText = statusCode === 200 ? 'OK' : statusCode === 201 ? 'Created' : statusCode === 404 ? 'Not Found' : statusCode === 403 ? 'Forbidden' : statusCode === 422 ? 'Unprocessable Entity' : 'Error'
  return {
    name,
    originalRequest: req,
    status: statusText,
    code: statusCode,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    cookie: [],
    body: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
  }
}

function envelope(data, message = 'Success') {
  return { success: true, message, data }
}

function errEnvelope(message, errors = []) {
  return { success: false, message, ...(errors.length ? { errors } : {}) }
}

function item(name, method, pathSegments, opts = {}) {
  const {
    body,
    query,
    auth = true,
    description,
    testScript,
    responses = [],
    noContentType,
  } = opts

  const headers = [...(body && !noContentType ? JSON_HEADER : []), ...(auth ? AUTH_HEADER : [])]
  const req = {
    method,
    header: headers,
    url: url(pathSegments, query),
    ...(description ? { description } : {}),
    ...(body ? { body: { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2) } } : {}),
  }

  const defaultResponses = responses.length
    ? responses
    : [
        exampleResponse(`${method === 'POST' || method === 'PUT' || method === 'PATCH' ? '200' : '200'} Success`, 200, envelope({}), req),
      ]

  const entry = { name, request: req, response: defaultResponses }
  if (testScript) {
    entry.event = [{ listen: 'test', script: { exec: testScript } }]
  }
  return entry
}

function folder(name, items, description) {
  return { name, ...(description ? { description } : {}), item: items }
}

// ── Shared sample IDs ────────────────────────────────────────────────────────
const IDS = {
  leadId: '665a00000000000000000002',
  buildingId: '665a00000000000000000010',
  jobId: '665a00000000000000000020',
  bomItemId: '665a00000000000000000021',
  vendorId: '665a00000000000000000030',
  carrierId: '665a00000000000000000040',
  requestId: '665a00000000000000000050',
  bundlePlanId: '665a00000000000000000060',
  bundleId: '665a00000000000000000061',
  packingListPlanId: '665a00000000000000000070',
  packingListId: '665a00000000000000000071',
  deliveryId: '665a00000000000000000080',
  bidId: '665a00000000000000000090',
  itemId: '665a00000000000000000091',
  customerId: '665a00000000000000000001',
}

const loginTest = [
  "const r = pm.response.json();",
  "if (r.data?.accessToken) {",
  "  pm.collectionVariables.set('token', r.data.accessToken);",
  "  pm.environment.set('token', r.data.accessToken);",
  "}",
  "if (r.data?.refreshToken) {",
  "  pm.collectionVariables.set('refreshToken', r.data.refreshToken);",
  "}",
]

// ── Collection folders ───────────────────────────────────────────────────────
const collectionItems = [
  folder('Auth (Shared)', [
    item('Login', 'POST', ['auth', 'login'], {
      auth: false,
      body: { email: 'plant@flyweis.test', password: 'Plant@1234' },
      description: 'Shared login for plant role. Saves accessToken to {{token}}.',
      testScript: loginTest,
      responses: [
        exampleResponse('200 Success', 200, envelope({
          accessToken: 'eyJhbGciOiJIUzI1NiIs.sample-access-token',
          refreshToken: 'eyJhbGciOiJIUzI1NiIs.sample-refresh-token',
          role: 'plant',
          user: { _id: '665a00000000000000000001', name: 'James Kowalski', email: 'plant@flyweis.test', role: 'plant' },
        }), {}),
        exampleResponse('401 Invalid credentials', 401, errEnvelope('Invalid email or password'), {}),
      ],
    }),
    item('Refresh Token', 'POST', ['auth', 'refresh'], {
      auth: false,
      body: { refreshToken: '{{refreshToken}}' },
      responses: [exampleResponse('200 Success', 200, envelope({ accessToken: 'eyJhbGciOiJIUzI1NiIs.new-access-token' }), {})],
    }),
    item('Logout', 'POST', ['auth', 'logout'], {
      auth: false,
      body: { refreshToken: '{{refreshToken}}' },
      responses: [exampleResponse('200 Success', 200, envelope(null, 'Logged out'), {})],
    }),
    item('Change Password', 'PUT', ['auth', 'change-password'], {
      body: { currentPassword: 'Plant@1234', newPassword: 'Plant@5678' },
      responses: [exampleResponse('200 Success', 200, envelope(null, 'Password updated'), {})],
    }),
  ]),

  folder('Upload (Shared)', [
    item('Get Presigned URL', 'POST', ['upload', 'presigned-url'], {
      body: { fileName: 'building1-v2.pdf', fileType: 'application/pdf', folder: 'drawings' },
      description: 'Step 1 of S3 upload flow. PUT file to uploadUrl, then register fileUrl on plant endpoint.',
      responses: [
        exampleResponse('200 Success', 200, envelope({
          uploadUrl: 'https://bucket.s3.region.amazonaws.com/drawings/uuid.pdf?X-Amz-...',
          fileUrl: 'https://bucket.s3.region.amazonaws.com/drawings/uuid.pdf',
          key: 'drawings/uuid.pdf',
        }), {}),
      ],
    }),
  ]),

  folder('Lookups (Shared)', [
    item('List Customers', 'GET', ['customers'], {
      query: [{ key: 'search', value: '' }, { key: 'page', value: '1' }, { key: 'limit', value: '20' }],
      responses: [exampleResponse('200 Success', 200, envelope({ customers: [], total: 0, page: 1, limit: 20 }), {})],
    }),
    item('List Leads', 'GET', ['leads'], {
      query: [{ key: 'search', value: '' }, { key: 'page', value: '1' }, { key: 'limit', value: '20' }],
      responses: [exampleResponse('200 Success', 200, envelope({ leads: [], total: 0, page: 1, limit: 20 }), {})],
    }),
  ]),

  folder('Notifications (Shared)', [
    item('Get Notifications', 'GET', ['notifications'], {
      responses: [exampleResponse('200 Success', 200, envelope({ notifications: [], unreadCount: 0 }), {})],
    }),
    item('Mark All Read', 'PUT', ['notifications', 'read-all'], {
      responses: [exampleResponse('200 Success', 200, envelope(null, 'All notifications marked read'), {})],
    }),
    item('Mark One Read', 'PUT', ['notifications', '{{notificationId}}', 'read'], {
      responses: [exampleResponse('200 Success', 200, envelope(null, 'Notification marked read'), {})],
    }),
    item('Delete Notification', 'DELETE', ['notifications', '{{notificationId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope(null, 'Notification deleted'), {})],
    }),
  ]),

  folder('SMDT (Shared — admin + plant)', [
    item('Upload SMDT Excel', 'POST', ['smdt', 'upload'], {
      body: { fileUrl: 'https://bucket.s3.amazonaws.com/smdt/cost-sheet.xlsx', fileName: 'cost-sheet.xlsx', activate: true },
      responses: [exampleResponse('200 Success', 200, envelope({ versionId: IDS.itemId, itemCount: 1250 }), {})],
    }),
    item('SMDT Stats', 'GET', ['smdt', 'stats'], {
      responses: [exampleResponse('200 Success', 200, envelope({ totalItems: 1250, activeItems: 1200, categories: 12 }), {})],
    }),
    item('Export SMDT Excel', 'GET', ['smdt', 'export', 'excel'], {
      query: [{ key: 'category', value: 'Panels' }],
      responses: [exampleResponse('200 Success', 200, envelope({ downloadUrl: 'https://bucket.s3.amazonaws.com/exports/smdt.xlsx' }), {})],
    }),
    item('List SMDT Items', 'GET', ['smdt'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }, { key: 'search', value: '' }],
      responses: [exampleResponse('200 Success', 200, envelope({ items: [], total: 0, page: 1, limit: 20 }), {})],
    }),
    item('Get SMDT Item', 'GET', ['smdt', '{{itemId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.itemId, partName: 'PBR Panel 26ga', category: 'Panels', mbsCost: 2.45, costUnit: 'FT' }), {})],
    }),
    item('Add SMDT Item', 'POST', ['smdt'], {
      body: { category: 'Panels', partName: 'PBR Panel 26ga', costUnit: 'FT', mbsCost: 2.45 },
      responses: [exampleResponse('201 Created', 201, envelope({ _id: IDS.itemId, partName: 'PBR Panel 26ga' }), {})],
    }),
    item('Update SMDT Item', 'PUT', ['smdt', '{{itemId}}'], {
      body: { mbsCost: 2.55, currentMarketCost: 2.60 },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.itemId, mbsCost: 2.55 }), {})],
    }),
    item('Deactivate SMDT Item', 'DELETE', ['smdt', '{{itemId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope(null, 'SMDT item deactivated'), {})],
    }),
  ]),

  folder('Projects', [
    item('Project Stats', 'GET', ['plant', 'projects', 'stats'], {
      query: [{ key: 'startDate', value: '2026-01-01' }, { key: 'endDate', value: '2026-05-31' }],
      responses: [exampleResponse('200 Success', 200, envelope({ totalProjects: 24, activeProjects: 18, pendingCustomerApproval: 4, cancelledProjects: 2 }), {})],
    }),
    item('List Projects', 'GET', ['plant', 'projects'], {
      query: [
        { key: 'page', value: '1' }, { key: 'limit', value: '20' },
        { key: 'drawingStatus', value: 'pending' },
      ],
      responses: [exampleResponse('200 Success', 200, envelope({
        projects: [{
          _id: IDS.leadId, projectName: 'ABC Warehouse', jobId: 'PRO-001', location: 'Texas, USA',
          clientName: 'John Smith', customer: { firstName: 'John', lastName: 'Smith' },
          buildingType: 'Commercial', numberOfBuildings: 3, quoteValue: 125000,
          drawingStatus: 'pending', bomStatus: 'partial', lifecycleStatus: 'released_to_plant',
          isTerminated: false, createdAt: '2025-01-15T00:00:00.000Z',
        }],
        total: 24, page: 1, limit: 20,
      }), {})],
    }),
    item('Project Detail', 'GET', ['plant', 'projects', '{{leadId}}', 'detail'], {
      responses: [exampleResponse('200 Success', 200, envelope({
        lead: { _id: IDS.leadId, projectName: 'ABC Warehouse' },
        projectName: 'ABC Warehouse', jobId: 'PRO-001', lifecycleStatus: 'released_to_plant',
        client: { customerId: IDS.customerId, firstName: 'John', lastName: 'Smith' },
        poOrder: { _id: '665a00000000000000000099', poNumber: 'PO-0001', status: 'approved' },
        activityLog: [],
      }), {})],
    }),
    item('Update Lifecycle', 'PUT', ['plant', 'projects', '{{leadId}}', 'lifecycle'], {
      body: { lifecycleStatus: 'fabrication_started', note: 'Optional note' },
      responses: [exampleResponse('200 Success', 200, envelope({ leadId: IDS.leadId, lifecycleStatus: 'fabrication_started' }), {})],
    }),
    item('Get Notes', 'GET', ['plant', 'projects', '{{leadId}}', 'notes'], {
      responses: [exampleResponse('200 Success', 200, envelope({ notes: [] }), {})],
    }),
    item('Add Note', 'POST', ['plant', 'projects', '{{leadId}}', 'notes'], {
      body: { note: 'Fabrication started on Building 1' },
      responses: [exampleResponse('201 Created', 201, envelope({ _id: '665a00000000000000000100', note: 'Fabrication started on Building 1' }), {})],
    }),
    item('Get Invoices', 'GET', ['plant', 'projects', '{{leadId}}', 'invoices'], {
      responses: [exampleResponse('200 Success', 200, envelope({ invoices: [] }), {})],
    }),
    item('Get Buildings', 'GET', ['plant', 'projects', '{{leadId}}', 'buildings'], {
      responses: [exampleResponse('200 Success', 200, envelope({
        buildings: [{ _id: IDS.buildingId, name: 'Building 1', status: 'drawing_pending', drawingCount: 0 }],
      }), {})],
    }),
    item('Upload Drawings', 'POST', ['plant', 'projects', '{{leadId}}', 'drawings'], {
      body: {
        drawings: [{ buildingId: IDS.buildingId, fileUrl: 'https://bucket.s3.amazonaws.com/drawings/uuid.pdf', fileName: 'building1-v2.pdf' }],
      },
      responses: [exampleResponse('201 Created', 201, envelope({ uploaded: 1 }), {})],
    }),
    item('Get Drawings', 'GET', ['plant', 'projects', '{{leadId}}', 'drawings'], {
      responses: [exampleResponse('200 Success', 200, envelope({ buildings: [] }), {})],
    }),
    item('Upload BOM Files', 'POST', ['plant', 'projects', '{{leadId}}', 'bom'], {
      body: {
        bomFiles: [{ buildingId: IDS.buildingId, fileUrl: 'https://bucket.s3.amazonaws.com/bom/uuid.out', fileName: 'building1.out', fileFormat: 'mbs_out' }],
      },
      responses: [exampleResponse('201 Created', 201, envelope({ jobs: [{ jobId: IDS.jobId, buildingId: IDS.buildingId, status: 'processing' }] }), {})],
    }),
    item('Get BOM Files', 'GET', ['plant', 'projects', '{{leadId}}', 'bom-files'], {
      responses: [exampleResponse('200 Success', 200, envelope({ buildings: [] }), {})],
    }),
    item('Generate Consolidated BOM', 'POST', ['plant', 'projects', '{{leadId}}', 'consolidated-bom', 'generate'], {
      responses: [exampleResponse('200 Success', 200, envelope({ status: 'generating' }), {})],
    }),
    item('Get Consolidated BOM', 'GET', ['plant', 'projects', '{{leadId}}', 'consolidated-bom'], {
      responses: [exampleResponse('200 Success', 200, envelope({ status: 'ready', groupedItems: [] }), {})],
    }),
    item('Send Consolidated BOM to Vendors', 'POST', ['plant', 'projects', '{{leadId}}', 'consolidated-bom', 'send'], {
      body: { vendorIds: [IDS.vendorId] },
      responses: [exampleResponse('200 Success', 200, envelope({ sentTo: 1 }), {})],
    }),
    item('Get Confirmed Delivery', 'GET', ['plant', 'projects', '{{leadId}}', 'delivery'], {
      responses: [exampleResponse('200 Success', 200, envelope({ delivery: null }), {})],
    }),
    item('Get Shipper Files', 'GET', ['plant', 'projects', '{{leadId}}', 'shipper-files'], {
      responses: [exampleResponse('200 Success', 200, envelope({ requests: [] }), {})],
    }),
    item('Get Bundle Plan (legacy)', 'GET', ['plant', 'projects', '{{leadId}}', 'bundle-plan'], {
      responses: [exampleResponse('200 Success', 200, envelope({ bundlePlan: null }), {})],
    }),
  ]),

  folder('Load Planning (Primary FE)', [
    item('Get Load Planning', 'GET', ['plant', 'projects', '{{leadId}}', 'load-planning'], {
      description: 'Primary FE endpoint — unified load + truck planning snapshot.',
      responses: [exampleResponse('200 Success', 200, envelope({ bundlePlan: null, packingListPlan: null, bundles: [], trucks: [] }), {})],
    }),
    item('Update Load Planning', 'PUT', ['plant', 'projects', '{{leadId}}', 'load-planning'], {
      body: {
        bundlePlanNotes: 'Handle with care',
        bundleUpdates: [{ bundleId: IDS.bundleId, loadSequence: 1, notes: 'Load first' }],
        packingListUpdates: [{ packingListId: IDS.packingListId, loadingNotes: 'Bottom layer panels' }],
      },
      responses: [exampleResponse('200 Success', 200, envelope({ updated: true }), {})],
    }),
    item('Load Planning Coverage', 'GET', ['plant', 'projects', '{{leadId}}', 'load-planning', 'coverage'], {
      responses: [exampleResponse('200 Success', 200, envelope({ totalLines: 100, assignedLines: 95, canConfirm: false }), {})],
    }),
    item('Confirm Bundles', 'POST', ['plant', 'projects', '{{leadId}}', 'load-planning', 'confirm-bundles'], {
      responses: [exampleResponse('200 Success', 200, envelope({ status: 'confirmed' }), {})],
    }),
    item('Generate Truck Plan', 'POST', ['plant', 'projects', '{{leadId}}', 'load-planning', 'generate-truck-plan'], {
      responses: [exampleResponse('200 Success', 200, envelope({ packingListPlanId: IDS.packingListPlanId }), {})],
    }),
    item('Get Truck Plan', 'GET', ['plant', 'projects', '{{leadId}}', 'load-planning', 'truck-plan'], {
      responses: [exampleResponse('200 Success', 200, envelope({ trucks: [], bundles: [] }), {})],
    }),
    item('Confirm Truck Plan', 'POST', ['plant', 'projects', '{{leadId}}', 'load-planning', 'truck-plan', 'confirm'], {
      responses: [exampleResponse('200 Success', 200, envelope({ status: 'confirmed' }), {})],
    }),
    item('Update Truck Row', 'PUT', ['plant', 'projects', '{{leadId}}', 'load-planning', 'trucks', '{{packingListId}}'], {
      body: {
        truckType: 'flatbed_48',
        bundleIds: [IDS.bundleId],
        loadLayout: { bottomLayerBundleIds: [IDS.bundleId], middleLayerBundleIds: [], topLayerBundleIds: [] },
        loadingNotes: 'Secure with straps',
      },
      responses: [exampleResponse('200 Success', 200, envelope({ packingListId: IDS.packingListId }), {})],
    }),
    item('Freight Autofill (by project)', 'GET', ['plant', 'projects', '{{leadId}}', 'freight-autofill'], {
      responses: [exampleResponse('200 Success', 200, envelope({ weight: 12500, packageCount: 8, dimensions: { lengthFeet: 48, widthFeet: 8.5, heightFeet: 10 } }), {})],
    }),
    item('Send Freight Bids (by project)', 'POST', ['plant', 'projects', '{{leadId}}', 'freight', 'send-bids'], {
      body: { carrierIds: [IDS.carrierId], bidDeadline: '2026-06-30T23:59:59.000Z' },
      responses: [exampleResponse('200 Success', 200, envelope({ sentTo: 1 }), {})],
    }),
    item('Get Freight Bids (by project)', 'GET', ['plant', 'projects', '{{leadId}}', 'freight', 'bids'], {
      query: [{ key: 'sort', value: 'low_to_high' }],
      responses: [exampleResponse('200 Success', 200, envelope({ delivery: {}, bids: [], stats: { total: 0, submitted: 0 } }), {})],
    }),
    item('Load Planning Projects List', 'GET', ['plant', 'load-planning', 'projects'], {
      responses: [exampleResponse('200 Success', 200, envelope({ projects: [] }), {})],
    }),
  ]),

  folder('BOM', [
    item('BOM Stats', 'GET', ['plant', 'bom', 'stats'], {
      responses: [exampleResponse('200 Success', 200, envelope({ totalProjects: 10, pendingExtraction: 2, readyForReview: 3, allConfirmed: 5 }), {})],
    }),
    item('BOM Project List', 'GET', ['plant', 'bom', 'projects'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }],
      responses: [exampleResponse('200 Success', 200, envelope({ projects: [], total: 0, page: 1, limit: 20 }), {})],
    }),
    item('Consolidated BOM URL', 'GET', ['plant', 'bom', 'projects', '{{leadId}}', 'consolidated-url'], {
      responses: [exampleResponse('200 Success', 200, envelope({ ready: true, fileUrl: 'https://bucket.s3.amazonaws.com/bom/consolidated.xlsx' }), {})],
    }),
    item('Batch Job Status', 'POST', ['plant', 'bom', 'jobs', 'status'], {
      body: { jobIds: [IDS.jobId] },
      responses: [exampleResponse('200 Success', 200, envelope({ jobs: [{ jobId: IDS.jobId, status: 'completed' }] }), {})],
    }),
    item('Job Status', 'GET', ['plant', 'bom', 'job', '{{jobId}}', 'status'], {
      responses: [exampleResponse('200 Success', 200, envelope({ jobId: IDS.jobId, status: 'completed', progress: 100 }), {})],
    }),
    item('Get BOM Job Detail', 'GET', ['plant', 'bom', '{{jobId}}'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '50' }],
      responses: [exampleResponse('200 Success', 200, envelope({ job: { _id: IDS.jobId, status: 'completed' }, items: [], total: 0 }), {})],
    }),
    item('Price BOM Item', 'PUT', ['plant', 'bom', 'items', '{{bomItemId}}', 'price'], {
      body: { manualUnitCost: 12.50, saveToSMDT: true },
      responses: [exampleResponse('200 Success', 200, envelope({ bomItemId: IDS.bomItemId, manualUnitCost: 12.50 }), {})],
    }),
    item('Confirm Building BOM', 'POST', ['plant', 'bom', 'buildings', '{{buildingId}}', 'confirm'], {
      responses: [exampleResponse('200 Success', 200, envelope({ buildingId: IDS.buildingId, status: 'confirmed' }), {})],
    }),
  ]),

  folder('Shipper Files', [
    item('Shipper Stats', 'GET', ['plant', 'shipper-files', 'stats'], {
      responses: [exampleResponse('200 Success', 200, envelope({ totalProjects: 5, pendingComparison: 2, approved: 3 }), {})],
    }),
    item('Shipper Projects', 'GET', ['plant', 'shipper-files', 'projects'], {
      responses: [exampleResponse('200 Success', 200, envelope({ projects: [] }), {})],
    }),
    item('Project Shipper Stats', 'GET', ['plant', 'shipper-files', 'projects', '{{leadId}}', 'stats'], {
      responses: [exampleResponse('200 Success', 200, envelope({ totalRequests: 3, received: 2, pending: 1 }), {})],
    }),
    item('Project Shipper Requests', 'GET', ['plant', 'shipper-files', 'projects', '{{leadId}}', 'requests'], {
      responses: [exampleResponse('200 Success', 200, envelope({ requests: [], stats: {} }), {})],
    }),
  ]),

  folder('Shipper Requests / Comparison', [
    item('Get Document', 'GET', ['plant', 'shipper-requests', '{{requestId}}', 'document'], {
      responses: [exampleResponse('200 Success', 200, envelope({ request: {}, document: {} }), {})],
    }),
    item('Start Comparison', 'POST', ['plant', 'shipper-requests', '{{requestId}}', 'compare'], {
      responses: [exampleResponse('200 Success', 200, envelope({ jobId: IDS.jobId, status: 'processing' }), {})],
    }),
    item('Comparison Job Status', 'GET', ['plant', 'shipper-requests', 'compare-jobs', '{{jobId}}', 'status'], {
      responses: [exampleResponse('200 Success', 200, envelope({ jobId: IDS.jobId, status: 'completed' }), {})],
    }),
    item('Batch Comparison Job Status', 'POST', ['plant', 'shipper-requests', 'compare-jobs', 'status'], {
      body: { jobIds: [IDS.jobId] },
      responses: [exampleResponse('200 Success', 200, envelope({ jobs: [{ jobId: IDS.jobId, status: 'completed' }] }), {})],
    }),
    item('Approve Request', 'POST', ['plant', 'shipper-requests', '{{requestId}}', 'approve'], {
      responses: [exampleResponse('200 Success', 200, envelope({ requestId: IDS.requestId, status: 'approved' }), {})],
    }),
    item('Request Resubmit', 'POST', ['plant', 'shipper-requests', '{{requestId}}', 'request-resubmit'], {
      body: { note: 'Please fix line 42 pricing', includeComparisonExceptions: true },
      responses: [exampleResponse('200 Success', 200, envelope({ status: 'resubmit_requested' }), {})],
    }),
    item('Comparison Summary', 'GET', ['plant', 'shipper-requests', '{{requestId}}', 'comparison-summary'], {
      responses: [exampleResponse('200 Success', 200, envelope({ matched: 120, unmatched: 5, canProceedToApproval: true, items: [] }), {})],
    }),
    item('Comparison Results', 'GET', ['plant', 'shipper-requests', '{{requestId}}', 'comparison-results'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '50' }, { key: 'category', value: 'all' }],
      responses: [exampleResponse('200 Success', 200, envelope({ results: [], total: 0, page: 1, limit: 50 }), {})],
    }),
    item('Generate Bundle Plan', 'POST', ['plant', 'shipper-requests', '{{requestId}}', 'bundle-plan', 'generate'], {
      responses: [exampleResponse('200 Success', 200, envelope({ bundlePlanId: IDS.bundlePlanId }), {})],
    }),
  ]),

  folder('Bundle Plans (Legacy)', [
    item('Get Bundle Plan', 'GET', ['plant', 'bundle-plans', '{{bundlePlanId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.bundlePlanId, status: 'draft', bundles: [] }), {})],
    }),
    item('Update Bundle Plan', 'PUT', ['plant', 'bundle-plans', '{{bundlePlanId}}'], {
      body: { notes: 'Updated notes' },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.bundlePlanId, notes: 'Updated notes' }), {})],
    }),
    item('Bundle Plan Coverage', 'GET', ['plant', 'bundle-plans', '{{bundlePlanId}}', 'coverage'], {
      responses: [exampleResponse('200 Success', 200, envelope({ totalLines: 100, assignedLines: 80 }), {})],
    }),
    item('Confirm Bundle Plan', 'POST', ['plant', 'bundle-plans', '{{bundlePlanId}}', 'confirm'], {
      responses: [exampleResponse('200 Success', 200, envelope({ status: 'confirmed' }), {})],
    }),
    item('Create Bundle', 'POST', ['plant', 'bundle-plans', '{{bundlePlanId}}', 'bundles'], {
      body: { bundleType: 'panels', title: 'Panel Bundle A', notes: 'Fragile' },
      responses: [exampleResponse('201 Created', 201, envelope({ _id: IDS.bundleId, bundleType: 'panels' }), {})],
    }),
    item('Generate Packing List Plan', 'POST', ['plant', 'bundle-plans', '{{bundlePlanId}}', 'packing-list-plan', 'generate'], {
      responses: [exampleResponse('200 Success', 200, envelope({ packingListPlanId: IDS.packingListPlanId }), {})],
    }),
    item('Freight Autofill (by bundle plan)', 'GET', ['plant', 'bundle-plans', '{{bundlePlanId}}', 'freight-autofill'], {
      responses: [exampleResponse('200 Success', 200, envelope({ weight: 8500, packageCount: 5 }), {})],
    }),
  ]),

  folder('Bundles', [
    item('Get Bundle (auth)', 'GET', ['plant', 'bundles', '{{bundleId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.bundleId, bundleType: 'panels', items: [] }), {})],
    }),
    item('Get Bundle (public — no auth)', 'GET', ['plant', 'bundles', '{{bundleId}}'], {
      auth: false,
      description: 'Public read — no JWT required.',
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.bundleId, bundleType: 'panels', items: [] }), {})],
    }),
    item('Update Bundle', 'PUT', ['plant', 'bundles', '{{bundleId}}'], {
      body: {
        title: 'Panel Bundle A',
        loadSequence: 1,
        items: [{ partCode: 'PBR-26', qty: 10, weight: 250 }],
        stacking: { stackLevel: 'bottom', isFragile: true },
      },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.bundleId, loadSequence: 1 }), {})],
    }),
    item('Delete Bundle', 'DELETE', ['plant', 'bundles', '{{bundleId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope(null, 'Bundle deleted'), {})],
    }),
  ]),

  folder('Packing List Plans (Legacy)', [
    item('Get Packing List Plan (auth)', 'GET', ['plant', 'packing-list-plans', '{{packingListPlanId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.packingListPlanId, trucks: [], bundles: [] }), {})],
    }),
    item('Get Packing List Plan (public — no auth)', 'GET', ['plant', 'packing-list-plans', '{{packingListPlanId}}'], {
      auth: false,
      description: 'Public read — no JWT required.',
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.packingListPlanId, trucks: [] }), {})],
    }),
    item('Confirm Packing List Plan', 'POST', ['plant', 'packing-list-plans', '{{packingListPlanId}}', 'confirm'], {
      responses: [exampleResponse('200 Success', 200, envelope({ status: 'confirmed' }), {})],
    }),
  ]),

  folder('Packing Lists (Legacy)', [
    item('Packing List Projects', 'GET', ['plant', 'packing-lists', 'projects'], {
      responses: [exampleResponse('200 Success', 200, envelope({ projects: [] }), {})],
    }),
    item('Get Packing List', 'GET', ['plant', 'packing-lists', '{{packingListId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.packingListId, truckType: 'flatbed_48', bundles: [] }), {})],
    }),
    item('Update Packing List', 'PUT', ['plant', 'packing-lists', '{{packingListId}}'], {
      body: { truckType: 'flatbed_48', bundleIds: [IDS.bundleId], loadingNotes: 'Load panels first' },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.packingListId }), {})],
    }),
  ]),

  folder('Deliveries / Freight', [
    item('Freight Stats', 'GET', ['plant', 'deliveries', 'freight', 'stats'], {
      responses: [exampleResponse('200 Success', 200, envelope({ total: 10, requested: 2, pending: 3, inTransit: 1, delivered: 4, totalSpent: 45000 }), {})],
    }),
    item('Freight Loads List', 'GET', ['plant', 'deliveries', 'freight'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }],
      responses: [exampleResponse('200 Success', 200, envelope({ deliveries: [], total: 0, page: 1, limit: 20 }), {})],
    }),
    item('Awarded Stats', 'GET', ['plant', 'deliveries', 'awarded', 'stats'], {
      responses: [exampleResponse('200 Success', 200, envelope({ total: 5, inTransit: 1, delivered: 4 }), {})],
    }),
    item('Awarded Loads List', 'GET', ['plant', 'deliveries', 'awarded'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }],
      responses: [exampleResponse('200 Success', 200, envelope({ deliveries: [], total: 0 }), {})],
    }),
    item('Delivery Calendar', 'GET', ['plant', 'deliveries', 'calendar'], {
      query: [{ key: 'fromDate', value: '2026-06-01' }, { key: 'toDate', value: '2026-06-30' }],
      responses: [exampleResponse('200 Success', 200, envelope({ calendar: [] }), {})],
    }),
    item('All Delivery Stats', 'GET', ['plant', 'deliveries', 'stats'], {
      responses: [exampleResponse('200 Success', 200, envelope({ scheduled: 2, confirmed: 3, inTransit: 1, delivered: 4, cancelled: 0 }), {})],
    }),
    item('All Deliveries List', 'GET', ['plant', 'deliveries'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }, { key: 'status', value: 'scheduled' }],
      responses: [exampleResponse('200 Success', 200, envelope({ deliveries: [], total: 0, page: 1, limit: 20 }), {})],
    }),
    item('Project Deliveries', 'GET', ['plant', 'deliveries', 'project', '{{leadId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope({ deliveries: [] }), {})],
    }),
    item('Delivery Detail', 'GET', ['plant', 'deliveries', '{{deliveryId}}', 'detail'], {
      responses: [exampleResponse('200 Success', 200, envelope({
        delivery: { _id: IDS.deliveryId, status: 'scheduled', leadId: IDS.leadId },
        project: {}, customer: {}, carrier: null, history: [],
      }), {})],
    }),
    item('Create Delivery', 'POST', ['plant', 'deliveries'], {
      body: {
        leadId: IDS.leadId,
        description: 'Steel building materials delivery',
        weight: 12500,
        dimensions: { lengthFeet: 48, widthFeet: 8.5, heightFeet: 10 },
        packageCount: 8,
        pickupLocation: 'Plant Yard, Dallas TX',
        deliveryLocation: '123 Main St, Austin TX',
        pickupDate: '2026-07-01T08:00:00.000Z',
        deliveryDate: '2026-07-02T14:00:00.000Z',
        bidDeadline: '2026-06-25T23:59:59.000Z',
      },
      responses: [exampleResponse('201 Created', 201, envelope({ _id: IDS.deliveryId, status: 'draft' }), {})],
    }),
    item('Update Delivery', 'PUT', ['plant', 'deliveries', '{{deliveryId}}'], {
      body: { description: 'Updated load description', weight: 13000 },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.deliveryId }), {})],
    }),
    item('Send Bids (by delivery)', 'POST', ['plant', 'deliveries', '{{deliveryId}}', 'send-bids'], {
      body: { carrierIds: [IDS.carrierId], bidDeadline: '2026-06-30T23:59:59.000Z' },
      responses: [exampleResponse('200 Success', 200, envelope({ sentTo: 1 }), {})],
    }),
    item('Get Bids (by delivery)', 'GET', ['plant', 'deliveries', '{{deliveryId}}', 'bids'], {
      query: [{ key: 'sort', value: 'low_to_high' }],
      responses: [exampleResponse('200 Success', 200, envelope({ bids: [], stats: { total: 0, submitted: 0 } }), {})],
    }),
    item('Reschedule Delivery', 'PATCH', ['plant', 'deliveries', '{{deliveryId}}', 'reschedule'], {
      body: {
        date: '2026-07-05T00:00:00.000Z',
        timeWindowStart: '08:00',
        timeWindowEnd: '12:00',
        rescheduleReason: 'Customer requested later date',
      },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.deliveryId, status: 'rescheduled' }), {})],
    }),
    item('Update Delivery Status', 'PATCH', ['plant', 'deliveries', '{{deliveryId}}', 'status'], {
      body: { status: 'in_transit' },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.deliveryId, status: 'in_transit' }), {})],
    }),
  ]),

  folder('Freight Bids', [
    item('Select Bid (Award)', 'POST', ['plant', 'freight-bids', '{{bidId}}', 'select'], {
      responses: [exampleResponse('200 Success', 200, envelope({ bidId: IDS.bidId, status: 'awarded' }), {})],
    }),
    item('Request Bid Resubmit', 'POST', ['plant', 'freight-bids', '{{bidId}}', 'request-resubmit'], {
      body: { note: 'Please revise — target is $2,800', bidAmount: 2800 },
      responses: [exampleResponse('200 Success', 200, envelope({ status: 'resubmit_requested' }), {})],
    }),
  ]),

  folder('Vendors', [
    item('List Vendors', 'GET', ['plant', 'vendors'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }, { key: 'status', value: 'active' }],
      responses: [exampleResponse('200 Success', 200, envelope({ vendors: [], total: 0, page: 1, limit: 20 }), {})],
    }),
    item('Create Vendor', 'POST', ['plant', 'vendors'], {
      body: {
        vendorName: 'Steel Supply Co',
        email: 'quotes@steelsupply.com',
        phone: '+15551234567',
        contactName: 'Mike Johnson',
        vendorType: 'steel',
        materialTypes: ['panels', 'trim'],
        address: { city: 'Dallas', state: 'TX', postalCode: '75201' },
      },
      responses: [exampleResponse('201 Created', 201, envelope({ _id: IDS.vendorId, vendorName: 'Steel Supply Co', status: 'active' }), {})],
    }),
    item('Vendor Detail', 'GET', ['plant', 'vendors', '{{vendorId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.vendorId, vendorName: 'Steel Supply Co', stats: {}, orderHistory: [] }), {})],
    }),
    item('Update Vendor', 'PUT', ['plant', 'vendors', '{{vendorId}}'], {
      body: { vendorName: 'Steel Supply Co (Updated)', phone: '+15559876543' },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.vendorId }), {})],
    }),
    item('Toggle Vendor Status', 'PATCH', ['plant', 'vendors', '{{vendorId}}', 'toggle-status'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.vendorId, status: 'inactive' }), {})],
    }),
  ]),

  folder('Carriers', [
    item('List Carriers', 'GET', ['plant', 'carriers'], {
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }, { key: 'status', value: 'active' }],
      responses: [exampleResponse('200 Success', 200, envelope({ carriers: [], total: 0, page: 1, limit: 20 }), {})],
    }),
    item('Create Carrier', 'POST', ['plant', 'carriers'], {
      body: {
        carrierName: 'FastFreight Logistics',
        email: 'dispatch@fastfreight.com',
        phone: '+15557654321',
        contactName: 'Sarah Lee',
        serviceType: 'flatbed',
        serviceArea: 'TX, OK, LA',
        fleetCapacity: { totalVehicleCount: 25, maximumLoadCapacity: 48000 },
      },
      responses: [exampleResponse('201 Created', 201, envelope({ _id: IDS.carrierId, carrierName: 'FastFreight Logistics', status: 'active' }), {})],
    }),
    item('Carrier Detail', 'GET', ['plant', 'carriers', '{{carrierId}}'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.carrierId, carrierName: 'FastFreight Logistics', stats: {}, freightHistory: [] }), {})],
    }),
    item('Update Carrier', 'PUT', ['plant', 'carriers', '{{carrierId}}'], {
      body: { carrierName: 'FastFreight Logistics (Updated)', serviceArea: 'TX, OK, LA, AR' },
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.carrierId }), {})],
    }),
    item('Toggle Carrier Status', 'PATCH', ['plant', 'carriers', '{{carrierId}}', 'toggle-status'], {
      responses: [exampleResponse('200 Success', 200, envelope({ _id: IDS.carrierId, status: 'inactive' }), {})],
    }),
  ]),
]

// Fix response originalRequest references (need full request object)
function attachOriginalRequests(items) {
  for (const entry of items) {
    if (entry.item) {
      attachOriginalRequests(entry.item)
    } else if (entry.response) {
      for (const resp of entry.response) {
        if (!resp.originalRequest || Object.keys(resp.originalRequest).length === 0) {
          resp.originalRequest = entry.request
        }
      }
    }
  }
}
attachOriginalRequests(collectionItems)

const collection = {
  info: {
    name: 'Mr Storage — Plant Panel API',
    _postman_id: 'plant-panel-v1',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description: [
      'Plant Panel API reference for Mr Storage Backend (`role: "plant"`).',
      '',
      '**Import:** File → Import → select this JSON + `plant-panel.postman_environment.json`',
      '',
      '**Auth flow:**',
      '1. Run **Login** — saves `accessToken` to `{{token}}`',
      '2. All `/plant/*` routes use `Authorization: Bearer {{token}}`',
      '',
      '**Response envelope:**',
      '```json',
      '{ "success": true|false, "message": "...", "data": { ... } }',
      '```',
      '',
      'Each request includes **saved example responses** (200/201/4xx) for app integration.',
      '',
      '**Test account (after seed):** `plant@flyweis.test` / `Plant@1234`',
      '',
      '**Docs:** `docs/plant-panel-api.md`',
    ].join('\n'),
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000/api', type: 'string' },
    { key: 'token', value: '', type: 'string' },
    { key: 'refreshToken', value: '', type: 'string' },
    { key: 'leadId', value: IDS.leadId, type: 'string', description: 'Project / lead MongoDB _id' },
    { key: 'buildingId', value: IDS.buildingId, type: 'string' },
    { key: 'jobId', value: IDS.jobId, type: 'string', description: 'BOM or comparison job _id' },
    { key: 'bomItemId', value: IDS.bomItemId, type: 'string' },
    { key: 'vendorId', value: IDS.vendorId, type: 'string' },
    { key: 'carrierId', value: IDS.carrierId, type: 'string' },
    { key: 'requestId', value: IDS.requestId, type: 'string', description: 'Shipper request _id' },
    { key: 'bundlePlanId', value: IDS.bundlePlanId, type: 'string' },
    { key: 'bundleId', value: IDS.bundleId, type: 'string' },
    { key: 'packingListPlanId', value: IDS.packingListPlanId, type: 'string' },
    { key: 'packingListId', value: IDS.packingListId, type: 'string' },
    { key: 'deliveryId', value: IDS.deliveryId, type: 'string' },
    { key: 'bidId', value: IDS.bidId, type: 'string', description: 'Freight bid _id' },
    { key: 'itemId', value: IDS.itemId, type: 'string', description: 'SMDT item _id' },
    { key: 'notificationId', value: '', type: 'string' },
    { key: 'customerId', value: IDS.customerId, type: 'string' },
  ],
  item: collectionItems,
}

const environment = {
  id: 'plant-panel-env',
  name: 'Plant Panel — Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:5000/api', type: 'default', enabled: true },
    { key: 'token', value: '', type: 'secret', enabled: true },
    { key: 'refreshToken', value: '', type: 'secret', enabled: true },
    { key: 'leadId', value: IDS.leadId, type: 'default', enabled: true },
    { key: 'buildingId', value: IDS.buildingId, type: 'default', enabled: true },
    { key: 'jobId', value: IDS.jobId, type: 'default', enabled: true },
    { key: 'bomItemId', value: IDS.bomItemId, type: 'default', enabled: true },
    { key: 'vendorId', value: IDS.vendorId, type: 'default', enabled: true },
    { key: 'carrierId', value: IDS.carrierId, type: 'default', enabled: true },
    { key: 'requestId', value: IDS.requestId, type: 'default', enabled: true },
    { key: 'bundlePlanId', value: IDS.bundlePlanId, type: 'default', enabled: true },
    { key: 'bundleId', value: IDS.bundleId, type: 'default', enabled: true },
    { key: 'packingListPlanId', value: IDS.packingListPlanId, type: 'default', enabled: true },
    { key: 'packingListId', value: IDS.packingListId, type: 'default', enabled: true },
    { key: 'deliveryId', value: IDS.deliveryId, type: 'default', enabled: true },
    { key: 'bidId', value: IDS.bidId, type: 'default', enabled: true },
    { key: 'itemId', value: IDS.itemId, type: 'default', enabled: true },
    { key: 'notificationId', value: '', type: 'default', enabled: true },
    { key: 'customerId', value: IDS.customerId, type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
}

const collectionPath = path.join(ROOT, 'plant-panel.postman_collection.json')
const envPath = path.join(ROOT, 'plant-panel.postman_environment.json')

fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2))
fs.writeFileSync(envPath, JSON.stringify(environment, null, 2))

const countRequests = (items) => items.reduce((n, i) => n + (i.item ? countRequests(i.item) : 1), 0)
console.log(`Generated ${collectionPath}`)
console.log(`Generated ${envPath}`)
console.log(`Total requests: ${countRequests(collectionItems)}`)
