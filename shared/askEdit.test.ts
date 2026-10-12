import { describe, expect, it } from 'vitest'
import { readEdit } from './askEdit'

describe('edit mark in an answer', () => {
  it('takes the new query out of a marked answer and hides the mark', () => {
    const answer = 'EDIT\n```sql\nSELECT *\nFROM orders\nLIMIT 10;\n```\nAdded a limit of 10 rows.'
    expect(readEdit(answer)).toEqual({
      answer: '```sql\nSELECT *\nFROM orders\nLIMIT 10;\n```\nAdded a limit of 10 rows.',
      replacement: 'SELECT *\nFROM orders\nLIMIT 10;',
    })
  })

  it('accepts the small variations a model produces', () => {
    for (const mark of ['EDIT', '  EDIT:', '**EDIT**', 'EDIT.\r']) {
      expect(readEdit(`${mark}\n\n\`\`\`sql\nSELECT 1\n\`\`\``).replacement, mark).toBe('SELECT 1')
    }
  })

  it('leaves an ordinary answer alone', () => {
    const plain = 'This query counts orders.\n```sql\nSELECT COUNT(*) FROM orders\n```'
    expect(readEdit(plain)).toEqual({ answer: plain })
    // The word is only a mark on a line of its own at the very start.
    expect(readEdit('Edit the WHERE clause like this:\n```sql\nSELECT 1\n```').replacement).toBeUndefined()
    expect(readEdit('EDITED versions follow\n```sql\nSELECT 1\n```').replacement).toBeUndefined()
  })

  it('hides the mark even when no query follows it', () => {
    expect(readEdit('EDIT\nI could not tell which column you meant.')).toEqual({ answer: 'I could not tell which column you meant.' })
  })
})
