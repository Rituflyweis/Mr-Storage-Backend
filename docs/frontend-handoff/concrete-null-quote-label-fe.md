# Concrete quote label showing `null"` / `null PSI` — fixed

**Status:** Backend fixed  
**Date:** 30 Oct 2026  

## Symptom

Concrete tab shows **6" / 4000 PSI / $29,000**, but Quote / Pricing Summary shows:

```text
Concrete (null" · null PSI · 3,000 SF)     $29,000
Concrete foundation & null" null PSI slab
```

## Cause

After **Apply to Quote**, FE often sends:

```json
{
  "concrete": {
    "include": true,
    "appliedSell": 29000,
    "thickness": null,
    "psi": null
  }
}
```

Quote HTML used that object as-is (`${null}` → `"null"`). Money was fine; labels were not.

## Backend fix

- Normalize concrete: `null` / aliases (`slabThickness`, `psiRating`) → defaults **6"** / **4000 PSI**
- Quote/SOW HTML coalesces live `concrete` with `fullQuote.concrete` and defaults so labels never print `null`

After deploy, same payload renders:

```text
Concrete (6" · 4000 PSI · 3,000 SF)
Concrete foundation & 6" 4000 PSI slab
```

## FE (recommended)

Still send real values on Apply / preview / save:

```json
{
  "concrete": {
    "include": true,
    "thickness": 6,
    "psi": 4000,
    "costSF": 7.25,
    "marginPct": 25,
    "appliedSell": 29000
  }
}
```

Do **not** send `"thickness": null` or `"psi": null`. Omit the key or send the number from the Concrete tab.

## Checklist

- [ ] Deploy backend with addon + quote document fix  
- [ ] Re-open quote / Apply Concrete again — labels show **6"** and **4000 PSI**  
- [ ] (Optional) FE stop sending null thickness/psi  
