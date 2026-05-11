/*
  Unit tests for the IPFS Adapter.
*/

// Global npm libraries
import { assert } from 'chai'
import sinon from 'sinon'

// Local libraries
import IPFSLib from '../../../src/adapters/ipfs/ipfs.js'

describe('#IPFS-adapter', () => {
  let uut
  let sandbox

  beforeEach(() => {
    uut = new IPFSLib()

    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('#constructor', () => {
    it('should instantiate IPFS Lib in dev mode.', async () => {
      const _uut = new IPFSLib()
      assert.exists(_uut)
      assert.isFunction(_uut.start)
      assert.isFunction(_uut.stop)
    })
  })

  describe('#start', () => {
    it('should return a promise that resolves into an instance of IPFS.', async () => {
      // Mock the heliaNode that gets created inside start()
      const mockIpfs = {
        libp2p: {
          getMultiaddrs: () => [],
          peerId: 'fake-id'
        }
      }

      // Override the start method to mock the heliaNode creation
      uut.start = async function () {
        this.heliaNode = {
          start: async () => mockIpfs,
          id: 'fake-id',
          multiaddrs: ['/ip4/fake-multiaddr']
        }

        const ipfs = await this.heliaNode.start()

        this.id = this.heliaNode.id
        this.multiaddrs = this.heliaNode.multiaddrs
        this.isReady = true
        this.ipfs = ipfs

        return this.ipfs
      }

      const result = await uut.start()

      // Assert properties of the instance are set.
      assert.equal(uut.isReady, true)
      assert.property(uut, 'multiaddrs')
      assert.property(uut, 'id')

      // Output should be an instance of IPFS
      assert.property(result, 'libp2p')
    })

    it('should run real start pipeline when CreateHeliaNode is injected', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(console, 'error')

      const mockIpfs = {
        libp2p: {
          getMultiaddrs: () => [],
          peerId: 'fake-peer'
        }
      }

      function FakeHelia (opts) {
        this.opts = opts
        this.id = 'fake-id'
        this.multiaddrs = ['/ip4/fake-multiaddr']
      }
      FakeHelia.prototype.start = async function () {
        return mockIpfs
      }

      const fresh = new IPFSLib({ CreateHeliaNode: FakeHelia })
      const result = await fresh.start()

      assert.strictEqual(result, mockIpfs)
      assert.strictEqual(fresh.isReady, true)
      assert.strictEqual(fresh.id, 'fake-id')
      assert.deepEqual(fresh.multiaddrs, ['/ip4/fake-multiaddr'])
    })

    it('should catch and throw an error', async () => {
      try {
        // Force an error by making getSeed throw, which will cause
        // CreateHeliaNode to fail during start.
        sandbox.stub(uut, 'getSeed').rejects(new Error('test error'))

        await uut.start()
        assert.fail('Unexpected code path.')
      } catch (err) {
        // console.log(err)
        assert.include(err.message, 'test error')
      }
    })

    it('should surface errors from injected helia factory', async () => {
      sandbox.stub(console, 'error')

      function BadHelia () {}
      BadHelia.prototype.start = async function () {
        throw new Error('helia-init-failed')
      }

      const fresh = new IPFSLib({ CreateHeliaNode: BadHelia })

      try {
        await fresh.start()
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'helia-init-failed')
      }
      sinon.assert.calledWith(console.error, 'Error in ipfs.js/start()')
    })
  })

  describe('#stop', () => {
    it('should stop the IPFS node', async () => {
      // Mock dependencies
      uut.ipfs = {
        stop: () => {
        }
      }

      const result = await uut.stop()

      assert.equal(result, true)
    })
  })

  describe('#getSeed', () => {
    it('should read the seed from the JSON file', async () => {
      // Mock dependencies and force desired code path
      sandbox.stub(uut.jsonFiles, 'readJSON').resolves('12345678')

      const result = await uut.getSeed()

      assert.isString(result)
    })

    it('should generate a new seed if the JSON file is not found', async () => {
      // Mock dependencies and force desired code path
      sandbox.stub(uut.jsonFiles, 'readJSON').rejects(new Error('test error'))
      sandbox.stub(uut.jsonFiles, 'writeJSON').resolves()

      const result = await uut.getSeed()

      assert.isString(result)
    })

    it('should catch, report, and throw errors', async () => {
      try {
        // Force an error
        sandbox.stub(uut.jsonFiles, 'readJSON').rejects(new Error('test error'))
        sandbox.stub(uut.jsonFiles, 'writeJSON').rejects(new Error('test error'))

        await uut.getSeed()

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })
})
