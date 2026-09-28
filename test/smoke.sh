#!/usr/bin/env bash
# materiallist-ai smoke tests — 11 checks. Exit non-zero on first failure.
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

echo "SMOKE: $PASS/11 passed"
