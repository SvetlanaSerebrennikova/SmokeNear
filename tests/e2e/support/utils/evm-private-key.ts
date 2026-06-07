/**
 * Normalises user-provided hex private keys for WC / any EVM signer usage.
 */
export function normalizeEvmPrivateKey(raw: string): string {
  const s = raw.trim().replace(/\s+/g, '');
  if (!s) return '';
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return `0x${s}`;
  return s;
}
