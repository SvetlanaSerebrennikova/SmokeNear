/**
 * Minimal fetch-based JSON-RPC client for eth_getBalance (any EVM-compatible endpoint).
 */

const FALLBACK_RPC = 'https://ethereum.publicnode.com';

export async function ethGetBalanceWei(
  address: `0x${string}`,
  rpcUrl: string = process.env.TEST_ETH_JSON_RPC_URL?.trim() || FALLBACK_RPC
): Promise<bigint> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    throw new Error(`eth_getBalance: HTTP ${res.status} ${rpcUrl}`);
  }

  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error?.message) {
    throw new Error(`eth_getBalance: ${json.error.message}`);
  }
  if (!json.result) {
    throw new Error('eth_getBalance: empty result field');
  }
  return BigInt(json.result);
}
