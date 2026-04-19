export class AgentisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentisError'
  }
}

export class KillSwitchError extends AgentisError {
  constructor() {
    super('Kill switch is active — agent payments disabled')
    this.name = 'KillSwitchError'
  }
}

export class PolicyError extends AgentisError {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyError'
  }
}

export class InsufficientFundsError extends AgentisError {
  constructor() {
    super('Insufficient funds in agent wallet')
    this.name = 'InsufficientFundsError'
  }
}

export class PaymentError extends AgentisError {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentError'
  }
}
