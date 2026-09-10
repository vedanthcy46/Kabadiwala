import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', '..', 'sql');

const seedFiles = [
  '06_lot_system.sql',
  '06_ai_feedback.sql',
  '08_ai_governance.sql',
  '09_lot_cancellation.sql',
  '10_price_observations.sql',
  '11_recycler_verification_workflow.sql',
  '02_init_base_users.sql',
];

export async function resetAndSeed() {
  const resetSql = fs.readFileSync(path.join(sqlDir, '04_reset.sql'), 'utf8');
  await pool.query(resetSql);

  for (const file of seedFiles) {
    const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
    await pool.query(sql);
  }
}
