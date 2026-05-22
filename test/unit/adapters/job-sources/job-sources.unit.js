/*
  Unit tests for JobSources registry.
*/

import { assert } from 'chai'
import sinon from 'sinon'

import JobSources from '../../../../src/adapters/job-sources/index.js'

describe('#JobSources', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('getActiveAdapters', () => {
    it('should return the sources array', () => {
      const uut = new JobSources({ config: {} })
      const adapters = uut.getActiveAdapters()
      assert.isArray(adapters)
      assert.isAtLeast(adapters.length, 1)
    })
  })

  describe('sourcesSlug', () => {
    it('should list sourceSlug for each registered source', () => {
      const uut = new JobSources({ config: {} })
      assert.deepEqual(uut.sourcesSlug, [
        'vacantesdigitales',
        'jooble',
        'getonbrd',
        'x'
      ])
    })
  })

  describe('start', () => {
    it('should call start on sources that implement it', async () => {
      const uut = new JobSources({ config: {} })
      const s1 = { start: sandbox.stub().resolves() }
      const s2 = { noStart: true }
      uut.sources = [s1, s2]
      await uut.start()
      assert.isTrue(s1.start.calledOnce)
    })
  })

  describe('ingestVacancies', () => {
    it('should skip sources without fetchVacancies', async () => {
      const uut = new JobSources({ config: {} })
      uut.sources = [{ sourceSlug: 'plain' }]
      const out = await uut.ingestVacancies()
      assert.strictEqual(out.metrics.sourcesSkippedNoFetcher, 1)
      assert.deepEqual(out.vacancies, [])
    })

    it('should merge batches and record per-source metrics', async () => {
      const uut = new JobSources({ config: {} })
      uut.sources = [
        {
          sourceSlug: 'one',
          async fetchVacancies () {
            return [{ id: 1 }]
          }
        },
        {
          async fetchVacancies () {
            return [{ id: 2 }, { id: 3 }]
          }
        }
      ]
      const out = await uut.ingestVacancies()
      assert.strictEqual(out.vacancies.length, 3)
      assert.strictEqual(out.metrics.totalRows, 3)
      assert.strictEqual(out.metrics.sourcesFailed, 0)
      assert.strictEqual(out.metrics.perSource.length, 2)
    })

    it('should continue when a source fetch fails', async () => {
      const uut = new JobSources({ config: {} })
      sandbox.stub(console, 'error')
      uut.sources = [
        {
          sourceSlug: 'bad',
          async fetchVacancies () {
            throw new Error('fetch-down')
          }
        },
        {
          sourceSlug: 'good',
          async fetchVacancies () {
            return [{ ok: true }]
          }
        }
      ]
      const out = await uut.ingestVacancies()
      assert.strictEqual(out.metrics.sourcesFailed, 1)
      assert.strictEqual(out.vacancies.length, 1)
      const bad = out.metrics.perSource.find((p) => p.source === 'bad')
      assert.isFalse(bad.ok)
      assert.include(bad.error, 'fetch-down')
    })

    it('should treat non-array batch as empty', async () => {
      const uut = new JobSources({ config: {} })
      uut.sources = [
        {
          sourceSlug: 'weird',
          async fetchVacancies () {
            return 'nope'
          }
        }
      ]
      const out = await uut.ingestVacancies()
      assert.strictEqual(out.vacancies.length, 0)
      assert.strictEqual(out.metrics.perSource[0].count, 0)
    })

    it('should fall back source label to unknown when missing slug and ctor', async () => {
      const src = Object.create(null)
      src.fetchVacancies = async () => []
      const uut = new JobSources({ config: {} })
      uut.sources = [src]

      const out = await uut.ingestVacancies()
      assert.strictEqual(out.metrics.perSource[0].source, 'unknown')
    })

    it('should pass explicit config into source constructors', () => {
      const cfg = { jobIngestionVersion: 'custom-v' }
      const uut = new JobSources({ config: cfg })
      assert.strictEqual(uut.sources[0].config.jobIngestionVersion, 'custom-v')
    })

    it('should use default app config when constructor config omitted', () => {
      const uut = new JobSources()
      assert.isObject(uut.sources[0].config)
      assert.isAtLeast(uut.sources.length, 4)
    })
  })

  describe('sourcesSlug fallbacks', () => {
    it('should use constructor name when sourceSlug missing', () => {
      class PlainSource {}
      const uut = new JobSources({ config: {} })
      uut.sources = [new PlainSource()]
      uut.sourcesSlug = uut._buildSourcesSlug()
      assert.deepEqual(uut.sourcesSlug, ['PlainSource'])
    })
  })
})
