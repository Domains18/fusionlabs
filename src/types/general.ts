import { PrismaClient } from "@prisma/client";
import type { GraphQLResolveInfo } from "graphql";

export type AuthSession = {
  userId: string;
};

export type ContextType = {
  prisma: PrismaClient;
  authSession: AuthSession | null;
};

export type ResolverWithPermissions<Args, Result> = ((
  parent: unknown,
  args: Args,
  ctx: ContextType,
  info: GraphQLResolveInfo,
) => Promise<Result>) & {
  permissions?: (ctx: ContextType) => boolean | Promise<boolean>;
};

export class GqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GqlError";
  }
}

// Mirror of the imported enum from `@budj/graphql` in the original codebase.
export enum CashbackPercentageFilters {
  ZeroToFive = "ZeroToFive",
  FiveToTen = "FiveToTen",
  TenToFifteen = "TenToFifteen",
  FifteenToTwenty = "FifteenToTwenty",
  TwentyAndAbove = "TwentyAndAbove",
}

export enum ReviewStatusEnum {
  Approved = "Approved",
  Pending = "Pending",
  Rejected = "Rejected",
}

export enum MerchantStatusEnum {
  Active = "Active",
  Pending = "Pending",
  Suspended = "Suspended",
}

export type CursorPagination = {
  cursor?: string | null;
  take?: number | null;
  hasMore: boolean;
  nextCursor: string | null;
};

export type QueryOffersArgs = {
  filterData: {
    search?: string | null;
    category?: string | null;
    percentage?: CashbackPercentageFilters | null;
  };
  pagination: {
    cursor?: string | null;
    take?: number | null;
  };
};
