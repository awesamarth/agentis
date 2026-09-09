import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { connectDatabase } from './index'
import { join } from 'node:path'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required; no fallback to legacy JSON data')
const connection = connectDatabase(process.env.DATABASE_URL)
try { await migrate(connection.db, { migrationsFolder: join(import.meta.dir, '../../drizzle') }) }
finally { await connection.close() }
