// Global npm libraries
import mongoose from 'mongoose'

const VacancySchema = new mongoose.Schema(
  {
    externalId: { type: mongoose.Schema.Types.Mixed, required: true },
    source: { type: String, required: true },
    title: { type: String, required: true },
    slug: { type: String },
    company: { type: mongoose.Schema.Types.Mixed },
    category: { type: String },
    locationType: { type: String },
    addressLocality: { type: String },
    addressCountry: { type: String },
    experienceLevel: { type: String },
    datePosted: { type: Date },
    validThrough: { type: Date },
    keywords: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    summary: { type: String },
    content: { type: String },
    applyUrl: { type: String },
    sourceUrl: { type: String },
    fetchedAt: { type: Date },
    ingestionVersion: { type: String },

    llmScore: { type: Number, default: null },
    llmReasons: { type: [String], default: [] },
    llmFlags: { type: [String], default: [] },
    llmModel: { type: String },
    llmPromptVersion: { type: String },
    llmStatus: { type: String, default: 'pending' },
    llmClassifiedAt: { type: Date },
    llmRawOutput: { type: mongoose.Schema.Types.Mixed },

    belowMinScore: { type: Boolean, default: false },
    applied: { type: Boolean, default: false },
    appliedAt: { type: Date }
  },
  {
    timestamps: true
  }
)

VacancySchema.index({ source: 1, externalId: 1 }, { unique: true })
VacancySchema.index({ category: 1, datePosted: -1 })
VacancySchema.index({ locationType: 1, datePosted: -1 })
VacancySchema.index({ llmScore: -1, datePosted: -1 })
VacancySchema.index({ llmStatus: 1 })
VacancySchema.index({ applied: 1, appliedAt: -1 })
VacancySchema.index(
  { title: 'text', summary: 'text', keywords: 'text' },
  { weights: { title: 5, summary: 2, keywords: 1 } }
)

export default mongoose.model('Vacancy', VacancySchema)
