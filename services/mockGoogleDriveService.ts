import type { VideoFile, Concept, ConceptConfig } from '../types';

// --- In-Memory Mock Database ---

const mockDatabase: { [folderId: string]: any } = {};
const rootConcepts: string[] = [];

const createMockVideo = (id: number, name: string): VideoFile => ({
  id: `mock_video_${id}`,
  name: name,
  thumbnailLink: `https://via.placeholder.com/120x90.png?text=Video+${id}`,
  webViewLink: '#',
});

const createDefaultConfig = (name: string): ConceptConfig => ({
  name: name,
  schedule: '0 8 * * *',
  platforms: { YouTube: true, TikTok: true, Instagram: false },
  apiKeys: {
    tiktok: {
      access_token: '',
      expires_in: 0,
      open_id: '',
      refresh_expires_in: 0,
      refresh_token: '',
      scope: '',
      token_type: '',
    },
    instagram: '',
  }
});

const createNewConceptInDB = (name: string): Concept => {
  const conceptId = `mock_concept_${Date.now()}`;
  const queueId = `${conceptId}_queue`;
  const postedId = `${conceptId}_posted`;
  const configId = `${conceptId}_config.json`;

  const config = createDefaultConfig(name);

  mockDatabase[conceptId] = { type: 'folder', name: name, children: [queueId, postedId, configId] };
  mockDatabase[queueId] = { type: 'folder', name: 'queue', children: [] };
  mockDatabase[postedId] = { type: 'folder', name: 'posted', children: [] };
  mockDatabase[configId] = { type: 'file', name: 'config.json', content: config };

  // Add some mock videos to the new concept
  const video1 = createMockVideo(Math.floor(Math.random() * 1000), `${name}-vid1.mp4`);
  const video2 = createMockVideo(Math.floor(Math.random() * 1000), `${name}-vid2.mov`);
  const video3 = createMockVideo(Math.floor(Math.random() * 1000), `${name}-posted.mp4`);
  mockDatabase[video1.id] = { type: 'file', ...video1 };
  mockDatabase[video2.id] = { type: 'file', ...video2 };
  mockDatabase[video3.id] = { type: 'file', ...video3 };
  mockDatabase[queueId].children.push(video1.id, video2.id);
  mockDatabase[postedId].children.push(video3.id);
  
  rootConcepts.push(conceptId);

  return {
    googleDriveFolderId: conceptId,
    name: config.name,
    config: config,
    queueFolderId: queueId,
    postedFolderId: postedId,
  };
};

// Initialize with some default concepts
if (rootConcepts.length === 0) {
    createNewConceptInDB('Sourdough Baking');
    createNewConceptInDB('Weekly Coding Tips');
}


// --- Mock Service API ---

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const listConceptFolders = async (_accessToken: string): Promise<Concept[]> => {
  console.log('MOCK: Listing concept folders...');
  await delay(500);
  const concepts: Concept[] = rootConcepts.map(conceptId => {
    const conceptFolder = mockDatabase[conceptId];
    const configId = conceptFolder.children.find((id: string) => id.endsWith('config.json'));
    const queueId = conceptFolder.children.find((id: string) => mockDatabase[id].name === 'queue');
    const postedId = conceptFolder.children.find((id:string) => mockDatabase[id].name === 'posted');
    const config = mockDatabase[configId].content;

    return {
      googleDriveFolderId: conceptId,
      name: config.name,
      config: JSON.parse(JSON.stringify(config)), // Deep copy
      queueFolderId: queueId,
      postedFolderId: postedId,
    };
  });
  return concepts;
};

export const createConcept = async (_accessToken: string, name: string): Promise<Concept> => {
  console.log(`MOCK: Creating concept "${name}"...`);
  await delay(300);
  if (Object.values(mockDatabase).some(item => item.name === name && item.type === 'folder')) {
    throw new Error(`Concept with name "${name}" already exists.`);
  }
  return createNewConceptInDB(name);
};

export const deleteConcept = async (_accessToken: string, conceptId: string): Promise<void> => {
    console.log(`MOCK: Deleting concept "${conceptId}"...`);
    await delay(300);
    const index = rootConcepts.indexOf(conceptId);
    if (index > -1) {
        rootConcepts.splice(index, 1);
        // In a real scenario, you'd recursively delete children.
        // For mock, we just remove the root reference.
        delete mockDatabase[conceptId];
    }
    return Promise.resolve();
};

export const updateConceptConfig = async (_accessToken: string, conceptId: string, config: ConceptConfig): Promise<void> => {
    console.log(`MOCK: Updating config for "${conceptId}"...`);
    await delay(400);
    const conceptFolder = mockDatabase[conceptId];
    if (!conceptFolder) throw new Error("Concept not found");
    
    const configId = conceptFolder.children.find((id: string) => id.endsWith('config.json'));
    if (!configId) throw new Error("Config file not found");

    mockDatabase[configId].content = JSON.parse(JSON.stringify(config)); // Store a deep copy
    
    // Also update the folder name if the config name changed
    mockDatabase[conceptId].name = config.name;

    return Promise.resolve();
};


export const listVideos = async (_accessToken: string, folderId: string): Promise<VideoFile[]> => {
  console.log(`MOCK: Listing videos in folder "${folderId}"...`);
  await delay(600);
  const folder = mockDatabase[folderId];
  if (!folder || folder.type !== 'folder') {
    return [];
  }
  return folder.children.map((videoId: string) => {
    const videoData = mockDatabase[videoId];
    return {
        id: videoData.id,
        name: videoData.name,
        thumbnailLink: videoData.thumbnailLink,
        webViewLink: videoData.webViewLink,
    };
  });
};
