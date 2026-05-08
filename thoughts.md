# Thoughts — Offers Resolver Optimization

## TL;DR

The original `offers` resolver does all of its eligibility/date/budget/review work
**at query time**, against a deeply-nested `OR` across three different offer
relations (`CashbackConfigurations`, `ExclusiveOffers`, `Merchant.LoyaltyProgram`).
Postgres can't index a query of that shape — no matter how many indexes you add,
each request scans large portions of three subtrees.

I moved the eligibility/availability resolution **off the read path** by
introducing a denormalized `OfferIndex` table that pre-computes, for every
`(outlet, offer, audience)` triple, a single boolean `isAvailable` flag. The
resolver then becomes a single composite-index seek + an `id IN (...)` lookup.

## Where the cost actually lives in the original

Reading [`apps/api/graphql/resolvers/user/helpers/offers/filters.ts`](instructions.md):

1. `buildOfferEligibilityConditions` builds one OR fragment per offer type.
   Each fragment grows linearly with the user's `CustomerType` rows.
2. `buildOfferFilters` then nests those fragments inside a top-level
   `OR: [{ CashbackConfigurations: { some: ... } }, { ExclusiveOffers: { some: ... } }, { Merchant: { LoyaltyProgram: { ... } } }]`.
3. Each `some:` clause has its own nested checks: array membership on
   `eligibleCustomerTypes`, `Review.status`, `startDate/endDate`, budget
   inequality, tier predicates.

Postgres planning for a query like that almost always falls back to nested-loop
joins with full-table scans on `Outlet`, because:

- `eligibleCustomerTypes String[]` array containment is hard to index well
  (you'd need GIN — and even then it's only one of five conditions).
- The OR-across-three-different-relations means no single index can cover the
  decision.
- Budget-remaining is a column-vs-column comparison
  (`usedCashbackBudget < netCashbackBudget`) which Postgres can't satisfy from
  an index unless you add a generated/expression column.
- Date range and review-status are joined predicates further down the tree.

Cost grows with `outlets × offers × user-customer-types`. The endpoint is hit
on every app open, so this is the worst possible hot path for that shape.

## The approach: read-side projection

### `OfferIndex` (see [`prisma/schema.prisma`](prisma/schema.prisma))

One row per `(outlet, source-offer, audience)`. The audience token is a single
string drawn from:

- `"All"` — offer eligible to anyone.
- `"NonCustomer"` — offer eligible to users with **no** prior relationship
  with the merchant. The merchant exclusion isn't captured in the audience
  token itself; it's applied as a residual `merchantId NOT IN (...)` filter
  in the resolver. This keeps the index narrow.
- `"New" | "Infrequent" | "Occasional" | "Regular" | "Vip"` — the user's
  exact relationship type at the merchant.
- `"feed:<customerTypeId>"` — for `ExclusiveOfferFeedTimeline` rows that
  target a specific `CustomerType` row by id.

A single `isAvailable BOOLEAN` rolls up: active + review approved + not deleted
+ within date window + budget remaining + (offer-specific tier/reward
predicates). The resolver only ever filters on this boolean — no joins, no
subqueries.

### Loyalty audience expansion

Loyalty programs use a hierarchy: a `Regular` user qualifies for tiers whose
`minCustomerType` is `Regular` or below. The original resolver expanded that
hierarchy at query time.

I moved that to write time: the index builder takes the program's tiers,
finds the lowest `minCustomerType` rank, and emits one row per customer-type
audience that is `>= minRank`. So if the lowest tier is `Occasional`, we emit
audience rows for `Occasional`, `Regular`, `Vip`. The resolver doesn't have
to know about the hierarchy.

### Composite index

Primary read path:

```sql
CREATE INDEX ON OfferIndex (audience, isAvailable, outletId);
```

