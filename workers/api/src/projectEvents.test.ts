import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getProvisionedResources } from './projectEvents'

// Mock eventSourcing so we can control loadStackEvents output without a real DB
vi.mock('./eventSourcing', () => ({
  loadStackEvents: vi.fn(),
  loadSessionEvents: vi.fn(),
}))

import { loadStackEvents } from './eventSourcing'

const mockEnv = {} as any

describe('getProvisionedResources — created field', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('carries created:true for a provisioned step', async () => {
    vi.mocked(loadStackEvents).mockResolvedValue([
      {
        type: 'StepCompleted',
        payload: {
          service: 'vercel',
          nodeId: 'node-1',
          resourceId: 'prj_abc',
          created: true,
        },
        sequence: 1,
      },
    ])

    const resources = await getProvisionedResources(mockEnv, 'stack-1')
    expect(resources).toHaveLength(1)
    expect(resources[0].created).toBe(true)
    expect(resources[0].service).toBe('vercel')
    expect(resources[0].resourceId).toBe('prj_abc')
  })

  it('carries created:false for a reused (redeploy/inject) step', async () => {
    vi.mocked(loadStackEvents).mockResolvedValue([
      {
        type: 'StepCompleted',
        payload: {
          service: 'vercel',
          nodeId: 'node-2',
          resourceId: 'prj_existing',
          created: false,
        },
        sequence: 1,
      },
    ])

    const resources = await getProvisionedResources(mockEnv, 'stack-2')
    expect(resources).toHaveLength(1)
    expect(resources[0].created).toBe(false)
  })

  it('filters only created resources when teardown logic applied', async () => {
    vi.mocked(loadStackEvents).mockResolvedValue([
      {
        type: 'StepCompleted',
        payload: {
          service: 'vercel',
          nodeId: 'node-1',
          resourceId: 'prj_new',
          created: true,
        },
        sequence: 1,
      },
      {
        type: 'StepCompleted',
        payload: {
          service: 'vercel',
          nodeId: 'node-2',
          resourceId: 'prj_existing',
          created: false,
        },
        sequence: 2,
      },
      {
        type: 'StepCompleted',
        payload: {
          service: 'supabase',
          nodeId: 'node-3',
          resourceId: 'ref_new',
          created: true,
        },
        sequence: 3,
      },
    ])

    const resources = await getProvisionedResources(mockEnv, 'stack-3')
    expect(resources).toHaveLength(3)

    const toRemove = resources.filter((r) => r.created === true)
    expect(toRemove).toHaveLength(2)
    expect(toRemove.map((r) => r.resourceId)).toEqual(['prj_new', 'ref_new'])
  })

  it('treats missing created field as created:false', async () => {
    vi.mocked(loadStackEvents).mockResolvedValue([
      {
        type: 'StepCompleted',
        payload: {
          service: 'vercel',
          nodeId: 'node-old',
          resourceId: 'prj_old',
          // no created field — legacy event
        },
        sequence: 1,
      },
    ])

    const resources = await getProvisionedResources(mockEnv, 'stack-4')
    expect(resources).toHaveLength(1)
    expect(resources[0].created).toBe(false)
  })
})
