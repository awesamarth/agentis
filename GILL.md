Create a Solana client
Create a client connection to the Solana blockchain to perform Solana RPC requests.

Setting up a client connection to the Solana blockchain is a very important part of your application. This client connection is how your application will be sending and receiving data from the Solana JSON RPC layer, including fetching accounts and sending transactions.

Gill considers the "Solana client" to be (at a minimum) the following pieces:

rpc - used to interact with the your Solana JSON RPC provider (typically via HTTP)
rpcSubscriptions - used to interact with the Solana RPC over websockets
sendAndConfirmTransaction - used to send and confirm a Solana transaction over the RPC connections
If you are familiar with the Connection class from the older @solana/web3.js library, gill's createSolanaClient is similar. But more bare-bones and lightweight.

Most client applications will need to initialize the above functionality in their codebase. Within gill, there are two primary ways to create a Solana client:

using the createSolanaClient() function (recommended in order to reduce application boilerplate)
manually initialize them all individually
Create a Solana RPC connection
Create the Solana client connections (i.e. rpc and rpcSubscriptions) from any RPC URL or standard Solana network moniker (i.e. devnet, localnet, mainnet etc) using the createSolanaClient() function.


import { createSolanaClient } from "gill";
const { rpc, rpcSubscriptions, sendAndConfirmTransaction } = createSolanaClient({
  urlOrMoniker: "mainnet",
});
Using the Solana moniker will connect to the public RPC endpoints. These are subject to rate limits and should not be used in production applications. Applications should find their own RPC provider and use the URL provided by them.

Solana client for localnet
Developers can also connect to a local test validator (like solana-test-validator) running on your computer.

To create a Solana client for your local test validator:


import { createSolanaClient } from "gill";
const { rpc, rpcSubscriptions, sendAndConfirmTransaction } = createSolanaClient({
  urlOrMoniker: "localnet",
});
The urlOrMoniker value of localnet will utilize the default test validator address and port of http://127.0.0.1:8899. If you need to connect to a different address/port, then simply pass in its entire URL. See custom RPC URL below.

Solana client for a custom RPC URL
To create an RPC client for an custom RPC provider or service:


import { createSolanaClient } from "gill";
const { rpc, rpcSubscriptions, sendAndConfirmTransaction } = createSolanaClient({
  urlOrMoniker: "https://private-solana-rpc-provider.com",
});
Making Solana RPC calls
After you have a Solana rpc connection, you can make all the JSON RPC method calls directly off of it. Most commonly to get the latest blockhash or fetching a specific account.


import { createSolanaClient } from "gill";
const { rpc } = createSolanaClient({ urlOrMoniker: "devnet" });
// get slot
const slot = await rpc.getSlot().send();
// get the latest blockhash
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
The rpc client requires you to call .send() on the RPC method in order to actually send the request to your RPC provider and get a response.

Destructure and renaming response values
Many of the Solana RPC responses will return a generic value attribute containing the typed response payload. It is a common practice to destructure this generic value into a more aptly named variable, such as latestBlockhash (as demonstrated in the example below).

Get the latest blockhash
On Solana, the latest blockhash is uses as a sort of "recent timestamp" check within the transaction.

To get the latest blockhash from your RPC:


import { createSolanaClient } from "gill";
const { rpc } = createSolanaClient({ urlOrMoniker: "devnet" });
// get the latest blockhash
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
Pro tip

Only request this value just before you are going to use it your code. Since latest blockhashes are only valid for approximately 1-2 minutes, requesting it at the latest possible time in your codebase can help improve transaction landing rates.

Fetch an account
All the data stored on the Solana blockchain is stored in accounts, including native SOL balance, tokens, and programs. The structure of an account's data and associated metadata information is called an AccountInfo.

To get an account's AccountInfo from your RPC:


import { createSolanaClient, address } from "gill";
const { rpc } = createSolanaClient({ urlOrMoniker: "devnet" });
const accountToFetch = address("nick6zJc6HpW3kfBm4xS2dmbuVRyb5F3AnUvj5ymzR5");
// get the `AccountInfo` with (default) `base58` encoding for the data
const { value: accountInfo } = await rpc.getAccountInfo(accountToFetch).send();
By default, the getAccountInfo RPC method will utilize the base58 encoding for the data within the account itself. This is fine for accounts with small amounts of data stored in them, but fetching accounts with larger amounts of data will result in an error with the base58 encoding.

