/*
  Unit tests for Vacancy entity validation.
*/

import { assert } from 'chai'

import Vacancy from '../../../src/entities/vacancy.js'

describe('#Vacancy-Entity', () => {
  let uut

  beforeEach(() => {
    uut = new Vacancy()
  })

  describe('validateForPersistence()', () => {
    it('should pass for a minimal valid doc', () => {
      uut.validateForPersistence({
        source: 'acme',
        externalId: '42',
        title: 'Backend dev'
      })
    })

    it('should throw when source is missing', () => {
      try {
        uut.validateForPersistence({ externalId: '1', title: 't' })
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'Vacancy')
        assert.include(err.message, 'source')
      }
    })

    it('should throw when externalId is missing or empty', () => {
      for (const bad of [undefined, null, '']) {
        try {
          uut.validateForPersistence({ source: 's', externalId: bad, title: 't' })
          assert.fail('expected throw')
        } catch (err) {
          assert.include(err.message, 'externalId')
        }
      }
    })

    it('should throw when title is missing', () => {
      try {
        uut.validateForPersistence({ source: 's', externalId: 'x' })
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'title')
      }
    })
  })
})
