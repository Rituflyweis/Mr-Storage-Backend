/**
 * Company / brand info for generated quoting documents.
 * Port of SM-QuotingTool v7 getCompanyInfo() (attachment L8017).
 * Two brands: 'SM' (Storage Materials, default) and 'SBD' (Steel Building Depot).
 * Values can be overridden per-request via the `company` object on the payload.
 */

const COMPANIES = {
  SM: {
    key: "SM",
    name: "Storage Materials",
    tagline: "METAL AND DOORS",
    address: "1851 Madison Ave Suite 300, Council Bluffs, IA 51503",
    phone: "(888) 968-1222",
    email: "travis@storagematerials.com",
    website: "www.storagematerials.com",
    legalName: "Storage Materials",
    taxId: "99-4515145",
    signerName: "Travis Overhue",
    signerTitle: "Owner",
    accentColor: "#1e3a8a",
  },
  SBD: {
    key: "SBD",
    name: "Steel Building Depot",
    tagline: "METAL BUILDINGS, ROOFING & COMPONENTS",
    address: "1851 Madison Ave Suite 300, Council Bluffs, IA 51503",
    phone: "(888) 968-1222",
    email: "info@steelbuildingdepot.com",
    website: "www.steelbuildingdepot.com",
    legalName: "Steel Building Depot",
    taxId: "99-4515145",
    signerName: "Travis Overhue",
    signerTitle: "Owner",
    accentColor: "#b45309",
  },
};

/**
 * @param {object|string} [override] company key ('SM'|'SBD') or an object of overrides
 */
const getCompanyInfo = (override) => {
  let base = COMPANIES.SM;
  let overrides = {};
  if (typeof override === "string") {
    base = COMPANIES[override.toUpperCase()] || COMPANIES.SM;
  } else if (override && typeof override === "object") {
    base = COMPANIES[String(override.key || "").toUpperCase()] || COMPANIES.SM;
    overrides = override;
  }
  return { ...base, ...overrides };
};

/** Logo <img> if a URL/data-URI is supplied, else a styled company name. */
const getLogoHtml = (info = {}) => {
  const src = info.logoSrc || info.logoUrl || info.companyLogoUrl;
  if (src) {
    return `<img src="${src}" style="height:40px;width:auto;display:block;max-width:240px;" alt="${info.name || ""}">`;
  }
  return `<div style="font-size:22px;font-weight:800;color:${info.accentColor || "#1e3a8a"};letter-spacing:-.5px;">${info.name || "Storage Materials"}</div>`;
};

module.exports = { COMPANIES, getCompanyInfo, getLogoHtml };
