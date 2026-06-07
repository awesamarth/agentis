# backend

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## OAuth And Remote MCP

Set these values in production:

```sh
PUBLIC_API_URL=https://api.agentis.systems
DASHBOARD_URL=https://agentis.systems
MCP_INTROSPECTION_SECRET=<shared-random-secret>
```

`MCP_INTROSPECTION_SECRET` must match the Cloudflare Worker secret. Local
development falls back to `agentis-local-mcp-secret`.
