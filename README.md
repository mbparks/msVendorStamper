# Offer Stamper

MS-009 in the Mike//Scripts catalog. A Tampermonkey / Violentmonkey userscript that reads a
Findchips or Octopart results page and captures the **whole vendor offer set** as a TALLY-ready
`offers[]` array.

MS-001 (BOM Stamper) and MS-002 (McMaster Stamper) both assume one page equals one offer, so
their panel is a record editor. An aggregator page is one search with many sellers and many part
numbers, so this panel is a table with selection.

Version 0.2.1. License: GPL-3.0

## What a live page actually looks like

v0.1.0 was written against fixtures. v0.2.0 and v0.2.1 were rebuilt against real pages from both
sites. The two sites turned out to have nothing structurally in common.

### Findchips: one table per distributor

Three assumptions corrected:

1. **There is no separate part detail page.** `/search/<MPN>` is the results page, and it is
   organized as one table per distributor, each with its own header line.
2. **Rows within one distributor block are different part numbers.** A BAV99 search returns
   BAV99,LM(T from Newark, SBAV99WT1G from Arrow, BAV99W-7-F from RS. The MPN is therefore read
   **per row**, and the page-level MPN is only a fallback. Search pages are no longer refused.
3. **The row never names the distributor.** It names the *manufacturer*. Reading a row for its
   vendor labels a Mouser offer "onsemi". The vendor comes from the block header above the table,
   and the channel comes from the page's own distributor filter, which lists every seller under
   "Authorized Distributors" or "Independent Distributors". That roster beats any list shipped
   inside this script: it is current, complete, and page-specific.

### Octopart: one table for everybody, and the ladder lives in the header

Octopart does not print a quantity beside each price. It prints the break quantities **once**, in
the table header (1 / 10 / 100 / 1,000 / 10,000), and every seller row carries a price per column.
The ladder is therefore read from the grid by column position. Three consequences:

- A seller with a high minimum shows fewer prices than there are columns. Those prices are pinned
  to the **largest** quantities and the row is flagged `ladderInferred`, shown as `guessed` in the
  panel. A guessed ladder is never quietly believed.
- Quantities are written `10K`, and sponsored sellers carry a superscript footnote that lands in
  the text as `Arrow Electronics2`. Both are handled.
- The channel tabs read **Authorized Distributors**, **Non-Authorized Stocking Distributors**, and
  **Non-Authorized Dealers**. `/authoriz/` matches "Non-Authorized" too, so non-authorized is now
  always tested first. Getting that backwards would stamp a broker as franchised, which is the most
  expensive mistake this script could make. On the default Price and Stock tab every channel is
  mixed into one table, so rows come back with the channel unknown rather than guessed; use the
  Authorized tab if you want certainty.

## What it captures

Per seller row: `vendor`, `sku` (from the `DISTI #` label), `mpn`, `authorized`, `currency`,
`packaging` (from the `Container:` label), `moq`, `pack` (from `Package Multiple`), `leadDays`,
`stock`, `breaks[]`, `ladderTruncated`, `url`, `capturedAt`.

Stock is stated four different ways on one page and all four are read: `Americas - 8568000`,
`Stock DE - 807000Stock HK - 0` (summed), `313294Digi-Reel` (welded to the packaging label), and a
bare number in its own cell. Lead time handles `52 Weeks` and `3 Weeks, 0 Days`.

## Two rules worth knowing before you trust the output

**Currency.** TALLY is single currency and a converted price is not a quote, it is a guess with an
unknown FX rate baked in. Findchips has a currency estimator, so a page can be showing anything.
Non-USD offers are captured and shown but never written into a TALLY file. A bare dollar sign is
ambiguous, so it is tracked as `USD?`; the **Read $ as USD** toggle is on by default and every
offer exported under it carries `currencyAssumed: true`. Turn it off and only offers that state
USD explicitly are exported.

**Channel.** Authorized versus independent is the most valuable fact on the page and TALLY's offer
schema has nowhere to put it. The offers file carries `authorized` properly. The job file cannot,
so independents are labeled in the vendor name instead: `Quest Components (ind)`. That is a
workaround, and it is what the TALLY Import offers door is for.

## Three outputs

1. **TALLY offers .json** (`kind: "tally-offers"`). The real target. Sprays offers onto a bill that
   already exists, matched on MPN. **Needs the TALLY Import offers door, which does not exist yet.**
2. **TALLY job .json**. Works with TALLY today via **Load job**. One bill line per MPN. Offer keys
   are exactly what `sanitizeJob` keeps.
3. **Comparison .csv**. Purchase quantity with MOQ first then rounded up to the pack, unit price
   walked at that quantity, extended cost, channel, currency, staleness stamp.

Every export saves a named file **and** copies to the clipboard.

## Install

1. Install Tampermonkey or Violentmonkey.
2. Open `https://github.com/mbparks/msOfferStamper/raw/main/offer-stamper.user.js`.
3. Confirm the install.

Matches `findchips.com` and `octopart.com`.

## Usage

1. Search a part number, then click **Stamp offers** at the bottom left.
2. Set **Build qty**. Purchase quantity, unit price, and the in-stock filter key off it.
3. Press **Expand ladders** if any row shows a red `cut` marker. It clicks the page's own
   "See More" controls and rescans.
4. Filter, uncheck what you do not want, fix anything wrong with **Edit** on the row. Part number,
   vendor, SKU, MOQ, pack, stock, lead, currency, packaging, channel, and the ladder are all
   editable.
5. **Add to cart** to carry offers across searches, then export once for the whole BOM.

If the table is not found, press **Pick table** and click any seller row. Esc cancels.

**Diagnostics** writes a structural report: what was scanned, what parsed, what was rejected and
why, the distributor roster read from the page, and up to 40 candidate rows with each parser's
reading. It carries public product-page text only, no input values, and anything email shaped is
redacted. That file is what to send when a selector needs tuning.

## What this script does not do

No network calls, no API keys, no crawling. It reads the page already rendered in front of you,
when you click, at human rate. Octopart's data is also available through the Nexar API, which is
key-gated and paid-tiered, and a key in a userscript is a non-starter anyway.

## Known Limitations

- **A pinned ladder is a guess.** When a grid row has fewer prices than columns, the prices are
  assigned to the largest quantities. That is the right guess for a high-minimum seller and the
  wrong one if the site ever left-aligns a partial row. The row says `guessed`; check it before
  quoting from it.
- **Octopart channel is usually unknown.** The default table mixes authorized and non-authorized
  sellers with no per-row marker.
- **The vendor depends on a block header.** If a page ever moves the distributor name into the row
  or drops it into an image alt, vendor resolution falls back to reading the row, which is exactly
  the failure that produces manufacturer names in the vendor column. Diagnostics will show it.
- **Quote-on-request rows are counted, not captured.** A row with stock and no price is a real
  offer, but it cannot be costed. The status line reports how many were skipped.
- **The dollar assumption is an assumption.** See the currency rule above.
- **Channel is unknown when a seller is absent from the page filter.** It shows as unknown and is
  editable on the row rather than being guessed.
- **SKU capture is a heuristic when there is no `DISTI #` label.** The stock figure is explicitly
  excluded, but an unusual layout can still offer up the wrong token.
- **Ladder truncation is detected, not always fixed.** A row still marked `cut` means the exported
  price at volume may be too high.
- **The cart lives in the aggregator's own localStorage.** Clearing site data clears it.
- **TALLY cannot yet import the offers file.** Until the door is built, use the job file and accept
  that it creates a new job rather than pricing an existing one.

## Files

- `offer-stamper.user.js` - the script, single self-contained file, `@grant none`
- `offer-stamper.tests.js` - headless harness (`npm install jsdom`, then `node offer-stamper.tests.js`)

58 in-app assertions behind the **Self test** button, 103 headless assertions in the harness, and a
`window.OfferStamper` console API (`help`, `scan`, `rows`, `cart`, `debug`, `selftest`,
`diagnostics`).

## Version history

- **0.2.1** - rebuilt against a live Octopart page. Column-grid ladder reader with right-pinning
  and a `ladderInferred` flag, bare-priced grid rows recognized as candidates, `10K` quantities,
  sponsored-footnote stripping, labelled SKU / Min / Pkg / Lead columns, the canonical
  `/part/<manufacturer>/<mpn>` URL form, and the non-authorized-before-authorized fix. Table
  plumbing can no longer be mistaken for a block header.
- **0.2.0** - rebuilt against a live Findchips page. Block-header vendor resolution, channel map
  read from the page's distributor filter, per-row part numbers, `DISTI #` SKUs, four stock
  notations, weeks-and-days lead time, `Container:` packaging, quote-on-request row counting,
  linear-time row discovery for pages with hundreds of rows, and a diagnostics report.
- **0.1.0** - first build. Row discovery, channel detection, currency rules, ladder capture with
  truncation flag, pick-table fallback, cross-part cart, three exports.

Make. Hack. Learn. Share. Repeat.
