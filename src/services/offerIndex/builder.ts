import {
  ALL_CUSTOMER_TYPES,
  AUDIENCE_ALL,
  AUDIENCE_NON_CUSTOMER,
  ORDERED_CUSTOMER_TYPES,
  audienceForCustomerType,
  audienceForFeedTimeline,
} from "../../utils/config";
import { ReviewStatusEnum } from "../../types/general";
import { OfferIndexType, Prisma, PrismaClient } from "@prisma/client";

type CashbackWithRelations = Prisma.CashbackConfigurationGetPayload<{
  include: {
    Review: true;
    Outlets: { select: { id: true } };
    CashbackConfigurationTiers: { include: { Review: true } };
  };
}>;

type ExclusiveWithRelations = Prisma.ExclusiveOfferGetPayload<{
  include: {
    Review: true;
    Outlets: { select: { id: true } };
    FeedTimeline: { select: { customerTypeId: true } };
  };
}>;

type LoyaltyWithRelations = Prisma.LoyaltyProgramGetPayload<{
  include: {
    Review: true;
    LoyaltyTiers: { include: { Review: true } };
    MerchantLoyaltyRewards: { include: { Review: true } };
    Merchant: { include: { Outlets: { select: { id: true } } } };
  };
}>;

const isApproved = (review: { status: string } | null | undefined) =>
  review?.status === ReviewStatusEnum.Approved;

function audiencesForArrayBased(eligibleCustomerTypes: string[]): string[] {
  const out = new Set<string>();
  for (const t of eligibleCustomerTypes) out.add(t);
  return [...out];
}

function audiencesForFeed(
  feedTimeline: { customerTypeId: string }[],
): string[] {
  return feedTimeline.map((f) => audienceForFeedTimeline(f.customerTypeId));
}

function audiencesForLoyalty(
  tiers: {
    minCustomerType: string;
    isActive: boolean;
    deletedAt: Date | null;
    Review: { status: string } | null;
  }[],
): string[] {
  const ranks = new Set<number>();
  for (const tier of tiers) {
    if (!tier.isActive || tier.deletedAt || !isApproved(tier.Review)) continue;
    const rank =
      ORDERED_CUSTOMER_TYPES[
        tier.minCustomerType as keyof typeof ORDERED_CUSTOMER_TYPES
      ];
    if (rank === undefined) continue;
    ranks.add(rank);
  }
  if (ranks.size === 0) return [];

  const audiences = new Set<string>();
  for (const t of ALL_CUSTOMER_TYPES) {
    const userRank = ORDERED_CUSTOMER_TYPES[t];

    for (const tierRank of ranks) {
      if (tierRank <= userRank) {
        audiences.add(audienceForCustomerType(t));
        break;
      }
    }
  }
  return [...audiences];
}

function cashbackIsAvailable(c: CashbackWithRelations, now: Date): boolean {
  if (!c.isActive || c.deletedAt) return false;
  if (!isApproved(c.Review)) return false;

  if (c.usedCashbackBudget.gte(c.netCashbackBudget)) return false;

  if (c.startDate && c.startDate > now) return false;
  if (c.endDate && c.endDate < now) return false;

  const goodTier = c.CashbackConfigurationTiers.some(
    (t) => t.isActive && !t.deletedAt && isApproved(t.Review),
  );
  return goodTier;
}

function exclusiveIsAvailable(e: ExclusiveWithRelations, now: Date): boolean {
  if (!e.isActive || e.deletedAt) return false;
  if (!isApproved(e.Review)) return false;
  if (e.usedOfferBudget.gte(e.netOfferBudget)) return false;
  if (e.startDate > now || e.endDate < now) return false;
  return true;
}

