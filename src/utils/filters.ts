import { CustomerTypeKey } from './config'

// The original codebase distinguished CustomerTypeEnum (the user's relationship)
// from EligibleCustomerTypeEnum (what an offer accepts). They overlap by name,
// so the mapping is identity for our purposes — kept as a function to preserve
// the seam in case the two enums diverge later.
export const customerTypeToEligibileCustomerType = (t: string): CustomerTypeKey => t as CustomerTypeKey
