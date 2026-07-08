const router = require('express').Router()

router.use(require('./admin.routes'))
router.use(require('./user.routes'))

module.exports = router
