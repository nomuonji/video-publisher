import React from 'react';

// Represents a single video file in Google Drive
export interface VideoFile {
  id: string;
  name: string;
  thumbnailLink?: string; // Thumbnails might not always be available
  webViewLink: string;
}

export interface TikTokTokens {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

// Represents the platforms selected for posting
export interface SelectedPlatforms {
  YouTube: boolean;
  TikTok: boolean;
  Instagram: boolean;
  [key: string]: boolean;
}

// Represents the configuration for a single concept, stored in config.json
export interface ConceptConfig {
  name: string;
  schedule: string; // e.g., '0 8 * * *' (cron format)
  platforms: SelectedPlatforms;
      apiKeys: {
      youtube_refresh_token?: string; // For server-side publishing
      youtube_channel_id?: string;
      tiktok: TikTokTokens;
      instagram: string;
    };}

// Represents a full concept, which is a folder in Google Drive
export interface Concept {
  googleDriveFolderId: string;
  name: string;
  config: ConceptConfig;
  queueFolderId: string;
  postedFolderId: string;
}

// For platform components
export interface PlatformInfo {
  name: keyof SelectedPlatforms;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  description: string;
}
