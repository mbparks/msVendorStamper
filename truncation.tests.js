/* Track C :: truncation.tests.js :: v1.0.0
   node truncation.tests.js
   Proves the failure, proves the fix, and checks real files for the pattern. */

var path = require('path');
var scanner = require('./scan-truncation.js');

var passed = 0;
var failures = [];

function ok(name, cond, detail) {
  if (cond) { passed += 1; return; }
  failures.push(name + (detail === undefined ? '' : '  got: ' + JSON.stringify(detail)));
}

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), actual);
}

// ---------------------------------------------------------------- the bug

var OLD_INT = /(\d{1,3}(?:,\d{3})*|\d+)/;
var NEW_INT = /(\d{1,3}(?:,\d{3})+|\d+)/;

var OLD_NUM = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d*\.\d+|\d+)/;
var NEW_NUM = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/;

function first(re, s) { var m = s.match(re); return m ? m[1] : null; }

// This is the whole report. Four digits, no comma, and the pattern stops at
// three because the comma group is optional and the match already succeeded.
eq('the old pattern truncates 2500', first(OLD_INT, 'Mult: 2500'), '250');
eq('the fixed pattern reads 2500', first(NEW_INT, 'Mult: 2500'), '2500');

eq('old truncates a five digit quantity', first(OLD_INT, 'Qty 15000'), '150');
eq('fixed reads a five digit quantity', first(NEW_INT, 'Qty 15000'), '15000');

eq('old truncates a six digit stock', first(OLD_INT, '313294 in stock'), '313');
eq('fixed reads a six digit stock', first(NEW_INT, '313294 in stock'), '313294');

// Grouped numbers were always fine, which is why this survived so long: every
// number a human would think to test with has commas in it.
eq('old handles a grouped number', first(OLD_INT, '1,234'), '1,234');
eq('fixed handles a grouped number', first(NEW_INT, '1,234'), '1,234');
eq('fixed handles two comma groups', first(NEW_INT, '12,345,678'), '12,345,678');
eq('fixed still reads a single digit', first(NEW_INT, 'Min 1'), '1');
eq('fixed reads three digits unchanged', first(NEW_INT, 'Min 250'), '250');

// Prices break the same way, which turns a $1234.50 line item into $123.
eq('old truncates an ungrouped price', first(OLD_NUM, '$1234.50'), '123');
eq('fixed reads an ungrouped price', first(NEW_NUM, '$1234.50'), '1234.50');
eq('fixed reads a grouped price', first(NEW_NUM, '$1,234.50'), '1,234.50');
eq('fixed reads a bare decimal', first(NEW_NUM, '$.75'), '.75');
eq('fixed reads a long decimal', first(NEW_NUM, '$0.0588'), '0.0588');

// Worked examples in the two scripts that carry the bug.
eq('McMaster pack of 2500', first(OLD_INT, 'Packs of 2500'), '250');
eq('McMaster pack of 2500, fixed', first(NEW_INT, 'Packs of 2500'), '2500');
eq('a BOM quantity of 1500', first(OLD_INT, 'Quantity: 1500'), '150');
eq('a BOM quantity of 1500, fixed', first(NEW_INT, 'Quantity: 1500'), '1500');

// The order of the alternation matters: grouped first, or "1,234" reads as 1.
var WRONG_ORDER = /(\d+|\d{1,3}(?:,\d{3})+)/;
eq('plain digits first would break grouped numbers', first(WRONG_ORDER, '1,234'), '1');
ok('so the grouped alternative stays first',
  NEW_INT.source.indexOf('(?:,') < NEW_INT.source.indexOf('|\\d+'));

// --------------------------------------------------------------- scanner

var BEFORE = [
  'var QTY = /Mult(?:iple)?\\D{0,10}(\\d{1,3}(?:,\\d{3})*|\\d+)/i;',
  'var ALT = /qty[^0-9]{0,4}([0-9]{1,3}(?:,[0-9]{3})*)/i;',
  'var OK  = /price\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)/i;'
].join('\n');

var found = scanner.scanText(BEFORE, 'sample.js');
eq('scanner finds both vulnerable forms', found.length, 2);
eq('scanner reports the line number', found[0].line, 1);
ok('scanner leaves the fixed pattern alone',
  found.every(function (f) { return f.line !== 3; }), found);

var AFTER = BEFORE
  .replace('(\\d{1,3}(?:,\\d{3})*|\\d+)', '(\\d{1,3}(?:,\\d{3})+|\\d+)')
  .replace('([0-9]{1,3}(?:,[0-9]{3})*)', '([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)');
eq('scanner is clean after the fix', scanner.scanText(AFTER, 'sample.js').length, 0);

// The Offer Stamper was fixed during its own build; this pins it.
var STAMPER = path.join(__dirname, '..', 'msOfferStamper', 'offer-stamper.user.js');
try {
  eq('offer stamper carries no truncating pattern', scanner.scanFile(STAMPER).length, 0);
} catch (e) {
  ok('offer stamper not present to scan (skipped)', true);
}

// ------------------------------------------------------------------ report

console.log('');
console.log('Track C truncation fix');
console.log('passed ' + passed + ' / ' + (passed + failures.length));
if (failures.length) {
  console.log('');
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  process.exit(1);
}
console.log('all green');
