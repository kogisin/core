import { ContractTransactionResponse, TransactionResponse } from "ethers";
import hre, { ethers } from "hardhat";

import { log } from "./index";

type Transaction = TransactionResponse | ContractTransactionResponse;

export async function trace(name: string, tx: Transaction) {
  const receipt = await tx.wait();

  if (!receipt) {
    log.error("Failed to trace transaction: no receipt!");
    return;
  }

  const network = await tx.provider.getNetwork();
  const config = hre.config.networks[network.name];
  const blockGasLimit = "blockGasLimit" in config ? config.blockGasLimit : 30_000_000;
  const gasUsedPercent = (Number(receipt.gasUsed) / blockGasLimit) * 100;

  log.trace(name, {
    from: tx.from,
    to: tx.to ?? `New contract @ ${receipt.contractAddress}`,
    value: ethers.formatEther(tx.value),
    gasUsed: ethers.formatUnits(receipt.gasUsed, "gwei"),
    gasPrice: ethers.formatUnits(receipt.gasPrice, "gwei"),
    gasUsedPercent: gasUsedPercent.toFixed(2),
    gasLimit: blockGasLimit.toString(),
    nonce: tx.nonce,
    blockNumber: receipt.blockNumber,
    hash: receipt.hash,
    status: !!receipt.status,
  });
}
