import React, { useState, useEffect } from 'react';
import type { VideoFile, ConceptConfig } from '../types';
import { DEFAULT_POST_DETAILS } from '../types';
import { TextInput } from './TextInput';
import { Card } from './Card';

interface VideoPostDetailsEditorProps {
  video: VideoFile;
  conceptDefaultPostDetails: ConceptConfig['postDetails'];
  onSave: (videoId: string, postDetails: ConceptConfig['postDetails']) => Promise<void>;
  onClose: () => void;
  isOpen: boolean;
}

const buildPostDetails = (details?: Partial<ConceptConfig['postDetails']> | null) => ({
  ...DEFAULT_POST_DETAILS,
  ...(details ?? {}),
});

export const VideoPostDetailsEditor: React.FC<VideoPostDetailsEditorProps> = ({
  video,
  conceptDefaultPostDetails,
  onSave,
  onClose,
  isOpen,
}) => {
  const [editedPostDetails, setEditedPostDetails] = useState<ConceptConfig['postDetails']>(() =>
    buildPostDetails(video.postDetailsOverride ?? conceptDefaultPostDetails)
  );
  const [isSaving, setIsSaving] = useState(false);

  // Reset state when video or conceptDefaultPostDetails changes
  useEffect(() => {
    setEditedPostDetails(buildPostDetails(video.postDetailsOverride ?? conceptDefaultPostDetails));
  }, [video, conceptDefaultPostDetails]);

  if (!isOpen) return null;

  const handlePostDetailChange = (
    field: 'title' | 'description' | 'hashtags' | 'aiLabel',
    value: string | boolean
  ) => {
    setEditedPostDetails(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(video.id, editedPostDetails);
      onClose();
    } catch (error) {
      console.error('Failed to save video post details override:', error);
      alert('Failed to save changes. Check console for details.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-75 flex items-center justify-center z-50">
      <Card className="w-full max-w-lg p-6 space-y-4">
        <h3 className="text-xl font-bold text-slate-100">Edit Post Details for "{video.name}"</h3>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Title</label>
          <TextInput
            id="videoTitle"
            value={editedPostDetails.title}
            onChange={(e) => handlePostDetailChange('title', e.target.value)}
            placeholder="Video Title"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
          <TextInput
            id="videoDescription"
            value={editedPostDetails.description}
            onChange={(e) => handlePostDetailChange('description', e.target.value)}
            placeholder="Video Description"
            multiline
          />
        </div>

        {/* Hashtags */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Hashtags</label>
          <TextInput
            id="videoHashtags"
            value={editedPostDetails.hashtags}
            onChange={(e) => handlePostDetailChange('hashtags', e.target.value)}
            placeholder="#hashtags"
          />
        </div>

        {/* AI Label */}
        <div className="flex items-center mt-4">
          <input
            id="videoAiLabel"
            type="checkbox"
            checked={editedPostDetails.aiLabel}
            onChange={(e) => handlePostDetailChange('aiLabel', e.target.checked)}
            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
          />
          <label htmlFor="videoAiLabel" className="ml-2 block text-sm text-slate-300">
            Apply AI Label (TikTok, Instagram)
          </label>
        </div>

        <div className="flex justify-end space-x-4 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-md hover:bg-slate-600"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </Card>
    </div>
  );
};
