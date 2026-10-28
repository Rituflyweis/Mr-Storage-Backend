const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/common/upload.controller')
const validate = require('../../middleware/validate')

// Generate presigned S3 URL
router.post('/presigned-url',
  [body('fileName').notEmpty(), body('fileType').notEmpty()],
  validate,
  ctrl.getPresignedUrl
)

// Short-lived GetObject URL for private S3 objects (shipper files / drawings AccessDenied fix)
router.post('/download-presigned-url',
  [
    body('key').optional().trim().notEmpty(),
    body('fileUrl').optional().trim().notEmpty(),
    body('url').optional().trim().notEmpty(),
  ],
  validate,
  ctrl.getDownloadPresignedUrl
)
router.get('/download-presigned-url',
  [
    query('key').optional().trim().notEmpty(),
    query('fileUrl').optional().trim().notEmpty(),
    query('url').optional().trim().notEmpty(),
  ],
  validate,
  ctrl.getDownloadPresignedUrl
)

// Save document URL to lead after S3 upload completes
router.post('/leads/:leadId/documents',
  [
    body('url').notEmpty(),
    body('name').notEmpty(),
    body('type').optional().isIn(['drawing', 'approval', 'general', 'contract', 'photo', 'video', 'other']),
  ],
  validate,
  ctrl.addDocument
)

router.delete('/leads/:leadId/documents/:docId', ctrl.removeDocument)

// Upload signed agreement / contract file URL to a lead
router.post('/leads/:leadId/agreement',
  [body('url').notEmpty(), body('name').notEmpty()],
  validate,
  ctrl.uploadAgreement
)

module.exports = router
