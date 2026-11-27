// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A proxy in front of an instance that trusts no hop (docs/deployment.md §4).
 *
 * `KLUI_TRUSTED_PROXY_HOPS` defaults to `0`, which is correct for an instance
 * listening on the open internet and wrong for the deployment this repository
 * documents: behind one proxy, `request.ip` is the proxy's address for every
 * visitor. The anonymous buckets then hold ten writes for the whole world, and
 * an operator who bans one abusive address bans the proxy — every visitor with
 * it.
 *
 * The header is not evidence on its own (it is client-written and stays a lie
 * until a trusted proxy rewrites it, `K3-07`), so this does not trust it and it
 * does not change the default. It says the one thing it can say: a header
 * arrived, the variable is zero, here is the line of the document that explains
 * the fix. Once per process — a line per request is a log flood, not a warning.
 */
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';

export function warnOnUntrustedProxy(app: FastifyInstance, env: Env): void {
  if (env.KLUI_TRUSTED_PROXY_HOPS > 0) return;
  let warned = false;
  app.addHook('onRequest', async (request) => {
    if (warned) return;
    if (request.headers['x-forwarded-for'] === undefined) return;
    warned = true;
    request.log.warn(
      {
        variable: 'KLUI_TRUSTED_PROXY_HOPS',
        value: 0,
        header: 'x-forwarded-for',
        // Every visitor is this address while the variable is zero.
        ip: request.ip,
        doc: 'docs/deployment.md §4',
      },
      'X-Forwarded-For arrived but KLUI_TRUSTED_PROXY_HOPS=0: every visitor shares the proxy ' +
        'address, so the anonymous buckets and IP bans apply to the proxy. Set it to the number ' +
        'of proxies in front of this instance (docs/deployment.md §4).',
    );
  });
}
