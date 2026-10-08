#!/usr/bin/env bash
# materiallist-ai smoke tests — 17 checks. Exit non-zero on first failure.
set -u
cd "$(dirname "$0")/.."
PASS=0
check() { # $1 = description, rest = command
  local desc="$1"; shift
  if "$@" > /tmp/ml_smoke.log 2>&1; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc"; sed 's/^/  /' /tmp/ml_smoke.log | head -20; exit 1
  fi
}

check "index.html exists" test -f index.html
check "css/style.css exists" test -f css/style.css
check "js/materials.js exists" test -f js/materials.js
check "js/app.js exists" test -f js/app.js
check "README.md exists" test -f README.md
check "materials.js syntax valid" node --check js/materials.js
check "app.js syntax valid" node --check js/app.js
check "TRADES has 9 trades with labels and materials" node -e "
  require('./js/materials.js');
  var T = globalThis.ML.TRADES;
  var keys = Object.keys(T);
  var want = ['electrical','plumbing','hvac','carpentry','drywall','roofing','flooring','masonry','landscaping'];
  want.forEach(function (k) {
    if (!T[k]) { console.error('missing trade ' + k); process.exit(1); }
    if (!T[k].label) { console.error('no label for ' + k); process.exit(1); }
    if (!Array.isArray(T[k].materials) || T[k].materials.length === 0) { console.error('no materials for ' + k); process.exit(1); }
  });
  if (keys.length !== 9) { console.error('expected 9 trades, got ' + keys.length); process.exit(1); }
  console.log('9 trades ok');
"
check "generateList returns priced items for 2+ trades" node -e "
  require('./js/materials.js');
  var ML = globalThis.ML;
  [['Install luxury vinyl plank in 200 sq ft living room', 'flooring'],
   ['Rewire 2 bedrooms with new outlets and recessed lights', 'electrical'],
   ['Reroof 1200 sq ft house with shingles', 'roofing']].forEach(function (pair) {
    var r = ML.generateList({ jobText: pair[0], trade: pair[1] });
    if (!r.items.length) { console.error('no items for ' + pair[1]); process.exit(1); }
    r.items.forEach(function (it, i) {
      if (!it.name || !(it.qty > 0) || !it.unit || !(it.unitPrice > 0)) {
        console.error('bad item ' + i + ' in ' + pair[1] + ': ' + JSON.stringify(it)); process.exit(1);
      }
    });
    console.log(pair[1] + ': ' + r.items.length + ' items');
  });
"
check "waste math: 0% unchanged, 15% inflates" node -e "
  require('./js/materials.js');
  var ML = globalThis.ML;
  var base = [{ name: 'X', qty: 100, unit: 'sq ft', unitPrice: 1, note: '' },
              { name: 'Y', qty: 10, unit: 'each', unitPrice: 2, note: '' }];
  var w0 = ML.applyWaste(base, 0);
  if (w0[0].qty !== 100 || w0[1].qty !== 10) { console.error('0% changed qty'); process.exit(1); }
  var w15 = ML.applyWaste(base, 15);
  if (w15[0].qty !== 115) { console.error('bulk 15% wrong: ' + w15[0].qty); process.exit(1); }
  if (w15[1].qty !== 12) { console.error('countable 15% should ceil to 12, got ' + w15[1].qty); process.exit(1); }
  console.log('waste ok');
"
check "estimateCost lines reconcile to total" node -e "
  require('./js/materials.js');
  var ML = globalThis.ML;
  var r = ML.generateList({ jobText: 'Install luxury vinyl plank in 200 sq ft living room', trade: 'flooring' });
  var items = ML.applyWaste(r.items, 10);
  var cost = ML.estimateCost(items);
  var sum = cost.lines.reduce(function (s, l) { return s + l.lineTotal; }, 0);
  if (Math.abs(sum - cost.total) > 0.005) { console.error('sum ' + sum + ' != total ' + cost.total); process.exit(1); }
  cost.lines.forEach(function (l) {
    var expect = Math.round(l.qty * l.unitPrice * 100) / 100;
    if (Math.abs(expect - l.lineTotal) > 0.005) { console.error('line mismatch ' + l.name); process.exit(1); }
  });
  console.log('total $' + cost.total.toFixed(2) + ' reconciles across ' + cost.lines.length + ' lines');
"

