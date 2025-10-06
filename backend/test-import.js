console.log('Testing import...');
try {
  const { smartContractService } = require('./dist/services/smartContractService.js');
  console.log('Import successful:', !!smartContractService);
  console.log('Service methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(smartContractService)));
} catch (error) {
  console.error('Import failed:', error.message);
}



