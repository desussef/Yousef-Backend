import 'dotenv/config'
import { spawn } from 'node:child_process'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)))
  })
}

// Migrations are transactional and tracked in schema_migrations, so this is
// safe on repeated Railway deploys and guarantees the app only starts on the
// expected schema version.
await run(process.execPath, ['scripts/migrate.js'])
await run(process.execPath, ['src/server.js'])
