import { Prisma, PrismaClient, OfferIndexType } from '../../../prisma/generated/client'
import {
  ALL_CUSTOMER_TYPES,
  AUDIENCE_ALL,
  AUDIENCE_NON_CUSTOMER,
  ORDERED_CUSTOMER_TYPES,
  audienceForCustomerType,
  audienceForFeedTimeline,
} from '../../utils/config'
import { ReviewStatusEnum } from '../../types/general'

// =============================================================================
//  OfferIndex builder
// =============================================================================
//
//  Given a single source offer (Cashback / ExclusiveOffer / LoyaltyProgram), this
//  module computes the FULL set of OfferIndex rows that should exist for it and
//  upserts them in one transaction. The builder is invoked by:
//
//    1. Source-table mutations, via the Prisma extension in `extension.ts`
//    2. The cron sweep in `jobs/refreshOfferIndex.ts`, for time/budget changes
//    3. A backfill helper, on cold-start / migration
//
//  Design notes:
//
//  - Audience fan-out is the only way to keep the read-side a single composite
//    index seek. A cashback offer with eligibleCustomerTypes = ["VIP","Regular"]
//    and 3 outlets becomes 6 OfferIndex rows.
//  - `isAvailable` collapses every correctness predicate (active, review, date
//    range, budget, not-deleted) into one boolean. The resolver only filters on
//    that. The boolean is recomputed every time we touch the row, so it can never
//    drift from a single source-table mutation.
//  - For loyalty programs, the audience set comes from the program's tiers'
//    `minCustomerType` values. A tier with minCustomerType=Regular admits anyone
//    at Regular OR ABOVE (Regular + Vip), so we expand each tier upward.
//
//  Tradeoff: this fan-out costs write amplification (one offer write -> N index
//  writes). That's the deliberate trade — the read path is hit constantly,
//  writes are not.
// =============================================================================

type CashbackWithRelations = Prisma.CashbackConfigurationGetPayload<{
  include: {
    Review: true
    Outlets: { select: { id: true } }
    CashbackConfigurationTiers: { include: { Review: true } }
  }
}>

type ExclusiveWithRelations = Prisma.ExclusiveOfferGetPayload<{
  include: {
    Review: true
    Outlets: { select: { id: true } }
    FeedTimeline: { select: { customerTypeId: true } }
  }
}>

type LoyaltyWithRelations = Prisma.LoyaltyProgramGetPayload<{
  include: {
    Review: true
    LoyaltyTiers: { include: { Review: true } }
    MerchantLoyaltyRewards: { include: { Review: true } }
    Merchant: { include: { Outlets: { select: { id: true } } } }
  }
}>

const isApproved = (review: { status: string } | null | undefined) =>
  review?.status === ReviewStatusEnum.Approved

// -----------------------------------------------------------------------------
// Audience computation
// -----------------------------------------------------------------------------

function audiencesForArrayBased(eligibleCustomerTypes: string[]): string[] {
  // Cashback + ExclusiveOffer share the same array-based audience model. "All"
  // matches every user; "NonCustomer" matches users with no relationship to the
  // merchant; specific types match users who hold that type at the merchant.
  const out = new Set<string>()
  for (const t of eligibleCustomerTypes) out.add(t)
  return [...out]
}

function audiencesForFeed(feedTimeline: { customerTypeId: string }[]): string[] {
  // FeedTimeline rows admit a single specific user-merchant tuple via their
  // CustomerType. We tag those rows with `feed:<customerTypeId>` and the
  // resolver mixes those tokens into its IN(...) lookup.
  return feedTimeline.map((f) => audienceForFeedTimeline(f.customerTypeId))
}

