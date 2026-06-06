import 'dotenv/config'
import postgres from 'postgres'
import { CREATE_TABLES, SEED_DATA, SEED_ADMIN } from './schema'

const DATABASE_URL = process.env.DATABASE_URL
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Check your .env file.')
  process.exit(1)
}

if (!ADMIN_EMAIL) {
  console.warn('ADMIN_EMAIL is not set — superadmin will not be seeded.')
}

async function migrate() {
  console.log('Connecting to database...')

  const sql = postgres(DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  })

  try {
    // Step 1 — Create all tables first
    // Must complete before seed data runs
    console.log('Creating tables...')
    await sql.unsafe(CREATE_TABLES)
    console.log('Tables ready')

    // Step 2 — Seed roles and scopes
    // Runs only after all tables exist
    console.log('Seeding roles and scopes...')
    await sql.unsafe(SEED_DATA)
    console.log('Roles and scopes seeded')

    // Step 3 — Seed superadmin if ADMIN_EMAIL is set
    // Runs only after members and roles tables exist and are seeded
    if (ADMIN_EMAIL) {
      console.log(`Seeding superadmin for: ${ADMIN_EMAIL}`)
      await sql.unsafe(SEED_ADMIN(ADMIN_EMAIL))
      console.log('Superadmin seeded')
      console.log('If the member does not exist yet, register first then re-run pnpm db:migrate.')
    }

  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    await sql.end()
    console.log('Database connection closed')
  }
}

migrate()