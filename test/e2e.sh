#!/usr/bin/env bash
# materiallist-ai e2e tests — 16 flows exercised through the real materials logic in Node.
set -u
cd "$(dirname "$0")/.."

node << 'EOF'
require('./js/materials.js');
var ML = globalThis.ML;
var failures = 0, flowCount = 0;
function flow(name, fn) {
  flowCount++;
  try { fn(); console.log('PASS: ' + name); }
  catch (e) { failures++; console.log('FAIL: ' + name + ' — ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function names(r) { return r.items.map(function (i) { return i.name; }); }

// 1. Kitchen remodel (carpentry) yields cabinet + lumber items.
flow('kitchen remodel generates cabinet/lumber items', function () {
  var r = ML.generateList({
    jobText: 'Kitchen remodel: install 6 base cabinets and 4 wall cabinets with butcher block countertop, frame one new wall',
    trade: 'carpentry'
  });
  var n = names(r);
  assert(n.indexOf('Base cabinet 24 in') !== -1, 'missing base cabinets');
  assert(n.indexOf('Wall cabinet 30 in') !== -1, 'missing wall cabinets');
  assert(n.indexOf('Butcher block countertop 8 ft') !== -1, 'missing countertop');
  assert(n.indexOf('2x4 x 8 ft stud (SPF)') !== -1, 'missing studs for new wall');
  console.log('   (' + r.items.length + ' items for kitchen remodel)');
});

// 2. "200 sq ft" flooring job scales LVP to exactly 200 sq ft before waste.
flow('200 sq ft flooring job scales per-sqft materials', function () {
  var r = ML.generateList({
    jobText: 'Install luxury vinyl plank in 200 sq ft living room',
    trade: 'flooring'
  });
  assert(r.quantities.sqft === 200, 'expected sqft=200, got ' + r.quantities.sqft);
  var lvp = r.items.filter(function (i) { return i.name === 'Luxury vinyl plank (per sq ft)'; })[0];
  assert(lvp, 'missing LVP item');
  assert(lvp.qty === 200, 'expected LVP qty 200, got ' + lvp.qty);
  assert(lvp.unit === 'sq ft', 'expected unit sq ft, got ' + lvp.unit);
});

// 3. Waste 15% inflates every quantity vs 0%.
flow('waste 15% inflates quantities', function () {
  var r = ML.generateList({ jobText: 'Install luxury vinyl plank in 200 sq ft living room', trade: 'flooring' });
  var w0 = ML.applyWaste(r.items, 0);
  var w15 = ML.applyWaste(r.items, 15);
  assert(w15.length === w0.length, 'item count changed');
  w15.forEach(function (it, i) {
    assert(it.qty >= w0[i].qty, it.name + ': 15% qty ' + it.qty + ' < 0% qty ' + w0[i].qty);
  });
  var lvp15 = w15.filter(function (i) { return i.name === 'Luxury vinyl plank (per sq ft)'; })[0];
  assert(lvp15.qty === 230, 'expected 230 sq ft with 15% waste, got ' + lvp15.qty);
});

// 4. Cost lines sum to the grand total (waste-adjusted).
flow('cost column sums to grand total', function () {
  var r = ML.generateList({ jobText: 'Reroof 1200 sq ft house with shingles and underlayment', trade: 'roofing' });
  var cost = ML.estimateCost(ML.applyWaste(r.items, 10));
  var sum = cost.lines.reduce(function (s, l) { return s + l.lineTotal; }, 0);
  assert(Math.abs(sum - cost.total) < 0.005, 'sum ' + sum + ' != total ' + cost.total);
  assert(cost.total > 0, 'total should be positive');
  console.log('   (roofing estimate: $' + cost.total.toFixed(2) + ')');
});

// 5. Empty / nonsense input degrades gracefully (no throw, staple fallback).
flow('empty input handled gracefully', function () {
  var r1 = ML.generateList({ jobText: '', trade: 'plumbing' });
  assert(Array.isArray(r1.items), 'items not an array');
  assert(r1.items.length > 0, 'empty input should fall back to trade staples');
  var r2 = ML.generateList({ jobText: 'asdf qwerty zzz', trade: 'bogus-trade' });
  assert(r2.trade === 'carpentry', 'unknown trade should fall back to carpentry');
  assert(r2.items.length > 0, 'gibberish should still yield staples');
  var cost = ML.estimateCost(ML.applyWaste(r2.items, 0));
  assert(cost.total > 0, 'fallback list should still price out');
});

// 6. Every trade bank has >= 5 materials, all with positive prices.
flow('every trade bank has 5+ priced materials', function () {
  Object.keys(ML.TRADES).forEach(function (k) {
    var mats = ML.TRADES[k].materials;
    assert(mats.length >= 5, k + ' has only ' + mats.length + ' materials');
    mats.forEach(function (m) {
      assert(m.unitPrice > 0, k + '/' + m.name + ' has non-positive price');
      assert(m.name && m.unit, k + ' has material missing name/unit');
    });
  });
  console.log('   (9 trades validated)');
});

// 7. parseQuantities extracts sq ft, linear ft, and room counts.
flow('parseQuantities extracts numbers+units', function () {
  var q = ML.parseQuantities('Remodel 3 bedrooms, about 200 sq ft of flooring, plus 12 ft of baseboard');
  assert(q.rooms === 3, 'expected 3 rooms, got ' + q.rooms);
  assert(q.sqft === 200, 'expected 200 sqft, got ' + q.sqft);
  assert(q.linearFt === 12, 'expected 12 linear ft, got ' + q.linearFt);
  var q2 = ML.parseQuantities('no numbers here');
  assert(q2.sqft === 0 && q2.linearFt === 0 && q2.rooms === 0, 'expected all zeros');
});

// 8. Stepper journey: bump qty up, clamp at zero, totals follow.
flow('quantity steppers adjust totals', function () {
  var r = ML.generateList({ jobText: 'Install luxury vinyl plank in 200 sq ft living room', trade: 'flooring' });
  var items = ML.applyWaste(r.items, 10);
  var idx = items.map(function (i) { return i.name; }).indexOf('Luxury vinyl plank (per sq ft)');
  var before = ML.estimateCost(items).total;
  var bumped = ML.adjustItemQty(items, idx, 10);
  var after = ML.estimateCost(bumped).total;
  assert(after > before, 'total should grow after +10 sq ft');
  var zeroed = ML.adjustItemQty(items, idx, -10000);
  assert(zeroed[idx].qty === 0, 'qty should clamp at 0');
  var ztotal = ML.estimateCost(zeroed).total;
  assert(ztotal < before, 'zeroing the main item should shrink the total');
  console.log('   ($' + before.toFixed(2) + ' -> $' + after.toFixed(2) + ' -> $' + ztotal.toFixed(2) + ')');
});

// 9. Custom item journey: add, price, appears in cost and CSV.
flow('custom item added to takeoff', function () {
  var items = [{ name: 'A', qty: 2, unit: 'each', unitPrice: 5, note: '' }];
  var withCustom = ML.addCustomItem(items, { name: 'Specialty screws', qty: 3, unit: 'box', unitPrice: 12.99 });
  assert(withCustom.length === 2, 'custom item appended');
  var cost = ML.estimateCost(withCustom);
  assert(Math.abs(cost.total - (10 + 38.97)) < 0.01, 'total should include custom item, got ' + cost.total);
  var csv = ML.listToCSV(withCustom, [false, false]);
  assert(csv.indexOf('Specialty screws') !== -1, 'custom item missing from CSV');
  console.log('   (total $' + cost.total.toFixed(2) + ' includes custom line)');
});

// 10. Remaining-cost journey: buy half the list, remaining shrinks accordingly.
flow('remaining cost tracks check-offs', function () {
  var r = ML.generateList({ jobText: 'Reroof 1200 sq ft house with shingles and underlayment', trade: 'roofing' });
  var items = ML.applyWaste(r.items, 10);
  var rc0 = ML.remainingCost(items, items.map(function () { return false; }));
  assert(Math.abs(rc0.remaining - rc0.total) < 0.01, 'nothing bought -> remaining == total');
  var bought = items.map(function (_, i) { return i < Math.floor(items.length / 2); });
  var rc1 = ML.remainingCost(items, bought);
  assert(rc1.remaining < rc0.total && rc1.remaining > 0, 'partial buy should split the total');
  assert(Math.abs(rc1.remaining + rc1.boughtTotal - rc1.total) < 0.01, 'split must reconcile');
  var all = ML.remainingCost(items, items.map(function () { return true; }));
  assert(all.remaining === 0, 'all bought -> $0 remaining');
  console.log('   (' + ML.fmtMoney(rc0.total) + ' total -> ' + ML.fmtMoney(rc1.remaining) + ' remaining)');
});

// 11. Duplicate journey: cloned entry keeps items/progress under a new id.
flow('saved list duplicates cleanly', function () {
  var entry = {
    id: 'l_orig', name: 'Smith kitchen', savedAt: '2026-10-01T00:00:00.000Z',
    trade: 'carpentry', jobText: 'x', wastePct: 10,
    baseItems: [], items: [{ name: 'A', qty: 2, unit: 'each', unitPrice: 5 }],
    bought: [true], custom: [{ name: 'C', qty: 1, unit: 'each', unitPrice: 9 }]
  };
  var copy = ML.cloneListEntry(entry, 'l_copy');
  assert(copy.id === 'l_copy' && copy.id !== entry.id, 'fresh id required');
  assert(copy.name === 'Smith kitchen (copy)', 'copy name wrong: ' + copy.name);
  assert(copy.items.length === 1 && copy.bought[0] === true, 'items/progress carried over');
  assert(copy.custom.length === 1, 'custom items carried over');
  assert(copy.savedAt !== entry.savedAt, 'savedAt should refresh');
});

flow('quoting flow: reroof estimate yields per-sq-ft material cost', function () {
  var gen = ML.generateList({ jobText: 'Reroof 1200 sq ft house with shingles', trade: 'roofing' });
  assert(gen.quantities.sqft === 1200, 'sqft parsed');
  var items = ML.applyWaste(gen.items, 10);
  var cpu = ML.costPerUnit(items, gen.quantities);
  assert(cpu.breakdown.length === 1 && cpu.breakdown[0].unit === 'sq ft', 'sq-ft breakdown');
  assert(Math.abs(cpu.breakdown[0].per - cpu.total / 1200) < 0.01, 'per-sqft math');
  console.log('   (roofing materials: ' + ML.fmtMoney(cpu.breakdown[0].per) + ' / sq ft on ' + ML.fmtMoney(cpu.total) + ')');
});

flow('receipt flow: actual store prices vs estimate variance', function () {
  var gen = ML.generateList({ jobText: 'Install luxury vinyl plank in 200 sq ft living room with new quarter-round trim and transition strips', trade: 'flooring' });
  var items = ML.applyWaste(gen.items, 0);
  assert(items.length >= 2, 'takeoff has 2+ items');
  var actuals = items.map(function () { return null; });
  // Contractor buys the first two items, prices differ from estimate
  actuals[0] = Math.round(items[0].unitPrice * 1.1 * 100) / 100; // 10% over
  actuals[1] = Math.round(items[1].unitPrice * 0.9 * 100) / 100; // 10% under
  var v = ML.applyActuals(items, actuals);
  assert(v.recorded === 2, 'two actuals recorded');
  var expect = Math.round(((actuals[0] - items[0].unitPrice) * items[0].qty +
    (actuals[1] - items[1].unitPrice) * items[1].qty) * 100) / 100;
  assert(Math.abs(v.variance - expect) < 0.02, 'variance reconciles: ' + v.variance + ' vs ' + expect);
  console.log('   (receipt variance: ' + ML.fmtMoney(v.variance) + ' over ' + v.recorded + ' lines)');
});

flow('forgotten-staples flow: missing staples offered and addable', function () {
  var gen = ML.generateList({ jobText: 'Hang 200 sq ft of drywall', trade: 'drywall' });
  var items = ML.applyWaste(gen.items, 10);
  var missing = ML.forgottenStaples('drywall', items);
  assert(missing.length > 0, 'some staples missing from a keyword takeoff');
  var withStaple = ML.addCustomItem(items, {
    name: missing[0].name, qty: 1, unit: missing[0].unit, unitPrice: missing[0].unitPrice
  });
  var missing2 = ML.forgottenStaples('drywall', withStaple);
  assert(missing2.length === missing.length - 1, 'adding a staple clears it from the missing list');
  assert(missing.every(function (s) { return s.unitPrice > 0; }), 'staples carry prices');
  console.log('   (' + missing.length + ' staples flagged, e.g. ' + missing[0].name + ')');
});

flow('price-book flow: remember actuals once, future lists use your prices', function () {
  var gen = ML.generateList({ jobText: 'tape and mud 200 sq ft drywall joints', trade: 'drywall' });
  var items = ML.applyWaste(gen.items, 10);
  var actuals = items.map(function () { return null; });
  actuals[0] = Math.round(items[0].unitPrice * 0.9 * 100) / 100; // found it cheaper
  var rb = ML.rememberPrices({}, items, actuals);
  assert(rb.added === 1, 'one price remembered');
  // a fresh list for a similar job picks up the remembered price
  var gen2 = ML.generateList({ jobText: 'tape and mud 300 sq ft drywall joints', trade: 'drywall' });
  var items2 = ML.applyPriceBook(ML.applyWaste(gen2.items, 10), rb.book);
  var same = null;
  items2.forEach(function (it) {
    if (it.name === items[0].name) same = it;
  });
  assert(same && same.unitPrice === actuals[0] && same.bookPrice === true, 'remembered price applied + tagged');
  console.log('   (price book: ' + items[0].name + ' @ ' + ML.fmtMoney(actuals[0]) + ')');
});

flow('totals flow: discount + tax quote math for a customer', function () {
  var gen = ML.generateList({ jobText: 'Reroof 1200 sq ft house: shingles and underlayment', trade: 'roofing' });
  var items = ML.applyWaste(gen.items, 10);
  var t = ML.applyTotals(items, 7.5, 5);
  var sub = ML.estimateCost(items).total;
  assert(t.subtotal === sub, 'subtotal = estimate');
  assert(Math.abs(t.discountAmt - sub * 0.05) < 0.02, 'discount = 5% of subtotal');
  var taxable = sub - t.discountAmt;
  assert(Math.abs(t.taxAmt - taxable * 0.075) < 0.02, 'tax on discounted amount');
  assert(Math.abs(t.grandTotal - (taxable + t.taxAmt)) < 0.02, 'grand total reconciles');
  var q = ML.buildQuote(items, { business: 'Acme Roofing', customer: 'Smith', taxPct: 7.5, discountPct: 5 });
  assert(q.totals.grandTotal === t.grandTotal, 'quote uses the same totals');
  assert(q.lines.length === items.length, 'quote carries every line item');
  console.log('   (quote grand total: ' + ML.fmtMoney(q.totals.grandTotal) + ')');
});

if (failures) { console.log('E2E: ' + failures + ' flow(s) FAILED'); process.exit(1); }
console.log('E2E: ' + flowCount + '/' + flowCount + ' flows passed');
EOF
