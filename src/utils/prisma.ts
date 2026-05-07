
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

const log =
  process.env.DATABASE_LOGGING === 'true'
    ? ([
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ] as const)
    : ([{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }] as const)

function createPrisma(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set before creating the Prisma client.')
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)

  const client = new PrismaClient({
    adapter,
    log: log as any,
  })

  client.$on('query' as never, (e: any) => {
    if (process.env.DATABASE_LOGGING === 'true') {
      console.debug(`[prisma] ${e.query} (${e.duration}ms)`)
    }
  })
  client.$on('error' as never, (e: any) => {
    console.error('[prisma]', e.message)
  })
  client.$on('warn' as never, (e: any) => {
    console.warn('[prisma]', e.message)
  })

  return client
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrisma()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Convenience helpers so callers don't have to wire the lifecycle themselves.
export async function connectPrisma(): Promise<void> {
  await prisma.$connect()
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
}
