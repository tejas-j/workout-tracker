// Worker entry point. Request handling lives in handler.js so it can be tested
// outside the Workers runtime.
import { handle } from './handler.js';

export { UsageCounter } from './usage-counter.js';

export default { fetch: (request, env) => handle(request, env) };
