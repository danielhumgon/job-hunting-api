/*
  Unit tests for Lever job source.
*/

import axios from 'axios'
import { assert } from 'chai'
import sinon from 'sinon'

import LeverJobSource, {
  LEVER_DEFAULT_LIMIT,
  LEVER_DEFAULT_MAX_PAGES_PER_SITE,
  buildLeverBodyText,
  mapLeverWorkplaceType,
  matchesIgnoreStackForIngest,
  matchesStackProfile,
  normalizeLeverPosting,
  parseLeverCreatedAt,
  parseLeverSites,
  stripLeverHtml
} from '../../../../src/adapters/job-sources/lever.js'

describe('#LeverJobSource', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('normalizeLeverPosting', () => {
    it('should map Lever posting to canonical vacancy fields', () => {
      const raw = {
        id: '33538a2f-d27d-4a96-8f05-fa4b0e4d940e',
        text: 'Senior Node Engineer',
        workplaceType: 'remote',
        country: 'US',
        createdAt: 1553186035299,
        categories: {
          team: 'Engineering',
          department: 'Product',
          location: 'Remote - US',
          commitment: 'Full-time'
        },
        descriptionPlain: 'Build APIs with Node.js and Express.',
        hostedUrl: 'https://jobs.lever.co/acme/33538a2f',
        applyUrl: 'https://jobs.lever.co/acme/33538a2f/apply',
        lists: [{ text: 'Requirements', content: '<li>MongoDB</li>' }]
      }

      const row = normalizeLeverPosting(raw, 'acme', 'lever', '3')

      assert.strictEqual(row.source, 'lever')
      assert.strictEqual(row.externalId, '33538a2f-d27d-4a96-8f05-fa4b0e4d940e')
      assert.strictEqual(row.title, 'Senior Node Engineer')
      assert.strictEqual(row.company, 'acme')
      assert.strictEqual(row.locationType, 'remoto')
      assert.strictEqual(row.category, 'Engineering')
      assert.include(row.content, 'Node.js')
      assert.include(row.keywords, 'Full-time')
      assert.strictEqual(row.sourceUrl, 'https://jobs.lever.co/acme/33538a2f')
      assert.instanceOf(row.datePosted, Date)
    })

    it('should infer hybrid from workplaceType', () => {
      const row = normalizeLeverPosting(
        { id: '1', text: 'Dev', workplaceType: 'hybrid', descriptionPlain: 'x' },
        'co',
        'lever',
        '1'
      )
      assert.strictEqual(row.locationType, 'hibrido')
    })

    it('should prefer team over department for category', () => {
      const row = normalizeLeverPosting(
        {
          id: '1',
          text: 'Dev',
          categories: { team: 'Eng', department: 'Ops' },
          descriptionPlain: 'x'
        },
        'co',
        'lever',
        '1'
      )
      assert.strictEqual(row.category, 'Eng')
      assert.include(row.keywords, 'Eng')
    })

    it('should truncate long summary', () => {
      const row = normalizeLeverPosting(
        {
          id: '1',
          text: 'T',
          descriptionPlain: 'a'.repeat(500)
        },
        'co',
        'lever',
        '1'
      )
      assert.include(row.summary, '…')
    })
  })

  describe('matchesStackProfile', () => {
    it('should match when two tokens from a query appear', () => {
      assert.isTrue(
        matchesStackProfile('Senior Node.js developer using Express and MongoDB')
      )
      assert.isFalse(matchesStackProfile('Sales account executive only'))
      assert.isFalse(matchesStackProfile(''))
    })

    it('should ignore very short tokens in queries', () => {
      assert.isFalse(matchesStackProfile('ai ip p2p only', ['ai ip']))
    })
  })

  describe('matchesIgnoreStackForIngest', () => {
    it('should match Python roles', () => {
      assert.isTrue(
        matchesIgnoreStackForIngest({
          text: 'Python Engineer',
          descriptionPlain: 'django'
        })
      )
      assert.isFalse(matchesIgnoreStackForIngest(null))
      assert.isFalse(matchesIgnoreStackForIngest({ id: '1' }))
      assert.isTrue(
        matchesIgnoreStackForIngest({
          categories: { team: 'Java Platform' }
        })
      )
    })
  })

  describe('parseLeverSites', () => {
    it('should split comma-separated slugs', () => {
      assert.deepEqual(parseLeverSites('a, b ,c'), ['a', 'b', 'c'])
      assert.deepEqual(parseLeverSites(''), [])
    })
  })

  describe('constructor', () => {
    it('should accept empty constructor args', () => {
      const uut = new LeverJobSource()
      assert.deepEqual(uut._sites, [])
      assert.strictEqual(uut._limit, LEVER_DEFAULT_LIMIT)
    })

    it('should use leverSites array from config when already parsed', () => {
      const uut = new LeverJobSource({
        config: { leverSites: ['parsed-a', 'parsed-b'] }
      })
      assert.deepEqual(uut._sites, ['parsed-a', 'parsed-b'])
    })

    it('should no-op when no sites configured', async () => {
      const uut = new LeverJobSource({ config: {} })
      sandbox.stub(console, 'log')
      const rows = await uut.fetchVacancies()
      assert.deepEqual(rows, [])
      sinon.assert.calledWithMatch(console.log, /no sites/)
    })
  })

  describe('_getPostingsPage', () => {
    it('should GET site postings with mode, limit, skip, and teams', async () => {
      const uut = new LeverJobSource({
        config: {
          leverSites: ['acme'],
          leverTeams: ['Engineering', 'Product']
        }
      })
      sandbox.stub(axios, 'get').resolves({ data: [] })

      await uut._getPostingsPage('acme', 100)
      const url = axios.get.firstCall.args[0]
      assert.include(url, '/acme')
      const params = axios.get.firstCall.args[1].params
      assert.strictEqual(params.get('mode'), 'json')
      assert.strictEqual(params.get('limit'), String(uut._limit))
      assert.strictEqual(params.get('skip'), '100')
      assert.strictEqual(params.getAll('team').length, 2)
    })

    it('should wrap axios errors', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['x'] } })
      sandbox.stub(axios, 'get').rejects({
        response: { status: 404, statusText: 'Not Found', data: {} },
        message: 'x'
      })

      try {
        await uut._getPostingsPage('bad', 0)
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '404')
        assert.include(err.message, 'bad')
      }
    })

    it('should include response body snippet when present', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['x'] } })
      sandbox.stub(axios, 'get').rejects({
        response: { status: 500, statusText: 'Err', data: { msg: 'fail' } }
      })

      try {
        await uut._getPostingsPage('s', 0)
      } catch (err) {
        assert.include(err.message, 'fail')
      }
    })

    it('should use ERR when no response status', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['x'] } })
      sandbox.stub(axios, 'get').rejects({ message: 'network' })

      try {
        await uut._getPostingsPage('s', 0)
      } catch (err) {
        assert.include(err.message, 'ERR')
      }
    })
  })

  describe('_fetchSitePostings', () => {
    it('should paginate until short page', async () => {
      const uut = new LeverJobSource({
        config: { leverSites: ['s'], leverMaxPagesPerSite: 3, leverLimit: 2 }
      })
      sandbox.stub(uut, '_getPostingsPage')
        .onFirstCall()
        .resolves([{ id: '1' }, { id: '2' }])
        .onSecondCall()
        .resolves([{ id: '3' }])

      const rows = await uut._fetchSitePostings('s')
      assert.strictEqual(rows.length, 3)
      assert.strictEqual(uut._getPostingsPage.callCount, 2)
    })
  })

  describe('fetchVacancies', () => {
    beforeEach(() => {
      sandbox.stub(console, 'log')
    })

    it('should filter stack, remote, dedupe, and normalize', async () => {
      const uut = new LeverJobSource({
        config: {
          leverSites: ['leverdemo'],
          jobIngestionVersion: '8',
          leverRemoteOnly: true
        }
      })
      sandbox.stub(uut, '_fetchSitePostings').resolves([
        {
          id: '1',
          text: 'Node.js Backend',
          workplaceType: 'remote',
          descriptionPlain: 'Express MongoDB APIs',
          hostedUrl: 'https://jobs.lever.co/x/1'
        },
        {
          id: '2',
          text: 'On-site Java',
          workplaceType: 'on-site',
          descriptionPlain: 'Java only'
        },
        {
          id: '1',
          text: 'dup',
          workplaceType: 'remote',
          descriptionPlain: 'Express MongoDB'
        },
        {
          id: '3',
          text: 'Sales',
          workplaceType: 'remote',
          descriptionPlain: 'quota hunting'
        }
      ])

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].externalId, '1')
      assert.strictEqual(rows[0].ingestionVersion, '8')
      sinon.assert.calledWithMatch(console.log, /skipped/)
    })

    it('should skip ignore-stack and log teams when configured', async () => {
      const uut = new LeverJobSource({
        config: {
          leverSites: ['co'],
          leverTeams: ['Engineering'],
          leverRemoteOnly: false
        }
      })
      sandbox.stub(uut, '_fetchSitePostings').resolves([
        {
          id: 'p1',
          text: 'Python role',
          workplaceType: 'remote',
          descriptionPlain: 'django flask'
        },
        {
          id: 'n1',
          text: 'Node role',
          workplaceType: 'hybrid',
          descriptionPlain: 'Express MongoDB stack'
        }
      ])

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      sinon.assert.calledWithMatch(console.log, /teams=Engineering/)
      sinon.assert.calledWithMatch(console.log, /ignore-stack/)
    })

    it('should fetch multiple sites in parallel', async () => {
      const uut = new LeverJobSource({
        config: { leverSites: ['a', 'b'] }
      })
      const stub = sandbox.stub(uut, '_fetchSitePostings').resolves([])

      await uut.fetchVacancies()
      assert.strictEqual(stub.callCount, 2)
      assert.strictEqual(stub.firstCall.args[0], 'a')
      assert.strictEqual(stub.secondCall.args[0], 'b')
    })
  })

  describe('defaults', () => {
    it('should apply default limit and max pages', () => {
      const uut = new LeverJobSource({ config: { leverSites: ['x'] } })
      assert.strictEqual(uut._limit, LEVER_DEFAULT_LIMIT)
      assert.strictEqual(
        uut._maxPagesPerSite,
        LEVER_DEFAULT_MAX_PAGES_PER_SITE
      )
      assert.isTrue(uut._remoteOnly)
    })

    it('should fallback invalid limit and max pages', () => {
      const uut = new LeverJobSource({
        config: {
          leverSites: 'solo',
          leverLimit: 'bad',
          leverMaxPagesPerSite: 0
        }
      })
      assert.deepEqual(uut._sites, ['solo'])
      assert.strictEqual(uut._limit, LEVER_DEFAULT_LIMIT)
      assert.strictEqual(
        uut._maxPagesPerSite,
        LEVER_DEFAULT_MAX_PAGES_PER_SITE
      )
    })
  })

  describe('_fetchSitePostings edge cases', () => {
    it('should treat non-array response as empty page', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['s'] } })
      sandbox.stub(uut, '_getPostingsPage').resolves(null)
      const rows = await uut._fetchSitePostings('s')
      assert.deepEqual(rows, [])
    })
  })

  describe('helpers', () => {
    it('should cover stripLeverHtml and parseLeverCreatedAt edge cases', () => {
      assert.strictEqual(stripLeverHtml(''), '')
      assert.strictEqual(parseLeverCreatedAt('nope'), undefined)
      assert.strictEqual(mapLeverWorkplaceType('on-site'), 'presencial')
    })

    it('should normalize with department when team missing', () => {
      const row = normalizeLeverPosting(
        {
          id: '9',
          text: 'Role',
          categories: { department: 'Ops' },
          descriptionPlain: 'text'
        },
        'co',
        'lever',
        '1'
      )
      assert.strictEqual(row.category, 'Ops')
    })

    it('should infer location from text when workplaceType absent', () => {
      const row = normalizeLeverPosting(
        {
          id: '1',
          text: 'Engineer',
          descriptionPlain: 'Fully remote worldwide'
        },
        'co',
        'lever',
        '1'
      )
      assert.strictEqual(row.locationType, 'remoto')

      const hybrid = normalizeLeverPosting(
        { id: '2', text: 'Dev', descriptionPlain: 'hybrid schedule in office' },
        'co',
        'lever',
        '1'
      )
      assert.strictEqual(hybrid.locationType, 'hibrido')

      const onsite = normalizeLeverPosting(
        { id: '3', text: 'Dev', descriptionPlain: 'onsite only in NYC' },
        'co',
        'lever',
        '1'
      )
      assert.strictEqual(onsite.locationType, 'presencial')
    })

    it('should set company null when site slug empty', () => {
      const row = normalizeLeverPosting(
        { id: '1', text: 'T', descriptionPlain: 'x' },
        '',
        'lever',
        '1'
      )
      assert.isNull(row.company)
    })

    it('should build body from list HTML content and openingPlain', () => {
      const text = buildLeverBodyText({
        openingPlain: 'Intro',
        lists: [{ content: '<p>React</p>' }]
      })
      assert.include(text, 'Intro')
      assert.include(text, 'React')
    })

    it('should handle empty externalId when id missing', () => {
      const row = normalizeLeverPosting({ text: 'T' }, 'co', 'lever', '1')
      assert.strictEqual(row.externalId, '')
    })
  })

  describe('fetchVacancies edge cases', () => {
    beforeEach(() => {
      sandbox.stub(console, 'log')
    })

    it('should skip rows without id and allow on-site when remoteOnly false', async () => {
      const uut = new LeverJobSource({
        config: { leverSites: ['co'], leverRemoteOnly: false }
      })
      sandbox.stub(uut, '_fetchSitePostings').resolves([
        { title: 'no id' },
        {
          id: '1',
          text: 'Node.js role',
          workplaceType: 'on-site',
          descriptionPlain: 'Express MongoDB'
        }
      ])

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].externalId, '1')
    })

    it('should log dedupe without skip breakdown when only duplicates removed', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['co'] } })
      sandbox.stub(uut, '_fetchSitePostings').resolves([
        {
          id: '1',
          text: 'Node.js',
          workplaceType: 'remote',
          descriptionPlain: 'Express MongoDB'
        },
        {
          id: '1',
          text: 'dup',
          workplaceType: 'remote',
          descriptionPlain: 'Express MongoDB'
        }
      ])

      await uut.fetchVacancies()
      const msg = console.log.lastCall.args[0]
      assert.include(msg, 'before filter')
      assert.notInclude(msg, 'skipped')
    })

    it('should omit filter detail in log when all rows match', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['co'] } })
      sandbox.stub(uut, '_fetchSitePostings').resolves([
        {
          id: '1',
          text: 'Node.js',
          workplaceType: 'remote',
          descriptionPlain: 'Express MongoDB'
        }
      ])

      await uut.fetchVacancies()
      const msg = console.log.lastCall.args[0]
      assert.notInclude(msg, 'before filter')
    })

    it('should use leverTeams array from config directly', () => {
      const uut = new LeverJobSource({
        config: { leverSites: ['a'], leverTeams: ['Eng'] }
      })
      assert.deepEqual(uut._teams, ['Eng'])
    })

    it('should skip onsite variant workplaceType when remoteOnly', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['co'] } })
      sandbox.stub(uut, '_fetchSitePostings').resolves([
        {
          id: '1',
          text: 'Node.js',
          workplaceType: 'onsite',
          descriptionPlain: 'Express MongoDB'
        }
      ])

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 0)
      sinon.assert.calledWithMatch(console.log, /on-site/)
    })

    it('should match stack using categories.location in haystack', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['co'] } })
      sandbox.stub(uut, '_fetchSitePostings').resolves([
        {
          id: '1',
          text: 'Role',
          workplaceType: 'remote',
          categories: { location: 'Node Express MongoDB hub' },
          descriptionPlain: ''
        }
      ])

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })

    it('should match stack using body only when location absent', async () => {
      const uut = new LeverJobSource({ config: { leverSites: ['co'] } })
      sandbox.stub(uut, '_fetchSitePostings').resolves([
        {
          id: '1',
          text: 'Title',
          workplaceType: 'remote',
          descriptionPlain: 'React Next.js Vite Tailwind CSS role'
        }
      ])

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })
  })
})
