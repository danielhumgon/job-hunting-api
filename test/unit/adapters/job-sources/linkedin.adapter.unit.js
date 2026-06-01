/*
  Unit tests for LinkedIn (Apify) job source.
*/

import axios from 'axios'
import { assert } from 'chai'
import sinon from 'sinon'

import LinkedInJobSource, {
  APIFY_API_BASE,
  LINKEDIN_DEFAULT_MAX_ITEMS_PER_QUERY,
  PROFILE_STACK_SEARCH_QUERIES,
  buildLinkedInBodyText,
  flattenLinkedInDatasetItems,
  inferLinkedInLocationType,
  matchesIgnoreStackForIngest,
  normalizeLinkedInJob,
  parseLinkedInDatePosted,
  pickLinkedInField,
  unwrapApifyRun
} from '../../../../src/adapters/job-sources/linkedin.js'

describe('#LinkedInJobSource', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('pickLinkedInField', () => {
    it('should return first matching key', () => {
      assert.strictEqual(
        pickLinkedInField({ jobTitle: 'Dev', title: 'Other' }, ['title', 'jobTitle']),
        'Other'
      )
      assert.isNull(pickLinkedInField({}, ['x']))
      assert.isNull(pickLinkedInField(null, ['x']))
    })
  })

  describe('flattenLinkedInDatasetItems', () => {
    it('should flatten array payloads and nested jobs', () => {
      const row = { job_id: '1', job_title: 'A' }
      assert.deepEqual(flattenLinkedInDatasetItems([row]), [row])
      assert.deepEqual(flattenLinkedInDatasetItems({ jobs: [row] }), [row])
      assert.deepEqual(
        flattenLinkedInDatasetItems({ jobs: JSON.stringify([row]) }),
        [row]
      )
    })

    it('should return single job object when title or id present', () => {
      const row = { 'Job Title': 'T', job_id: '9' }
      assert.deepEqual(flattenLinkedInDatasetItems(row), [row])
    })

    it('should return empty for invalid jobs JSON or empty input', () => {
      assert.deepEqual(flattenLinkedInDatasetItems({ jobs: 'not-json' }), [])
      assert.deepEqual(flattenLinkedInDatasetItems(null), [])
      assert.deepEqual(flattenLinkedInDatasetItems('x'), [])
      assert.deepEqual(flattenLinkedInDatasetItems({ foo: 'bar' }), [])
    })

    it('should accept object with only id field', () => {
      assert.deepEqual(
        flattenLinkedInDatasetItems({ id: 'linkedin-99' }),
        [{ id: 'linkedin-99' }]
      )
    })
  })

  describe('unwrapApifyRun', () => {
    it('should unwrap data wrapper', () => {
      assert.deepEqual(unwrapApifyRun({ data: { id: 'r1' } }), { id: 'r1' })
      assert.deepEqual(unwrapApifyRun({ id: 'r2' }), { id: 'r2' })
      assert.deepEqual(unwrapApifyRun(null), {})
    })
  })

  describe('normalizeLinkedInJob', () => {
    it('should map LinkedIn row to canonical vacancy fields', () => {
      const raw = {
        job_id: '12345',
        job_title: 'Node Developer',
        company_name: 'Acme',
        job_location: 'Remote, Worldwide',
        job_url: 'https://www.linkedin.com/jobs/view/12345',
        apply_url: 'https://apply.example/1',
        job_description: 'Build APIs with Node.js',
        salary_range: '100k-120k',
        seniority_level: 'Mid-Senior',
        employment_type: 'Full-time',
        time_posted: '2026-05-01'
      }

      const row = normalizeLinkedInJob(raw, 'linkedin', '3')

      assert.strictEqual(row.source, 'linkedin')
      assert.strictEqual(row.externalId, '12345')
      assert.strictEqual(row.title, 'Node Developer')
      assert.strictEqual(row.company, 'Acme')
      assert.strictEqual(row.locationType, 'remoto')
      assert.strictEqual(row.sourceUrl, raw.job_url)
      assert.strictEqual(row.applyUrl, raw.apply_url)
      assert.include(row.content, 'Node.js')
      assert.deepEqual(row.keywords, ['100k-120k', 'Full-time'])
      assert.instanceOf(row.datePosted, Date)
      assert.strictEqual(row.ingestionVersion, '3')
    })

    it('should handle missing title fields', () => {
      const row = normalizeLinkedInJob({ job_id: 'only-id' }, 'linkedin', '1')
      assert.strictEqual(row.title, '')
      assert.strictEqual(row.externalId, 'only-id')
    })

    it('should handle missing optional fields', () => {
      const row = normalizeLinkedInJob({ job_id: 1, title: 'T' }, 'linkedin', '1')
      assert.strictEqual(row.company, null)
      assert.strictEqual(row.sourceUrl, null)
      assert.strictEqual(row.datePosted, undefined)
    })

    it('should skip blank keyword parts', () => {
      const row = normalizeLinkedInJob(
        {
          job_id: '1',
          job_title: 'T',
          salary_range: '  ',
          employment_type: '',
          industry_type: 'Tech',
          job_function: null
        },
        'linkedin',
        '1'
      )
      assert.deepEqual(row.keywords, ['Tech'])
    })

    it('should use sourceUrl as applyUrl when apply missing', () => {
      const row = normalizeLinkedInJob(
        { job_id: '1', job_title: 'T', job_url: 'https://li/j/1' },
        'linkedin',
        '1'
      )
      assert.strictEqual(row.applyUrl, 'https://li/j/1')
    })
  })

  describe('buildLinkedInBodyText', () => {
    it('should join description salary and applicants', () => {
      const text = buildLinkedInBodyText({
        job_description: 'desc',
        salary_range: '50k',
        applicants: '100 applicants'
      })
      assert.include(text, 'desc')
      assert.include(text, '50k')
    })
  })

  describe('inferLinkedInLocationType', () => {
    it('should detect remoto hibrido presencial', () => {
      assert.strictEqual(inferLinkedInLocationType('fully remote role'), 'remoto')
      assert.strictEqual(inferLinkedInLocationType('hybrid NYC'), 'hibrido')
      assert.strictEqual(inferLinkedInLocationType('onsite only'), 'presencial')
      assert.isNull(inferLinkedInLocationType('New York'))
    })
  })

  describe('parseLinkedInDatePosted', () => {
    it('should parse ISO and reject invalid', () => {
      assert.instanceOf(parseLinkedInDatePosted('2026-05-01'), Date)
      assert.instanceOf(parseLinkedInDatePosted(new Date()), Date)
      assert.strictEqual(parseLinkedInDatePosted('bad'), undefined)
    })
  })

  describe('matchesIgnoreStackForIngest', () => {
    it('should match Python and not JavaScript', () => {
      assert.isTrue(
        matchesIgnoreStackForIngest({
          job_title: 'Python developer',
          job_description: 'django'
        })
      )
      assert.isFalse(
        matchesIgnoreStackForIngest({
          job_title: 'JavaScript engineer',
          job_description: 'react'
        })
      )
    })
  })

  describe('constructor', () => {
    it('should no-op fetch when API token is missing', async () => {
      const uut = new LinkedInJobSource({ config: {} })
      sandbox.stub(console, 'log')
      const rows = await uut.fetchVacancies()
      assert.deepEqual(rows, [])
      sinon.assert.calledWithMatch(console.log, /no API token/)
    })

    it('should apply built-in adapter defaults', () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 'tok' } })
      assert.strictEqual(uut._apiToken, 'tok')
      assert.strictEqual(uut._actorId, 'worldunboxer~rapid-linkedin-scraper')
      assert.strictEqual(uut._location, 'Worldwide')
      assert.strictEqual(
        uut._maxItemsPerQuery,
        LINKEDIN_DEFAULT_MAX_ITEMS_PER_QUERY
      )
      assert.strictEqual(uut._pollIntervalMs, 5000)
      assert.strictEqual(uut._pollMaxAttempts, 60)
      assert.isTrue(uut._useApifyProxy)
    })

    it('should accept numeric API token via String()', () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 999 } })
      assert.strictEqual(uut._apiToken, '999')
    })

    it('should build actor input with proxy by default', () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      const input = uut._buildActorInput('Node.js')
      assert.strictEqual(input.job_title, 'Node.js')
      assert.strictEqual(input.location, 'Worldwide')
      assert.strictEqual(input.jobs_entries, LINKEDIN_DEFAULT_MAX_ITEMS_PER_QUERY)
      assert.deepEqual(input.proxyConfiguration, { useApifyProxy: true })
    })

    it('should use empty config when constructor omits localConfig', () => {
      const uut = new LinkedInJobSource()
      assert.isObject(uut.config)
      assert.strictEqual(uut._apiToken, '')
    })

    it('should trim blank search keywords in actor input', () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      assert.strictEqual(uut._buildActorInput('   ').job_title, '')
    })
  })

  describe('_apifyRequest', () => {
    it('should call axios with token query param', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 'my-token' } })
      const axiosStub = sandbox.stub(axios, 'request').callsFake(async (config) => {
        assert.isTrue(config.validateStatus(200))
        assert.isFalse(config.validateStatus(500))
        return { data: { ok: true } }
      })

      const out = await uut._apifyRequest('get', 'datasets/ds1/items', {
        params: { clean: true }
      })
      assert.deepEqual(out, { ok: true })
      assert.strictEqual(
        axiosStub.firstCall.args[0].url,
        `${APIFY_API_BASE}/datasets/ds1/items`
      )
      assert.strictEqual(axiosStub.firstCall.args[0].params.token, 'my-token')
      assert.strictEqual(axiosStub.firstCall.args[0].params.clean, true)
    })

    it('should wrap axios errors', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(axios, 'request').rejects({
        response: { status: 401, statusText: 'Unauthorized', data: { error: 'bad' } },
        message: 'x'
      })

      try {
        await uut._apifyRequest('post', 'acts/x/runs')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '401')
        assert.include(err.message, 'bad')
      }
    })

    it('should use ERR when no response status', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(axios, 'request').rejects({ message: 'network' })

      try {
        await uut._apifyRequest('get', 'actor-runs/1')
      } catch (err) {
        assert.include(err.message, 'ERR')
      }
    })
  })

  describe('Apify HTTP wrappers', () => {
    it('should delegate to _apifyRequest for sync run and dataset fetch', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      const job = { job_id: '9', job_title: 'Engineer' }
      sandbox
        .stub(uut, '_apifyRequest')
        .onFirstCall()
        .resolves([job])
        .onSecondCall()
        .resolves({ data: { id: 'run-2', defaultDatasetId: 'ds-2' } })
        .onThirdCall()
        .resolves({ data: { id: 'run-2', status: 'SUCCEEDED' } })
        .onCall(3)
        .resolves([job])

      const syncRows = await uut._runSyncGetDatasetItems({ job_title: 'node' })
      assert.strictEqual(syncRows.length, 1)

      const started = await uut._startActorRun({ job_title: 'node' })
      assert.strictEqual(started.id, 'run-2')

      const run = await uut._getActorRun('run-2', 30)
      assert.strictEqual(run.status, 'SUCCEEDED')

      const items = await uut._getDatasetItems('ds-2')
      assert.strictEqual(items.length, 1)
    })
  })

  describe('_fetchWithAsyncPoll', () => {
    it('should poll until SUCCEEDED then fetch dataset', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      uut._pollIntervalMs = 1
      uut._pollMaxAttempts = 5
      const job = { job_id: '1', job_title: 'Dev' }
      sandbox.stub(uut, '_startActorRun').resolves({ id: 'run-1', status: 'RUNNING' })
      sandbox.stub(uut, '_getActorRun')
        .onFirstCall()
        .resolves({ id: 'run-1', status: 'RUNNING' })
        .onSecondCall()
        .resolves({
          id: 'run-1',
          status: 'SUCCEEDED',
          defaultDatasetId: 'ds-1'
        })
      sandbox.stub(uut, '_getDatasetItems').resolves([job])

      const rows = await uut._fetchWithAsyncPoll({ job_title: 'node' })
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(uut._getDatasetItems.firstCall.args[0], 'ds-1')
    })

    it('should throw when run id missing', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(uut, '_startActorRun').resolves({ status: 'READY' })

      try {
        await uut._fetchWithAsyncPoll({})
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'missing id')
      }
    })

    it('should throw on ABORTED status', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(uut, '_startActorRun').resolves({ id: 'r1', status: 'ABORTED' })

      try {
        await uut._fetchWithAsyncPoll({})
      } catch (err) {
        assert.include(err.message, 'ABORTED')
      }
    })

    it('should throw on FAILED status', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      uut._pollIntervalMs = 1
      uut._pollMaxAttempts = 2
      sandbox.stub(uut, '_startActorRun').resolves({ id: 'r1', status: 'FAILED' })

      try {
        await uut._fetchWithAsyncPoll({})
      } catch (err) {
        assert.include(err.message, 'FAILED')
      }
    })

    it('should throw on TIMED-OUT status', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(uut, '_startActorRun').resolves({ id: 'r1', status: 'TIMED-OUT' })

      try {
        await uut._fetchWithAsyncPoll({})
      } catch (err) {
        assert.include(err.message, 'TIMED-OUT')
      }
    })

    it('should treat missing run status as non-terminal and poll', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      uut._pollIntervalMs = 1
      uut._pollMaxAttempts = 2
      sandbox.stub(uut, '_startActorRun').resolves({ id: 'r1' })
      sandbox.stub(uut, '_getActorRun').resolves({ id: 'r1', status: 'RUNNING' })

      try {
        await uut._fetchWithAsyncPoll({})
      } catch (err) {
        assert.include(err.message, 'poll budget')
      }
    })

    it('should throw when poll budget exceeded', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      uut._pollIntervalMs = 1
      uut._pollMaxAttempts = 2
      sandbox.stub(uut, '_startActorRun').resolves({ id: 'r1', status: 'RUNNING' })
      sandbox.stub(uut, '_getActorRun').resolves({ id: 'r1', status: 'RUNNING' })

      try {
        await uut._fetchWithAsyncPoll({})
      } catch (err) {
        assert.include(err.message, 'poll budget')
      }
    })

    it('should throw when dataset id missing after success', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(uut, '_startActorRun').resolves({ id: 'r1', status: 'SUCCEEDED' })

      try {
        await uut._fetchWithAsyncPoll({})
      } catch (err) {
        assert.include(err.message, 'defaultDatasetId')
      }
    })
  })

  describe('_fetchForQuery', () => {
    it('should use sync endpoint on success', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(uut, '_runSyncGetDatasetItems').resolves([{ job_id: '1', job_title: 'A' }])

      const rows = await uut._fetchForQuery('Node')
      assert.strictEqual(rows.length, 1)
    })

    it('should fall back to async poll on timeout errors', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(console, 'log')
      sandbox
        .stub(uut, '_runSyncGetDatasetItems')
        .rejects(new Error('LinkedInJobSource x failed: 504 Gateway Timeout'))
      sandbox.stub(uut, '_fetchWithAsyncPoll').resolves([{ job_id: '2', job_title: 'B' }])

      const rows = await uut._fetchForQuery('React')
      assert.strictEqual(rows[0].job_id, '2')
      sinon.assert.calledOnce(uut._fetchWithAsyncPoll)
    })

    it('should fall back when error message includes timed out', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(console, 'log')
      sandbox
        .stub(uut, '_runSyncGetDatasetItems')
        .rejects(new Error('request timed out'))
      sandbox.stub(uut, '_fetchWithAsyncPoll').resolves([])

      await uut._fetchForQuery('Node')
      sinon.assert.calledOnce(uut._fetchWithAsyncPoll)
    })

    it('should rethrow non-timeout sync errors', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox
        .stub(uut, '_runSyncGetDatasetItems')
        .rejects(new Error('LinkedInJobSource x failed: 403 Forbidden'))

      try {
        await uut._fetchForQuery('x')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '403')
      }
    })
  })

  describe('fetchVacancies', () => {
    beforeEach(() => {
      sandbox.stub(console, 'log')
    })

    it('should merge queries dedupe and normalize', async () => {
      const uut = new LinkedInJobSource({
        config: { apifyApiToken: 't', jobIngestionVersion: '8' }
      })
      sandbox.stub(uut, '_fetchForQuery')
        .onFirstCall()
        .resolves([
          {
            job_id: '1',
            job_title: 'Node job',
            job_location: 'Remote',
            job_description: 'express'
          }
        ])
        .onSecondCall()
        .resolves([
          { job_id: '1', job_title: 'dup' },
          {
            job_id: '2',
            job_title: 'React job',
            job_url: 'https://linkedin.com/jobs/2',
            job_description: 'vite'
          }
        ])
      uut._searchQueries = PROFILE_STACK_SEARCH_QUERIES.slice(0, 2)

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 2)
      assert.strictEqual(rows[0].ingestionVersion, '8')
      assert.strictEqual(uut._fetchForQuery.callCount, 2)
    })

    it('should skip ignore-stack jobs and rows without id', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(uut, '_fetchForQuery').resolves([
        { job_id: '1', job_title: 'Python dev', job_description: 'ml' },
        { job_title: 'no id' },
        {
          job_id: '2',
          job_title: 'Node dev',
          job_description: 'api',
          job_url: 'https://x'
        }
      ])
      uut._searchQueries = ['one']

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].externalId, '2')
      sinon.assert.calledWithMatch(console.log, /skipped 1 ignored-stack/)
    })

    it('should log rows before dedupe when duplicates exist', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(uut, '_fetchForQuery').resolves([
        { job_id: '1', job_title: 'A' },
        { job_id: '1', job_title: 'A dup' }
      ])
      uut._searchQueries = ['q']

      await uut.fetchVacancies()
      sinon.assert.calledWithMatch(console.log, /rows before dedupe/)
    })

    it('should dedupe by job_url when job_id missing', async () => {
      const uut = new LinkedInJobSource({ config: { apifyApiToken: 't' } })
      sandbox.stub(uut, '_fetchForQuery').resolves([
        { job_title: 'A', job_url: 'https://li/j/9' },
        { job_title: 'B', job_url: 'https://li/j/9' }
      ])
      uut._searchQueries = ['q']

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })
  })
})
