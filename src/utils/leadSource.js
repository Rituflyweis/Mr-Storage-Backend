/** Display labels for `Lead.source` (enum in constants LEAD_SOURCES). */
const LEAD_SOURCE_LABELS = {
  chat: 'Website / chat',
  manual: 'Manual',
  import: 'Import',
  customer_portal: 'Customer portal',
  call: 'Phone',
  messenger: 'Facebook',
  meta_lead_ads: 'Meta lead ad',
}

const leadSourceFields = (source) => {
  const key = source || 'chat'
  return {
    source: key,
    sourceLabel: LEAD_SOURCE_LABELS[key] || String(key).replace(/_/g, ' '),
  }
}

module.exports = { LEAD_SOURCE_LABELS, leadSourceFields }