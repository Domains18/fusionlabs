import { PrismaClient } from '@prisma/client'
import { rebuildCashbackIndex, rebuildExclusiveIndex, rebuildLoyaltyIndex } from './builder'

// Backfill helper. Run once after migration / on cold start. Walks every source
// offer and rebuilds its OfferIndex rows. Safe to re-run — each rebuild deletes
// the source's prior rows before inserting fresh ones.
export async function backfillOfferIndex(prisma: PrismaClient): Promise<{
  cashback: number
  exclusive: number
  loyalty: number
}> {
  const [cashbacks, exclusives, loyalties] = await Promise.all([
    prisma.cashbackConfiguration.findMany({ select: { id: true } }),
    prisma.exclusiveOffer.findMany({ select: { id: true } }),
    prisma.loyaltyProgram.findMany({ select: { id: true } }),
  ])

  for (const c of cashbacks) await rebuildCashbackIndex(prisma, c.id)
  for (const e of exclusives) await rebuildExclusiveIndex(prisma, e.id)
  for (const l of loyalties) await rebuildLoyaltyIndex(prisma, l.id)

  return {
    cashback: cashbacks.length,
    exclusive: exclusives.length,
    loyalty: loyalties.length,
  }
}
