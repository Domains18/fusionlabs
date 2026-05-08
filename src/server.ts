import 'dotenv/config'
import { createServer } from 'node:http'
import { createYoga, createSchema } from 'graphql-yoga'
import { typeDefs } from './graphql/schema'
import { offers } from './graphql/resolvers/user/offers'
import { prisma, connectPrisma, disconnectPrisma } from './utils/prisma'
import type { ContextType } from './types/general'

const resolvers = {
  Query: {
    offers: (parent: unknown, args: any, ctx: ContextType, info: any) =>
      offers(parent, args, ctx, info),
  },
}

const schema = createSchema({ typeDefs, resolvers })

const yoga = createYoga<{}, ContextType>({
  schema,
  context: ({ request }): ContextType => {
    // Dev auth: pass `x-user-id: <userId>` header to act as that user.
    const userId = request.headers.get('x-user-id')
    return {
      prisma,
      authSession: userId ? { userId } : null,
    }
  },
  graphiql: {
    defaultQuery: `# Add header  x-user-id: <some-user-id>  to authenticate.
query Offers {
  offers(filterData: {}, pagination: { take: 10 }) {
    pagination { hasMore nextCursor }
    offers {
      id
      name
      Merchant { id businessName category }
      CashbackConfigurations { id name eligibleCustomerTypes }
      ExclusiveOffers { id name eligibleCustomerTypes }
    }
  }
}`,
  },
})

const server = createServer(yoga)
const port = Number(process.env.PORT ?? 4000)

async function main() {
  await connectPrisma()
  server.listen(port, () => {
    console.log(`GraphQL server ready at http://localhost:${port}/graphql`)
  })
}

const shutdown = async () => {
  server.close()
  await disconnectPrisma()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch(async (err) => {
  console.error(err)
  await disconnectPrisma()
  process.exit(1)
})
