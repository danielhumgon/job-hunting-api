/*
  Vacancy entity — validation rules before persistence.
*/

class Vacancy {
  /**
   * @param {object} doc
   */
  validateForPersistence (doc = {}) {
    if (!doc.source || typeof doc.source !== 'string') {
      throw new Error("Vacancy: 'source' must be a non-empty string")
    }
    if (doc.externalId === undefined || doc.externalId === null || doc.externalId === '') {
      throw new Error("Vacancy: 'externalId' is required")
    }
    if (!doc.title || typeof doc.title !== 'string') {
      throw new Error("Vacancy: 'title' must be a non-empty string")
    }
  }
}

export default Vacancy
