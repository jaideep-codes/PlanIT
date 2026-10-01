import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PlanIT',
    short_name: 'PlanIT',
    description:
      'PlanIT turns goals into scheduled work and measures whether you actually followed through.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8f9fc',
    theme_color: '#4f46e5',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
