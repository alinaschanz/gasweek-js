/** percentiles and hour-of-day / day-of-week bins. pure functions, no network. */
import type { BlockFee } from "./fees.js";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** linear interpolation between order statistics; p in 0..100. */
export function percentile(values: number[], p: number): number {
  if (!values.length) throw new Error("no values");
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0];
  const pos = ((ordered.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, ordered.length - 1);
  return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return percentile(values, 50);
}

/** hour of day (0-23) and weekday (0 = monday, like python) of a unix timestamp shifted by `tzHours`. */
export function localParts(timestamp: number, tzHours = 0): { hour: number; weekday: number } {
  const d = new Date((timestamp + tzHours * 3600) * 1000);
  return { hour: d.getUTCHours(), weekday: (d.getUTCDay() + 6) % 7 };
}

export function byHour(rows: BlockFee[], tzHours = 0): Map<number, number[]> {
  const bins = new Map<number, number[]>();
  for (let h = 0; h < 24; h++) bins.set(h, []);
  for (const r of rows) bins.get(localParts(r.timestamp, tzHours).hour)!.push(r.baseFeeGwei);
  return bins;
}

export function byWeekday(rows: BlockFee[], tzHours = 0): Map<number, number[]> {
  const bins = new Map<number, number[]>();
  for (let d = 0; d < 7; d++) bins.set(d, []);
  for (const r of rows) bins.get(localParts(r.timestamp, tzHours).weekday)!.push(r.baseFeeGwei);
  return bins;
}

/** [bucketStartTimestamp, base fees] for fixed-width time buckets, oldest first. */
export function bucket(rows: BlockFee[], seconds: number): Array<[number, number[]]> {
  if (!rows.length) return [];
  const start = rows[0].timestamp - (rows[0].timestamp % seconds);
  const out = new Map<number, number[]>();
  for (const r of rows) {
    const key = start + Math.floor((r.timestamp - start) / seconds) * seconds;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(r.baseFeeGwei);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]);
}

export interface Summary {
  blocks: number;
  firstBlock: number;
  lastBlock: number;
  fromTs: number;
  toTs: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  gasUsedRatioMean: number;
  blobMedian: number | null;
  /** median base fee per hour of day, hours with data only */
  hours: Map<number, number>;
  /** median base fee per weekday (0 = monday) */
  weekdays: Map<number, number>;
  cheapestHour: number | null;
  priciestHour: number | null;
}

function medians(bins: Map<number, number[]>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [k, v] of bins) if (v.length) out.set(k, median(v));
  return out;
}

function extreme(map: Map<number, number>, pick: (a: number, b: number) => boolean): number | null {
  let best: number | null = null;
  for (const [k, v] of map) if (best === null || pick(v, map.get(best)!)) best = k;
  return best;
}

export function summarize(rows: BlockFee[], tzHours = 0): Summary {
  if (!rows.length) throw new Error("no rows");
  const fees = rows.map((r) => r.baseFeeGwei);
  const hours = medians(byHour(rows, tzHours));
  const weekdays = medians(byWeekday(rows, tzHours));
  const blobs = rows.flatMap((r) => (r.blobFeeGwei === null ? [] : [r.blobFeeGwei]));
  return {
    blocks: rows.length,
    firstBlock: rows[0].number,
    lastBlock: rows[rows.length - 1].number,
    fromTs: rows[0].timestamp,
    toTs: rows[rows.length - 1].timestamp,
    min: Math.min(...fees),
    p25: percentile(fees, 25),
    median: median(fees),
    p75: percentile(fees, 75),
    p90: percentile(fees, 90),
    max: Math.max(...fees),
    gasUsedRatioMean: rows.reduce((s, r) => s + r.gasUsedRatio, 0) / rows.length,
    blobMedian: blobs.length ? median(blobs) : null,
    hours,
    weekdays,
    cheapestHour: extreme(hours, (a, b) => a < b),
    priciestHour: extreme(hours, (a, b) => a > b),
  };
}

export function gwei(v: number | null): string {
  if (v === null) return "n/a";
  if (v >= 100) return Math.round(v).toLocaleString("en-US");
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export function bar(value: number, top: number, width = 24): string {
  const n = top <= 0 ? 0 : Math.round((width * value) / top);
  return "#".repeat(Math.max(n, value > 0 ? 1 : 0));
}

/** the hour-of-day table, the same shape as the python tool prints. */
export function table(rows: BlockFee[], tzHours = 0): string {
  const s = summarize(rows, tzHours);
  const bins = byHour(rows, tzHours);
  const tz = tzHours === 0 ? "utc" : `utc${tzHours > 0 ? "+" : ""}${tzHours}`;
  const top = Math.max(...s.hours.values());
  const lines = [
    `base fee, ${s.blocks.toLocaleString("en-US")} blocks ${s.firstBlock}-${s.lastBlock}: median ${gwei(s.median)} gwei, p25 ${gwei(s.p25)}, p75 ${gwei(s.p75)}, p90 ${gwei(s.p90)}, max ${gwei(s.max)}`,
    "",
    `hour (${tz})  median     p25     p75`,
  ];
  for (let h = 0; h < 24; h++) {
    const v = bins.get(h)!;
    if (!v.length) continue;
    const m = s.hours.get(h)!;
    lines.push(
      `${String(h).padStart(2, "0")}:00      ${gwei(m).padStart(7)} ${gwei(percentile(v, 25)).padStart(7)} ${gwei(percentile(v, 75)).padStart(7)}  ${bar(m, top)}`,
    );
  }
  if (s.cheapestHour !== null && s.priciestHour !== null) {
    lines.push("", `cheapest hour ${String(s.cheapestHour).padStart(2, "0")}:00, priciest ${String(s.priciestHour).padStart(2, "0")}:00 (${tz})`);
  }
  return lines.join("\n");
}
