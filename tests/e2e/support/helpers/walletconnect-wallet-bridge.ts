import './walletconnect-node-ws';
import { Core } from '@walletconnect/core';
import { formatJsonRpcError, formatJsonRpcResult } from '@walletconnect/jsonrpc-utils';
import type { ProposalTypes } from '@walletconnect/types';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';
import Web3Wallet from '@walletconnect/web3wallet';
import {
  concat,
  createPublicClient,
  createWalletClient,
  defineChain,
  hexToBigInt,
  hexToString,
  http,
  isAddress,
  isHex,
  numberToHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Mirrors viem `fallbackMagicIdentifier` chunk for EIP-5792 bundled tx ids (getCallsStatus). */
const FALLBACK_BATCH_MAGIC_HEX =
  '0x5792579257925792579257925792579257925792579257925792579257925792' as const;

export type WalletConnectBridgeOptions = {
  projectId: string;
  /** `0x` + 64 hex for EIP-155 accounts and Ethereum signing */
  evmPrivateKey: `0x${string}`;
  /** Required when proposals include `near:` namespace */
  nearAccountId?: string;
};

/** JSON-RPC capture from the active WC session (for explorer cross-checks). */
export type SessionRequestCapture = {
  readonly method: string;
  readonly chainId?: string;
  readonly params: unknown;
};

function safeCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function numericChainIdFromWc(chainRef: string | undefined): number | undefined {
  if (!chainRef?.includes(':')) return undefined;
  const id = Number(chainRef.split(':')[1]);
  return Number.isFinite(id) ? id : undefined;
}

function hexToMaybeBigInt(hex: Hex | '' | undefined): bigint | undefined {
  if (!hex || hex === '0x') return undefined;
  return BigInt(hex);
}

function chainForWcRpc(wcChainRef: string | undefined, rpcUrl: string) {
  const id = numericChainIdFromWc(wcChainRef);
  if (!id) throw new Error('Missing chainId (eip155:*) on WC session request');
  return defineChain({
    id,
    name: `eip155:${id}`,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

async function walletSendCallsAndBuildViemFallbackId(
  account: ReturnType<typeof privateKeyToAccount>,
  rpcUrl: string,
  wcChainRef: string | undefined,
  batch: Readonly<{
    calls?: Readonly<{ to?: Hex; data?: Hex; value?: Hex | bigint }>[];
    /** WC may send hex chain ids (`0xaa36a7`) or plain JSON-RPC numbers */
    chainId?: Hex | number | string;
    atomicRequired?: boolean;
    version?: string;
  }>
): Promise<{ id: Hex }> {
  let chainNum: number | undefined =
    numericChainIdFromWc(wcChainRef ?? '') ?? undefined;
  const rawCid = batch.chainId;
  if (typeof rawCid === 'number' && Number.isFinite(rawCid)) {
    chainNum = rawCid;
  } else if (typeof rawCid === 'string' && /^0x[0-9a-fA-F]+$/.test(rawCid)) {
    chainNum = Number(hexToBigInt(rawCid as Hex));
  }
  if (chainNum == null || !Number.isFinite(chainNum)) {
    throw new Error('wallet_sendCalls missing chain id (batch.chainId or WC chain ref)');
  }

  const chain = chainForWcRpc(`eip155:${chainNum}`, rpcUrl);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const calls = batch.calls ?? [];
  const hashes: Hex[] = [];
  let delayMs = Number(process.env.WALLET_SEND_CALLS_DELAY_MS ?? 32);

  /**
   * near.com may use EIP-5792; viem encodes `id` that getCallsStatus resolves via public RPC
   * (fallbackMagicIdentifier). Mirror that encoding here.
   */
  for (const call of calls) {
    const to = typeof call?.to === 'string' && isAddress(call.to) ? (call.to as Hex) : undefined;
    if (!to) throw new Error('wallet_sendCalls: call entry missing valid `to`');
    const value =
      call.value === undefined
        ? 0n
        : typeof call.value === 'bigint'
          ? call.value
          : hexToBigInt(call.value as Hex);

    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to,
      value,
      ...(call.data?.length ? { data: call.data as Hex } : {}),
    });
    hashes.push(hash);
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }

  const id = concat([
    ...hashes,
    numberToHex(chainNum, { size: 32 }),
    FALLBACK_BATCH_MAGIC_HEX,
  ]) as Hex;
  return { id };
}

async function estimateGasFromRpc(
  account: ReturnType<typeof privateKeyToAccount>,
  rpcUrl: string,
  wcChainRef: string | undefined,
  txRaw: Record<string, unknown>
): Promise<Hex> {
  const chain = chainForWcRpc(wcChainRef, rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const to =
    typeof txRaw.to === 'string' && isAddress(txRaw.to) ? (txRaw.to as Hex) : undefined;
  const value = hexToMaybeBigInt((typeof txRaw.value === 'string' ? txRaw.value : '0x') as Hex);
  const data =
    typeof txRaw.data === 'string' && txRaw.data.length > 2
      ? (txRaw.data as Hex)
      : undefined;
  const gas = await publicClient.estimateGas({
    account: account.address,
    to,
    value: value ?? undefined,
    data,
  });
  return numberToHex(gas);
}

function parseTypedDataFromParams(params: unknown): {
  readonly domain: Record<string, unknown>;
  readonly types: Record<string, { name: string; type: string }[]>;
  readonly primaryType: string;
  readonly message: Record<string, unknown>;
} {
  const arr = params as unknown[];
  if (!Array.isArray(arr) || arr.length < 2) {
    throw new Error('eth_signTypedData*: expected [address, typedData | JSON string]');
  }
  let raw = arr[1];
  const parsed =
    typeof raw === 'string'
      ? (JSON.parse(raw) as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  const domain = parsed.domain as Record<string, unknown>;
  const primaryType = String(parsed.primaryType ?? '');
  const message = parsed.message as Record<string, unknown>;
  const typesRaw = { ...(parsed.types as Record<string, unknown>) };
  delete typesRaw.EIP712Domain;
  return {
    domain,
    primaryType,
    message,
    types: typesRaw as Record<string, { name: string; type: string }[]>,
  };
}

async function sendEvmTxFromWcParams(
  account: ReturnType<typeof privateKeyToAccount>,
  rpcUrl: string,
  wcChainRef: string | undefined,
  txRaw: Record<string, unknown>
): Promise<Hex> {
  const chain = chainForWcRpc(wcChainRef, rpcUrl);

  const to = typeof txRaw.to === 'string' ? (txRaw.to as Hex) : undefined;
  if (!to || !isAddress(to)) throw new Error('eth_sendTransaction: invalid `to` address');

  const value = hexToMaybeBigInt((typeof txRaw.value === 'string' ? txRaw.value : '0x') as Hex);
  const data =
    typeof txRaw.data === 'string' && txRaw.data.length > 2
      ? (txRaw.data as Hex)
      : undefined;

  const gas = typeof txRaw.gas === 'string' ? BigInt(txRaw.gas as string) : undefined;
  const gasPrice = typeof txRaw.gasPrice === 'string' ? BigInt(txRaw.gasPrice as string) : undefined;
  const maxFeePerGas =
    typeof txRaw.maxFeePerGas === 'string' ? BigInt(txRaw.maxFeePerGas as string) : undefined;
  const maxPriorityFeePerGas =
    typeof txRaw.maxPriorityFeePerGas === 'string'
      ? BigInt(txRaw.maxPriorityFeePerGas as string)
      : undefined;

  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const fee =
    maxFeePerGas != null && maxPriorityFeePerGas != null
      ? { maxFeePerGas, maxPriorityFeePerGas }
      : gasPrice != null
        ? { gasPrice }
        : {};
  return walletClient.sendTransaction({
    account,
    chain,
    to,
    value: value ?? 0n,
    data,
    gas,
    ...fee,
  });
}

/** String fragments derived from WC requests — useful when matching explorer copy. */
export function comparableStringsFromSessionCapture(cap: SessionRequestCapture): string[] {
  const out = new Set<string>();
  try {
    if (cap.method === 'eth_signTypedData_v4' || cap.method === 'eth_signTypedData') {
      const { message, domain } = parseTypedDataFromParams(cap.params);
      /** Recursively collect scalar EIP-712 message/domain fields */
      const walk = (v: unknown) => {
        if (v === null || v === undefined) return;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') {
          const s = String(v);
          /** Explorer often mirrors literals like `1` / `1000000` (USDC wei) */
          if (/^\d+(\.\d+)?$/.test(s)) out.add(s);
          else if (s.length >= 4) out.add(s);
          return;
        }
        if (Array.isArray(v)) {
          v.forEach(walk);
          return;
        }
        if (typeof v === 'object') Object.values(v as object).forEach(walk);
      };
      walk(message);
      if (domain.verifyingContract && typeof domain.verifyingContract === 'string') {
        out.add(domain.verifyingContract.toLowerCase());
      }
      return [...out];
    }

    if (cap.method === 'eth_sendTransaction' || cap.method === 'wallet_sendTransaction') {
      const first = ((cap.params ?? []) as unknown[])[0] as Record<string, unknown> | undefined;
      const to =
        typeof first?.to === 'string' ? first!.to!.toLowerCase() : '';
      if (to) out.add(to);
      const val = typeof first?.value === 'string' ? first.value.toLowerCase() : '';
      if (val && val !== '0x' && val !== '0x0') out.add(val);
      const data = typeof first?.data === 'string' ? first.data : '';
      if (data.length > 10) out.add(data.slice(0, 10).toLowerCase());
      /** Common calldata selectors often appear verbatim in explorer text */
      if (data.length > 30) out.add(data.slice(0, 42).toLowerCase());
      return [...out];
    }

    if (cap.method === 'wallet_sendCalls') {
      const first = ((cap.params ?? []) as unknown[])[0] as
        | { calls?: readonly { to?: string; data?: string; value?: string }[] }
        | undefined;
      const callsList = first?.calls ?? [];
      for (const c of callsList) {
        if (c.to) out.add(c.to.toLowerCase());
        const v = typeof c.value === 'string' ? c.value.toLowerCase() : '';
        if (v && v !== '0x' && v !== '0x0') out.add(v);
        const data = typeof c.data === 'string' ? c.data : '';
        if (data.length > 10) out.add(data.slice(0, Math.min(66, data.length)).toLowerCase());
      }
      return [...out];
    }
  } catch {
    /** ignore malformed */
  }
  return [...out];
}

/**
 * Substrings from the signing request that should also appear on the block explorer after execution
 * (long hex, wei-sized integers, long ids — avoids matching noise like `1` or `10`).
 */
export function strictExplorerNeedlesFromSessionCapture(cap: SessionRequestCapture): string[] {
  const all = comparableStringsFromSessionCapture(cap);
  const uniq = [...new Set(all.map(s => String(s).toLowerCase()))];
  return uniq.filter(l => {
    if (l.startsWith('0x') && /^0x[0-9a-f]+$/i.test(l) && l.length >= 10) return true;
    if (/^\d+$/.test(l) && l.length >= 6) return true;
    if (l.length >= 14) return true;
    return false;
  });
}

/** Which `strictExplorerNeedlesFromSessionCapture` substrings are absent from normalized explorer text. */
export function signingNeedlesMissingFromExplorer(
  cap: SessionRequestCapture | undefined,
  explorerNormLower: string
): string[] {
  if (!cap) return [];
  const n = explorerNormLower.toLowerCase();
  return strictExplorerNeedlesFromSessionCapture(cap).filter(frag => !n.includes(frag));
}

function hexChainId(chainRef: string): string {
  const [, id] = chainRef.split(':');
  if (!id) return '0x1';
  const n = Number(id);
  return `0x${n.toString(16)}`;
}

function buildSupportedNamespaces(
  proposal: ProposalTypes.Struct,
  evmAddress: `0x${string}`,
  nearAccountId?: string
): Record<
  string,
  { chains: string[]; methods: string[]; events: string[]; accounts: string[] }
> {
  const mergedKeys = [
    ...new Set([
      ...Object.keys(proposal.requiredNamespaces),
      ...Object.keys(proposal.optionalNamespaces ?? {}),
    ]),
  ];

  /** Prefer `requiredNamespaces`, fallback to optional entries */
  const merged: ProposalTypes.RequiredNamespaces = {};
  for (const key of mergedKeys) {
    const ns = proposal.requiredNamespaces[key] ?? proposal.optionalNamespaces?.[key];
    if (ns) merged[key] = ns;
  }
  const supported: Record<
    string,
    { chains: string[]; methods: string[]; events: string[]; accounts: string[] }
  > = {};

  for (const key of Object.keys(merged)) {
    const ns = merged[key]!;

    if (key === 'eip155') {
      const chains = ns.chains?.length ? [...ns.chains] : ['eip155:1'];
      supported.eip155 = {
        chains,
        methods: [...ns.methods],
        events: [...ns.events],
        accounts: chains.map(c => `${c}:${evmAddress}`),
      };
      continue;
    }

    if (key === 'near') {
      if (!nearAccountId) {
        throw new Error(
          'Proposal references near: namespace — set NEAR_WALLETCONNECT_ACCOUNT (e.g. id.near) in .env.test'
        );
      }
      const chains = ns.chains?.length ? [...ns.chains] : ['near:mainnet'];
      supported.near = {
        chains,
        methods: [...ns.methods],
        events: [...ns.events],
        accounts: chains.map(c => `${c}:${nearAccountId}`),
      };
      continue;
    }

    throw new Error(
      `Unhandled WC namespace "${key}" — extend walletconnect-wallet-bridge.ts`
    );
  }

  return supported;
}

/**
 * Headless WC wallet: pairing from dapp URI, auto-approved proposals + minimal Ethereum replies.
 */
export async function createWalletConnectTestBridge(opts: WalletConnectBridgeOptions): Promise<{
  /** Accounts returned via eth_accounts / WC session metadata */
  readonly evmAddress: `0x${string}`;
  pair(uri: string): Promise<void>;
  close(): Promise<void>;
  /** JSON-RPC captures emitted during this session */
  getSessionCaptures(): readonly SessionRequestCapture[];
}> {
  const account = privateKeyToAccount(opts.evmPrivateKey);
  const sessionCaptures: SessionRequestCapture[] = [];

  const core = new Core({ projectId: opts.projectId });
  const web3wallet = await Web3Wallet.init({
    core,
    metadata: {
      name: 'near-e2e-starter (WC test wallet)',
      description: 'Playwright WC bridge',
      url: 'https://near.com',
      icons: [],
    },
  });

  web3wallet.on('session_proposal', async evt => {
    const proposal = (evt as { params: ProposalTypes.Struct }).params;
    const supportedNamespaces = buildSupportedNamespaces(
      proposal,
      account.address,
      opts.nearAccountId?.trim()
    );
    const namespaces = buildApprovedNamespaces({ proposal, supportedNamespaces });
    await web3wallet.approveSession({
      id: proposal.id,
      namespaces,
    });
  });

  web3wallet.on('session_request', async evt => {
    const { topic, id } = evt as unknown as { topic: string; id: number };
    const wrap = evt as unknown as {
      params: {
        chainId?: string;
        request: { method: string; params: unknown };
      };
    };

    const { request } = wrap.params;
    sessionCaptures.push({
      method: request.method,
      chainId: wrap.params.chainId,
      params: safeCloneJson(request.params),
    });

    try {
      const method = request.method;
      let result: unknown;

      if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
        result = [account.address];
      } else if (method === 'eth_chainId') {
        const cid = wrap.params.chainId ? hexChainId(wrap.params.chainId) : '0x1';
        result = cid;
      } else if (method === 'personal_sign') {
        const tuple = request.params as string[];
        const raw = tuple[0];
        const message =
          typeof raw === 'string' && raw.startsWith('0x') && isHex(raw as `0x${string}`)
            ? hexToString(raw as `0x${string}`)
            : String(raw);
        result = await account.signMessage({ message });
      } else if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
        const typed = parseTypedDataFromParams(request.params);
        result = await account.signTypedData({
          domain: typed.domain as Parameters<typeof account.signTypedData>[0]['domain'],
          types: typed.types as Parameters<typeof account.signTypedData>[0]['types'],
          primaryType: typed.primaryType,
          message: typed.message as Parameters<
            typeof account.signTypedData
          >[0]['message'],
        });
      } else if (method === 'wallet_sendCalls') {
        const rpcWsc = process.env.TEST_ETH_RPC_URL?.trim();
        if (!rpcWsc) throw new Error('TEST_ETH_RPC_URL is required for wallet_sendCalls forwarding');
        const [batch] = (request.params ?? []) as [Record<string, unknown>];
        result = await walletSendCallsAndBuildViemFallbackId(
          account,
          rpcWsc,
          wrap.params.chainId,
          batch
        );
      } else if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') {
        const rpc = process.env.TEST_ETH_RPC_URL?.trim();
        if (!rpc) {
          throw new Error(
            'Set TEST_ETH_RPC_URL matching WC chainId before eth_sendTransaction relay'
          );
        }
        const txParams = ((request.params as unknown[]) ?? [])[0] as Record<string, unknown>;
        result = await sendEvmTxFromWcParams(account, rpc, wrap.params.chainId, txParams);
      } else if (method === 'wallet_getCapabilities') {
        /** Minimal acknowledgement; dapp can fall back to eth_/wallet_sendCalls */
        result = {};
      } else if (
        method === 'wallet_switchEthereumChain' ||
        method === 'wallet_addEthereumChain'
      ) {
        /** Test wallet intentionally does not stall dapps before signatures */
        result = null;
      } else if (method === 'wallet_watchAsset') {
        result = true;
      } else if (method === 'eth_estimateGas') {
        const rpcEg = process.env.TEST_ETH_RPC_URL?.trim();
        if (!rpcEg) {
          throw new Error(
            'TEST_ETH_RPC_URL must reach the WC `chainId` network for eth_estimateGas'
          );
        }
        const txEg = ((request.params as unknown[]) ?? [])[0] as Record<string, unknown>;
        result = await estimateGasFromRpc(account, rpcEg, wrap.params.chainId, txEg);
      } else {
        // eslint-disable-next-line no-console -- log unsupported WC methods during tests
        console.warn(
          `[wc-bridge] UNSUPPORTED ${method}`,
          JSON.stringify(request.params).slice(0, 1200)
        );
        await web3wallet.respondSessionRequest({
          topic,
          response: formatJsonRpcError(id, getSdkError('UNSUPPORTED_METHODS')),
        });
        return;
      }

      await web3wallet.respondSessionRequest({
        topic,
        response: formatJsonRpcResult(id, result),
      });
    } catch {
      await web3wallet.respondSessionRequest({
        topic,
        response: formatJsonRpcError(id, getSdkError('USER_REJECTED')),
      });
    }
  });

  return {
    evmAddress: account.address,
    getSessionCaptures() {
      return [...sessionCaptures];
    },
    async pair(uri: string) {
      await web3wallet.pair({ uri });
    },
    async close() {
      const sessions = web3wallet.getActiveSessions();
      for (const s of Object.values(sessions)) {
        await web3wallet.disconnectSession({
          topic: s.topic,
          reason: getSdkError('USER_DISCONNECTED'),
        });
      }
      /** Without closing the relay WebSocket, Node keeps handles open and `npx playwright test` may not exit. */
      try {
        await web3wallet.core.relayer.transportClose();
      } catch {
        /* ignore */
      }
      try {
        web3wallet.core.heartbeat.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
