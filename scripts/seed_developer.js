require('dotenv').config();
const prisma = require('../src/db/prisma');

async function main() {
  try {
    const developers = await prisma.developer.findMany();
    console.log('Developers in database:', JSON.stringify(developers, null, 2));
    
    if (developers.length === 0) {
      console.log('No developers found. Creating a seed developer...');
      const newDev = await prisma.developer.create({
        data: {
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'Developer',
          githubUsername: 'joel767443', // Using the username from previous successful run if possible
        }
      });
      console.log('Created developer:', JSON.stringify(newDev, null, 2));
    }
  } catch (error) {
    console.error('Error checking/seeding developers:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
