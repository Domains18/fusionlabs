import type { GraphQLResolveInfo } from 'graphql'
import { parseResolveInfo, ResolveTree, simplifyParsedResolveInfoFragmentWithType } from 'graphql-parse-resolve-info'

// Stripped-down version of the original `getPrismaSelect` helper. The resolver
// only needs a Prisma `select` shape that mirrors the requested GraphQL fields
// for the `offers` payload. We don't reproduce the full library here — just
// enough to forward field selections through to Prisma.
export function getPrismaSelect<S, _T>(args: {
  info: GraphQLResolveInfo
  resolverName: string
}): { select: S } {
  const parsed = parseResolveInfo(args.info) as ResolveTree | null | undefined
  if (!parsed) return { select: {} as S }

  const { fields } = simplifyParsedResolveInfoFragmentWithType(parsed, args.info.returnType as never)
  const offersField = (fields as Record<string, ResolveTree>)['offers']
  if (!offersField) return { select: {} as S }

  const buildSelect = (tree: ResolveTree): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    const inner = (tree.fieldsByTypeName ?? {}) as Record<string, Record<string, ResolveTree>>
    for (const typeFields of Object.values(inner)) {
      for (const [name, sub] of Object.entries(typeFields)) {
        const hasChildren = Object.keys(sub.fieldsByTypeName ?? {}).length > 0
        out[name] = hasChildren ? { select: buildSelect(sub) } : true
      }
    }
    return out
  }

  return { select: buildSelect(offersField) as S }
}

// Trimmed `createSearchFilters`: ILIKE across the supplied fields. Used by the
// new resolver only when a `search` term is supplied (the index-based query
// can't index full-text search by itself).
export function createSearchFilters<T>(
  search: string,
  fields: ReadonlyArray<keyof T & string>
): Record<string, unknown> {
  return {
    OR: fields.map((field) => ({
      [field]: { contains: search, mode: 'insensitive' },
    })),
  }
}
