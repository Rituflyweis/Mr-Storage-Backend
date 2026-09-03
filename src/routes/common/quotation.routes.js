const router = require("express").Router();
const { body, param } = require("express-validator");
const ctrl = require("../../controllers/common/quotation.controller");
const validate = require("../../middleware/validate");

router.post("/", [body("leadId").notEmpty()], validate, ctrl.createQuotation);
router.post(
  "/from-estimate/:estimateId",
  [param("estimateId").isMongoId()],
  validate,
  ctrl.createQuotationFromEstimate
);

router.get("/approval/pending", ctrl.getPendingQuotationApprovals);
router.get("/:quotationId", ctrl.getQuotation);
router.put("/:quotationId", ctrl.updateQuotation);
router.delete("/:quotationId", ctrl.deleteQuotation);
router.post("/:quotationId/submit-approval", [body("note").optional().isString()], validate, ctrl.submitQuotationForApproval);
router.put("/:quotationId/approve", [body("note").optional().isString()], validate, ctrl.approveQuotation);
router.put("/:quotationId/reject", [body("reason").optional().isString(), body("note").optional().isString()], validate, ctrl.rejectQuotationApproval);
router.post("/:quotationId/send", ctrl.sendQuotation);
router.get("/:quotationId/summary", ctrl.getQuoteSummary);

module.exports = router;
