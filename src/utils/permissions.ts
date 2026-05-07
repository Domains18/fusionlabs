import type { ContextType } from '../types/general'

// Minimal stand-in for the original `isUserActive` permission gate. Real impl
// would check user status, suspension, etc. — left as a single seam so the
// resolver wiring matches the original code shape.
export const isUserActive = (ctx: ContextType): boolean => Boolean(ctx.authSession?.userId)
