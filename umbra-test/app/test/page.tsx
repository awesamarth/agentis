"use client";

import { useEffect, useState } from "react";

const BACKEND = "http://localhost:3001";

type Log = { msg: string; ok: boolean };

export default function TestPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [confidential, setConfidential] = useState(true);
  const [anonymous, setAnonymous] = useState(true);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setApiKey(localStorage.getItem("umbra_test_apikey") ?? "");
  }, []);

  function addLog(msg: string, ok = true) {
    setLogs((p) => [...p, { msg, ok }]);
  }

  function saveApiKey() {
    localStorage.setItem("umbra_test_apikey", apiKey);
    addLog(`API key saved.`);
  }

  async function call(path: string, body?: object) {
    const res = await fetch(`${BACKEND}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  async function step(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e: unknown) {
      console.error(e);
      addLog(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    await step(async () => {
      const data = await call("/sdk/agent");
      setAgentName(data.name);
      setWalletAddress(data.walletAddress);
      addLog(`Connected — agent: ${data.name} | wallet: ${data.walletAddress}`);
    });
  }

  async function testRegister() {
    await step(async () => {
      addLog(
        `Registering Umbra user with server-side Privy wallet... confidential=${confidential} anonymous=${anonymous}`
      );
      const data = await call("/umbra/register", {
        confidential,
        anonymous,
      });
      setWalletAddress(data.walletAddress);
      addLog(
        `Registered wallet ${data.walletAddress} — ${data.signatures.length} tx(s): ${data.signatures.join(", ")}`
      );
    });
  }

  async function testDeposit() {
    await step(async () => {
      addLog("Depositing 1_000_000_000 wSOL lamports into encrypted balance...");
      const data = await call("/umbra/deposit", { amount: "1000000000" });
      addLog(`Deposited — queue: ${data.queueSignature}, callback: ${data.callbackSignature}`);
    });
  }

  async function testEncryptedBalance() {
    await step(async () => {
      const data = await call("/umbra/balance");
      if (data.state === "shared") {
        addLog(`Encrypted balance (${data.mint}) — shared: ${data.balance}`);
        return;
      }

      addLog(`Encrypted balance (${data.mint}) — state: ${data.state}`);
    });
  }

  async function testWithdraw() {
    await step(async () => {
      addLog("Withdrawing 1_000_000 wSOL lamports back to public balance...");
      const data = await call("/umbra/withdraw", { amount: "1000000" });
      addLog(`Withdrawn — queue: ${data.queueSignature}, callback: ${data.callbackSignature}`);
    });
  }

  async function testCreateUtxo() {
    await step(async () => {
      addLog("Creating receiver-claimable UTXO to self from public balance...");
      const data = await call("/umbra/create-utxo", { amount: "500000" });
      addLog(
        `UTXO created — createProofAccount: ${data.createProofAccountSignature}, createUtxo: ${data.createUtxoSignature}`
      );
    });
  }

  async function testScan() {
    await step(async () => {
      const data = await call("/umbra/scan");
      addLog(
        `Scanned — received: ${data.counts.received}, selfBurnable: ${data.counts.selfBurnable}, publicSelfBurnable: ${data.counts.publicSelfBurnable}, publicReceived: ${data.counts.publicReceived}`
      );
    });
  }

  async function testClaimLatest() {
    await step(async () => {
      addLog("Claiming latest publicReceived UTXO into encrypted balance...");
      const data = await call("/umbra/claim-latest", {});
      console.log("claim-latest response:", data);
      if (data.alreadyClaimed) {
        addLog(
          `Already claimed / stale indexer entry — before: ${data.balanceBefore ?? "null"}, after: ${data.balanceAfter ?? "null"}, delta: ${data.balanceDelta}`,
          false
        );
        return;
      }

      addLog(
        `Claim result — success: ${String(data.success)}, batches: ${data.batches.length}, before: ${data.balanceBefore ?? "null"}, after: ${data.balanceAfter ?? "null"}, delta: ${data.balanceDelta}`,
        Boolean(data.success)
      );
    });
  }

  const buttons = [
    { label: "1. Test Connection", fn: testConnection },
    { label: "2. Register", fn: testRegister },
    { label: "3. Deposit", fn: testDeposit },
    { label: "4. Query Enc Balance", fn: testEncryptedBalance },
    { label: "5. Withdraw", fn: testWithdraw },
    { label: "6. Create UTXO", fn: testCreateUtxo },
    { label: "7. Scan", fn: testScan },
    { label: "8. Claim Latest", fn: testClaimLatest },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Umbra × Privy — Backend Test</h1>
          <p className="text-zinc-500 text-xs mt-1">
            Privy-backed Umbra flow test. Register, deposit, withdraw, create UTXO, scan, and claim.
          </p>
          {agentName && walletAddress && (
            <p className="text-zinc-400 text-xs mt-2 break-all">
              agent: {agentName}
              {"  "}wallet: {walletAddress}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="agt_live_xxx"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1 px-3 py-2 text-xs rounded bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
          />
          <button
            onClick={saveApiKey}
            className="px-3 py-2 text-xs rounded bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 transition-colors"
          >
            Save
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              className="accent-zinc-200"
            />
            confidential registration
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="accent-zinc-200"
            />
            anonymous registration
          </label>
          {buttons.map(({ label, fn }) => (
            <button
              key={label}
              onClick={fn}
              disabled={busy || !apiKey}
              className="px-3 py-2 text-xs rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
            >
              {busy ? "running..." : label}
            </button>
          ))}
        </div>

        {logs.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-1 text-xs max-h-96 overflow-y-auto">
            {logs.map((l, i) => (
              <div key={i} className={l.ok ? "text-green-400" : "text-red-400"}>
                {l.msg}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