check "adjustItemQty: +/- delta, clamps at 0, rounds to 2" node -e "
  require('./js/materials.js');
  var ML = globalThis.ML;
  var base = [{ name: 'A', qty: 5, unit: 'each', unitPrice: 2, note: '' },
              { name: 'B', qty: 0.5, unit: 'sq ft', unitPrice: 1, note: '' }];
  var up = ML.adjustItemQty(base, 0, 1);
  if (up[0].qty !== 6 || base[0].qty !== 5) { console.error('inc wrong or mutated'); process.exit(1); }
  var down = ML.adjustItemQty(base, 0, -10);
  if (down[0].qty !== 0) { console.error('should clamp at 0, got ' + down[0].qty); process.exit(1); }
  var frac = ML.adjustItemQty(base, 1, 0.333);
  if (frac[1].qty !== 0.83) { console.error('rounding wrong: ' + frac[1].qty); process.exit(1); }
  var oob = ML.adjustItemQty(base, 9, 1);
  if (oob.length !== 2 || oob[0].qty !== 5) { console.error('oob index changed array'); process.exit(1); }
  console.log('adjust ok');
"
check "addCustomItem: appends valid item, throws on bad input" node -e "
  require('./js/materials.js');
  var ML = globalThis.ML;
  var out = ML.addCustomItem([], { name: 'Extra screws', qty: 2, unit: 'box', unitPrice: 9.99 });
  if (out.length !== 1 || out[0].name !== 'Extra screws' || out[0].custom !== true) {
    console.error('append wrong: ' + JSON.stringify(out)); process.exit(1);
  }
  [['', 2], ['x', 0], ['x', -1], ['x', 2, -5]].forEach(function (c) {
    var threw = false;
    try { ML.addCustomItem([], { name: c[0], qty: c[1], unitPrice: c[2] || 0 }); } catch (e) { threw = true; }
    if (!threw) { console.error('should throw for ' + JSON.stringify(c)); process.exit(1); }
  });
  console.log('addCustomItem ok');
"
check "remainingCost: bought/remaining split reconciles to total" node -e "
  require('./js/materials.js');
  var ML = globalThis.ML;
  var r = ML.generateList({ jobText: 'Install luxury vinyl plank in 200 sq ft living room', trade: 'flooring' });
  var items = ML.applyWaste(r.items, 10);
  var bought = items.map(function (_, i) { return i === 0; });
  var rc = ML.remainingCost(items, bought);
  var cost = ML.estimateCost(items);
  if (Math.abs(rc.total - cost.total) > 0.005) { console.error('total mismatch'); process.exit(1); }
  if (Math.abs(rc.remaining + rc.boughtTotal - rc.total) > 0.01) { console.error('split mismatch'); process.exit(1); }
  if (Math.abs(rc.boughtTotal - cost.lines[0].lineTotal) > 0.005) { console.error('boughtTotal wrong'); process.exit(1); }
  console.log('remaining \$' + rc.remaining + ' of \$' + rc.total);
"
check "listToCSV: header + rows with bought yes/no" node -e "
  require('./js/materials.js');
  var ML = globalThis.ML;
  var items = [{ name: 'A', qty: 2, unit: 'each', unitPrice: 5, note: '' },
               { name: 'B, special', qty: 1, unit: 'box', unitPrice: 9.99, note: '' }];
  var csv = ML.listToCSV(items, [true, false]);
  var lines = csv.split('\n');
  if (lines[0] !== 'item,qty,unit,unit_price,line_total,bought,note') { console.error('header: ' + lines[0]); process.exit(1); }
  if (lines.length !== 3) { console.error('rows=' + lines.length); process.exit(1); }
  if (lines[1].indexOf(',yes,') === -1 || lines[2].indexOf(',no,') === -1) { console.error('bought flags'); process.exit(1); }
  if (lines[2].indexOf('\"B, special\"') !== 0) { console.error('quoting: ' + lines[2]); process.exit(1); }
  console.log('csv ok');
"
check "cloneListEntry: fresh id, (copy) name, deep copy" node -e "
  require('./js/materials.js');
  var ML = globalThis.ML;
  var entry = { id: 'l1', name: 'Kitchen', items: [{ name: 'A', qty: 1 }], bought: [true] };
  var copy = ML.cloneListEntry(entry, 'l2');
  if (copy.id !== 'l2' || copy.name !== 'Kitchen (copy)') { console.error('id/name wrong'); process.exit(1); }
  copy.items[0].qty = 99;
  if (entry.items[0].qty !== 1) { console.error('not a deep copy'); process.exit(1); }
  var threw = false;
  try { ML.cloneListEntry(null); } catch (e) { threw = true; }
  if (!threw) { console.error('null entry should throw'); process.exit(1); }
  console.log('clone ok');
"
check "index.html has new control ids" sh -c '
  for id in csvBtn addItemBtn customForm cName cQty cUnit cPrice cAdd cCancel; do
    grep -q "id=\"$id\"" index.html || { echo "missing id=$id"; exit 1; }
  done'

echo "SMOKE: $PASS/17 passed"
