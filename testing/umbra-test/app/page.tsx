"use client";

import { useRef, useState, useEffect } from "react";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import {
  createInMemorySigner,
  createSignerFromKeyPair,
  getUmbraClient,
  getUserRegistrationFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getClaimableUtxoScannerFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getUmbraRelayer,
} from "@umbra-privacy/sdk";
import {
  getCreateReceiverClaimableUtxoFromPublicBalanceProver,
  getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getUserRegistrationProver,
} from "@umbra-privacy/web-zk-prover";

const DEVNET_MINT = "So11111111111111111111111111111111111111112"; // wSOL

type Log = { msg: string; ok: boolean };

export default function Page() {
  // persistent state across steps
  const signerRef = useRef<Awaited<ReturnType<typeof createInMemorySigner>> | null>(null);
  const clientRef = useRef<Awaited<ReturnType<typeof getUmbraClient>> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receivedRef = useRef<any[]>([]);

  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("umbra_privkey");
    if (stored) {
      const bytes = new Uint8Array(JSON.parse(stored));
      createKeyPairSignerFromPrivateKeyBytes(bytes).then((kps) => {
        const signer = createSignerFromKeyPair(kps);
        signerRef.current = signer;
        setWalletAddress(signer.address);
      });
    }
  }, []);

  function addLog(msg: string, ok = true) {
    setLogs((p) => [...p, { msg, ok }]);
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

  // 1. Signer
  async function createSigner() {
    await step(async () => {
      const privKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      const kps = await createKeyPairSignerFromPrivateKeyBytes(privKeyBytes);
      const signer = createSignerFromKeyPair(kps);
      localStorage.setItem("umbra_privkey", JSON.stringify(Array.from(privKeyBytes)));
      signerRef.current = signer;
      setWalletAddress(signer.address);
      addLog(`Signer created: ${signer.address}`);
    });
  }

  // 2. Client
  async function createClient() {
    await step(async () => {
      const signer = signerRef.current!;
      const client = await getUmbraClient({
        signer,
        network: "devnet",
        rpcUrl: "https://api.devnet.solana.com",
        rpcSubscriptionsUrl: "wss://api.devnet.solana.com",
        indexerApiEndpoint: "https://utxo-indexer.api-devnet.umbraprivacy.com",
      });
      clientRef.current = client;
      addLog("Client ready (devnet)");
    });
  }

  // 3. Register
  async function register() {
    await step(async () => {
      const client = clientRef.current!;
      const registerFn = getUserRegistrationFunction(
        { client },
        { zkProver: getUserRegistrationProver() }
      );
      const sigs = await registerFn({ confidential: true, anonymous: true });
      addLog(`Registered — ${sigs.length} tx(s): ${sigs.join(", ")}`);
    });
  }

  // 4. Deposit
  async function deposit() {
    await step(async () => {
      const client = clientRef.current!;
      const depositFn = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({ client });
      const result = await depositFn(signerRef.current!.address, DEVNET_MINT, 1_000_000n);
      addLog(`Deposited — queue: ${result.queueSignature}, callback: ${result.callbackSignature}`);
    });
  }

  // 5. Withdraw
  async function withdraw() {
    await step(async () => {
      const client = clientRef.current!;
      const withdrawFn = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({ client });
      const result = await withdrawFn(signerRef.current!.address, DEVNET_MINT, 1_000_000n);
      addLog(`Withdrawn — queue: ${result.queueSignature}, callback: ${result.callbackSignature}`);
    });
  }

  // 6 + 7. Create UTXO
  async function createUtxo() {
    await step(async () => {
      const client = clientRef.current!;
      const utxoProver = getCreateReceiverClaimableUtxoFromPublicBalanceProver();
      const createFn = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
        { client },
        { zkProver: utxoProver }
      );
      const sigs = await createFn({
        destinationAddress: signerRef.current!.address,
        mint: DEVNET_MINT,
        amount: 500_000n,
      });
      addLog(`UTXO created — createProofAccount: ${sigs.createProofAccountSignature}, createUtxo: ${sigs.createUtxoSignature}`);
    });
  }

  // 8. Scan
  async function scanUtxos() {
    await step(async () => {
      const client = clientRef.current!;
      const scanFn = getClaimableUtxoScannerFunction({ client });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (scanFn as any)(0n, 0n);
      const { received, selfBurnable, publicSelfBurnable, publicReceived } = result;
      receivedRef.current = publicReceived;
      addLog(`Scanned — received: ${received.length}, selfBurnable: ${selfBurnable.length}, publicSelfBurnable: ${publicSelfBurnable.length}, publicReceived: ${publicReceived.length}`);
    });
  }

  // 9. Claim
  async function claimUtxo() {
    await step(async () => {
      const client = clientRef.current!;
      const received = receivedRef.current;
      console.log("UTXOs to claim:", received.length, received[0]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log("fetchBatchMerkleProof:", typeof (client as any).fetchBatchMerkleProof);
      if (received.length === 0) throw new Error("No UTXOs to claim — scan first");
      const claimProver = getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver();
      const relayer = getUmbraRelayer({
        apiEndpoint: "https://relayer.api-devnet.umbraprivacy.com",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimFn = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
        { client },
        { zkProver: claimProver, relayer, fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof }
      );
      const result = await claimFn([received[0]]);
      console.log("claim result:", result);
      const batches = result.batches;
      const entries = batches instanceof Map ? [...batches.entries()] : Object.entries(batches);
      addLog(`Claimed: ${entries.length} batch(es) — ${entries.map(([k, v]) => `batch ${k}: ${JSON.stringify(v)}`).join(", ")}`);
    });
  }

  const buttons = [
    { label: "1. Create Signer", fn: createSigner },
    { label: "2. Create Client", fn: createClient },
    { label: "3. Register", fn: register },
    { label: "4. Deposit 1 wSOL", fn: deposit },
    { label: "5. Withdraw 1 wSOL", fn: withdraw },
    { label: "6. Create UTXO", fn: createUtxo },
    { label: "7. Scan UTXOs", fn: scanUtxos },
    { label: "8. Claim UTXO", fn: claimUtxo },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Umbra Devnet Demo</h1>
          <p className="text-zinc-500 text-xs mt-1">State persists across steps. Run in order.</p>
          {walletAddress && (
            <p className="text-zinc-400 text-xs mt-2 break-all">
              <span className="text-zinc-600">wallet: </span>{walletAddress}
              <span className="text-zinc-600 ml-2">(persisted in localStorage)</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {buttons.map(({ label, fn }) => (
            <button
              key={label}
              onClick={fn}
              disabled={busy}
              className="px-3 py-2 text-xs rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
            >
              {label}
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