It is strongly recommended to utilize base64 encoding when fetching accounts from the blockchain to avoid the common errors when fetching with the default base58 encoding.


import { createSolanaClient, address } from "gill";
const { rpc } = createSolanaClient({ urlOrMoniker: "devnet" });
const accountToFetch = address("nick6zJc6HpW3kfBm4xS2dmbuVRyb5F3AnUvj5ymzR5");
// get the `AccountInfo` with `base64` encoding for the data
const { value: accountInfo } = await rpc
  .getAccountInfo(accountToFetch, { encoding: "base64" })
  .send();
An even better solution is to utilize the fetchEncodedAccount() function to fetch accounts, which always utilizes the base64 encoding.


import { createSolanaClient, address, fetchEncodedAccount } from "gill";
const { rpc } = createSolanaClient({ urlOrMoniker: "devnet" });
const accountToFetch = address("nick6zJc6HpW3kfBm4xS2dmbuVRyb5F3AnUvj5ymzR5");
const account = await fetchEncodedAccount(rpc, accountToFetch);
These encoded accounts can then easily be decoded by the correct Decoder for the structure of the account's data.

Using AbortControllers
You can also include custom configuration settings on your RPC calls, like using a JavaScript AbortController, by passing them into send():


import { createSolanaClient } from "gill";
const { rpc } = createSolanaClient({ urlOrMoniker: "devnet" });
// Create a new AbortController.
const abortController = new AbortController();
// Abort the request when the user navigates away from the current page.
function onUserNavigateAway() {
  abortController.abort();
}
// The request will be aborted if and only if the user navigates away from the page.
const slot = await rpc.getSlot().send({ abortSignal: abortController.signal });

Generate a signer
Create a new keypair signer that can perform Solana signing operations.

For most typical Solana transaction signing operations, you will be utilizing a TransactionSigner. This object type is capable of being "attached" to instructions and transaction to perform signing operations.

The most common of which is a KeyPairSigner, which is able to be passed around to the various functions within gill to satisfies any TransactionSigner type requirements, like when building instructions or creating transactions.

Unless otherwise specifically noted in the gill documentation, the term "signer" refers to TransactionSigner and usually a KeyPairSigner.

Generating a keypair signer
For various Solana development tasks, you may need to generate a new signer. Including when creating a new account, generating reference keys for transactions, or creating tokens.

The generateKeyPairSigner() function allows you to generate a new random KeyPairSigner (which satisfies the TransactionSigner type) to perform signing operations.


import { generateKeyPairSigner, type KeyPairSigner } from "gill";
const signer = await generateKeyPairSigner();
Non-extractable by default
Under the hood, a KeyPairSigner utilize the Web Crypto APIs to improve security.

These signers are non-extractable by default; meaning there is no way to get the secret key material out of the instance. This is a more secure practice and highly recommended to be used over extractable keypairs, unless you REALLY need to be able to save the keypair for some reason.

Generating extractable keypairs and signers
Extractable keypairs are less secure and should not be used unless you REALLY need to save a keypair for some reason. Since there are a few useful cases for saving these keypairs, gill contains a separate explicit function to generate these extractable keypairs.

To generate a random, extractable KeyPairSigner:


import { generateExtractableKeyPairSigner } from "gill";
const signer = await generateExtractableKeyPairSigner();
WARNING

Using extractable keypairs are inherently less-secure, since they allow the secret key material to be extracted. Obviously. As such, they should only be used sparingly and ONLY when you have an explicit reason you need extract the key material (like if you are going to save the key to a file or environment variable).

Create a signer without the secret key
If your Solana application allows users to sign transaction's by way of connecting their wallet (e.g. Backpack, Phantom, Solflare, etc) to your app, you will not have access to their secret key material.

You will need to create a "noop signer" in order to satisfy the TransactionSigner type, such as the createTransaction() functions's feePayer:


import { createNoopSigner, type Address, createTransaction } from "gill";
const wallet = "nick6zJc6HpW3kfBm4xS2dmbuVRyb5F3AnUvj5ymzR5" as Address;
const signer = createNoopSigner(wallet);
const transaction = createTransaction({
  version: "legacy",
  feePayer: signer,
  instructions: [],
});