import React, { useState } from 'react';
import type { VideoFile, ConceptConfig } from '../types';
import { DEFAULT_POST_DETAILS } from '../types';
import { SpinnerIcon } from './icons/UtilityIcons';
import { Card } from './Card';
import { VideoPostDetailsEditor } from './VideoPostDetailsEditor';

interface VideoStatusProps {
  queuedVideos: VideoFile[];
  postedVideos: VideoFile[];
  isLoading: boolean;
  onInitiatePost: (videoId: string) => void;
  postingVideoId: string | null;
  conceptDefaultPostDetails: ConceptConfig['postDetails'];
  onUpdateVideoPostDetails: (videoId: string, postDetails: ConceptConfig['postDetails']) => Promise<void>;
  onMoveVideo: (videoId: string, from: 'queue' | 'posted') => Promise<void>;
  onDeleteVideo: (videoId: string, from: 'queue' | 'posted') => Promise<void>;
  videoActionBusyId: string | null;
}

type Tab = 'Queued' | 'Posted';

interface VideoListProps {
    listType: 'queue' | 'posted';
    videos: VideoFile[];
    onPost: (videoId: string) => void;
    postingVideoId: string | null;
    onEditPostDetails: (video: VideoFile) => void;
    onMoveVideo: (videoId: string) => void;
    onDeleteVideo: (videoId: string) => void;
    actionBusyId: string | null;
    conceptDefaultPostDetails: ConceptConfig['postDetails'];
}

const VideoList: React.FC<VideoListProps> = ({ listType, videos, onPost, postingVideoId, onEditPostDetails, onMoveVideo, onDeleteVideo, actionBusyId, conceptDefaultPostDetails }) => {
    if (videos.length === 0) {
        return <p className="text-center text-slate-400 py-8">No videos in this list.</p>;
    }
    const moveLabel = listType === 'queue' ? 'Move to Posted' : 'Move to Queue';
    const postLabel = listType === 'queue' ? 'Post' : 'Post Again';
    return (
        <div className="space-y-3">
            {videos.map(video => {
                const isCurrentlyPosting = postingVideoId === video.id;
                const isActionBusy = actionBusyId === video.id;
                const basePostDetails = {
                    ...DEFAULT_POST_DETAILS,
                    ...(conceptDefaultPostDetails ?? {}),
                };
                const effectivePostDetails = video.postDetailsOverride
                    ? { ...basePostDetails, ...video.postDetailsOverride }
                    : basePostDetails;

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
                            <div className="flex-grow">
                                <span className="text-sm text-slate-200 truncate block" title={effectivePostDetails.title}>
                                    {effectivePostDetails.title}
                                </span>
                                <span className="text-xs text-slate-400 truncate block" title={effectivePostDetails.description}>
                                    {effectivePostDetails.description}
                                </span>
                                {effectivePostDetails.hashtags && (
                                    <span className="text-xs text-indigo-300 truncate block" title={effectivePostDetails.hashtags}>
                                        {effectivePostDetails.hashtags}
                                    </span>
                                )}
                            </div>
                        </a>
                        <button
                            type="button"
                            onClick={() => onEditPostDetails(video)}
                            className="ml-2 px-3 py-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 rounded-md border border-indigo-400 hover:border-indigo-300 transition-colors"
                        >
                            Edit Details
                        </button>
                        <button
                            type="button"
                            onClick={() => onPost(video.id)}
                            className="ml-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg text-sm flex-shrink-0 flex justify-center items-center"
                            disabled={isCurrentlyPosting || isActionBusy || !!postingVideoId}
                        >
                            {isCurrentlyPosting ? <SpinnerIcon className="w-5 h-5" /> : postLabel}
                        </button>
                        <button
                            type="button"
                            onClick={() => onMoveVideo(video.id)}
                            className="ml-2 bg-slate-600 hover:bg-slate-500 text-white font-medium py-2 px-4 rounded-lg text-sm flex-shrink-0 flex justify-center items-center"
                            disabled={isCurrentlyPosting || isActionBusy}
                        >
                            {isActionBusy ? <SpinnerIcon className="w-5 h-5" /> : moveLabel}
                        </button>
                        <button
                            type="button"
                            onClick={() => onDeleteVideo(video.id)}
                            className="ml-2 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-3 rounded-lg text-sm flex-shrink-0"
                            disabled={isCurrentlyPosting || isActionBusy}
                        >
                            {isActionBusy ? <SpinnerIcon className="w-4 h-4" /> : 'Delete'}
                        </button>
                    </div>
                )
            })}
        </div>
    );
};

export const VideoStatus: React.FC<VideoStatusProps> = ({
  queuedVideos,
  postedVideos,
  isLoading,
  onInitiatePost,
  postingVideoId,
  conceptDefaultPostDetails,
  onUpdateVideoPostDetails,
  onMoveVideo,
  onDeleteVideo,
  videoActionBusyId,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('Queued');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [videoToEdit, setVideoToEdit] = useState<VideoFile | null>(null);

  const handleEditPostDetails = (video: VideoFile) => {
    setVideoToEdit(video);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setVideoToEdit(null);
  };

  const handleSavePostDetails = async (videoId: string, postDetails: ConceptConfig['postDetails']) => {
    await onUpdateVideoPostDetails(videoId, postDetails);
    handleCloseEditor();
  };

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
              {activeTab === 'Queued' && (
                <VideoList
                  listType="queue"
                  videos={queuedVideos}
                  onPost={onInitiatePost}
                  postingVideoId={postingVideoId}
                  onEditPostDetails={handleEditPostDetails}
                  onMoveVideo={(videoId) => { void onMoveVideo(videoId, 'queue'); }}
                  onDeleteVideo={(videoId) => { void onDeleteVideo(videoId, 'queue'); }}
                  actionBusyId={videoActionBusyId}
                  conceptDefaultPostDetails={conceptDefaultPostDetails}
                />
              )}
              {activeTab === 'Posted' && (
                <VideoList
                  listType="posted"
                  videos={postedVideos}
                  onPost={onInitiatePost}
                  postingVideoId={postingVideoId}
                  onEditPostDetails={handleEditPostDetails}
                  onMoveVideo={(videoId) => { void onMoveVideo(videoId, 'posted'); }}
                  onDeleteVideo={(videoId) => { void onDeleteVideo(videoId, 'posted'); }}
                  actionBusyId={videoActionBusyId}
                  conceptDefaultPostDetails={conceptDefaultPostDetails}
                />
              )}
            </>
        )}
      </div>

      {videoToEdit && (
        <VideoPostDetailsEditor
          isOpen={isEditorOpen}
          onClose={handleCloseEditor}
          onSave={handleSavePostDetails}
          video={videoToEdit}
          conceptDefaultPostDetails={conceptDefaultPostDetails}
        />
      )}
    </Card>
  );
};
