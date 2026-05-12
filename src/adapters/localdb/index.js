/*
  This library encapsulates code concerned with MongoDB and Mongoose models.
*/

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
}

export default LocalDB
