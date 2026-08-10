import { describe, it, expect } from 'vitest'
import { onboardingEmail } from './onboarding'

const BASE_OPTS = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  frontendUrl: 'https://leenar.net',
}

describe('onboardingEmail', () => {
  it('uses first name in subject', () => {
    const { subject } = onboardingEmail(BASE_OPTS)
    expect(subject).toContain('Jane')
    expect(subject).not.toContain('Doe')
  })

  it('includes correct dashboard and new URLs', () => {
    const { html, text } = onboardingEmail(BASE_OPTS)
    expect(html).toContain('https://leenar.net/dashboard')
    expect(html).toContain('https://leenar.net/new')
    expect(text).toContain('https://leenar.net/new')
    expect(text).toContain('https://leenar.net/dashboard')
  })

  it('greets by first name in HTML and text', () => {
    const { html, text } = onboardingEmail(BASE_OPTS)
    expect(html).toContain('Hey Jane')
    expect(text).toContain('Hey Jane')
  })

  it('falls back to "there" when name is empty', () => {
    const { html, text } = onboardingEmail({ ...BASE_OPTS, name: '' })
    expect(html).toContain('Hey there')
    expect(text).toContain('Hey there')
  })

  it('returns subject, html, and text keys', () => {
    const result = onboardingEmail(BASE_OPTS)
    expect(result).toHaveProperty('subject')
    expect(result).toHaveProperty('html')
    expect(result).toHaveProperty('text')
  })

  it('html is a complete HTML document', () => {
    const { html } = onboardingEmail(BASE_OPTS)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('</html>')
  })

  it('handles single-word names', () => {
    const { subject, html } = onboardingEmail({ ...BASE_OPTS, name: 'Efe' })
    expect(subject).toContain('Efe')
    expect(html).toContain('Hey Efe')
  })

  it('uses the provided frontendUrl as base', () => {
    const { html } = onboardingEmail({ ...BASE_OPTS, frontendUrl: 'https://custom.example.com' })
    expect(html).toContain('https://custom.example.com/new')
    expect(html).toContain('https://custom.example.com/dashboard')
    expect(html).not.toContain('https://leenar.net/new')
  })
})
