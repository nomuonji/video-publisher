import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { spawn } from 'child_process';
import type { ConceptConfig } from '../types.js';
import { ensurePostingTimesFromConfig } from '../utils/schedule.js';

// --- Authentication ---
function getAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
  }
  const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new JWT({
    email: serviceAccountKey.client_email,
    key: serviceAccountKey.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

// --- Main script logic ---
async function main() {
  console.log(`Starting schedule check at ${new Date().toISOString()}`);
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const executionTime = new Date();
  const executedJobs: { name: string; time: string; executedAt: string }[] = [];

  // 1. Find the main 'v-stock' folder
  const vStockFolderId = await getFolderIdByName(drive, 'v-stock');
  if (!vStockFolderId) {
    throw new Error("'v-stock' folder not found.");
  }
  console.log(`Found 'v-stock' folder: ${vStockFolderId}`);

  // 2. Get all concept folders
  const conceptFolders = await getSubFolders(drive, vStockFolderId);
  console.log(`Found ${conceptFolders.length} concept folders.`);

  // 3. Iterate through each concept and check its schedule
  for (const folder of conceptFolders) {
    const configFile = await getFileByName(drive, folder.id!, 'config.json');
    if (!configFile) {
      console.log(`- Skipping concept '${folder.name}': config.json not found.`);
      continue;
    }

    const config = (await getFileContent(drive, configFile.id!)) as ConceptConfig;
    const postingTimes = ensurePostingTimesFromConfig(config);

    if (postingTimes.length === 0) {
      console.log(`- Skipping concept '${config.name || folder.name}': posting times not defined.`);
      continue;
    }

    const oneHourAgo = new Date(executionTime.getTime() - 60 * 60 * 1000);
    const dueTime = postingTimes.find((time: string) => {
      const lastOccurrence = getMostRecentOccurrence(time, executionTime);
      return lastOccurrence >= oneHourAgo && lastOccurrence <= executionTime;
    });

    console.log(`- Checking concept '${config.name || folder.name}': Times '${postingTimes.join(', ')}'.`);

    if (!dueTime) {
      continue;
    }

    console.log(`  -> EXECUTING job for concept: ${config.name || folder.name} at ${dueTime}`);
    executedJobs.push({
      name: config.name || folder.name,
      time: dueTime,
      executedAt: executionTime.toISOString(),
    });

    // Trigger post-video.ts script
    const child = spawn('npx', ['ts-node', 'scripts/post-video.ts'], {
      env: {
        ...process.env,
        CONCEPT_ID: folder.id!,
        GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
      },
      stdio: 'inherit',
    });

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`  -> Post-video script for ${config.name || folder.name} completed successfully.`);
          resolve(null);
        } else {
          console.error(`  -> Post-video script for ${config.name || folder.name} failed with code ${code}.`);
          reject(new Error(`Post-video script failed for ${config.name || folder.name}`));
        }
      });
      child.on('error', (err) => {
        console.error(`  -> Failed to start post-video script for ${config.name || folder.name}:`, err);
        reject(err);
      });
    });
  }

  console.log('\n--- Execution Summary ---');
  if (executedJobs.length > 0) {
    console.log('Successfully executed jobs for scheduled concepts:', executedJobs);
  } else {
    console.log('No concepts were scheduled to run in the last hour.');
  }
  console.log(`Finished schedule check at ${new Date().toISOString()}`);
}

// --- Google Drive Helper Functions ---

async function getFolderIdByName(drive: any, name: string): Promise<string | null> {
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0]?.id || null;
}

async function getSubFolders(drive: any, parentId: string): Promise<any[]> {
    const res = await drive.files.list({
        q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
    });
    return res.data.files || [];
}

async function getFileByName(drive: any, parentId: string, name: string): Promise<any | null> {
    const res = await drive.files.list({
        q: `'${parentId}' in parents and name='${name}' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
    });
    return res.data.files?.[0] || null;
}

async function getFileContent(drive: any, fileId: string): Promise<any> {
    const res = await drive.files.get({ fileId: fileId, alt: 'media' });
    return res.data;
}

function getMostRecentOccurrence(time: string, reference: Date): Date {
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const candidate = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), hour, minute)
  );
  if (candidate > reference) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  return candidate;
}

// --- Run the script ---
main().catch(error => {
  console.error('An unexpected error occurred:', error);
  process.exit(1);
});