const cors = require('cors');
const middleware = cors({ origin: '*' });
console.log('cors middleware type:', typeof middleware);
