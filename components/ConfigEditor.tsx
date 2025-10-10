import React, { useState, useEffect } from 'react';
import type { ConceptConfig } from '../types.js';
import { withNormalizedPostingTimes } from '../utils/schedule.js';
import { Card } from './Card.js';
import { ApiConfig } from './ApiConfig.js';
import { PlatformSelector } from './PlatformSelector.js';
import { VideoDetails } from './VideoDetails.js';

interface ConfigEditorProps {
    conceptId: string;
    conceptConfig: ConceptConfig;
    onSave: (newConfig: ConceptConfig) => Promise<void>;
    onRefresh: () => void;
    instagramAccounts: any[];
    accessToken: string | null;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({ conceptId, conceptConfig, onSave, onRefresh, instagramAccounts, accessToken }) => {
    const [config, setConfig] = useState<ConceptConfig>(withNormalizedPostingTimes(conceptConfig));
    const [isSaving, setIsSaving] = useState(false);
    
    // When the selected concept changes, reset the local state
    useEffect(() => {
        setConfig(withNormalizedPostingTimes(conceptConfig));
    }, [conceptConfig]);

    const handleSaveClick = async () => {
        setIsSaving(true);
        try {
            await onSave(withNormalizedPostingTimes(config));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="h-full flex flex-col">
            <div className="flex-grow space-y-8 overflow-y-auto pr-2">
                <h2 className="text-xl font-bold text-slate-100">Concept Configuration</h2>
                <div className="mt-6 pt-6 border-t border-slate-700">
                    <button
                        onClick={handleSaveClick}
                        disabled={isSaving}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-green-800/60 disabled:cursor-not-allowed"
                    >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
                <VideoDetails config={config} setConfig={setConfig} />
                <PlatformSelector 
                    selectedPlatforms={config.platforms} 
                    setSelectedPlatforms={(platforms) => setConfig(c => ({ ...c, platforms }))}
                />
                <ApiConfig 
                    conceptId={conceptId} 
                    config={config} 
                    setConfig={setConfig} 
                    onRefresh={onRefresh} 
                    onSave={onSave} 
                    instagramAccounts={instagramAccounts} 
                    accessToken={accessToken}
                />
            </div>
        </Card>
    );
};