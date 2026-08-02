#!/usr/bin/env node
/* Track C :: scan-truncation.js :: v1.0.0
   Finds the number pattern that silently truncates ungrouped quantities.
   Usage: node scan-truncation.js <file> [file...]
   Exit code 1 if anything is found, so it can sit in a pre-commit hook. */

var fs = require('fs');

// The bug: \d{1,3}(?:,\d{3})* matches "250" out of "2500" and stops, because
// the comma group is optional and the regex has already succeeded. Any
// alternation behind it (|\d+) never gets a turn. A pack of 2500 becomes 250.
var VULNERABLE = [
  { re: /\\d\{1,3\}\(\?:,\\d\{3\}\)\*/g, name: '\\d{1,3}(?:,\\d{3})*' },
  { re: /\[0-9\]\{1,3\}\(\?:,\[0-9\]\{3\}\)\*/g, name: '[0-9]{1,3}(?:,[0-9]{3})*' },
  { re: /\\d\{1,3\}\(,\\d\{3\}\)\*/g, name: '\\d{1,3}(,\\d{3})*' }
];

// The fix: require at least one comma group in the grouped alternative, and
// put a plain-digits alternative behind it.
var FIX = '\\d{1,3}(?:,\\d{3})+|\\d+';

function scanText(text, label) {
  var findings = [];
  var lines = String(text).split(/\r?\n/);
  lines.forEach(function (line, i) {
    VULNERABLE.forEach(function (v) {
      v.re.lastIndex = 0;
      var m;
      while ((m = v.re.exec(line)) !== null) {
        findings.push({
          file: label,
          line: i + 1,
          column: m.index + 1,
          pattern: v.name,
          text: line.trim().slice(0, 120)
        });
      }
    });
  });
  return findings;
}

function scanFile(path) {
  return scanText(fs.readFileSync(path, 'utf8'), path);
}

if (require.main === module) {
  var files = process.argv.slice(2);
  if (!files.length) {
    console.log('usage: node scan-truncation.js <file> [file...]');
    process.exit(2);
  }
  var all = [];
  files.forEach(function (f) {
    try {
      all = all.concat(scanFile(f));
    } catch (e) {
      console.log('  SKIP  ' + f + '  (' + e.message + ')');
    }
  });
  if (!all.length) {
    console.log('clean: no truncating number pattern in ' + files.length + ' file(s)');
    process.exit(0);
  }
  console.log('');
  all.forEach(function (f) {
    console.log('  ' + f.file + ':' + f.line + ':' + f.column + '  ' + f.pattern);
    console.log('      ' + f.text);
  });
  console.log('');
  console.log(all.length + ' occurrence(s). Replace the grouped alternative with:');
  console.log('  ' + FIX);
  console.log('A quantity of 2500 currently parses as 250.');
  process.exit(1);
}

module.exports = { scanText: scanText, scanFile: scanFile, FIX: FIX };
