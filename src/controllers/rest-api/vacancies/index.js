/*
  REST API router for /api/v1/vacancies
*/

import Router from 'koa-router'

import VacanciesRESTControllerLib from './controller.js'

let _this

class VacanciesRouter {
  constructor (localConfig = {}) {
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of Adapters library required when instantiating Vacancies REST router.'
      )
    }

    const dependencies = {
      adapters: this.adapters
    }

    this.vacanciesController = new VacanciesRESTControllerLib(dependencies)
    const baseUrl = '/api/v1/vacancies'
    this.router = new Router({ prefix: baseUrl })
    _this = this
  }

  attach (app) {
    if (!app) {
      throw new Error(
        'Must pass app object when attaching REST API controllers.'
      )
    }

    this.router.get('/', async (ctx, next) => _this.vacanciesController.listVacancies(ctx, next))
    this.router.get('/:id', async (ctx, next) => _this.vacanciesController.getVacancy(ctx, next))

    app.use(this.router.routes())
    app.use(this.router.allowedMethods())
  }
}

export default VacanciesRouter
