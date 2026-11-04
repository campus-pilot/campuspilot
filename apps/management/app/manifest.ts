import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'CampusPilot Management',
    short_name: 'CampusPilot',
    description: 'Run your school from one secure CampusPilot workspace.',
    start_url: '/school',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#c2580e',
    categories: ['business', 'education', 'productivity'],
    icons: [
      {
        src: '/app-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/app-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
