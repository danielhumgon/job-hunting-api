/*
  REST API for /api/v1/vacancies
*/

import wlogger from '../../../adapters/wlogger.js'

class VacanciesRESTControllerLib {
  constructor (localConfig = {}) {
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of Adapters library required when instantiating /vacancies REST Controller.'
      )
    }

    this.listVacancies = this.listVacancies.bind(this)
    this.getVacancy = this.getVacancy.bind(this)
    this.handleError = this.handleError.bind(this)
  }

  handleError (ctx, err, status = 422) {
    wlogger.error('Error in vacancies controller: ', err)
    ctx.status = err.status || status
    ctx.body = err.message || 'Error'
  }

  async listVacancies (ctx) {
    try {
      const result = await this.adapters.localdb.listVacancies(ctx.query)
      ctx.body = result
    } catch (err) {
      this.handleError(ctx, err)
    }
  }

  async getVacancy (ctx) {
    try {
      const row = await this.adapters.localdb.getVacancyById(ctx.params.id)
      if (!row) {
        ctx.status = 404
        ctx.body = 'Vacancy not found'
        return
      }
      ctx.body = row
    } catch (err) {
      this.handleError(ctx, err)
    }
  }
}

export default VacanciesRESTControllerLib
