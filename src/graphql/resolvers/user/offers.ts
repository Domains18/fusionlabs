import { GqlError } from "../../../types/general";
import type {
  ResolverWithPermissions,
  QueryOffersArgs,
  CursorPagination,
} from "../../../types/general";
import { isUserActive } from "../../../utils/permissions";
import { getPrismaSelect } from "../../../utils/database";
import {
  resolveUserAudiences,
  findEligibleOutletIds,
  buildOutletWhere,
  buildOfferSelect,
} from "./helpers/offers/filters";
import { Prisma } from "@prisma/client";

type Outlet = Prisma.OutletGetPayload<Record<string, never>>;

export const offers: ResolverWithPermissions<
  QueryOffersArgs,
  { offers: Outlet[]; pagination: CursorPagination }
> = async (_, { filterData, pagination }, { prisma, authSession }, info) => {
  if (!authSession?.userId) throw new GqlError("Unauthorized");

  const now = new Date();
  const take = Math.min(pagination.take ?? 20, 100);

  const prismaSelect = getPrismaSelect<
    Prisma.OutletSelect,
    { offers: Outlet[] }
  >({
    info,
    resolverName: "offers",
  });

  const userCtx = await resolveUserAudiences({ prisma, authSession });

  const { outletIds, hasMore } = await findEligibleOutletIds({
    prisma,
    audiences: userCtx.audiences,
    knownMerchantIds: userCtx.knownMerchantIds,
    percentage: filterData.percentage,
    cursor: pagination.cursor,
    take,
  });

  if (outletIds.length === 0) {
    return {
      offers: [],
      pagination: {
        cursor: pagination.cursor ?? null,
        take,
        hasMore: false,
        nextCursor: null,
      },
    };
  }

  const outletWhere = buildOutletWhere({
    search: filterData.search,
    category: filterData.category,
  });

  const select = buildOfferSelect({
    now,
    prismaSelect,
    legacyEligibility: userCtx.legacyEligibility,
    percentage: filterData.percentage,
  });

  const rows = await prisma.outlet.findMany({
    where: { AND: [{ id: { in: outletIds } }, outletWhere] },
    select,
    orderBy: { id: "asc" },
  });

  const byId = new Map(
    rows.map((r: any) => [(r as { id: string }).id, r] as const),
  );
  const ordered: Outlet[] = [];
  for (const id of outletIds) {
    const r = byId.get(id);
    if (r) ordered.push(r as unknown as Outlet);
  }

  return {
    offers: ordered,
    pagination: {
      cursor: pagination.cursor ?? null,
      take,
      hasMore,
      nextCursor:
        hasMore && ordered.length > 0
          ? (ordered[ordered.length - 1] as { id: string }).id
          : null,
    },
  };
};

offers.permissions = isUserActive;
