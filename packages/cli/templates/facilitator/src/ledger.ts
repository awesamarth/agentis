import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export type Seller = {
  payTo: string
  label: string | null
  balanceMicros: number
  feeBps: number | null
  active: number
}

const dbPath = process.env.DATABASE_PATH ?? 'data/facilitator.db'
mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sellers (
    pay_to TEXT PRIMARY KEY,
    label TEXT,
    balance_micros INTEGER NOT NULL DEFAULT 0,
    fee_bps INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    pay_to TEXT NOT NULL,
    transaction_signature TEXT NOT NULL,
    amount_micros INTEGER NOT NULL,
    fee_micros INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`)

export function dollarsToMicros(value: number): number {
  return Math.round(value * 1_000_000)
}

export function microsToDollars(value: number): number {
  return value / 1_000_000
}

export function getSeller(payTo: string): Seller | null {
  const row = db.prepare(`
    SELECT pay_to as payTo, label, balance_micros as balanceMicros, fee_bps as feeBps, active
    FROM sellers
    WHERE pay_to = ?
  `).get(payTo) as Seller | null
  return row
}

export function upsertSeller(input: { payTo: string; label?: string | null; topUpUsd?: number; balanceUsd?: number; feeBps?: number | null; active?: boolean }): Seller {
  const current = getSeller(input.payTo)
  const now = new Date().toISOString()
  const balanceMicros = input.balanceUsd === undefined
    ? (current?.balanceMicros ?? 0) + dollarsToMicros(input.topUpUsd ?? 0)
    : dollarsToMicros(input.balanceUsd)

  if (current) {
    db.prepare(`
      UPDATE sellers
      SET label = ?, balance_micros = ?, fee_bps = ?, active = ?, updated_at = ?
      WHERE pay_to = ?
    `).run(
      input.label ?? current.label,
      balanceMicros,
      input.feeBps ?? current.feeBps,
      input.active === undefined ? current.active : Number(input.active),
      now,
      input.payTo,
    )
  } else {
    db.prepare(`
      INSERT INTO sellers (pay_to, label, balance_micros, fee_bps, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.payTo,
      input.label ?? null,
      balanceMicros,
      input.feeBps ?? null,
      input.active === undefined ? 1 : Number(input.active),
      now,
      now,
    )
  }

  return getSeller(input.payTo)!
}

export function requireSellerCanPayFee(payTo: string, amountMicros: number, defaultFeeBps: number): { seller: Seller; feeMicros: number } {
  const seller = getSeller(payTo)
  if (!seller || !seller.active) throw new Error('Seller is not enabled on this facilitator')
  const feeBps = seller.feeBps ?? defaultFeeBps
  const feeMicros = Math.ceil(amountMicros * feeBps / 10_000)
  if (seller.balanceMicros < feeMicros) throw new Error('Seller prepaid facilitator balance is too low')
  return { seller, feeMicros }
}

export function recordSettlement(input: { payTo: string; signature: string; amountMicros: number; feeMicros: number }) {
  const now = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      UPDATE sellers
      SET balance_micros = balance_micros - ?, updated_at = ?
      WHERE pay_to = ?
    `).run(input.feeMicros, now, input.payTo)
    db.prepare(`
      INSERT INTO settlements (id, pay_to, transaction_signature, amount_micros, fee_micros, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), input.payTo, input.signature, input.amountMicros, input.feeMicros, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function listSellers() {
  return db.prepare(`
    SELECT pay_to as payTo, label, balance_micros as balanceMicros, fee_bps as feeBps, active
    FROM sellers
    ORDER BY updated_at DESC
  `).all()
}

export function getMetrics() {
  const settled = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_micros), 0) as volumeMicros
    FROM settlements
  `).get() as { count: number; volumeMicros: number }
  const sellers = db.prepare(`SELECT COUNT(*) as count FROM sellers WHERE active = 1`).get() as { count: number }
  return {
    settledCount: settled.count,
    settledVolumeUsd: microsToDollars(settled.volumeMicros),
    sellerCount: sellers.count,
  }
}
