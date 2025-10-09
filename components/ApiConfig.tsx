import React, { useEffect } from 'react';
import type { ConceptConfig } from '../types';
import { TextInput } from './TextInput';

interface ApiConfigProps {
    conceptId: string;
    config: ConceptConfig;
    setConfig: React.Dispatch<React.SetStateAction<ConceptConfig>>;
    onRefresh: () => void;
    onSave: (newConfig: ConceptConfig) => Promise<void>;
    instagramAccounts: any[];
}

export const ApiConfig: React.FC<ApiConfigProps> = ({ conceptId, config, setConfig, onRefresh, onSave, instagramAccounts }) => {

    const isYouTubeConnected = !!config.apiKeys.youtube_refresh_token;
    const isTikTokConnected = !!config.apiKeys.tiktok;
    const hasInstagramConnections = instagramAccounts && instagramAccounts.length > 0;
    const selectedInstagramId = config.apiKeys.instagram;

    // Listen for messages from the auth popup
    useEffect(() => {
        const handleAuthMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const { status } = event.data;
            if (status === 'success') {
                onRefresh();
            }
        };
        window.addEventListener('message', handleAuthMessage);
        return () => window.removeEventListener('message', handleAuthMessage);
    }, [onRefresh]);

    const openAuthPopup = (url: string) => {
        const width = 600, height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        window.open(url, '_blank', `width=${width},height=${height},top=${top},left=${left}`);
    };

    const handleConnectYouTube = () => openAuthPopup(`/api/auth/start?conceptId=${conceptId}`);
    const handleConnectTikTok = () => openAuthPopup(`/api/auth/tiktok/start?conceptId=${conceptId}`);
    const handleConnectInstagram = () => openAuthPopup(`/api/auth/instagram/start?conceptId=${conceptId}`);

    const handleDisconnect = (platform: 'youtube' | 'tiktok' | 'instagram') => {
        if (!window.confirm(`Are you sure you want to disconnect ${platform}?`)) return;
        
        let newConfig;
        if (platform === 'youtube') {
            const newApiKeys = { ...config.apiKeys };
            delete newApiKeys.youtube_refresh_token;
            newConfig = { ...config, apiKeys: newApiKeys };
        } else {
            newConfig = { ...config, apiKeys: { ...config.apiKeys, [platform]: '' } };
        }
        setConfig(newConfig);
        onSave(newConfig);
    };

    const handleInstagramAccountSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newConfig = { ...config, apiKeys: { ...config.apiKeys, instagram: e.target.value } };
        setConfig(newConfig);
        onSave(newConfig);
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
                        <button onClick={() => handleDisconnect('youtube')} className="text-xs text-red-400 hover:underline">Disconnect</button>
                    </div>
                ) : (
                    <button onClick={handleConnectYouTube} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md">Connect with YouTube</button>
                )}
            </div>

            {/* TikTok Connection */}
            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                <h4 className="font-semibold text-slate-200 mb-2">TikTok Account</h4>
                {isTikTokConnected ? (
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-green-400">✓ Connected</p>
                        <button onClick={() => handleDisconnect('tiktok')} className="text-xs text-red-400 hover:underline">Disconnect</button>
                    </div>
                ) : (
                    <button onClick={handleConnectTikTok} className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-md">Connect with TikTok</button>
                )}
            </div>

            {/* Instagram Connection */}
            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                <h4 className="font-semibold text-slate-200 mb-2">Instagram Account</h4>
                {hasInstagramConnections ? (
                    <div>
                        <label htmlFor="instagram-select" className="text-sm text-slate-400 mb-1 block">Select account to post to:</label>
                        <select 
                            id="instagram-select"
                            value={selectedInstagramId || ''}
                            onChange={handleInstagramAccountSelect}
                            className="w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                        >
                            <option value="" disabled>-- Select an Account --</option>
                            {instagramAccounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name} (@{acc.username})</option>
                            ))}
                        </select>
                        <button onClick={handleConnectInstagram} className="text-xs text-sky-400 hover:underline mt-2">Refresh/Reconnect</button>
                    </div>
                ) : (
                    <button onClick={handleConnectInstagram} className="w-full bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 hover:opacity-90 text-white font-bold py-2 px-4 rounded-md">Connect with Instagram</button>
                )}
            </div>
        </div>
    );
}
