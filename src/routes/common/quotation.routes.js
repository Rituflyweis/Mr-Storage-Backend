const router = require("express").Router();
const { body, param, query } = require("express-validator");
const ctrl = require("../../controllers/common/quotation.controller");
const validate = require("../../middleware/validate");

router.post("/", [body("leadId").notEmpty()], validate, ctrl.createQuotation);
router.post(
  "/from-estimate/:estimateId",
  [param("estimateId").isMongoId(), body("leadId").optional().isMongoId()],
  validate,
  ctrl.createQuotationFromEstimate
);

router.get(
  "/approval/pending",
  [
    query("leadId").optional().isMongoId(),
    query("approvalStatus")
      .optional()
      .isIn(["not_submitted", "pending_approval", "approved", "rejected"]),
    query("status")
      .optional()
      .isIn(["draft", "pending", "pending_approval", "approved", "rejected", "sent", "accepted"]),
    query("sort").optional().isIn(["latest", "oldest"]),
    query("startDate").optional().isISO8601(),
    query("endDate").optional().isISO8601(),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getPendingQuotationApprovals
);
router.get("/:quotationId", ctrl.getQuotation);
router.put("/:quotationId", ctrl.updateQuotation);
router.delete("/:quotationId", ctrl.deleteQuotation);
router.post(
  "/:quotationId/submit-approval",
  [
    body("note").optional().isString(),
    body("estimateId").optional().isMongoId(),
    body("leadId").optional().isMongoId(),
  ],
  validate,
  ctrl.submitQuotationForApproval
);
router.put("/:quotationId/approve", [body("note").optional().isString()], validate, ctrl.approveQuotation);
router.put("/:quotationId/reject", [body("reason").optional().isString(), body("note").optional().isString()], validate, ctrl.rejectQuotationApproval);
router.post("/:quotationId/send", ctrl.sendQuotation);
router.get("/:quotationId/summary", ctrl.getQuoteSummary);

module.exports = router;