function loyaltyIsAvailable(l: LoyaltyWithRelations): boolean {
  if (!l.isActive) return false;
  if (!isApproved(l.Review)) return false;

  if (
    l.pointsIssuedLimit !== null &&
    l.pointsUsedInPeriod.gte(l.pointsIssuedLimit)
  )
    return false;

  const goodTier = l.LoyaltyTiers.some(
    (t) => t.isActive && !t.deletedAt && isApproved(t.Review),
  );
  if (!goodTier) return false;

  const goodReward = l.MerchantLoyaltyRewards.some(
    (r) => r.isActive && isApproved(r.Review),
  );
  return goodReward;
}

function maxPercentage(c: CashbackWithRelations): Prisma.Decimal | null {
  let max: Prisma.Decimal | null = null;
  for (const t of c.CashbackConfigurationTiers) {
    if (!t.isActive || t.deletedAt || !isApproved(t.Review)) continue;
    if (t.cashbackPercentage === null) continue;
    if (max === null || t.cashbackPercentage.gt(max))
      max = t.cashbackPercentage;
  }
  return max;
}

export async function rebuildCashbackIndex(
  prisma: PrismaClient,
  cashbackId: string,
  now = new Date(),
): Promise<void> {
  const c = await prisma.cashbackConfiguration.findUnique({
    where: { id: cashbackId },
    include: {
      Review: true,
      Outlets: { select: { id: true } },
      CashbackConfigurationTiers: { include: { Review: true } },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.offerIndex.deleteMany({
      where: { offerType: OfferIndexType.CASHBACK, offerId: cashbackId },
    });
    if (!c) return;

    const audiences = audiencesForArrayBased(c.eligibleCustomerTypes);
    if (audiences.length === 0 || c.Outlets.length === 0) return;

    const isAvailable = cashbackIsAvailable(c, now);
    const maxPct = maxPercentage(c);

    const rows: Prisma.OfferIndexCreateManyInput[] = [];
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
        });
      }
    }
    if (rows.length > 0) await tx.offerIndex.createMany({ data: rows });
  });
}

export async function rebuildExclusiveIndex(
  prisma: PrismaClient,
  exclusiveId: string,
  now = new Date(),
): Promise<void> {
  const e = await prisma.exclusiveOffer.findUnique({
    where: { id: exclusiveId },
    include: {
      Review: true,
      Outlets: { select: { id: true } },
      FeedTimeline: { select: { customerTypeId: true } },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.offerIndex.deleteMany({
      where: { offerType: OfferIndexType.EXCLUSIVE, offerId: exclusiveId },
    });
    if (!e || !e.merchantId) return;

    const audiences = [
      ...audiencesForArrayBased(e.eligibleCustomerTypes),
      ...audiencesForFeed(e.FeedTimeline),
    ];
    if (audiences.length === 0 || e.Outlets.length === 0) return;

    const isAvailable = exclusiveIsAvailable(e, now);

    const rows: Prisma.OfferIndexCreateManyInput[] = [];
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
        });
      }
    }
    if (rows.length > 0) await tx.offerIndex.createMany({ data: rows });
  });
}

export async function rebuildLoyaltyIndex(
  prisma: PrismaClient,
  loyaltyProgramId: string,
): Promise<void> {
  const l = await prisma.loyaltyProgram.findUnique({
    where: { id: loyaltyProgramId },
    include: {
      Review: true,
      LoyaltyTiers: { include: { Review: true } },
      MerchantLoyaltyRewards: { include: { Review: true } },
      Merchant: { include: { Outlets: { select: { id: true } } } },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.offerIndex.deleteMany({
      where: { offerType: OfferIndexType.LOYALTY, offerId: loyaltyProgramId },
    });
    if (!l || !l.Merchant) return;

    const audiences = audiencesForLoyalty(l.LoyaltyTiers);
    if (audiences.length === 0 || l.Merchant.Outlets.length === 0) return;

    const isAvailable = loyaltyIsAvailable(l);

    const rows: Prisma.OfferIndexCreateManyInput[] = [];
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
        });
      }
    }
    if (rows.length > 0) await tx.offerIndex.createMany({ data: rows });
  });
}

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
};
