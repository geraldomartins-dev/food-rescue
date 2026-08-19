import mysql from 'mysql2/promise';
import { env } from './config.js';

export const pool = mysql.createPool({
  host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD,
  waitForConnections: true, connectionLimit: env.DB_CONNECTION_LIMIT,
  charset: 'utf8mb4', timezone: 'Z', decimalNumbers: true
});

export async function checkDatabase() {
  const connection = await pool.getConnection();
  try { await connection.query('SELECT 1'); } finally { connection.release(); }
}
