/*
  Mocks for the use cases.
*/
/* eslint-disable */

class UserUseCaseMock {
  async createUser(userObj) {
    return {}
  }

  async getAllUsers() {
    return true
  }

  async getUser(params) {
    return true
  }

  async updateUser(existingUser, newData) {
    return true
  }

  async deleteUser(user) {
    return true
  }

  async authUser(login, passwd) {
    return {
      generateToken: () => {}
    }
  }
}

class UsageUseCaseMock {
  async cleanUsage() {
    return {}
  }

  async getRestSummary() {
    return true
  }

  async getTopIps(params) {
    return true
  }

  async getTopEndpoints(existingUser, newData) {
    return true
  }

  async clearUsage() {
    return true
  }

  async saveUsage() {
    return true
  }
}

class IngestionUseCaseMock {
  async ingestVacancies () {
    return {
      ok: true,
      metrics: {
        phase: 'ingestVacancies',
        fetched: 0,
        durationMs: 0
      }
    }
  }
}

class VacancyUseCaseMock {
  async listVacancies () {
    return { data: [], pagination: { page: 1, limit: 10, total: 0, pages: 1 } }
  }

  async getVacancy () {
    return { _id: '507f191e810c19729de860ea', title: 't' }
  }

  async updateVacancy () {
    return { _id: '507f191e810c19729de860ea', title: 'updated' }
  }

  async deleteVacancy () {}

  async listAppliedVacancies () {
    return { data: [] }
  }

  async markVacancyApplied () {
    return { _id: '507f191e810c19729de860ea', applied: true, appliedAt: new Date() }
  }
}

class UseCasesMock {
  constuctor(localConfig = {}) {
    // this.user = new UserUseCaseMock(localConfig)
  }

  user = new UserUseCaseMock()
  usage = new UsageUseCaseMock()
  ingestion = new IngestionUseCaseMock()
  vacancy = new VacancyUseCaseMock()
}

export default UseCasesMock;
