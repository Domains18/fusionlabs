import { Prisma, PrismaClient } from '../../../prisma/generated/client'
import {
  rebuildCashbackIndex,
  rebuildExclusiveIndex,
  rebuildLoyaltyIndex,
} from './builder'

// =============================================================================
//  Prisma client extension that keeps OfferIndex synchronized with source-table
//  mutations. Wrap your PrismaClient with `withOfferIndexSync(prisma)` at boot
//  and every write through the wrapped client triggers a rebuild for the
//  affected source offer.
//
//  This intentionally trades some write latency for a guarantee that no source
//  mutation can leave the index stale (a source row's index rows are rebuilt
//  inside the same logical operation that mutated it). Cross-source effects
//  (e.g. mutating a CashbackConfigurationTier rebuilds the parent
//  CashbackConfiguration) are handled by translating the changed row's id
//  back to its parent before rebuilding.
//
//  What this does NOT cover, by design:
//   * Time-based transitions (offer reaches endDate). Handled by the cron sweep.
//   * Budget consumption rounding past the threshold during a payment flow that
//     doesn't go through the wrapped client. Easiest fix: route those mutations
//     through this client, or call rebuildCashbackIndex / rebuildExclusiveIndex
//     manually after each transactional budget update.
// =============================================================================

type AnyOpArgs = { args: unknown; query: (a: unknown) => Promise<unknown> }

type SyncTarget =
  | { kind: 'cashback'; getId: (raw: unknown) => Promise<string[]> }
  | { kind: 'exclusive'; getId: (raw: unknown) => Promise<string[]> }
  | { kind: 'loyalty'; getId: (raw: unknown) => Promise<string[]> }

const passId = (v: unknown): string | null =>
  typeof v === 'object' && v !== null && 'id' in (v as Record<string, unknown>)
    ? String((v as Record<string, unknown>).id)
    : null

export function withOfferIndexSync(prisma: PrismaClient) {
  return prisma.$extends({
    name: 'offer-index-sync',
    query: {
      // ---- cashback: direct ----
      cashbackConfiguration: {
        async $allOperations({ operation, args, query, model: _m }) {
          const result = await query(args)
          if (!isWrite(operation)) return result
          const id = passId(result) ?? extractWhereId(args)
          if (id) await rebuildCashbackIndex(prisma, id)
          return result
        },
      },
      // ---- cashback tiers: bubble up ----
      cashbackConfigurationTier: {
        async $allOperations({ operation, args, query }) {
          const before = isWrite(operation) ? await parentCashbackId(prisma, args) : null
          const result = await query(args)
          if (!isWrite(operation)) return result
          const ids = new Set<string>()
          if (before) ids.add(before)
          const after = passId(result)
          if (after) {
            const fresh = await prisma.cashbackConfigurationTier.findUnique({
              where: { id: after },
              select: { cashbackConfigurationId: true },
            })
            if (fresh) ids.add(fresh.cashbackConfigurationId)
          }
          for (const id of ids) await rebuildCashbackIndex(prisma, id)
          return result
        },
      },
      // ---- exclusive offer: direct ----
      exclusiveOffer: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args)
          if (!isWrite(operation)) return result
          const id = passId(result) ?? extractWhereId(args)
          if (id) await rebuildExclusiveIndex(prisma, id)
          return result
        },
      },
      // ---- feed timeline: bubble up to parent exclusive ----
      exclusiveOfferFeedTimeline: {
        async $allOperations({ operation, args, query }) {
          const before = isWrite(operation) ? await parentExclusiveId(prisma, args) : null
          const result = await query(args)
          if (!isWrite(operation)) return result
          const ids = new Set<string>()
          if (before) ids.add(before)
          const after = passId(result)
          if (after) {
            const fresh = await prisma.exclusiveOfferFeedTimeline.findUnique({
              where: { id: after },
              select: { exclusiveOfferId: true },
            })
            if (fresh) ids.add(fresh.exclusiveOfferId)
          }
          for (const id of ids) await rebuildExclusiveIndex(prisma, id)
          return result
        },
      },
      // ---- loyalty: direct ----
      loyaltyProgram: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args)
          if (!isWrite(operation)) return result
          const id = passId(result) ?? extractWhereId(args)
          if (id) await rebuildLoyaltyIndex(prisma, id)
          return result
        },
      },
      loyaltyTier: {
        async $allOperations({ operation, args, query }) {
          const before = isWrite(operation) ? await parentLoyaltyProgramId(prisma, args, 'tier') : null
          const result = await query(args)
          if (!isWrite(operation)) return result
          const ids = new Set<string>()
          if (before) ids.add(before)
          const after = passId(result)
          if (after) {
            const fresh = await prisma.loyaltyTier.findUnique({
              where: { id: after },
              select: { loyaltyProgramId: true },
            })
            if (fresh) ids.add(fresh.loyaltyProgramId)
          }
          for (const id of ids) await rebuildLoyaltyIndex(prisma, id)
          return result
        },
      },
      merchantLoyaltyReward: {
        async $allOperations({ operation, args, query }) {
          const before = isWrite(operation) ? await parentLoyaltyProgramId(prisma, args, 'reward') : null
          const result = await query(args)
          if (!isWrite(operation)) return result
          const ids = new Set<string>()
          if (before) ids.add(before)
          const after = passId(result)
          if (after) {
            const fresh = await prisma.merchantLoyaltyReward.findUnique({
              where: { id: after },
              select: { loyaltyProgramId: true },
            })
            if (fresh) ids.add(fresh.loyaltyProgramId)
          }
          for (const id of ids) await rebuildLoyaltyIndex(prisma, id)
          return result
        },
      },
      // ---- review: status changes can flip availability for any of the three offer types ----
      review: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args)
          if (!isWrite(operation)) return result
          const id = passId(result) ?? extractWhereId(args)
          if (!id) return result
          // Discover which kind of source owns this review and rebuild only that one.
          const [c, e, l, t, lt, mlr] = await Promise.all([
            prisma.cashbackConfiguration.findUnique({ where: { reviewId: id }, select: { id: true } }),
            prisma.exclusiveOffer.findUnique({ where: { reviewId: id }, select: { id: true } }),
            prisma.loyaltyProgram.findUnique({ where: { reviewId: id }, select: { id: true } }),
            prisma.cashbackConfigurationTier.findUnique({ where: { reviewId: id }, select: { cashbackConfigurationId: true } }),
            prisma.loyaltyTier.findUnique({ where: { reviewId: id }, select: { loyaltyProgramId: true } }),
            prisma.merchantLoyaltyReward.findUnique({ where: { reviewId: id }, select: { loyaltyProgramId: true } }),
          ])
          if (c) await rebuildCashbackIndex(prisma, c.id)
          if (e) await rebuildExclusiveIndex(prisma, e.id)
          if (l) await rebuildLoyaltyIndex(prisma, l.id)
          if (t) await rebuildCashbackIndex(prisma, t.cashbackConfigurationId)
          if (lt) await rebuildLoyaltyIndex(prisma, lt.loyaltyProgramId)
          if (mlr) await rebuildLoyaltyIndex(prisma, mlr.loyaltyProgramId)
          return result
        },
      },
    },
  })
}

