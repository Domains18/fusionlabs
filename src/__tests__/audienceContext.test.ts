import { describe, it, expect, vi } from 'vitest'
import { resolveUserAudiences } from '../graphql/resolvers/user/helpers/offers/filters'
import type { PrismaClient } from '../../prisma/generated/client'

// Lightweight test that the resolver-side audience set is computed correctly
// for a user holding multiple CustomerType rows. We mock the only Prisma call
// `resolveUserAudiences` makes.

function fakePrisma(rows: { id: string; merchantId: string; type: string }[]): PrismaClient {
  return {
    customerType: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaClient
}

describe('resolveUserAudiences', () => {
  it('always includes All and NonCustomer for any logged-in user', async () => {
    const prisma = fakePrisma([])
    const ctx = await resolveUserAudiences({ prisma, authSession: { userId: 'u1' } })
    expect(ctx.audiences).toContain('All')
    expect(ctx.audiences).toContain('NonCustomer')
    expect(ctx.knownMerchantIds).toEqual([])
  })

  it('adds the user’s exact customer-type token per merchant + a feed token', async () => {
    const prisma = fakePrisma([
      { id: 'ct1', merchantId: 'm1', type: 'Vip' },
      { id: 'ct2', merchantId: 'm2', type: 'Regular' },
    ])
    const ctx = await resolveUserAudiences({ prisma, authSession: { userId: 'u1' } })
    expect(ctx.audiences).toEqual(
      expect.arrayContaining(['All', 'NonCustomer', 'Vip', 'Regular', 'feed:ct1', 'feed:ct2'])
    )
    expect(ctx.knownMerchantIds.sort()).toEqual(['m1', 'm2'])
  })
})
