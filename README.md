# 🧰 MaterialList AI

**Job description in, store-ready checklist out.** Contractors lose money on forgotten materials and second supply runs. MaterialList AI turns a plain-English job description into a materials takeoff — item, quantity, unit, estimated unit price, line total — with waste factors, a buy-as-you-go checklist, and a printable list. Free, local-first, no account.

## The problem

A forgotten $8 part costs a $60 supply run and an hour of labor. Manual takeoffs from memory miss items, guess quantities, and never add waste — so jobs stall at the counter.

## The solution

1. **Describe the job** — "Reroof 1200 sq ft house with shingles" or "Kitchen remodel: 6 base cabinets, butcher block countertop"
2. **Pick the trade** — 9 trade banks (electrical, plumbing, HVAC, carpentry/framing, drywall/painting, roofing, flooring, masonry/concrete, landscaping) with keyword-matched materials
3. **Get the takeoff** — quantities auto-scaled from the sizes in your text ("200 sq ft" → 200 sq ft of flooring), 0/10/15% waste factor, line totals + grand total
4. **Work the list** — check items off as you buy them ("7 of 12 bought"), save named lists, print a checkbox checklist for the store run

If you paste your own `OPENAI_API_KEY` (stored only in this browser's localStorage), the app will polish your rough description before generating — but the generator works 100% offline with zero keys.

## Run it

No build step. No dependencies. Just open `index.html` in a browser — or serve it:

```bash
cd materiallist-ai
python3 -m http.server 8080
# open http://localhost:8080
```

All data (current list, check-offs, saved lists, optional API key) lives in `localStorage`. Nothing leaves your device. Prices are rough estimates — confirm at your supplier.

## How it works

- `js/materials.js` — pure-logic engine: 9 trade material banks, `parseQuantities`, `generateList`, `applyWaste`, `estimateCost` (shared by browser and tests)
- `js/app.js` — UI: input, takeoff table, bought-checklist + progress, saved-list library, print, optional AI polish
- `css/style.css` — clean responsive UI + print-friendly checklist CSS

## Pricing vision

- **Free** — full takeoff generator, local only (this repo)
- **Pro** — supplier price feeds, crew sharing, job costing history
- **Affiliate** — "buy this list" deep links to supply houses

## Tests

```bash
bash test/smoke.sh   # 11 checks: files, syntax, trade banks, waste math, cost reconciliation
bash test/e2e.sh     # 7 end-to-end flows via Node
```

## License

MIT — built free, no paid services.
