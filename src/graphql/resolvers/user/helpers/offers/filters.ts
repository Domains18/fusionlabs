import { OfferIndexType, Prisma } from "@prisma/client";
import {
  CashbackPercentageFilters,
  ContextType,
  MerchantStatusEnum,
  ReviewStatusEnum,
} from "../../../../../types/general";
import {
  AUDIENCE_ALL,
  AUDIENCE_NON_CUSTOMER,
  audienceForCustomerType,
  audienceForFeedTimeline,
  CustomerTypeKey,
  ORDERED_CUSTOMER_TYPES,
} from "../../../../../utils/config";
import { customerTypeToEligibileCustomerType } from "../../../../../utils/filters";
import { createSearchFilters } from "../../../../../utils/database";

export type UserAudienceContext = {
  audiences: string[];

  knownMerchantIds: string[];

  legacyEligibility: {
    cashbackEligibility: Prisma.CashbackConfigurationWhereInput["OR"];
    exclusiveOfferEligibility: Prisma.ExclusiveOfferWhereInput["OR"];
    loyaltyProgramEligibility: Prisma.LoyaltyProgramWhereInput["OR"];
  };
};

export async function resolveUserAudiences({
  prisma,
  authSession,
}: {
  prisma: ContextType["prisma"];
  authSession: NonNullable<ContextType["authSession"]>;
}): Promise<UserAudienceContext> {
  const customerTypes = await prisma.customerType.findMany({
    where: { userId: authSession.userId },
    select: { id: true, merchantId: true, type: true },
  });

  const audiences = new Set<string>([AUDIENCE_ALL, AUDIENCE_NON_CUSTOMER]);
  const knownMerchantIds: string[] = [];

  for (const ct of customerTypes) {
    knownMerchantIds.push(ct.merchantId);
    const userType = customerTypeToEligibileCustomerType(ct.type);
    audiences.add(audienceForCustomerType(userType));

    audiences.add(audienceForFeedTimeline(ct.id));
  }

  const legacyEligibility = buildLegacyEligibility(
    customerTypes.map((c: any) => ({
      ...c,
      type: customerTypeToEligibileCustomerType(c.type),
    })),
  );

  return {
    audiences: [...audiences],
    knownMerchantIds,
    legacyEligibility,
  };
}

export function buildOutletWhere({
  search,
  category,
}: {
  search?: string | null;
  category?: string | null;
}): Prisma.OutletWhereInput {
  return {
    isActive: true,
    Review: { status: ReviewStatusEnum.Approved },
    Merchant: {
      AND: [
        { status: MerchantStatusEnum.Active },
        ...(category
          ? [
              {
                OR: [
                  { category },
                  { SecondaryCategories: { some: { name: category } } },
                ],
              },
            ]
          : []),
        ...(search
          ? [
              createSearchFilters<{
                businessName: string;
                description: string | null;
              }>(search, ["businessName", "description"]),
            ]
          : []),
      ],
    },
    PaybillOrTills: {
      some: {
        isActive: true,
        deletedAt: null,
        Review: { status: ReviewStatusEnum.Approved },
      },
    },
    ...(search
      ? createSearchFilters<{ name: string; description: string | null }>(
          search,
          ["name", "description"],
        )
      : {}),
  };
}

export function buildPercentageRange(
  percentage: CashbackPercentageFilters | null | undefined,
):
  | { gt?: Prisma.Decimal; gte?: Prisma.Decimal; lte?: Prisma.Decimal }
  | undefined {
  if (!percentage) return undefined;
  switch (percentage) {
    case CashbackPercentageFilters.ZeroToFive:
      return { gt: new Prisma.Decimal(0), lte: new Prisma.Decimal(0.05) };
    case CashbackPercentageFilters.FiveToTen:
      return { gte: new Prisma.Decimal(0.05), lte: new Prisma.Decimal(0.1) };
    case CashbackPercentageFilters.TenToFifteen:
      return { gte: new Prisma.Decimal(0.1), lte: new Prisma.Decimal(0.15) };
    case CashbackPercentageFilters.FifteenToTwenty:
      return { gte: new Prisma.Decimal(0.15), lte: new Prisma.Decimal(0.2) };
    case CashbackPercentageFilters.TwentyAndAbove:
      return { gte: new Prisma.Decimal(0.2) };
  }
}

