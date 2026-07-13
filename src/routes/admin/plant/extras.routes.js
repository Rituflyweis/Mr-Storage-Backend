const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../../controllers/plant/extras.controller')
const validate = require('../../../middleware/validate')

// Savings
router.get('/savings', ctrl.getSavings)

// Freight Loads
router.get('/freight-loads',   ctrl.getFreightLoads)
router.get('/awarded-loads',   ctrl.getAwardedLoads)

// Deliveries
router.get('/deliveries-calendar', ctrl.getDeliveriesCalendar)
router.get('/all-deliveries',      ctrl.getAllDeliveries)

// QR Labels
router.get('/qr-labels', ctrl.getQRLabels)

// Item Cost List (Costing)
router.get('/costing',            ctrl.getItemCostList)
router.post('/costing',           [body('mbsCost').isNumeric()], validate, ctrl.createItemCost)
router.put('/costing/:itemId',    [param('itemId').isMongoId()], validate, ctrl.updateItemCost)

// Notification Details (delivery notification history)
router.get('/notification-details', ctrl.getNotificationDetails)

module.exports = router
