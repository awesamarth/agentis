# SDK Testing

Two apps for end-to-end SDK testing.

## Setup

1. Start the Agentis backend: `cd apps/backend && bun dev`
2. Start the x402 test server: `cd sdk-testing/x402-server && bun dev`
3. Paste your agent API key into `sdk-testing/agent-app/.env`
4. Run the agent: `cd sdk-testing/agent-app && bun start`

## What it tests

- `GET /free` — no payment, SDK passes through
- `GET /paid-data` — costs 0.001 SOL, SDK handles 402 → sign → retry automatically
- `GET /premium-data` — costs 0.005 SOL, same flow
- Policy fetch at the end

Make sure the agent wallet has enough devnet SOL (airdrop if needed).
