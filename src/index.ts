/** gasweek for the browser and node: when is ethereum cheapest? base fee by hour of day over the
 * last week, from a public json-rpc endpoint. zero dependencies, no keys. */
export { Rpc, RPCS } from "./rpc.js";
export type { Fetch } from "./rpc.js";
export { fetchFees, planPages, interpolate, parsePage, PAGE, BLOCKS_PER_HOUR } from "./fees.js";
export type { BlockFee, FeeHistoryResult, FetchOptions } from "./fees.js";
export { percentile, median, localParts, byHour, byWeekday, bucket, summarize, gwei, bar, table, WEEKDAYS } from "./stats.js";
export type { Summary } from "./stats.js";

import { Rpc } from "./rpc.js";
import { fetchFees, BLOCKS_PER_HOUR, type BlockFee, type FetchOptions } from "./fees.js";
import { summarize, type Summary } from "./stats.js";

export interface GasweekOptions extends FetchOptions {
  /** hours to look back; default 168 (a week) */
  hours?: number;
  /** offset for the hour-of-day bins, in hours; default 0 (utc) */
  tz?: number;
  /** your own endpoints first */
  rpc?: Rpc | string[];
}

/** the week in one call: rows and the summary. */
export async function gasweek(options: GasweekOptions = {}): Promise<{ rows: BlockFee[]; summary: Summary }> {
  const rpc = options.rpc instanceof Rpc ? options.rpc : new Rpc(options.rpc);
  const rows = await fetchFees(rpc, (options.hours ?? 168) * BLOCKS_PER_HOUR, options);
  return { rows, summary: summarize(rows, options.tz ?? 0) };
}
