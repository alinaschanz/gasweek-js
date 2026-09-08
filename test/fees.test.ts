import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchFees, interpolate, parsePage, planPages } from "../src/fees.js";
import { Rpc } from "../src/rpc.js";

test("pages: newest first, the last one short, never below block 0", () => {
  assert.deepEqual(planPages(5000, 2500), [
    [5000, 1024],
    [3976, 1024],
    [2952, 452],
  ]);
  assert.deepEqual(planPages(10, 100, 8), [
    [10, 8],
    [2, 3],
  ]);
  assert.deepEqual(planPages(500, 0), []);
});

test("interpolation between anchors, 12 s slots past the ends", () => {
  const anchors = new Map([
    [100, 1000],
    [200, 2200],
  ]);
  assert.equal(interpolate(anchors, 100), 1000);
  assert.equal(interpolate(anchors, 150), 1600);
  assert.equal(interpolate(anchors, 210), 2320);
  assert.equal(interpolate(anchors, 90), 880);
});

test("a page: the last base fee is the next block and is dropped, blob fees optional", () => {
  const rows = parsePage({
    oldestBlock: "0x10",
    baseFeePerGas: ["0x3b9aca00", "0x77359400", "0x1"],
    gasUsedRatio: [0.5, 1],
    baseFeePerBlobGas: ["0x1", "0x2", "0x3"],
  });
  assert.deepEqual(rows, [
    { number: 16, baseFeeGwei: 1, gasUsedRatio: 0.5, blobFeeGwei: 1e-9 },
    { number: 17, baseFeeGwei: 2, gasUsedRatio: 1, blobFeeGwei: 2e-9 },
  ]);
  assert.equal(parsePage({ oldestBlock: "0x10", baseFeePerGas: ["0x1", "0x2"], gasUsedRatio: [0.1] })[0].blobFeeGwei, null);
});

function fakeFetch(handler: (method: string, params: unknown[]) => unknown, failFirst = 0) {
  let calls = 0;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    if (calls <= failFirst) throw new Error("connection reset");
    const req = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: handler(req.method, req.params) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, count: () => calls };
}

test("fetchFees: pages, headers for the anchors, interpolated timestamps", async () => {
  const handler = (method: string, params: unknown[]) => {
    if (method === "eth_blockNumber") return "0x1388"; // 5000
    if (method === "eth_getBlockByNumber") return { timestamp: "0x" + (parseInt(params[0] as string, 16) * 12 + 1_700_000_000).toString(16) };
    if (method === "eth_feeHistory") {
      const count = parseInt(params[0] as string, 16);
      const newest = parseInt(params[1] as string, 16);
      const oldest = newest - count + 1;
      return {
        oldestBlock: "0x" + oldest.toString(16),
        baseFeePerGas: Array.from({ length: count + 1 }, (_, i) => "0x" + ((oldest + i) * 1e6).toString(16)),
        gasUsedRatio: Array.from({ length: count }, () => 0.5),
      };
    }
    throw new Error("unexpected " + method);
  };
  const { fetchImpl, count } = fakeFetch(handler);
  const rows = await fetchFees(new Rpc(["https://a", "https://b"], fetchImpl), 2500, { concurrency: 2 });
  assert.equal(rows.length, 2500);
  assert.equal(rows[0].number, 5000 - 2500 + 1);
  assert.equal(rows[2499].number, 5000);
  for (const r of rows) assert.equal(r.timestamp, r.number * 12 + 1_700_000_000);
  assert.equal(rows[2499].baseFeeGwei, 5);
  // 1 block number + 3 pages + 4 anchors (first, last and the three page starts, one of them the first block)
  assert.equal(count(), 1 + 3 + 4);
});

test("rpc: a dead endpoint is skipped and the one that answered goes first", async () => {
  const { fetchImpl } = fakeFetch(() => "0x10", 1);
  const rpc = new Rpc(["https://dead", "https://alive"], fetchImpl);
  assert.equal(await rpc.blockNumber(), 16);
  assert.deepEqual([...rpc.endpoints], ["https://alive", "https://dead"]);
  await assert.rejects(new Rpc(["https://x"], async () => new Response("nope", { status: 500 })).blockNumber(), /every endpoint failed/);
});
