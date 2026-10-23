/**
 * PayProof — Claim vs. Chain verification engine.
 *
 * Read-only. Reads Arc via public JSON-RPC. No wallet, no signing.
 */

import { createPublicClient, http, formatUnits, parseUnits, isAddress, isHex } from 'viem';
import { requireChain, getUsdc } from '@/onchain-facts';

/**
 * Arc's native USDC system emitter (EIP-7708). Arc emits exactly one Transfer log
 * from this address for every explicit USDC movement: native sends, ERC-20 transfer()
 * calls, mints and burns. Amounts are 18-decimal.
 * Source: https://docs.arc.io/arc/references/usdc-system-events
 *
 * Why only this emitter: a single ERC-20 transfer() also emits a 6-decimal log from the
 * USDC contract (0x3600…0000). Counting both would double every payment. We match on the
 * system emitter alone, so each movement is counted once.
 */
export const ARC_NATIVE_USDC_EMITTER = '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const ARC_MAINNET_CHAIN_ID = 5042;

export type VerificationOutcome = 'MATCH' | 'MISMATCH' | 'FAILED_OR_PENDING' | 'UNVERIFIABLE';

export interface FieldResult {
  label: string;
  claimed: string;
  actual: string;
  match: boolean | null; // null = not applicable
}

export interface VerificationResult {
  outcome: VerificationOutcome;
  txHash: string;
  network: string;
  chainId: number;
  fields: FieldResult[];
  explorerUrl: string;
  usdcContractAddress: string;
  timestamp: string;
  errorDetail?: string;
  blockNumber?: bigint;
  multipleTransfersDetected?: boolean;
  txStatus?: string; // on-chain execution status, shown as a fact, not compared
  blockTime?: number; // unix seconds, the time of the block the transaction is in
}

export interface VerifyInput {
  txHash: string;
  claimedAmount: string; // human-readable, e.g. "10.50"
  expectedRecipient: string;
  chainId?: number; // defaults to ARC_MAINNET_CHAIN_ID
  signal?: AbortSignal; // lets the caller cancel the check and its network requests
}

interface TransferEvent {
  from: string; // lowercase
  to: string; // lowercase
  amountRaw: bigint;
  decimals: number;
  logIndex: number;
}

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

// Extra endpoints from Arc's official RPC list, tried after the primary one.
const EXTRA_RPC_URLS: Record<number, string[]> = {
  5042: [
    'https://rpc.quicknode.mainnet.arc.io',
    'https://rpc.drpc.mainnet.arc.io',
    'https://rpc.blockdaemon.mainnet.arc.io',
  ],
};

function rpcUrlsFor(chainId: number): string[] {
  const chain = requireChain(chainId);
  return Array.from(new Set([...chain.rpcUrls, ...(EXTRA_RPC_URLS[chainId] ?? [])]));
}

function buildClient(chainId: number, url?: string, signal?: AbortSignal) {
  const chain = requireChain(chainId);
  return createPublicClient({
    transport: http(url ?? chain.rpcUrls[0], {
      timeout: 15_000,
      fetchOptions: signal ? { signal } : undefined,
    }),
    chain: {
      id: chain.chainId,
      name: chain.name,
      nativeCurrency: {
        name: chain.nativeCurrency.symbol,
        symbol: chain.nativeCurrency.symbol,
        decimals: chain.nativeCurrency.decimals,
      },
      rpcUrls: { default: { http: chain.rpcUrls as [string, ...string[]] } },
    },
  });
}

function topicToAddress(topic: string): string {
  return ('0x' + topic.slice(26)).toLowerCase();
}

/** viem throws TransactionReceiptNotFoundError when the RPC has no receipt. */
function isReceiptNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === 'TransactionReceiptNotFoundError';
}

function unverifiable(txHash: string, chainId: number, reason: string): VerificationResult {
  const chain = requireChain(chainId);
  const usdc = getUsdc(chainId);
  return {
    outcome: 'UNVERIFIABLE',
    txHash,
    network: chain.name,
    chainId,
    fields: [],
    explorerUrl: chain.explorerBase + '/tx/' + txHash,
    usdcContractAddress: usdc?.address ?? 'unknown',
    timestamp: new Date().toISOString(),
    errorDetail: reason,
  };
}

/**
 * Collect every USDC Transfer for this transaction, each counted once.
 * On Arc: system emitter only, 18 decimals.
 * On a chain without the system emitter: the ERC-20 contract, its own decimals.
 */
