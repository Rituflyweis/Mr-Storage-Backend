const router = require('express').Router()
const ctrl = require('../../controllers/common/emailSendJob.controller')

router.get('/:jobId', ctrl.getEmailSendJobStatus)

module.exports = router
