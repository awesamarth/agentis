import { Keypair, PublicKey } from "@solana/web3.js";
import { address, type Address } from "@solana/kit";
import { QuasarProjClient, PROGRAM_ADDRESS } from "../target/client/typescript/quasar_proj/kit.js";
import { readFile } from "node:fs/promises";
import { describe, it, run } from "mocha";
import { assert } from "chai";
import { QuasarSvm, createKeyedSystemAccount } from "@blueshift-gg/quasar-svm/kit";

const QuasarProjProgram = new QuasarProjClient();

const MICROS_PER_USD = 1_000_000n;
const DAY_1 = 1_900_000_000n;

function deriveAgent(owner: Address, agentWallet: Address): Address {
  return address(PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), new PublicKey(owner).toBuffer(), new PublicKey(agentWallet).toBuffer()],
    new PublicKey(PROGRAM_ADDRESS),
  )[0].toBase58());
}

function derivePolicy(agent: Address): Address {
  return address(PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), new PublicKey(agent).toBuffer()],
    new PublicKey(PROGRAM_ADDRESS),
  )[0].toBase58());
}

function deriveSpendCounter(agent: Address): Address {
  return address(PublicKey.findProgramAddressSync(
    [Buffer.from("spend"), new PublicKey(agent).toBuffer()],
    new PublicKey(PROGRAM_ADDRESS),
  )[0].toBase58());
}

function randomAddress(): Address {
  return address(Keypair.generate().publicKey.toBase58());
}

function createFixture(options: { sharedAuthority?: boolean } = {}) {
  const agentWallet = randomAddress();
  const owner = options.sharedAuthority ? agentWallet : randomAddress();
  const agent = deriveAgent(owner, agentWallet);
  const policy = derivePolicy(agent);
  const spendCounter = deriveSpendCounter(agent);
  return { owner, agentWallet, agent, policy, spendCounter };
}

function initAccounts(fixture: ReturnType<typeof createFixture>) {
  return [
    createKeyedSystemAccount(fixture.owner, 10_000_000_000n),
    createKeyedSystemAccount(fixture.agentWallet, 1_000_000_000n),
    createKeyedSystemAccount(fixture.agent, 0n),
    createKeyedSystemAccount(fixture.policy, 0n),
    createKeyedSystemAccount(fixture.spendCounter, 0n),
  ];
}

function initialize(fixture: ReturnType<typeof createFixture>) {
  return QuasarProjProgram.createInitializeAgentInstruction(fixture);
}

function updatePolicy(
  fixture: ReturnType<typeof createFixture>,
  overrides: Partial<{
    owner: Address;
    killSwitch: boolean;
    maxPerTxMicroUsd: bigint;
    hourlyLimitMicroUsd: bigint;
    dailyLimitMicroUsd: bigint;
    monthlyLimitMicroUsd: bigint;
    maxBudgetMicroUsd: bigint;
  }> = {},
) {
  return QuasarProjProgram.createUpdatePolicyInstruction({
    ...fixture,
    owner: overrides.owner ?? fixture.owner,
    killSwitch: overrides.killSwitch ?? false,
    maxPerTxMicroUsd: overrides.maxPerTxMicroUsd ?? 0n,
    hourlyLimitMicroUsd: overrides.hourlyLimitMicroUsd ?? 0n,
    dailyLimitMicroUsd: overrides.dailyLimitMicroUsd ?? 0n,
    monthlyLimitMicroUsd: overrides.monthlyLimitMicroUsd ?? 0n,
    maxBudgetMicroUsd: overrides.maxBudgetMicroUsd ?? 0n,
  });
}

function checkSpend(
  fixture: ReturnType<typeof createFixture>,
  amountMicroUsd: bigint,
  unixTimestamp = DAY_1,
) {
  return QuasarProjProgram.createCheckAndRecordSpendInstruction({
    ...fixture,
    amountMicroUsd,
    unixTimestamp,
  });
}

