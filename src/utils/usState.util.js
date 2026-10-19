/** US state/territory name → ISO 3166-2 region code (AvaTax `region`). */
const US_STATE_NAME_TO_CODE = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  'PUERTO RICO': 'PR',
  GUAM: 'GU',
  'AMERICAN SAMOA': 'AS',
  'VIRGIN ISLANDS': 'VI',
  'NORTHERN MARIANA ISLANDS': 'MP',
}

const normalizeUsStateCode = (stateInput, countryCode = 'US') => {
  const country = String(countryCode || 'US').trim().toUpperCase()
  if (country !== 'US' && country !== 'USA') {
    return String(stateInput || '').trim().toUpperCase()
  }

  const raw = String(stateInput || '').trim()
  if (!raw) return ''
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase()

  const fromName = US_STATE_NAME_TO_CODE[raw.toUpperCase()]
  if (fromName) return fromName

  return raw.toUpperCase()
}

const isUsStateCodeValid = (code) => /^[A-Z]{2}$/.test(String(code || '').trim())

module.exports = {
  US_STATE_NAME_TO_CODE,
  normalizeUsStateCode,
  isUsStateCodeValid,
}
