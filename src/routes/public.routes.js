const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/public.controller')
const freightBidCtrl = require('../controllers/public/freightBidPublic.controller')
const validate = require('../middleware/validate')
const rateLimit = require('express-rate-limit')

const chatInitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many requests, please try again later' },
})

const vendorUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many vendor upload requests, please try again later' },
})

router.post('/chat/init',
  chatInitLimiter,
  [
    body('firstName').notEmpty().trim(),
    body('email').isEmail().normalizeEmail(),
    body('phone').notEmpty().trim(),
    body('countryCode').optional().trim(),
  ],
  validate,
  ctrl.chatInit
)

router.get('/chat/history/:leadId', ctrl.getChatHistory)

router.get('/vendor-upload/:token',
  vendorUploadLimiter,
  ctrl.getVendorUploadInfo
)

router.post('/vendor-upload/:token/presigned-url',
  vendorUploadLimiter,
  [body('fileName').notEmpty(), body('fileType').notEmpty(), body('folder').optional().notEmpty()],
  validate,
  ctrl.getVendorUploadPresignedUrl
)

router.post('/vendor-upload/:token',
  vendorUploadLimiter,
  [
    body('submittedFileUrl').notEmpty().trim(),
    body('submittedFileName').notEmpty().trim(),
    body('quoteValue').isNumeric(),
  ],
  validate,
  ctrl.submitVendorUpload
)

router.get('/freight-bids/:token',
  vendorUploadLimiter,
  freightBidCtrl.getFreightBidInfo
)

router.post('/freight-bids/:token/submit',
  vendorUploadLimiter,
  [
    body('quotedAmount').isNumeric(),
    body('carrierNotes').optional().isString().trim(),
  ],
  validate,
  freightBidCtrl.submitFreightBid
)

module.exports = router
