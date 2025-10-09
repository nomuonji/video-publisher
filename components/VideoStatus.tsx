import React, { useState } from 'react';
import type { VideoFile } from '../types';
import { SpinnerIcon } from './icons/UtilityIcons';
import { Card } from './Card';

interface VideoStatusProps {
  queuedVideos: VideoFile[];
  postedVideos: VideoFile[];
  isLoading: boolean;
  onInitiatePost: (videoId: string) => void;
  postingVideoId: string | null;
}

type Tab = 'Queued' | 'Posted';

interface VideoListProps {
    videos: VideoFile[];
    showPostButton: boolean;
    onPost?: (videoId: string) => void;
    postingVideoId: string | null;
}

const VideoList: React.FC<VideoListProps> = ({ videos, showPostButton, onPost, postingVideoId }) => {
    if (videos.length === 0) {
        return <p className="text-center text-slate-400 py-8">No videos in this list.</p>;
    }
    return (
        <div className="space-y-3">
            {videos.map(video => {
                const isCurrentlyPosting = postingVideoId === video.id;
                return (
                    <div
                        key={video.id}
                        className="flex items-center p-2 rounded-md bg-slate-700"
                    >
                        <a
                            href={video.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center flex-grow hover:bg-slate-600/70 transition-colors rounded-md p-1"
                        >
                            <img 
                                src={video.thumbnailLink || 'https://via.placeholder.com/120x90.png?text=No+Thumb'} 
                                alt={video.name} 
                                className="w-24 h-16 object-cover rounded-md mr-4 flex-shrink-0 bg-slate-800" 
                            />
                            <span className="text-sm text-slate-200 truncate" title={video.name}>
                                {video.name}
                            </span>
                        </a>
                        {showPostButton && onPost && (
                            <button
                                onClick={() => onPost(video.id)}
                                className="ml-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg text-sm flex-shrink-0 w-24 flex justify-center items-center"
                                disabled={isCurrentlyPosting || !!postingVideoId}
                            >
                                {isCurrentlyPosting ? <SpinnerIcon className="w-5 h-5" /> : 'Post'}
                            </button>
                        )}
                    </div>
                )
            })}
        </div>
    );
};

export const VideoStatus: React.FC<VideoStatusProps> = ({ queuedVideos, postedVideos, isLoading, onInitiatePost, postingVideoId }) => {
  const [activeTab, setActiveTab] = useState<Tab>('Queued');

  return (
    <Card className="h-full flex flex-col">
      <h2 className="text-xl font-bold text-slate-100 mb-4">Video Status</h2>
      
      <div className="border-b border-slate-700 mb-4">
        <nav className="-mb-px flex space-x-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('Queued')}
            className={`${
              activeTab === 'Queued'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-500'
            } whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors`}
          >
            Queued ({queuedVideos.length})
          </button>
          <button
            onClick={() => setActiveTab('Posted')}
            className={`${
              activeTab === 'Posted'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-500'
            } whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors`}
          >
            Posted ({postedVideos.length})
          </button>
        </nav>
      </div>

      <div className="flex-grow overflow-y-auto pr-2">
        {isLoading ? (
            <div className="flex justify-center items-center h-48">
                <SpinnerIcon className="w-8 h-8 text-slate-400" />
            </div>
        ) : (
            <>
              {activeTab === 'Queued' && <VideoList videos={queuedVideos} showPostButton={true} onPost={onInitiatePost} postingVideoId={postingVideoId} />}
              {activeTab === 'Posted' && <VideoList videos={postedVideos} showPostButton={false} postingVideoId={null} />}
            </>
        )}
      </div>
    </Card>
  );
};
