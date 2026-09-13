import { encodeFunctionData, erc20Abi, getAddress, parseAbi, parseUnits, type Address, type Hex } from 'viem'
import { z } from 'zod'
import type { OperationInput } from '@agentis-hq/core/operations'
import { evmClient } from './networks'
import { fail } from '../errors'

// Official Base Sepolia deployments, not user-supplied routers or calldata.
// https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
export const uniswap = {
  chainId: 'eip155:84532', router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
  factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', quoter: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
  ETH: '0x4200000000000000000000000000000000000006', USDC: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
} as const
const decimal = z.string().regex(/^(0|[1-9]\d{0,20})(\.\d{1,18})?$/)
export const swapRequest = z.object({ walletId: z.string().uuid(), tokenIn: z.enum(['ETH', 'USDC']), tokenOut: z.enum(['ETH', 'USDC']), amount: decimal, type: z.enum(['EXACT_INPUT', 'EXACT_OUTPUT']).default('EXACT_INPUT'), slippageBps: z.number().int().min(1).max(500).default(50), maxFee: decimal.default('0.0001'), minimumOutputAtomic: z.string().regex(/^[1-9]\d{0,77}$/).optional(), maximumInputAtomic: z.string().regex(/^[1-9]\d{0,77}$/).optional() }).strict().refine(r => r.tokenIn !== r.tokenOut, 'Choose different tokens')
export type SwapRequest = z.infer<typeof swapRequest>
const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)'])
const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)',
  'function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountIn,uint160,uint32,uint256)',
])
const routerAbi = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
  'function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
  'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[])',
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable',
  'function refundETH() payable',
])
export const poolSwapAbi = parseAbi(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)'])
export function tokenUnits(amount: string, symbol: 'ETH' | 'USDC') {
  const decimals = symbol === 'ETH' ? 18 : 6
  if ((amount.split('.')[1]?.length ?? 0) > decimals) fail(400, 'invalid_amount', `Too many decimal places for ${symbol}`)
  const value = parseUnits(amount, decimals)
  if (value <= 0n) fail(400, 'invalid_amount', 'Amount must be positive')
  return value
}
export async function quoteSwap(request: SwapRequest) {
  const client = evmClient(uniswap.chainId)
  if (await client.getChainId() !== 84532) throw Error('RPC network mismatch')
  const amount = tokenUnits(request.amount, request.type === 'EXACT_INPUT' ? request.tokenIn : request.tokenOut)
  const tokenIn = uniswap[request.tokenIn], tokenOut = uniswap[request.tokenOut]
  const routes = await Promise.all(([100, 500, 3000, 10000] as const).map(async fee => {
    try {
      const pool = await client.readContract({ address: uniswap.factory, abi: factoryAbi, functionName: 'getPool', args: [tokenIn, tokenOut, fee] })
      if (pool === '0x0000000000000000000000000000000000000000') return null
      const common = { tokenIn, tokenOut, fee, sqrtPriceLimitX96: 0n }
      const { result } = request.type === 'EXACT_INPUT'
        ? await client.simulateContract({ address: uniswap.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ ...common, amountIn: amount }] })
        : await client.simulateContract({ address: uniswap.quoter, abi: quoterAbi, functionName: 'quoteExactOutputSingle', args: [{ ...common, amount }] })
      return result[0] > 0n ? { pool, fee, value: result[0] } : null
    } catch { return null }
  }))
  const route = routes.filter(r => r !== null).sort((a, b) => a.value === b.value ? 0 : (a.value > b.value ? -1 : 1) * (request.type === 'EXACT_INPUT' ? 1 : -1))[0]
  if (!route) fail(503, 'no_route', 'No usable Uniswap V3 route is currently available on Base Sepolia')
  const input = request.type === 'EXACT_INPUT' ? amount : route.value
  const output = request.type === 'EXACT_INPUT' ? route.value : amount
  const maximumInput = request.type === 'EXACT_INPUT' ? input : (input * BigInt(10000 + request.slippageBps) + 9999n) / 10000n
  const minimumOutput = request.type === 'EXACT_OUTPUT' ? output : output * BigInt(10000 - request.slippageBps) / 10000n
  if (!minimumOutput || (request.minimumOutputAtomic && minimumOutput < BigInt(request.minimumOutputAtomic)) || (request.maximumInputAtomic && maximumInput > BigInt(request.maximumInputAtomic))) fail(409, 'quote_changed', 'The current quote exceeds your preview bounds. Review a new quote.')
  return { protocol: 'Uniswap V3' as const, chainId: uniswap.chainId, router: uniswap.router, pool: route.pool, fee: route.fee, tokenIn: request.tokenIn, tokenOut: request.tokenOut, inputAtomic: input.toString(), outputAtomic: output.toString(), maximumInputAtomic: maximumInput.toString(), minimumOutputAtomic: minimumOutput.toString(), maxFeeAtomic: tokenUnits(request.maxFee, 'ETH').toString(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }
}
export type SwapQuote = Awaited<ReturnType<typeof quoteSwap>>
export function swapInput(planId: string, walletId: string, recipient: string, request: SwapRequest, quote: SwapQuote, approval = false): OperationInput {
  return { action: approval ? 'uniswap_approval' : 'uniswap_swap', walletId, chainId: uniswap.chainId, asset: request.tokenIn === 'ETH' ? 'native' : `erc20:${uniswap.USDC}`, to: getAddress(recipient), amountAtomic: quote.maximumInputAtomic, maxFeeAtomic: quote.maxFeeAtomic, reason: approval ? `Approve exact USDC allowance for Uniswap plan ${planId}` : `Uniswap ${request.tokenIn} → ${request.tokenOut}`, swap: { planId, tokenOut: request.tokenOut, pool: quote.pool, fee: quote.fee, minimumOutputAtomic: quote.minimumOutputAtomic, exactOutput: request.type === 'EXACT_OUTPUT', deadline: Math.floor(new Date(quote.expiresAt).getTime() / 1000) } }
}
export function uniswapCall(input: OperationInput, owner: string) {
  const swap = input.swap
  if (!swap || input.chainId !== uniswap.chainId || getAddress(input.to) !== getAddress(owner) || !['native', `erc20:${uniswap.USDC}`].includes(input.asset.toLowerCase())) throw Error('Invalid Uniswap terms')
  const tokenIn = input.asset === 'native' ? uniswap.ETH : uniswap.USDC, tokenOut = uniswap[swap.tokenOut]
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase() || BigInt(input.amountAtomic) <= 0n) throw Error('Invalid swap tokens')
  if (input.action === 'uniswap_approval') {
    if (input.asset === 'native') throw Error('Native token needs no approval')
    return { to: uniswap.USDC as Address, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [uniswap.router, BigInt(input.amountAtomic)] }) }
  }
  if (input.action !== 'uniswap_swap') throw Error('Invalid swap action')
  const common = { tokenIn, tokenOut, fee: swap.fee, recipient: swap.tokenOut === 'ETH' ? uniswap.router : getAddress(owner), sqrtPriceLimitX96: 0n }
  const data: Hex[] = [swap.exactOutput
    ? encodeFunctionData({ abi: routerAbi, functionName: 'exactOutputSingle', args: [{ ...common, amountOut: BigInt(swap.minimumOutputAtomic), amountInMaximum: BigInt(input.amountAtomic) }] })
    : encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ ...common, amountIn: BigInt(input.amountAtomic), amountOutMinimum: BigInt(swap.minimumOutputAtomic) }] })]
  if (swap.tokenOut === 'ETH') data.push(encodeFunctionData({ abi: routerAbi, functionName: 'unwrapWETH9', args: [BigInt(swap.minimumOutputAtomic), getAddress(owner)] }))
  if (input.asset === 'native') data.push(encodeFunctionData({ abi: routerAbi, functionName: 'refundETH' }))
  return { to: uniswap.router as Address, value: input.asset === 'native' ? BigInt(input.amountAtomic) : 0n, data: encodeFunctionData({ abi: routerAbi, functionName: 'multicall', args: [BigInt(swap.deadline), data] }) }
}
export async function validateSwapPool(input: OperationInput) {
  if (!input.swap || input.swap.deadline * 1000 <= Date.now()) throw Error('Swap quote expired')
  const pool = await evmClient(uniswap.chainId).readContract({ address: uniswap.factory, abi: factoryAbi, functionName: 'getPool', args: [uniswap.ETH, uniswap.USDC, input.swap.fee] })
  if (pool.toLowerCase() !== input.swap.pool.toLowerCase()) throw Error('Unexpected Uniswap pool')
}
