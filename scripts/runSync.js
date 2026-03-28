require('dotenv').config();
const { executeSyncPipeline } = require('../src/jobs/syncPipeline');
const prisma = require('../src/db/prisma');

async function main() {
  const developerId = process.argv[2] ? parseInt(process.argv[2], 10) : 1;
  console.log(`Starting sync for developer ID: ${developerId}`);

  try {
    await executeSyncPipeline({
      developerId,
      onProgress: (label, extra) => {
        console.log(`[PROGRESS] ${label}`, extra || '');
      },
    });
    console.log('Sync completed successfully');
  } catch (error) {
    console.error('Sync failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
