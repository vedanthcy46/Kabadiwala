import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(__dirname, '..', 'sql', '09_lot_cancellation.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Applying 09_lot_cancellation.sql migration...');
  try {
    await pool.query(sql);
    console.log('✅ Migration applied successfully.');

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'materials' AND column_name IN ('is_cancelled', 'cancellation_reason', 'cancelled_at')
       ORDER BY column_name`
    );
    console.log('New materials columns:', cols.rows.map(r => r.column_name).join(', '));
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
