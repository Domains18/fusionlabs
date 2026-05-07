import type { CursorPagination } from '../types/general'

type CursorOptions = {
  take: number
  skip?: number
  cursor?: { id: string }
  orderBy: { id: 'asc' }
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export async function paginatePrismaWithCursor<T extends { id: string }>(
  query: (opts: CursorOptions) => Promise<T[]>,
  pagination: { cursor?: string | null; take?: number | null }
): Promise<{ data: T[]; pagination: CursorPagination }> {
  const take = Math.min(pagination.take ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const opts: CursorOptions = {
    take: take + 1, // overfetch one to detect "hasMore"
    orderBy: { id: 'asc' },
    ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
  }

  const rows = await query(opts)
  const hasMore = rows.length > take
  const data = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null

  return {
    data,
    pagination: {
      cursor: pagination.cursor ?? null,
      take,
      hasMore,
      nextCursor,
    },
  }
}
