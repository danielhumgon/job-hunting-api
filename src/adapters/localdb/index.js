/*
  This library encapsulates code concerned with MongoDB and Mongoose models.
*/

import mongoose from 'mongoose'

// Load Mongoose models.
import Users from './models/users.js'
import Usage from './models/usage.js'
import Vacancy from './models/vacancy.js'

class LocalDB {
  constructor () {
    this.Users = Users
    this.Usage = Usage
    this.Vacancy = Vacancy
  }

  /**
   * @param {object} query — Raw query string map (e.g. from `ctx.query`)
   */
  async listVacancies (query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
    const filter = {}

    const q = query.q && String(query.q).trim()
    if (q) {
      filter.$text = { $search: q }
    }

    if (query.category) filter.category = query.category
    if (query.locationType) filter.locationType = query.locationType
    if (query.experience) filter.experienceLevel = query.experience
    if (query.source) filter.source = query.source

    if (query.since) {
      const d = new Date(query.since)
      if (!Number.isNaN(d.getTime())) {
        filter.datePosted = { ...(filter.datePosted || {}), $gte: d }
      }
    }

    if (query.minScore !== undefined && query.minScore !== '') {
      const m = parseFloat(query.minScore)
      if (!Number.isNaN(m)) {
        filter.llmScore = { $gte: m }
      }
    }

    const [data, total] = await Promise.all([
      this.Vacancy.find(filter)
        .sort({ llmScore: -1, datePosted: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.Vacancy.countDocuments(filter)
    ])

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1
      }
    }
  }

  async getVacancyById (id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null
    }
    return this.Vacancy.findById(id).lean()
  }
}

export default LocalDB
