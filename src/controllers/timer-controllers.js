/*
  This Controller library is concerned with timer-based functions that are
  kicked off periodically.
*/

import config from '../../config/index.js'

class TimerControllers {
  constructor (localConfig = {}) {
    // Dependency Injection.
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of Adapters library required when instantiating Timer Controller libraries.'
      )
    }
    this.useCases = localConfig.useCases
    if (!this.useCases) {
      throw new Error(
        'Instance of Use Cases library required when instantiating Timer Controller libraries.'
      )
    }

    this.debugLevel = localConfig.debugLevel

    // Encapsulate dependencies
    this.config = config

    // Constants
    this.cleanUsageInterval = 60000 * 60 // 1 hour
    this.backupUsageInterval = 60000 * 10 // 10 minutes
    this.ingestVacanciesInterval =
      localConfig.ingestIntervalMs ??
      this.config.ingestIntervalMs ??
      1000 * 60 * 60 * 3

    // Bind 'this' object to all subfunctions.
    this.cleanUsage = this.cleanUsage.bind(this)
    this.backupUsage = this.backupUsage.bind(this)
    this.ingestVacancies = this.ingestVacancies.bind(this)
  }

  // Start all the time-based controllers.
  startTimers () {
    this.cleanUsageHandle = setInterval(this.cleanUsage, this.cleanUsageInterval)
    this.backupUsageHandle = setInterval(this.backupUsage, this.backupUsageInterval)

    this.ingestVacanciesHandle = setInterval(
      this.ingestVacancies,
      this.ingestVacanciesInterval
    )

    if (this.config.ingestOnBoot && this.config.env !== 'test') {
      this.ingestVacancies()
    }

    return true
  }

  stopTimers () {
    clearInterval(this.cleanUsageHandle)
    clearInterval(this.backupUsageHandle)
    clearInterval(this.ingestVacanciesHandle)
  }

  // Clean the usage state so that stats reflect the last 24 hours.
  cleanUsage () {
    try {
      clearInterval(this.cleanUsageHandle)

      const now = new Date()
      console.log(`cleanUsage() Timer Controller executing at ${now.toLocaleString()}`)

      this.useCases.usage.cleanUsage()

      this.cleanUsageHandle = setInterval(this.cleanUsage, this.cleanUsageInterval)

      return true
    } catch (err) {
      console.error('Error in time-controller.js/cleanUsage(): ', err)

      this.cleanUsageHandle = setInterval(this.cleanUsage, this.cleanUsageInterval)

      // Note: Do not throw an error. This is a top-level function.
      return false
    }
  }

  // Backup the usage stats to the database
  async backupUsage () {
    try {
      clearInterval(this.backupUsageHandle)

      console.log('backupUsage() Timer Controller executing at ', new Date().toLocaleString())

      // Clear the database of old usage data.
      await this.useCases.usage.clearUsage()

      // Save the current usage snapshot to the database.
      await this.useCases.usage.saveUsage()

      this.backupUsageHandle = setInterval(this.backupUsage, this.backupUsageInterval)

      return true
    } catch (err) {
      console.error('Error in time-controller.js/backupUsage(): ', err)

      this.backupUsageHandle = setInterval(this.backupUsage, this.backupUsageInterval)

      // Note: Do not throw an error. This is a top-level function.
      return false
    }
  }

  /**
   * Job Hunter ingestion: delegates to use case (fetch → validate → LLM → persist).
   */
  async ingestVacancies () {
    try {
      clearInterval(this.ingestVacanciesHandle)

      console.log('ingestVacancies() Timer Controller executing at ', new Date().toLocaleString())

      const result = await this.useCases.ingestion.ingestVacancies()

      console.log(
        'ingestVacancies metrics:',
        JSON.stringify(result.metrics, null, 2)
      )

      this.ingestVacanciesHandle = setInterval(
        this.ingestVacancies,
        this.ingestVacanciesInterval
      )

      return result.ok !== false
    } catch (err) {
      console.error('ingestVacancies: unexpected: ', err.message)
      this.ingestVacanciesHandle = setInterval(
        this.ingestVacancies,
        this.ingestVacanciesInterval
      )
      return false
    }
  }
}

export default TimerControllers
