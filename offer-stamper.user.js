// ==UserScript==
// @name         Offer Stamper
// @namespace    https://mbparks.com/
// @version      0.2.1
// @description  Capture a whole vendor offer set from Findchips or Octopart as a TALLY-ready offers array
// @author       M.B. Parks
// @license      GPL-3.0
// @match        https://www.findchips.com/*
// @match        https://findchips.com/*
// @match        https://octopart.com/*
// @match        https://*.octopart.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://github.com/mbparks/msOfferStamper/raw/main/offer-stamper.user.js
// @updateURL    https://github.com/mbparks/msOfferStamper/raw/main/offer-stamper.user.js
// ==/UserScript==

/* Offer Stamper :: offer-stamper.user.js :: v0.2.1 */
/* MS-009 in the Mike//Scripts catalog. GPL-3.0. */
/* Reads only the page already rendered in front of you, on a click. */
/* No network calls, no keys, no crawling, no protection evasion. */

(function () {
  'use strict';

  var CFG = {
    name: 'Offer Stamper',
    short: 'OFFER STAMPER',
    version: '0.2.1',
    license: 'GPL-3.0',
    repo: 'https://github.com/mbparks/msOfferStamper',
    feedback: 'https://github.com/mbparks/msOfferStamper/issues',
    cartKey: 'ms007.cart.v1',
    prefKey: 'ms007.prefs.v1'
  };

  var DEBUG = false;
  function log() {
    if (!DEBUG) return;
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[offer-stamper]');
    console.log.apply(console, a);
  }

  // ---------------------------------------------------------------- utilities

  function decodeEntities(s) {
    if (!s) return '';
    var out = String(s);
    var last = null;
    var guard = 0;
    while (out !== last && guard < 5) {
      last = out;
      guard += 1;
      out = out
        .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
        .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }
    return out;
  }

  function cleanText(s) {
    if (s === null || s === undefined) return '';
    return decodeEntities(String(s)).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  var BLOCKISH = {
    TR: 1, TD: 1, TH: 1, DIV: 1, LI: 1, P: 1, SECTION: 1, ARTICLE: 1, UL: 1, OL: 1,
    TABLE: 1, TBODY: 1, THEAD: 1, TFOOT: 1, BR: 1, DL: 1, DT: 1, DD: 1, FIGURE: 1,
    HEADER: 1, FOOTER: 1, NAV: 1, ASIDE: 1, MAIN: 1, FORM: 1, H1: 1, H2: 1, H3: 1,
    H4: 1, H5: 1, H6: 1
  };

  // Visual line breaks carry meaning in an offer row, so read them.
  // innerText when the browser offers it, a block-aware walk otherwise.
  function derivedText(el) {
    var out = [];
    (function walk(node) {
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i += 1) {
        var child = kids[i];
        if (child.nodeType === 3) {
          out.push(child.nodeValue || '');
        } else if (child.nodeType === 1) {
          var tag = child.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
          var block = BLOCKISH[tag];
          // Inline elements sit shoulder to shoulder in the markup, so a span
          // holding "MOQ 1" next to a span holding "1 $0.38" would otherwise
          // read as the quantity 11. Separate them.
          out.push(block ? '\n' : ' ');
          walk(child);
          out.push(block ? '\n' : ' ');
        }
      }
    }(el));
    return out.join('');
  }

  function lineText(el) {
    if (!el) return '';
    var raw = el.innerText;
    if (typeof raw !== 'string' || raw === '') raw = derivedText(el);
    if (!raw) raw = el.textContent || '';
    return decodeEntities(String(raw)).replace(/\u00a0/g, ' ');
  }

  function lines(el) {
    return lineText(el)
      .split(/[\n\r\t]+/)
      .map(function (s) { return cleanText(s); })
      .filter(function (s) { return s.length > 0; });
  }

  function toNum(s) {
    if (s === null || s === undefined) return null;
    var t = String(s).replace(/[, \u00a0]/g, '');
    if (!/^-?\d*\.?\d+$/.test(t)) return null;
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  // Octopart writes a minimum of ten thousand as 10K.
  function toIntSuffixed(s) {
    var t = cleanText(s).replace(/\+$/, '');
    var m = t.match(/^(\d[\d,]*(?:\.\d+)?)\s*([KM])$/i);
    if (!m) return toInt(t);
    var n = toNum(m[1]);
    if (n === null) return null;
    return Math.round(n * (/k/i.test(m[2]) ? 1000 : 1000000));
  }

  function toInt(s) {
    var n = toNum(s);
    return n === null ? null : Math.round(n);
  }

  // Currency. A bare dollar sign is ambiguous, so it is reported as USD?
  // and treated as non-USD by the TALLY exports unless the page says otherwise.
  var CURRENCY_PREFIX = [
    { re: /US\s?\$/i, code: 'USD' },
    { re: /\bUSD\b/i, code: 'USD' },
    { re: /(CA|C)\s?\$/i, code: 'CAD' },
    { re: /\bCAD\b/i, code: 'CAD' },
    { re: /(AU|A)\s?\$/i, code: 'AUD' },
    { re: /\bAUD\b/i, code: 'AUD' },
    { re: /\bEUR\b/i, code: 'EUR' },
    { re: /\bGBP\b/i, code: 'GBP' },
    { re: /\bJPY\b/i, code: 'JPY' },
    { re: /\bCNY\b|\bRMB\b/i, code: 'CNY' }
  ];

  var SYMBOL_CURRENCY = { '$': 'USD?', '\u20ac': 'EUR', '\u00a3': 'GBP', '\u00a5': 'JPY', '\u20b9': 'INR' };

  // One number pattern, used everywhere. The grouped form needs at least one
  // comma group, otherwise the alternation matches the first three digits of
  // 2500 and stops, which is how a pack of 2500 becomes a pack of 250.
  var NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)';
  var INT = '(\\d{1,3}(?:,\\d{3})+|\\d+)';
  var CODES = 'USD|CAD|AUD|EUR|GBP|JPY|CNY|RMB';

  var MONEY_RE = new RegExp(
    '(?:US\\s?\\$|CA\\s?\\$|AU\\s?\\$|C\\$|A\\$|' + CODES + '|[$\\u20ac\\u00a3\\u00a5\\u20b9])\\s?' + NUM +
    '|' + NUM + '\\s?(?:' + CODES + ')\\b', 'i');

  function parseMoney(text) {
    if (!text) return null;
    var s = cleanText(text);
    var m = s.match(MONEY_RE);
    if (!m) return null;
    var value = toNum(m[1] !== undefined && m[1] !== null ? m[1] : m[2]);
    if (value === null) return null;
    var head = s.slice(0, m.index + m[0].length);
    var code = null;
    for (var i = 0; i < CURRENCY_PREFIX.length; i += 1) {
      if (CURRENCY_PREFIX[i].re.test(m[0])) { code = CURRENCY_PREFIX[i].code; break; }
    }
    if (!code) {
      var sym = m[0].match(/[$\u20ac\u00a3\u00a5\u20b9]/);
      if (sym) code = SYMBOL_CURRENCY[sym[0]] || null;
    }
    if (!code) code = 'USD?';
    if (code === 'USD?' && /\bUS\b|United States|\bUSD\b/i.test(head)) code = 'USD';
    return { currency: code, price: value };
  }

  // A price break line looks like "1: $0.42", "1+ $0.42", "100 pcs $0.31",
  // or a table row rendered as "1 <tab> $0.42".
  var QTY_BEFORE_RE = new RegExp(INT + '\\s*(?:\\+|pcs?|pieces?|units?|ea\\b|:|-|\\u2013)?\\s*$', 'i');

  function parseBreaks(text) {
    var out = [];
    var seen = {};
    var src = String(text || '').split(/[\n\r]+/);
    for (var i = 0; i < src.length; i += 1) {
      var chunks = src[i].split(/\t+/);
      var joined = chunks.join(' ');
      var scan = joined;
      var guard = 0;
      while (guard < 8) {
        guard += 1;
        var m = scan.match(MONEY_RE);
        if (!m) break;
        var before = scan.slice(0, m.index);
        var money = parseMoney(m[0]);
        var qm = before.match(QTY_BEFORE_RE);
        var qty = qm ? toInt(qm[1]) : null;
        if (money && money.price > 0 && qty !== null && qty > 0) {
          if (!seen[qty]) {
            seen[qty] = true;
            out.push({ qty: qty, price: money.price, currency: money.currency });
          }
        }
        scan = scan.slice(m.index + m[0].length);
      }
    }
    out.sort(function (a, b) { return a.qty - b.qty; });
    return out;
  }

  // The trailing form is read first, because "25,000 available MOQ 1" would
  // otherwise hand back the minimum order quantity as the stock figure.
  // Real pages state stock four different ways, so all four are read, in the
  // order that avoids a false positive:
  //   Americas - 8568000        regional, sometimes several per row
  //   Stock DE - 807000Stock HK - 0
  //   313294Digi-Reel(R)        quantity welded to the packaging label
  //   93000 In Stock / Factory Stock / 51049 on its own
  var STOCK_REGION_RE = new RegExp('(?:americas|europe|emea|asia|stock\\s+[a-z]{2})\\s*[-\\u2013:]\\s*' + INT, 'ig');
  var STOCK_SUFFIX_RE = new RegExp('(?:^|[^\\w.,-])' + INT +
    '\\s*(?:pcs?\\s*)?(?:in\\s*stock|factory\\s*stock|available|on\\s*hand|digi-?reel|mousereel|tape\\s*(?:&|and)?\\s*reel|cut\\s*tape|reel|tray|tube)', 'i');
  var STOCK_LABELLED = new RegExp('(?:in\\s*stock|stock|available|availability|qty\\s*avail\\w*)[^A-Za-z0-9]{0,6}' + INT, 'i');

  // Findchips prints stock as a bare number in its own cell. Read it only
  // from a line that is nothing but a number, so a date code or a break
  // quantity can never be mistaken for inventory.
  function stockFromLines(ls) {
    for (var i = 0; i < ls.length; i += 1) {
      if (/^\d{1,3}(?:,\d{3})+$|^\d+$/.test(ls[i])) return toInt(ls[i]);
    }
    return null;
  }

  function cellsOf(el) {
    return el && el.children ? Array.prototype.slice.call(el.children) : [];
  }

  var QTY_HEADER_RE = /^\d[\d,]*(?:\.\d+)?\s*[KM]?\+?$/i;

  // Octopart does not print a quantity next to each price. It prints the break
  // quantities once, in the table header (1 / 10 / 100 / 1,000 / 10,000), and
  // each seller row carries a price per column. The ladder therefore has to be
  // read from the grid, by column position, not from the row's text.
  function columnLadder(row) {
    if (!row || !row.closest) return null;
    var table = row.closest('table');
    if (!table) return null;
    var headRows = Array.prototype.slice.call(table.querySelectorAll('thead tr'));
    if (!headRows.length) {
      var first = table.querySelector('tr');
      if (first && first !== row) headRows = [first];
    }
    var qtyAt = {};
    var qtyList = [];
    headRows.forEach(function (hr) {
      cellsOf(hr).forEach(function (cell, i) {
        var t = cleanText(cell.textContent);
        if (!QTY_HEADER_RE.test(t)) return;
        var q = toIntSuffixed(t);
        if (q === null || q <= 0) return;
        var idx = (cell.cellIndex !== undefined && cell.cellIndex >= 0) ? cell.cellIndex : i;
        if (qtyAt[idx] === undefined) { qtyAt[idx] = q; qtyList.push(q); }
      });
    });
    if (qtyList.length < 2) return null;

    var cells = cellsOf(row);
    var currency = null;
    cells.forEach(function (c) {
      var t = cleanText(c.textContent);
      var m = t.match(/^(USD|CAD|AUD|EUR|GBP|JPY|CNY|RMB)$/i);
      if (m && !currency) currency = m[1].toUpperCase();
    });

    var qtyIdx = Object.keys(qtyAt).map(Number).sort(function (a, b) { return a - b; });
    var minQtyIdx = qtyIdx[0];
    var priced = [];
    cells.forEach(function (c, i) {
      if (i < minQtyIdx) return;
      var p = cellPrice(c);
      if (p !== null) priced.push({ i: i, price: p });
    });
    if (!priced.length) return null;

    if (!currency) {
      headRows.forEach(function (hr) {
        var m = cleanText(hr.textContent).match(/\b(USD|CAD|AUD|EUR|GBP|JPY|CNY|RMB)\b/i);
        if (m && !currency) currency = m[1].toUpperCase();
      });
    }
    var out = [];
    var inferred = false;
    var aligned = priced.length === qtyIdx.length &&
      priced.every(function (p, n) { return p.i === qtyIdx[n]; });
    if (aligned) {
      priced.forEach(function (p, n) {
        out.push({ qty: qtyAt[qtyIdx[n]], price: p.price, currency: currency });
      });
    } else {
      // A row with a high minimum shows fewer prices than there are columns,
      // and a currency cell can shift the whole run sideways. Pairing by
      // position would then hand the 1-off price to the wrong quantity, so
      // the prices are pinned to the largest quantities and the row is
      // flagged rather than quietly believed.
      var qs = qtyIdx.map(function (i) { return qtyAt[i]; });
      var tail = qs.slice(Math.max(0, qs.length - priced.length));
      for (var j = 0; j < priced.length && j < tail.length; j += 1) {
        out.push({ qty: tail[j], price: priced[j].price, currency: currency });
      }
      inferred = true;
    }
    if (!out.length) return null;
    out.sort(function (a, b) { return a.qty - b.qty; });
    out.inferred = inferred;
    return out;
  }

  function columnText(row, headerRe) {
    if (!row || !row.closest) return '';
    var table = row.closest('table');
    if (!table) return '';
    var headRows = Array.prototype.slice.call(table.querySelectorAll('thead tr, tr'));
    var idx = -1;
    for (var r = 0; r < headRows.length && idx < 0; r += 1) {
      if (headRows[r] === row) continue;
      cellsOf(headRows[r]).forEach(function (cell, i) {
        if (idx >= 0) return;
        if (headerRe.test(cleanText(cell.textContent))) {
          idx = (cell.cellIndex !== undefined && cell.cellIndex >= 0) ? cell.cellIndex : i;
        }
      });
    }
    if (idx < 0) return '';
    var cell = cellsOf(row)[idx];
    return cell ? cleanText(cell.textContent) : '';
  }

  // Read a row cell by the label in its column header, for grid style tables.
  function columnValue(row, headerRe) {
    if (!row || !row.closest) return null;
    var table = row.closest('table');
    if (!table) return null;
    var headRows = Array.prototype.slice.call(table.querySelectorAll('thead tr, tr'));
    var idx = -1;
    for (var r = 0; r < headRows.length && idx < 0; r += 1) {
      if (headRows[r] === row) continue;
      cellsOf(headRows[r]).forEach(function (cell, i) {
        if (idx >= 0) return;
        if (headerRe.test(cleanText(cell.textContent))) {
          idx = (cell.cellIndex !== undefined && cell.cellIndex >= 0) ? cell.cellIndex : i;
        }
      });
    }
    if (idx < 0) return null;
    var cell = cellsOf(row)[idx];
    if (!cell) return null;
    var v = toIntSuffixed(cleanText(cell.textContent));
    return v === null || v <= 0 ? null : v;
  }

  function cellPrice(cell) {
    if (!cell) return null;
    var t = cleanText(cell.textContent);
    if (!t) return null;
    var money = parseMoney(t);
    if (money && money.price > 0) return money.price;
    if (!/^\d*\.?\d+$/.test(t)) return null;
    var bare = toNum(t);
    return bare !== null && bare > 0 ? bare : null;
  }

  // Octopart puts lead time in its own column, as 2d or 9h.
  function leadFromCells(el) {
    var found = null;
    cellsOf(el).forEach(function (c) {
      var t = cleanText(c.textContent);
      var m = t.match(/^(\d{1,4})\s*(h|d|w|wks?|weeks?|days?)$/i);
      if (!m || found !== null) return;
      var n = toInt(m[1]);
      if (n === null) return;
      if (/^h/i.test(m[2])) found = n > 0 ? 1 : 0;
      else if (/^w/i.test(m[2])) found = n * 7;
      else found = n;
    });
    return found;
  }

  function parseStock(text) {
    var s = cleanText(text);
    var regional = null;
    STOCK_REGION_RE.lastIndex = 0;
    var r;
    while ((r = STOCK_REGION_RE.exec(s)) !== null) {
      var v = toInt(r[1]);
      if (v !== null) regional = (regional === null ? 0 : regional) + v;
    }
    if (regional !== null) return regional;
    var m = s.match(STOCK_SUFFIX_RE);
    if (m) return toInt(m[1]);
    m = s.match(STOCK_LABELLED);
    if (m) return toInt(m[1]);
    if (/\bout of stock\b|\bno stock\b|\bnon\s*stock\b/i.test(s)) return 0;
    return null;
  }

  var MOQ_RE = new RegExp('\\bmin(?:imum)?\\.?\\s*(?:qty|quantity|order|purchase)?[^A-Za-z0-9]{0,4}' + INT, 'i');
  var MOQ_ALT = new RegExp('\\bmoq[^A-Za-z0-9]{0,4}' + INT, 'i');

  function parseMoq(text) {
    var s = cleanText(text);
    var m = s.match(MOQ_RE);
    if (m) return toInt(m[1]);
    m = s.match(MOQ_ALT);
    if (m) return toInt(m[1]);
    return null;
  }

  var PACK_RE = new RegExp('\\b(?:mult(?:iple)?|increment|order\\s*mult\\w*|pack\\s*(?:of|size)?)[^A-Za-z0-9]{0,4}' + INT, 'i');

  function parsePack(text) {
    var s = cleanText(text);
    var m = s.match(PACK_RE);
    if (m) return toInt(m[1]);
    return null;
  }

  // A range quotes its far end. The near end is the number that makes a
  // schedule look good and the far end is the one you plan against.
  var LEAD_SPAN = '(\\d{1,3})(?:\\s*(?:-|to|\\u2013)\\s*(\\d{1,3}))?';
  var LEAD_UNIT = '(weeks?|wks?|days?|d\\b|months?|mos?\\b)';

  var LEAD_WEEKS_DAYS_RE = /lead\s*time[^0-9]{0,8}(\d{1,3})\s*(?:weeks?|wks?)\s*,\s*(\d{1,3})\s*days?/i;

  function parseLead(text) {
    var wd = cleanText(text).match(LEAD_WEEKS_DAYS_RE);
    if (wd) return (toInt(wd[1]) || 0) * 7 + (toInt(wd[2]) || 0);
    return parseLeadSimple(text);
  }

  function parseLeadSimple(text) {
    var s = cleanText(text);
    var m = s.match(new RegExp('lead(?:\\s*time)?\\D{0,14}' + LEAD_SPAN + '\\s*' + LEAD_UNIT, 'i'));
    if (!m) m = s.match(new RegExp(LEAD_SPAN + '\\s*' + LEAD_UNIT + '\\s*lead', 'i'));
    if (!m) return null;
    var n = toInt(m[2] === undefined || m[2] === null ? m[1] : m[2]);
    if (n === null) return null;
    var unit = m[3].toLowerCase().charAt(0);
    if (unit === 'w') return n * 7;
    if (unit === 'm') return n * 30;
    return n;
  }

  var PACKAGING_RE = /\b(cut\s*strips?|cut\s*tape|tape\s*(?:&|and)?\s*reel|digi-?reel|mousereel|full\s*reel|reel|tray|tube|strips?|bulk|bag|box|ammo\s*pack)\b/i;
  var CONTAINER_RE = /\bcontainer\s*[:#]?\s*([A-Za-z][A-Za-z &-]{2,24})/i;

  function parsePackaging(text) {
    var s = cleanText(text);
    var c = s.match(CONTAINER_RE);
    if (c) return cleanText(c[1]).replace(/\s+(Min|Date|RoHS|Lead|Package|Part).*$/i, '');
    var m = s.match(PACKAGING_RE);
    return m ? cleanText(m[0]) : '';
  }

  // Purchase mathematics, mirrored from TALLY: MOQ first, then round up to pack.
  function purchaseQty(need, moq, pack) {
    var n = Math.max(1, Math.ceil(toNum(need) || 1));
    var m = Math.max(1, Math.ceil(toNum(moq) || 1));
    var p = Math.max(1, Math.ceil(toNum(pack) || 1));
    var q = Math.max(n, m);
    return Math.ceil(q / p) * p;
  }

  function priceAtQty(breaks, qty) {
    if (!breaks || !breaks.length) return null;
    var sorted = breaks.slice().sort(function (a, b) { return a.qty - b.qty; });
    var chosen = sorted[0];
    for (var i = 0; i < sorted.length; i += 1) {
      if (sorted[i].qty <= qty) chosen = sorted[i];
    }
    return chosen.price;
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvRows(rows) {
    return rows.map(function (r) {
      return r.map(csvCell).join(',');
    }).join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------- distributor knowledge

  var DISTRIBUTORS = [
    'Digi-Key', 'DigiKey', 'Mouser', 'Arrow', 'Newark', 'element14', 'Farnell',
    'RS Components', 'RS-Online', 'Allied Electronics', 'Avnet', 'TTI',
    'Future Electronics', 'Verical', 'Rochester Electronics', 'Sager',
    'Heilind', 'Bisco Industries', 'Chip One Stop', 'Master Electronics',
    'Onlinecomponents', 'Sourcengine', 'LCSC', 'Win Source', 'WIN SOURCE',
    'UTSOURCE', 'Quest Components', 'Component Sense', 'Rutronik', 'Ameya',
    'Jameco', 'SparkFun', 'Adafruit', 'Symmetry Electronics', 'Richardson RFPD',
    'Texas Instruments', 'Analog Devices'
  ];

  var VENDOR_NOISE_RE = /^(buy|buy now|view|datasheet|compare|details|check|order|more|shop|quote|rfq|add to cart|see all|show more)$/i;

  function isKnownDistributor(name) {
    var n = cleanText(name).toLowerCase();
    if (!n) return false;
    if (STATE.channels && STATE.channels[n] !== undefined) return true;
    for (var i = 0; i < DISTRIBUTORS.length; i += 1) {
      if (n.indexOf(DISTRIBUTORS[i].toLowerCase()) >= 0) return true;
    }
    return false;
  }

  // Findchips prints its own roster in the distributor filter, grouped under
  // "Authorized Distributors" and "Independent Distributors". Reading that
  // roster beats any list shipped inside this script: it is current, it is
  // complete, and it settles the channel for every block on the page.
  var CHANNEL_HEAD_RE = /^(non[-\s]?authorized|authorized|independent)[a-z\s]*\b(distributors?|dealers?|sellers?)$/i;

  function channelMapFromPage(root) {
    var map = {};
    var scope = root || document.body;
    if (!scope) return map;
    var hosts = scope.querySelectorAll('div, section, form, fieldset, aside, ul, nav');
    var host = null;
    for (var i = 0; i < hosts.length; i += 1) {
      var txt = hosts[i].textContent || '';
      if (txt.length > 12000) continue;
      if (!/authorized\s+distributors/i.test(txt)) continue;
      if (!/independent\s+distributors/i.test(txt)) continue;
      host = hosts[i]; // querySelectorAll is in document order, so the last
    }                  // match on a branch is the innermost container
    if (!host) return map;
    var label = null;
    var leaves = host.querySelectorAll('*');
    for (var j = 0; j < leaves.length; j += 1) {
      var node = leaves[j];
      if (node.querySelector && node.querySelector('*')) continue; // leaves only
      var t = cleanText(node.textContent);
      if (!t) continue;
      var head = t.match(CHANNEL_HEAD_RE);
      if (head) { label = !/^non|^independent/i.test(head[1]); continue; }
      if (label === null) continue;
      if (t.length > 48) continue;
      map[t.toLowerCase().replace(/\s*logo$/i, '')] = label;
    }
    return map;
  }

  var CHANNEL_MARK_RE = /authorized\s+distributor|manufacturer\s+direct|\becia\b|\bneda\b|franchis/i;

  // Octopart footnotes a sponsored seller with a superscript digit, which
  // lands in the text as "Arrow Electronics2".
  function stripFootnote(name) {
    return cleanText(name).replace(/([A-Za-z.])\s?\d{1,2}$/, '$1');
  }

  // A distributor block on Findchips carries its name and channel in a header
  // line above the table. The rows themselves never name the distributor, only
  // the manufacturer, which is why a row must never be read for its vendor.
  // Everything after one of these words is channel furniture, not the name:
  // "Arrow Electronics Authorized Distributor" is Arrow Electronics, and
  // "Newark ECIA (NEDA) Member" is Newark.
  var HEADER_CUT_RE = /\s+(?:ECIA|NEDA|Member|Authorized|Independent|Manufacturer\s+Direct|Distributors?|Sellers?)\b|\s*[\u2022|(,]/i;

  function vendorFromHeaderText(text) {
    var t = cleanText(text);
    if (!t || t.length > 220) return null;
    // A block header states a name. It never quotes a price or a part number,
    // so text that does is a row, and reading a row for its vendor is how an
    // offer ends up labelled with the manufacturer.
    if (MONEY_RE.test(t) || /DISTI\s*#/i.test(t)) return null;
    // Two or more bare decimals is a priced grid row, not a header.
    if ((t.match(/\b\d*\.\d{2,}\b/g) || []).length >= 2) return null;
    var low = t.toLowerCase();
    var best = '';
    var names = Object.keys(STATE.channels || {});
    for (var i = 0; i < names.length; i += 1) {
      if (names[i].length > best.length && low.indexOf(names[i]) === 0) best = names[i];
    }
    if (!best) {
      for (var j = 0; j < DISTRIBUTORS.length; j += 1) {
        var d = DISTRIBUTORS[j].toLowerCase();
        if (d.length > best.length && low.indexOf(d) === 0) best = d;
      }
    }
    if (!best) return null;
    var vendor = cleanText(t.split(HEADER_CUT_RE)[0]) || t.slice(0, best.length);
    if (vendor.toLowerCase().indexOf(best) !== 0) vendor = t.slice(0, best.length);
    var authorized = null;
    if (STATE.channels && STATE.channels[best] !== undefined) authorized = STATE.channels[best];
    if (authorized === null && CHANNEL_MARK_RE.test(t)) authorized = true;
    return { vendor: vendor, authorized: authorized };
  }

  // Channel map keys are lower cased for matching, so restore a display form.
  function titleCaseVendor(name) {
    var t = cleanText(name);
    if (!t) return t;
    if (/[A-Z]/.test(t.slice(1))) return t;
    return t.replace(/\b([a-z])/g, function (m, c) { return c.toUpperCase(); });
  }

  function headOf(el, maxLines) {
    return lines(el).slice(0, maxLines || 2).join(' ');
  }

  var TABLE_PARTS = { TABLE: 1, TBODY: 1, THEAD: 1, TFOOT: 1, TR: 1, TD: 1, TH: 1, COLGROUP: 1 };

  function blockVendorFor(el) {
    var node = el;
    var hops = 0;
    while (node && hops < 12) {
      var sib = node.previousElementSibling;
      var guard = 0;
      while (sib && guard < 8) {
        var v = TABLE_PARTS[sib.tagName] ? null : vendorFromHeaderText(headOf(sib, 2));
        if (v) return v;
        sib = sib.previousElementSibling;
        guard += 1;
      }
      // Table plumbing is never a header. Reading the first two lines of a
      // tbody hands back the first seller row, which is how every offer on a
      // grid page ends up stamped with the name of the seller at the top.
      if (node !== el && !TABLE_PARTS[node.tagName]) {
        var v2 = vendorFromHeaderText(headOf(node, 2));
        if (v2) return v2;
      }
      node = node.parentElement;
      hops += 1;
    }
    return null;
  }

  function vendorFrom(el) {
    var text = lineText(el);
    // A seller link carries the full trading name. "Arrow Electronics" beats
    // the "Arrow" that a list match would truncate it to.
    var anchors0 = el.querySelectorAll ? el.querySelectorAll('a') : [];
    for (var a = 0; a < anchors0.length; a += 1) {
      var at = cleanText(anchors0[a].textContent);
      if (at.length >= 3 && at.length <= 40 && isKnownDistributor(stripFootnote(at))) return stripFootnote(at);
    }
    var best = '';
    for (var i = 0; i < DISTRIBUTORS.length; i += 1) {
      var d = DISTRIBUTORS[i];
      var re = new RegExp('\\b' + d.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\b', 'i');
      if (re.test(text) && d.length > best.length) best = d;
    }
    if (best) return best;
    var anchors = el.querySelectorAll ? el.querySelectorAll('a') : [];
    for (var j = 0; j < anchors.length; j += 1) {
      var t = cleanText(anchors[j].textContent);
      if (t.length >= 2 && t.length <= 40 && !VENDOR_NOISE_RE.test(t) && !MONEY_RE.test(t) && !/^\d+$/.test(t)) {
        return t;
      }
    }
    var ls = lines(el);
    for (var k = 0; k < ls.length; k += 1) {
      if (ls[k].length >= 3 && ls[k].length <= 40 && !MONEY_RE.test(ls[k]) && /[A-Za-z]/.test(ls[k]) && !VENDOR_NOISE_RE.test(ls[k])) {
        return ls[k];
      }
    }
    return '';
  }

  var AUTH_RE = /\bauthoriz|\bauthoris|\bfranchis/i;
  // "Non-Authorized Stocking Distributors" contains "authoriz", so this is
  // always tested first. Getting it backwards labels a broker as franchised,
  // which is the single most expensive mistake this script could make.
  var IND_RE = /\bnon[-\s]?authoriz|\bnon[-\s]?authoris|\bindependent\b|\bbroker\b|\bexcess\b|\bopen market\b|\bnon[-\s]?franchis|\bdealers?\b/i;

  // Findchips and Octopart both group sellers under a section heading.
  // Climb until one of those words appears in a heading above the row.
  function authorizedFrom(el) {
    var node = el;
    var hops = 0;
    while (node && hops < 10) {
      var own = cleanText(node.getAttribute ? (node.getAttribute('data-section') || node.className || '') : '');
      if (IND_RE.test(own)) return false;
      if (AUTH_RE.test(own)) return true;
      var short = cleanText(node.textContent || '');
      if (short.length <= 220) {
        if (IND_RE.test(short)) return false;
        if (AUTH_RE.test(short)) return true;
      }
      var heads = node.querySelectorAll ? node.querySelectorAll('h1,h2,h3,h4,h5,[role="heading"],legend,caption,th') : [];
      for (var i = 0; i < heads.length && i < 12; i += 1) {
        var t = cleanText(heads[i].textContent);
        if (IND_RE.test(t)) return false;
        if (AUTH_RE.test(t)) return true;
      }
      node = node.parentElement;
      hops += 1;
    }
    return null;
  }

  // ------------------------------------------------------------ page context

  function siteId() {
    var h = (location.hostname || '').toLowerCase();
    if (h.indexOf('findchips') >= 0) return 'findchips';
    if (h.indexOf('octopart') >= 0) return 'octopart';
    return 'unknown';
  }

  var MPN_RE = /^[A-Za-z0-9][A-Za-z0-9\-_.,\/+#]{2,39}$/;

  function mpnFromUrl() {
    var path = decodeURIComponent(location.pathname || '');
    var q = new URLSearchParams(location.search || '');
    var qp = q.get('q') || q.get('part') || q.get('mpn');
    var segs = path.split('/').filter(Boolean);
    var last = segs.length ? segs[segs.length - 1] : '';
    if (siteId() === 'findchips') {
      if (segs.length >= 2 && (segs[0] === 'search' || segs[0] === 'part' || segs[0] === 'parts')) {
        return cleanText(segs[1]);
      }
    }
    if (siteId() === 'octopart') {
      // The canonical form keeps the real casing: /part/<manufacturer>/<mpn>
      if (segs.length >= 3 && segs[0] === 'part') return cleanText(segs[segs.length - 1]);
      // The older form lower cases everything: /lm358n-texas+instruments-138973
      var m = last.match(/^(.+?)-[a-z+%0-9.]+-\d+$/i);
      if (m) return cleanText(m[1].replace(/\+/g, ' '));
    }
    if (qp && MPN_RE.test(qp)) return cleanText(qp);
    if (last && MPN_RE.test(last)) return cleanText(last);
    return '';
  }

  function mpnFromHeading() {
    var heads = document.querySelectorAll('h1, [role="heading"]');
    for (var i = 0; i < heads.length && i < 6; i += 1) {
      var t = cleanText(heads[i].textContent);
      if (!t) continue;
      var first = t.split(/\s+/)[0];
      if (MPN_RE.test(first) && /\d/.test(first)) return first;
    }
    return '';
  }

  function descriptionFromPage() {
    var heads = document.querySelectorAll('h1, h2, [role="heading"]');
    for (var i = 0; i < heads.length && i < 8; i += 1) {
      var t = cleanText(heads[i].textContent);
      if (t.length >= 12 && t.length <= 160 && /[a-z]{4}/.test(t)) return t;
    }
    var meta = document.querySelector('meta[name="description"]');
    if (meta) {
      var d = cleanText(meta.getAttribute('content'));
      if (d.length >= 12 && d.length <= 200) return d;
    }
    return '';
  }

  // -------------------------------------------------------- row discovery

  function hasMoney(text) { return MONEY_RE.test(text || ''); }

  var BARE_PRICE_RE = /^\d*\.\d+$/;

  // A grid table states its currency once and prices its cells bare, so a
  // seller row can hold five prices and no currency symbol at all.
  function hasGridPrices(el) {
    if (!el || el.tagName !== 'TR' || !el.closest) return false;
    var cells = cellsOf(el);
    var bare = 0;
    for (var i = 0; i < cells.length; i += 1) {
      if (BARE_PRICE_RE.test(cleanText(cells[i].textContent))) bare += 1;
      if (bare >= 1) break;
    }
    if (!bare) return false;
    var table = el.closest('table');
    if (!table) return false;
    var heads = table.querySelectorAll('thead th, thead td');
    var qty = 0;
    for (var j = 0; j < heads.length; j += 1) {
      if (QTY_HEADER_RE.test(cleanText(heads[j].textContent))) qty += 1;
      if (qty >= 2) return true;
    }
    return false;
  }

  function candidateRows(root) {
    var scope = root || document.body;
    if (!scope) return [];
    var all = scope.querySelectorAll('tr, li, div, article, section');
    var hits = [];
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      var txt = el.textContent || '';
      if (txt.length < 24 || txt.length > 1600) continue;
      if (!hasMoney(txt) && !hasGridPrices(el)) continue;
      var hasLink = !!el.querySelector('a');
      var hasQtyish = /\d{2,}/.test(txt);
      if (!hasLink && !hasQtyish) continue;
      hits.push(el);
    }
    // Keep the innermost candidate on each branch. A real search page carries
    // several hundred priced rows, so this walks ancestors once per hit
    // instead of comparing every hit against every other hit.
    var hasInner = new Set();
    for (var h = 0; h < hits.length; h += 1) {
      var up = hits[h].parentElement;
      var climbed = 0;
      while (up && climbed < 24) {
        if (hasInner.has(up)) break;
        hasInner.add(up);
        up = up.parentElement;
        climbed += 1;
      }
    }
    var inner = hits.filter(function (el) { return !hasInner.has(el); });
    // Every innermost candidate is offered up. Aggregators split sellers into
    // an authorized section and an independent section, and the independent
    // one can hold a single row, so picking the largest sibling group would
    // silently drop a whole channel. parseRow does the rejecting instead.
    return inner;
  }

  var rowSeq = 0;

  function reject(reason) {
    STATE.rejects[reason] = (STATE.rejects[reason] || 0) + 1;
    return null;
  }

  function parseRow(el, ctx) {
    var text = lineText(el);
    var flat = cleanText(text);
    var grid = columnLadder(el);
    var breaks = grid || parseBreaks(text);
    var ladderInferred = !!(grid && grid.inferred);
    var money = parseMoney(flat);
    if (!breaks.length && money) breaks = [{ qty: 1, price: money.price, currency: money.currency }];
    if (!breaks.length) return reject('no price ladder (RFQ or quote-on-request row)');
    // The block header names the distributor. The row names the manufacturer,
    // so reading the row for a vendor labels Mouser offers "onsemi".
    var block = blockVendorFor(el);
    var vendor = block ? block.vendor : vendorFrom(el);
    if (!vendor) return reject('no distributor found for the block');
    var currency = breaks[0].currency || (money ? money.currency : 'USD?');
    var moqRead = parseMoq(flat);
    if (moqRead === null) moqRead = columnValue(el, /^min(imum)?$/i);
    var packCol = columnValue(el, /^(pkg|package|packaging|mult|multiple)$/i);
    var moq = moqRead;
    if (moq === null) moq = breaks[0].qty;
    var pack = parsePack(flat);
    if (pack === null && packCol !== null) pack = packCol;
    var stock = parseStock(flat);
    if (stock === null) stock = stockFromLines(lines(el));
    // A real seller row names a distributor, or it carries the sourcing
    // furniture that only a seller row has. Anything else is page chrome.
    var known = isKnownDistributor(vendor);
    var furniture = (stock !== null) || (moqRead !== null) || (parseLead(flat) !== null) || !!parsePackaging(flat);
    if (!known && !furniture) return reject('not a seller row (no distributor, no sourcing detail)');
    var sku = columnText(el, /^sku$/i) || skuFrom(el, vendor, ctx);
    if (stock !== null && sku === String(stock)) sku = '';
    rowSeq += 1;
    return {
      id: 'r' + rowSeq,
      mpn: mpnFromRow(el) || (ctx && ctx.mpn ? ctx.mpn : ''),
      // The cart spans parts, so a row carries its own description rather than
      // borrowing whatever page happens to be open at export time.
      desc: ctx && ctx.desc ? ctx.desc : '',
      vendor: titleCaseVendor(stripFootnote(vendor)),
      sku: sku,
      authorized: block && block.authorized !== null ? block.authorized : authorizedFrom(el),
      currency: currency,
      packaging: parsePackaging(flat),
      moq: moq || 1,
      pack: pack || 1,
      leadDays: parseLead(flat) === null ? leadFromCells(el) : parseLead(flat),
      stock: stock,
      breaks: breaks.map(function (b) { return { qty: b.qty, price: b.price }; }),
      ladderTruncated: hasExpander(el),
      ladderInferred: ladderInferred,
      ladderSource: grid ? 'columns' : 'row',
      url: location.href,
      source: siteId(),
      capturedAt: new Date().toISOString(),
      include: true
    };
  }

  var EXPANDER_RE = /see\s*(all|more)|show\s*(all|more)|more\s*(prices?|breaks?)|expand|\+\s*\d+\s*more/i;

  function hasExpander(el) {
    var nodes = el.querySelectorAll ? el.querySelectorAll('button, a, span, [role="button"]') : [];
    for (var i = 0; i < nodes.length; i += 1) {
      if (EXPANDER_RE.test(cleanText(nodes[i].textContent))) return true;
    }
    return false;
  }

  var SKU_LABEL_RE = /(?:disti\s*#|distributor\s*part|dist\s*part|part\s*(?:#|no\.?|number)|sku|stock\s*(?:#|code))\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-_.\/:,]{3,})/i;

  // Each row on an aggregator page is its own part number. A Findchips block
  // for one search holds a dozen different MPNs, so the MPN is read per row
  // and the page level MPN is only a fallback.
  function mpnFromRow(el) {
    var flat = cleanText(lineText(el));
    var m = flat.match(/^(.{1,64}?)\s*DISTI\s*#/i);
    if (m) return tidyMpn(m[1]);
    var ls = lines(el);
    for (var i = 0; i < ls.length; i += 1) {
      var t = tidyMpn(ls[i]);
      if (t && MPN_RE.test(t) && /\d/.test(t)) return t;
    }
    return '';
  }

  function tidyMpn(s) {
    return cleanText(s).replace(/\s*Part\s*Details\s*$/i, '').replace(/\s*Details\s*$/i, '').trim();
  }

  function skuFrom(el, vendor, ctx) {
    var flat = cleanText(lineText(el));
    var m = flat.match(SKU_LABEL_RE);
    if (m) return m[1];
    var mpn = ctx && ctx.mpn ? ctx.mpn.toLowerCase() : '';
    var ls = lines(el);
    for (var i = 0; i < ls.length; i += 1) {
      var t = ls[i];
      if (t.length < 5 || t.length > 32) continue;
      if (!/\d/.test(t)) continue;
      if (/\s/.test(t)) continue;
      // Newark and Farnell order codes are all digits, so allow those,
      // but never a grouped number, which is a stock or quantity figure.
      if (!/[A-Za-z]/.test(t) && (t.indexOf(',') >= 0 || t.indexOf('.') >= 0)) continue;
      if (MONEY_RE.test(t)) continue;
      if (mpn && t.toLowerCase() === mpn) continue;
      if (vendor && t.toLowerCase().indexOf(vendor.toLowerCase()) >= 0) continue;
      return t;
    }
    return '';
  }

  // Octopart slugs its part urls in lower case, so when the heading agrees
  // with the url the heading wins and the real casing survives.
  function resolveMpn() {
    var fromUrl = mpnFromUrl();
    var fromHead = mpnFromHeading();
    if (fromUrl && fromHead && fromUrl.toLowerCase() === fromHead.toLowerCase()) return fromHead;
    return fromUrl || fromHead || '';
  }

  function scan(root) {
    var started = Date.now();
    STATE.rejects = {};
    STATE.channels = channelMapFromPage(root);
    var ctx = {
      mpn: STATE.mpn || resolveMpn(),
      desc: STATE.desc || descriptionFromPage()
    };
    var els = candidateRows(root);
    log('candidate rows', els.length);
    var offers = [];
    for (var i = 0; i < els.length; i += 1) {
      var o = parseRow(els[i], ctx);
      if (o) offers.push(o);
    }
    // collapse exact duplicates on vendor + sku + first break price
    var seen = {};
    var out = [];
    offers.forEach(function (o) {
      var key = (o.vendor + '|' + o.sku + '|' + o.packaging + '|' + (o.breaks[0] ? o.breaks[0].price : '')).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(o);
    });
    countQuoteRows(root);
    STATE.mpn = ctx.mpn;
    STATE.desc = ctx.desc;
    STATE.lastScan = {
      at: new Date().toISOString(),
      ms: Date.now() - started,
      candidates: els.length,
      parsed: out.length,
      channelNames: Object.keys(STATE.channels).length,
      rejects: STATE.rejects
    };
    log('scan', STATE.lastScan);
    return out;
  }

  // Rows with stock but no price never reach parseRow, because the candidate
  // sweep looks for money. They are still real offers, so they get counted
  // and reported rather than vanishing silently.
  function countQuoteRows(root) {
    var scope = root || document.body;
    if (!scope) return 0;
    var all = scope.querySelectorAll('tr, li, div[class]');
    var hits = [];
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      var txt = el.textContent || '';
      if (txt.length < 24 || txt.length > 1600) continue;
      if (hasMoney(txt)) continue;
      // textContent welds cells together ("750000RFQ"), which eats the word
      // boundary, so the marker is read from the separated text.
      if (!/\brfq\b|request\s+a?\s*quote|quote\s+on\s+request/i.test(cleanText(lineText(el)))) continue;
      hits.push(el);
    }
    var outer = new Set();
    hits.forEach(function (el) {
      var up = el.parentElement;
      var climbed = 0;
      while (up && climbed < 24) { outer.add(up); up = up.parentElement; climbed += 1; }
    });
    var n = hits.filter(function (el) { return !outer.has(el); }).length;
    if (n) STATE.rejects['no price ladder (RFQ or quote-on-request row)'] = n;
    return n;
  }

  function expandLadders() {
    var els = candidateRows(document.body);
    var clicked = 0;
    els.forEach(function (el) {
      var nodes = el.querySelectorAll('button, a, [role="button"]');
      for (var i = 0; i < nodes.length; i += 1) {
        if (EXPANDER_RE.test(cleanText(nodes[i].textContent))) {
          try { nodes[i].click(); clicked += 1; } catch (e) { log('expander click failed', e); }
        }
      }
    });
    return clicked;
  }

  // ------------------------------------------------------------------- state

  var STATE = {
    mpn: '',
    desc: '',
    rows: [],
    cart: [],
    buildQty: 1,
    channels: {},
    rejects: {},
    lastScan: null,
    prefs: {
      usdOnly: true,
      dollarIsUsd: true,
      authOnly: false,
      inStockOnly: false,
      markIndependents: true
    },
    picking: false
  };

  function loadStored() {
    try {
      var c = localStorage.getItem(CFG.cartKey);
      if (c) STATE.cart = JSON.parse(c) || [];
      var p = localStorage.getItem(CFG.prefKey);
      if (p) {
        var parsed = JSON.parse(p) || {};
        Object.keys(STATE.prefs).forEach(function (k) {
          if (typeof parsed[k] === 'boolean') STATE.prefs[k] = parsed[k];
        });
        if (parsed.buildQty) STATE.buildQty = toInt(parsed.buildQty) || 1;
      }
    } catch (e) { log('storage read failed', e); }
  }

  function saveStored() {
    try {
      localStorage.setItem(CFG.cartKey, JSON.stringify(STATE.cart));
      var p = {};
      Object.keys(STATE.prefs).forEach(function (k) { p[k] = STATE.prefs[k]; });
      p.buildQty = STATE.buildQty;
      localStorage.setItem(CFG.prefKey, JSON.stringify(p));
    } catch (e) { log('storage write failed', e); }
  }

  // A bare dollar sign is ambiguous. Both aggregators default to US dollars
  // for a US visitor, so the assumption is on by default and stated in the
  // panel, in the About text, and on the exported offer.
  function assumedUsd(o) { return o.currency === 'USD?' && STATE.prefs.dollarIsUsd; }

  function isUsd(o) { return o.currency === 'USD' || assumedUsd(o); }

  function visibleRows() {
    return STATE.rows.filter(function (o) {
      if (STATE.prefs.usdOnly && !isUsd(o)) return false;
      if (STATE.prefs.authOnly && o.authorized !== true) return false;
      if (STATE.prefs.inStockOnly && (o.stock === null || o.stock < STATE.buildQty)) return false;
      return true;
    });
  }

  function chosenRows() {
    return visibleRows().filter(function (o) { return o.include; });
  }

  // ----------------------------------------------------------------- exports

  function tallyOffers(list) {
    var kept = list.filter(isUsd);
    return {
      doc: {
        kind: 'tally-offers',
        version: 1,
        capturedAt: new Date().toISOString(),
        source: location.hostname,
        stamper: CFG.name + ' ' + CFG.version,
        offers: kept.map(function (o) {
          return {
            mpn: o.mpn,
            vendor: o.vendor,
            sku: o.sku,
            authorized: o.authorized,
            currency: 'USD',
            currencyAssumed: assumedUsd(o),
            packaging: o.packaging,
            moq: o.moq,
            pack: o.pack,
            leadDays: o.leadDays,
            stock: o.stock,
            breaks: o.breaks.map(function (b) { return { qty: b.qty, price: b.price }; }),
            ladderTruncated: o.ladderTruncated,
            ladderInferred: !!o.ladderInferred,
            url: o.url,
            capturedAt: o.capturedAt
          };
        })
      },
      dropped: list.length - kept.length
    };
  }

  function tallyJob(list) {
    var kept = list.filter(isUsd);
    var byMpn = {};
    var order = [];
    kept.forEach(function (o) {
      var key = (o.mpn || 'UNKNOWN');
      if (!byMpn[key]) { byMpn[key] = []; order.push(key); }
      byMpn[key].push(o);
    });
    var bom = order.map(function (mpn, i) {
      return {
        ref: 'P' + (i + 1),
        mpn: mpn,
        desc: byMpn[mpn][0].desc || STATE.desc || '',
        qtyPer: 1,
        offers: byMpn[mpn].map(function (o) {
          var vendor = o.vendor;
          if (STATE.prefs.markIndependents && o.authorized === false) vendor = vendor + ' (ind)';
          return {
            vendor: vendor,
            sku: o.sku,
            moq: o.moq,
            pack: o.pack,
            leadDays: o.leadDays === null ? 0 : o.leadDays,
            stock: o.stock === null ? 0 : o.stock,
            breaks: o.breaks.map(function (b) { return { qty: b.qty, price: b.price }; })
          };
        })
      };
    });
    return {
      doc: {
        meta: {
          name: 'Offer stamp ' + (order.length === 1 ? order[0] : order.length + ' parts'),
          created: new Date().toISOString(),
          source: location.hostname
        },
        buildQty: STATE.buildQty,
        bom: bom
      },
      dropped: list.length - kept.length
    };
  }

  function comparisonCsv(list) {
    var head = ['mpn', 'vendor', 'authorized', 'currency', 'packaging', 'moq', 'pack', 'lead_days',
      'stock', 'buy_qty', 'unit_price', 'extended', 'ladder_truncated', 'ladder_inferred', 'captured_at', 'url'];
    var rows = [head];
    list.forEach(function (o) {
      var buy = purchaseQty(STATE.buildQty, o.moq, o.pack);
      var unit = priceAtQty(o.breaks, buy);
      rows.push([
        o.mpn,
        o.vendor,
        o.authorized === null ? '' : (o.authorized ? 'authorized' : 'independent'),
        o.currency,
        o.packaging,
        o.moq,
        o.pack,
        o.leadDays === null ? '' : o.leadDays,
        o.stock === null ? '' : o.stock,
        buy,
        unit === null ? '' : unit.toFixed(4),
        unit === null ? '' : (unit * buy).toFixed(2),
        o.ladderTruncated ? 'yes' : 'no',
        o.ladderInferred ? 'yes' : 'no',
        o.capturedAt,
        o.url
      ]);
    });
    return csvRows(rows);
  }

  var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  function redact(text) {
    return String(text || '').replace(EMAIL_RE, '[redacted]');
  }

  // A structural report for tuning the selectors against a page I cannot see.
  // It carries public product-page text only: no input values, no cookies,
  // no storage, and anything email shaped is redacted on the way out.
  function skeletonOf(el) {
    var kids = el.children ? Array.prototype.slice.call(el.children, 0, 12) : [];
    return {
      tag: (el.tagName || '').toLowerCase(),
      cls: cleanText(typeof el.className === 'string' ? el.className : '').slice(0, 80),
      children: kids.map(function (k) { return (k.tagName || '').toLowerCase(); }).join(','),
      text: redact(cleanText(lineText(el))).slice(0, 400)
    };
  }

  function diagnostics() {
    var els = candidateRows(document.body);
    var samples = [];
    for (var i = 0; i < els.length && samples.length < 40; i += 1) {
      var sk = skeletonOf(els[i]);
      var block = blockVendorFor(els[i]);
      var flat = cleanText(lineText(els[i]));
      sk.read = {
        blockVendor: block ? block.vendor : null,
        blockChannel: block ? block.authorized : null,
        mpn: mpnFromRow(els[i]),
        sku: skuFrom(els[i], block ? block.vendor : '', { mpn: STATE.mpn }),
        stock: parseStock(flat),
        moq: parseMoq(flat),
        pack: parsePack(flat),
        leadDays: parseLead(flat),
        packaging: parsePackaging(flat),
        breaks: parseBreaks(lineText(els[i])).length
      };
      samples.push(sk);
    }
    return {
      stamper: CFG.name + ' ' + CFG.version,
      at: new Date().toISOString(),
      site: siteId(),
      url: location.href,
      pageMpn: { fromUrl: mpnFromUrl(), fromHeading: mpnFromHeading(), resolved: STATE.mpn },
      channels: STATE.channels,
      scan: STATE.lastScan,
      samples: samples
    };
  }

  function stamp(name) {
    var mpn = (STATE.mpn || 'part').replace(/[^A-Za-z0-9._-]/g, '_');
    var d = new Date().toISOString().slice(0, 10);
    return mpn + '-' + name + '-' + d;
  }

  function deliver(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (e) { log('download failed', e); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    } catch (e2) { log('clipboard failed', e2); }
  }

  // -------------------------------------------------------------------- panel

  var UI = { host: null, root: null, panel: null, open: false, tbody: null, status: null };

  var CSS = [
    ':host { all: initial; }',
    '.wrap { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;',
    '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }',
    '.launch { display: block; min-height: 40px; padding: 10px 14px; border: 1px solid #ffb000;',
    '  background: #0b0f14; color: #ffb000; font-size: 13px; letter-spacing: 0.08em; cursor: pointer;',
    '  text-transform: uppercase; }',
    '.launch:hover { background: #16202b; }',
    '.launch:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid #2ff3ff; outline-offset: 2px; }',
    '.panel { width: min(760px, calc(100vw - 40px)); max-height: min(74vh, 720px); overflow: auto;',
    '  background: #0b0f14; color: #ffcc66; border: 1px solid #ffb000;',
    '  box-shadow: 0 0 0 1px #05080b, 0 12px 40px rgba(0,0,0,0.6); font-size: 12px; }',
    '.hd { display: flex; align-items: center; gap: 8px; padding: 8px 10px;',
    '  border-bottom: 1px solid #2ff3ff44; position: sticky; top: 0; background: #0b0f14; }',
    '.hd h2 { margin: 0; font-size: 12px; letter-spacing: 0.14em; color: #ffb000; text-transform: uppercase; }',
    '.ver { color: #7fb2c8; font-size: 11px; }',
    '.spacer { flex: 1; }',
    '.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 10px;',
    '  border-bottom: 1px solid #2ff3ff22; }',
    'label { color: #9fd6e6; display: inline-flex; align-items: center; gap: 5px; }',
    'input[type=text], input[type=number] { background: #05080b; color: #ffcc66; border: 1px solid #2ff3ff44;',
    '  padding: 6px 6px; font: inherit; min-height: 30px; }',
    'input[type=checkbox] { width: 16px; height: 16px; accent-color: #ffb000; }',
    'button { min-height: 32px; padding: 6px 10px; background: #101822; color: #ffcc66;',
    '  border: 1px solid #2ff3ff55; font: inherit; cursor: pointer; }',
    'button:hover { background: #17222e; color: #ffb000; }',
    'button.primary { border-color: #ffb000; color: #ffb000; }',
    'table { width: 100%; border-collapse: collapse; }',
    'th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #16232e; vertical-align: top; }',
    'th { color: #7fb2c8; font-weight: normal; letter-spacing: 0.06em; text-transform: uppercase; font-size: 11px; }',
    '.auth { color: #6fe08a; }',
    '.ind { color: #ff7a59; }',
    '.unk { color: #7f8c99; }',
    '.warn { color: #ff7a59; }',
    '.muted { color: #7f8c99; }',
    '.edit { background: #070c11; }',
    '.edit input { width: 90px; }',
    '.foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 10px; border-top: 1px solid #2ff3ff44;',
    '  position: sticky; bottom: 0; background: #0b0f14; }',
    '.status { padding: 6px 10px; color: #9fd6e6; min-height: 18px; }',
    '.about { padding: 10px; border-top: 1px solid #2ff3ff22; color: #9fd6e6; line-height: 1.5; }',
    '.about a { color: #ffb000; }',
    '.empty { padding: 18px 10px; color: #7f8c99; }',
    '.pick { outline: 2px dashed #2ff3ff !important; outline-offset: 1px !important; }',
    '@media (prefers-reduced-motion: no-preference) { .panel { transition: opacity 120ms linear; } }'
  ].join('\n');

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'cls') node.className = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (k in node && k !== 'title' && k !== 'type') {
          try { node[k] = attrs[k]; } catch (e) { node.setAttribute(k, attrs[k]); }
        } else node.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
    return node;
  }

  function say(msg) {
    if (UI.status) UI.status.textContent = msg;
    log(msg);
  }

  function mount() {
    if (UI.host && document.body.contains(UI.host)) return;
    UI.host = document.createElement('div');
    UI.host.setAttribute('data-ms', 'offer-stamper');
    UI.root = UI.host.attachShadow ? UI.host.attachShadow({ mode: 'open' }) : UI.host;
    var style = document.createElement('style');
    style.textContent = CSS;
    UI.root.appendChild(style);
    var wrap = el('div', { cls: 'wrap' });
    UI.wrap = wrap;
    var launch = el('button', {
      cls: 'launch', type: 'button', text: 'Stamp offers',
      title: CFG.name + ' ' + CFG.version,
      onclick: function () { toggle(true); }
    });
    UI.launch = launch;
    wrap.appendChild(launch);
    UI.root.appendChild(wrap);
    document.body.appendChild(UI.host);
    log('mounted');
  }

  function toggle(open) {
    UI.open = open;
    if (open) {
      if (!UI.panel) buildPanel();
      UI.launch.style.display = 'none';
      UI.panel.style.display = 'block';
      if (!STATE.rows.length) doScan();
      render();
    } else if (UI.panel) {
      UI.panel.style.display = 'none';
      UI.launch.style.display = 'block';
      UI.launch.focus();
    }
  }

  function buildPanel() {
    var panel = el('div', { cls: 'panel', role: 'dialog', 'aria-label': CFG.name });

    var mpnInput = el('input', {
      type: 'text', value: STATE.mpn, size: 18, 'aria-label': 'Manufacturer part number',
      oninput: function (e) { STATE.mpn = cleanText(e.target.value); STATE.rows.forEach(function (r) { r.mpn = STATE.mpn; }); }
    });
    UI.mpnInput = mpnInput;

    var qtyInput = el('input', {
      type: 'number', min: '1', step: '1', value: String(STATE.buildQty), 'aria-label': 'Build quantity',
      oninput: function (e) { STATE.buildQty = Math.max(1, toInt(e.target.value) || 1); saveStored(); render(); }
    });
    UI.qtyInput = qtyInput;

    var hd = el('div', { cls: 'hd' }, [
      el('h2', { text: CFG.short }),
      el('span', { cls: 'ver', text: 'v' + CFG.version }),
      el('span', { cls: 'spacer' }),
      el('button', { type: 'button', text: 'Rescan', onclick: function () { doScan(); render(); } }),
      el('button', { type: 'button', text: 'Expand ladders', onclick: function () {
        var n = expandLadders();
        say(n + ' expander(s) clicked, rescanning');
        setTimeout(function () { doScan(); render(); }, 600);
      } }),
      el('button', { type: 'button', text: 'Pick table', onclick: function () { startPick(); } }),
      el('button', { type: 'button', text: 'Close', 'aria-label': 'Close panel', onclick: function () { toggle(false); } })
    ]);

    var bar1 = el('div', { cls: 'bar' }, [
      el('label', {}, [el('span', { text: 'MPN' }), mpnInput]),
      el('label', {}, [el('span', { text: 'Build qty' }), qtyInput]),
      checkbox('USD only', 'usdOnly'),
      checkbox('Read $ as USD', 'dollarIsUsd'),
      checkbox('Authorized only', 'authOnly'),
      checkbox('In stock for qty', 'inStockOnly')
    ]);

    var table = el('table');
    table.appendChild(el('thead', {}, [el('tr', {}, [
      th(''), th('Vendor'), th('Channel'), th('Part #'), th('SKU'), th('Stock'), th('MOQ/Pack'),
      th('Lead'), th('Breaks'), th('Buy'), th('Unit'), th('')
    ])]));
    UI.tbody = el('tbody');
    table.appendChild(UI.tbody);

    UI.status = el('div', { cls: 'status', role: 'status', 'aria-live': 'polite' });

    var foot = el('div', { cls: 'foot' }, [
      el('button', { type: 'button', text: 'Add to cart', onclick: addToCart }),
      el('button', { type: 'button', text: 'Cart (0)', onclick: function () { showCart(); } }),
      el('button', { type: 'button', text: 'Clear cart', onclick: function () {
        STATE.cart = []; saveStored(); render(); say('Cart cleared.');
      } }),
      el('span', { cls: 'spacer' }),
      el('button', { cls: 'primary', type: 'button', text: 'TALLY offers .json', onclick: function () { exportOffers(); } }),
      el('button', { type: 'button', text: 'TALLY job .json', onclick: function () { exportJob(); } }),
      el('button', { type: 'button', text: 'Comparison .csv', onclick: function () { exportCsv(); } })
    ]);
    UI.cartBtn = foot.childNodes[1];

    var about = el('div', { cls: 'about' });
    about.style.display = 'none';
    UI.about = about;
    about.appendChild(el('div', { text: CFG.name + ' ' + CFG.version + '. License ' + CFG.license + '.' }));
    about.appendChild(el('div', { text: 'Reads only the page in front of you, on a click. No network calls, no API keys, no crawling.' }));
    about.appendChild(el('div', { text: 'Non-USD offers are never written into a TALLY file. TALLY is single currency and a converted price is not a quote.' }));
    about.appendChild(el('div', {}, [
      el('a', { href: CFG.repo, text: 'Repository', target: '_blank', rel: 'noreferrer' }),
      el('span', { text: '  ' }),
      el('a', { href: CFG.feedback, text: 'Feedback', target: '_blank', rel: 'noreferrer' })
    ]));

    var utility = el('div', { cls: 'bar' }, [
      el('button', { type: 'button', text: 'About', onclick: function () {
        about.style.display = about.style.display === 'none' ? 'block' : 'none';
      } }),
      el('button', { type: 'button', text: 'Debug log: off', onclick: function (e) {
        DEBUG = !DEBUG;
        e.target.textContent = 'Debug log: ' + (DEBUG ? 'on' : 'off');
      } }),
      el('button', { type: 'button', text: 'Diagnostics', onclick: function () {
        var d = diagnostics();
        deliver(stamp('diagnostics') + '.json', JSON.stringify(d, null, 2), 'application/json');
        say('Wrote a diagnostics report: ' + d.samples.length + ' candidate rows, ' +
          Object.keys(d.channels).length + ' distributors on file.');
      } }),
      el('button', { type: 'button', text: 'Self test', onclick: function () {
        var r = selfTest();
        say('Self test ' + r.passed + '/' + r.total + (r.failures.length ? ' FAILED: ' + r.failures[0] : ' green.'));
      } })
    ]);

    panel.appendChild(hd);
    panel.appendChild(bar1);
    panel.appendChild(table);
    panel.appendChild(UI.status);
    panel.appendChild(foot);
    panel.appendChild(utility);
    panel.appendChild(about);
    panel.style.display = 'none';
    UI.panel = panel;
    UI.wrap.appendChild(panel);

    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (STATE.picking) stopPick(); else toggle(false); }
    });
  }

  function th(label) { return el('th', { text: label, scope: 'col' }); }

  function checkbox(label, key) {
    var input = el('input', {
      type: 'checkbox', checked: STATE.prefs[key],
      onchange: function (e) { STATE.prefs[key] = !!e.target.checked; saveStored(); render(); }
    });
    return el('label', {}, [input, el('span', { text: label })]);
  }

  function channelCell(o) {
    if (o.authorized === true) return el('td', { cls: 'auth', text: 'authorized' });
    if (o.authorized === false) return el('td', { cls: 'ind', text: 'independent' });
    return el('td', { cls: 'unk', text: 'unknown' });
  }

  function render() {
    if (!UI.tbody) return;
    while (UI.tbody.firstChild) UI.tbody.removeChild(UI.tbody.firstChild);
    var rows = visibleRows();
    if (!rows.length) {
      var tr = el('tr', {}, [el('td', { cls: 'empty', colSpan: 12, text: STATE.rows.length
        ? 'Every captured offer is filtered out. Loosen the filters above.'
        : 'No offer table found. Use Pick table and click any seller row.' })]);
      UI.tbody.appendChild(tr);
    }
    rows.forEach(function (o) {
      var buy = purchaseQty(STATE.buildQty, o.moq, o.pack);
      var unit = priceAtQty(o.breaks, buy);
      var cb = el('input', {
        type: 'checkbox', checked: o.include, 'aria-label': 'Include ' + o.vendor,
        onchange: function (e) { o.include = !!e.target.checked; }
      });
      var tr = el('tr', {}, [
        el('td', {}, [cb]),
        el('td', { text: o.vendor }),
        channelCell(o),
        el('td', { text: o.mpn || '' }),
        el('td', { text: o.sku || '' }),
        el('td', { text: o.stock === null ? '?' : String(o.stock) }),
        el('td', { text: o.moq + ' / ' + o.pack }),
        el('td', { text: o.leadDays === null ? '' : (o.leadDays + 'd') }),
        el('td', {
          cls: (o.ladderTruncated || o.ladderInferred) ? 'warn' : '',
          text: o.breaks.length + (o.ladderTruncated ? ' cut' : '') + (o.ladderInferred ? ' guessed' : '')
        }),
        el('td', { text: String(buy) }),
        el('td', { cls: isUsd(o) ? '' : 'warn', text: (unit === null ? '' : unit.toFixed(4)) + ' ' + o.currency }),
        el('td', {}, [el('button', { type: 'button', text: 'Edit', onclick: function () { toggleEdit(o, tr); } })])
      ]);
      UI.tbody.appendChild(tr);
    });
    if (UI.cartBtn) UI.cartBtn.textContent = 'Cart (' + STATE.cart.length + ')';
    if (UI.mpnInput && UI.mpnInput.value !== STATE.mpn) UI.mpnInput.value = STATE.mpn;
    var hidden = STATE.rows.length - rows.length;
    say(STATE.rows.length + ' offers captured' + (hidden > 0 ? ', ' + hidden + ' hidden by filters' : '') + '.');
  }

  function toggleEdit(o, tr) {
    if (tr.nextSibling && tr.nextSibling.getAttribute && tr.nextSibling.getAttribute('data-edit') === o.id) {
      UI.tbody.removeChild(tr.nextSibling);
      return;
    }
    var fields = [
      ['mpn', 'text', 'Part #'], ['vendor', 'text', 'Vendor'], ['sku', 'text', 'SKU'], ['moq', 'number', 'MOQ'],
      ['pack', 'number', 'Pack'], ['stock', 'number', 'Stock'], ['leadDays', 'number', 'Lead days'],
      ['currency', 'text', 'Currency'], ['packaging', 'text', 'Packaging']
    ];
    var box = el('div', {});
    fields.forEach(function (f) {
      var input = el('input', {
        type: f[1], value: o[f[0]] === null || o[f[0]] === undefined ? '' : String(o[f[0]]),
        'aria-label': f[2],
        oninput: function (e) {
          var v = e.target.value;
          o[f[0]] = f[1] === 'number' ? (toNum(v) === null ? null : toNum(v)) : cleanText(v);
        }
      });
      box.appendChild(el('label', {}, [el('span', { text: f[2] }), input]));
      box.appendChild(el('span', { text: ' ' }));
    });
    var ladder = el('input', {
      type: 'text', size: 40, 'aria-label': 'Price breaks',
      value: o.breaks.map(function (b) { return b.qty + '@' + b.price; }).join(', '),
      oninput: function (e) {
        var parsed = [];
        String(e.target.value).split(/[,;]+/).forEach(function (chunk) {
          var m = chunk.match(/(\d[\d,]*)\s*@\s*([\d.]+)/);
          if (m) parsed.push({ qty: toInt(m[1]), price: toNum(m[2]) });
        });
        if (parsed.length) o.breaks = parsed.sort(function (a, b) { return a.qty - b.qty; });
      }
    });
    var auth = el('select', {
      'aria-label': 'Channel',
      onchange: function (e) {
        o.authorized = e.target.value === '' ? null : e.target.value === 'yes';
      }
    });
    [['', 'unknown'], ['yes', 'authorized'], ['no', 'independent']].forEach(function (opt) {
      var op = el('option', { value: opt[0], text: opt[1] });
      if ((o.authorized === true && opt[0] === 'yes') || (o.authorized === false && opt[0] === 'no') || (o.authorized === null && opt[0] === '')) op.selected = true;
      auth.appendChild(op);
    });
    box.appendChild(el('label', {}, [el('span', { text: 'Channel' }), auth]));
    box.appendChild(el('div', {}, [el('label', {}, [el('span', { text: 'Breaks qty@price' }), ladder])]));
    box.appendChild(el('button', { type: 'button', text: 'Done', onclick: function () { render(); } }));

    var row = el('tr', { cls: 'edit' }, [el('td', { colSpan: 12 }, [box])]);
    row.setAttribute('data-edit', o.id);
    if (tr.nextSibling) UI.tbody.insertBefore(row, tr.nextSibling);
    else UI.tbody.appendChild(row);
  }

  function doScan(root) {
    STATE.rows = scan(root);
    if (UI.mpnInput) UI.mpnInput.value = STATE.mpn;
    log('scan produced', STATE.rows.length);
  }

  // ------------------------------------------------------------- pick mode

  var pickHover = null;

  function startPick() {
    if (STATE.picking) return;
    STATE.picking = true;
    say('Pick mode: click any seller row. Esc cancels.');
    document.addEventListener('mouseover', onPickHover, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKey, true);
  }

  function stopPick() {
    STATE.picking = false;
    if (pickHover) { pickHover.classList.remove('pick'); pickHover = null; }
    document.removeEventListener('mouseover', onPickHover, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
    say('Pick mode off.');
  }

  function onPickKey(e) { if (e.key === 'Escape') { e.preventDefault(); stopPick(); } }

  function onPickHover(e) {
    if (!STATE.picking) return;
    var t = e.target;
    if (UI.host && UI.host.contains(t)) return;
    if (pickHover) pickHover.classList.remove('pick');
    pickHover = t;
    if (pickHover && pickHover.classList) pickHover.classList.add('pick');
  }

  function onPickClick(e) {
    if (!STATE.picking) return;
    if (UI.host && UI.host.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    var container = tableAround(e.target);
    stopPick();
    doScan(container || document.body);
    render();
    say('Picked a container with ' + STATE.rows.length + ' offers.');
  }

  // Climb from the clicked node to the smallest ancestor holding two or more
  // price-bearing siblings. That ancestor is the offer table.
  function tableAround(node) {
    var el2 = node;
    var hops = 0;
    while (el2 && hops < 10) {
      var kids = el2.children ? Array.prototype.slice.call(el2.children) : [];
      var priced = kids.filter(function (k) { return hasMoney(k.textContent || ''); });
      if (priced.length >= 2) return el2;
      el2 = el2.parentElement;
      hops += 1;
    }
    return null;
  }

  // --------------------------------------------------------------- cart work

  function addToCart() {
    var picked = chosenRows();
    if (!picked.length) { say('Nothing checked to add.'); return; }
    var added = 0;
    picked.forEach(function (o) {
      var key = (o.mpn + '|' + o.vendor + '|' + o.sku + '|' + o.packaging).toLowerCase();
      var existing = -1;
      for (var i = 0; i < STATE.cart.length; i += 1) {
        var c = STATE.cart[i];
        if ((c.mpn + '|' + c.vendor + '|' + c.sku + '|' + c.packaging).toLowerCase() === key) { existing = i; break; }
      }
      var copy = JSON.parse(JSON.stringify(o));
      if (existing >= 0) STATE.cart[existing] = copy;
      else { STATE.cart.push(copy); added += 1; }
    });
    saveStored();
    render();
    say(added + ' added, cart holds ' + STATE.cart.length + ' offers across ' + mpnCount() + ' parts.');
  }

  function mpnCount() {
    var seen = {};
    STATE.cart.forEach(function (o) { seen[o.mpn || 'UNKNOWN'] = true; });
    return Object.keys(seen).length;
  }

  function showCart() {
    if (!STATE.cart.length) { say('Cart is empty. Check offers and press Add to cart.'); return; }
    say('Cart: ' + STATE.cart.length + ' offers across ' + mpnCount() + ' parts. Exports use the cart when it holds anything.');
  }

  function exportSet() {
    return STATE.cart.length ? STATE.cart : chosenRows();
  }

  function exportOffers() {
    var set = exportSet();
    if (!set.length) { say('Nothing to export.'); return; }
    var made = tallyOffers(set);
    if (!made.doc.offers.length) { say('All offers dropped, none were native USD.'); return; }
    deliver(stamp('offers') + '.json', JSON.stringify(made.doc, null, 2), 'application/json');
    say('Wrote ' + made.doc.offers.length + ' offers' + (made.dropped ? ', dropped ' + made.dropped + ' non-USD' : '') + '. TALLY needs the Import offers door for this file.');
  }

  function exportJob() {
    var set = exportSet();
    if (!set.length) { say('Nothing to export.'); return; }
    var made = tallyJob(set);
    if (!made.doc.bom.length) { say('All offers dropped, none were native USD.'); return; }
    deliver(stamp('job') + '.json', JSON.stringify(made.doc, null, 2), 'application/json');
    say('Wrote a job with ' + made.doc.bom.length + ' line(s)' + (made.dropped ? ', dropped ' + made.dropped + ' non-USD' : '') + '. Open TALLY and use Load job.');
  }

  function exportCsv() {
    var set = exportSet();
    if (!set.length) { say('Nothing to export.'); return; }
    deliver(stamp('comparison') + '.csv', comparisonCsv(set), 'text/csv;charset=utf-8');
    say('Wrote a comparison sheet of ' + set.length + ' offers.');
  }

  // ---------------------------------------------------------------- self test

  function selfTest() {
    var failures = [];
    var total = 0;
    function ok(name, cond) {
      total += 1;
      if (!cond) failures.push(name);
    }
    var m1 = parseMoney('US$0.4231');
    ok('money us prefix', m1 && m1.currency === 'USD' && Math.abs(m1.price - 0.4231) < 1e-9);
    var m2 = parseMoney('1,234.50 EUR');
    ok('money trailing code', m2 && m2.currency === 'EUR' && m2.price === 1234.5);
    var m3 = parseMoney('$1.20');
    ok('bare dollar ambiguous', m3 && m3.currency === 'USD?' && m3.price === 1.2);
    ok('no money', parseMoney('lead time 12 weeks') === null);

    var b1 = parseBreaks('1: $0.42\n10: $0.31\n100: $0.24');
    ok('breaks colon', b1.length === 3 && b1[2].qty === 100 && b1[2].price === 0.24);
    var b2 = parseBreaks('1+\t$0.42\n1,000+\t$0.19');
    ok('breaks tabbed', b2.length === 2 && b2[1].qty === 1000 && b2[1].price === 0.19);
    var b3 = parseBreaks('100 pcs US$0.31 250 pcs US$0.28');
    ok('breaks inline', b3.length === 2 && b3[0].qty === 100 && b3[1].price === 0.28);
    ok('breaks sorted', parseBreaks('100: $0.24\n1: $0.42')[0].qty === 1);

    ok('money grouped thousands', parseMoney('$1,234.50').price === 1234.5);
    ok('money long decimal', parseMoney('US$0.4400').price === 0.44);
    ok('pack not truncated', parsePack('Mult: 2500') === 2500);
    ok('stock behind a sku digit', parseStock('511-USBLC6-2SC6 In Stock: 41,230') === 41230);
    ok('stock not confused by moq', parseStock('25,000 available MOQ 1') === 25000);
    ok('break qty not fused', parseBreaks('MOQ 1 1 $0.3800')[0].qty === 1);
    ok('stock labeled', parseStock('In Stock: 41,230') === 41230);
    ok('stock welded to packaging', parseStock('313294Digi-Reel') === 313294);
    ok('stock by region', parseStock('Americas - 8568000') === 8568000);
    ok('stock summed across regions',
      parseStock('Stock DE - 807000Stock HK - 3000Stock US - 0') === 810000);
    ok('bare stock cell', stockFromLines(['BAV99', '51049', '100 $0.05']) === 51049);
    ok('bare stock cell ignores a price line', stockFromLines(['100 $0.05', '0']) === 0);
    ok('lead weeks and days', parseLead('Lead time: 3 Weeks, 0 Days') === 21);
    ok('lead ten weeks five days', parseLead('Lead time: 10 Weeks, 5 Days') === 75);
    ok('ten thousand written as 10K', toIntSuffixed('10K') === 10000);
    ok('one and a half million', toIntSuffixed('1.5M') === 1500000);
    ok('plain number unaffected', toIntSuffixed('2,245') === 2245);
    ok('sponsored footnote stripped', stripFootnote('Arrow Electronics2') === 'Arrow Electronics');
    ok('footnote strip leaves real names', stripFootnote('Chip 1 Exchange') === 'Chip 1 Exchange');
    ok('non-authorized is not authorized', IND_RE.test('Non-Authorized Stocking Distributors') === true);
    ok('non-authorized checked before authorized',
      IND_RE.test('Non-Authorized Dealers') && AUTH_RE.test('Non-Authorized Dealers'));
    ok('container label wins', parsePackaging('Date Code: 0 Container: Tape & Reel') === 'Tape & Reel');
    ok('disti sku label', skuFrom !== undefined);
    ok('stock trailing', parseStock('12,000 available') === 12000);
    ok('stock zero', parseStock('Out of stock') === 0);
    ok('moq', parseMoq('Min Qty: 250') === 250);
    ok('moq word', parseMoq('MOQ 1,000') === 1000);
    ok('pack order multiple', parsePack('Order Multiple: 1,500') === 1500);
    ok('pack of', parsePack('Pack of 100') === 100);
    ok('lead weeks', parseLead('Lead time 12 weeks') === 84);
    ok('lead days', parseLead('Lead Time: 5 days') === 5);
    ok('lead months', parseLead('Lead time 3 months') === 90);
    ok('lead range takes the far end', parseLead('Lead time 8-10 weeks') === 70);
    ok('packaging', parsePackaging('Cut Tape (CT)') === 'Cut Tape');

    ok('purchase moq first', purchaseQty(10, 250, 1) === 250);
    ok('purchase pack round', purchaseQty(10, 1, 2500) === 2500);
    ok('purchase both', purchaseQty(3000, 250, 2500) === 5000);
    ok('purchase plain', purchaseQty(7, 1, 1) === 7);

    var ladder = [{ qty: 1, price: 0.42 }, { qty: 10, price: 0.31 }, { qty: 100, price: 0.24 }];
    ok('price walk mid', priceAtQty(ladder, 50) === 0.31);
    ok('price walk under', priceAtQty(ladder, 1) === 0.42);
    ok('price walk over', priceAtQty(ladder, 5000) === 0.24);

    ok('csv quoting', csvCell('Steel, 2" Drop') === '"Steel, 2"" Drop"');
    ok('entities', cleanText('595&amp;#44;000') === '595,000');

    var sample = [
      { mpn: 'X1', vendor: 'Mouser', sku: 'S1', authorized: true, currency: 'USD', packaging: '', moq: 1, pack: 1, leadDays: 84, stock: 10, breaks: [{ qty: 1, price: 1 }], ladderTruncated: false, url: 'u', capturedAt: 'c', include: true },
      { mpn: 'X1', vendor: 'Broker', sku: 'S2', authorized: false, currency: 'EUR', packaging: '', moq: 1, pack: 1, leadDays: null, stock: null, breaks: [{ qty: 1, price: 2 }], ladderTruncated: false, url: 'u', capturedAt: 'c', include: true }
    ];
    var off = tallyOffers(sample);
    ok('offers drop non usd', off.doc.offers.length === 1 && off.dropped === 1);
    ok('offers keep channel', off.doc.offers[0].authorized === true);
    var job = tallyJob(sample);
    ok('job one line', job.doc.bom.length === 1 && job.doc.bom[0].offers.length === 1);
    ok('job offer keys', Object.keys(job.doc.bom[0].offers[0]).join(',') === 'vendor,sku,moq,pack,leadDays,stock,breaks');
    ok('job nulls coerced', job.doc.bom[0].offers[0].leadDays === 84);
    var csv = comparisonCsv(sample);
    ok('csv header', csv.split('\r\n')[0].indexOf('mpn,vendor,authorized') === 0);
    ok('csv rows', csv.trim().split('\r\n').length === 3);

    return { total: total, passed: total - failures.length, failures: failures };
  }

  // ------------------------------------------------------------ spa handling

  function hookNav() {
    var fire = function () {
      setTimeout(function () {
        mount();
        if (mpnFromUrl() && mpnFromUrl() !== STATE.mpn) {
          STATE.mpn = '';
          STATE.desc = '';
          STATE.rows = [];
          if (UI.open) { doScan(); render(); }
        }
      }, 500);
    };
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      if (typeof orig !== 'function') return;
      history[fn] = function () {
        var r = orig.apply(this, arguments);
        fire();
        return r;
      };
    });
    window.addEventListener('popstate', fire);
  }

  // ------------------------------------------------------------ console api

  window.OfferStamper = {
    version: CFG.version,
    help: function () {
      console.log([
        CFG.name + ' ' + CFG.version,
        'OfferStamper.scan()      rescan the page and return the offers',
        'OfferStamper.rows()      the current capture',
        'OfferStamper.cart()      the cross part cart',
        'OfferStamper.open()      open the panel',
        'OfferStamper.debug(true) console logging on',
        'OfferStamper.selftest()  run the built in assertions'
      ].join('\n'));
    },
    scan: function () { doScan(); render(); return STATE.rows; },
    rows: function () { return STATE.rows; },
    cart: function () { return STATE.cart; },
    open: function () { mount(); toggle(true); },
    debug: function (on) { DEBUG = !!on; return DEBUG; },
    selftest: function () { var r = selfTest(); console.log(r); return r; },
    diagnostics: function () { var d = diagnostics(); console.log(d); return d; },
    _i: {
      parseMoney: parseMoney, parseBreaks: parseBreaks, parseStock: parseStock,
      parseMoq: parseMoq, parsePack: parsePack, parseLead: parseLead,
      parsePackaging: parsePackaging, purchaseQty: purchaseQty, priceAtQty: priceAtQty,
      csvCell: csvCell, cleanText: cleanText, vendorFrom: vendorFrom,
      authorizedFrom: authorizedFrom, candidateRows: candidateRows, parseRow: parseRow,
      scan: scan, diagnostics: diagnostics, channelMapFromPage: channelMapFromPage,
      blockVendorFor: blockVendorFor, mpnFromRow: mpnFromRow, tallyOffers: tallyOffers,
      columnLadder: columnLadder, toIntSuffixed: toIntSuffixed, stripFootnote: stripFootnote,
      leadFromCells: leadFromCells, columnValue: columnValue, tallyJob: tallyJob, comparisonCsv: comparisonCsv,
      tableAround: tableAround, mpnFromUrl: mpnFromUrl, selfTest: selfTest, STATE: STATE
    }
  };

  // ----------------------------------------------------------------- startup

  loadStored();
  mount();
  hookNav();
  console.log('[offer-stamper] ' + CFG.version + ' ready on ' + siteId() + '. OfferStamper.help() for the console API.');
}());
