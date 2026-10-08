/**
 * Generates construction-panel.postman_collection.json from route definitions.
 * Run: node scripts/build-construction-postman.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'construction-panel.postman_collection.json')

const SUCCESS = (data, message = '') =>
  JSON.stringify({ success: true, message, data }, null, 2)

const authHeader = () => [{ key: 'Authorization', value: 'Bearer {{token}}' }]
const jsonHeader = () => [
  { key: 'Content-Type', value: 'application/json' },
  ...authHeader(),
]

function url(pathSegments, query = []) {
  const segs = pathSegments.filter(Boolean)
  const rawPath = segs.join('/')
  const q = query
    .filter((x) => x && !x.disabled)
    .map((x) => `${encodeURIComponent(x.key)}=${encodeURIComponent(x.value ?? '')}`)
    .join('&')
  return {
    raw: `{{baseUrl}}/${rawPath}${q ? `?${q}` : ''}`,
    host: ['{{baseUrl}}'],
    path: segs,
    ...(query.length ? { query } : {}),
  }
}

function req(method, pathSegments, opts = {}) {
  const { query = [], body, description, headers = authHeader() } = opts
  const r = {
    method,
    header: headers,
    url: url(pathSegments, query),
    description: description || '',
  }
  if (body != null) {
    r.body = { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2) }
  }
  return r
}

function exampleResponse(name, code, bodyObj, status = 'OK') {
  return {
    name,
    originalRequest: { method: 'GET', header: [], url: { raw: '' } },
    status,
    code,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj, null, 2),
  }
}

function item(name, request, responses = []) {
  return { name, request, response: responses }
}

function folder(name, items, description = '') {
  return { name, description, item: items }
}

const q = (key, value, description, disabled = true) => ({
  key,
  value: value ?? '',
  description: description || '',
  disabled,
})

// ─── Endpoint groups ───────────────────────────────────────────────────────

const authFolder = folder('Auth', [
  item(
    'Login (construction user)',
    req('POST', ['auth', 'login'], {
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: {
        email: 'construction@example.com',
        password: 'your-password',
      },
      description: 'Returns accessToken in data.accessToken. Use role construction or admin.',
    }),
    [
      exampleResponse('200 Login', 200, {
        success: true,
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…',
          user: { _id: '68e…', name: 'Site Engineer', email: 'construction@example.com', role: 'construction' },
        },
      }),
    ]
  ),
])

const dashboardFolder = folder('Dashboard', [
  item(
    'Get Dashboard',
    req('GET', ['construction', 'dashboard'], {
      query: [q('businessUnit', '', 'Optional business unit filter', true)],
      description: 'KPIs: projectStats, deliveryOverview, taskOverview, upcomingDeadlines, recentDeliveries.',
    }),
    [
      exampleResponse('200 Dashboard', 200, {
        success: true,
        data: {
          projectStats: { total: 12, onTrack: 8, delayed: 2, completed: 2, completionRate: 67 },
          deliveryOverview: { inTransit: 3, staged: 1, ready: 2 },
          taskOverview: { todo: 5, inProgress: 3, done: 20, overdue: 1 },
        },
      }),
    ]
  ),
  item(
    'Get Dashboard Filters',
    req('GET', ['construction', 'dashboard', 'filters']),
    [
      exampleResponse('200 Filters', 200, {
        success: true,
        data: { businessUnits: ['SM', 'SBD'], priorities: ['low', 'medium', 'high'] },
      }),
    ]
  ),
])

const projectsFolder = folder('Projects & Calendar', [
  item(
    'List Projects',
    req('GET', ['construction', 'projects'], {
      query: [
        q('page', '1', 'Page number', false),
        q('limit', '20', 'Page size', false),
        q('search', '', 'projectName or jobId (substring)', true),
        q('status', '', `lifecycleStatus — construction/plant stages only`, true),
        q('priority', '', 'low | medium | high', true),
        q('hasDelivery', 'true', 'If true, only projects with non-draft deliveries', true),
        q('businessUnit', '', 'Business unit filter', true),
      ],
    }),
    [
      exampleResponse('200 Projects', 200, {
        success: true,
        data: {
          projects: [{ _id: '{{leadId}}', projectName: 'Downtown Office', jobId: 'PRO-031', lifecycleStatus: 'construction' }],
          total: 1,
          page: 1,
          limit: 20,
          scope: 'construction',
        },
      }),
    ]
  ),
  item(
    'Project Calendar',
    req('GET', ['construction', 'projects', 'calendar'], {
      query: [
        q('startDate', '2026-01-01', 'ISO date', true),
        q('endDate', '2026-12-31', 'ISO date', true),
        q('businessUnit', '', '', true),
      ],
    })
  ),
  item('Get Project Detail', req('GET', ['construction', 'projects', '{{leadId}}'])),
  item(
    'Get Project Progress',
    req('GET', ['construction', 'projects', '{{leadId}}', 'progress'])
  ),
  item(
    'Create Milestone',
    req('POST', ['construction', 'projects', '{{leadId}}', 'milestones'], {
      headers: jsonHeader(),
      body: {
        title: 'Foundation complete',
        targetDate: '2026-06-01',
        description: 'Pour and cure complete',
        status: 'pending',
      },
    })
  ),
])

const manufacturingFolder = folder(
  'Project Manufacturing (read-only plant data)',
  [
    item('BOM Files', req('GET', ['construction', 'projects', '{{leadId}}', 'bom-files'])),
    item('Consolidated BOM', req('GET', ['construction', 'projects', '{{leadId}}', 'consolidated-bom'])),
    item('Consolidated BOM URL', req('GET', ['construction', 'projects', '{{leadId}}', 'bom', 'consolidated-url'])),
    item('BOM Job Detail', req('GET', ['construction', 'projects', '{{leadId}}', 'bom', 'jobs', '{{jobId}}'])),
    item('BOM Job Status', req('GET', ['construction', 'projects', '{{leadId}}', 'bom', 'jobs', '{{jobId}}', 'status'])),
    item('Building Drawings (plant)', req('GET', ['construction', 'projects', '{{leadId}}', 'building-drawings'])),
    item(
      'Photos & Videos (project)',
      req('GET', ['construction', 'projects', '{{leadId}}', 'photos-videos'], {
        query: [q('type', 'photo', 'photo | video', true)],
      })
    ),
    item('Material Delivery (confirmed)', req('GET', ['construction', 'projects', '{{leadId}}', 'material-delivery'])),
    item('Material Deliveries List', req('GET', ['construction', 'projects', '{{leadId}}', 'material-deliveries'])),
    item(
      'Material Delivery Detail',
      req('GET', ['construction', 'projects', '{{leadId}}', 'material-deliveries', '{{deliveryId}}', 'detail'])
    ),
    item(
      'Material Delivery Documents',
      req('GET', ['construction', 'projects', '{{leadId}}', 'material-deliveries', '{{deliveryId}}', 'documents'])
    ),
    item(
      'Download Delivery PDF',
      req('GET', ['construction', 'projects', '{{leadId}}', 'material-deliveries', '{{deliveryId}}', 'download'])
    ),
    item(
      'Download Delivery Instructions PDF',
      req('GET', ['construction', 'projects', '{{leadId}}', 'material-deliveries', '{{deliveryId}}', 'download', 'instructions'])
    ),
    item(
      'Download Plant Packing List PDF',
      req('GET', ['construction', 'projects', '{{leadId}}', 'material-deliveries', '{{deliveryId}}', 'download', 'packing-list'])
    ),
    item('Bundle Plan', req('GET', ['construction', 'projects', '{{leadId}}', 'bundle-plan'])),
    item('Bundle Detail (plant)', req('GET', ['construction', 'projects', '{{leadId}}', 'bundles', '{{bundleId}}'])),
    item('Truck / Packing Plan', req('GET', ['construction', 'projects', '{{leadId}}', 'truck-plan'])),
    item(
      'Packing List (plant)',
      req('GET', ['construction', 'projects', '{{leadId}}', 'packing-lists', '{{packingListId}}'])
    ),
    item(
      'Packing List PDF (plant)',
      req('GET', ['construction', 'projects', '{{leadId}}', 'packing-lists', '{{packingListId}}', 'download-pdf'])
    ),
    item(
      'Structural Drawing — Get',
      req('GET', ['construction', 'projects', '{{leadId}}', 'structural-drawing'])
    ),
    item(
      'Structural Drawing — Upload',
      req('POST', ['construction', 'projects', '{{leadId}}', 'structural-drawing'], {
        headers: jsonHeader(),
        body: {
          name: 'Foundation Plan Rev A.pdf',
          fileUrl: 'https://bucket.s3.amazonaws.com/documents/uuid.pdf',
          fileType: 'application/pdf',
          fileSize: 2400000,
          buildingLabel: 'Building A',
          notes: '',
        },
      })
    ),
  ],
  'Scoped to approved PO / plant access. Read-only for construction role.'
)

const drawingsFolder = folder('Drawings & Attachments (site)', [
  item(
    'List Drawings (all projects)',
    req('GET', ['construction', 'drawings'], {
      query: [
        q('leadId', '', 'Filter by project', true),
        q('status', '', 'pending | approved | rejected', true),
        q('page', '1', '', true),
        q('limit', '20', '', true),
      ],
    })
  ),
  item('Project Drawings', req('GET', ['construction', 'drawings', '{{leadId}}'])),
  item(
    'Upload Drawing',
    req('POST', ['construction', 'drawings', '{{leadId}}'], {
      headers: jsonHeader(),
      body: {
        name: 'Site Layout.pdf',
        url: 'https://bucket.s3.amazonaws.com/documents/uuid.pdf',
        type: 'drawing',
      },
    })
  ),
  item(
    'Review Drawing',
    req('PUT', ['construction', 'drawings', '{{leadId}}', 'documents', '{{docId}}', 'review'], {
      headers: jsonHeader(),
      body: { approvalStatus: 'approved' },
      description: 'approvalStatus: approved | rejected',
    })
  ),
])

const mediaFolder = folder('Photos & Videos (construction media)', [
  item('List Projects with Media', req('GET', ['construction', 'media'])),
  item('Get Lead Media', req('GET', ['construction', 'media', '{{leadId}}'])),
  item(
    'Upload Photo/Video',
    req('POST', ['construction', 'media', '{{leadId}}'], {
      headers: jsonHeader(),
      body: {
        type: 'photo',
        name: 'site-progress.jpg',
        url: 'https://bucket.s3.amazonaws.com/media/uuid.jpg',
        fileType: 'image/jpeg',
        fileSize: 850000,
      },
      description: 'type: photo | video. Upload file first via POST /api/upload/presigned-url',
    })
  ),
])

const tasksFolder = folder('Tasks', [
  item(
    'Task Stats',
    req('GET', ['construction', 'tasks', 'stats'], {
      query: [q('leadId', '{{leadId}}', 'Optional project scope', true)],
    })
  ),
  item(
    'List Tasks',
    req('GET', ['construction', 'tasks'], {
      query: [
        q('leadId', '', 'Project _id', true),
        q('status', '', 'todo | in_progress | done', true),
        q('priority', '', 'low | medium | high', true),
        q('assignedTo', '', 'User _id', true),
        q('search', '', 'title/description', true),
        q('startDate', '', 'dueDate range start', true),
        q('endDate', '', 'dueDate range end', true),
        q('page', '1', '', false),
        q('limit', '50', '', false),
      ],
    }),
    [
      exampleResponse('200 Tasks', 200, {
        success: true,
        data: {
          tasks: [
            {
              _id: '{{taskId}}',
              title: 'Install wall panels',
              status: 'in_progress',
              priority: 'high',
              leadId: { projectName: 'Downtown Office', jobId: 'PRO-031' },
            },
          ],
          total: 1,
          stats: { total: 10, todo: 3, inProgress: 2, done: 5, overdue: 0 },
        },
      }),
    ]
  ),
  item(
    'Create Task',
    req('POST', ['construction', 'tasks'], {
      headers: jsonHeader(),
      body: {
        title: 'Inspect delivery',
        description: 'Verify bundle count',
        leadId: '{{leadId}}',
        assignedTo: '68e…',
        priority: 'high',
        status: 'todo',
        dueDate: '2026-05-22',
        attachments: [],
      },
    })
  ),
  item(
    'Update Task',
    req('PUT', ['construction', 'tasks', '{{taskId}}'], {
      headers: jsonHeader(),
      body: { status: 'done', priority: 'medium', dueDate: '2026-05-25' },
    })
  ),
  item('Delete Task', req('DELETE', ['construction', 'tasks', '{{taskId}}'])),
  item(
    'Update Milestone',
    req('PUT', ['construction', 'milestones', '{{milestoneId}}'], {
      headers: jsonHeader(),
      body: { title: 'Updated title', status: 'completed', targetDate: '2026-06-15' },
    })
  ),
])

const stepsFolder = folder('Project Steps (customer tracking)', [
  item(
    'Update Step Detail',
    req('PUT', ['construction', 'projects', '{{leadId}}', 'steps', '{{stepKey}}'], {
      headers: jsonHeader(),
      body: { status: 'in_progress', notes: 'Work started', percentComplete: 40 },
      description: 'stepKey e.g. foundation, framing, erection',
    })
  ),
  item(
    'Add Step Attachment',
    req('POST', ['construction', 'projects', '{{leadId}}', 'steps', '{{stepKey}}', 'attachments'], {
      headers: jsonHeader(),
      body: { name: 'progress.jpg', url: 'https://…', fileType: 'image/jpeg' },
    })
  ),
])

const workLogsFolder = folder('Work Logs', [
  item(
    'List Work Logs',
    req('GET', ['construction', 'work-logs'], {
      query: [
        q('leadId', '', 'Project _id', true),
        q('taskId', '', 'Task _id', true),
        q('startDate', '', 'Filter log date', true),
        q('endDate', '', '', true),
        q('page', '1', '', true),
        q('limit', '20', '', true),
      ],
    })
  ),
  item(
    'Create Work Log',
    req('POST', ['construction', 'work-logs'], {
      headers: jsonHeader(),
      body: {
        leadId: '{{leadId}}',
        taskId: null,
        date: '2026-05-19',
        progress: 63,
        description: 'Completed foundation excavation',
        photos: ['https://…/photo.jpg'],
        issues: 'Minor delay due to rain',
      },
    })
  ),
])

const mrFolder = folder('Material Requests', [
  item(
    'List Material Requests',
    req('GET', ['construction', 'material-requests'], {
      query: [
        q('page', '1', '', false),
        q('limit', '20', '', false),
        q('leadId', '', 'Project _id', true),
        q('projectId', '', 'Alias for leadId', true),
        q('department', '', '', true),
        q('status', 'pending', 'pending | approved | rejected | fulfilled | cancelled', true),
        q('priority', '', 'low | medium | high | critical', true),
        q('requestedBy', '', 'User _id', true),
        q('siteLocation', '', '', true),
        q('search', '', 'Matches requestId e.g. MR-2025-0031', true),
        q('dateFrom', '', 'requestDate start', true),
        q('dateTo', '', 'requestDate end', true),
      ],
    }),
    [
      exampleResponse('200 List', 200, {
        success: true,
        data: {
          materialRequests: [{ _id: '{{requestId}}', requestId: 'MR-2026-0031', status: 'pending', priority: 'high' }],
          total: 1,
          stats: { totalRequests: 10, pending: 3, approved: 5, rejected: 1 },
        },
      }),
    ]
  ),
  item('Material Request Filters', req('GET', ['construction', 'material-requests', 'filters'])),
  item('Export Material Requests (Excel default)', req('GET', ['construction', 'material-requests', 'export'], {
    query: [q('status', 'pending', 'Same filters as list', true), q('format', 'excel', 'excel | csv', true)],
  })),
  item('Export CSV', req('GET', ['construction', 'material-requests', 'export', 'csv'])),
  item('Export Excel', req('GET', ['construction', 'material-requests', 'export', 'excel'])),
  item('Get Material Request Detail', req('GET', ['construction', 'material-requests', '{{requestId}}']), [
    exampleResponse('200 Detail', 200, {
      success: true,
      data: {
        materialRequest: {
          _id: '{{requestId}}',
          requestId: 'MR-2026-0031',
          status: 'pending',
          attachments: [],
          specialInstructions: '',
          requestedItems: [{ name: 'Steel Beams', quantity: 5000, unit: 'kg', notes: 'Ground floor' }],
        },
      },
    }),
  ]),
  item(
    'Create Material Request',
    req('POST', ['construction', 'material-requests'], {
      headers: jsonHeader(),
      body: {
        leadId: '{{leadId}}',
        siteLocation: 'Construction Site A',
        department: 'Site Engineering',
        requestedItems: [{ name: 'Cement 50 kg', quantity: 300, unit: 'bags', notes: 'OPC' }],
        requiredBy: '2026-05-22',
        priority: 'high',
        specialInstructions: 'Needed for slab pour',
        attachments: [{ name: 'list.xlsx', url: 'https://…', fileSize: 12000 }],
      },
    })
  ),
  item(
    'Update Status (approve / reject / cancel)',
    req('PUT', ['construction', 'material-requests', '{{requestId}}', 'status'], {
      headers: jsonHeader(),
      body: { status: 'cancelled', reviewNotes: 'No longer needed' },
      description: 'cancelled only allowed when current status is pending.',
    }),
    [
      exampleResponse('200 Cancelled', 200, {
        success: true,
        message: 'Material request updated',
        data: { requestId: '{{requestId}}', status: 'cancelled' },
      }),
    ]
  ),
  item(
    'Create Order Quotation',
    req('POST', ['construction', 'material-requests', '{{requestId}}', 'quotations'], {
      headers: jsonHeader(),
      body: {
        sellerName: 'Storage Materials',
        sellerAddress: '…',
        sellerEmail: 'info@company.com',
        lineItems: [{ coilType: 'Black 26ga', lengthFeet: 24, quantity: 30, color: 'Black', unitPrice: 10 }],
        tax: 168,
        freight: 27,
      },
    })
  ),
  item(
    'Mark Item Delivered',
    req('POST', ['construction', 'material-requests', '{{requestId}}', 'items', '{{itemId}}', 'deliver'], {
      headers: jsonHeader(),
      body: { deliveryId: '{{deliveryId}}', deliveryReference: 'DEL-2026-0001' },
    })
  ),
])

const deliveryFolder = folder('Delivery Tracking (site logistics)', [
  item(
    'Delivery Filters',
    req('GET', ['construction', 'deliveries', 'filters']),
    [
      exampleResponse('200 Filters', 200, {
        success: true,
        data: {
          deliveryStatuses: ['scheduled', 'confirmed', 'in_transit', 'delivered'],
          siteDestinations: ['Site A'],
          transporters: ['ABC Freight'],
          drivers: ['John'],
          sortBy: ['Latest', 'Oldest', 'Weight', 'DeliveryDate'],
        },
      }),
    ]
  ),
  item(
    'List Deliveries',
    req('GET', ['construction', 'deliveries'], {
      query: [
        q('page', '1', '', false),
        q('limit', '20', '', false),
        q('sortBy', 'Latest', 'Latest | Oldest | Weight | DeliveryDate', true),
        q('search', '', 'delivery #, material, location…', true),
        q('status', '', 'Or deliveryStatus', true),
        q('leadId', '', 'Or projectId', true),
        q('materialType', '', '', true),
        q('siteDestination', '', 'Substring on deliveryLocation', true),
        q('transporter', '', '', true),
        q('driver', '', '', true),
        q('startDate', '', 'deliveryDate range', true),
        q('endDate', '', '', true),
      ],
    })
  ),
  item('Export Deliveries (Excel)', req('GET', ['construction', 'deliveries', 'export'], {
    query: [q('sortBy', 'Latest', 'Same as list', true)],
  })),
  item(
    'Create Delivery (Add Delivery modal)',
    req('POST', ['construction', 'deliveries'], {
      headers: jsonHeader(),
      body: {
        title: 'Primary Frame Steel',
        leadId: '{{leadId}}',
        sectionLocation: 'Building A - Front Elevation',
        deliveryDate: '2026-05-19',
        description: 'Structural steel phase 1',
        notes: 'Forklift required',
        attachments: ['https://bucket.s3.amazonaws.com/documents/uuid.jpg'],
      },
    }),
    [
      exampleResponse('201 Created', 201, {
        success: true,
        message: 'Delivery added',
        data: { delivery: { _id: '{{deliveryId}}', deliveryNumber: 'DEL-2026-0001', status: 'scheduled' } },
      }),
    ]
  ),
  item('Get Delivery Detail', req('GET', ['construction', 'deliveries', '{{deliveryId}}'])),
  item('Mark Received', req('POST', ['construction', 'deliveries', '{{deliveryId}}', 'mark-received'])),
  item(
    'Mark Partial Received',
    req('POST', ['construction', 'deliveries', '{{deliveryId}}', 'mark-partial'], {
      headers: jsonHeader(),
      body: { notes: '2 bundles short — awaiting remainder' },
    })
  ),
  item(
    'Update Site Contact',
    req('PUT', ['construction', 'deliveries', '{{deliveryId}}', 'site-contact'], {
      headers: jsonHeader(),
      body: {
        contactName: 'Jane Site',
        contactTitle: 'Site Superintendent',
        phone: '+1-555-0100',
        email: 'jane@site.com',
        availableHours: '7am–5pm',
        notes: '',
      },
    })
  ),
  item('Download Packing List', req('GET', ['construction', 'deliveries', '{{deliveryId}}', 'download', 'packing-list'])),
  item('Download Bill of Lading', req('GET', ['construction', 'deliveries', '{{deliveryId}}', 'download', 'bill-of-lading'])),
  item(
    'Scan Bundle (deliveries path)',
    req('POST', ['construction', 'deliveries', 'scan-bundle'], {
      headers: jsonHeader(),
      body: { bundleId: 'BND-2026-0042', project: '{{leadId}}' },
      description: 'bundleId = Mongo _id OR bundleNo; if bundleNo, project (leadId/jobId) is required.',
    })
  ),
])

const labelsFolder = folder('Label Printing', [
  item(
    'List Labels',
    req('GET', ['construction', 'labels'], {
      query: [
        q('page', '1', '', false),
        q('limit', '10', '', false),
        q('sortBy', 'Latest', 'Latest | Oldest | Weight | BundleNo', true),
        q('status', 'pending', 'pending | printed | all OR bundle lifecycle status', true),
        q('search', '', 'bundle #, title, project, jobId', true),
        q('leadId', '', '', true),
      ],
    })
  ),
  item('Export Labels Excel', req('GET', ['construction', 'labels', 'export'])),
  item(
    'Print Labels',
    req('POST', ['construction', 'labels', 'print'], {
      headers: jsonHeader(),
      body: { bundleIds: ['{{bundleId}}'] },
    })
  ),
])

const scanFolder = folder('Bundle Scan', [
  item(
    'Scan History',
    req('GET', ['construction', 'bundle-scan'], {
      query: [
        q('page', '1', '', false),
        q('limit', '20', '', false),
        q('sortBy', 'Latest', '', true),
        q('status', 'pending', 'pending | staged | on_truck | loaded | all', true),
        q('search', '', '', true),
        q('leadId', '', '', true),
      ],
    })
  ),
  item('Export Scan History', req('GET', ['construction', 'bundle-scan', 'export'])),
  item(
    'Scan Bundle',
    req('POST', ['construction', 'bundle-scan', 'scan'], {
      headers: jsonHeader(),
      body: { bundleId: '{{bundleId}}', project: '{{leadId}}' },
    })
  ),
  item('Bundle Detail', req('GET', ['construction', 'bundles', '{{bundleId}}'])),
  item('Verify Bundle', req('POST', ['construction', 'bundles', '{{bundleId}}', 'verify'])),
  item('Mark Staged', req('POST', ['construction', 'bundles', '{{bundleId}}', 'mark-staged'])),
  item('Mark Loaded', req('POST', ['construction', 'bundles', '{{bundleId}}', 'mark-loaded'])),
  item(
    'Report Mismatch',
    req('POST', ['construction', 'bundles', '{{bundleId}}', 'report-mismatch'], {
      headers: jsonHeader(),
      body: { notes: 'Weight differs from label', photos: [] },
    })
  ),
  item('Reprint Label', req('POST', ['construction', 'bundles', '{{bundleId}}', 'reprint-label'])),
])

const packingFolder = folder('Packing Lists (logistics)', [
  item(
    'List Packing Lists',
    req('GET', ['construction', 'packing-lists'], {
      query: [
        q('page', '1', '', false),
        q('limit', '20', '', false),
        q('sortBy', 'Latest', '', true),
        q('status', '', 'Packing list status enum', true),
        q('search', '', 'Includes project name', true),
        q('leadId', '', '', true),
      ],
    })
  ),
  item('Packing List Detail', req('GET', ['construction', 'packing-lists', '{{packingListId}}'])),
  item('Export Excel', req('GET', ['construction', 'packing-lists', 'export'])),
  item('Download PDF', req('GET', ['construction', 'packing-lists', '{{packingListId}}', 'download-pdf'])),
  item('Mark Ready', req('POST', ['construction', 'packing-lists', '{{packingListId}}', 'mark-ready'])),
  item('Mark Loading', req('POST', ['construction', 'packing-lists', '{{packingListId}}', 'mark-loading'])),
  item('Mark Dispatch', req('POST', ['construction', 'packing-lists', '{{packingListId}}', 'mark-dispatch'])),
])

const dispatchFolder = folder('Dispatch Verification', [
  item(
    'List Loads',
    req('GET', ['construction', 'dispatch-verification'], {
      query: [
        q('page', '1', '', false),
        q('limit', '20', '', false),
        q('sortBy', 'Latest', '', true),
        q('status', 'pending', 'pending | verified | dispatched | all', true),
        q('search', '', '', true),
      ],
    })
  ),
  item('Export', req('GET', ['construction', 'dispatch-verification', 'export'])),
  item('Load Detail', req('GET', ['construction', 'dispatch-verification', '{{loadId}}'])),
  item(
    'Verify Load',
    req('POST', ['construction', 'dispatch-verification', '{{loadId}}', 'verify-load'], {
      headers: jsonHeader(),
      body: { actualWeight: 42500, notes: 'All bundles accounted for' },
    })
  ),
  item('Confirm Dispatch', req('POST', ['construction', 'dispatch-verification', '{{loadId}}', 'confirm-dispatch'])),
])

const uploadFolder = folder('Upload (shared)', [
  item(
    'Presigned URL',
    req('POST', ['upload', 'presigned-url'], {
      headers: jsonHeader(),
      body: { fileName: 'site-photo.jpg', fileType: 'image/jpeg' },
      description: 'Use returned URL to PUT file, then pass final HTTPS URL in attachment fields.',
    })
  ),
])

const notifFolder = folder('Notifications', [
  item('List Notifications', req('GET', ['notifications'], { query: [q('page', '1', '', true), q('limit', '20', '', true)] })),
  item('Unread Count', req('GET', ['notifications', 'unread-count'])),
  item('Mark One Read', req('PUT', ['notifications', '{{notificationId}}', 'read'])),
  item('Mark All Read', req('PUT', ['notifications', 'read-all'])),
  item('Delete Notification', req('DELETE', ['notifications', '{{notificationId}}'])),
])

const chatFolder = folder('Chat (construction /api/construction/chat)', [
  item('Users for DM', req('GET', ['construction', 'chat', 'users'], { query: [q('search', '', 'Name/email', true)] })),
  item('Department Channels', req('GET', ['construction', 'chat', 'departments'])),
  item('Channel Messages', req('GET', ['construction', 'chat', 'departments', '{{channelKey}}', 'messages'])),
  item(
    'Send Channel Message',
    req('POST', ['construction', 'chat', 'departments', '{{channelKey}}', 'messages'], {
      headers: jsonHeader(),
      body: { content: 'Delivery arriving at 2pm' },
    })
  ),
  item('Direct Conversations', req('GET', ['construction', 'chat', 'direct'])),
  item('Direct Messages', req('GET', ['construction', 'chat', 'direct', '{{userId}}', 'messages'])),
  item(
    'Send Direct Message',
    req('POST', ['construction', 'chat', 'direct', '{{userId}}', 'messages'], {
      headers: jsonHeader(),
      body: { content: 'Can you confirm bundle count?' },
    })
  ),
])

const collection = {
  info: {
    name: 'Construction Panel — Mr Storage Backend',
    _postman_id: 'construction-panel-mr-storage-2026',
    description:
      'Complete Construction Panel API collection (Oct 2026).\n\n' +
      '**Base URL variable:** `baseUrl` = `https://mr-storage-backend-025k.onrender.com/api` (or `http://localhost:3000/api`)\n\n' +
      '**Auth:** Run **Login** first; token is saved to `{{token}}`.\n\n' +
      '**Roles:** `construction` | `admin`\n\n' +
      'Each request includes query param descriptions and example JSON responses where applicable. ' +
      'Excel/PDF endpoints return binary — use Send and Download in Postman.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  event: [
    {
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: [''] },
    },
  ],
  variable: [
    { key: 'baseUrl', value: 'https://mr-storage-backend-025k.onrender.com/api', type: 'string' },
    { key: 'token', value: '', type: 'string' },
    { key: 'leadId', value: '', type: 'string' },
    { key: 'taskId', value: '', type: 'string' },
    { key: 'deliveryId', value: '', type: 'string' },
    { key: 'milestoneId', value: '', type: 'string' },
    { key: 'requestId', value: '', type: 'string' },
    { key: 'itemId', value: '', type: 'string' },
    { key: 'bundleId', value: '', type: 'string' },
    { key: 'packingListId', value: '', type: 'string' },
    { key: 'loadId', value: '', type: 'string' },
    { key: 'jobId', value: '', type: 'string' },
    { key: 'docId', value: '', type: 'string' },
    { key: 'stepKey', value: 'foundation', type: 'string' },
    { key: 'channelKey', value: 'construction', type: 'string' },
    { key: 'userId', value: '', type: 'string' },
    { key: 'notificationId', value: '', type: 'string' },
  ],
  item: [
    authFolder,
    dashboardFolder,
    projectsFolder,
    manufacturingFolder,
    drawingsFolder,
    mediaFolder,
    tasksFolder,
    stepsFolder,
    workLogsFolder,
    mrFolder,
    deliveryFolder,
    labelsFolder,
    scanFolder,
    packingFolder,
    dispatchFolder,
    uploadFolder,
    notifFolder,
    chatFolder,
  ],
}

// Add login test script to save token
const loginItem = collection.item[0].item[0]
loginItem.event = [
  {
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: [
        "const r = pm.response.json();",
        "if (r.data?.accessToken) pm.collectionVariables.set('token', r.data.accessToken);",
        "if (r.data?.token) pm.collectionVariables.set('token', r.data.token);",
      ],
    },
  },
]

fs.writeFileSync(OUT, JSON.stringify(collection, null, '\t') + '\n')
console.log('Wrote', OUT)
console.log('Folders:', collection.item.length)
let count = 0
for (const f of collection.item) count += f.item.length
console.log('Requests:', count)
