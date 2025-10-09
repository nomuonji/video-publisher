import type { VideoFile, Concept, ConceptConfig } from '../types';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const V_STOCK_FOLDER_NAME = 'v-stock';

// --- Helper Functions using Fetch ---

const apiFetch = async (url: string, options: RequestInit) => {
    const response = await fetch(url, options);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Google Drive API Error: ${errorData.error?.message || errorData.message}`);
    }
    return response.json();
};

const getVStockFolderId = async (accessToken: string): Promise<string> => {
    const url = `${DRIVE_API_URL}?q=mimeType='application/vnd.google-apps.folder' and name='${V_STOCK_FOLDER_NAME}' and trashed=false&fields=files(id, name)`;
    const options = {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    };
    const data = await apiFetch(url, options);

    if (data.files.length > 0) {
        return data.files[0].id;
    } else {
        const fileMetadata = {
            name: V_STOCK_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
        };
        const createOptions = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(fileMetadata),
        };
        const createdFile = await apiFetch(`${DRIVE_API_URL}?fields=id`, createOptions);
        return createdFile.id;
    }
};

const createSubFolder = async (accessToken: string, name: string, parentId: string): Promise<string> => {
    const fileMetadata = {
        name: name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
    };
    const options = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(fileMetadata),
    };
    const data = await apiFetch(`${DRIVE_API_URL}?fields=id`, options);
    return data.id;
};

const createConfigFile = async (accessToken: string, config: ConceptConfig, parentId: string): Promise<string> => {
    const fileMetadata = {
        name: 'config.json',
        mimeType: 'application/json',
        parents: [parentId],
    };
    const options = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(fileMetadata),
    };
    const createdFile = await apiFetch(`${DRIVE_API_URL}?fields=id`, options);

    const uploadOptions = {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(config, null, 2),
    };
    await apiFetch(`${DRIVE_UPLOAD_URL}/${createdFile.id}?uploadType=media`, uploadOptions);

    return createdFile.id;
};

// --- Exported Service Functions ---

export const listConceptFolders = async (accessToken: string): Promise<Concept[]> => {
    const parentFolderId = await getVStockFolderId(accessToken);
    const url = `${DRIVE_API_URL}?q='${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id, name)`;
    const options = { headers: { 'Authorization': `Bearer ${accessToken}` } };
    const data = await apiFetch(url, options);

    const conceptPromises = data.files.map(async (folder: any) => {
        const subFilesUrl = `${DRIVE_API_URL}?q='${folder.id}' in parents and trashed=false&fields=files(id, name, mimeType)`;
        const subFilesData = await apiFetch(subFilesUrl, options);

        const queueFolder = subFilesData.files.find((f: any) => f.name === 'queue');
        const postedFolder = subFilesData.files.find((f: any) => f.name === 'posted');
        const configFile = subFilesData.files.find((f: any) => f.name === 'config.json');

        if (!queueFolder || !postedFolder || !configFile) return null;

        const configUrl = `${DRIVE_API_URL}/${configFile.id}?alt=media`;
        const configResponse = await fetch(configUrl, options);
        if (!configResponse.ok) return null;
        const config: ConceptConfig = await configResponse.json();

        return {
            googleDriveFolderId: folder.id,
            name: config.name || folder.name,
            config,
            queueFolderId: queueFolder.id,
            postedFolderId: postedFolder.id,
        };
    });

    const concepts = (await Promise.all(conceptPromises)).filter(Boolean);
    return concepts as Concept[];
};

export const createConcept = async (accessToken: string, name: string): Promise<Concept> => {
    const parentFolderId = await getVStockFolderId(accessToken);
    const conceptFolderId = await createSubFolder(accessToken, name, parentFolderId);
    
    const queueFolderId = await createSubFolder(accessToken, 'queue', conceptFolderId);
    const postedFolderId = await createSubFolder(accessToken, 'posted', conceptFolderId);
    
    const defaultConfig: ConceptConfig = {
      name: name,
      schedule: '0 8 * * *',
      platforms: { YouTube: true, TikTok: true, Instagram: false },
      apiKeys: { gemini: '', youtube: '', tiktok: '', instagram: '' }
    };

    await createConfigFile(accessToken, defaultConfig, conceptFolderId);

    return {
        googleDriveFolderId: conceptFolderId,
        name: name,
        config: defaultConfig,
        queueFolderId: queueFolderId,
        postedFolderId: postedFolderId
    };
};

export const deleteConcept = async (accessToken: string, conceptId: string): Promise<void> => {
    const url = `${DRIVE_API_URL}/${conceptId}`;
    const options = {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` },
    };
    const response = await fetch(url, options);
     if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Google Drive API Error: ${errorData.error?.message || errorData.message}`);
    }
};

export const updateConceptConfig = async (accessToken: string, conceptId: string, config: ConceptConfig): Promise<void> => {
    const listUrl = `${DRIVE_API_URL}?q='${conceptId}' in parents and name='config.json' and trashed=false&fields=files(id)`;
    const listOptions = { headers: { 'Authorization': `Bearer ${accessToken}` } };
    const data = await apiFetch(listUrl, listOptions);

    if (data.files.length === 0) {
        throw new Error('config.json not found for this concept.');
    }
    const configFileId = data.files[0].id;
    
    const uploadUrl = `${DRIVE_UPLOAD_URL}/${configFileId}?uploadType=media`;
    const uploadOptions = {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(config, null, 2),
    };
    await apiFetch(uploadUrl, uploadOptions);
    
    const updateUrl = `${DRIVE_API_URL}/${conceptId}`;
    const updateOptions = {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: config.name }),
    };
    await apiFetch(updateUrl, updateOptions);
};

export const listVideos = async (accessToken: string, folderId: string): Promise<VideoFile[]> => {
    const url = `${DRIVE_API_URL}?q='${folderId}' in parents and mimeType contains 'video/' and trashed=false&fields=files(id, name, thumbnailLink, webViewLink)&pageSize=100`;
    const options = { headers: { 'Authorization': `Bearer ${accessToken}` } };
    const data = await apiFetch(url, options);

    return data.files?.map((file: any) => ({
        id: file.id!,
        name: file.name!,
        thumbnailLink: file.thumbnailLink!,
        webViewLink: file.webViewLink!,
    })) || [];
};

export const getInstagramAccounts = async (accessToken: string): Promise<any[]> => {
    const parentFolderId = await getVStockFolderId(accessToken);
    const url = `${DRIVE_API_URL}?q='${parentFolderId}' in parents and name='instagram_accounts.json' and trashed=false&fields=files(id)`;
    const options = { headers: { 'Authorization': `Bearer ${accessToken}` } };
    const data = await apiFetch(url, options);

    if (data.files.length === 0) {
        return []; // Return empty array if the file doesn't exist
    }

    const configFileId = data.files[0].id;
    const configUrl = `${DRIVE_API_URL}/${configFileId}?alt=media`;
    const configResponse = await fetch(configUrl, options);
    if (!configResponse.ok) {
        return [];
    }
    return configResponse.json();
};


