import { describe, it, expect } from 'vitest'
import { CanvasSchema, CanvasNodeSchema, CanvasEdgeSchema } from './workflowProvision'

const validNode = {
  id: 'node-1',
  type: 'service' as const,
  data: { provider: 'vercel' as const, label: 'Vercel' },
}

const validEdge = {
  source: 'node-1',
  target: 'node-2',
}

describe('CanvasNodeSchema', () => {
  it('accepts a valid service node', () => {
    const result = CanvasNodeSchema.safeParse(validNode)
    expect(result.success).toBe(true)
  })

  it('accepts all known node types including blueprint and department', () => {
    for (const type of ['service', 'trigger', 'action', 'logic', 'approval', 'blueprint', 'department']) {
      expect(CanvasNodeSchema.safeParse({ ...validNode, type }).success).toBe(true)
    }
  })

  it('rejects type longer than 64 chars', () => {
    expect(CanvasNodeSchema.safeParse({ ...validNode, type: 'a'.repeat(65) }).success).toBe(false)
  })

  it('rejects missing id', () => {
    const { id: _, ...noId } = validNode
    expect(CanvasNodeSchema.safeParse(noId).success).toBe(false)
  })

  it('rejects id longer than 256 chars', () => {
    expect(CanvasNodeSchema.safeParse({ ...validNode, id: 'a'.repeat(257) }).success).toBe(false)
  })

  it('accepts all valid providers', () => {
    for (const provider of ['github', 'vercel', 'supabase', 'resend'] as const) {
      const result = CanvasNodeSchema.safeParse({ ...validNode, data: { provider } })
      expect(result.success).toBe(true)
    }
  })

  it('rejects unknown providers', () => {
    const result = CanvasNodeSchema.safeParse({ ...validNode, data: { provider: 'aws' } })
    expect(result.success).toBe(false)
  })

  it('rejects existing_repo that is not a URL', () => {
    const result = CanvasNodeSchema.safeParse({ ...validNode, data: { existing_repo: 'not-a-url' } })
    expect(result.success).toBe(false)
  })

  it('accepts valid existing_repo URL', () => {
    const result = CanvasNodeSchema.safeParse({
      ...validNode,
      data: { existing_repo: 'https://github.com/user/repo' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects customEnvVars exceeding 50 entries', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ key: `KEY_${i}`, value: 'val' }))
    const result = CanvasNodeSchema.safeParse({ ...validNode, data: { customEnvVars: tooMany } })
    expect(result.success).toBe(false)
  })

  it('allows passthrough fields in data', () => {
    const result = CanvasNodeSchema.safeParse({
      ...validNode,
      data: { provider: 'vercel', unknownField: 'ok' },
    })
    expect(result.success).toBe(true)
  })
})

describe('CanvasEdgeSchema', () => {
  it('accepts a valid edge', () => {
    expect(CanvasEdgeSchema.safeParse(validEdge).success).toBe(true)
  })

  it('rejects missing source', () => {
    expect(CanvasEdgeSchema.safeParse({ target: 'node-2' }).success).toBe(false)
  })

  it('rejects missing target', () => {
    expect(CanvasEdgeSchema.safeParse({ source: 'node-1' }).success).toBe(false)
  })

  it('accepts optional id field', () => {
    expect(CanvasEdgeSchema.safeParse({ ...validEdge, id: 'edge-1' }).success).toBe(true)
    expect(CanvasEdgeSchema.safeParse(validEdge).success).toBe(true)  // without id
  })
})

describe('CanvasSchema', () => {
  it('accepts a valid canvas', () => {
    const result = CanvasSchema.safeParse({ nodes: [validNode], edges: [validEdge] })
    expect(result.success).toBe(true)
  })

  it('accepts an empty canvas', () => {
    expect(CanvasSchema.safeParse({ nodes: [], edges: [] }).success).toBe(true)
  })

  it('rejects more than 50 nodes', () => {
    const nodes = Array.from({ length: 51 }, (_, i) => ({ ...validNode, id: `n${i}` }))
    expect(CanvasSchema.safeParse({ nodes, edges: [] }).success).toBe(false)
  })

  it('rejects more than 200 edges', () => {
    const edges = Array.from({ length: 201 }, (_, i) => ({ source: `a${i}`, target: `b${i}` }))
    expect(CanvasSchema.safeParse({ nodes: [], edges }).success).toBe(false)
  })

  it('rejects missing nodes array', () => {
    expect(CanvasSchema.safeParse({ edges: [] }).success).toBe(false)
  })
})
