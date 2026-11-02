# Cache policy and repeated work

Reviewed against the installed Next.js 16.4.3 documentation on 2026-11-01. No
Redis or paid cache service was added. This app has no expensive shared public
database/provider query today: landing/pricing content is local code and
`planSettings()` validates three deployment variables. Putting that cheap work
behind a new JSON endpoint/cache would add requests without removing a measured
bottleneck.

The following policy was proposed **before runtime edits**, then baseline tests
were run before implementing request-local identity reuse.

| Item                                                                               | Where / key boundary                                                                                                       | Maximum staleness / TTL                                   | Invalidation                                                                                                                                    | Added service cost                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Content-hashed Next JavaScript/CSS/fonts                                           | Next.js `/_next/static/` browser/CDN headers                                                                               | Existing production `public, max-age=31536000, immutable` | A changed build emits a different content-hashed URL; old assets remain immutable                                                               | $0 new service; existing hosting bandwidth still applies       |
| Verified identity during one read of `/api/workspace`                              | A new `createReadAuthorizationScope()` closure created inside that incoming GET, with no module/global cache or shared key | Request lifetime only; **0 seconds across HTTP requests** | Scope becomes unreachable when the handler completes; rejected promises are evicted                                                             | $0; fewer repeated auth/session calls                          |
| HTML, including public marketing/pricing                                           | Not cached: each response contains a fresh CSP nonce                                                                       | No shared TTL; `private, no-store`                        | Every request renders with a new nonce                                                                                                          | Existing Node rendering cost                                   |
| Workspace/profile/membership/metrics, billing entitlement, consent and suppression | Not cached across requests                                                                                                 | No shared TTL                                             | Every incoming request rechecks identity and reads authoritative tenant state; membership/business checks remain fresh even inside a read scope | No new service                                                 |
| AI answers, SMS sends, checkout, calendar availability/booking                     | Not cached                                                                                                                 | No TTL                                                    | Existing durable idempotency/reconciliation handles retries; send/booking eligibility is rechecked before dispatch                              | No new service; actual provider costs still apply when enabled |

## What changed

Previously a workspace GET without `businessId` verified the user to choose the
first active business, then verified that same user again in
`requireMembership()`. Each cycle called Supabase `getUser`, the database
`check_active_session` RPC and the MFA assurance helper. The read handler now
creates one private scope, shares that verified identity snapshot for its own
work, and still queries membership and business status. That default path goes
from **two identity verification cycles to one**. A request with an explicit
business ID still performs one cycle. This change does not cache private records
under a shared key and does not reuse identity between requests/users.

`requireUser()` itself remains uncached. Existing mutation helpers also remain
uncached. Never create the read scope at module level, persist it, use it around
a mutation, or reuse it for another incoming request. If an account is revoked
while a request is already in flight, the request uses its already-verified
identity snapshot; the next incoming request performs the provider/session/MFA
checks again. This is request deduplication, not a permission TTL. RLS and
membership queries retain their independent database checks.

React `cache()`/fetch memoization in a Server Component tree was considered.
This duplicate work is in a Route Handler, so the implementation does not assume
Server Component memoization applies there. A small per-handler promise closure
is sufficient and has no cache daemon, persistence, eviction timer or new host.

## Why public HTML is not put on a CDN cache

The root layout is deliberately dynamic. `src/proxy.ts` generates a cryptographic
nonce for every request and Next attaches it to inline framework scripts. A
shared HTML/CDN cache would reuse the nonce and its headers across visitors.
The cache change does not weaken that policy. Do not apply a blanket “cache all”
rule to HTML, `/api`, `/app`, `/admin`, `/auth`, `/invite`, `/confirm-inspection`,
or `/demo`. Preserve Next's RSC query/header variation rules if any CDN is added
later. Host-specific CDN configuration remains unverified without a deployment.

If a future public catalog/help/plan endpoint becomes expensive, it can be
introduced with an explicit public DTO, no cookie/session access, short bounded
`s-maxage`, and purge-on-write/deploy semantics after measurement. No such
endpoint is necessary for the current local plan parser. Consent, authorization,
usage reservations and live provider availability must not be put in that cache.

## Verification and manual checks

Baseline, before runtime edits: `npx vitest run tests/public-cache.test.ts
tests/proxy.test.ts` — 15 passing tests. The initial safety-only version had 14
passing checks; the added same-URL/two-user workspace test passed before the
request memoization was introduced. The final suite also tests concurrent
deduplication within a scope, fresh checks for a new scope, failure eviction,
role changes and suspension checks outside the cache.

After the change, the focused cache/proxy/security suite passed **41 tests**,
TypeScript and focused ESLint passed, and **two local development HTTP/browser
cache checks passed**. The first HTTP assertion incorrectly required the
`private` token on a development HTML response; Next normalizes it to `no-store`
there. The assertion was corrected to require no shared storage in development
and to require `private` separately in production-preview mode. Production CDN
behavior is not claimed from the local development response.

Both checks also passed against the isolated compiled standalone server with
`PLAYWRIGHT_EXPECT_PRODUCTION=true`: HTML/private APIs remained uncached, and
hashed static assets returned one-year immutable headers without cookies. This
verifies the local production origin, not a deployed CDN configuration.

Run:

```sh
npx vitest run tests/public-cache.test.ts tests/proxy.test.ts tests/security-boundaries.test.ts
npm run test:e2e -- tests/e2e/cache-policy.spec.ts
```

For the static-asset production-header check, point the test at an authorized
**local/staging production build** and set `PLAYWRIGHT_EXPECT_PRODUCTION=true`.
Do not use the production customer service as a test target. The ordinary dev
check expects Next's development `no-store`/zero-age assets rather than claiming
the production CDN was tested.

In the browser, open the product page, pricing page and demo in normal and
private windows. They should show the same public product facts and working demo
interactions. In Developer Tools → Network, HTML and account/workspace responses
must have `private, no-store`; two reloads should have different CSP nonces.
Next's development server may normalize that HTML header to `no-store` alone;
the response must still forbid shared storage. The production check separately
asserts `private` along with `no-store`. On
an authorized staging production build, a `/_next/static/...js` or `.css` response
should use a one-year immutable cache directive. After a changed deployment the
changed asset's URL should differ. Sign in as two synthetic staging users in
separate browser profiles and verify each still sees only their own workspace;
revoking one session must deny its next API request. Hosted auth/permissions are
not verified by anonymous local demo requests.

References read from installed Next docs:
`01-app/02-guides/caching-without-cache-components.md`,
`01-app/02-guides/cdn-caching.md`, and
`01-app/02-guides/content-security-policy.md`. Their public counterparts are
[Next caching](https://nextjs.org/docs/app/guides/caching-without-cache-components),
[CDN caching](https://nextjs.org/docs/app/guides/cdn-caching), and
[nonce CSP](https://nextjs.org/docs/app/guides/content-security-policy).
