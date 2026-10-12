import { describe, expect, it } from 'vitest'
import { readActions } from './askActions'

describe('readActions', () => {
  it('leaves an ordinary answer alone', () => {
    expect(readActions('Here is a query.\n```sql\nSELECT 1\n```')).toEqual({ answer: 'Here is a query.\n```sql\nSELECT 1\n```', actions: [] })
  })

  it('reads a named action and hides its line', () => {
    expect(readActions('DO open-query: Refund audit\nOpened the refund audit.')).toEqual({
      answer: 'Opened the refund audit.', actions: [{ kind: 'open-query', name: 'Refund audit' }],
    })
  })

  it('reads several actions in order', () => {
    expect(readActions('DO open-query: Refund audit\nDO run\n\nOpened it and ran it.').actions).toEqual([
      { kind: 'open-query', name: 'Refund audit' }, { kind: 'run', name: '' },
    ])
  })

  it('strips quotes and bold around the mark and the name', () => {
    expect(readActions('**DO** show: "map".\nHere is the map.').actions).toEqual([{ kind: 'show', name: 'map' }])
  })

  it('drops a name given to an action that takes none', () => {
    expect(readActions('DO run: the query\nRunning.').actions).toEqual([{ kind: 'run', name: '' }])
  })

  it('hides but ignores unknown actions and named actions without a name', () => {
    expect(readActions('DO delete-everything: now\nDO open-query\nNo.')).toEqual({ answer: 'No.', actions: [] })
  })

  it('carries out at most three', () => {
    const { answer, actions } = readActions('DO new-tab\nDO new-tab\nDO new-tab\nDO new-tab\nDone.')
    expect(actions).toHaveLength(3)
    expect(answer).toBe('Done.')
  })

  it('does not take a sentence that starts with the word for an action', () => {
    expect(readActions('Do run it again after the index is built.').actions).toEqual([])
    expect(readActions('First:\nDO run').actions).toEqual([])
  })

  it('is not fooled by a property name', () => {
    expect(readActions('DO constructor: x\nHello').actions).toEqual([])
  })
})
