use quasar_lang::prelude::*;

use crate::state::{Agent, Policy};

#[derive(Accounts)]
pub struct UpdatePolicy {
    pub owner: Signer,
    /// CHECK: Agentis uses the same Privy wallet as owner and agent signer in server-managed mode.
    #[account(dup)]
    pub agent_wallet: UncheckedAccount,
    #[account(has_one = owner, has_one = agent_wallet, seeds = Agent::seeds(owner, agent_wallet), bump = agent.bump)]
    pub agent: Account<Agent>,
    #[account(mut, has_one = agent, has_one = owner, seeds = Policy::seeds(agent), bump = policy.bump)]
    pub policy: Account<Policy>,
}

impl UpdatePolicy {
    #[inline(always)]
    pub fn update_policy(
        &mut self,
        kill_switch: bool,
        max_per_tx_micro_usd: u64,
        hourly_limit_micro_usd: u64,
        daily_limit_micro_usd: u64,
        monthly_limit_micro_usd: u64,
        max_budget_micro_usd: u64,
    ) -> Result<(), ProgramError> {
        self.policy.kill_switch = PodBool::from(kill_switch);
        self.policy.max_per_tx_micro_usd = PodU64::from(max_per_tx_micro_usd);
        self.policy.hourly_limit_micro_usd = PodU64::from(hourly_limit_micro_usd);
        self.policy.daily_limit_micro_usd = PodU64::from(daily_limit_micro_usd);
        self.policy.monthly_limit_micro_usd = PodU64::from(monthly_limit_micro_usd);
        self.policy.max_budget_micro_usd = PodU64::from(max_budget_micro_usd);

        Ok(())
    }
}
