import type { PlatformInfo } from './types.js';
import { YouTubeIcon, TikTokIcon, InstagramIcon } from './components/icons/PlatformIcons.js';

export const platforms: PlatformInfo[] = [
    {
        name: 'YouTube',
        icon: YouTubeIcon,
        description: 'Best for longer content, tutorials, and vlogs.'
    },
    {
        name: 'TikTok',
        icon: TikTokIcon,
        description: 'Ideal for short, viral, and trend-based videos.'
    },
    {
        name: 'Instagram',
        icon: InstagramIcon,
        description: 'Great for Reels, stories, and visually appealing content.'
    }
];