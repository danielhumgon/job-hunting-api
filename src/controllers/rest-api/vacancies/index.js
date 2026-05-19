/*
  REST API router for /vacancies
*/

import Router from 'koa-router'

import VacanciesRESTControllerLib from './controller.js'

class VacanciesRouter {
  constructor (localConfig = {}) {
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of Adapters library required when instantiating Vacancies REST router.'
      )
    }
    this.useCases = localConfig.useCases
    if (!this.useCases) {
      throw new Error(
        'Instance of Use Cases library required when instantiating Vacancies REST router.'
      )
    }

    const dependencies = {
      adapters: this.adapters,
      useCases: this.useCases
    }

    this.vacanciesController = new VacanciesRESTControllerLib(dependencies)
    const baseUrl = '/vacancies'
    this.router = new Router({ prefix: baseUrl })
    this.attach = this.attach.bind(this)
  }

  attach (app) {
    if (!app) {
      throw new Error(
        'Must pass app object when attaching REST API controllers.'
      )
    }

    this.router.get(
      '/apply',
      async (ctx, next) => this.vacanciesController.listAppliedVacancies(ctx, next)
    )
    this.router.post(
      '/apply',
      async (ctx, next) => this.vacanciesController.postApplyVacancy(ctx, next)
    )
    this.router.post(
      '/filter',
      async (ctx, next) => this.vacanciesController.filterVacancies(ctx, next)
    )
    this.router.get(
      '/sources',
      async (ctx, next) => this.vacanciesController.listVacancySources(ctx, next)
    )
    this.router.get(
      '/:page(\\d+)',
      async (ctx, next) => this.vacanciesController.listVacancies(ctx, next)
    )
    this.router.get('/:id', async (ctx, next) => this.vacanciesController.getVacancy(ctx, next))
    this.router.put('/:id', async (ctx, next) => this.vacanciesController.updateVacancy(ctx, next))
    this.router.delete('/:id', async (ctx, next) => this.vacanciesController.deleteVacancy(ctx, next))

    app.use(this.router.routes())
    app.use(this.router.allowedMethods())
  }
}

export default VacanciesRouter
