const { body } = require('express-validator')
const { LEAD_SOURCES } = require('../config/constants')

/** Shared project fields — no `source` (create project flows). */
const projectFieldValidators = [
  body('projectName').notEmpty().trim(),
  body('buildingType').notEmpty().trim(),
  body('location').notEmpty().trim(),
  body('quoteValue').optional().isNumeric(),
  body('roofStyle').optional().trim(),
  body('width').optional().isNumeric(),
  body('length').optional().isNumeric(),
  body('height').optional().isNumeric(),
  body('doors').optional().isNumeric(),
  body('windows').optional().isNumeric(),
  body('insulation').optional().isNumeric(),
  body('door').optional().isNumeric(),
  body('window').optional().isNumeric(),
]

/** Lead section — same project fields + optional `source`. */
const leadCreateFieldValidators = [
  ...projectFieldValidators,
  body('source').optional().isIn(LEAD_SOURCES),
]

/** PUT /leads/:leadId — partial update (admin + sales). */
const leadEditFieldValidators = [
  body('projectName').optional().trim(),
  body('buildingType').optional().trim(),
  body('location').optional().trim(),
  body('source').optional().isIn(LEAD_SOURCES),
  body('quoteValue').optional({ nullable: true }).isNumeric(),
  body('roofStyle').optional().trim(),
  body('width').optional({ nullable: true }).isNumeric(),
  body('length').optional({ nullable: true }).isNumeric(),
  body('height').optional({ nullable: true }).isNumeric(),
  body('doors').optional({ nullable: true }).isNumeric(),
  body('windows').optional({ nullable: true }).isNumeric(),
  body('insulation').optional({ nullable: true }).isNumeric(),
  body('door').optional({ nullable: true }).isNumeric(),
  body('window').optional({ nullable: true }).isNumeric(),
  body('lifecycleStatus').optional().trim(),
  body('notes').optional().trim(),
]

module.exports = {
  projectFieldValidators,
  leadCreateFieldValidators,
  leadEditFieldValidators,
}
