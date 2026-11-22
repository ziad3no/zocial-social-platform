/** npm run seed: wipe the local database and load the demo data again. */
import { join, resolve } from 'node:path'
import { openDb } from './db'
import { resetDemo } from './seed'

const db = openDb(join(resolve(process.env.DATA_DIR ?? './data'), 'zocial.db'))
resetDemo(db)
console.log('Database reset with demo data')
