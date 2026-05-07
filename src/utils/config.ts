export const ORDERED_CUSTOMER_TYPES = {
  NonCustomer: 0,
  New: 1,
  Infrequent: 2,
  Occasional: 3,
  Regular: 4,
  Vip: 5,
} as const

export type CustomerTypeKey = keyof typeof ORDERED_CUSTOMER_TYPES

export const ALL_CUSTOMER_TYPES: CustomerTypeKey[] = Object.keys(
  ORDERED_CUSTOMER_TYPES
) as CustomerTypeKey[]

// Audience tokens used inside OfferIndex.audience. Kept as plain strings so they
// can sit alongside per-customer `feed:<id>` tokens for ExclusiveOffer feed rows.
export const AUDIENCE_ALL = 'All'
export const AUDIENCE_NON_CUSTOMER = 'NonCustomer'
export const audienceForCustomerType = (t: CustomerTypeKey) => t
export const audienceForFeedTimeline = (customerTypeId: string) => `feed:${customerTypeId}`
