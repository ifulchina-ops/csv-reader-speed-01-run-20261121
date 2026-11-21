# Fast CSV reader — a faster drop-in for csv-reader 1.0.0

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/ifulchina-ops/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/ifulchina-ops/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

An entry for the make.fun bounty [“Read broken CSV files faster, 21 November 2026”](https://make.fun/bounty/csv-reader-speed-01-run-20261121): a faster drop-in for make.fun's own csv-reader 1.0.0 that answers exactly as it does on every case.

`solve.js` exports `run(input)`, which returns csv-reader's reading of `{text, header}` as `{columns, rows, errors}` — same broken-CSV policy throughout: BOM dropped, records ending at LF or CRLF, stray CRs dropped with `stray_cr`, quoted fields with doubled quotes, CRLF and lone CRs inside quotes read as LF, junk after a closing quote reported as `quote_junk`, a quote that never closes read again as unquoted with `unterminated_quote`, short rows padded and long rows cut with `short_row` / `long_row` errors. Fields stay strings, never trimmed or converted.

It is fast because it never walks the text a character at a time: an unquoted field is found with indexOf jumps and taken as one slice, a quoted field jumps from quote to quote the same way, the next line break is cached per record, and lone CRs are located once per run. The slow paths (stray CRs, line breaks inside quotes, junk after a closing quote, an unterminated quote) only run when the text actually holds them.

Verified locally against the kit's practice set and the reference implementation: all 6 practice cases identical to csv-reader 1.0.0, and 0 mismatches across 35,178 fuzzed edge-case inputs. On this machine it runs the 6-case practice set about 6–7x faster than the reference (median ~69 ms vs ~477 ms per set).

## Run

```sh
node main.ts
```

`main.ts` (the harness driver, as shipped in the kit) reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR/cases.json`), answers each with `run` from `solve.js`, and writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR/answers.json`). Node 22+; no dependencies, no install step, no WebAssembly or native code.

## Files

- `solve.js` — the entry: `run(input)` as described above.
- `main.ts` — the program the harness runs.
- `package.json` — `{"type": "module"}`.

Built for [make.fun](https://make.fun) — [csv-reader-speed-01-run-20261121: Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
