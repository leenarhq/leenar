import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildRevertResult } from '../rollbackExecution'

// Minimal Env stub — buildRevertResult only uses env for getUserToken (sb-based) and connector calls
const ENV = {} as any

afterEach(() => vi.restoreAllMocks())

// Mock getUserToken via the utils module
vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>()
  return { ...actual, getUserToken: vi.fn() }
})

// Mock the cloudflare connector functions
vi.mock('../connectors/cloudflare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../connectors/cloudflare')>()
  return { ...actual, getAccountId: vi.fn(), rollbackCloudflareWorker: vi.fn() }
})

// Mock the vercel connector functions
vi.mock('../connectors/vercel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../connectors/vercel')>()
  return { ...actual, promoteVercelDeployment: vi.fn() }
})

import { getUserToken } from '../utils'
import { getAccountId, rollbackCloudflareWorker } from '../connectors/cloudflare'
import { promoteVercelDeployment } from '../connectors/vercel'

describe('buildRevertResult', () => {
  it('vercel ref with valid token → calls promoteVercelDeployment → reverted', async () => {
    vi.mocked(getUserToken).mockResolvedValue('vtok')
    vi.mocked(promoteVercelDeployment).mockResolvedValue({ ok: true })
    const result = await buildRevertResult('n1', { service: 'vercel', deploymentId: 'd1', projectId: 'p1' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n1', service: 'vercel', action: 'reverted' })
    expect(promoteVercelDeployment).toHaveBeenCalledWith('vtok', 'p1', 'd1')
  })

  it('vercel ref with connector failure → failed with detail', async () => {
    vi.mocked(getUserToken).mockResolvedValue('vtok')
    vi.mocked(promoteVercelDeployment).mockResolvedValue({ ok: false, error: 'deployment not found or garbage-collected' })
    const result = await buildRevertResult('n2', { service: 'vercel', deploymentId: 'd2', projectId: 'p2' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n2', service: 'vercel', action: 'failed', detail: 'deployment not found or garbage-collected' })
  })

  it('vercel ref but getUserToken throws → canvas_only with "no vercel token"', async () => {
    vi.mocked(getUserToken).mockRejectedValue(new Error('no token'))
    const result = await buildRevertResult('n3', { service: 'vercel', deploymentId: 'd3', projectId: 'p3' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n3', service: 'vercel', action: 'canvas_only', detail: 'no vercel token' })
  })

  it('cloudflare-workers ref with valid token → reverted', async () => {
    vi.mocked(getUserToken).mockResolvedValue('ctok')
    vi.mocked(getAccountId).mockResolvedValue('acc-1')
    vi.mocked(rollbackCloudflareWorker).mockResolvedValue({ ok: true })
    const result = await buildRevertResult('n4', { service: 'cloudflare-workers', versionId: 'v1', workerName: 'my-worker' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n4', service: 'cloudflare-workers', action: 'reverted' })
    expect(rollbackCloudflareWorker).toHaveBeenCalledWith('ctok', 'acc-1', 'my-worker', 'v1')
  })

  it('cloudflare-workers ref with connector failure → failed with detail', async () => {
    vi.mocked(getUserToken).mockResolvedValue('ctok')
    vi.mocked(getAccountId).mockResolvedValue('acc-1')
    vi.mocked(rollbackCloudflareWorker).mockResolvedValue({ ok: false, error: 'worker or version not found' })
    const result = await buildRevertResult('n5', { service: 'cloudflare-workers', versionId: 'v2', workerName: 'wkr' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n5', service: 'cloudflare-workers', action: 'failed', detail: 'worker or version not found' })
  })

  it('supabase ref → not_supported with DB message', async () => {
    const result = await buildRevertResult('n6', { service: 'supabase' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n6', service: 'supabase', action: 'not_supported', detail: 'Database is not rolled back automatically' })
  })

  it('github ref → not_supported with canvas-only message', async () => {
    const result = await buildRevertResult('n7', { service: 'github' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n7', service: 'github', action: 'not_supported', detail: 'Provider revert not supported; canvas restored only' })
  })

  it('cloudflare-r2 ref → not_supported with canvas-only message', async () => {
    const result = await buildRevertResult('n8', { service: 'cloudflare-r2' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n8', service: 'cloudflare-r2', action: 'not_supported', detail: 'Provider revert not supported; canvas restored only' })
  })

  it('unknown service → canvas_only', async () => {
    const result = await buildRevertResult('n9', { service: 'unknown-svc' }, { env: ENV, userId: 'u1' })
    expect(result).toEqual({ nodeId: 'n9', service: 'unknown-svc', action: 'canvas_only' })
  })
})
