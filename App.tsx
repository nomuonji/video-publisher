import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Concept, ConceptConfig, VideoFile, SelectedPlatforms } from './types';
import * as driveService from './services/googleDriveService';
import * as mockDriveService from './services/mockGoogleDriveService';
import { Header } from './components/Header';
import { Instructions } from './components/Instructions';
import { Card } from './components/Card';
import { ConfigEditor } from './components/ConfigEditor';
import { VideoStatus } from './components/VideoStatus';
import { PostConfirmationModal } from './components/PostConfirmationModal';
import { PlusCircleIcon, TrashIcon, RefreshIcon, SpinnerIcon } from './components/icons/UtilityIcons';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = "https://www.googleapis.com/auth/drive";

interface TokenResponse {
  access_token: string;
  error?: string;
  error_description?: string;
}

declare global {
    interface Window {
        google: any;
    }
}

const useMockMode = () => {
    const [isMock, setIsMock] = useState(false);
    useEffect(() => {
        const queryParams = new URLSearchParams(window.location.search);
        setIsMock(queryParams.get('mock') === 'true');
    }, []);
    return isMock;
};

function App() {
    const [isGisLoaded, setIsGisLoaded] = useState(false);
    const [tokenClient, setTokenClient] = useState<any>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    
    const [concepts, setConcepts] = useState<Concept[]>([]);
    const [instagramAccounts, setInstagramAccounts] = useState<any[]>([]);
    const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
    const [queuedVideos, setQueuedVideos] = useState<VideoFile[]>([]);
    const [postedVideos, setPostedVideos] = useState<VideoFile[]>([]);
    const [isLoadingConcepts, setIsLoadingConcepts] = useState(true);
    const [isLoadingVideos, setIsLoadingVideos] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPosting, setIsPosting] = useState<string | null>(null); // null or the videoId being posted

    const [isPostingModalOpen, setIsPostingModalOpen] = useState(false);
    const [videoToPost, setVideoToPost] = useState<VideoFile | null>(null);

    const isSignedIn = !!accessToken;
    const isMockMode = useMockMode();
    const service = useMemo(() => (isMockMode ? mockDriveService : driveService), [isMockMode]);

    const selectedConcept = useMemo(() => {
        return concepts.find(c => c.googleDriveFolderId === selectedConceptId) || null;
    }, [concepts, selectedConceptId]);

    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
             try {
                if (!GOOGLE_CLIENT_ID) {
                    setError("Application is not configured correctly. Missing Google Client ID.");
                    return;
                }
                const client = window.google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: SCOPES,
                    callback: (tokenResponse: TokenResponse) => {
                         if (tokenResponse.error) {
                            setError(`Google sign-in error: ${tokenResponse.error_description || tokenResponse.error}`);
                            setAccessToken(null);
                        } else {
                            setAccessToken(tokenResponse.access_token);
                        }
                    },
                });
                setTokenClient(() => client);
                setIsGisLoaded(true);
            } catch (e: any) {
                console.error("Error initializing GIS client", e);
                setError(`Failed to initialize Google Sign-In. Check console for details.`);
            }
        };
        document.body.appendChild(script);
        return () => {
            document.body.removeChild(script);
        }
    }, []);
    
    const handleSignIn = () => {
        if (tokenClient) {
            tokenClient.requestAccessToken();
        } else {
            setError("Google Sign-In is not ready yet.");
        }
    };
    
    const handleSignOut = () => {
        if (accessToken) {
            window.google.accounts.oauth2.revoke(accessToken, () => {
                setAccessToken(null);
                setConcepts([]);
                setInstagramAccounts([]);
                setSelectedConceptId(null);
            });
        }
    };

    const fetchInstagramAccounts = useCallback(async () => {
        if ((!isSignedIn || !accessToken) && !isMockMode) return;
        try {
            // In mock mode, this would return a mock list
            const accounts = await service.getInstagramAccounts(accessToken!);
            setInstagramAccounts(accounts);
        } catch (err: any) {
            console.error("Error fetching Instagram accounts:", err);
            // Non-fatal error, so just log it
        }
    }, [isSignedIn, accessToken, isMockMode, service]);

    const fetchConcepts = useCallback(async () => {
        if ((!isSignedIn || !accessToken) && !isMockMode) return;
        setIsLoadingConcepts(true);
        setError(null);
        try {
            const [fetchedConcepts] = await Promise.all([
                service.listConceptFolders(accessToken!),
                fetchInstagramAccounts(), // Fetch instagram accounts alongside concepts
            ]);

            setConcepts(fetchedConcepts);
            if (fetchedConcepts.length > 0 && !selectedConceptId) {
                 setSelectedConceptId(fetchedConcepts[0].googleDriveFolderId);
            } else if (fetchedConcepts.length === 0) {
                setSelectedConceptId(null);
            }
        } catch (err: any) {
            console.error("Error fetching concepts:", err);
            setError(`Failed to fetch concepts: ${err.message}`);
        } finally {
            setIsLoadingConcepts(false);
        }
    }, [isSignedIn, accessToken, isMockMode, service, selectedConceptId, fetchInstagramAccounts]);

    const fetchVideos = useCallback(async () => {
        if (!selectedConcept || (!accessToken && !isMockMode)) {
            setQueuedVideos([]);
            setPostedVideos([]);
            return;
        };
        setIsLoadingVideos(true);
        try {
            const [queued, posted] = await Promise.all([
                service.listVideos(accessToken!, selectedConcept.queueFolderId),
                service.listVideos(accessToken!, selectedConcept.postedFolderId),
            ]);
            setQueuedVideos(queued);
            setPostedVideos(posted);
        } catch (err: any) {
            console.error("Error fetching videos:", err);
            setError(`Failed to fetch videos for ${selectedConcept.name}: ${err.message}`);
        } finally {
            setIsLoadingVideos(false);
        }
    }, [selectedConcept, service, accessToken, isMockMode]);

    useEffect(() => {
        if (isSignedIn || isMockMode) {
            fetchConcepts();
        }
    }, [isSignedIn, isMockMode, fetchConcepts]);

    useEffect(() => {
        if (selectedConcept) {
            fetchVideos();
        }
    }, [selectedConcept, fetchVideos]);

    const handleSelectConcept = (id: string) => {
        setSelectedConceptId(id);
    };

    const handleCreateConcept = async () => {
        if (!accessToken && !isMockMode) return;
        const newName = prompt("Enter a name for the new concept:");
        if (newName && newName.trim() !== '') {
            try {
                const newConcept = await service.createConcept(accessToken!, newName.trim());
                setConcepts(prev => [...prev, newConcept]);
                setSelectedConceptId(newConcept.googleDriveFolderId);
            } catch (err: any) {
                setError(`Failed to create concept: ${err.message}`);
            }
        }
    };

    const handleDeleteConcept = async (concept: Concept) => {
        if (!accessToken && !isMockMode) return;
        if (window.confirm(`Are you sure you want to delete the concept "${concept.name}"? This cannot be undone.`)) {
            try {
                await service.deleteConcept(accessToken!, concept.googleDriveFolderId);
                const newConcepts = concepts.filter(c => c.googleDriveFolderId !== concept.googleDriveFolderId);
                setConcepts(newConcepts);
                if (selectedConceptId === concept.googleDriveFolderId) {
                    setSelectedConceptId(newConcepts.length > 0 ? newConcepts[0].googleDriveFolderId : null);
                }
            } catch (err: any) {
                setError(`Failed to delete concept: ${err.message}`);
            }
        }
    };

    const handleSaveConfig = async (newConfig: ConceptConfig) => {
        if (!selectedConcept || (!accessToken && !isMockMode)) return;
        try {
            await service.updateConceptConfig(accessToken!, selectedConcept.googleDriveFolderId, newConfig);
            setConcepts(concepts.map(c => 
                c.googleDriveFolderId === selectedConceptId ? { ...c, name: newConfig.name, config: newConfig } : c
            ));
            // No alert on auto-save, it's disruptive.
        } catch (err: any) {
            console.error("Failed to save config:", err);
            setError(`Failed to save configuration: ${err.message}`);
            alert(`Error: Failed to save configuration. ${err.message}`);
        }
    };

    const handleInitiatePost = (videoId: string) => {
        const video = queuedVideos.find(v => v.id === videoId);
        if (video) {
            setVideoToPost(video);
            setIsPostingModalOpen(true);
        }
    };

    const handlePostVideo = async (platforms: SelectedPlatforms) => {
        if (!videoToPost || !selectedConcept) return;

        setIsPosting(videoToPost.id);
        setError(null);
        setIsPostingModalOpen(false);

        try {
            const response = await fetch('/api/post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    videoId: videoToPost.id,
                    conceptId: selectedConcept.googleDriveFolderId,
                    platforms: platforms,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.details || 'Failed to start post process.');
            }

            alert(`Successfully started posting process for "${videoToPost.name}". The video will be moved to 'Posted' shortly.`);

            setTimeout(() => {
                fetchVideos();
            }, 3000);

        } catch (err: any) {
            setError(`Failed to post video: ${err.message}`);
        } finally {
            setIsPosting(null);
            setVideoToPost(null);
        }
    };

    const renderContent = () => {
        if (!isMockMode && !isSignedIn) {
            return (
                <div className="flex-grow flex items-center justify-center">
                    <Card>
                        <div className="text-center p-8">
                             { !isGisLoaded ? (
                                <>
                                    <SpinnerIcon className="w-10 h-10 text-slate-400 mx-auto mb-4" />
                                    <p className="text-slate-400">Initializing Google Services...</p>
                                </>
                             ) : (
                                <>
                                    <h2 className="text-2xl font-bold text-white mb-2">Welcome!</h2>
                                    <p className="text-slate-400 mb-6">Please sign in with your Google account to manage your video concepts.</p>
                                    <button onClick={handleSignIn} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg text-lg">
                                        Sign In with Google
                                    </button>
                                </>
                             ) }
                        </div>
                    </Card>
                </div>
            );
        }

        if (isLoadingConcepts) {
            return (
                 <div className="flex-grow flex items-center justify-center">
                    <SpinnerIcon className="w-12 h-12 text-slate-400" />
                    <p className="ml-4 text-slate-300">Loading concepts from Google Drive...</p>
                 </div>
            );
        }

        return (
             <main className="flex-1 p-4 sm:p-6 lg:p-8 grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
                <div className="xl:col-span-1 space-y-6">
                    {selectedConcept ? (
                        <ConfigEditor 
                            conceptId={selectedConcept.googleDriveFolderId} 
                            conceptConfig={selectedConcept.config} 
                            onSave={handleSaveConfig} 
                            onRefresh={fetchConcepts} 
                            instagramAccounts={instagramAccounts}
                        />
                    ) : concepts.length > 0 ? (
                        <Card><p className="p-4 text-center text-slate-400">Please select a concept to begin.</p></Card>
                    ) : (
                        <Instructions />
                    ) }
                </div>

                <div className="xl:col-span-2 space-y-6">
                     {selectedConcept ? (
                        <>
                             <Card>
                                 <h2 className="text-xl font-bold text-slate-100">
                                    Editing: <span className="text-indigo-400">{selectedConcept.name}</span>
                                 </h2>
                                 <p className="text-sm text-slate-400 mt-1">
                                    Changes saved here will update the <code>config.json</code> in this concept's Google Drive folder.
                                 </p>
                            </Card>

                            <VideoStatus
                                queuedVideos={queuedVideos}
                                postedVideos={postedVideos}
                                isLoading={isLoadingVideos}
                                onInitiatePost={handleInitiatePost}
                                postingVideoId={isPosting}
                            />
                        </>
                    ) : (
                         <Card>
                             <div className="text-center py-16">
                                <h3 className="text-xl font-semibold text-slate-200">No Concepts Found</h3>
                                <p className="text-slate-400 mt-2">
                                    Create a new concept using the '+' button on the left to get started.
                                </p>
                             </div>
                         </Card>
                    ) }
                </div>
            </main>
        );
    }

    return (
        <div className="bg-slate-900 text-slate-200 min-h-screen flex flex-col">
            <Header isSignedIn={isSignedIn} onSignIn={handleSignIn} onSignOut={handleSignOut} isMockMode={isMockMode} />
            <div className="flex-1 flex max-w-screen-2xl mx-auto w-full overflow-y-hidden">
                {(isSignedIn || isMockMode) && (
                    <aside className="w-72 flex-shrink-0 p-4 sm:p-6 border-r border-slate-700/50 flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold text-slate-100">Concepts</h2>
                            <div className="flex items-center gap-2">
                                <button onClick={fetchConcepts} title="Refresh Concepts" className="text-slate-400 hover:text-white transition-colors">
                                    <RefreshIcon className="w-5 h-5" />
                                </button>
                                <button onClick={handleCreateConcept} title="New Concept" className="text-slate-400 hover:text-white transition-colors">
                                    <PlusCircleIcon className="w-6 h-6" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-2">
                            {concepts.map(concept => (
                                <div
                                    key={concept.googleDriveFolderId}
                                    onClick={() => handleSelectConcept(concept.googleDriveFolderId)}
                                    className={`group flex items-center justify-between p-3 rounded-md cursor-pointer transition-colors ${selectedConceptId === concept.googleDriveFolderId ? 'bg-indigo-900/50' : 'hover:bg-slate-800'}`}
                                >
                                    <span className="font-medium truncate">{concept.name}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteConcept(concept); }}
                                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity flex-shrink-0"
                                        title="Delete Concept"
                                    >
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </aside>
                )}
                {renderContent()}
            </div>
             {videoToPost && (
                <PostConfirmationModal 
                    video={videoToPost}
                    isOpen={isPostingModalOpen}
                    onClose={() => setIsPostingModalOpen(false)}
                    onConfirm={handlePostVideo}
                    isPosting={!!isPosting}
                />
             )}
             {error && (
                <div className="fixed bottom-4 right-4 bg-red-800/90 text-white p-4 rounded-lg shadow-lg max-w-md z-50">
                    <h4 className="font-bold">An Error Occurred</h4>
                    <p className="text-sm">{error}</p>
                    <button onClick={() => setError(null)} className="absolute top-2 right-2 text-red-200 hover:text-white font-bold text-xl">&times;</button>
                </div>
            )}
        </div>
    );
}

export default App;