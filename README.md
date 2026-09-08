# gasweek-js

when is ethereum cheapest? the base fee by hour of day over the last week, from a public
json-rpc endpoint, in the browser or in node. zero dependencies, no keys. the typescript twin of
[gasweek](https://github.com/alinaschanz/gasweek), same pages, same interpolation, same percentiles.

## install

```
npm install gasweek
```

or straight from the repository: `npm install github:alinaschanz/gasweek-js`.

## use

```ts
import { gasweek, table } from "gasweek";

const { rows, summary } = await gasweek({ hours: 168, tz: 2 }); // a week, hour bins in berlin summer time
console.log(summary.median, summary.cheapestHour, summary.priciestHour);
console.log(table(rows, 2));
```

in a browser it is the same import from a module script (the public endpoints answer cross-origin
requests); pass your own node first with `rpc: ["https://your.node", ...RPCS]`.

the pieces are exported on their own: `Rpc` (a list of endpoints tried in order, the one that
answered goes first next time), `fetchFees(rpc, blocks)` (rows with interpolated timestamps),
`summarize(rows, tz)` (min, p25, median, p75, p90, max, blob median, medians by hour and by
weekday, cheapest and priciest hour), `percentile`, `bucket`, `table`.

## how it works

- [`eth_feeHistory`](https://ethereum.github.io/execution-apis/api-documentation/) returns the base
  fee per block, the gas used ratio and, since cancun, the blob base fee. it does not return
  timestamps.
- so one block header per 1024-block page is fetched and the blocks in between are interpolated;
  post-merge blocks are 12 s apart except for missed slots, which keeps the error inside a page
  under a minute.
- percentiles are order statistics with linear interpolation; hour and weekday bins follow `tz`
  (an offset in hours, no dst logic on purpose).
- a full week is 50,400 blocks, 50 pages, four in flight at once; a minute or two on a public node.
- endpoints: publicnode, drpc, mevblocker, tenderly, blastapi, in that order.

## development

```
npm ci
npm test        # tsc, then node --test on the compiled output
```

## see also

- [gasweek](https://github.com/alinaschanz/gasweek), the python original, with the daily dataset and the svg chart
- [onchain-notes](https://github.com/alinaschanz/onchain-notes), the daily card

## license

mit.
