/** Minimum customer turns before lifecycle or handoff logic runs. */
const MIN_CUSTOMER_MESSAGES_FOR_LIFECYCLE = 2

const REQUIRED_FIELD_KEYS = [
  'buildingType',
  'sqft',
  'location',
  'roofAndWalls',
  'insulation',
  'doorsWindows',
  'timeline',
  'budgetSignals',
  'decisionMaker',
  'specialRequirements',
]

const countCustomerMessages = (messages = []) =>
  messages.filter((m) => m.senderType === 'customer' && String(m.content || '').trim()).length

const aiIndicatesSalesHandoff = (text = '') => {
  const t = String(text).toLowerCase()
  return (
    /sales team/.test(t) ||
    /sales representative/.test(t) ||
    /team member will reach out/.test(t) ||
    /will contact you/.test(t) ||
    /contact you soon/.test(t) ||
    /reach out with your quote/.test(t) ||
    /sales team member will/.test(t) ||
    /will prepare a detailed quote/.test(t) ||
    /reach out within/.test(t)
  )
}

/**
 * Sales handoff — when Alex marks both requirementsGathered and isQuoteReady in CHAT_INTERNAL.
 */
const isReadyForSalesHandoff = (chatMeta = {}, aiText = '', quoteReadyData, scoreData = {}) => {
  if (chatMeta.requirementsGathered === true && chatMeta.isQuoteReady === true) {
    return true
  }
  if (chatMeta.isQuoteReady === true) {
    return true
  }
  if (chatMeta.requirementsGathered === true && aiIndicatesSalesHandoff(aiText)) {
    return true
  }
  if (Boolean(quoteReadyData)) {
    return true
  }
  if (scoreData.requirementsComplete === true && aiIndicatesSalesHandoff(aiText)) {
    return true
  }
  return false
}

/**
 * Lifecycle requirements_gathered — driven by CHAT_INTERNAL from Alex.
 */
const isRequirementsGatheredFromChat = (chatMeta = {}, scoreData = {}) =>
  chatMeta.requirementsGathered === true || scoreData.requirementsComplete === true

const canAdvanceLifecycle = (messages = []) =>
  countCustomerMessages(messages) >= MIN_CUSTOMER_MESSAGES_FOR_LIFECYCLE

module.exports = {
  MIN_CUSTOMER_MESSAGES_FOR_LIFECYCLE,
  REQUIRED_FIELD_KEYS,
  countCustomerMessages,
  isRequirementsGatheredFromChat,
  isReadyForSalesHandoff,
  aiIndicatesSalesHandoff,
  canAdvanceLifecycle,
}
