const router = require('express').Router()
const verifyCustomerToken = require('../middleware/customerAuth')
const ctrl = require('../controllers/customerPortal.controller')

router.use(verifyCustomerToken)

router.get('/me',                                  ctrl.getProfile)
router.get('/me/projects',                         ctrl.getProjects)
router.post('/me/projects',                        ctrl.createProject)
router.get('/me/projects/:projectId',              ctrl.getProject)
router.get('/me/projects/:projectId/files',        ctrl.getProjectFiles)
router.get('/me/invoices',                         ctrl.getInvoices)

module.exports = router
