const router = require("express").Router();
const { query } = require("express-validator");
const verifyToken = require("../../middleware/auth");
const roleGuard = require("../../middleware/roleGuard");
const validate = require("../../middleware/validate");
const {
  invoiceCreateValidators,
} = require("../../utils/invoiceRouteValidators");

const notifGuard = [verifyToken, roleGuard(['admin', 'sales', 'account', 'plant', 'construction'])]
const guard = [verifyToken, roleGuard(['admin', 'sales'])]
const lookupGuard = [verifyToken, roleGuard(['admin', 'sales', 'plant'])]
const uploadGuard = [verifyToken, roleGuard(['admin', 'sales', 'plant', 'construction'])]
const smdtGuard = [verifyToken, roleGuard(['admin', 'plant'])]

const lookupValidators = [
  query("search").optional().isString(),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
];

// Filter / dropdown lookups (admin all, sales/plant scoped)
const lookupCtrl = require("../../controllers/common/lookup.controller");
router.get(
  "/customers",
  ...lookupGuard,
  lookupValidators,
  validate,
  lookupCtrl.listCustomers,
);
router.get(
  "/leads",
  ...lookupGuard,
  lookupValidators,
  validate,
  lookupCtrl.listLeads,
);

// Lead-scoped list routes
const quotationCtrl = require("../../controllers/common/quotation.controller");
const invoiceCtrl = require("../../controllers/common/invoice.controller");

router.get(
  "/leads/:leadId/quotations",
  ...guard,
  quotationCtrl.getLeadQuotations,
);
router.get("/leads/:leadId/invoices", ...guard, invoiceCtrl.getLeadInvoices);
router.post(
  "/leads/:leadId/invoices",
  ...guard,
  invoiceCreateValidators,
  validate,
  invoiceCtrl.createInvoice,
);

// Resource routes
router.use('/quotations', ...guard, require('./quotation.routes'))
router.use('/invoices', ...guard, require('./invoice.routes'))
router.use('/payment-schedules', ...guard, require('./payment.routes'))
router.use('/upload', uploadGuard, require('./upload.routes'))
router.use('/uploads', uploadGuard, require('./upload.routes'))
router.use('/smdt', smdtGuard, require('./smdt.routes'))
router.use('/activity', require('./pageActivity.routes'))
router.use('/notifications', ...notifGuard, require('./notification.routes'))
router.use('/team-chat', ...notifGuard, require('./teamChat.routes'))
router.use('/followup-automation', require('./followupAutomation.routes'))
router.use('/calendar', ...guard, require('./calendar.routes'))

// Staff "My Profile" screen — same role set as notifications (any authenticated staff member)
const profileCtrl = require('../../controllers/common/profile.controller')
router.get('/profile', ...notifGuard, profileCtrl.getProfile)
router.put('/profile', ...notifGuard, profileCtrl.updateProfile)
router.put('/profile/password', ...notifGuard, profileCtrl.updateProfilePassword)
router.put('/profile/notification-settings', ...notifGuard, profileCtrl.updateNotificationSettings)

module.exports = router;
