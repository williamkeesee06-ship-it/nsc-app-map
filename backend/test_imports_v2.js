const jobRoutes = require('./backend/src/routes/jobs');
const featureRoutes = require('./backend/src/routes/features');
const cors = require('cors');

console.log('jobRoutes type:', typeof jobRoutes);
console.log('featureRoutes type:', typeof featureRoutes);
console.log('cors type:', typeof cors);
console.log('jobRoutes.default type:', typeof jobRoutes.default);
console.log('featureRoutes.default type:', typeof featureRoutes.default);