function collectTransfers(
  logs: readonly { address: string; topics: readonly string[]; data: string; logIndex: number | null }[],
  isArc: boolean,
  usdcAddress: string,
  usdcDecimals: number,
  nativeDecimals: number,
): TransferEvent[] {
  const emitter = (isArc ? ARC_NATIVE_USDC_EMITTER : usdcAddress).toLowerCase();
  const decimals = isArc ? nativeDecimals : usdcDecimals;
  const out: TransferEvent[] = [];

  for (const log of logs) {
    if (log.address.toLowerCase() !== emitter) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const fromTopic = log.topics[1];
    const toTopic = log.topics[2];
    if (!fromTopic || !toTopic) continue;

    out.push({
      from: topicToAddress(fromTopic),
      to: topicToAddress(toTopic),
      amountRaw: BigInt(log.data),
      decimals,
      logIndex: log.logIndex ?? -1,
    });
  }
  return out;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/** Read the time of a block, trying each endpoint in turn. Returns undefined if none answers. */
async function fetchBlockTime(chainId: number, blockNumber: bigint, signal?: AbortSignal): Promise<number | undefined> {
  for (const url of rpcUrlsFor(chainId)) {
    try {
      const block = await buildClient(chainId, url, signal).getBlock({ blockNumber });
      return Number(block.timestamp);
    } catch {
      // Try the next endpoint.
    }
  }
  return undefined;
}

export async function verifyPayment(input: VerifyInput): Promise<VerificationResult> {
  const chainId = input.chainId ?? ARC_MAINNET_CHAIN_ID;
  const { txHash, claimedAmount, expectedRecipient } = input;
  const signal = input.signal;

  // --- 1. Input validation ---
  if (!txHash || !isHex(txHash) || txHash.length !== 66) {
    return unverifiable(txHash, chainId, 'The transaction hash is not valid. It should start with 0x and be 66 characters long.');
  }
  if (!expectedRecipient || !isAddress(expectedRecipient)) {
    return unverifiable(txHash, chainId, 'The recipient address is not valid. It should start with 0x and be 42 characters long.');
  }

  const chain = requireChain(chainId);
  const usdc = getUsdc(chainId);
  if (!usdc) {
    return unverifiable(txHash, chainId, `USDC is not configured for chain ${chainId}.`);
  }

  const trimmedAmount = claimedAmount.trim();
  if (!AMOUNT_PATTERN.test(trimmedAmount) || Number(trimmedAmount) <= 0) {
    return unverifiable(txHash, chainId, 'The claimed amount must be a positive number, for example 10.50.');
  }
  const decimalPart = trimmedAmount.split('.')[1] ?? '';
  if (decimalPart.length > usdc.decimals) {
    return unverifiable(txHash, chainId, `The claimed amount has more than ${usdc.decimals} decimal places, which USDC does not support.`);
  }

  const isArc = chain.family === 'arc';
  const nativeDecimals = chain.nativeCurrency.decimals;
  // Exact comparison in base units, in the scale this chain's transfer logs use.
  const claimedRaw = parseUnits(trimmedAmount, isArc ? nativeDecimals : usdc.decimals);

  const client = buildClient(chainId, undefined, signal);

  // --- 2. Confirm the RPC is serving the chain we asked for ---
  try {
    const liveChainId = await client.getChainId();
    if (liveChainId !== chainId) {
      return unverifiable(txHash, chainId, `The RPC returned chain ID ${liveChainId}, but this check expects ${chainId}. Verification stopped.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return unverifiable(txHash, chainId, `Could not reach the network: ${msg}. Try again in a moment.`);
  }

  // --- 3. Fetch the receipt, trying each RPC endpoint in turn ---
  // Public endpoints can lag or drop history. A receipt from any endpoint counts.
  // "Not found" from one endpoint does not prove the transaction is missing.
  type Receipt = Awaited<ReturnType<ReturnType<typeof buildClient>['getTransactionReceipt']>>;
  let receipt: Receipt | null = null;
  let lastError: string | null = null;
  for (const url of rpcUrlsFor(chainId)) {
    if (signal?.aborted) break;
    try {
      receipt = await buildClient(chainId, url, signal).getTransactionReceipt({ hash: txHash });
      break;
    } catch (err: unknown) {
      if (!isReceiptNotFound(err)) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  if (!receipt) {
    if (lastError) {
      return unverifiable(txHash, chainId, `Could not fetch the transaction: ${lastError}. Try again in a moment.`);
    }
    return {
      outcome: 'UNVERIFIABLE',
      txHash,
      network: chain.name,
      chainId,
      fields: [],
      explorerUrl: chain.explorerBase + '/tx/' + txHash,
      usdcContractAddress: usdc.address,
      timestamp: new Date().toISOString(),
      errorDetail: 'None of the network endpoints returned this transaction. Public nodes can be out of date, and the transaction may still be pending. Check the explorer link. This is not a verdict that the payment failed.',
    };
  }

  // Time of the block the transaction is in. This comes from the chain, not from the payer.
  const blockTime = await fetchBlockTime(chainId, receipt.blockNumber, signal);

  // --- 4. Execution status ---
  if (receipt.status !== 'success') {
    return {
      outcome: 'FAILED_OR_PENDING',
      txHash,
      network: chain.name,
      chainId,
      fields: [],
      explorerUrl: chain.explorerBase + '/tx/' + txHash,
      usdcContractAddress: usdc.address,
      timestamp: new Date().toISOString(),
      blockNumber: receipt.blockNumber,
      blockTime,
      txStatus: 'Failed (reverted)',
      errorDetail: 'The transaction failed, so no payment was made.',
    };
  }

  // --- 5. Find the USDC transfers ---
  const transfers = collectTransfers(
    receipt.logs,
    isArc,
    usdc.address,
    usdc.decimals,
    nativeDecimals,
  );
  const tokenLabel = isArc
    ? `USDC (native, system emitter ${ARC_NATIVE_USDC_EMITTER})`
    : `USDC (${usdc.address})`;

  if (transfers.length === 0) {
    return {
      outcome: 'MISMATCH',
      txHash,
      network: chain.name,
      chainId,
      fields: [
        { label: 'USDC transfer present', claimed: 'Yes', actual: 'No USDC transfer found in this transaction', match: false },
      ],
      explorerUrl: chain.explorerBase + '/tx/' + txHash,
      usdcContractAddress: usdc.address,
      timestamp: new Date().toISOString(),
      blockNumber: receipt.blockNumber,
      blockTime,
      txStatus: 'Succeeded',
      errorDetail: 'The transaction succeeded, but it did not move USDC. It may have involved a different token or operation.',
    };
  }

  // --- 6. Select the transfers that go to the expected recipient ---
  const recipient = expectedRecipient.toLowerCase();
  const toRecipient = transfers.filter((t) => t.to === recipient);
  const multipleTransfersDetected = transfers.length > 1;
  const formatAll = (list: TransferEvent[]) =>
    list.map((t) => `${t.to} received ${fmt(Number(formatUnits(t.amountRaw, t.decimals)))}`).join('; ');

  // Precision used for amount checks (USDC's 6 decimals, see below).
  const scale = isArc ? 10n ** BigInt(nativeDecimals - usdc.decimals) : 1n;
  const claimedMicro = claimedRaw / scale;

  // No transfer to the expected recipient.
  if (toRecipient.length === 0) {
    // One transfer: the recipient is wrong, but the amount can still be checked.
    if (transfers.length === 1) {
      const only = transfers[0];
      const onlyMicro = (only.amountRaw + scale / 2n) / scale;
      const amountRight = onlyMicro === claimedMicro;
      return {
        outcome: 'MISMATCH',
        txHash,
        network: chain.name,
        chainId,
        fields: [
          { label: 'Recipient address', claimed: expectedRecipient, actual: only.to, match: false },
          { label: 'Token', claimed: 'USDC', actual: tokenLabel, match: true },
          {
            label: 'Amount (USDC)',
            claimed: fmt(Number(trimmedAmount)),
            actual: formatUnits(only.amountRaw, only.decimals),
            match: amountRight,
          },
        ],
        explorerUrl: chain.explorerBase + '/tx/' + txHash,
        usdcContractAddress: usdc.address,
        timestamp: new Date().toISOString(),
        blockNumber: receipt.blockNumber,
        blockTime,
        txStatus: 'Succeeded',
        errorDetail: amountRight
          ? 'The amount is correct, but the USDC was sent to a different address. This payment did not reach the expected recipient.'
          : 'The USDC was sent to a different address, and the amount differs from your claim. This payment did not reach the expected recipient.',
      };
    }

    // Several transfers, none to the expected recipient: list them all, and do not guess which one was meant.
    const listing = transfers
      .map((t, i) => `Transfer ${i + 1}: ${t.to} received ${formatUnits(t.amountRaw, t.decimals)} USDC.`)
      .join(' ');
    return {
      outcome: 'MISMATCH',
      txHash,
      network: chain.name,
      chainId,
      fields: [
        { label: 'Recipient address', claimed: expectedRecipient, actual: 'None of the transfers', match: false },
        { label: 'Token', claimed: 'USDC', actual: tokenLabel, match: true },
        { label: 'Amount (USDC)', claimed: fmt(Number(trimmedAmount)), actual: 'See notes', match: null },
      ],
      explorerUrl: chain.explorerBase + '/tx/' + txHash,
      usdcContractAddress: usdc.address,
      timestamp: new Date().toISOString(),
      blockNumber: receipt.blockNumber,
      blockTime,
      txStatus: 'Succeeded',
      multipleTransfersDetected: true,
      errorDetail: `This transaction sent USDC in ${transfers.length} transfers, none to the expected recipient. ${listing}`,
    };
  }

  // ---- Transfers to the expected recipient ----
  // A transfer matches when its amount equals the claim, at USDC precision.
  // The app never adds transfers together.
  const micro = (t: TransferEvent) => (t.amountRaw + scale / 2n) / scale;
  const matches = toRecipient.filter((t) => micro(t) === claimedMicro);
  const notMatching = transfers.filter((t) => !matches.includes(t));
  const claimedText = fmt(Number(trimmedAmount));
  const describe = (t: TransferEvent) => `${t.to} received ${formatUnits(t.amountRaw, t.decimals)} USDC`;
  const listAll = transfers.map((t, i) => `Transfer ${i + 1}: ${describe(t)}.`).join(' ');
  const common = {
    txHash,
    network: chain.name,
    chainId,
    explorerUrl: chain.explorerBase + '/tx/' + txHash,
    usdcContractAddress: usdc.address,
    timestamp: new Date().toISOString(),
    blockNumber: receipt.blockNumber,
    blockTime,
    txStatus: 'Succeeded',
  };

  // Exactly one transfer matches the claim: that transfer is the payment.
  if (matches.length === 1) {
    const target = matches[0];
    const notes: string[] = [];
    if (transfers.length > 1) {
      notes.push(
        `This transaction contains ${transfers.length} USDC transfers. Only the one that matches your claim is counted. Not counted: ${notMatching.map(describe).join('; ')}.`,
      );
    }
    if (target.amountRaw % scale !== 0n) {
      notes.push(
        `The on-chain amount is ${formatUnits(target.amountRaw, target.decimals)} USDC. It was rounded to the nearest micro-USDC (6 decimals) for comparison.`,
      );
    }
    return {
      ...common,
      outcome: 'MATCH',
      fields: [
        { label: 'Recipient address', claimed: expectedRecipient, actual: target.to, match: true },
        { label: 'Token', claimed: 'USDC', actual: tokenLabel, match: true },
        { label: 'Amount (USDC)', claimed: claimedText, actual: formatUnits(target.amountRaw, target.decimals), match: true },
      ],
      multipleTransfersDetected: transfers.length > 1,
      errorDetail: notes.length ? notes.join(' ') : undefined,
    };
  }

  // Two or more transfers match the claim: the app cannot tell which one was meant.
  if (matches.length > 1) {
    return {
      ...common,
      outcome: 'UNVERIFIABLE',
      fields: [
        { label: 'Recipient address', claimed: expectedRecipient, actual: matches[0].to, match: true },
        { label: 'Token', claimed: 'USDC', actual: tokenLabel, match: true },
        {
          label: 'Amount (USDC)',
          claimed: claimedText,
          actual: `${matches.length} transfers of this amount (see notes)`,
          match: null,
        },
      ],
      multipleTransfersDetected: true,
      errorDetail: `This transaction contains ${transfers.length} USDC transfers, and ${matches.length} of them match your claim. The app cannot tell which one was meant, so it does not count any of them and does not add them together. ${listAll}`,
    };
  }

  // No transfer matches the claim.
  const only = toRecipient[0];
  const single = toRecipient.length === 1 && transfers.length === 1;
  return {
    ...common,
    outcome: 'MISMATCH',
    fields: [
      { label: 'Recipient address', claimed: expectedRecipient, actual: only.to, match: true },
      { label: 'Token', claimed: 'USDC', actual: tokenLabel, match: true },
      {
        label: 'Amount (USDC)',
        claimed: claimedText,
        actual: toRecipient.length === 1 ? formatUnits(only.amountRaw, only.decimals) : 'See notes',
        match: false,
      },
    ],
    multipleTransfersDetected: transfers.length > 1,
    errorDetail: single
      ? `The payment reached the correct recipient, but the amount is different. Claimed: ${claimedText} USDC. Actual: ${formatUnits(only.amountRaw, only.decimals)} USDC.`
      : `None of the ${transfers.length} USDC transfers matches your claim of ${claimedText} USDC. ${listAll}`,
  };
}