describe("QuasarProj Program", async () => {
  const programBytes = await readFile("target/deploy/quasar_proj.so");

  function createVm() {
    const vm = new QuasarSvm();
    vm.addProgram(PROGRAM_ADDRESS, programBytes);
    return vm;
  }

  it("initializes an agent registry, policy, and spend counter", async () => {
    const vm = createVm();
    const fixture = createFixture();

    const result = vm.processInstruction(initialize(fixture), initAccounts(fixture));

    assert.isTrue(result.status.ok, `initialize failed:\n${result.logs.join("\n")}`);
    assert.exists(result.account(fixture.agent));
    assert.exists(result.account(fixture.policy));
    assert.exists(result.account(fixture.spendCounter));
  });

  it("supports server-managed agents where owner and agent signer are the same wallet", async () => {
    const vm = createVm();
    const fixture = createFixture({ sharedAuthority: true });

    const initResult = vm.processInstruction(initialize(fixture), initAccounts(fixture));
    assert.isTrue(initResult.status.ok, `initialize failed:\n${initResult.logs.join("\n")}`);

    const updateResult = vm.processInstruction(updatePolicy(fixture, { maxPerTxMicroUsd: 5n * MICROS_PER_USD }), initResult.accounts);
    assert.isTrue(updateResult.status.ok, `update failed:\n${updateResult.logs.join("\n")}`);

    const spendResult = vm.processInstruction(checkSpend(fixture, 1n * MICROS_PER_USD), updateResult.accounts);
    assert.isTrue(spendResult.status.ok, `spend failed:\n${spendResult.logs.join("\n")}`);
  });

  it("lets the owner update policy", async () => {
    const vm = createVm();
    const fixture = createFixture();

    const initResult = vm.processInstruction(initialize(fixture), initAccounts(fixture));
    assert.isTrue(initResult.status.ok, `initialize failed:\n${initResult.logs.join("\n")}`);

    const result = vm.processInstruction(updatePolicy(fixture, { maxPerTxMicroUsd: 10n * MICROS_PER_USD }), initResult.accounts);

    assert.isTrue(result.status.ok, `update failed:\n${result.logs.join("\n")}`);
  });

  it("rejects policy updates from a non-owner", async () => {
    const vm = createVm();
    const fixture = createFixture();
    const attacker = randomAddress();

    const initResult = vm.processInstruction(initialize(fixture), [
      ...initAccounts(fixture),
      createKeyedSystemAccount(attacker, 1_000_000_000n),
    ]);
    assert.isTrue(initResult.status.ok, `initialize failed:\n${initResult.logs.join("\n")}`);

    const result = vm.processInstruction(updatePolicy(fixture, { owner: attacker, maxPerTxMicroUsd: 1n }), initResult.accounts);

    assert.isFalse(result.status.ok, "non-owner policy update unexpectedly succeeded");
  });

  it("blocks spends when the kill switch is active", async () => {
    const vm = createVm();
    const fixture = createFixture();

    const initResult = vm.processInstruction(initialize(fixture), initAccounts(fixture));
    assert.isTrue(initResult.status.ok, `initialize failed:\n${initResult.logs.join("\n")}`);
    const updateResult = vm.processInstruction(updatePolicy(fixture, { killSwitch: true }), initResult.accounts);
    assert.isTrue(updateResult.status.ok, `update failed:\n${updateResult.logs.join("\n")}`);

    const result = vm.processInstruction(checkSpend(fixture, 1n * MICROS_PER_USD), updateResult.accounts);

    assert.isFalse(result.status.ok, "kill switch spend unexpectedly succeeded");
  });

  it("enforces max-per-transaction spend", async () => {
    const vm = createVm();
    const fixture = createFixture();

    const initResult = vm.processInstruction(initialize(fixture), initAccounts(fixture));
    assert.isTrue(initResult.status.ok, `initialize failed:\n${initResult.logs.join("\n")}`);
    const updateResult = vm.processInstruction(updatePolicy(fixture, { maxPerTxMicroUsd: 5n * MICROS_PER_USD }), initResult.accounts);
    assert.isTrue(updateResult.status.ok, `update failed:\n${updateResult.logs.join("\n")}`);

    const allowed = vm.processInstruction(checkSpend(fixture, 5n * MICROS_PER_USD), updateResult.accounts);
    assert.isTrue(allowed.status.ok, `allowed spend failed:\n${allowed.logs.join("\n")}`);

    const blocked = vm.processInstruction(checkSpend(fixture, 6n * MICROS_PER_USD), allowed.accounts);
    assert.isFalse(blocked.status.ok, "oversized spend unexpectedly succeeded");
  });

  it("rolls daily spend counters and blocks over-limit usage", async () => {
    const vm = createVm();
    const fixture = createFixture();

    const initResult = vm.processInstruction(initialize(fixture), initAccounts(fixture));
    assert.isTrue(initResult.status.ok, `initialize failed:\n${initResult.logs.join("\n")}`);
    const updateResult = vm.processInstruction(updatePolicy(fixture, { dailyLimitMicroUsd: 10n * MICROS_PER_USD }), initResult.accounts);
    assert.isTrue(updateResult.status.ok, `update failed:\n${updateResult.logs.join("\n")}`);

    const first = vm.processInstruction(checkSpend(fixture, 6n * MICROS_PER_USD), updateResult.accounts);
    assert.isTrue(first.status.ok, `first spend failed:\n${first.logs.join("\n")}`);

    const blocked = vm.processInstruction(checkSpend(fixture, 5n * MICROS_PER_USD), first.accounts);
    assert.isFalse(blocked.status.ok, "same-day over-limit spend unexpectedly succeeded");

    const nextDay = vm.processInstruction(checkSpend(fixture, 5n * MICROS_PER_USD, DAY_1 + 86_400n), first.accounts);
    assert.isTrue(nextDay.status.ok, `next-day spend failed:\n${nextDay.logs.join("\n")}`);
  });

  it("enforces lifetime budget cap", async () => {
    const vm = createVm();
    const fixture = createFixture();

    const initResult = vm.processInstruction(initialize(fixture), initAccounts(fixture));
    assert.isTrue(initResult.status.ok, `initialize failed:\n${initResult.logs.join("\n")}`);
    const updateResult = vm.processInstruction(updatePolicy(fixture, { maxBudgetMicroUsd: 10n * MICROS_PER_USD }), initResult.accounts);
    assert.isTrue(updateResult.status.ok, `update failed:\n${updateResult.logs.join("\n")}`);

    const first = vm.processInstruction(checkSpend(fixture, 6n * MICROS_PER_USD), updateResult.accounts);
    assert.isTrue(first.status.ok, `first spend failed:\n${first.logs.join("\n")}`);

    const blocked = vm.processInstruction(checkSpend(fixture, 5n * MICROS_PER_USD, DAY_1 + 86_400n), first.accounts);
    assert.isFalse(blocked.status.ok, "over-budget lifetime spend unexpectedly succeeded");
  });

  run();
});
