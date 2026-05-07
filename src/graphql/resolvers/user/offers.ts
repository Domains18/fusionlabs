import { GqlError } from '../../../types/general'
import type { ResolverWithPermissions, QueryOffersArgs, CursorPagination } from '../../../types/general'
import { isUserActive } from '../../../utils/permissions'
import { getPrismaSelect } from '../../../utils/database'
import { Prisma } from '../../../../prisma/generated/client'
import {
  resolveUserAudiences,
  findEligibleOutletIds,
  buildOutletWhere,
  buildOfferSelect,
} from './helpers/offers/filters'

// =============================================================================
//  New `offers` resolver.
//
//  Strategy:
//   1. Resolve the user's audience tokens once (~one indexed CustomerType read).
//   2. Hit OfferIndex with a single composite-index seek to get the page of
//      eligible distinct outletIds (+ percentage filter).
//   3. Re-fetch those outlets via the original Prisma select shape so the
//      GraphQL response is byte-compatible with the old resolver.
//
//  Step 3 is necessary because GraphQL clients still expect nested children
//  (CashbackConfigurations, ExclusiveOffers, LoyaltyProgram, etc.) per outlet,
//  and those children are scoped to what the user is eligible for. We use the
//  same `buildOfferSelect` style helper as the legacy code to keep child
//  scoping correct, but the EXPENSIVE part — the unindexed top-level OR —
//  is gone, replaced by an `id IN (...)` against a small page of ids.
// =============================================================================

type Outlet = Prisma.OutletGetPayload<Record<string, never>>

export const offers: ResolverWithPermissions<
  QueryOffersArgs,
  { offers: Outlet[]; pagination: CursorPagination }
> = async (_, { filterData, pagination }, { prisma, authSession }, info) => {
  if (!authSession?.userId) throw new GqlError('Unauthorized')

  const now = new Date()
  const take = Math.min(pagination.take ?? 20, 100)

  const prismaSelect = getPrismaSelect<Prisma.OutletSelect, { offers: Outlet[] }>({
    info,
    resolverName: 'offers',
  })

  const userCtx = await resolveUserAudiences({ prisma, authSession })

  // STEP 1 — page of eligible outlet ids from OfferIndex.
  const { outletIds, hasMore } = await findEligibleOutletIds({
    prisma,
    audiences: userCtx.audiences,
    knownMerchantIds: userCtx.knownMerchantIds,
    percentage: filterData.percentage,
    cursor: pagination.cursor,
    take,
  })

  if (outletIds.length === 0) {
    return {
      offers: [],
      pagination: {
        cursor: pagination.cursor ?? null,
        take,
        hasMore: false,
        nextCursor: null,
      },
    }
  }

  // STEP 2 — load the actual rows. The id-set lookup is the cheap part; the
  // remaining `buildOutletWhere` predicates (active, approved, search, category,
  // active paybills) are all well-indexed and scoped to a small page.
  const outletWhere = buildOutletWhere({
    search: filterData.search,
    category: filterData.category,
  })

  const select = buildOfferSelect({
    now,
    prismaSelect,
    legacyEligibility: userCtx.legacyEligibility,
    percentage: filterData.percentage,
  })

  const rows = await prisma.outlet.findMany({
    where: { AND: [{ id: { in: outletIds } }, outletWhere] },
    select,
    orderBy: { id: 'asc' },
  })

  // Preserve OfferIndex ordering (pagination cursor is on outlet id, but the
  // residual outletWhere may filter some rows out; we keep the surviving rows
  // in their original index order).
  const byId = new Map(rows.map((r) => [(r as { id: string }).id, r] as const))
  const ordered: Outlet[] = []
  for (const id of outletIds) {
    const r = byId.get(id)
    if (r) ordered.push(r as unknown as Outlet)
  }

  return {
    offers: ordered,
    pagination: {
      cursor: pagination.cursor ?? null,
      take,
      hasMore,
      nextCursor: hasMore && ordered.length > 0 ? (ordered[ordered.length - 1] as { id: string }).id : null,
    },
  }
}

offers.permissions = isUserActive
