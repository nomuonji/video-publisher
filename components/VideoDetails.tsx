import React from 'react';
import type { ConceptConfig } from '../types';
import { DEFAULT_POST_DETAILS } from '../types';
import { cronFromTime, ensurePostingTimesFromConfig, normalizePostingTimesList, normalizeTimeString } from '../utils/schedule';
import { TextInput } from './TextInput';

interface VideoDetailsProps {
  config: ConceptConfig;
  setConfig: React.Dispatch<React.SetStateAction<ConceptConfig>>;
}

export const VideoDetails: React.FC<VideoDetailsProps> = ({ config, setConfig }) => {
  const handleChange = (field: keyof ConceptConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const updatePostingTimes = (updater: (times: string[]) => string[]) => {
    setConfig(prev => {
      const currentTimes = ensurePostingTimesFromConfig(prev);
      const updated = normalizePostingTimesList(updater(currentTimes));
      const finalTimes =
        updated.length > 0 ? updated : ensurePostingTimesFromConfig({ postingTimes: [] } as Partial<ConceptConfig>);

      return {
        ...prev,
        postingTimes: finalTimes,
        schedule: cronFromTime(finalTimes[0]),
      };
    });
  };

  const handlePostingTimeChange = (index: number, value: string) => {
    const normalized = normalizeTimeString(value);
    if (!normalized) return;
    updatePostingTimes(times => {
      const next = [...times];
      next[index] = normalized;
      return next;
    });
  };

  const handleRemovePostingTime = (index: number) => {
    updatePostingTimes(times => times.filter((_, idx) => idx !== index));
  };

  const handleAddPostingTime = () => {
    updatePostingTimes(times => [...times, '12:00']);
  };

  const handlePostDetailChange = (
    field: 'title' | 'description' | 'hashtags' | 'aiLabel',
    value: string | boolean
  ) => {
    setConfig(prev => ({
      ...prev,
      postDetails: {
        ...DEFAULT_POST_DETAILS,
        ...prev.postDetails,
        [field]: value,
      },
    }));
  };

  // Ensure postDetails is initialized
  const currentPostDetails = { ...DEFAULT_POST_DETAILS, ...(config.postDetails ?? {}) };
  const postingTimes = ensurePostingTimesFromConfig(config);
  const generatedCronPreview = postingTimes.length > 0 ? cronFromTime(postingTimes[0]) : '';

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-200">Basic Details</h3>
      <TextInput
        id="conceptName"
        label="Concept Name"
        value={config.name}
        onChange={(e) => handleChange('name', e.target.value)}
        placeholder="e.g., 'Weekly Baking Tips'"
      />
      
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">Posting Times (Daily, UTC)</label>
        <div className="space-y-2">
          {postingTimes.map((time, index) => (
            <div key={`${time}-${index}`} className="flex items-center gap-3">
              <input
                type="time"
                value={time}
                onChange={(e) => handlePostingTimeChange(index, e.target.value)}
                className="w-32 bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
              />
              {postingTimes.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemovePostingTime(index)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={handleAddPostingTime}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            + Add time
          </button>
          {generatedCronPreview && (
            <span className="text-xs text-slate-500">
              First cron expression: <code>{generatedCronPreview}</code>
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Times are interpreted in UTC. Each listed time triggers one publishing attempt per day.
        </p>
      </div>

      {/* New Post Details Section */}
      <div className="space-y-4 pt-4 border-t border-slate-700">
        <h3 className="text-lg font-semibold text-slate-200">Post Details</h3>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Video Title</label>
          <TextInput
            id="titleDefault"
            label="Title"
            value={currentPostDetails.title}
            onChange={(e) => handlePostDetailChange('title', e.target.value)}
            placeholder="e.g., My Awesome Video"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Video Description</label>
          <TextInput
            id="descriptionDefault"
            label="Description"
            value={currentPostDetails.description}
            onChange={(e) => handlePostDetailChange('description', e.target.value)}
            placeholder="e.g., Check out this amazing video!"
            multiline
          />
        </div>

        {/* Hashtags */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Hashtags</label>
          <TextInput
            id="hashtagsDefault"
            label="Hashtags"
            value={currentPostDetails.hashtags}
            onChange={(e) => handlePostDetailChange('hashtags', e.target.value)}
            placeholder="e.g., #awesome #video"
          />
        </div>

        {/* AI Label */}
        <div className="flex items-center mt-4">
          <input
            id="aiLabel"
            type="checkbox"
            checked={currentPostDetails.aiLabel}
            onChange={(e) => handlePostDetailChange('aiLabel', e.target.checked)}
            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
          />
          <label htmlFor="aiLabel" className="ml-2 block text-sm text-slate-300">
            Apply AI Label (TikTok, Instagram)
          </label>
        </div>
      </div>
    </div>
  );
};
