import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/index.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres?schema=public';
const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[CRITICAL] Database pool error:', err);
  process.exit(1);
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
