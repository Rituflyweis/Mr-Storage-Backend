# Quote logo brand toggle — Steel Building vs Storage Materials

## Purpose

On the PEMB Quote screen (and Quote Preview / PDF), the header logo and company contact lines switch between:

| Toggle label | API value | Wordmark |
|--------------|-----------|----------|
| Steel Building | `SBD` | **STEEL BUILDING** + **DEPOT** |
| Storage Material | `SM` | **STORAGE** + **MATERIALS** |

This is **independent of Job Type** (PEMB vs Storage pricing). Job Type changes pricing engines; logo brand only changes document branding.

## FE wiring

Add a toggle next to Job Type / Scope on the Live Edit / Quote tab:

```text
Logo:  [ Steel Building ]  [ Storage Material ]
```

Send with every `documents/preview` (and save estimate):

```json
{
  "companyBrand": "SBD",
  "pricingResult": {},
  "fullQuote": {},
  "sections": ["quote", "sow", "contract"]
}
```

Aliases accepted: `company`, `brand`, `logoBrand`.  
Values: `SBD` | `SM` | `steel` | `storage` | `steel building` | `storage materials`.

Optional image override:

```json
{ "companyBrand": "SBD", "companyLogoUrl": "https://…/logo.png" }
```

## Persist

```http
POST /api/sales/estimates
PUT  /api/sales/estimates/:estimateId
```

Field: `companyBrand` (`SM` | `SBD`). Also accepts `company`.

History / estimateId-only preview loads saved `companyBrand` automatically:

```http
POST /api/sales/estimates/documents/preview
{ "estimateId": "<id>" }
```

## Soft defaults (only when brand omitted)

| Context | Default |
|---------|---------|
| `jobType: "Storage"` | `SM` |
| Otherwise (PEMB) | `SBD` |

Always send `companyBrand` from the toggle so the choice is explicit.

## Checklist

1. Toggle on Quote tab → store in quote state as `companyBrand`.
2. Pass `companyBrand` on `documents/preview` and PDF.
3. Save on estimate create/update.
4. Confirm preview header + SOW + signatures flip between Storage Materials and Steel Building Depot.
