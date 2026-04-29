[kora]
rate_limit = 100

[kora.auth]
api_key = "{{KORA_API_KEY}}"

[kora.cache]
enabled = false
default_ttl = 300
account_ttl = 60

[kora.enabled_methods]
liveness = true
estimate_transaction_fee = false
get_supported_tokens = true
sign_transaction = true
sign_and_send_transaction = true
transfer_transaction = false
get_blockhash = true
get_config = true
get_payer_signer = true
get_version = true

[validation]
max_allowed_lamports = 1000000
max_signatures = 10
price_source = "Mock"
allow_durable_transactions = false
allowed_programs = [
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "ComputeBudget111111111111111111111111111111",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
]
allowed_tokens = [
  "{{ACCEPTED_MINT}}"
]
allowed_spl_paid_tokens = [
  "{{ACCEPTED_MINT}}"
]
disallowed_accounts = []

[validation.fee_payer_policy]

[validation.fee_payer_policy.system]
allow_transfer = false
allow_assign = false
allow_create_account = false
allow_allocate = false

[validation.fee_payer_policy.system.nonce]
allow_initialize = false
allow_advance = false
allow_authorize = false
allow_withdraw = false

[validation.fee_payer_policy.spl_token]
allow_transfer = false
allow_burn = false
allow_close_account = false
allow_approve = false
allow_revoke = false
allow_set_authority = false
allow_mint_to = false
allow_initialize_mint = false
allow_initialize_account = false
allow_initialize_multisig = false
allow_freeze_account = false
allow_thaw_account = false

[validation.fee_payer_policy.token_2022]
allow_transfer = false
allow_burn = false
allow_close_account = false
allow_approve = false
allow_revoke = false
allow_set_authority = false
allow_mint_to = false
allow_initialize_mint = false
allow_initialize_account = false
allow_initialize_multisig = false
allow_freeze_account = false
allow_thaw_account = false

[validation.fee_payer_policy.alt]
allow_create = false
allow_extend = false
allow_freeze = false
allow_deactivate = false
allow_close = false

[validation.price]
type = "free"

[kora.usage_limit]
enabled = false
cache_url = "redis://localhost:6379"
max_transactions = 1000
fallback_if_unavailable = false

[kora.bundle]
enabled = false
