# Track C: the truncating number pattern

**MS-001 BOM Stamper 0.2.2 → 0.2.3, MS-002 McMaster Stamper 0.2.1 → 0.2.2.**

I do not have either script on disk, so this is the diagnosis, the exact edit, a scanner that finds
every occurrence, and 27 assertions that prove the failure and the fix. Upload the two files and I
will apply it, bump the versions, and re-run their own suites. Or apply it by hand in about a
minute per script, since it is a find and replace.

## The bug

```js
/(\d{1,3}(?:,\d{3})*|\d+)/
```

On `2500` this returns **250**.

`\d{1,3}` takes three digits, `(?:,\d{3})*` matches zero comma groups because it is allowed to, and
the regex has succeeded. The `|\d+` alternative behind it never gets a turn, because alternation
only tries the next branch when the current one fails, and this one did not fail. It just stopped
early.

Nothing throws. Nothing logs. You get a number that is plausible, wrong by a factor of ten, and
carried straight into a purchase order.

## Why it survived this long

Every number a person thinks to test with has a comma in it. `1,234` works. `12,345,678` works.
`250` works, `1` works. The pattern only fails on four or more digits with no separator, which is
exactly how distributor pages print pack quantities, order multiples, and stock: `2500`, `15000`,
`313294`.

Worked examples in the two affected scripts:

| Page text | Reads as | Should be |
| --- | --- | --- |
| `Packs of 2500` | 250 | 2500 |
| `Quantity: 1500` | 150 | 1500 |
| `Mult: 3000` | 300 | 3000 |
| `$1234.50` | $123 | $1234.50 |

The price row is the same failure in the decimal variant, and it is the worse one: a line item
silently costed at a tenth.

## The fix

Require at least one comma group in the grouped alternative, so it can no longer succeed on an
ungrouped number, and let plain digits take the branch behind it.

Integers:

```js
// before
(\d{1,3}(?:,\d{3})*|\d+)
// after
(\d{1,3}(?:,\d{3})+|\d+)
```

Decimals, where the same `*` appears:

```js
// before
(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d*\.\d+|\d+)
// after
(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)
```

Two things not to get wrong:

- **Order matters.** The grouped alternative stays first. Put `\d+` first and `1,234` reads as `1`,
  which trades a truncation bug for a worse one. There is an assertion pinning this.
- **`\d*\.\d+` becomes `\d+(?:\.\d+)?` plus `\.\d+`.** The original relied on the broken branch to
  handle whole numbers, so simply changing the star leaves `1234` unmatched in the decimal form.

## Finding every occurrence

```
node scan-truncation.js path/to/bom-stamper.user.js path/to/mcmaster-stamper.user.js
```

It prints file, line, column, and the offending pattern, and exits 1 if it finds anything, so it
can sit in a pre-commit hook. Run it across the whole fleet, not just these two: the same shape is
worth checking for in any Field Instrument that parses quantities off a page or a CSV. The Offer
Stamper is already clean and there is an assertion holding it that way.

## Verifying by hand

Paste into the console on any page, before and after:

```js
'Mult: 2500'.match(/(\d{1,3}(?:,\d{3})*|\d+)/)[1]   // "250"   the bug
'Mult: 2500'.match(/(\d{1,3}(?:,\d{3})+|\d+)/)[1]   // "2500"  fixed
```

## Regression guard

Add these to each script's own self test so it cannot come back:

```js
ok('four digits are not truncated', parseQty('Mult: 2500') === 2500);
ok('grouped numbers still parse',   parseQty('Mult: 12,500') === 12500);
ok('single digits still parse',     parseQty('Mult: 1') === 1);
```

Substitute whichever function each script actually uses. The first assertion is the one that
matters; the other two are there so a future fix cannot pass by breaking the grouped case.

## Files

- `scan-truncation.js` - the scanner, also importable (`scanText`, `scanFile`)
- `truncation.tests.js` - 27 assertions (`node truncation.tests.js`)

## Also done in this pass

Offer Stamper renumbered to **MS-009** per your call, in both the script header and the README.
Its 103 assertions still pass. Callsign Lens holds MS-008, and MS-007 is now vacant.

Make. Hack. Learn. Share. Repeat.
