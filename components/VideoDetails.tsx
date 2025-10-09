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
    </div>
  );
};
