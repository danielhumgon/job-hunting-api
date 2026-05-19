/*
  Mocks for the Adapter library.
*/

class IpfsAdapter {
  constructor () {
    this.ipfs = {
      files: {
        stat: () => {}
      }
    }
  }
}

class IpfsCoordAdapter {
  constructor () {
    this.ipfsCoord = {
      adapters: {
        ipfs: {
          connectToPeer: async () => {}
        }
      },
      useCases: {
        peer: {
          sendPrivateMessage: () => {}
        }
      },
      thisNode: {}
    }
  }
}

const ipfs = {
  ipfsAdapter: new IpfsAdapter(),
  ipfsCoordAdapter: new IpfsCoordAdapter(),
  getStatus: async () => {},
  getPeers: async () => {},
  getRelays: async () => {}
}
ipfs.ipfs = ipfs.ipfsAdapter.ipfs

const localdb = {
  Users: class Users {
    static findById () {}
    static find () {}
    static findOne () {
      return {
        validatePassword: localdb.validatePassword
      }
    }

    async save () {
      return {}
    }

    generateToken () {
      return '123'
    }

    toJSON () {
      return {}
    }

    async remove () {
      return true
    }

    async validatePassword () {
      return true
    }
  },

  Usage: class Usage {
    static findById () {}
    static find () {}
    static findOne () {
      return {
        validatePassword: localdb.validatePassword
      }
    }

    async save () {
      return {}
    }

    generateToken () {
      return '123'
    }

    toJSON () {
      return {}
    }

    async remove () {
      return true
    }

    async validatePassword () {
      return true
    }
    static async deleteMany(){
      return true
    }
  },

  validatePassword: () => {
    return true
  },

  Vacancy: class Vacancy {
    static async updateOne () {
      return {
        acknowledged: true,
        upsertedCount: 0,
        modifiedCount: 0,
        matchedCount: 0
      }
    }

    static find () {
      const chain = {
        sort () {
          return chain
        },
        skip () {
          return chain
        },
        limit () {
          return chain
        },
        lean: async () => []
      }
      return chain
    }

    static async countDocuments () {
      return 0
    }

    static findById () {
      return {
        lean: async () => null
      }
    }
  }
}

export default {
  config: {
    jobIngestionVersion: '1',
    llmModel: 'test',
    llmPromptVersion: 'v1'
  },
  ipfs,
  localdb,
  jobSources: {
    sources: [],
    sourcesSlug: ['vacantesdigitales', 'x'],
    getActiveAdapters () {
      return this.sources
    },
    async start () {},
    async ingestVacancies () {
      return {
        vacancies: [],
        metrics: {
          phase: 'fetch',
          durationMs: 0,
          totalRows: 0,
          sourcesTotal: 0,
          sourcesSkippedNoFetcher: 0,
          sourcesFailed: 0,
          perSource: []
        }
      }
    }
  },
  llm: {
    score: async () => ({
      llmStatus: 'completed',
      llmScore: 0.5,
      llmReasons: [],
      llmFlags: [],
      llmModel: 'test',
      llmPromptVersion: 'v1',
      llmClassifiedAt: new Date(),
      llmRawOutput: {},
      belowMinScore: false
    })
  }
}
