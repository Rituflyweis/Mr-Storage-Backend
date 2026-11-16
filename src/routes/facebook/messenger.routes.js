const express = require('express')
const messenger = require('../../controllers/facebook/messenger.controller')

const router = express.Router()

router.get('/', messenger.verify)
router.post('/', messenger.webhook)

module.exports = router
