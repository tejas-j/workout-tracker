// Daily usage counters. Checks and increments happen together, and storage is
// wiped when the day changes. Used by the UsageCounter Durable Object, which runs
// one request at a time, so counts are exact (unlike KV, which is eventually consistent).
export class UsageLedger {
  constructor(storage) {
    this.storage = storage;
  }

  // checks: [{ key, limit }]. Increments every counter only if all are under their limit.
  async consume(day, checks) {
    if ((await this.storage.get('day')) !== day) {
      await this.storage.deleteAll();
      await this.storage.put('day', day);
    }
    const used = (await Promise.all(checks.map(c => this.storage.get(`n:${c.key}`)))).map(n => n || 0);
    if (checks.some((c, i) => used[i] >= c.limit)) return { ok: false, used: used[0] };
    await this.storage.put(Object.fromEntries(checks.map((c, i) => [`n:${c.key}`, used[i] + 1])));
    return { ok: true, used: used[0] + 1 };
  }
}
