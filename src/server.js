import app, { pool } from './app.js'
const port = Number(process.env.PORT || 3001)
const server = app.listen(port, () => console.log(`API listening on ${port}`))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))))
