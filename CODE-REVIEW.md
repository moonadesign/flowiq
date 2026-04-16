Putting on the principal-eng hat. No sugar coating.

### Critical / architectural

**1. Globals-as-architecture.** `data, fixtures, types, grid, trimGrid, plGrid, cfGrid, stGrid, curveById, tagById, currentPump, draft, originalSnapshot, view, open` — all top-level `let`. Nothing is encapsulated. This is fine for a 200-line demo; for a 1000-line codebase that will grow, it's a ticking bomb. A future refactor to group into cohesive objects (`drawer.state`, `grids.main`, etc.) will be painful because the globals are referenced from every function.

**2. Identity is a computed string.** `modelOf(p)` serves as both the pump's display AND its identifier in `openItem`. Two new empty pumps collide on `modelOf === "-"`. We know this — it's not fixed. Every other record type got an explicit `id` field. Pump is the holdout. This WILL break on real usage.

**3. Stale index.** `curveById` and `tagById` are built once in `hydrate()` and never refreshed. If a user edits a curve's `id`, every `curveById[oldId]` lookup still resolves, but the referenced object has a new id. We patched `openItem` to a live `find`, but `pumpType` getter and `openItem`'s pump-curve cross-link still read the stale index. Bug waiting.

**4. No validation, despite having a schema.** `types` declares every field, ref, and enum — that's a free validator we never wrote. Typed data flows through the app untyped at runtime. The Caveats section admits this; it doesn't excuse it.

**5. Zero tests.** Not even a smoke test that runs `hydrate(fixture)` and asserts the grid renders. Every refactor is "hope I didn't break it," confirmed by `node -c`. For a prototype that's become load-bearing, this is the biggest risk.

### Structural / maintainability

**6. `typeToCol` handles 5 shapes of field value with no docs and no tests.** String, ref-string (`"<meta>"`), enum array, ref-array (`["<tagId>"]`), nested object, wrapper object with `type`+`hide`, nested object with `hide`. The logic is recursive. Edge cases (arrays of objects, double refs, circular refs) are hand-waved. First time someone adds `"compliance": { "hide": true, "order": 2, "type": "string" }` while also adding a nested object with an `order` field, it'll break silently.

**7. Event listener management is ad-hoc.** `closeOnOutside` is attached with `addEventListener` and removed with `removeEventListener` — relies on function identity being stable. `body.oninput = body.onchange = ...` mixes property assignment with `addEventListener` style elsewhere. The mode toggle listener is delegated at `document`. The More page is delegated at `#more-page`. The drawer uses a mix. No pattern.

**8. Accessibility is absent.** The drawer is `<aside>`, no `role="dialog"`, no `aria-modal`, no focus trap, no return-focus on close. Keyboard users can't navigate into the drawer from the grid. `<dialog>` + `showModal()` gets some of this free; the drawer doesn't.

**9. The cascade-layer trick is clever and uncommented.** `<link ... layer="minterface">` is load-bearing — it's why our styles win over AG Grid's injected CSS. A new dev touching this file will not understand why. Zero comments.

**10. `data` vs `fixtures` vs `types` dual-reference.** `data = json` then `fixtures = json.fixtures`. `persist` serializes `data`. It works because destructured objects share references. One accidental reassignment (`fixtures = {...fixtures, ...}`) and the persisted snapshot diverges from the in-memory state. Footgun.

### Product / UX

**11. Generate is destructive without confirmation.** Well, not destructive anymore (we made it augment), but the LLM can inject arbitrary records. A misconfigured prompt could wipe the visual meaning of the catalog. No preview, no "review before applying."

**12. Persist is silent.** 300ms debounce → localStorage write. If the write fails (quota, disk full, iOS private mode), the user gets zero feedback. Add a "Saved" indicator or at least console a warning on `setItem` failure.

**13. No last-saved timestamp.** Users can't tell if their changes are safe.

**14. Destructive actions share the same visual weight as passive ones.** Trash cans are muted-gray → red on hover, which is right. But Reset is also just a button, not guarded. For a prototype, OK; for real usage, a "type RESET to confirm" moment is worth it.

### Code nits worth mentioning

**15. Naming inconsistency.** `plGrid, cfGrid, stGrid` (2-char), `trimGrid` (full), `grid` (generic main). `textIn, selectIn, rangeIn, textAreaIn` — the fourth is verbose for no reason (`textarea` vs `text`). Pick one convention.

**16. Magic numbers with no units in `buildTrims`.** `qMax = 200 * (diameter/150)**1.5`. Where does `1.5` come from? Affinity laws, vaguely. No citation, no comment.

**17. LLM prompt is inlined runtime logic.** ~30 lines of carefully-worded instructional text live in `scripts.js`. It should be in a `prompts/generate.txt` that's fetched or imported. Prompt engineering and code engineering are different disciplines; mixing them means both get worse.

**18. `el()` abstraction is clever but obscure.** `[].concat(children)` to handle both single-node and array-of-nodes inputs is idiomatic JS of 2015 vintage. A modern `Array.isArray(children) ? children : [children]` is clearer.

### Honest overall

The code works. It's iterated fast. It does a surprising amount for 1000 lines. But it has the classic "demo that got promoted to a prototype that's getting promoted to a product" shape: every layer is patched, not designed. If this is staying a prototype: ship it. If this is going to production or onto a team: the globals, the identity problem, the lack of tests, and the lack of validation are the three things that will bite first.

Nothing here is unfixable; most is ~1 day of work each. But don't keep adding features until you've at least paid down (#2) pump identity and (#5) a smoke test. Those are the cheapest, highest-leverage paydowns.
