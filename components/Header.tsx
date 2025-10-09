import React from 'react';

interface HeaderProps {
    isSignedIn: boolean;
    onSignIn: () => void;
    onSignOut: () => void;
    isMockMode?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ isSignedIn, onSignIn, onSignOut, isMockMode }) => (
  <header className="bg-slate-900/70 backdrop-blur-sm sticky top-0 z-10 border-b border-slate-700 flex-shrink-0">
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between h-16">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Video Content <span className="text-indigo-400">Dashboard</span>
        </h1>
        <div className="flex items-center gap-4">
            {isMockMode ? (
                 <span className="text-sm font-bold text-amber-400 border border-amber-400/50 rounded-full px-3 py-1">
                    Mock Mode Active
                </span>
            ) : isSignedIn ? (
                <button onClick={onSignOut} className="text-sm bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-lg">
                    Sign Out
                </button>
            ) : (
                <button onClick={onSignIn} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg">
                    Sign In with Google
                </button>
            )}
        </div>
      </div>
    </div>
  </header>
);
