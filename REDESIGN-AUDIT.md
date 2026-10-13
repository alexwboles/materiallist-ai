# REDESIGN-AUDIT — materiallist-ai (2026-10-13)

Competitors referenced: **Sortly** (visual item lists, category folders, low-stock alerts, custom fields, CSV/PDF reports), **Home Depot Pro / Pro Xtra** (job-lot material lists, volume pricing, quote center), **Buildxact** (takeoff tables, supplier quote comparison).

## Visual gaps vs competitors
- The load-out progress (boughtBar + boughtLabel) is a thin bar with a text line. The jobsite question — "what's left to buy and what will it cost?" — deserves a hero strip: % loaded, remaining $, items left.
- Takeoff rows are uniform; bought rows dim but there's no way to filter to "remaining only" (Sortly's core view pattern for a shopping run).
- The customer quote sheet (`quoteDoc`) is a plain header + table. A contractor quote should read like a document: letterhead, quote stamp, prepared-for block, ruled table, total hero, terms, signature line.

## Functional gaps vs competitors
1. **No "remaining only" filter** for the shopping run — bought items can't be hidden.
2. No per-category subtotals (Sortly folders) — the list is one flat table. Bounded out: categories don't exist in the data model; the hide-bought filter covers the shopping-run job.
3. Quote sheet lacks a total hero and prepared-for/job context hierarchy.

## What this redesign does (bounded)
- **Load-out hero strip**: big % loaded, remaining-$ hero, "x of y bought" — the tape-measure bar stays, now with oversized numerals.
- **"Remaining only" toggle**: checkbox filters the takeoff to unbought items for the supply-house run (indices preserved; bought state untouched).
- **Quote sheet restyle**: letterhead masthead (business in display type + MATERIALS QUOTE stamp), quote no/date block, prepared-for + job cards, ruled items table with tabular figures, total hero band, terms, signature line. Print path unchanged.
- Identity stays "Jobsite Clipboard" — charcoal band + hazard tape, forest-green accent, graph-paper input card, invoice-style takeoff.
- All existing features preserved: AI + library generation, qty steppers, custom items, actual-price variance, forgotten-staples check, cost-per-unit, tax + discount totals, CSV export, price book, saved lists, waste toggle.
