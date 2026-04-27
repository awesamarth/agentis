use quasar_lang::prelude::*;

#[account(discriminator = 1, set_inner)]
#[seeds(b"agent", owner: Address, agent_wallet: Address)]
pub struct Agent {
    pub owner: Address,
    pub agent_wallet: Address,
    pub policy: Address,
    pub spend_counter: Address,
    pub bump: u8,
}

#[account(discriminator = 2, set_inner)]
#[seeds(b"policy", agent: Address)]
pub struct Policy {
    pub agent: Address,
    pub owner: Address,
    pub kill_switch: bool,
    pub max_per_tx_micro_usd: u64,
    pub hourly_limit_micro_usd: u64,
    pub daily_limit_micro_usd: u64,
    pub monthly_limit_micro_usd: u64,
    pub max_budget_micro_usd: u64,
    pub bump: u8,
}

#[account(discriminator = 3, set_inner)]
#[seeds(b"spend", agent: Address)]
pub struct SpendCounter {
    pub agent: Address,
    pub hour_window: u64,
    pub day_window: u64,
    pub month_window: u64,
    pub hour_spent_micro_usd: u64,
    pub day_spent_micro_usd: u64,
    pub month_spent_micro_usd: u64,
    pub total_spent_micro_usd: u64,
    pub bump: u8,
}