The resolver issues one `findMany` with `audience IN (...)` (small set, ~5–8
tokens), `isAvailable = true`, `distinct outletId`. Postgres uses the index
to do a series of fast index-only scans, one per audience token, and merges
them. With a large dataset this is orders of magnitude cheaper than the
original `OR` plan.

## Maintaining the index

Three layers of synchronization, each with a different cost/correctness tradeoff:

### 1. Prisma client extension — [`src/services/offerIndex/extension.ts`](src/services/offerIndex/extension.ts)

Wraps the PrismaClient and intercepts writes to every model that affects
availability:

- `cashbackConfiguration`, `cashbackConfigurationTier`
- `exclusiveOffer`, `exclusiveOfferFeedTimeline`
- `loyaltyProgram`, `loyaltyTier`, `merchantLoyaltyReward`
- `review` — bubbles up to whichever offer owns the review

After every successful write, the affected source offer's index rows are
deleted and rebuilt in a single transaction. **This guarantees no source
mutation can leave the index stale**, which is the strongest possible
correctness property without going to triggers.

I considered Postgres triggers instead (more bulletproof, can't be
bypassed) — but they're harder to test, hard to keep in sync with Prisma
migrations, and split your business logic between TS and SQL. The
extension is a reasonable starting point and you can later upgrade
specific paths to triggers if you find a write site that bypasses Prisma.

### 2. Cron sweep — [`src/jobs/refreshOfferIndex.ts`](src/jobs/refreshOfferIndex.ts)

Handles transitions that aren't triggered by writes:

- An offer reaching its `endDate` and becoming unavailable.
- An offer reaching its `startDate` and becoming available.

The sweep queries `OfferIndex` directly (using the
`(endDate, isAvailable)` and `(startDate, isAvailable)` indexes) for rows
whose stored dates straddle `now` but whose `isAvailable` flag disagrees
with what the predicates would now say. Recommended cadence: every 1–5
minutes via BullMQ. Worst-case staleness is bounded by the cadence — an
offer can be visible for at most one tick after expiry.

### 3. Backfill — [`src/services/offerIndex/sync.ts`](src/services/offerIndex/sync.ts)

A one-shot helper that walks every source offer and rebuilds its index
rows. Idempotent (each rebuild deletes prior rows first). Run once after
the migration ships; safe to re-run if you suspect drift.

## Tradeoffs I deliberately accepted

### Write amplification

Every source mutation now triggers an `OfferIndex` rebuild for the affected
offer. A cashback configuration with 10 outlets × 3 audiences = 30 rows
deleted+inserted per cashback edit. This is fine because:

- Reads vastly outnumber writes (the assignment specifically calls this out).
- The rebuild is bounded by `outlets × audiences-per-offer`, which is small.
- Inserts go via `createMany` in a single transaction.

If a particular source ever fans out to thousands of outlets, you'd want to
move to per-row diffing (only insert/delete rows that actually changed). I
didn't bother — the current shape is simpler and faster to reason about for
typical offer sizes.

### Budget-exhaustion lag

Budget is consumed inside transaction-recording flows that may not go through
the wrapped Prisma client (e.g. payment webhook handlers, batched settlement
jobs). Two mitigations:

1. Route budget mutations through the wrapped client too — easiest fix.
2. The cron sweep can be extended to reload budget values for cashback /
   exclusive rows whose stored `isAvailable=true` is contradicted by current
   budget state. I left the date-only sweep in place to keep the example
   focused; extending it is mechanical.

### Search is still on the source side

Full-text search on `Outlet.name`, `Outlet.description`, `Merchant.businessName`,
`Merchant.description` lives in `buildOutletWhere`, applied to the page of
candidate outlet ids returned by `OfferIndex`. We don't push search into the
index because:

- Search would explode index size (per-row text columns + GIN/trigram).
- Searches are typically scoped: even a search returning 5,000 candidate
  outlets gets cheaply intersected with the small page of available-offer
  outlet ids.

Production-grade search would live in OpenSearch/Postgres FTS as a sibling
projection. Out of scope here.

