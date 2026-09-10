import { execSync } from 'child_process';

export default async function globalSetup() {
  // Reset and seed the database before running integration tests.
  // Global setup runs once in a separate process before the test suite.
  execSync('node src/setup.js --force', { cwd: process.cwd(), stdio: 'pipe' });
}
