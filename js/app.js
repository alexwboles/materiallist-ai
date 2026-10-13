/* materiallist-ai app
 * UI wiring: input -> ML pipeline -> takeoff table -> checklist -> localStorage library.
 * Browser only; materials.js stays pure.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return; // Node-safe: tests load materials.js only
  var ML = window.ML;

  var LS_LISTS = 'mlai.lists';
  var LS_CURRENT = 'mlai.current';
  var LS_KEY = 'mlai.openai_key';
  var LS_BOOK = 'mlai.pricebook';
  var LS_TAX = 'mlai.tax';
  var LS_DISC = 'mlai.discount';

  var SAMPLE_JOBS = {
    carpentry: 'Kitchen remodel: install 6 base cabinets and 4 wall cabinets with butcher block countertop, frame one new 12 ft partition wall',
    electrical: 'Rewire 2 bedrooms: add 4 outlets and 2 switches per room, 3 recessed lights per room, new 20A breaker',
    plumbing: 'Rough-in for 2 bathrooms: PEX supply lines, 2 shut-off valves per room, new toilet and sink drains',
    hvac: 'Add ductwork to 3 rooms: new supply runs, registers in each room, seal with mastic',
    drywall: 'Finish 200 sq ft of drywall: hang sheets, tape and mud joints, prime and paint',
    roofing: 'Reroof 1200 sq ft house: tear-off, new shingles, underlayment, drip edge, ridge cap',
    flooring: 'Install luxury vinyl plank in 200 sq ft living room with new quarter-round trim',
    masonry: 'Pour 100 sq ft concrete pad 4 in thick with gravel base and rebar',
    landscaping: 'New 300 sq ft mulch bed with edging, fabric, and topsoil; lay 200 sq ft of sod'
  };

  var current = null;   // { name, trade, jobText, wastePct, baseItems, items, bought[] }
  var wastePct = 10;
  var taxPct = 8.25;
  var discountPct = 0;

  function getBook() { return loadJSON(LS_BOOK, {}); }
  function getTax() {
    var t = loadJSON(LS_TAX, null);
    taxPct = t == null ? 8.25 : Math.max(0, Number(t) || 0);
    return taxPct;
  }
  function getDisc() {
    var d = loadJSON(LS_DISC, null);
    discountPct = d == null ? 0 : Math.min(100, Math.max(0, Number(d) || 0));
    return discountPct;
  }

  function $(id) { return document.getElementById(id); }

  function loadJSON(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full/blocked */ }
  }

  // ---------- input setup ----------

  function buildTradeSelect() {
    var sel = $('tradeSelect');
    ML.tradeKeys().forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = ML.TRADES[k].label;
      sel.appendChild(opt);
    });
    sel.value = 'carpentry';
  }

  function buildWasteToggle() {
    var box = $('wasteToggle');
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-waste]');
      if (!btn) return;
      wastePct = parseInt(btn.getAttribute('data-waste'), 10);
      box.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      if (current) regenerate(current.baseItems, current.jobText, current.trade, current.name);
    });
  }

  // ---------- generation pipeline ----------

  function regenerate(baseItems, jobText, trade, name, quantities) {
    var items = ML.applyWaste(baseItems, wastePct);
    var custom = current && current.custom ? current.custom.slice() : [];
    var bought = current && current.bought ? current.bought.slice() : [];
    var actuals = current && current.actuals ? current.actuals.slice() : [];
    current = { name: name || '', trade: trade, jobText: jobText, wastePct: wastePct,
                baseItems: baseItems, items: items, bought: bought, custom: custom,
                actuals: actuals, quantities: quantities || (current && current.quantities) || null };
    saveJSON(LS_CURRENT, current);
    renderList();
  }

  // Hand-added items ride alongside the generated takeoff (never waste-adjusted).
  // The price book overrides unit prices with the user's remembered store prices.
  function mergedItems() {
    if (!current) return [];
    return ML.applyPriceBook(current.items.concat(current.custom || []), getBook());
  }
  function mergedBought() {
    if (!current) return [];
    var n = mergedItems().length;
    while (current.bought.length < n) current.bought.push(false);
    return current.bought;
  }
  function mergedActuals() {
    if (!current) return [];
    if (!current.actuals) current.actuals = [];
    var n = mergedItems().length;
    while (current.actuals.length < n) current.actuals.push(null);
    return current.actuals;
  }
  function persistCurrent() { saveJSON(LS_CURRENT, current); }

  // Keep the saved-library copy in sync when the open list changes.
  function syncSavedBought() {
    if (current && current.name) {
      var lists = getLists();
      var match = lists.filter(function (l) { return l.name === current.name; })[0];
      if (match) {
        match.bought = current.bought;
        match.items = current.items;
        match.custom = current.custom;
        match.actuals = current.actuals;
        match.quantities = current.quantities;
        saveJSON(LS_LISTS, lists);
        renderLibrary();
      }
    }
  }

  function downloadFile(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function runGeneration(jobText, trade) {
    var result = ML.generateList({ jobText: jobText, trade: trade });
    regenerate(result.items, jobText, trade, '', result.quantities);
    var n = result.items.length;
    $('genMsg').textContent = n ? ('Found ' + n + ' materials.') : 'No materials matched — saved as empty.';
    setTimeout(function () { $('genMsg').textContent = ''; }, 4000);
  }

  // Optional AI polish: best-effort, never required, never blocks.
  function maybePolishThenGenerate(jobText, trade) {
    var key = '';
    try { key = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
    if (!key) { runGeneration(jobText, trade); return; }
    var btn = $('generateBtn');
    btn.disabled = true;
    btn.textContent = 'Polishing…';
    polishDescription(jobText, key).then(function (polished) {
      if (polished && polished !== jobText) {
        $('jobText').value = polished;
        jobText = polished;
      }
      runGeneration(jobText, trade);
    }).catch(function () {
      runGeneration(jobText, trade); // degrade gracefully
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = 'Generate materials list';
    });
  }

  function polishDescription(text, key) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 12000);
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          { role: 'system', content: 'You rewrite a contractor\'s rough job description into one clear sentence, keeping every size, count, and material mentioned. Output only the rewritten description, no quotes.' },
          { role: 'user', content: text }
        ]
      }),
      signal: ctrl.signal
    }).then(function (resp) {
      clearTimeout(timer);
      if (!resp.ok) throw new Error('ai ' + resp.status);
      return resp.json();
    }).then(function (data) {
      var out = data && data.choices && data.choices[0] &&
                data.choices[0].message && data.choices[0].message.content;
      return (out || '').trim() || text;
    }).catch(function () { return text; });
  }

  // ---------- rendering ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderList() {
    var items = mergedItems();
    if (!current || !items.length) {
      $('listSection').style.display = 'none';
      return;
    }
    var bought = mergedBought();
    var actuals = mergedActuals();
    var hideBought = $('hideBought') && $('hideBought').checked;
    $('listSection').style.display = '';
    $('listTrade').textContent = '· ' + ML.TRADES[current.trade].label + ' · ' + wastePct + '% waste';
    var cost = ML.estimateCost(items);
    var body = $('takeoffBody');
    body.innerHTML = '';
    cost.lines.forEach(function (line, i) {
      if (hideBought && bought[i]) return; // supply-house run: remaining only
      var tr = document.createElement('tr');
      if (bought[i]) tr.className = 'bought';
      var note = line.note ? '<div class="item-note">' + esc(line.note) + '</div>' : '';
      var av = actuals[i];
      var bookTag = items[i].bookPrice ? ' <span class="book-tag" title="Your remembered store price">your price</span>' : '';
      tr.innerHTML =
        '<td class="no-print"><input type="checkbox" class="buy-check" data-i="' + i + '"' +
        (bought[i] ? ' checked' : '') + ' aria-label="Bought: ' + esc(line.name) + '"></td>' +
        '<td class="item-name">' + esc(line.name) + note + '</td>' +
        '<td class="num"><button type="button" class="stepper" data-act="dec" data-i="' + i + '" aria-label="Decrease quantity">−</button>' +
        '<span class="qty-val">' + line.qty + '</span>' +
        '<button type="button" class="stepper" data-act="inc" data-i="' + i + '" aria-label="Increase quantity">+</button></td>' +
        '<td>' + esc(line.unit) + '</td>' +
        '<td class="num">' + ML.fmtMoney(line.unitPrice) + bookTag + '</td>' +
        '<td class="num">' + ML.fmtMoney(line.lineTotal) + '</td>' +
        '<td class="num no-print"><input type="number" class="actual-input" data-i="' + i + '" min="0" step="0.01" ' +
        'placeholder="—" value="' + (av == null ? '' : av) + '" aria-label="Actual unit price paid: ' + esc(line.name) + '"></td>';
      body.appendChild(tr);
    });
    // Totals: subtotal, optional discount + tax, grand total.
    var totals = ML.applyTotals(items, taxPct, discountPct);
    function totalRow(label, value, cls) {
      var tr = document.createElement('tr');
      tr.className = 'total-row' + (cls ? ' ' + cls : '');
      tr.innerHTML = '<td class="no-print"></td><td>' + label + '</td><td class="num"></td><td></td><td></td>' +
        '<td class="num">' + value + '</td><td class="no-print"></td>';
      body.appendChild(tr);
    }
    totalRow('Subtotal', ML.fmtMoney(totals.subtotal));
    if (totals.discountAmt > 0) {
      totalRow('Discount (' + totals.discountPct + '%)', '−' + ML.fmtMoney(totals.discountAmt));
    }
    if (totals.taxAmt > 0) {
      totalRow('Sales tax (' + totals.taxPct + '%)', ML.fmtMoney(totals.taxAmt));
    }
    totalRow('Estimated total', ML.fmtMoney(totals.grandTotal), 'grand');
    body.querySelectorAll('.actual-input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var i = parseInt(inp.getAttribute('data-i'), 10);
        var v = inp.value === '' ? null : parseFloat(inp.value);
        current.actuals[i] = (v == null || isNaN(v) || v < 0) ? null : Math.round(v * 100) / 100;
        persistCurrent(); syncSavedBought();
        renderVariance(items);
      });
    });
    renderCostPerUnit(items);
    renderVariance(items);
    renderStaples(items);
    updateProgress();
  }

  // Quoting helper: material cost per sq ft / linear ft / room.
  function renderCostPerUnit(items) {
    var box = $('costPerUnit');
    var cpu = ML.costPerUnit(items, current.quantities);
    if (!cpu.breakdown.length) { box.innerHTML = ''; return; }
    box.innerHTML = 'Quoting: ' + cpu.breakdown.map(function (b) {
      return '<strong>' + ML.fmtMoney(b.per) + '</strong> / ' + b.unit;
    }).join(' · ') + ' in materials';
  }

  // Actual-vs-estimate variance, from the "Paid $/u" column.
  // Offers to remember the actuals as the user's own price book.
  function renderVariance(items) {
    var box = $('varianceLine');
    var v = ML.applyActuals(items, mergedActuals());
    if (!v.recorded) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    var cls = v.variance > 0 ? 'over' : (v.variance < 0 ? 'under' : '');
    box.innerHTML = 'Actuals (' + v.recorded + '/' + v.of + ' lines): paid ' +
      '<strong>' + ML.fmtMoney(v.actTotal) + '</strong> vs est ' + ML.fmtMoney(v.estTotal) +
      ' — <strong class="' + cls + '">' + (v.variance > 0 ? '+' : '') + ML.fmtMoney(v.variance) + '</strong>' +
      ' <button type="button" class="ghost small no-print" id="rememberPricesBtn">Remember these prices</button>';
    var btn = $('rememberPricesBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        var res = ML.rememberPrices(getBook(), mergedItems(), mergedActuals());
        saveJSON(LS_BOOK, res.book);
        renderList();
        var msg = $('genMsg');
        var note = res.added
          ? 'Saved ' + res.added + ' price' + (res.added === 1 ? '' : 's') + ' to your price book — future lists use them.'
          : 'Those prices are already in your price book.';
        if (msg) { msg.textContent = note; setTimeout(function () { msg.textContent = ''; }, 4000); }
      });
    }
  }

  // Forgotten staples: trade staples missing from this list, one click to add.
  function renderStaples(items) {
    var box = $('staplesBox');
    var missing = ML.forgottenStaples(current.trade, items);
    if (!missing.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    box.innerHTML = '<h3>Don\u2019t forget these staples</h3>' +
      '<p class="muted small">Commonly-forgotten ' + esc(ML.TRADES[current.trade].label.toLowerCase()) +
      ' items missing from this list:</p>' +
      missing.map(function (s, i) {
        return '<div class="staple-row"><span>' + esc(s.name) +
          ' <span class="muted small">' + ML.fmtMoney(s.unitPrice) + '/' + esc(s.unit) + '</span></span>' +
          '<button type="button" class="ghost small staple-add" data-i="' + i + '">Add</button></div>';
      }).join('');
    box.querySelectorAll('.staple-add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = missing[parseInt(btn.getAttribute('data-i'), 10)];
        try {
          current.custom = ML.addCustomItem(current.custom || [], {
            name: s.name, qty: 1, unit: s.unit, unitPrice: s.unitPrice, note: s.note
          });
          persistCurrent(); syncSavedBought(); renderList();
        } catch (e) { /* validation already passed */ }
      });
    });
  }

  function updateProgress() {
    var items = mergedItems();
    var boughtArr = mergedBought();
    var bought = boughtArr.filter(Boolean).length;
    var total = items.length;
    var rc = ML.remainingCost(items, boughtArr);
    var t = ML.applyTotals(items, taxPct, discountPct);
    var frac = rc.total > 0 ? rc.remaining / rc.total : 0;
    var remainingGrand = Math.round(t.grandTotal * frac * 100) / 100;
    var pct = total ? Math.round(bought / total * 100) : 0;
    $('boughtLabel').textContent = bought + ' of ' + total + ' bought · ' +
      ML.fmtMoney(remainingGrand) + ' remaining of ' + ML.fmtMoney(t.grandTotal);
    $('loadPct').textContent = pct + '%';
    $('loadRemain').textContent = ML.fmtMoney(remainingGrand);
    $('boughtBar').style.width = pct + '%';
  }

  // ---------- library ----------

  function getLists() { return loadJSON(LS_LISTS, []); }

  function renderLibrary() {
    var lists = getLists();
    var box = $('libraryList');
    box.innerHTML = '';
    if (!lists.length) {
      box.innerHTML = '<p class="empty">No saved lists yet — generate one above and save it.</p>';
      return;
    }
    lists.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'lib-row';
      var bought = (entry.bought || []).filter(Boolean).length;
      var total = (entry.items || []).length;
      var when = entry.savedAt ? new Date(entry.savedAt).toLocaleDateString() : '';
      row.innerHTML =
        '<div><strong>' + esc(entry.name) + '</strong><br>' +
        '<span class="lib-meta">' + esc(ML.TRADES[entry.trade] ? ML.TRADES[entry.trade].label : entry.trade) +
        ' · ' + total + ' items · ' + bought + ' bought · ' + esc(when) + '</span></div>' +
        '<div class="row" style="margin:0">' +
        '<button type="button" class="small" data-load="' + entry.id + '">Load</button>' +
        '<button type="button" class="small" data-dup="' + entry.id + '">Duplicate</button>' +
        '<button type="button" class="danger" data-del="' + entry.id + '">Delete</button></div>';
      box.appendChild(row);
    });
  }

  function saveCurrentList() {
    if (!current || !current.items.length) return;
    var name = $('listName').value.trim();
    if (!name) {
      $('saveMsg').textContent = 'Give the list a name first.';
      $('listName').focus();
      return;
    }
    var lists = getLists();
    lists.unshift({
      id: 'l' + Date.now(),
      name: name,
      savedAt: new Date().toISOString(),
      trade: current.trade,
      jobText: current.jobText,
      wastePct: current.wastePct,
      baseItems: current.baseItems,
      items: current.items,
      bought: current.bought,
      custom: current.custom || [],
      actuals: current.actuals || [],
      quantities: current.quantities || null
    });
    saveJSON(LS_LISTS, lists.slice(0, 50));
    current.name = name;
    saveJSON(LS_CURRENT, current);
    $('saveMsg').textContent = 'Saved ✓';
    $('listName').value = '';
    setTimeout(function () { $('saveMsg').textContent = ''; }, 3000);
    renderLibrary();
  }

  function libraryClick(e) {
    var loadBtn = e.target.closest('[data-load]');
    var delBtn = e.target.closest('[data-del]');
    var dupBtn = e.target.closest('[data-dup]');
    var lists = getLists();
    if (loadBtn) {
      var entry = lists.filter(function (l) { return l.id === loadBtn.getAttribute('data-load'); })[0];
      if (!entry) return;
      wastePct = entry.wastePct || 10;
      document.querySelectorAll('#wasteToggle button').forEach(function (b) {
        b.classList.toggle('active', parseInt(b.getAttribute('data-waste'), 10) === wastePct);
      });
      $('tradeSelect').value = entry.trade;
      $('jobText').value = entry.jobText || '';
      current = null;
      regenerate(entry.baseItems || entry.items, entry.jobText || '', entry.trade, entry.name);
      current.custom = entry.custom || [];
      current.bought = entry.bought || [];
      current.actuals = entry.actuals || [];
      current.quantities = entry.quantities || null;
      persistCurrent();
      renderList();
      window.scrollTo({ top: $('listSection').offsetTop - 12, behavior: 'smooth' });
    } else if (dupBtn) {
      var src = lists.filter(function (l) { return l.id === dupBtn.getAttribute('data-dup'); })[0];
      if (!src) return;
      var fresh = getLists();
      fresh.unshift(ML.cloneListEntry(src));
      saveJSON(LS_LISTS, fresh.slice(0, 50));
      renderLibrary();
    } else if (delBtn) {
      var id = delBtn.getAttribute('data-del');
      saveJSON(LS_LISTS, lists.filter(function (l) { return l.id !== id; }));
      renderLibrary();
    }
  }

  // ---------- customer quote sheet ----------

  function defaultQuoteNo() {
    var stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return 'Q-' + stamp + '-001';
  }

  function showQuoteForm() {
    if (!current || !mergedItems().length) return;
    var f = $('quoteForm');
    f.style.display = f.style.display === 'none' ? '' : 'none';
    if (f.style.display !== 'none') {
      if (!$('qNo').value) $('qNo').value = defaultQuoteNo();
      if (!$('qDate').value) $('qDate').value = new Date().toISOString().slice(0, 10);
      if (!$('qJob').value) $('qJob').value = current.jobText || '';
      $('qBusiness').focus();
    }
  }

  function renderQuote() {
    var items = mergedItems();
    if (!items.length) return;
    var q = ML.buildQuote(items, {
      quoteNo: $('qNo').value,
      date: $('qDate').value,
      business: $('qBusiness').value,
      customer: $('qCustomer').value,
      job: $('qJob').value,
      terms: $('qTerms').value,
      taxPct: taxPct,
      discountPct: discountPct
    });
    var t = q.totals;
    var rows = q.lines.map(function (l) {
      return '<tr><td>' + esc(l.name) + '</td><td class="num">' + l.qty + '</td>' +
        '<td>' + esc(l.unit) + '</td><td class="num">' + ML.fmtMoney(l.unitPrice) + '</td>' +
        '<td class="num">' + ML.fmtMoney(l.lineTotal) + '</td></tr>';
    }).join('');
    var totalRows = '<tr><td colspan="4">Subtotal</td><td class="num">' + ML.fmtMoney(t.subtotal) + '</td></tr>';
    if (t.discountAmt > 0) {
      totalRows += '<tr><td colspan="4">Discount (' + t.discountPct + '%)</td><td class="num">−' +
        ML.fmtMoney(t.discountAmt) + '</td></tr>';
    }
    if (t.taxAmt > 0) {
      totalRows += '<tr><td colspan="4">Sales tax (' + t.taxPct + '%)</td><td class="num">' +
        ML.fmtMoney(t.taxAmt) + '</td></tr>';
    }
    totalRows += '<tr class="q-grand"><td colspan="4">Total</td><td class="num">' +
      ML.fmtMoney(t.grandTotal) + '</td></tr>';
    $('quoteDoc').innerHTML =
      '<div class="q-sheet">' +
      '<div class="q-mast"><div><div class="q-business">' + esc(q.business) + '</div>' +
      '<div class="q-tag">Materials quote · good faith estimate</div></div>' +
      '<div class="q-stamp">MATERIALS QUOTE<span>' + esc(q.quoteNo) + '</span></div></div>' +
      '<div class="q-meta2">' +
      (q.customer ? '<div class="q-card"><span class="q-cap">Prepared for</span><strong>' + esc(q.customer) + '</strong></div>' : '') +
      (q.job ? '<div class="q-card"><span class="q-cap">Job</span><strong>' + esc(q.job) + '</strong></div>' : '') +
      '<div class="q-card"><span class="q-cap">Date</span><strong>' + esc(q.date) + '</strong></div>' +
      '</div>' +
      '<table class="q-table"><thead><tr><th>Item</th><th class="num">Qty</th><th>Unit</th>' +
      '<th class="num">Unit price</th><th class="num">Line total</th></tr></thead>' +
      '<tbody>' + rows + '</tbody><tfoot>' + totalRows + '</tfoot></table>' +
      '<div class="q-total-hero"><span>Quote total</span><strong>' + ML.fmtMoney(t.grandTotal) + '</strong></div>' +
      '<p class="q-terms">' + esc(q.terms) + '</p>' +
      '<div class="q-sign"><div class="q-sign-line"></div><div class="muted small">Authorized signature · date</div></div>' +
      '</div>';
    $('quoteSection').style.display = '';
    $('quoteSection').scrollIntoView({ behavior: 'smooth' });
  }

  function printQuote() {
    document.body.classList.add('printing-quote');
    function done() {
      document.body.classList.remove('printing-quote');
      window.removeEventListener('afterprint', done);
    }
    window.addEventListener('afterprint', done);
    setTimeout(function () {
      window.print();
      setTimeout(done, 1000); // fallback: some browsers skip afterprint
    }, 60);
  }

  // ---------- events ----------

  function bind() {
    var hb = $('hideBought');
    if (hb) hb.addEventListener('change', function () { renderList(); });
    $('generateBtn').addEventListener('click', function () {
      var text = $('jobText').value.trim();
      if (!text) {
        $('genMsg').textContent = 'Describe the job first — or try a sample.';
        return;
      }
      maybePolishThenGenerate(text, $('tradeSelect').value);
    });

    $('sampleBtn').addEventListener('click', function () {
      var trade = $('tradeSelect').value;
      $('jobText').value = SAMPLE_JOBS[trade] || SAMPLE_JOBS.carpentry;
      maybePolishThenGenerate($('jobText').value.trim(), trade);
    });

    $('tradeSelect').addEventListener('change', function () {
      if (!$('jobText').value.trim()) return;
      // keep the sample hint fresh per trade without overwriting typed text
    });

    $('takeoffBody').addEventListener('change', function (e) {
      var chk = e.target.closest('.buy-check');
      if (!chk || !current) return;
      var i = parseInt(chk.getAttribute('data-i'), 10);
      mergedBought()[i] = chk.checked;
      persistCurrent();
      renderList();
      syncSavedBought();
    });

    $('takeoffBody').addEventListener('click', function (e) {
      var st = e.target.closest('.stepper');
      if (!st || !current) return;
      var i = parseInt(st.getAttribute('data-i'), 10);
      var delta = st.getAttribute('data-act') === 'inc' ? 1 : -1;
      var split = current.items.length;
      if (i < split) {
        current.items = ML.adjustItemQty(current.items, i, delta);
      } else {
        current.custom = ML.adjustItemQty(current.custom, i - split, delta);
      }
      persistCurrent();
      renderList();
      syncSavedBought();
    });

    $('saveListBtn').addEventListener('click', saveCurrentList);
    $('printBtn').addEventListener('click', function () { window.print(); });
    $('quoteBtn').addEventListener('click', showQuoteForm);
    $('quoteGenBtn').addEventListener('click', renderQuote);
    $('quotePrintBtn').addEventListener('click', printQuote);
    $('quoteCloseBtn').addEventListener('click', function () {
      $('quoteSection').style.display = 'none';
      $('quoteForm').style.display = 'none';
    });
    $('taxInput').addEventListener('change', function () {
      taxPct = Math.max(0, parseFloat($('taxInput').value) || 0);
      saveJSON(LS_TAX, taxPct);
      if (current) renderList();
    });
    $('discInput').addEventListener('change', function () {
      discountPct = Math.min(100, Math.max(0, parseFloat($('discInput').value) || 0));
      saveJSON(LS_DISC, discountPct);
      if (current) renderList();
    });
    $('csvBtn').addEventListener('click', function () {
      if (!current || !mergedItems().length) return;
      downloadFile('materials-list.csv', ML.listToCSV(mergedItems(), mergedBought()), 'text/csv;charset=utf-8');
    });

    $('addItemBtn').addEventListener('click', function () {
      var f = $('customForm');
      f.style.display = f.style.display === 'none' ? '' : 'none';
      if (f.style.display !== 'none') $('cName').focus();
    });
    $('cCancel').addEventListener('click', function () {
      $('customForm').style.display = 'none';
      $('cMsg').textContent = '';
    });
    $('cAdd').addEventListener('click', function () {
      if (!current) return;
      try {
        current.custom = ML.addCustomItem(current.custom || [], {
          name: $('cName').value,
          qty: parseFloat($('cQty').value),
          unit: $('cUnit').value.trim() || 'each',
          unitPrice: parseFloat($('cPrice').value) || 0
        });
      } catch (err) {
        $('cMsg').textContent = err.message.replace(/^addCustomItem: /, '');
        return;
      }
      $('cName').value = ''; $('cQty').value = ''; $('cUnit').value = ''; $('cPrice').value = '';
      $('cMsg').textContent = 'Added ✓';
      setTimeout(function () { $('cMsg').textContent = ''; }, 2500);
      persistCurrent();
      renderList();
      syncSavedBought();
    });
    $('libraryList').addEventListener('click', libraryClick);

    $('saveKeyBtn').addEventListener('click', function () {
      var k = $('openaiKey').value.trim();
      try {
        if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY);
      } catch (e) {}
      $('keyMsg').textContent = k ? 'Key saved in this browser only.' : 'No key entered.';
      setTimeout(function () { $('keyMsg').textContent = ''; }, 3000);
    });
    $('clearKeyBtn').addEventListener('click', function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      $('openaiKey').value = '';
      $('keyMsg').textContent = 'Key removed.';
      setTimeout(function () { $('keyMsg').textContent = ''; }, 3000);
    });
    try {
      if (localStorage.getItem(LS_KEY)) $('openaiKey').value = '••••••••';
    } catch (e) {}
  }

  // ---------- boot ----------

  function boot() {
    buildTradeSelect();
    buildWasteToggle();
    bind();
    getTax(); getDisc();
    $('taxInput').value = taxPct;
    $('discInput').value = discountPct;
    renderLibrary();
    var saved = loadJSON(LS_CURRENT, null);
    if (saved && saved.items && saved.items.length) {
      wastePct = saved.wastePct || 10;
      document.querySelectorAll('#wasteToggle button').forEach(function (b) {
        b.classList.toggle('active', parseInt(b.getAttribute('data-waste'), 10) === wastePct);
      });
      $('tradeSelect').value = saved.trade;
      $('jobText').value = saved.jobText || '';
      current = saved;
      current.custom = current.custom || [];
      renderList();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
