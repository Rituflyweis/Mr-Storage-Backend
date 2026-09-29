const { query } = require('express-validator')
const { BUSINESS_UNITS, BUSINESS_UNIT_LABELS } = require('../config/constants')

/** `?businessUnit=none` selects projects that have no unit set yet. */
const BUSINESS_UNIT_UNSET_FILTER = 'none'

const getBusinessUnitLabel = (value) => BUSINESS_UNIT_LABELS[value] || ''

/**
 * Normalizes an incoming value.
 * - undefined → { skip: true } (field not sent)
 * - null / '' → { value: null } (clear)
 * - valid unit (case-insensitive) → { value }
 * - anything else → { error }
 */
const normalizeBusinessUnit = (raw) => {
  if (raw === undefined) return { skip: true }
  if (raw === null || raw === '') return { value: null }
  const value = String(raw).trim().toLowerCase()
  if (!BUSINESS_UNITS.includes(value)) {
    return { error: `businessUnit must be one of: ${BUSINESS_UNITS.join(', ')}` }
  }
  return { value }
}

/** Mongo filter fragment for a list query, or null when no filter was requested. */
const buildBusinessUnitFilter = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null
  const value = String(raw).trim().toLowerCase()
  if (value === BUSINESS_UNIT_UNSET_FILTER) return { businessUnit: null }
  if (!BUSINESS_UNITS.includes(value)) return null
  return { businessUnit: value }
}

/** Adds the unit filter to an existing Mongo filter object in place. */
const applyBusinessUnitFilter = (filter, raw) => {
  const fragment = buildBusinessUnitFilter(raw)
  if (fragment) Object.assign(filter, fragment)
  return filter
}

/** Response fields for any lead/project row. */
const businessUnitFields = (lead) => {
  const value = lead?.businessUnit || null
  return { businessUnit: value, businessUnitLabel: getBusinessUnitLabel(value) }
}

const businessUnitQueryValidator = () =>
  query('businessUnit')
    .optional({ values: 'falsy' })
    .customSanitizer((v) => String(v).trim().toLowerCase())
    .isIn([...BUSINESS_UNITS, BUSINESS_UNIT_UNSET_FILTER])
    .withMessage(`businessUnit must be one of: ${[...BUSINESS_UNITS, BUSINESS_UNIT_UNSET_FILTER].join(', ')}`)

module.exports = {
  BUSINESS_UNITS,
  BUSINESS_UNIT_LABELS,
  BUSINESS_UNIT_UNSET_FILTER,
  getBusinessUnitLabel,
  normalizeBusinessUnit,
  buildBusinessUnitFilter,
  applyBusinessUnitFilter,
  businessUnitFields,
  businessUnitQueryValidator,
}
