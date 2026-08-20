/** Sales tax ZIP lookup — port of HTML lookupPembSalesTax / lookupSalesTax */

const { ZIP_RATES, STATE_RATES } = require('./taxRates')

const normalizeZip = (zip) => String(zip || '').trim().replace(/\D/g, '')

const lookupByPrefix = (zip) => {
  const prefix = zip.substring(0, 3)
  if (!ZIP_RATES[prefix]) return null
  return {
    rate: ZIP_RATES[prefix][0],
    label: ZIP_RATES[prefix][1],
    source: 'zip_prefix',
    zip,
  }
}

const fetchStateFromZip = async (zip) => {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`)
  if (!res.ok) throw new Error('ZIP not found')
  const data = await res.json()
  const place = data.places && data.places[0]
  if (!place) throw new Error('No place data')
  return {
    state: place['state abbreviation'],
    city: place['place name'] || '',
  }
}

const lookupSalesTaxByZip = async (zipInput) => {
  const zip = normalizeZip(zipInput)
  if (zip.length !== 5) {
    return { error: 'Enter a valid 5-digit ZIP code', zip }
  }

  const prefixHit = lookupByPrefix(zip)
  if (prefixHit) {
    return {
      zip,
      rate: prefixHit.rate,
      label: prefixHit.label,
      source: prefixHit.source,
      message: `${prefixHit.label}: ${prefixHit.rate}%`,
    }
  }

  try {
    const { state, city } = await fetchStateFromZip(zip)
    const rate = STATE_RATES[state] ?? 0
    return {
      zip,
      rate,
      label: `${city}, ${state}`,
      source: 'state_average',
      state,
      city,
      message: `${city}, ${state}: ${rate}% — verify exact local rate`,
    }
  } catch {
    return {
      zip,
      rate: 0,
      label: '',
      source: 'unknown',
      message: 'Could not look up tax rate for this ZIP',
    }
  }
}

const computePembSalesTax = (pricingResult, insulationAddon, taxOptions = {}) => {
  const rate = Number(taxOptions.rate ?? 0)
  const include = taxOptions.include !== false
  if (!rate || !include) {
    return { rate: 0, amount: 0, taxableBase: 0, include: false }
  }

  const insulSell = insulationAddon?.include ? insulationAddon.appliedSell || insulationAddon.sell || 0 : 0
  const taxableBase = (pricingResult?.matSell || 0) + insulSell
  const amount = Math.round(taxableBase * (rate / 100))

  return {
    rate,
    amount,
    taxableBase: Math.round(taxableBase),
    include: true,
    note: 'Tax on materials & insulation — labor not taxed',
  }
}

const computeStorageSalesTax = (storagePricing, taxOptions = {}) => {
  const rate = Number(taxOptions.rate ?? 0)
  const include = taxOptions.include !== false
  if (!rate || !include) {
    return { rate: 0, amount: 0, taxableBase: 0, include: false }
  }

  const bld = storagePricing?.buildingSell || 0
  const door = storagePricing?.doorSell || 0
  const insul = storagePricing?.insulationSell || 0
  const taxableBase = bld + door + insul
  const amount = Math.round(taxableBase * (rate / 100))

  return {
    rate,
    amount,
    taxableBase: Math.round(taxableBase),
    include: true,
    note: 'Tax on buildings, doors & insulation — labor not taxed',
  }
}

module.exports = {
  lookupSalesTaxByZip,
  computePembSalesTax,
  computeStorageSalesTax,
  ZIP_RATES,
  STATE_RATES,
}
