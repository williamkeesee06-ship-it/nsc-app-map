const express = require('express');
const cors = require('cors');
const jobRoutes = require('./src/routes/jobs');
const featureRoutes = require('./src/routes/features');

console.log('express type:', typeof express);
console.log('express.json type:', typeof express.json);
console.log('cors type:', typeof cors);

console.log('jobRoutes type:', typeof jobRoutes);
console.log('jobRoutes is function:', typeof jobRoutes === 'function');
console.log('jobRoutes keys:', Object.keys(jobRoutes));

console.log('featureRoutes type:', typeof featureRoutes);
console.log('featureRoutes is function:', typeof featureRoutes === 'function');
console.log('featureRoutes keys:', Object.keys(featureRoutes));
