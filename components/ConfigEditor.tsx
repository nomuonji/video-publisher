import React, { useState, useEffect } from 'react';
import type { ConceptConfig } from '../types';
import { Card } from './Card';
import { ApiConfig } from './ApiConfig';
import { PlatformSelector } from './PlatformSelector';
import { VideoDetails } from './VideoDetails';

interface ConfigEditorProps {
    conceptId: string;
    conceptConfig: ConceptConfig;
    onSave: (newConfig: ConceptConfig) => Promise<void>;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({ conceptId, conceptConfig, onSave }) => {
    const [config, setConfig] = useState<ConceptConfig>(conceptConfig);
    const [isSaving, setIsSaving] = useState(false);
    
    // When the selected concept changes, reset the local state
    useEffect(() => {
        setConfig(conceptConfig);
    }, [conceptConfig]);

    const handleSaveClick = async () => {
        setIsSaving(true);
        try {
            await onSave(config);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="h-full flex flex-col">
            <div className="flex-grow space-y-8 overflow-y-auto pr-2">
                <h2 className="text-xl font-bold text-slate-100">Concept Configuration</h2>
                <VideoDetails config={config} setConfig={setConfig} />
                <PlatformSelector 
                    selectedPlatforms={config.platforms} 
                    setSelectedPlatforms={(platforms) => setConfig(c => ({ ...c, platforms }))}
                />
                <ApiConfig conceptId={conceptId} config={config} setConfig={setConfig} />
            </div>
            <div className="mt-6 pt-6 border-t border-slate-700">
                <button
                    onClick={handleSaveClick}
                    disabled={isSaving}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-green-800/60 disabled:cursor-not-allowed"
                >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </Card>
    );
};
