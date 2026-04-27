use quasar_lang::prelude::*;

#[error_code]
pub enum AgentisError {
    Unauthorized,
    KillSwitchActive,
    MaxPerTxExceeded,
    HourlyLimitExceeded,
    DailyLimitExceeded,
    MonthlyLimitExceeded,
    TotalBudgetExceeded,
    ArithmeticOverflow,
}
