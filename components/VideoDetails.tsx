import React from 'react';
import type { ConceptConfig } from '../types';
import { TextInput } from './TextInput';

interface VideoDetailsProps {
  config: ConceptConfig;
  setConfig: React.Dispatch<React.SetStateAction<ConceptConfig>>;
}

export const VideoDetails: React.FC<VideoDetailsProps> = ({ config, setConfig }) => {
  const handleChange = (field: keyof ConceptConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  // Parse cron string to get time
  const [minute, hour] = config.schedule.split(' ');

  const handleTimeChange = (part: 'hour' | 'minute', value: string) => {
    const numericValue = parseInt(value, 10);
    if (isNaN(numericValue)) return;

    let newHour = hour;
    let newMinute = minute;

    if (part === 'hour') {
      if (numericValue < 0 || numericValue > 23) return;
      newHour = String(numericValue);
    } else {
      if (numericValue < 0 || numericValue > 59) return;
      newMinute = String(numericValue);
    }

    // Reconstruct the cron string for a daily schedule
    const newSchedule = `${newMinute} ${newHour} * * *`;
    setConfig(prev => ({ ...prev, schedule: newSchedule }));
  };

  const handlePostDetailChange = (
    field: 'title' | 'description' | 'hashtags' | 'aiLabel',
    value: string | boolean
  ) => {
    setConfig(prev => ({
      ...prev,
      postDetails: {
        ...prev.postDetails,
        [field]: value,
      },
    }));
  };

  // Ensure postDetails is initialized
  const currentPostDetails = config.postDetails || { title: '', description: '', hashtags: '', aiLabel: false };

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
        <label className="block text-sm font-medium text-slate-300 mb-1">Posting Schedule (Daily)</label>
        <div className="flex items-center gap-4">
            <div className="w-1/2">
                <TextInput
                    id="scheduleHour"
                    label="Hour (0-23)"
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => handleTimeChange('hour', e.target.value)}
                />
            </div>
            <div className="w-1/2">
                <TextInput
                    id="scheduleMinute"
                    label="Minute (0-59)"
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(e) => handleTimeChange('minute', e.target.value)}
                />
            </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">Schedule is in UTC. Current cron: <code>{config.schedule}</code></p>
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
