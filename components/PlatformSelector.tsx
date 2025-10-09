import React from 'react';
import type { PlatformInfo, SelectedPlatforms } from '../types';
import { platforms } from '../constants';


interface PlatformSelectorProps {
  selectedPlatforms: SelectedPlatforms;
  setSelectedPlatforms: (platforms: SelectedPlatforms) => void;
}

export const PlatformSelector: React.FC<PlatformSelectorProps> = ({ selectedPlatforms, setSelectedPlatforms }) => {
  const handleToggle = (platformName: keyof SelectedPlatforms) => {
    setSelectedPlatforms({
      ...selectedPlatforms,
      [platformName]: !selectedPlatforms[platformName],
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-200">Target Platforms</h3>
      <div className="space-y-3">
        {platforms.map((platform: PlatformInfo) => (
          <div
            key={platform.name}
            onClick={() => handleToggle(platform.name)}
            className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
              selectedPlatforms[platform.name]
                ? 'bg-indigo-900/50 border-indigo-500'
                : 'bg-slate-700/50 border-slate-600 hover:border-slate-500'
            }`}
          >
            <div className="flex-shrink-0 mr-4">
              <platform.icon className="w-8 h-8" />
            </div>
            <div className="flex-grow">
              <h4 className="font-bold text-slate-100">{platform.name}</h4>
              <p className="text-xs text-slate-400">{platform.description}</p>
            </div>
            <div className="flex-shrink-0 ml-4">
              <div
                className={`w-6 h-6 rounded-md flex items-center justify-center border-2 transition-all ${
                  selectedPlatforms[platform.name]
                    ? 'bg-indigo-600 border-indigo-500'
                    : 'bg-slate-600 border-slate-500'
                }`}
              >
                {selectedPlatforms[platform.name] && (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
