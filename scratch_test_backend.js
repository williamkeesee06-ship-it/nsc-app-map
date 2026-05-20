try {
  console.log('Attempting to require backend/src/index.js...');
  const app = require('./backend/src/index.js');
  console.log('Successfully required backend/src/index.js');
  console.log('App type:', typeof app);
} catch (error) {
  console.error('Crash detected:');
  console.error(error);
}
