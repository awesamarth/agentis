# Uniswap developer feedback — Agentis

Integrating Uniswap V3 into Agentis was straightforward and, overall, pretty smooth sailing. Direct on-chain quotes and swaps on Base Sepolia fit well with our agent wallets, owner approvals and spending budgets. We also confirmed a real ETH → USDC swap through the owner-approval flow.

## Tempo testnet support

The remaining blocker to our planned multichain integration was Tempo testnet availability. The Trading API rejected Tempo testnet chain `42431`; the supported Tempo network was chain `4217`. We kept the Uniswap integration on Base Sepolia rather than switching to mainnet. Adding Tempo testnet support would make it easier to develop and validate agent-payment flows safely.

## Feedback form

I have completed the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback).

[Integration code, contracts and verification details](docs/uniswap.md).
