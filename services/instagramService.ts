
import fetch from 'node-fetch';

const GRAPH_API_URL = 'https://graph.facebook.com/v19.0';

interface InstagramPostParams {
  accessToken: string;
  instagramAccountId: string;
  videoUrl: string;
  caption: string;
}

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// This is a complex, multi-step process.
export async function postVideoToInstagram(params: InstagramPostParams): Promise<any> {
  const { accessToken, instagramAccountId, videoUrl, caption } = params;

  // Step 1: Create a media container
  console.log('Instagram: Creating media container...');
  const createContainerUrl = `${GRAPH_API_URL}/${instagramAccountId}/media`;
  const createParams = new URLSearchParams({
    video_url: videoUrl,
    media_type: 'VIDEO',
    caption: caption,
    access_token: accessToken,
  });

  const createRes = await fetch(`${createContainerUrl}?${createParams.toString()}`, { method: 'POST' });
  const createData = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`Failed to create Instagram container: ${createData.error?.message || 'Unknown error'}`);
  }
  const containerId = createData.id;
  console.log(`Instagram: Container created with ID: ${containerId}`);

  // Step 2: Poll the container status until it's FINISHED
  console.log('Instagram: Waiting for video to finish uploading...');
  let status = 'IN_PROGRESS';
  let statusData;
  while (status === 'IN_PROGRESS') {
    await delay(5000); // Wait 5 seconds between checks
    const statusUrl = `${GRAPH_API_URL}/${containerId}`;
    const statusParams = new URLSearchParams({ access_token: accessToken, fields: 'status_code' });
    const statusRes = await fetch(`${statusUrl}?${statusParams.toString()}`);
    statusData = await statusRes.json();
    if (!statusRes.ok) {
        throw new Error(`Failed to get container status: ${statusData.error?.message || 'Unknown error'}`);
    }
    status = statusData.status_code;
    console.log(`Instagram: Container status is ${status}`);
  }

  if (status !== 'FINISHED') {
    throw new Error(`Instagram video processing failed with status: ${status}. Error details: ${statusData.error_message}`);
  }

  // Step 3: Publish the container
  console.log('Instagram: Publishing container...');
  const publishUrl = `${GRAPH_API_URL}/${instagramAccountId}/media_publish`;
  const publishParams = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });

  const publishRes = await fetch(`${publishUrl}?${publishParams.toString()}`, { method: 'POST' });
  const publishData = await publishRes.json();
  if (!publishRes.ok) {
    throw new Error(`Failed to publish Instagram container: ${publishData.error?.message || 'Unknown error'}`);
  }

  console.log(`Instagram: Successfully published video with ID: ${publishData.id}`);
  return publishData;
}
