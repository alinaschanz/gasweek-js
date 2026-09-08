import assert from "node:assert/strict";
import { test } from "node:test";
import { bar, bucket, byWeekday, gwei, localParts, median, percentile, summarize, table } from "../src/stats.js";
import type { BlockFee } from "../src/fees.js";

const row = (number: number, timestamp: number, baseFeeGwei: number, blob: number | null = null): BlockFee => ({
  number,
  timestamp,
  baseFeeGwei,
  gasUsedRatio: 0.5,
  blobFeeGwei: blob,
});

test("percentiles interpolate between order statistics", () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([4, 1, 3, 2], 25), 1.75);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1);
  assert.equal(percentile([7], 90), 7);
  assert.equal(median([3, 1, 2]), 2);
  assert.throws(() => percentile([], 50));
});

test("local parts: hour and weekday follow the offset, monday is 0", () => {
  const tuesdayNoonUtc = Date.UTC(2026, 8, 8, 12, 0, 0) / 1000;
  assert.deepEqual(localParts(tuesdayNoonUtc), { hour: 12, weekday: 1 });
  assert.deepEqual(localParts(tuesdayNoonUtc, 2), { hour: 14, weekday: 1 });
  assert.deepEqual(localParts(tuesdayNoonUtc, 13), { hour: 1, weekday: 2 });
  const sunday = Date.UTC(2026, 8, 6, 23, 30, 0) / 1000;
  assert.equal(localParts(sunday).weekday, 6);
});

test("summarize: hours with data only, cheapest and priciest, blob median", () => {
  const t0 = Date.UTC(2026, 8, 7, 0, 0, 0) / 1000;
  const rows: BlockFee[] = [];
  for (let h = 0; h < 24; h++) {
    for (let k = 0; k < 5; k++) rows.push(row(h * 5 + k, t0 + h * 3600 + k * 12, h === 3 ? 0.02 : h === 17 ? 0.5 : 0.1, h < 12 ? 0.001 : null));
  }
  const s = summarize(rows);
  assert.equal(s.blocks, 120);
  assert.equal(s.cheapestHour, 3);
  assert.equal(s.priciestHour, 17);
  assert.equal(s.hours.size, 24);
  assert.equal(s.blobMedian, 0.001);
  assert.equal(s.weekdays.get(0), 0.1);
  assert.equal(byWeekday(rows).get(1)!.length, 0);
  assert.equal(s.min, 0.02);
  assert.equal(s.max, 0.5);
  assert.throws(() => summarize([]));
});

test("buckets are fixed width and start on a round boundary", () => {
  const rows = [row(1, 1000, 1), row(2, 1700, 2), row(3, 1900, 3), row(4, 3601, 4)];
  const b = bucket(rows, 1800);
  assert.deepEqual(b, [
    [0, [1, 2]],
    [1800, [3]],
    [3600, [4]],
  ]);
});

test("formatting: gwei precision by size, bars scaled to the top", () => {
  assert.equal(gwei(null), "n/a");
  assert.equal(gwei(0.04711), "0.047");
  assert.equal(gwei(1.234), "1.23");
  assert.equal(gwei(12.34), "12.3");
  assert.equal(gwei(1234.5), "1,235");
  assert.equal(bar(1, 2, 10), "#####");
  assert.equal(bar(0, 2), "");
  assert.equal(bar(0.01, 100), "#");
});

test("the table lists the hours that have data and names the extremes", () => {
  const t0 = Date.UTC(2026, 8, 7, 0, 0, 0) / 1000;
  const rows = [row(1, t0, 0.1), row(2, t0 + 12, 0.3), row(3, t0 + 5 * 3600, 0.05)];
  const out = table(rows, 2);
  assert.match(out, /hour \(utc\+2\)  median     p25     p75/);
  assert.match(out, /^02:00 {6}  0\.200/m);
  assert.match(out, /^07:00 {6}  0\.050/m);
  assert.doesNotMatch(out, /^03:00/m);
  assert.match(out, /cheapest hour 07:00, priciest 02:00 \(utc\+2\)/);
});
