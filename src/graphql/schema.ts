export const typeDefs = /* GraphQL */ `
  enum CashbackPercentageFilters {
    ZeroToFive
    FiveToTen
    TenToFifteen
    FifteenToTwenty
    TwentyAndAbove
  }

  type Review {
    id: ID!
    status: String!
  }

  type Merchant {
    id: ID!
    businessName: String!
    status: String!
    category: String!
    LoyaltyProgram: LoyaltyProgram
  }

  type LoyaltyProgram {
    id: ID!
    name: String!
    isActive: Boolean!
  }

  type CashbackConfiguration {
    id: ID!
    name: String!
    isActive: Boolean!
    eligibleCustomerTypes: [String!]!
    startDate: String
    endDate: String
  }

  type ExclusiveOffer {
    id: ID!
    name: String!
    description: String!
    isActive: Boolean!
    startDate: String!
    endDate: String!
    eligibleCustomerTypes: [String!]!
  }

  type PaybillOrTill {
    id: ID!
    number: Int!
    type: String!
    isActive: Boolean!
  }

  type Outlet {
    id: ID!
    name: String!
    description: String
    isActive: Boolean!
    Merchant: Merchant
    PaybillOrTills: [PaybillOrTill!]
    CashbackConfigurations: [CashbackConfiguration!]
    ExclusiveOffers: [ExclusiveOffer!]
  }

  type CursorPagination {
    cursor: String
    take: Int
    hasMore: Boolean!
    nextCursor: String
  }

  type OffersWithPagination {
    offers: [Outlet!]!
    pagination: CursorPagination!
  }

  input OfferFilterData {
    search: String
    category: String
    percentage: CashbackPercentageFilters
  }

  input PaginationInput {
    cursor: String
    take: Int
  }

  type Query {
    offers(
      filterData: OfferFilterData!
      pagination: PaginationInput!
    ): OffersWithPagination!
  }
`
