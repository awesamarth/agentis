CREATE TABLE uniswap_targets (
 "walletId" uuid PRIMARY KEY REFERENCES wallets(id), "ownerId" text NOT NULL,
 "ethPercent" integer NOT NULL CHECK ("ethPercent" BETWEEN 0 AND 100)
);
