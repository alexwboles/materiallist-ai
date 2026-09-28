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

  function regenerate(baseItems, jobText, trade, name) {
    var items = ML.applyWaste(baseItems, wastePct);
    var bought = current && current.bought ? current.bought.slice(0, items.length) : [];
    while (bought.length < items.length) bought.push(false);
    current = { name: name || '', trade: trade, jobText: jobText, wastePct: wastePct,
                baseItems: baseItems, items: items, bought: bought };
    saveJSON(LS_CURRENT, current);
    renderList();
  }

  function runGeneration(jobText, trade) {
    var result = ML.generateList({ jobText: jobText, trade: trade });
    regenerate(result.items, jobText, trade, '');
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
    if (!current || !current.items.length) {
      $('listSection').style.display = 'none';
      return;
    }
    $('listSection').style.display = '';
    $('listTrade').textContent = '· ' + ML.TRADES[current.trade].label + ' · ' + wastePct + '% waste';
    var cost = ML.estimateCost(current.items);
    var body = $('takeoffBody');
    body.innerHTML = '';
    cost.lines.forEach(function (line, i) {
      var tr = document.createElement('tr');
      if (current.bought[i]) tr.className = 'bought';
      var note = line.note ? '<div class="item-note">' + esc(line.note) + '</div>' : '';
      tr.innerHTML =
        '<td class="no-print"><input type="checkbox" class="buy-check" data-i="' + i + '"' +
        (current.bought[i] ? ' checked' : '') + ' aria-label="Bought: ' + esc(line.name) + '"></td>' +
        '<td class="item-name">' + esc(line.name) + note + '</td>' +
        '<td class="num">' + line.qty + '</td>' +
        '<td>' + esc(line.unit) + '</td>' +
        '<td class="num">' + ML.fmtMoney(line.unitPrice) + '</td>' +
        '<td class="num">' + ML.fmtMoney(line.lineTotal) + '</td>';
      body.appendChild(tr);
    });
    var trTotal = document.createElement('tr');
    trTotal.className = 'total-row';
    trTotal.innerHTML = '<td class="no-print"></td><td>Estimated total</td><td class="num"></td><td></td><td></td>' +
      '<td class="num">' + ML.fmtMoney(cost.total) + '</td>';
    body.appendChild(trTotal);
    updateProgress();
  }

  function updateProgress() {
    var bought = current.bought.filter(Boolean).length;
    var total = current.items.length;
    $('boughtLabel').textContent = bought + ' of ' + total + ' bought';
    $('boughtBar').style.width = total ? (bought / total * 100) + '%' : '0';
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
      bought: current.bought
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
      window.scrollTo({ top: $('listSection').offsetTop - 12, behavior: 'smooth' });
    } else if (delBtn) {
      var id = delBtn.getAttribute('data-del');
      saveJSON(LS_LISTS, lists.filter(function (l) { return l.id !== id; }));
      renderLibrary();
    }
  }

  // ---------- events ----------

  function bind() {
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
      current.bought[i] = chk.checked;
      saveJSON(LS_CURRENT, current);
      renderList();
      // sync saved copy if this list was saved
      if (current.name) {
        var lists = getLists();
        var match = lists.filter(function (l) { return l.name === current.name; })[0];
        if (match) { match.bought = current.bought; saveJSON(LS_LISTS, lists); renderLibrary(); }
      }
    });

    $('saveListBtn').addEventListener('click', saveCurrentList);
    $('printBtn').addEventListener('click', function () { window.print(); });
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
      renderList();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
