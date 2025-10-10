import React, { useState } from 'react';
import type { VideoFile, SelectedPlatforms } from '../types.js';
import { Card } from './Card.js';
import { PlatformSelector } from './PlatformSelector.js';

interface PostConfirmationModalProps {
  video: VideoFile;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedPlatforms: SelectedPlatforms) => void;
  isPosting: boolean;
}

export const PostConfirmationModal: React.FC<PostConfirmationModalProps> = ({ video, isOpen, onClose, onConfirm, isPosting }) => {
  const [selectedPlatforms, setSelectedPlatforms] = useState<SelectedPlatforms>({
    YouTube: true,
    TikTok: true,
    Instagram: false,
  });

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (Object.values(selectedPlatforms).every(v => !v)) {
        alert('Please select at least one platform to post to.');
        return;
    }
    onConfirm(selectedPlatforms);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl">
        <h2 className="text-2xl font-bold text-white mb-4">Post Video</h2>
        <div className="flex gap-6 mb-6">
            <img 
                src={video.thumbnailLink || 'https://via.placeholder.com/120x90.png?text=No+Thumb'} 
                alt={video.name} 
                className="w-48 h-36 object-cover rounded-lg bg-slate-700 flex-shrink-0"
            />
            <div>
                <h3 className="text-lg font-semibold text-slate-100">{video.name}</h3>
                <p className="text-sm text-slate-400 mt-1">You are about to post this video. Select the platforms below.</p>
            </div>
        </div>

        <PlatformSelector 
            selectedPlatforms={selectedPlatforms} 
            setSelectedPlatforms={setSelectedPlatforms} 
        />

        <div className="flex justify-end gap-4 mt-8">
          <button 
            onClick={onClose} 
            disabled={isPosting}
            className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm} 
            disabled={isPosting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPosting ? 'Posting...' : 'Confirm & Post'}
          </button>
        </div>
      </Card>
    </div>
  );
};