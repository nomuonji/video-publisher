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
    const isTikTokConnected = !!config.apiKeys.tiktok; // Simplified check

    // Listen for messages from the auth popup
    useEffect(() => {
        const handleAuthMessage = (event: MessageEvent) => {
            // IMPORTANT: Check the origin of the message for security
            if (event.origin !== window.location.origin) {
                return;
            }

            const { status, service } = event.data;
            if (status === 'success') {
                if (service === 'youtube') {
                    setConfig(prev => ({
                        ...prev,
                        apiKeys: { ...prev.apiKeys, youtube_refresh_token: 'connected' },
                    }));
                } else if (service === 'tiktok') {
                    // Assuming the callback returns the access token data
                    // In a real app, you'd likely just get a success message
                    // and the token would be stored server-side.
                    setConfig(prev => ({
                        ...prev,
                        apiKeys: { ...prev.apiKeys, tiktok: 'connected' }, // Placeholder
                    }));
                }
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

    const handleConnectTikTok = () => {
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        // Pass conceptId to the TikTok auth flow as well
        const authUrl = `/api/auth/tiktok/start?conceptId=${conceptId}`;

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

    const handleDisconnectTikTok = () => {
        if (window.confirm('Are you sure you want to disconnect your TikTok account?')) {
            setConfig(prev => ({
                ...prev,
                apiKeys: { ...prev.apiKeys, tiktok: '' },
            }));
        }
    };

    const handleOtherKeyChange = (keyName: 'instagram', value: string) => {
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

            {/* TikTok Connection */}
            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                <h4 className="font-semibold text-slate-200 mb-2">TikTok Account</h4>
                {isTikTokConnected ? (
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-green-400">✓ Connected</p>
                        <button onClick={handleDisconnectTikTok} className="text-xs text-red-400 hover:underline">Disconnect</button>
                    </div>
                ) : (
                    <button onClick={handleConnectTikTok} className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-md">
                        Connect with TikTok
                    </button>
                )}
                <p className="text-xs text-slate-500 mt-2">Allows automated posting to TikTok on your behalf.</p>
            </div>

            {/* Other Platforms */}
            <div className="space-y-3 pt-2">
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
