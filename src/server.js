import { app } from './app.js';
import { checkDatabase, pool } from './database.js';
import { env } from './config.js';
import { startEmailWorker } from './email-worker.js';

try {
  await checkDatabase();
  const server = app.listen(env.PORT, () => console.log(`Food Rescue API: http://localhost:${env.PORT}/api/v1`));
  const stopEmailWorker = startEmailWorker();
  const stop = () => server.close(async () => { stopEmailWorker(); await pool.end(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) { console.error('Falha ao iniciar:', error.message); process.exit(1); }
