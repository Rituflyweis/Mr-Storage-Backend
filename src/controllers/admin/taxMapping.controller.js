const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const avatax = require('../../services/avalara/avataxClient')
const taxMapping = require('../../services/tax/taxMapping.service')
const TaxMappingAudit = require('../../models/TaxMappingAudit')
const { isAvalaraConfigured } = require('../../config/taxEngine')

// GET /tax-codes?search= — search Avalara tax-code definitions for the mapping UI (§7)
exports.searchTaxCodes = asyncHandler(async (req, res) => {
  if (!isAvalaraConfigured()) {
    return badRequest(res, 'Avalara is not configured; cannot search tax codes')
  }
  const { search = '', limit } = req.query
  const top = Math.min(parseInt(limit, 10) || 25, 100)
  const codes = await avatax.listTaxCodes(search, { top })
  return success(res, { taxCodes: codes, count: codes.length })
})

// GET /tax-mappings — list configured mappings and approval status (§7)
exports.listTaxMappings = asyncHandler(async (req, res) => {
  const mappings = await taxMapping.listMappings()
  const summary = {
    total: mappings.length,
    approved: mappings.filter((m) => m.approval_status === 'APPROVED').length,
    pending: mappings.filter((m) => m.approval_status === 'PENDING').length,
    draft: mappings.filter((m) => m.approval_status === 'DRAFT').length,
    unmapped: mappings.filter((m) => !m.avalara_tax_code).length,
  }
  return success(res, { mappings, summary })
})

// PUT /tax-mappings/:id — update draft mapping with approval workflow + audit (§7, §10)
exports.updateTaxMapping = asyncHandler(async (req, res) => {
  const { reason, ...patch } = req.body || {}
  const result = await taxMapping.updateMapping(req.params.id, patch, req.user, reason)
  if (result.error === 'not_found') return notFound(res, 'Tax mapping not found')
  if (result.error === 'invalid_transition') return badRequest(res, result.message)
  if (result.error === 'code_required') return badRequest(res, result.message)
  return success(res, { mapping: result.mapping }, 'Tax mapping updated')
})

// GET /tax-mappings/:id/audit — audit history for a mapping (§10)
exports.getTaxMappingAudit = asyncHandler(async (req, res) => {
  const entries = await TaxMappingAudit.find({ mappingId: req.params.id })
    .sort({ timestamp: -1 })
    .limit(100)
    .lean()
  return success(res, { audit: entries })
})
