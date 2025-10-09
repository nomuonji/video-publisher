import React, { useState, useEffect } from 'react';

interface WorkflowOutputProps {
    generatedWorkflow: string;
}

const Instructions: React.FC = () => (
    <div className="prose prose-invert prose-sm text-slate-300 bg-slate-900/50 p-4 rounded-md border border-slate-700">
        <h4>Setup Instructions:</h4>
        <ol>
            <li>
                <strong>Configure App Client ID:</strong>
                <ul>
                    <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>.</li>
                    <li>Create a new project.</li>
                    <li>Go to "APIs & Services" &gt; "OAuth consent screen", configure it for "External" users and add your Google account as a test user.</li>
                    <li>Go to "Credentials", click "Create Credentials" &gt; "OAuth client ID".</li>
                    <li>Select "Web application", add `http://localhost:3000` (or your dev URL) to "Authorized JavaScript origins".</li>
                    <li>Copy the generated Client ID and paste it into the `GOOGLE_CLIENT_ID` constant at the top of `App.tsx`.</li>
                </ul>
            </li>
            <li><strong>Copy the Workflow:</strong> Click the "Copy to Clipboard" button above.</li>
            <li><strong>Create Workflow File:</strong> In your GitHub repository, create a new file (e.g., <code>.github/workflows/social-video-post.yml</code>). Paste the copied content.</li>
            <li><strong>Create Scripts:</strong> The workflow uses placeholder scripts. You must create these in your repository (e.g., in a <code>/scripts</code> folder) to handle finding, downloading, posting, and archiving videos.</li>
            <li>
                <strong>Add Repository Secrets:</strong> Go to your repository's <code>Settings &gt; Secrets and variables &gt; Actions</code> and add the following:
                <ul>
                    <li><code>GCP_SA_KEY</code>: The JSON key for a Google Cloud Service Account (different from OAuth ID) with "Google Drive API" enabled.</li>
                    <li><code>GDRIVE_POSTED_FOLDER_ID</code>: The ID of the Google Drive folder where videos will be moved after posting.</li>
                    <li><code>GEMINI_API_KEY</code>: Your Google Gemini API key.</li>
                    <li>And secrets for each platform you enabled (e.g., <code>YOUTUBE_API_KEY</code>, <code>TIKTOK_ACCESS_TOKEN</code>).</li>
                </ul>
            </li>
            <li><strong>Run the Action:</strong> Run the workflow manually from the "Actions" tab or wait for its schedule.</li>
        </ol>
        <p className="text-amber-400/80"><strong>Important:</strong> You are responsible for implementing the scripts that interact with the various APIs (Google Drive, YouTube, etc.).</p>
    </div>
);


export const WorkflowOutput: React.FC<WorkflowOutputProps> = ({ generatedWorkflow }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (generatedWorkflow) {
            navigator.clipboard.writeText(generatedWorkflow);
            setCopied(true);
        }
    };

    useEffect(() => {
        if (copied) {
            const timer = setTimeout(() => setCopied(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [copied]);

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-100">Generated Workflow & Instructions</h2>
            {generatedWorkflow ? (
                <div className="bg-slate-800 rounded-lg shadow-md">
                    <div className="flex justify-between items-center p-3 border-b border-slate-700">
                        <span className="text-sm font-mono text-slate-400">.github/workflows/your-workflow.yml</span>
                        <button
                            onClick={handleCopy}
                            className="bg-slate-700 hover:bg-slate-600 text-sm text-white font-medium py-1 px-3 rounded-md transition-colors"
                        >
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                    <pre className="p-4 text-sm text-slate-200 overflow-x-auto">
                        <code className="language-yaml">{generatedWorkflow}</code>
                    </pre>
                </div>
            ) : (
                <div className="flex items-center justify-center h-64 bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-700">
                    <p className="text-slate-400">Your generated workflow will appear here after you select a concept and click generate.</p>
                </div>
            )}
            <Instructions />
        </div>
    );
};