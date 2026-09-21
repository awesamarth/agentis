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

`DATABASE_URL` is required; there is no JSON fallback or automatic startup migration. Execution defaults disabled. Configure explicit local Anvil mode for disposable local tests or Privy mode for hosted testnet execution.

See `../../docs/architecture.md` for API, approval security, limitations and local setup.
