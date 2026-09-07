# Target Categories & Product Fit

This file is the **source of truth for target business categories and
product/service fit**, replacing the previous `Categories_Reference` Sheets
tab design. It lives locally in the repo/install (not in Google Sheets)
because category definitions are a business-configuration decision made
once at setup and rarely touched after — a version-controlled `.md` file is
easier for an operator or their agent to review, diff, and hand off than a
spreadsheet tab, and keeps the LLM categorization prompt's grounding data
out of the row-churn of the live Sheet.

> **Reference instance: San Antonio, TX print shop.** Fill in real
> categories for your business below and delete this note.

## How this file is used

The research cron (`src/research/pass.ts`) reads this file once per run and
passes its content to the LLM categorization step alongside each lead's
scraped business description, producing `product_fit_category`,
`product_fit_confidence`, and `product_fit_rationale` on the `Leads` tab.
See `docs/SPEC.md` §3.4.

## Format

One `##` heading per product/service category. Each category needs:
- **Typical business types**: comma-separated list of business types/Places
  categories/keywords that are good candidates for this product.
- **Pitch notes**: a short paragraph the categorizer (and, eventually,
  outreach drafts) can draw language from.

---

## Banners

**Typical business types**: schools, gyms, construction companies, event
venues, retail grand openings

**Pitch notes**: Exterior vinyl banners for enrollment pushes, grand
openings, sales events, and seasonal promotions. Fast turnaround, weatherproof,
sized to the client's existing mounting hardware where possible.

## Menus & Signage

**Typical business types**: restaurants, cafes, food trucks

**Pitch notes**: Laminated menus, window decals, sandwich boards, and
illuminated signage. Emphasize durability (spill/wipe-resistant) and quick
reprint turnaround for seasonal menu changes.

## Real Estate Signage

**Typical business types**: real estate agencies, property managers

**Pitch notes**: Yard signs, open-house directional signs, rider strips.
Volume/repeat-order pricing is the natural upsell for agencies with active
listing pipelines.

<!--
Add additional ## categories below following the same two-field format.
Keep entries concise — this file is injected into an LLM prompt per
research-cron run, so bloat here is a direct token-cost/latency cost per
lead processed (see docs/SPEC.md §19 for the broader token-budget design
this file's size feeds into).
-->
