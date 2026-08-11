const router = require('express').Router()
const ctrl = require('../../controllers/material/user.controller')

router.post('/user/sendNewsLetterRequest', ctrl.sendNewsLetterRequest)
router.post('/user/sendQuotesRequest', ctrl.sendQuotesRequest)
router.post('/user/sendInquire', ctrl.sendInquire)
router.get('/user/getAllInquire', ctrl.getAllInquire)

module.exports = router
