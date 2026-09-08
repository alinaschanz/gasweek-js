/** json-rpc over fetch: a list of public endpoints tried in order, the one that answered goes first next time. */

export const RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.mevblocker.io",
  "https://gateway.tenderly.co/public/mainnet",
  "https://eth-mainnet.public.blastapi.io",
];

export type Fetch = typeof globalThis.fetch;

export class Rpc {
  private urls: string[];
  private readonly fetchImpl: Fetch;
  private readonly timeoutMs: number;
  private id = 0;

  constructor(urls: string[] = RPCS, fetchImpl: Fetch = globalThis.fetch, timeoutMs = 25_000) {
    if (!urls.length) throw new Error("no rpc urls");
    this.urls = [...urls];
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** the endpoints in their current order (the last one that answered is first). */
  get endpoints(): readonly string[] {
    return this.urls;
  }

  async call<T = unknown>(method: string, params: unknown[]): Promise<T> {
    let lastProblem = "no endpoint";
    for (let i = 0; i < this.urls.length; i++) {
      const url = this.urls[i];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const data = (await res.json()) as { result?: T; error?: { message?: string } };
        if (data.error) throw new Error(data.error.message ?? "rpc error");
        if (data.result === undefined) throw new Error("no result");
        if (i) this.urls = [url, ...this.urls.filter((u) => u !== url)];
        return data.result;
      } catch (err) {
        lastProblem = `${url}: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`every endpoint failed; last: ${lastProblem}`);
  }

  async blockNumber(): Promise<number> {
    return parseInt(await this.call<string>("eth_blockNumber", []), 16);
  }

  async blockTimestamp(number: number): Promise<number> {
    const block = await this.call<{ timestamp: string } | null>("eth_getBlockByNumber", ["0x" + number.toString(16), false]);
    if (!block) throw new Error(`block ${number} not found`);
    return parseInt(block.timestamp, 16);
  }
}
