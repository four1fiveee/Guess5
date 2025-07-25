// Migration script for initial tables
import { AppDataSource } from '../index'

AppDataSource.initialize().then(async () => {
  // Tables auto-created by TypeORM with synchronize: true
  console.log('Database initialized')
  process.exit(0)
}) 