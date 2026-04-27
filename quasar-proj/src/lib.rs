#![cfg_attr(not(test), no_std)]

use quasar_lang::prelude::*;

mod errors;
mod instructions;
mod state;
use instructions::*;

declare_id!("EGZKucpjMmAHvqUP3hLSBCccs4uAQyCAvQ8ikSNCryhM");

#[program]
mod quasar_proj {
    use super::*;

    #[instruction(discriminator = 10)]
    pub fn initialize_agent(ctx: Ctx<InitializeAgent>) -> Result<(), ProgramError> {
        ctx.accounts.initialize_agent(&ctx.bumps)
    }

    #[instruction(discriminator = 11)]
    pub fn update_policy(
        ctx: Ctx<UpdatePolicy>,
        kill_switch: bool,
        max_per_tx_micro_usd: u64,
        hourly_limit_micro_usd: u64,
        daily_limit_micro_usd: u64,
        monthly_limit_micro_usd: u64,
        max_budget_micro_usd: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.update_policy(
            kill_switch,
            max_per_tx_micro_usd,
            hourly_limit_micro_usd,
            daily_limit_micro_usd,
            monthly_limit_micro_usd,
            max_budget_micro_usd,
        )
    }

    #[instruction(discriminator = 12)]
    pub fn check_and_record_spend(
        ctx: Ctx<CheckAndRecordSpend>,
        amount_micro_usd: u64,
        unix_timestamp: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .check_and_record_spend(amount_micro_usd, unix_timestamp)
    }
}
