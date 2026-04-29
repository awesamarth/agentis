{
  "name": "{{NAME}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/facilitator.ts",
    "start": "tsx src/facilitator.ts",
    "typecheck": "tsc --noEmit",
    "kora": "RPC_URL=${SOLANA_RPC_URL:-https://api.devnet.solana.com} kora --config kora/kora.toml rpc start --signers-config kora/signers.toml --port ${KORA_PORT:-8080}"
  },
  "dependencies": {
    "@solana/kora": "^0.2.1",
    "@x402/core": "^2.10.0",
    "@x402/svm": "^2.10.0",
    "dotenv": "^17.2.3",
    "express": "^5.2.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^24.5.2",
    "tsx": "^4.21.0",
    "typescript": "^5.9.0"
  }
}
