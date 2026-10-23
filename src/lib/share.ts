/**
 * Shareable links. A verification can be re-run by anyone who opens the link:
 * the link carries the inputs (tx hash, claimed amount, recipient, network),
 * and the app re-checks them against the chain on load.
 *
 * The base URL is the page the user is on, so the link works on whatever domain
 * the app is deployed to.
 */

import type { FormValues } from '@/components/VerifyForm';

const VALID_NETWORKS = [5042]; // Arc Mainnet only

export function buildShareUrl(values: FormValues): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('tx', values.txHash);
  url.searchParams.set('amount', values.claimedAmount);
  url.searchParams.set('to', values.expectedRecipient);
  url.searchParams.set('network', String(values.chainId));
  return url.toString();
}

/**
 * Read inputs from the URL. Returns null unless tx, amount and to are all present.
 * An unknown network value is rejected rather than guessed.
 */
export function readShareParams(): FormValues | null {
  const params = new URLSearchParams(window.location.search);
  const tx = params.get('tx');
  const amount = params.get('amount');
  const to = params.get('to');
  if (!tx || !amount || !to) return null;

  const rawNetwork = params.get('network');
  const chainId = rawNetwork === null ? 5042 : Number(rawNetwork);
  if (!VALID_NETWORKS.includes(chainId)) return null;

  return {
    txHash: tx.trim(),
    claimedAmount: amount.trim(),
    expectedRecipient: to.trim(),
    chainId,
  };
}
