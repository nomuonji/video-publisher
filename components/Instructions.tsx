import React from 'react';
import { Card } from './Card';

export const Instructions: React.FC = () => (
    <Card>
        <div className="prose prose-invert prose-sm text-slate-300">
            <h4>How It Works</h4>
            <p>
                This application acts as a dashboard for your video content, which is organized into "Concepts" on your Google Drive.
            </p>
            <ol>
                <li>
                    <strong>Manage Concepts:</strong> Each concept is a folder in your Google Drive (inside a main <code>v-stock</code> folder). You can add or remove concepts using the list on the left.
                </li>
                <li>
                    <strong>Configure:</strong> For each concept, set its schedule, target platforms, and API keys. Changes are saved to a <code>config.json</code> file inside the concept's folder.
                </li>
                <li>
                    <strong>Organize Videos:</strong> Place videos you want to post into the <code>queue</code> folder within a concept's directory on Google Drive.
                </li>
            </ol>
            <h5 className="mt-4">Automation with GitHub Actions</h5>
            <p className="text-amber-400/80">
                A separate, generalized GitHub Actions workflow (that you create) should be scheduled to run. On its schedule, it will:
            </p>
             <ul className="text-xs">
                <li>Check all concept folders.</li>
                <li>Read the <code>config.json</code> to know what to do.</li>
                <li>Pick one video from the <code>queue</code> folder.</li>
                <li>Use the Gemini API to generate a title/description.</li>
                <li>Post it to the platforms enabled in the config.</li>
                <li>Move the posted video file from the <code>queue</code> folder to the <code>posted</code> folder.</li>
            </ul>
        </div>
    </Card>
);
