import { performVideoPosting } from '../api/_lib/postVideo';

// --- Script entry point (for scheduled runs) ---
if (require.main === module) {
  const conceptId = process.env.CONCEPT_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!conceptId) {
    console.error('Error: CONCEPT_ID environment variable is not set.');
    process.exit(1);
  }
  if (!serviceAccountJson) {
    console.error('Error: GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
    process.exit(1);
  }

  performVideoPosting({
    conceptId,
    serviceAccountJson,
  }).catch(error => {
    console.error(`Error processing concept ${conceptId}:`, error);
    process.exit(1);
  });
}