function audiencesForLoyalty(tiers: { minCustomerType: string; isActive: boolean; deletedAt: Date | null; Review: { status: string } | null }[]): string[] {
  // For each approved/active tier we expand minCustomerType upward through the
  // hierarchy: a tier with minCustomerType=Regular is reachable by Regular and
  // Vip users.
  const ranks = new Set<number>()
  for (const tier of tiers) {
    if (!tier.isActive || tier.deletedAt || !isApproved(tier.Review)) continue
    const rank = ORDERED_CUSTOMER_TYPES[tier.minCustomerType as keyof typeof ORDERED_CUSTOMER_TYPES]
    if (rank === undefined) continue
    ranks.add(rank)
  }
  if (ranks.size === 0) return []

  const audiences = new Set<string>()
  for (const t of ALL_CUSTOMER_TYPES) {
    const userRank = ORDERED_CUSTOMER_TYPES[t]
    // user qualifies for any tier whose minRank <= their rank
    for (const tierRank of ranks) {
      if (tierRank <= userRank) {
        audiences.add(audienceForCustomerType(t))
        break
      }
    }
  }
  return [...audiences]
}

// -----------------------------------------------------------------------------
// Availability computation
// -----------------------------------------------------------------------------

function cashbackIsAvailable(c: CashbackWithRelations, now: Date): boolean {
  if (!c.isActive || c.deletedAt) return false
  if (!isApproved(c.Review)) return false
  // budget remaining
  if (c.usedCashbackBudget.gte(c.netCashbackBudget)) return false
  // date range — null on either side means open-ended
  if (c.startDate && c.startDate > now) return false
  if (c.endDate && c.endDate < now) return false
  // must have at least one approved active tier
  const goodTier = c.CashbackConfigurationTiers.some(
    (t) => t.isActive && !t.deletedAt && isApproved(t.Review)
  )
  return goodTier
}

function exclusiveIsAvailable(e: ExclusiveWithRelations, now: Date): boolean {
  if (!e.isActive || e.deletedAt) return false
  if (!isApproved(e.Review)) return false
  if (e.usedOfferBudget.gte(e.netOfferBudget)) return false
  if (e.startDate > now || e.endDate < now) return false
  return true
}

function loyaltyIsAvailable(l: LoyaltyWithRelations): boolean {
  if (!l.isActive) return false
  if (!isApproved(l.Review)) return false
  // points limit
  if (l.pointsIssuedLimit !== null && l.pointsUsedInPeriod.gte(l.pointsIssuedLimit)) return false
  // must have at least one approved active tier
  const goodTier = l.LoyaltyTiers.some((t) => t.isActive && !t.deletedAt && isApproved(t.Review))
  if (!goodTier) return false
  // must have at least one approved active reward
  const goodReward = l.MerchantLoyaltyRewards.some((r) => r.isActive && isApproved(r.Review))
  return goodReward
}

function maxPercentage(c: CashbackWithRelations): Prisma.Decimal | null {
  let max: Prisma.Decimal | null = null
  for (const t of c.CashbackConfigurationTiers) {
    if (!t.isActive || t.deletedAt || !isApproved(t.Review)) continue
    if (t.cashbackPercentage === null) continue
    if (max === null || t.cashbackPercentage.gt(max)) max = t.cashbackPercentage
  }
  return max
}

// -----------------------------------------------------------------------------
// Per-source rebuilders. Each one wipes the source's OfferIndex rows and
// rewrites them in a single transaction.
// -----------------------------------------------------------------------------

export async function rebuildCashbackIndex(
  prisma: PrismaClient,
  cashbackId: string,
  now = new Date()
): Promise<void> {
  const c = await prisma.cashbackConfiguration.findUnique({
    where: { id: cashbackId },
    include: {
      Review: true,
      Outlets: { select: { id: true } },
      CashbackConfigurationTiers: { include: { Review: true } },
    },
  })

  await prisma.$transaction(async (tx) => {
    await tx.offerIndex.deleteMany({
      where: { offerType: OfferIndexType.CASHBACK, offerId: cashbackId },
    })
    if (!c) return

    const audiences = audiencesForArrayBased(c.eligibleCustomerTypes)
    if (audiences.length === 0 || c.Outlets.length === 0) return

    const isAvailable = cashbackIsAvailable(c, now)
    const maxPct = maxPercentage(c)

    const rows: Prisma.OfferIndexCreateManyInput[] = []
    for (const outlet of c.Outlets) {
      for (const audience of audiences) {
        rows.push({
          outletId: outlet.id,
          merchantId: c.merchantId,
          offerType: OfferIndexType.CASHBACK,
          offerId: c.id,
          audience,
          isAvailable,
          startDate: c.startDate,
          endDate: c.endDate,
          maxCashbackPercentage: maxPct,
        })
      }
    }
    if (rows.length > 0) await tx.offerIndex.createMany({ data: rows })
  })
}

