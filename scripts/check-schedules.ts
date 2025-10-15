import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { spawn } from 'child_process';
import type { ConceptConfig } from '../types.js';
import { ensurePostingTimesFromConfig } from '../utils/schedule.js';
import { infoLog, debugLog, errorLog, isGitHubActions } from '../utils/logger.js';

// --- Authentication ---
function getAuth() {
  // Prefer the single JSON variable if it exists (for both local and GitHub Actions)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      return new JWT({
        email: serviceAccountKey.client_email,
        key: serviceAccountKey.private_key,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
    } catch (e) {
      throw new Error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON. Please ensure it is a valid JSON string.');
    }
  }

  // Fallback for separate EMAIL and KEY variables (legacy local setup)
  const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const private_key = process.env.GOOGLE_PRIVATE_KEY?.split('\n').join('\n');

  if (client_email && private_key) {
    return new JWT({
      email: client_email,
      key: private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  }

  throw new Error('Google Service Account credentials are not set. Please check environment variables.');
}

// --- Main script logic ---
async function main() {
  const executionTime = new Date();
  const jstExecutionTime = new Date(executionTime.getTime() + 9 * 60 * 60 * 1000);
  const jstTimeString = jstExecutionTime.toISOString().replace('T', ' ').substring(0, 19);
  infoLog(`Starting schedule check at ${jstTimeString} (JST)`);
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const executedJobs: { name: string; time: string; executedAt: string }[] = [];

  // 1. Find the main 'v-stock' folder
  const vStockFolderId = await getFolderIdByName(drive, 'v-stock');
  if (!vStockFolderId) {
    throw new Error("'v-stock' folder not found.");
  }
  debugLog(`Found 'v-stock' folder: ${vStockFolderId}`);

  // 2. Get all concept folders
  const conceptFolders = await getSubFolders(drive, vStockFolderId);
  debugLog(`Found ${conceptFolders.length} concept folders.`);

  const getDisplayName = (name: string): string => {
    if (!isGitHubActions) {
      return name;
    }
    return name.length > 2 ? `${name.substring(0, 2)}***` : name;
  };

  // 3. Iterate through each concept and check its schedule
  for (const folder of conceptFolders) {
    const rawFolderName = folder.name || '';
    const displayName = getDisplayName(rawFolderName);

    const configFile = await getFileByName(drive, folder.id!, 'config.json');
    if (!configFile) {
      infoLog(`- Skipping concept '${displayName}': config.json not found.`);
      continue;
    }

    const config = (await getFileContent(drive, configFile.id!)) as ConceptConfig;
    const configDisplayName = getDisplayName(config.name || rawFolderName);

    const postingTimes = ensurePostingTimesFromConfig(config);

    if (postingTimes.length === 0) {
      infoLog(`- Skipping concept '${configDisplayName}': posting times not defined.`);
      continue;
    }

    // Check for schedules in the last 59 minutes to avoid double-counting on the hour boundary.
    const checkRangeStart = new Date(executionTime.getTime() - 59 * 60 * 1000);
    const dueTime = postingTimes.find((time: string) => {
      const lastOccurrence = getMostRecentOccurrence(time, executionTime);
      return lastOccurrence >= checkRangeStart && lastOccurrence <= executionTime;
    });

    infoLog(`- Checking concept '${configDisplayName}': Times '${postingTimes.join(', ')}'.`);

    if (!dueTime) {
      continue;
    }

    infoLog(`  -> EXECUTING job for concept: ${configDisplayName} at ${dueTime}`);
    executedJobs.push({
      name: configDisplayName,
      time: dueTime,
      executedAt: executionTime.toISOString(),
    });

    // Trigger post-video.ts script
    const child = spawn('npx', ['tsx', 'scripts/post-video.ts'], {
      shell: true, // Add this for resolving `npx` in different environments
      env: {
        ...process.env,
        CONCEPT_ID: folder.id!,
        GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      },
      stdio: 'inherit',
    });

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          infoLog(`  -> Post-video script for ${configDisplayName} completed successfully.`);
          resolve(null);
        } else {
          errorLog(`  -> Post-video script for ${configDisplayName} failed with code ${code}.`);
          reject(new Error(`Post-video script failed for ${configDisplayName}`));
        }
      });
      child.on('error', (err) => {
        errorLog(`  -> Failed to start post-video script for ${configDisplayName}:`, err);
        reject(err);
      });
    });
  }

  infoLog('\n--- Execution Summary ---');
  if (executedJobs.length > 0) {
    infoLog('Successfully executed jobs for scheduled concepts:', executedJobs);
  } else {
    infoLog('No concepts were scheduled to run in the last hour.');
  }
  infoLog(`Finished schedule check at ${new Date().toISOString()}`);
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
  const [jstHour, jstMinute] = time.split(':').map(Number);

  // 1. Get today's date parts in JST
  const jstNow = new Date(reference.getTime() + 9 * 60 * 60 * 1000);
  const year = jstNow.getUTCFullYear();
  const month = jstNow.getUTCMonth();
  const day = jstNow.getUTCDate();

  // 2. Construct today's scheduled time as if it were a UTC date, then convert its timestamp to the actual UTC time
  const scheduledJstDate = new Date(Date.UTC(year, month, day, jstHour, jstMinute));
  const scheduledUtcTimestamp = scheduledJstDate.getTime() - 9 * 60 * 60 * 1000;
  let candidate = new Date(scheduledUtcTimestamp);

  // 3. Check if this candidate time is in the future relative to the current time
  if (candidate > reference) {
    // If it's in the future, the most recent occurrence was 24 hours ago.
    candidate.setTime(candidate.getTime() - 24 * 60 * 60 * 1000);
  }

  return candidate;
}

// --- Run the script ---
main().catch(error => {
  errorLog('An unexpected error occurred:', error);
  process.exit(1);
});