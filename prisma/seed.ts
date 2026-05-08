import 'dotenv/config'
import { prisma } from '../src/utils/prisma'
import { backfillOfferIndex } from '../src/services/offerIndex/sync'

async function main() {
  // Wipe in dependency order so re-runs are idempotent.
  await prisma.offerIndex.deleteMany()
  await prisma.exclusiveOfferFeedTimeline.deleteMany()
  await prisma.cashbackConfigurationTier.deleteMany()
  await prisma.cashbackConfiguration.deleteMany()
  await prisma.exclusiveOffer.deleteMany()
  await prisma.merchantLoyaltyReward.deleteMany()
  await prisma.campaign.deleteMany()
  await prisma.loyaltyTier.deleteMany()
  await prisma.loyaltyProgram.deleteMany()
  await prisma.customerType.deleteMany()
  await prisma.outlet.deleteMany()
  await prisma.paybillOrTill.deleteMany()
  await prisma.merchant.deleteMany()
  await prisma.review.deleteMany()
  await prisma.category.deleteMany()

  const approved = async () => prisma.review.create({ data: { status: 'Approved' } })

  // Two merchants, each with one outlet.
  const m1 = await prisma.merchant.create({
    data: { businessName: 'Java House', status: 'Active', category: 'Food' },
  })
  const m2 = await prisma.merchant.create({
    data: { businessName: 'Naivas', status: 'Active', category: 'Retail' },
  })

  const paybill1 = await prisma.paybillOrTill.create({
    data: {
      number: 100100,
      type: 'Paybill',
      isActive: true,
      reviewId: (await approved()).id,
    },
  })
  const paybill2 = await prisma.paybillOrTill.create({
    data: {
      number: 200200,
      type: 'Till',
      isActive: true,
      reviewId: (await approved()).id,
    },
  })

  const outlet1 = await prisma.outlet.create({
    data: {
      name: 'Java House — Westlands',
      description: 'Coffee & food',
      isActive: true,
      merchantId: m1.id,
      reviewId: (await approved()).id,
      PaybillOrTills: { connect: { id: paybill1.id } },
    },
  })
  const outlet2 = await prisma.outlet.create({
    data: {
      name: 'Naivas — CBD',
      description: 'Supermarket',
      isActive: true,
      merchantId: m2.id,
      reviewId: (await approved()).id,
      PaybillOrTills: { connect: { id: paybill2.id } },
    },
  })

  // Cashback on outlet1, eligible to All
  const cashbackTierReview = await approved()
  const cashback = await prisma.cashbackConfiguration.create({
    data: {
      name: 'Java 5% Cashback',
      isActive: true,
      eligibleCustomerTypes: ['All'],
      merchantId: m1.id,
      netCashbackBudget: 1_000_000,
      usedCashbackBudget: 0,
      reviewId: (await approved()).id,
      Outlets: { connect: { id: outlet1.id } },
      CashbackConfigurationTiers: {
        create: {
          name: 'Tier 1',
          cashbackPercentage: 0.05,
          minSpend: 0,
          isActive: true,
          reviewId: cashbackTierReview.id,
        },
      },
    },
  })

  // Exclusive offer on outlet2, eligible to Vip only
  const now = new Date()
  const exclusive = await prisma.exclusiveOffer.create({
    data: {
      name: 'VIP Weekend',
      description: '20% off for VIPs',
      isActive: true,
      eligibleCustomerTypes: ['Vip'],
      merchantId: m2.id,
      startDate: new Date(now.getTime() - 24 * 3600 * 1000),
      endDate: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
      netOfferBudget: 500_000,
      usedOfferBudget: 0,
      reviewId: (await approved()).id,
      Outlets: { connect: { id: outlet2.id } },
    },
  })

  // Loyalty program on m1
  const loyaltyTierReview = await approved()
  const loyaltyRewardReview = await approved()
  const loyalty = await prisma.loyaltyProgram.create({
    data: {
      name: 'Java Stars',
      isActive: true,
      merchantId: m1.id,
      reviewId: (await approved()).id,
      LoyaltyTiers: {
        create: {
          name: 'Bronze',
          minCustomerType: 'New',
          isActive: true,
          reviewId: loyaltyTierReview.id,
        },
      },
      MerchantLoyaltyRewards: {
        create: {
          name: 'Free Coffee',
          isActive: true,
          reviewId: loyaltyRewardReview.id,
        },
      },
    },
  })

  // A demo user u1 who is a Vip at m2 (and unknown to m1).
  await prisma.customerType.create({
    data: { userId: 'u1', merchantId: m2.id, type: 'Vip' },
  })

  // Build the read-side projection.
  const stats = await backfillOfferIndex(prisma)

  console.log('Seed complete.')
  console.log('  Merchants:', [m1.id, m2.id])
  console.log('  Outlets:', [outlet1.id, outlet2.id])
  console.log('  Offers:', { cashback: cashback.id, exclusive: exclusive.id, loyalty: loyalty.id })
  console.log('  OfferIndex backfill:', stats)
  console.log('\nTry the resolver as user u1 (header: x-user-id: u1) — should see both outlets.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
