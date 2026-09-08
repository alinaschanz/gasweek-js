# changelog

all notable changes to gasweek-js. the format follows [keep a changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [semver](https://semver.org/).

## [unreleased]

## [0.1.0] - 2026-09-08

first cut: the python gasweek in typescript, for the browser and node.

- `Rpc`: public endpoints tried in order, the one that answered goes first next time
- `fetchFees`: `eth_feeHistory` in 1024-block pages, one header per page, interpolated timestamps
- `summarize`, `percentile`, `bucket`, `table`: the same numbers as the python tool
- tests on the compiled output with `node --test`, no test framework
