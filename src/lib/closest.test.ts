import { describe, expect, it } from 'vitest'
import { closest } from './closest'

const names = ['Refund audit', 'Refunds by month', 'Top customers', 'order_items', 'OrderHeaders']
const find = (wanted: string) => closest(wanted, names, (n) => n)

describe('closest', () => {
  it('finds an exact name whatever the case or punctuation', () => {
    expect(find('refund audit')).toBe('Refund audit')
    expect(find('Order items')).toBe('order_items')
    expect(find('order headers')).toBe('OrderHeaders')
  })

  it('finds a name said with extra words', () => {
    expect(find('the refund audit file')).toBe('Refund audit')
    expect(find('refunds per month')).toBe('Refunds by month')
  })

  it('ignores a plural', () => {
    expect(find('top customer')).toBe('Top customers')
    expect(find('refunds audit')).toBe('Refund audit')
  })

  it('prefers the name with fewer words left over', () => {
    expect(find('refund')).toBe('Refund audit')
  })

  it('finds nothing when nothing is close', () => {
    expect(find('payroll summary')).toBeUndefined()
    expect(find('')).toBeUndefined()
    expect(find('the')).toBeUndefined()
  })
})
