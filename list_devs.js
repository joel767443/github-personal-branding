require('dotenv').config();
const prisma = require('./src/db/prisma');

async function main() {
  try {
    const devs = await prisma.developer.findMany();
    console.log(JSON.stringify(devs, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2));
  } catch (error) {
    console.error('Error fetching developers:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
