const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { connectDatabase } = require('../lib/database.js');
const { platformRepository } = require('../lib/repositories.js');

const run = async () => {
  const databaseState = await connectDatabase();
  if (!databaseState.connected) {
    throw new Error(databaseState.reason || 'Database connection failed');
  }

  const status = await platformRepository.seedDevelopmentData();
  process.stdout.write(`[dev-seed] completed with status: ${status}\n`);
};

run().catch((error) => {
  console.error('[dev-seed] failed:', error.message);
  process.exit(1);
});
