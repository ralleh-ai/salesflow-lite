# Target Categories & Product Fit

⚠️ **SAMPLE / PLACEHOLDER FILE — not real configuration.**
Everything below is illustrative content for a fictional "reference"
print shop, provided so the file's format and the research-cron wiring
can be reviewed and tested end-to-end before your real categories exist.
**Do not run outreach against this data.** Replace the example categories
with your actual product/service lines before going live, and delete this
warning block once you have.

This file is the **source of truth for target business categories and
product/service fit**, replacing the earlier `Categories_Reference` Google
Sheets tab design. It lives locally in the repo/install (not in Google
Sheets) because category definitions are a business-configuration decision
made once at setup and rarely touched after — a version-controlled `.md`
file is easier for an operator or their agent to review, diff, and hand off
than a spreadsheet tab, and it keeps the LLM categorization prompt's
grounding data out of the row-churn of the live Sheet.

## How this file is used

The research cron (`src/research/pass.ts`) reads this file once per run and
passes its content to the LLM categorization step alongside each lead's
scraped business description, producing `product_fit_category`,
`product_fit_confidence`, and `product_fit_rationale` on the `Leads` tab.
See `docs/SPEC.md` §3.4.

## Format

One `##` heading per product/service category. Each category needs exactly
two fields:
- **Typical business types**: comma-separated list of business types/Places
  categories/keywords that are good candidates for this product.
- **Pitch notes**: a short paragraph the categorizer (and, eventually,
  outreach drafts) can draw language from.

Keep entries concise — this file is injected into an LLM prompt on every
research-cron run, so length here is a direct token-cost/latency cost per
lead processed (see `docs/SPEC.md` §19 for the broader token-budget design
this file's size feeds into). Three to six categories is a reasonable range
for a first install; add more only as real product lines justify it.

---

## EXAMPLE — Banners *(sample data, replace before going live)*

**Typical business types**: schools, gyms, construction companies, event
venues, retail grand openings

**Pitch notes**: Exterior vinyl banners for enrollment pushes, grand
openings, sales events, and seasonal promotions. Fast turnaround, weatherproof,
sized to the client's existing mounting hardware where possible.

## EXAMPLE — Menus & Signage *(sample data, replace before going live)*

**Typical business types**: restaurants, cafes, food trucks

**Pitch notes**: Laminated menus, window decals, sandwich boards, and
illuminated signage. Emphasize durability (spill/wipe-resistant) and quick
reprint turnaround for seasonal menu changes.

## EXAMPLE — Real Estate Signage *(sample data, replace before going live)*

**Typical business types**: real estate agencies, property managers

**Pitch notes**: Yard signs, open-house directional signs, rider strips.
Volume/repeat-order pricing is the natural upsell for agencies with active
listing pipelines.

---

<!--
REPLACE EVERYTHING ABOVE THE HORIZONTAL RULE WITH YOUR REAL CATEGORIES.

Checklist before deleting this comment and the warning block at the top:
  [ ] Every "## EXAMPLE — ..." heading replaced with a real product/service
      category for this business.
  [ ] Each category has both required fields: "Typical business types" and
      "Pitch notes".
  [ ] Category count is small enough to keep the research-cron LLM prompt
      cheap (see docs/SPEC.md §19) — 3-6 categories is a good starting range.
  [ ] The warning block at the top of this file has been removed.

Add additional `##` categories below following the same two-field format.
-->
