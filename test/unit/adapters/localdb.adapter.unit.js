/*
  Unit tests for LocalDB — model exports only.
*/

import { assert } from 'chai'

import LocalDB from '../../../src/adapters/localdb/index.js'

describe('#LocalDB', () => {
  it('should expose Mongoose models', () => {
    const uut = new LocalDB()
    assert.ok(uut.Users)
    assert.ok(uut.Usage)
    assert.ok(uut.Vacancy)
  })
})
