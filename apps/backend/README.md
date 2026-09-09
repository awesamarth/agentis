# Agentis backend

Bun/Hono API and worker sharing transactional Postgres/Drizzle operations.

```sh
# Root: bun install && bun run build:packages
# Root: docker compose -p agentis-rewrite up -d --wait
# Configure private backend environment using .env.example, then:
bun run db:migrate
bun run index.ts
# Separate terminal:
bun run worker
```

`DATABASE_URL` is required; no JSON fallback or automatic startup migrations. Execution defaults disabled. Only explicit local Anvil mode executes; Privy is read-only auth/wallet verification for now.

See `../../docs/architecture.md` for API, approval security, limitations and local setup. Backend tests create isolated loopback-only databases: `bun run test:backend` from root.
