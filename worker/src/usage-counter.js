// Durable Object wrapper around UsageLedger. A single named instance ("global")
// holds every counter.
import { DurableObject } from 'cloudflare:workers';
import { UsageLedger } from './usage.js';

export class UsageCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ledger = new UsageLedger(ctx.storage);
  }

  consume(day, checks) {
    return this.ledger.consume(day, checks);
  }
}
