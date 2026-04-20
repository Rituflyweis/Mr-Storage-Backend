const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/common/upload.controller')
const validate = require('../../middleware/validate')

// Generate presigned S3 URL
router.post('/presigned-url',
  [body('fileName').notEmpty(), body('fileType').notEmpty()],
  validate,
  ctrl.getPresignedUrl
)

// Save document URL to lead after S3 upload completes
router.post('/leads/:leadId/documents',
  [body('url').notEmpty(), body('name').notEmpty()],
  validate,
  ctrl.addDocument
)

router.delete('/leads/:leadId/documents/:docId', ctrl.removeDocument)

module.exports = router
