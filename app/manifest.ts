import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AnyPhoto',
    short_name: 'AnyPhoto',
    description: 'Controle uma ou várias câmeras remotamente.',
    start_url: '/',
    display: 'standalone',
    background_color: '#07101c',
    theme_color: '#07101c',
    orientation: 'any',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