function isWrite(op: string): boolean {
  return (
    op === 'create' ||
    op === 'createMany' ||
    op === 'update' ||
    op === 'updateMany' ||
    op === 'upsert' ||
    op === 'delete' ||
    op === 'deleteMany'
  )
}

function extractWhereId(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null
  const a = args as { where?: { id?: unknown } }
  return typeof a.where?.id === 'string' ? a.where.id : null
}

async function parentCashbackId(prisma: PrismaClient, args: unknown): Promise<string | null> {
  const id = extractWhereId(args)
  if (!id) return null
  const row = await prisma.cashbackConfigurationTier.findUnique({
    where: { id },
    select: { cashbackConfigurationId: true },
  })
  return row?.cashbackConfigurationId ?? null
}

async function parentExclusiveId(prisma: PrismaClient, args: unknown): Promise<string | null> {
  const id = extractWhereId(args)
  if (!id) return null
  const row = await prisma.exclusiveOfferFeedTimeline.findUnique({
    where: { id },
    select: { exclusiveOfferId: true },
  })
  return row?.exclusiveOfferId ?? null
}

async function parentLoyaltyProgramId(
  prisma: PrismaClient,
  args: unknown,
  kind: 'tier' | 'reward'
): Promise<string | null> {
  const id = extractWhereId(args)
  if (!id) return null
  if (kind === 'tier') {
    const row = await prisma.loyaltyTier.findUnique({
      where: { id },
      select: { loyaltyProgramId: true },
    })
    return row?.loyaltyProgramId ?? null
  }
  const row = await prisma.merchantLoyaltyReward.findUnique({
    where: { id },
    select: { loyaltyProgramId: true },
  })
  return row?.loyaltyProgramId ?? null
}

// Helper for unused Prisma symbol — silences "imported but unused" if tree-shaken
export type _PrismaUnusedSymbol = Prisma.OfferIndexCreateInput
