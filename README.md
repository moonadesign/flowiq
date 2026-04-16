## Out of MVP scope

Explainer §9 workflows intentionally deferred for this prototype:

- **Curve-fitting controls** — on-curve toggle, disable-point, division points, polynomial ↔ spline switcher per curve type (Head / Efficiency / NPSHr). Handled in production tooling.
- **Affinity-law recalculations** on trim-diameter edits. Prototype treats curves as approximations; production engine recomputes derived curves when diameters change.
- **Size ↔ curve compatibility validation** — the rules that prevent assigning a wrong curve to a pump size. To be proven in a guided test pass later; not wired into the prototype yet.
- **Global search** across product lines, pump sizes, and curves simultaneously. System-wide concern, not part of catalog management.

## Caveats

No validation is applied when creating or editing records manually — empty IDs, broken references, out-of-range numbers, and missing enum values are all accepted. Generated data is internally consistent; hand-entered data is trust-based. A future validation pass would enforce required fields, cross-reference integrity, and sane numeric ranges.

## Persistence

All mutations write to `localStorage['flowiq']` with a 300ms debounce:

- **Inline cell edits** on every grid (main, trim, and More-page sub-grids) via AG Grid's `onCellValueChanged`
- **+ New pump / + New curve** — pushed to `data.pumps.items` / `data.curves`, drawer opens for the form
- **+ New product line / curve family / status** — pushed to `data.productLines` / `data.curveFamilies` / `data.statuses`
- **Save pump** — commits drafted edits
- **Curve drawer edits** — `textIn` / `textAreaIn` / `selectIn` / `rangeIn` mutate the curve directly

Sub-grid rows on the More page are direct references into `data.productLines` / `data.curveFamilies` / `data.statuses` (self-healed on render from any product line or family a pump/curve uses), so inline edits mutate the taxonomy in place.

On load, stored data wins over the fixture. Reset clears `localStorage` and reloads `flowiq-v2.json`.

## Insights from Dominik 4/16

- Product families are like catalogs in legacy
- Pumps belong to catalogs in legacy
- Curves should just be on the surface
- Curve families is more like a tag than a root type
- We can give tags a loaded type with description, etc.
- Only fields that matter on are min, max, and increment to generate # of variants within the valid curve range
- Everything can be collapsed to a single curve list and detail screen
- Corollary #1: there should not be separate tabs and views for details, tables, and editing
- Corollary #2: there should not be separate tabs and views for visualizations and sub-objects
