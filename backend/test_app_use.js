const express = require('express');
const cors = require('cors');
const jobRoutes = require('./src/routes/jobs');
const featureRoutes = require('./src/routes/features');

const app = express();

const corsOptions = {
  origin: (origin, callback) => callback(null, true),
  credentials: true
};

const corsMiddleware = cors(corsOptions);
console.log('1. corsMiddleware type:', typeof corsMiddleware);
app.use(corsMiddleware);

const jsonMiddleware = express.json();
console.log('2. jsonMiddleware type:', typeof jsonMiddleware);
app.use(jsonMiddleware);

const jobsMounted = jobRoutes.default || jobRoutes;
console.log('3. jobsMounted type:', typeof jobsMounted);
app.use('/api/jobs', jobsMounted);

const featuresMounted = featureRoutes.default || featureRoutes;
console.log('4. featuresMounted type:', typeof featuresMounted);
app.use('/api/features', featuresMounted);

console.log('All app.use calls successful');
