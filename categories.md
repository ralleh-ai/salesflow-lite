# Target Categories & Product Fit

⚠️ **Template file. Replace before a live install.**

This repo-root file is the **only runtime default** product/service catalog used by SalesFlow-Lite research and categorization. The code reads `./categories.md`; files under `docs/examples/` are examples only and are intentionally named descriptively, such as `categories.print-shop-satx.md`, so an operator does not edit the wrong file.

It is not secret and should stay concise: long category files increase prompt size and cost when LLM categorization is enabled.

Use one `##` heading per product/service category. Each category should include:

- **Typical business types** — comma-separated target business types / Places-style terms.
- **Pitch notes** — short notes about why this product/service fits those businesses.

Best default for a first run: start with **3–5 commercially important product/service categories** and **3–5 matching discovery target business types**. The categories answer “which offer fits this lead?”; `Config.discoveryTargetBusinessTypes` answers “what kinds of businesses should we search for?” Keep those two lists aligned.

---

## Example — Menus & Signage

**Typical business types**: restaurants, cafes, bars, food trucks

**Pitch notes**: Laminated menus, table tents, window decals, sandwich boards, patio banners, and seasonal promo signage. Emphasize durability and fast reprint turnaround.

## Example — Banners

**Typical business types**: schools, gyms, construction companies, event venues, retail grand openings

**Pitch notes**: Exterior vinyl banners for enrollment pushes, grand openings, sales events, and seasonal promotions. Emphasize weather resistance, fast turnaround, and repeat-order pricing.

---

Before running a real lead pack:

- [ ] Replace `Example — ...` headings with real product/service categories.
- [ ] Keep the first batch to 3–5 categories.
- [ ] Ensure each category has Typical business types and Pitch notes.
- [ ] Confirm the categories represent services/products the business can confidently sell now.
- [ ] Set matching explicit Places search terms in `Config.discoveryTargetBusinessTypes`.
