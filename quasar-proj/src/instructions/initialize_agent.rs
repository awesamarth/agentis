use quasar_lang::prelude::*;

use crate::state::{Agent, AgentInner, Policy, PolicyInner, SpendCounter, SpendCounterInner};

#[derive(Accounts)]
pub struct InitializeAgent {
    #[account(mut)]
    pub owner: Signer,
    /// CHECK: Agentis uses the same Privy wallet as owner and agent signer in server-managed mode.
    #[account(dup)]
    pub agent_wallet: UncheckedAccount,
    #[account(mut, init, payer = owner, seeds = Agent::seeds(owner, agent_wallet), bump)]
    pub agent: Account<Agent>,
    #[account(mut, init, payer = owner, seeds = Policy::seeds(agent), bump)]
    pub policy: Account<Policy>,
    #[account(mut, init, payer = owner, seeds = SpendCounter::seeds(agent), bump)]
    pub spend_counter: Account<SpendCounter>,
    pub system_program: Program<System>,
}

impl InitializeAgent {
    #[inline(always)]
    pub fn initialize_agent(&mut self, bumps: &InitializeAgentBumps) -> Result<(), ProgramError> {
        self.agent.set_inner(AgentInner {
            owner: *self.owner.address(),
            agent_wallet: *self.agent_wallet.address(),
            policy: *self.policy.address(),
            spend_counter: *self.spend_counter.address(),
            bump: bumps.agent,
        });

        self.policy.set_inner(PolicyInner {
            agent: *self.agent.address(),
            owner: *self.owner.address(),
            kill_switch: false,
            max_per_tx_micro_usd: 0,
            hourly_limit_micro_usd: 0,
            daily_limit_micro_usd: 0,
            monthly_limit_micro_usd: 0,
            max_budget_micro_usd: 0,
            bump: bumps.policy,
        });

        self.spend_counter.set_inner(SpendCounterInner {
            agent: *self.agent.address(),
            hour_window: 0,
            day_window: 0,
            month_window: 0,
            hour_spent_micro_usd: 0,
            day_spent_micro_usd: 0,
            month_spent_micro_usd: 0,
            total_spent_micro_usd: 0,
            bump: bumps.spend_counter,
        });

        Ok(())
    }
}
