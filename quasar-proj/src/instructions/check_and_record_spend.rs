use quasar_lang::prelude::*;

use crate::errors::AgentisError;
use crate::state::{Agent, Policy, SpendCounter};

const SECONDS_PER_HOUR: u64 = 3_600;
const SECONDS_PER_DAY: u64 = 86_400;
const SECONDS_PER_MONTH: u64 = 2_592_000;

#[derive(Accounts)]
pub struct CheckAndRecordSpend {
    pub agent_wallet: Signer,
    #[account(has_one = agent_wallet, seeds = Agent::seeds(agent.owner, agent_wallet), bump = agent.bump)]
    pub agent: Account<Agent>,
    #[account(has_one = agent, seeds = Policy::seeds(agent), bump = policy.bump)]
    pub policy: Account<Policy>,
    #[account(mut, has_one = agent, seeds = SpendCounter::seeds(agent), bump = spend_counter.bump)]
    pub spend_counter: Account<SpendCounter>,
}

impl CheckAndRecordSpend {
    #[inline(always)]
    pub fn check_and_record_spend(
        &mut self,
        amount_micro_usd: u64,
        unix_timestamp: u64,
    ) -> Result<(), ProgramError> {
        require!(!self.policy.kill_switch.get(), AgentisError::KillSwitchActive);

        if self.policy.max_per_tx_micro_usd.get() > 0 {
            require!(
                amount_micro_usd <= self.policy.max_per_tx_micro_usd.get(),
                AgentisError::MaxPerTxExceeded
            );
        }

        let hour_window = unix_timestamp / SECONDS_PER_HOUR;
        let day_window = unix_timestamp / SECONDS_PER_DAY;
        let month_window = unix_timestamp / SECONDS_PER_MONTH;

        let hour_spent = next_spend(
            self.spend_counter.hour_window.get(),
            self.spend_counter.hour_spent_micro_usd.get(),
            hour_window,
            amount_micro_usd,
        )?;
        let day_spent = next_spend(
            self.spend_counter.day_window.get(),
            self.spend_counter.day_spent_micro_usd.get(),
            day_window,
            amount_micro_usd,
        )?;
        let month_spent = next_spend(
            self.spend_counter.month_window.get(),
            self.spend_counter.month_spent_micro_usd.get(),
            month_window,
            amount_micro_usd,
        )?;
        let total_spent = self
            .spend_counter
            .total_spent_micro_usd
            .get()
            .checked_add(amount_micro_usd)
            .ok_or(AgentisError::ArithmeticOverflow)?;

        enforce_limit(
            hour_spent,
            self.policy.hourly_limit_micro_usd.get(),
            AgentisError::HourlyLimitExceeded,
        )?;
        enforce_limit(
            day_spent,
            self.policy.daily_limit_micro_usd.get(),
            AgentisError::DailyLimitExceeded,
        )?;
        enforce_limit(
            month_spent,
            self.policy.monthly_limit_micro_usd.get(),
            AgentisError::MonthlyLimitExceeded,
        )?;
        enforce_limit(
            total_spent,
            self.policy.max_budget_micro_usd.get(),
            AgentisError::TotalBudgetExceeded,
        )?;

        self.spend_counter.hour_window = PodU64::from(hour_window);
        self.spend_counter.day_window = PodU64::from(day_window);
        self.spend_counter.month_window = PodU64::from(month_window);
        self.spend_counter.hour_spent_micro_usd = PodU64::from(hour_spent);
        self.spend_counter.day_spent_micro_usd = PodU64::from(day_spent);
        self.spend_counter.month_spent_micro_usd = PodU64::from(month_spent);
        self.spend_counter.total_spent_micro_usd = PodU64::from(total_spent);

        Ok(())
    }
}

#[inline(always)]
fn next_spend(
    current_window: u64,
    current_spent: u64,
    next_window: u64,
    amount_micro_usd: u64,
) -> Result<u64, ProgramError> {
    let base = if current_window == next_window {
        current_spent
    } else {
        0
    };

    base.checked_add(amount_micro_usd)
        .ok_or(AgentisError::ArithmeticOverflow.into())
}

#[inline(always)]
fn enforce_limit(
    spent_micro_usd: u64,
    limit_micro_usd: u64,
    error: AgentisError,
) -> Result<(), ProgramError> {
    if limit_micro_usd > 0 {
        require!(spent_micro_usd <= limit_micro_usd, error);
    }

    Ok(())
}