export async function findEligibleOutletIds({
  prisma,
  audiences,
  knownMerchantIds,
  percentage,
  cursor,
  take,
}: {
  prisma: ContextType["prisma"];
  audiences: string[];
  knownMerchantIds: string[];
  percentage: CashbackPercentageFilters | null | undefined;
  cursor?: string | null;
  take: number;
}): Promise<{ outletIds: string[]; hasMore: boolean }> {
  const range = buildPercentageRange(percentage);

  const baseWhere: Prisma.OfferIndexWhereInput = {
    isAvailable: true,
    audience: { in: audiences },
    ...(cursor ? { outletId: { gt: cursor } } : {}),

    AND:
      knownMerchantIds.length > 0
        ? [
            {
              OR: [
                { audience: { not: AUDIENCE_NON_CUSTOMER } },
                {
                  audience: AUDIENCE_NON_CUSTOMER,
                  merchantId: { notIn: knownMerchantIds },
                },
              ],
            },
          ]
        : undefined,
  };

  const where: Prisma.OfferIndexWhereInput = range
    ? {
        AND: [
          baseWhere,
          {
            OR: [
              { offerType: { not: OfferIndexType.CASHBACK } },
              {
                offerType: OfferIndexType.CASHBACK,
                maxCashbackPercentage: range,
              },
            ],
          },
        ],
      }
    : baseWhere;

  const rows = await prisma.offerIndex.findMany({
    where,
    select: { outletId: true },
    distinct: ["outletId"],
    orderBy: { outletId: "asc" },
    take: take + 1,
  });

  const hasMore = rows.length > take;
  const outletIds = (hasMore ? rows.slice(0, take) : rows).map(
    (r) => r.outletId,
  );
  return { outletIds, hasMore };
}

type LegacyCt = { id: string; merchantId: string; type: CustomerTypeKey };

function buildLegacyEligibility(eligibleCustomerTypes: LegacyCt[]) {
  const merchantIds = eligibleCustomerTypes.map((c) => c.merchantId);
  const baseOrFilters = [
    { eligibleCustomerTypes: { has: AUDIENCE_ALL } },
    {
      eligibleCustomerTypes: { has: AUDIENCE_NON_CUSTOMER },
      merchantId: { notIn: merchantIds },
    },
  ];

  const cashbackEligibility = eligibleCustomerTypes.reduce<
    NonNullable<Prisma.CashbackConfigurationWhereInput["OR"]>
  >(
    (acc, { type, merchantId }) => [
      ...acc,
      { merchantId, eligibleCustomerTypes: { has: type } },
    ],
    [...baseOrFilters],
  );

  const exclusiveOfferEligibility = eligibleCustomerTypes.reduce<
    NonNullable<Prisma.ExclusiveOfferWhereInput["OR"]>
  >(
    (acc, { id, type, merchantId }) => [
      ...acc,
      { merchantId, eligibleCustomerTypes: { has: type } },
      { merchantId, FeedTimeline: { some: { customerTypeId: id } } },
    ],
    [...baseOrFilters],
  );

  const loyaltyProgramEligibility = eligibleCustomerTypes.reduce<
    NonNullable<Prisma.LoyaltyProgramWhereInput["OR"]>
  >(
    (acc, { type, merchantId }) => {
      const userIdx = ORDERED_CUSTOMER_TYPES[type];
      const eligibleTypes = (
        Object.entries(ORDERED_CUSTOMER_TYPES) as [CustomerTypeKey, number][]
      )
        .filter(([, idx]) => idx <= userIdx)
        .map(([t]) => t);
      return [
        ...acc,
        {
          merchantId,
          LoyaltyTiers: { some: { minCustomerType: { in: eligibleTypes } } },
        },
      ];
    },
    [{ LoyaltyTiers: { some: { minCustomerType: "New" } } }],
  );

  return {
    cashbackEligibility,
    exclusiveOfferEligibility,
    loyaltyProgramEligibility,
  };
}

export function buildOfferSelect(args: {
  now: Date;
  prismaSelect: { select: Prisma.OutletSelect };
  legacyEligibility: UserAudienceContext["legacyEligibility"];
  percentage: CashbackPercentageFilters | null | undefined;
}): Prisma.OutletSelect {
  const { prismaSelect, legacyEligibility, percentage, now } = args;
  const select: Prisma.OutletSelect = { ...prismaSelect.select };

  const range = buildPercentageRange(percentage);

  select.CashbackConfigurations = {
    ...(typeof select.CashbackConfigurations === "object"
      ? select.CashbackConfigurations
      : {}),
    where: {
      isActive: true,
      deletedAt: null,
      Review: { status: ReviewStatusEnum.Approved },
      OR: legacyEligibility.cashbackEligibility,
      AND: [
        {
          OR: [
            { startDate: null, endDate: null },
            { startDate: { lte: now }, endDate: { gte: now } },
          ],
        },
      ],
      CashbackConfigurationTiers: {
        some: {
          isActive: true,
          deletedAt: null,
          Review: { status: ReviewStatusEnum.Approved },
          ...(range ? { cashbackPercentage: range } : {}),
        },
      },
    },
  };

  select.ExclusiveOffers = {
    ...(typeof select.ExclusiveOffers === "object"
      ? select.ExclusiveOffers
      : {}),
    where: {
      isActive: true,
      deletedAt: null,
      Review: { status: ReviewStatusEnum.Approved },
      startDate: { lte: now },
      endDate: { gte: now },
      OR: legacyEligibility.exclusiveOfferEligibility,
    },
  };

  select.PaybillOrTills = {
    ...(typeof select.PaybillOrTills === "object" ? select.PaybillOrTills : {}),
    where: {
      isActive: true,
      deletedAt: null,
      Review: { status: ReviewStatusEnum.Approved },
    },
  };

  return select;
}
