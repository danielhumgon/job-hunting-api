/*
  REST API for /vacancies
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
    this.useCases = localConfig.useCases
    if (!this.useCases) {
      throw new Error(
        'Instance of Use Cases library required when instantiating /vacancies REST Controller.'
      )
    }

    this.listVacancies = this.listVacancies.bind(this)
    this.listAppliedVacancies = this.listAppliedVacancies.bind(this)
    this.postApplyVacancy = this.postApplyVacancy.bind(this)
    this.getVacancy = this.getVacancy.bind(this)
    this.updateVacancy = this.updateVacancy.bind(this)
    this.deleteVacancy = this.deleteVacancy.bind(this)
    this.filterVacancies = this.filterVacancies.bind(this)
    this.listVacancySources = this.listVacancySources.bind(this)
    this.handleError = this.handleError.bind(this)
  }

  handleError (ctx, err, status = 422) {
    wlogger.error('Error in vacancies controller: ', err)
    ctx.status = err.status || status
    ctx.body = err.message || 'Error'
  }

  updatePayload (ctx) {
    const body = ctx.request.body || {}
    return body.vacancy !== undefined ? body.vacancy : body
  }

  applyVacancyIdFromBody (ctx) {
    const body = ctx.request.body || {}
    if (body.id !== undefined && body.id !== null && String(body.id).trim() !== '') {
      return String(body.id).trim()
    }
    const nested = body.vacancy
    if (
      nested &&
      nested.id !== undefined &&
      nested.id !== null &&
      String(nested.id).trim() !== ''
    ) {
      return String(nested.id).trim()
    }
    return ''
  }

  /**
   * @api {get} /vacancies/apply List applied vacancies
   * @apiName ListAppliedVacancies
   * @apiGroup REST Vacancies
   *
   * @apiExample Example usage:
   * curl http://localhost:5020/vacancies/apply
   *
   * @apiSuccess {Object[]} data All vacancies with applied=true, sorted by appliedAt descending
   *
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "data": []
   *     }
   */
  async listAppliedVacancies (ctx) {
    try {
      const result = await this.useCases.vacancy.listAppliedVacancies()
      ctx.body = result
    } catch (err) {
      this.handleError(ctx, err)
    }
  }

  /**
   * @api {get} /vacancies/sources List configured job source slugs
   * @apiName ListVacancySources
   * @apiGroup REST Vacancies
   *
   * @apiExample Example usage:
   * curl http://localhost:5020/vacancies/sources
   *
   * @apiSuccess {String[]} sources Registered job source slugs from adapters.jobSources.sourcesSlug
   *
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "sources": ["vacantesdigitales", "jooble", "getonbrd", "x"]
   *     }
   */
  async listVacancySources (ctx) {
    try {
      ctx.body = { sources: this.adapters.jobSources.sourcesSlug }
    } catch (err) {
      this.handleError(ctx, err)
    }
  }

  /**
   * @api {post} /vacancies/apply Mark a vacancy as applied
   * @apiName PostApplyVacancy
   * @apiGroup REST Vacancies
   *
   * @apiParam {String} id Mongo ObjectId of the vacancy (JSON body)
   * @apiParam {Object} [vacancy] Alternative: `{ "vacancy": { "id": "..." } }`
   *
   * @apiExample Example usage:
   * curl -H "Content-Type: application/json" -X POST \
   *   -d '{ "id": "507f1f77bcf86cd799439011" }' \
   *   http://localhost:5020/vacancies/apply
   *
   * @apiSuccess {Object} document Updated vacancy (includes applied=true and appliedAt)
   *
   * @apiError BadRequest Missing id in body
   * @apiError NotFound Invalid or unknown vacancy id
   *
   * @apiErrorExample {text} Bad-Request:
   *     HTTP/1.1 400 Bad Request
   *     Vacancy id is required
   */
  async postApplyVacancy (ctx) {
    try {
      const id = this.applyVacancyIdFromBody(ctx)
      if (!id) {
        ctx.status = 400
        ctx.body = 'Vacancy id is required'
        return
      }
      const updated = await this.useCases.vacancy.markVacancyApplied(id)
      ctx.status = 200
      ctx.body = updated
    } catch (err) {
      this.handleError(ctx, err)
    }
  }

  /**
   * @api {get} /vacancies/:page List vacancies (paginated)
   * @apiName ListVacancies
   * @apiGroup REST Vacancies
   *
   * Page size is fixed at 10 (`VACANCIES_LIST_PAGE_SIZE`). Only the path segment `:page` is used; query strings are ignored for listing.
   *
   * @apiParam {Number} page Page number (1-based; path segment must be digits only)
   *
   * @apiExample Example usage:
   * curl 'http://localhost:5020/vacancies/1'
   *
   * @apiSuccess {Object[]} data List of vacancy documents
   * @apiSuccess {Object} pagination Pagination metadata
   * @apiSuccess {Number} pagination.page Current page
   * @apiSuccess {Number} pagination.limit Page size
   * @apiSuccess {Number} pagination.total Total matching documents
   * @apiSuccess {Number} pagination.pages Total pages
   *
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "data": [],
   *       "pagination": {
   *         "page": 1,
   *         "limit": 10,
   *         "total": 0,
   *         "pages": 1
   *       }
   *     }
   *
   * @apiError UnprocessableEntity Server or validation error
   *
   * @apiErrorExample {json} Error-Response:
   *     HTTP/1.1 422 Unprocessable Entity
   *     {
   *       "status": 422,
   *       "error": "Unprocessable Entity"
   *     }
   */
  async listVacancies (ctx) {
    try {
      const result = await this.useCases.vacancy.listVacancies(ctx.params.page)
      ctx.body = result
    } catch (err) {
      this.handleError(ctx, err)
    }
  }

  /**
   * @api {post} /vacancies/filter Filter vacancies (query string)
   * @apiName FilterVacancies
   * @apiGroup REST Vacancies
   *
   * All filter and pagination parameters are read from the URL query string.
   *
   * @apiParam {Number} [minScore] Minimum `llmScore` (inclusive)
   * @apiParam {String} [since] ISO date; vacancies with `datePosted >= since`
   * @apiParam {String} [sinceDate] Alias of `since`
   * @apiParam {String} [source]
   * @apiParam {String} [category]
   * @apiParam {String} [locationType]
   * @apiParam {String} [LocationType] Alias of `locationType`
   * @apiParam {String} [experience] Maps to `experienceLevel`
   * @apiParam {String} [experienceLevel] Alias of `experience`
   * @apiParam {Number} [page] Page number (default 1)
   * @apiParam {Number} [perPage] Page size (default 10, max 100)
   *
   * @apiExample Example usage:
   * curl -X POST 'http://localhost:5020/vacancies/filter?minScore=5&since=2026-01-01&source=vacantesdigitales&perPage=20&page=1'
   *
   * @apiSuccess {Object[]} data Matching vacancies
   * @apiSuccess {Object} pagination Pagination metadata
   */
  async filterVacancies (ctx) {
    try {
      const result = await this.useCases.vacancy.filterVacancies(ctx.query || {})
      ctx.body = result
    } catch (err) {
      this.handleError(ctx, err)
    }
  }

  /**
   * @api {get} /vacancies/:id Get vacancy by id
   * @apiName GetVacancy
   * @apiGroup REST Vacancies
   *
   * @apiParam {String} id Mongo ObjectId of the vacancy
   *
   * @apiExample Example usage:
   * curl http://localhost:5020/vacancies/507f1f77bcf86cd799439011
   *
   * @apiSuccess {ObjectId} _id Vacancy id
   * @apiSuccess {String} source Source key
   * @apiSuccess {Mixed} externalId External id from source
   * @apiSuccess {String} title Job title
   *
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "_id": "507f1f77bcf86cd799439011",
   *       "source": "vacantesdigitales",
   *       "externalId": "42",
   *       "title": "Backend developer"
   *     }
   *
   * @apiError NotFound Vacancy does not exist or invalid id
   *
   * @apiErrorExample {text} Error-Response:
   *     HTTP/1.1 404 Not Found
   *     Vacancy not found
   */
  async getVacancy (ctx) {
    try {
      const row = await this.useCases.vacancy.getVacancy(ctx.params)
      ctx.body = row
    } catch (err) {
      this.handleError(ctx, err)
    }
  }

  /**
   * @api {put} /vacancies/:id Update a vacancy
   * @apiName UpdateVacancy
   * @apiGroup REST Vacancies
   *
   * @apiParam {String} id Mongo ObjectId of the vacancy
   *
   * @apiParam {Object} [body] Partial fields as JSON body (flat object)
   * @apiParam {Object} [vacancy] Alternative: nested object `{ "vacancy": { ... } }`; if present, its value is used as the patch
   * @apiParam {String} [title] Job title (merged with existing; full merged doc must stay valid)
   * @apiParam {String} [source] Source key
   * @apiParam {Mixed} [externalId] External id
   *
   * @apiExample Example usage (flat body):
   * curl -H "Content-Type: application/json" -X PUT \
   *   -d '{ "title": "Senior Backend Developer" }' \
   *   http://localhost:5020/vacancies/507f1f77bcf86cd799439011
   *
   * @apiExample Example usage (nested vacancy):
   * curl -H "Content-Type: application/json" -X PUT \
   *   -d '{ "vacancy": { "title": "Senior Backend Developer" } }' \
   *   http://localhost:5020/vacancies/507f1f77bcf86cd799439011
   *
   * @apiSuccess {ObjectId} _id Vacancy id
   * @apiSuccess {String} [title] Job title
   * @apiSuccess {String} [source] Source key
   * @apiSuccess {Mixed} [externalId] External id from source
   *
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "_id": "507f1f77bcf86cd799439011",
   *       "title": "Senior Backend Developer",
   *       "source": "vacantesdigitales",
   *       "externalId": "42"
   *     }
   *
   * @apiError NotFound Vacancy not found
   * @apiError Conflict Duplicate source + externalId (HTTP 409)
   * @apiError UnprocessableEntity Validation or server error (HTTP 422)
   *
   * @apiErrorExample {text} Not-Found:
   *     HTTP/1.1 404 Not Found
   *     Vacancy not found
   *
   * @apiErrorExample {text} Conflict:
   *     HTTP/1.1 409 Conflict
   *     Vacancy with this source and externalId already exists
   *
   * @apiErrorExample {text} Unprocessable:
   *     HTTP/1.1 422 Unprocessable Entity
   *     Validation message or server error
   */
  async updateVacancy (ctx) {
    try {
      const existing = await this.useCases.vacancy.getVacancy(ctx.params)
      const updated = await this.useCases.vacancy.updateVacancy(
        existing,
        this.updatePayload(ctx)
      )
      ctx.body = updated
    } catch (err) {
      this.handleError(ctx, err)
    }
  }

  /**
   * @api {delete} /vacancies/:id Delete a vacancy
   * @apiName DeleteVacancy
   * @apiGroup REST Vacancies
   *
   * @apiParam {String} id Mongo ObjectId of the vacancy
   *
   * @apiExample Example usage:
   * curl -X DELETE http://localhost:5020/vacancies/507f1f77bcf86cd799439011
   *
   * @apiSuccess {Boolean} success Always true when delete succeeds
   *
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "success": true
   *     }
   *
   * @apiError NotFound Vacancy does not exist
   *
   * @apiErrorExample {text} Error-Response:
   *     HTTP/1.1 404 Not Found
   *     Vacancy not found
   */
  async deleteVacancy (ctx) {
    try {
      const existing = await this.useCases.vacancy.getVacancy(ctx.params)
      await this.useCases.vacancy.deleteVacancy(existing)
      ctx.status = 200
      ctx.body = { success: true }
    } catch (err) {
      this.handleError(ctx, err)
    }
  }
}

export default VacanciesRESTControllerLib
