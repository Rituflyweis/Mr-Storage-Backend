const router = require('express').Router()
const ctrl = require('../../controllers/account/project.controller')

router.get('/', ctrl.getProjects)

module.exports = router