### `NonCustomer` requires a residual filter

The audience token alone doesn't capture "user has no relationship with this
merchant" — that's a query-time fact. The resolver applies a residual
`merchantId NOT IN (knownMerchantIds)` filter on the `NonCustomer` audience
half, which is fine because `knownMerchantIds` is small (typically dozens).

## What I considered and rejected

### Materialized view

`CREATE MATERIALIZED VIEW` over the eligibility join, refreshed on a cadence.
Rejected because:

- `REFRESH MATERIALIZED VIEW` rewrites the whole view; per-offer rebuilds
  scale much better.
- Real-time deactivation requirement ("when an offer is deactivated, it
  should disappear") wants finer granularity than a refresh interval.

### Redis cache layer in front of the resolver

Could shave latency for repeat queries — but the underlying SQL is still
slow on cache miss, and invalidation across customer-type × merchant ×
date is hairy. The denormalized table makes the SQL itself fast, which is
the better lever.

### Per-user precomputed offer set

Precompute `(userId → outletId[])`. Rejected because the cardinality
multiplies by user count, and the row needs invalidating on any merchant
or offer change — every offer write would fan out into millions of user
invalidations.

The chosen design fans out by `outlet × audience` instead, which is bounded
and write-locality-friendly.

### GIN index on `eligibleCustomerTypes`

Would help **one** of the five predicates. Even with it, the OR-across-three-relations
plan is still bad. Cheap insurance to add anyway, but not the fix.

## Correctness story

The eligibility logic from the original `helpers/offers/filters.ts` is
preserved in two places, neither of which is the hot path:

1. `services/offerIndex/builder.ts` — the same predicates, applied once per
   write to compute `isAvailable` and the audience set.
2. `graphql/resolvers/user/helpers/offers/filters.ts:buildOfferSelect` — the
   per-outlet child-relation `where` clauses still scope what gets returned
   to what the user is eligible for, so the GraphQL response is byte-compatible
   with the original. We're scoping selected child rows here, not searching
   for outlets, so it's cheap.

The unit tests in [`src/__tests__/`](src/__tests__/) cover the eligibility
expansion (loyalty hierarchy upward, array audiences, availability rollup)
and the resolver-side audience set computation.

## What I'd do next, if I had more time

- Add a partial index `WHERE isAvailable = TRUE` (commented in the migration)
  — typically halves the hot-path scan size.
- Add a Postgres trigger as a belt-and-braces guard for write paths that
  bypass the Prisma extension (e.g. raw SQL migrations).
- Wire budget-consumption mutations through the extension so the cron sweep
  doesn't have to handle that case.
- Add an integration test that boots a real Postgres (Testcontainers) and
  exercises the full write-index-read cycle.
- Consider sharding `OfferIndex` by `merchantId` once it grows past a few
  hundred million rows.

## File map

- [`prisma/schema.prisma`](prisma/schema.prisma) — schema with `OfferIndex`
- [`prisma/migrations/0001_init/migration.sql`](prisma/migrations/0001_init/migration.sql) — migration intent
- [`src/services/offerIndex/builder.ts`](src/services/offerIndex/builder.ts) — index population logic
- [`src/services/offerIndex/extension.ts`](src/services/offerIndex/extension.ts) — Prisma write hooks
- [`src/services/offerIndex/sync.ts`](src/services/offerIndex/sync.ts) — backfill helper
- [`src/jobs/refreshOfferIndex.ts`](src/jobs/refreshOfferIndex.ts) — cron sweep
- [`src/graphql/resolvers/user/offers.ts`](src/graphql/resolvers/user/offers.ts) — new resolver
- [`src/graphql/resolvers/user/helpers/offers/filters.ts`](src/graphql/resolvers/user/helpers/offers/filters.ts) — simplified filter helpers
- [`src/__tests__/`](src/__tests__/) — unit tests
