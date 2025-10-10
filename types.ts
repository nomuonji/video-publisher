import React from 'react';

// Represents a single video file in Google Drive
export interface VideoFile {
  id: string;
  name: string;
  thumbnailLink?: string; // Thumbnails might not always be available
  webViewLink: string;
  postDetailsOverride?: ConceptConfig['postDetails'];
}

export interface TikTokTokens {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
  display_name?: string;
  username?: string;
  avatar_url?: string;
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
  schedule?: string; // legacy cron format (optional)
  postingTimes: string[]; // Daily posting times in HH:mm (UTC)
  platforms: SelectedPlatforms;
  apiKeys: {
    youtube_refresh_token?: string; // For server-side publishing
    youtube_channel_id?: string;
    youtube_channel_name?: string;
    tiktok?: TikTokTokens | null;
    instagram: string;
  };
  postDetails: {
    title: string;
    description: string;
    hashtags: string;
    aiLabel: boolean;
  };
}

export const DEFAULT_POST_DETAILS: ConceptConfig['postDetails'] = {
  title: '',
  description: '',
  hashtags: '',
  aiLabel: false,
};

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

// --- Result types for posting API ---
export interface PlatformPostResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface PostResult {
  YouTube?: PlatformPostResult;
  TikTok?: PlatformPostResult;
  Instagram?: PlatformPostResult;
}