/*
  Focused reload tests for optional env-derived config fields (c8 branches).
*/

import { assert } from 'chai'

describe('#config-env-branches', () => {
  it('should derive minVacancyLlmScore only when MIN_VACANCY_LLM_SCORE is set', async () => {
    const prev = process.env.MIN_VACANCY_LLM_SCORE
    try {
      process.env.MIN_VACANCY_LLM_SCORE = '0.42'
      const m1 = await import('../../../config/env/common.js?minScoreA=' + Date.now())
      assert.strictEqual(m1.default.minVacancyLlmScore, 0.42)

      process.env.MIN_VACANCY_LLM_SCORE = ''
      const m2 = await import('../../../config/env/common.js?minScoreB=' + Date.now())
      assert.isNull(m2.default.minVacancyLlmScore)

      delete process.env.MIN_VACANCY_LLM_SCORE
      const m3 = await import('../../../config/env/common.js?minScoreC=' + Date.now())
      assert.isNull(m3.default.minVacancyLlmScore)
    } finally {
      if (prev === undefined) delete process.env.MIN_VACANCY_LLM_SCORE
      else process.env.MIN_VACANCY_LLM_SCORE = prev
    }
  })

  it('should default joobleApiKey when JOOBLE_API_KEY is unset', async () => {
    const prev = process.env.JOOBLE_API_KEY
    try {
      delete process.env.JOOBLE_API_KEY
      const m = await import('../../../config/env/common.js?joobleDef=' + Date.now())
      assert.strictEqual(m.default.joobleApiKey, '')
    } finally {
      if (prev === undefined) delete process.env.JOOBLE_API_KEY
      else process.env.JOOBLE_API_KEY = prev
    }
  })

  it('should derive joobleApiKey from JOOBLE_API_KEY', async () => {
    const prev = process.env.JOOBLE_API_KEY
    try {
      process.env.JOOBLE_API_KEY = 'test-jooble-key'
      const m = await import('../../../config/env/common.js?jooble=' + Date.now())
      assert.strictEqual(m.default.joobleApiKey, 'test-jooble-key')
    } finally {
      if (prev === undefined) delete process.env.JOOBLE_API_KEY
      else process.env.JOOBLE_API_KEY = prev
    }
  })

  it('should pick database URL from DBURL or default in production env', async () => {
    const prev = process.env.DBURL
    try {
      delete process.env.DBURL
      const p1 = await import('../../../config/env/production.js?dbA=' + Date.now())
      assert.include(p1.default.database, '5555')

      process.env.DBURL = 'mongodb://custom-host/prod'
      const p2 = await import('../../../config/env/production.js?dbB=' + Date.now())
      assert.strictEqual(p2.default.database, 'mongodb://custom-host/prod')
    } finally {
      if (prev === undefined) delete process.env.DBURL
      else process.env.DBURL = prev
    }
  })
})
