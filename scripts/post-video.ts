import { performVideoPosting } from '../api/_lib/postVideo.js';

import { fileURLToPath } from 'url';

// This check ensures the script only runs when executed directly from the command line.
if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1])) {
  const conceptId = process.env.CONCEPT_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!conceptId) {
    console.error('Error: CONCEPT_ID environment variable is not set.');
    process.exit(1);
  }
  // GOOGLE_SERVICE_ACCOUNT_JSON is needed by the underlying postVideo function
  if (!serviceAccountJson) {
    console.error('Error: GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
    process.exit(1);
  }

  performVideoPosting({
    conceptId,
    serviceAccountJson,
  }).catch((error: any) => {
    console.error(`Error processing concept ${conceptId}:`, error);
    process.exit(1);
  });
}