export async function rebuildExclusiveIndex(
  prisma: PrismaClient,
  exclusiveId: string,
  now = new Date()
): Promise<void> {
  const e = await prisma.exclusiveOffer.findUnique({
    where: { id: exclusiveId },
    include: {
      Review: true,
      Outlets: { select: { id: true } },
      FeedTimeline: { select: { customerTypeId: true } },
    },
  })

  await prisma.$transaction(async (tx) => {
    await tx.offerIndex.deleteMany({
      where: { offerType: OfferIndexType.EXCLUSIVE, offerId: exclusiveId },
    })
    if (!e || !e.merchantId) return

    const audiences = [
      ...audiencesForArrayBased(e.eligibleCustomerTypes),
      ...audiencesForFeed(e.FeedTimeline),
    ]
    if (audiences.length === 0 || e.Outlets.length === 0) return

    const isAvailable = exclusiveIsAvailable(e, now)

    const rows: Prisma.OfferIndexCreateManyInput[] = []
    for (const outlet of e.Outlets) {
      for (const audience of audiences) {
        rows.push({
          outletId: outlet.id,
          merchantId: e.merchantId,
          offerType: OfferIndexType.EXCLUSIVE,
          offerId: e.id,
          audience,
          isAvailable,
          startDate: e.startDate,
          endDate: e.endDate,
          maxCashbackPercentage: null,
        })
      }
    }
    if (rows.length > 0) await tx.offerIndex.createMany({ data: rows })
  })
}

export async function rebuildLoyaltyIndex(
  prisma: PrismaClient,
  loyaltyProgramId: string
): Promise<void> {
  const l = await prisma.loyaltyProgram.findUnique({
    where: { id: loyaltyProgramId },
    include: {
      Review: true,
      LoyaltyTiers: { include: { Review: true } },
      MerchantLoyaltyRewards: { include: { Review: true } },
      Merchant: { include: { Outlets: { select: { id: true } } } },
    },
  })

  await prisma.$transaction(async (tx) => {
    await tx.offerIndex.deleteMany({
      where: { offerType: OfferIndexType.LOYALTY, offerId: loyaltyProgramId },
    })
    if (!l || !l.Merchant) return

    const audiences = audiencesForLoyalty(l.LoyaltyTiers)
    if (audiences.length === 0 || l.Merchant.Outlets.length === 0) return

    const isAvailable = loyaltyIsAvailable(l)

    const rows: Prisma.OfferIndexCreateManyInput[] = []
    for (const outlet of l.Merchant.Outlets) {
      for (const audience of audiences) {
        rows.push({
          outletId: outlet.id,
          merchantId: l.Merchant.id,
          offerType: OfferIndexType.LOYALTY,
          offerId: l.id,
          audience,
          isAvailable,
          startDate: null,
          endDate: null,
          maxCashbackPercentage: null,
        })
      }
    }
    if (rows.length > 0) await tx.offerIndex.createMany({ data: rows })
  })
}

// Public re-exports for the cron sweep / tests / extension to lean on
export const _internals = {
  audiencesForArrayBased,
  audiencesForFeed,
  audiencesForLoyalty,
  cashbackIsAvailable,
  exclusiveIsAvailable,
  loyaltyIsAvailable,
  maxPercentage,
  AUDIENCE_ALL,
  AUDIENCE_NON_CUSTOMER,
}
