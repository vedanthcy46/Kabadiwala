// src/migrate.js
// Run: npm run migrate
// Executes the schema + supporting tables/views against the connected database.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const schemaPath = path.join(__dirname, '..', 'sql', '01_schema.sql');
  const lotSystemPath = path.join(__dirname, '..', 'sql', '06_lot_system.sql');
  const aiFeedbackPath = path.join(__dirname, '..', 'sql', '06_ai_feedback.sql');
  const aiGovernancePath = path.join(__dirname, '..', 'sql', '08_ai_governance.sql');
  const priceObsPath = path.join(__dirname, '..', 'sql', '10_price_observations.sql');
  const verifyPath = path.join(__dirname, '..', 'sql', '11_recycler_verification_workflow.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const lotSystemSql = fs.readFileSync(lotSystemPath, 'utf8');
  const aiFeedbackSql = fs.readFileSync(aiFeedbackPath, 'utf8');
  const aiGovernanceSql = fs.readFileSync(aiGovernancePath, 'utf8');
  const priceObsSql = fs.readFileSync(priceObsPath, 'utf8');
  const verifySql = fs.readFileSync(verifyPath, 'utf8');

  try {
    console.log('Running schema migration...');
    await pool.query(sql);
    await pool.query(lotSystemSql);
    await pool.query(aiFeedbackSql);
    await pool.query(aiGovernanceSql);
    await pool.query(priceObsSql);
    await pool.query(verifySql);
    console.log('✅ Schema created successfully.');

    const res = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log('Tables now present:', res.rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
