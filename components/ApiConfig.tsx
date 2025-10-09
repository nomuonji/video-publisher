import React, { useEffect } from 'react';
import type { ConceptConfig } from '../types';
import { TextInput } from './TextInput';

interface ApiConfigProps {
    conceptId: string;
    config: ConceptConfig;
    setConfig: React.Dispatch<React.SetStateAction<ConceptConfig>>;
}

export const ApiConfig: React.FC<ApiConfigProps> = ({ conceptId, config, setConfig }) => {

    const isYouTubeConnected = !!config.apiKeys.youtube_refresh_token;

    // Listen for messages from the auth popup
    useEffect(() => {
        const handleAuthMessage = (event: MessageEvent) => {
            // IMPORTANT: Check the origin of the message for security
            if (event.origin !== window.location.origin) {
                return;
            }

            const { status, service } = event.data;
            if (service === 'youtube' && status === 'success') {
                // Optimistically update the UI. The real token is saved server-side.
                // The UI will show the true state on the next full data refresh.
                setConfig(prev => ({
                    ...prev,
                    apiKeys: { ...prev.apiKeys, youtube_refresh_token: 'connected' },
                }));
            }
            // You could also handle error messages here if needed
        };

        window.addEventListener('message', handleAuthMessage);

        return () => {
            window.removeEventListener('message', handleAuthMessage);
        };
    }, [setConfig]);

    const handleConnectYouTube = () => {
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        const authUrl = `/api/auth/start?conceptId=${conceptId}`;

        window.open(authUrl, '_blank', `width=${width},height=${height},top=${top},left=${left}`);
    };

    const handleDisconnectYouTube = () => {
        if (window.confirm('Are you sure you want to disconnect your YouTube account? This will remove the saved refresh token.')) {
            const newApiKeys = { ...config.apiKeys };
            delete newApiKeys.youtube_refresh_token;
            setConfig(prev => ({
                ...prev,
                apiKeys: newApiKeys,
            }));
        }
    };

    const handleOtherKeyChange = (keyName: 'tiktok' | 'instagram', value: string) => {
        setConfig(prev => ({
            ...prev,
            apiKeys: { ...prev.apiKeys, [keyName]: value },
        }));
    };

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-200">API Keys & Secrets</h3>
            
            {/* YouTube Connection */}
            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                <h4 className="font-semibold text-slate-200 mb-2">YouTube Account</h4>
                {isYouTubeConnected ? (
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-green-400">✓ Connected</p>
                        <button onClick={handleDisconnectYouTube} className="text-xs text-red-400 hover:underline">Disconnect</button>
                    </div>
                ) : (
                    <button onClick={handleConnectYouTube} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md">
                        Connect with YouTube
                    </button>
                )}
                <p className="text-xs text-slate-500 mt-2">Allows automated posting to YouTube on your behalf.</p>
            </div>

            {/* Other Platforms */}
            <div className="space-y-3 pt-2">
                 <TextInput
                    id="tiktok-key"
                    label="TikTok API Key / Secret"
                    type="password"
                    value={config.apiKeys.tiktok}
                    onChange={(e) => handleOtherKeyChange('tiktok', e.target.value)}
                    placeholder="Enter your TikTok credential"
                />
                 <TextInput
                    id="instagram-key"
                    label="Instagram API Key / Secret"
                    type="password"
                    value={config.apiKeys.instagram}
                    onChange={(e) => handleOtherKeyChange('instagram', e.target.value)}
                    placeholder="Enter your Instagram credential"
                />
            </div>
        </div>
    );
};
