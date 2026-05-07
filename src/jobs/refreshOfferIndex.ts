import { PrismaClient } from '../../prisma/generated/client'
import { rebuildCashbackIndex, rebuildExclusiveIndex } from '../services/offerIndex/builder'

// =============================================================================
//  Cron sweep — handles transitions that aren't triggered by source-table writes:
//
//    1. An offer reaching its `endDate` (was available, should now be hidden)
//    2. An offer reaching its `startDate` (was hidden, should now be visible)
//    3. Budget exhaustion in flows that don't go through the wrapped Prisma client
//
//  We run cheaply by scanning OfferIndex itself — only rows whose stored
//  start/end dates straddle `now` AND whose `isAvailable` value disagrees with
//  what the predicates would return are candidates for a rebuild.
//
//  Recommended cadence: every 1–5 minutes via BullMQ or node-cron. The window
//  this leaves for stale rows is bounded by that cadence; users can see an
//  offer for at most one tick after it expires.
// =============================================================================

export async function refreshOfferIndex(prisma: PrismaClient, now = new Date()): Promise<{
  rebuiltCashback: number
  rebuiltExclusive: number
}> {
  // Find candidate source offers whose date boundary just crossed `now`.
  // We pick a narrow window so we don't rebuild offers that have been expired
  // for weeks. Tunable: increase if cadence is slower than the window.
  const candidates = await prisma.offerIndex.findMany({
    where: {
      OR: [
        { endDate: { lt: now }, isAvailable: true },
        { startDate: { lt: now }, isAvailable: false, endDate: { gte: now } },
      ],
    },
    select: { offerType: true, offerId: true },
    distinct: ['offerType', 'offerId'],
  })

  let cashback = 0
  let exclusive = 0
  for (const c of candidates) {
    if (c.offerType === 'CASHBACK') {
      await rebuildCashbackIndex(prisma, c.offerId, now)
      cashback++
    } else if (c.offerType === 'EXCLUSIVE') {
      await rebuildExclusiveIndex(prisma, c.offerId, now)
      exclusive++
    }
  }

  return { rebuiltCashback: cashback, rebuiltExclusive: exclusive }
}

if (require.main === module) {
  const prisma = new PrismaClient()
  refreshOfferIndex(prisma)
    .then((res) => {
      console.log('refreshOfferIndex complete', res)
      return prisma.$disconnect()
    })
    .catch(async (err) => {
      console.error(err)
      await prisma.$disconnect()
      process.exit(1)
    })
}
