/** eth_feeHistory in 1024-block pages, and a timestamp for every block.
 *
 * eth_feeHistory has no timestamps, so one block header per page is fetched and the blocks in
 * between are interpolated. post-merge blocks are 12 s apart except for missed slots, so the
 * error inside a page stays well under a minute. the same arithmetic as the python gasweek. */
import type { Rpc } from "./rpc.js";

export const PAGE = 1024; // the largest block count most public nodes accept per eth_feeHistory call
export const BLOCKS_PER_HOUR = 300; // 3600 s / 12 s slots

export interface BlockFee {
  number: number;
  /** unix seconds, interpolated */
  timestamp: number;
  baseFeeGwei: number;
  gasUsedRatio: number;
  blobFeeGwei: number | null;
}

export interface FeeHistoryResult {
  oldestBlock: string;
  baseFeePerGas: string[];
  gasUsedRatio?: number[];
  baseFeePerBlobGas?: string[];
}

/** [newestBlock, count] pairs, newest first, covering `blocks` blocks ending at `latest`. */
export function planPages(latest: number, blocks: number, page = PAGE): Array<[number, number]> {
  const pages: Array<[number, number]> = [];
  let newest = latest;
  let remaining = blocks;
  while (remaining > 0) {
    const count = Math.min(page, remaining, newest + 1);
    pages.push([newest, count]);
    newest -= count;
    remaining -= count;
    if (newest < 0) break;
  }
  return pages;
}

/** linear interpolation between the two anchor blocks around `number`. */
export function interpolate(anchors: Map<number, number>, number: number): number {
  const known = anchors.get(number);
  if (known !== undefined) return known;
  const below = [...anchors.keys()].filter((b) => b < number);
  const above = [...anchors.keys()].filter((b) => b > number);
  if (below.length && above.length) {
    const b1 = Math.max(...below);
    const b2 = Math.min(...above);
    const t1 = anchors.get(b1)!;
    const t2 = anchors.get(b2)!;
    return Math.round(t1 + ((number - b1) * (t2 - t1)) / (b2 - b1));
  }
  if (below.length) {
    const b1 = Math.max(...below);
    return anchors.get(b1)! + 12 * (number - b1);
  }
  const b2 = Math.min(...above);
  return anchors.get(b2)! - 12 * (b2 - number);
}

/** rows for one eth_feeHistory answer (the last baseFeePerGas entry is the *next* block, dropped). */
export function parsePage(result: FeeHistoryResult): Array<Omit<BlockFee, "timestamp">> {
  const oldest = parseInt(result.oldestBlock, 16);
  const base = result.baseFeePerGas.map((x) => parseInt(x, 16));
  const used = (result.gasUsedRatio ?? []).map(Number);
  const blob = result.baseFeePerBlobGas?.map((x) => parseInt(x, 16));
  const rows: Array<Omit<BlockFee, "timestamp">> = [];
  for (let i = 0; i < used.length; i++) {
    rows.push({
      number: oldest + i,
      baseFeeGwei: base[i] / 1e9,
      gasUsedRatio: used[i],
      blobFeeGwei: blob && i < blob.length ? blob[i] / 1e9 : null,
    });
  }
  return rows;
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export interface FetchOptions {
  /** the newest block; default: the node's latest */
  latest?: number;
  /** pages in flight at once; public nodes rate-limit bursts */
  concurrency?: number;
}

/** the last `blocks` blocks with a base fee, a gas used ratio, a blob fee and an interpolated timestamp. */
export async function fetchFees(rpc: Rpc, blocks: number, options: FetchOptions = {}): Promise<BlockFee[]> {
  const latest = options.latest ?? (await rpc.blockNumber());
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const pages = planPages(latest, blocks);
  const answers = await inBatches(pages, concurrency, ([newest, count]) =>
    rpc.call<FeeHistoryResult>("eth_feeHistory", ["0x" + count.toString(16), "0x" + newest.toString(16), []]),
  );
  const rows = answers.flatMap(parsePage).sort((a, b) => a.number - b.number);
  if (!rows.length) return [];
  const anchorBlocks = [...new Set([rows[0].number, rows[rows.length - 1].number, ...pages.map(([newest, count]) => newest - count + 1)])].sort(
    (a, b) => a - b,
  );
  const stamps = await inBatches(anchorBlocks, concurrency, (n) => rpc.blockTimestamp(n));
  const anchors = new Map(anchorBlocks.map((n, i) => [n, stamps[i]]));
  return rows.map((r) => ({ ...r, timestamp: interpolate(anchors, r.number) }));
}
