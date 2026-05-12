/*
  This library contains business-logic for dealing with vacancies. Most of these
  functions are called by the /vacancies REST API endpoints.
*/

import mongoose from 'mongoose'

import VacancyEntity from '../entities/vacancy.js'

import wlogger from '../adapters/wlogger.js'

/** Fixed page size for REST listing; not overridable via query. */
export const VACANCIES_LIST_PAGE_SIZE = 10

const RESERVED_KEYS = new Set(['_id', '__v', 'createdAt', 'updatedAt'])

function sanitizePayload (body = {}) {
  const out = { ...body }
  for (const k of RESERVED_KEYS) {
    delete out[k]
  }
  return out
}

class VacancyLib {
  constructor (localConfig = {}) {
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of adapters must be passed in when instantiating Vacancy Use Cases library.'
      )
    }

    this.vacancyEntity = new VacancyEntity()
    this.VacancyModel = this.adapters.localdb.Vacancy
  }

  /**
   * Paginated vacancy list (no filters). Page size is always `VACANCIES_LIST_PAGE_SIZE` (10).
   *
   * @param {number|string} [page=1] 1-based page index (e.g. from route `:page`)
   */
  async listVacancies (page = 1) {
    try {
      const p = Math.max(1, parseInt(page, 10) || 1)
      const limit = VACANCIES_LIST_PAGE_SIZE

      const [data, total] = await Promise.all([
        this.VacancyModel.find({})
          .sort({ llmScore: -1, datePosted: -1 })
          .skip((p - 1) * limit)
          .limit(limit)
          .lean(),
        this.VacancyModel.countDocuments({})
      ])

      return {
        data,
        pagination: {
          page: p,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1
        }
      }
    } catch (err) {
      wlogger.error('Error in vacancy.js/listVacancies()')
      throw err
    }
  }

  /**
   * All vacancies marked as applied, newest `appliedAt` first. Not paginated.
   */
  async listAppliedVacancies () {
    try {
      const data = await this.VacancyModel.find({ applied: true })
        .sort({ appliedAt: -1 })
        .lean()

      return { data }
    } catch (err) {
      wlogger.error('Error in vacancy.js/listAppliedVacancies()')
      throw err
    }
  }

  /**
   * Set `applied: true` and `appliedAt` to now for the vacancy with this Mongo id.
   * @param {string} id — Mongo ObjectId string
   */
  async markVacancyApplied (id) {
    try {
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        const err = new Error('Vacancy not found')
        err.status = 404
        throw err
      }

      const appliedAt = new Date()
      const updated = await this.VacancyModel.findByIdAndUpdate(
        id,
        { $set: { applied: true, appliedAt } },
        { new: true, runValidators: true }
      ).lean()

      if (!updated) {
        const err = new Error('Vacancy not found')
        err.status = 404
        throw err
      }

      return updated
    } catch (err) {
      if (err.status === 404) throw err

      wlogger.error('Error in vacancy.js/markVacancyApplied()')
      throw err
    }
  }

  /**
   * Load a single vacancy by route param `id` (Mongo ObjectId).
   * @param {object} params — e.g. `{ id }` from `ctx.params`
   */
  async getVacancy (params) {
    try {
      const { id } = params

      if (!mongoose.Types.ObjectId.isValid(id)) {
        const err = new Error('Vacancy not found')
        err.status = 404
        throw err
      }

      const vacancy = await this.VacancyModel.findById(id).lean()

      if (!vacancy) {
        const err = new Error('Vacancy not found')
        err.status = 404
        throw err
      }

      return vacancy
    } catch (err) {
      if (err.status === 404) throw err

      err.status = 422
      err.message = 'Unprocessable Entity'
      throw err
    }
  }

  /**
   * Apply partial fields to an existing vacancy (typically `existing` from `getVacancy`).
   * @param {object} existingVacancy — lean document
   * @param {object} newData — partial update (fields to $set)
   */
  async updateVacancy (existingVacancy, newData) {
    try {
      const patch = sanitizePayload(newData || {})
      const merged = { ...existingVacancy, ...patch }
      this.vacancyEntity.validateForPersistence(merged)

      const id = existingVacancy._id?.toString?.() ?? existingVacancy._id
      if (!mongoose.Types.ObjectId.isValid(id)) {
        const err = new Error('Vacancy not found')
        err.status = 404
        throw err
      }

      if (Object.keys(patch).length === 0) {
        const current = await this.VacancyModel.findById(id).lean()
        if (!current) {
          const err = new Error('Vacancy not found')
          err.status = 404
          throw err
        }
        return current
      }

      let updated
      try {
        updated = await this.VacancyModel.findByIdAndUpdate(
          id,
          { $set: patch },
          { new: true, runValidators: true }
        ).lean()
      } catch (err) {
        if (err.code === 11000) {
          const e = new Error(
            'Vacancy with this source and externalId already exists'
          )
          e.status = 409
          throw e
        }
        throw err
      }

      if (!updated) {
        const err = new Error('Vacancy not found')
        err.status = 404
        throw err
      }

      return updated
    } catch (err) {
      wlogger.error('Error in vacancy.js/updateVacancy()')
      throw err
    }
  }

  /**
   * Remove a vacancy by id (pass the lean document from `getVacancy`).
   */
  async deleteVacancy (vacancy) {
    try {
      const id = vacancy._id?.toString?.() ?? vacancy._id
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        const err = new Error('Vacancy not found')
        err.status = 404
        throw err
      }

      const deleted = await this.VacancyModel.findByIdAndDelete(id).lean()
      if (!deleted) {
        const err = new Error('Vacancy not found')
        err.status = 404
        throw err
      }
    } catch (err) {
      wlogger.error('Error in vacancy.js/deleteVacancy()')
      throw err
    }
  }
}

export default VacancyLib
