import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import parser from 'cron-parser';
import { spawn } from 'child_process';

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
  const executedJobs: { name: string; schedule: string; executedAt: string }[] = [];

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

    const config = await getFileContent(drive, configFile.id!);
    if (!config.schedule) {
      console.log(`- Skipping concept '${config.name || folder.name}': schedule not defined in config.`);
      continue;
    }

    // 4. Check if the schedule is due
    try {
      const options = { currentDate: executionTime };
      const interval = parser.parseExpression(config.schedule, options);
      const previousExecution = interval.previous().toDate();
      
      // Check if the scheduled time falls within the last hour
      const oneHourAgo = new Date(executionTime.getTime() - 60 * 60 * 1000);

      console.log(`- Checking concept '${config.name}': Schedule '${config.schedule}'. Last due: ${previousExecution.toISOString()}`);

      if (previousExecution >= oneHourAgo) {
        console.log(`  -> EXECUTING job for concept: ${config.name}`);
        executedJobs.push({ 
          name: config.name, 
          schedule: config.schedule, 
          executedAt: executionTime.toISOString() 
        });

        // Trigger post-video.ts script
        const child = spawn('npx', ['ts-node', 'scripts/post-video.ts'], {
          env: {
            ...process.env, // Pass all current environment variables
            CONCEPT_ID: folder.id!, // Pass the conceptId
            GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!, // Pass SA JSON
          },
          stdio: 'inherit', // Pipe child process output to parent's stdout/stderr
        });

        await new Promise((resolve, reject) => {
          child.on('close', (code) => {
            if (code === 0) {
              console.log(`  -> Post-video script for ${config.name} completed successfully.`);
              resolve(null);
            } else {
              console.error(`  -> Post-video script for ${config.name} failed with code ${code}.`);
              reject(new Error(`Post-video script failed for ${config.name}`));
            }
          });
          child.on('error', (err) => {
            console.error(`  -> Failed to start post-video script for ${config.name}:`, err);
            reject(err);
          });
        });
      }
    } catch (err: any) {
      console.error(`  -> ERROR: Could not parse schedule for '${config.name}': ${err.message}`);
    }
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

// --- Run the script ---
main().catch(error => {
  console.error('An unexpected error occurred:', error);
  process.exit(1);
});
