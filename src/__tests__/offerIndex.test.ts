import { describe, it, expect } from 'vitest'
import { _internals } from '../services/offerIndex/builder'

// Pure-function tests for the audience expansion + availability rollups.
// We don't spin up a real Postgres here — the goal is to validate the eligibility
// logic that drives index population, which is the part most likely to drift
// from the original resolver's correctness rules.

const REVIEW_OK = { status: 'Approved' as const }

describe('audiencesForLoyalty', () => {
  it('expands a Regular-min tier upward to Regular and Vip only', () => {
    const out = _internals.audiencesForLoyalty([
      { minCustomerType: 'Regular', isActive: true, deletedAt: null, Review: REVIEW_OK },
    ])
    expect(out.sort()).toEqual(['Regular', 'Vip'])
  })

  it('expands a New-min tier to every customer type', () => {
    const out = _internals.audiencesForLoyalty([
      { minCustomerType: 'New', isActive: true, deletedAt: null, Review: REVIEW_OK },
    ])
    expect(out.sort()).toEqual(['Infrequent', 'New', 'NonCustomer', 'Occasional', 'Regular', 'Vip'].sort())
  })

  it('ignores inactive / unapproved / deleted tiers', () => {
    const out = _internals.audiencesForLoyalty([
      { minCustomerType: 'New', isActive: false, deletedAt: null, Review: REVIEW_OK },
      { minCustomerType: 'New', isActive: true, deletedAt: new Date(), Review: REVIEW_OK },
      { minCustomerType: 'New', isActive: true, deletedAt: null, Review: { status: 'Pending' } },
    ])
    expect(out).toEqual([])
  })

  it('takes the union across multiple tiers, picking the lowest min', () => {
    const out = _internals.audiencesForLoyalty([
      { minCustomerType: 'Vip', isActive: true, deletedAt: null, Review: REVIEW_OK },
      { minCustomerType: 'Occasional', isActive: true, deletedAt: null, Review: REVIEW_OK },
    ])
    expect(out.sort()).toEqual(['Occasional', 'Regular', 'Vip'])
  })
})

describe('audiencesForArrayBased', () => {
  it('returns the eligible customer types as audience tokens, dedup', () => {
    expect(_internals.audiencesForArrayBased(['All', 'Vip', 'Vip']).sort()).toEqual(['All', 'Vip'])
  })

  it('preserves NonCustomer (the resolver applies the merchant exclusion later)', () => {
    expect(_internals.audiencesForArrayBased(['NonCustomer'])).toEqual(['NonCustomer'])
  })
})

describe('exclusiveIsAvailable', () => {
  const now = new Date('2026-05-07T12:00:00Z')
  const base = {
    id: 'e1',
    name: 'x',
    description: 'x',
    isActive: true,
    deletedAt: null,
    eligibleCustomerTypes: ['All'],
    merchantId: 'm',
    Review: REVIEW_OK,
    Outlets: [],
    FeedTimeline: [],
    netOfferBudget: { gte: () => false } as never,
    usedOfferBudget: { gte: () => false } as never,
    startDate: new Date('2026-05-01T00:00:00Z'),
    endDate: new Date('2026-05-30T00:00:00Z'),
  }

  it('is available inside the window with budget left', () => {
    expect(_internals.exclusiveIsAvailable(base as never, now)).toBe(true)
  })

  it('is not available when inactive', () => {
    expect(_internals.exclusiveIsAvailable({ ...base, isActive: false } as never, now)).toBe(false)
  })

  it('is not available before startDate', () => {
    expect(
      _internals.exclusiveIsAvailable(
        { ...base, startDate: new Date('2026-06-01') } as never,
        now
      )
    ).toBe(false)
  })

  it('is not available after endDate', () => {
    expect(
      _internals.exclusiveIsAvailable(
        { ...base, endDate: new Date('2026-04-01') } as never,
        now
      )
    ).toBe(false)
  })

  it('is not available when review is not Approved', () => {
    expect(
      _internals.exclusiveIsAvailable({ ...base, Review: { status: 'Pending' } } as never, now)
    ).toBe(false)
  })
})
