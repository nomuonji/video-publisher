import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { spawn } from 'child_process';
import type { ConceptConfig } from '../types.js';
import { ensurePostingTimesFromConfig } from '../utils/schedule.js';
import { infoLog, debugLog, errorLog, isGitHubActions } from '../utils/logger.js';

// Minimum gap between two actual posts for the same concept. Catch-up may want
// to fire several overdue slots at once; this keeps them from landing together.
const MIN_POST_INTERVAL_MS = 45 * 60 * 1000;

// DRY_RUN=1 evaluates the schedule and reports what would happen without
// posting or writing state. Used to verify catch-up behaviour safely.
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

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

    // The scheduler is not reliable: GitHub drops or delays scheduled runs, so a
    // "did a slot fall in the last 59 minutes" check silently skips any slot the
    // runner missed. Instead, compare the most recent scheduled slot that has
    // already started against the last slot this concept actually handled.
    // A missed slot is therefore picked up late rather than lost.
    const latestSlot = postingTimes
      .map((time: string) => getMostRecentOccurrence(time, executionTime))
      .reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));

    const lastPostedSlot = parseDate(config.lastPostedSlot);
    const lastPostedAt = parseDate(config.lastPostedAt);

    infoLog(
      `- Checking concept '${configDisplayName}': Times '${postingTimes.join(', ')}', latest slot ${formatJst(latestSlot)} (JST).`,
    );

    if (lastPostedSlot && lastPostedSlot.getTime() >= latestSlot.getTime()) {
      infoLog(`  -> Up to date (last handled slot: ${formatJst(lastPostedSlot)} JST).`);
      continue;
    }

    // Catch-up can fire twice in quick succession when two slots are overdue
    // (e.g. the 20:00 slot caught at 06:59, then the 07:00 slot one minute
    // later). Keep a minimum gap between actual posts.
    if (lastPostedAt && executionTime.getTime() - lastPostedAt.getTime() < MIN_POST_INTERVAL_MS) {
      infoLog(
        `  -> Deferring: last post was ${Math.round(
          (executionTime.getTime() - lastPostedAt.getTime()) / 60000,
        )} min ago (minimum interval is ${MIN_POST_INTERVAL_MS / 60000} min).`,
      );
      continue;
    }

    const slotLabel = formatJst(latestSlot);
    infoLog(`  -> EXECUTING job for concept: ${configDisplayName} (slot ${slotLabel} JST)`);

    if (DRY_RUN) {
      infoLog('  -> DRY_RUN: not posting and not recording the slot.');
      executedJobs.push({
        name: configDisplayName,
        time: slotLabel,
        executedAt: 'DRY_RUN',
      });
      continue;
    }

    executedJobs.push({
      name: configDisplayName,
      time: slotLabel,
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
      child.on('close', async (code) => {
        if (code === 0) {
          infoLog(`  -> Post-video script for ${configDisplayName} completed successfully.`);
          // Record the slot we just handled so the next run does not repeat it.
          // If this write fails the slot is retried, which risks a duplicate
          // post but never a silently skipped one.
          try {
            await updateConfigFields(drive, configFile.id!, {
              lastPostedSlot: latestSlot.toISOString(),
              lastPostedAt: new Date().toISOString(),
            });
            infoLog(`  -> Recorded slot ${slotLabel} JST as handled.`);
          } catch (error) {
            errorLog(`  -> Failed to record the handled slot for ${configDisplayName}:`, error);
            reject(error);
            return;
          }
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
    infoLog(
      DRY_RUN ? 'DRY_RUN: concepts that would run:' : 'Successfully executed jobs for scheduled concepts:',
      executedJobs,
    );
  } else {
    infoLog('No concepts are due.');
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

async function updateConfigFields(drive: any, fileId: string, patch: Record<string, unknown>): Promise<void> {
    const current = await getFileContent(drive, fileId);
    const config = typeof current === 'string' ? JSON.parse(current) : current;
    const next = { ...config, ...patch };
    await drive.files.update({
        fileId,
        media: { mimeType: 'application/json', body: JSON.stringify(next, null, 2) },
    });
}

function parseDate(value: unknown): Date | null {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatJst(date: Date): string {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .substring(0, 16);
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