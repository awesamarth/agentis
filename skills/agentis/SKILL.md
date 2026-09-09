---
name: agentis
description: Request scoped Agentis financial operations and inspect approvals and receipts through the SDK, CLI or local MCP.
---

# Agentis rewrite

This checkout is a foundation preview, not the published prototype. Read `AGENTS.md` and run the local CLI's `--help` before assuming a capability exists.

- Use `AGENTIS_TOKEN` from the deployment's secret environment: a scoped `agt_exec_` grant, never the owner's credentials. Do not print credentials or pass them inline.
- SDK: `new AgentisClient({baseUrl, token})`; `operations.create(input, {idempotencyKey})`, `operations.get/list/wait`.
- CLI: `agentis operations create --file <request.json> --key <stable-task-id>`, `operations get <id>`, `operations wait <id>`, `capabilities`.
- Local MCP exposes request/get/list operations and capabilities. It cannot approve, change policy or mint credentials.
- Preserve the idempotency key across retries of the same task. Pending approval returns a URL for the human; never try to approve yourself. Unknown submission means reconcile, not create another payment.
- Amounts are atomic decimal strings; include explicit chain, asset and maximum fee. Current limits are native atomic units, not USD.
- Only configured local Anvil native transfers execute. Privy/mainnet execution and Jupiter/Umbra/Link/paid-fetch plugins are unavailable. Remote MCP is paused. Do not use old published commands as a fallback.
- Guest browser keys and local CLI files are trusted-device demos; never treat their software policy as independent custody enforcement.
