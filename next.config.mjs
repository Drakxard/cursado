/** @type {import('next').NextConfig} */
const nextConfig = {
  skipTrailingSlashRedirect: true,
  outputFileTracingIncludes: {
    '/api/pdf-explanation': ['./node_modules/katex/dist/katex.min.css', './node_modules/katex/dist/fonts/*.woff2'],
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    const backend = process.env.PIZARRA_BACKEND_URL?.replace(/\/$/, '')
    if (backend) {
      const url = new URL(backend)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('PIZARRA_BACKEND_URL debe ser un origen HTTP(S), sin credenciales, ruta ni parámetros.')
      }
    }
    return {
      beforeFiles: [
        { source: '/plantuml-renderer.html', destination: '/pizarra/plantuml.html' },
        { source: '/pizarra/api/:path*', destination: backend ? `${backend}/api/:path*` : '/api/pizarra-unavailable' },
        { source: '/pizarra/recognize/:path*', destination: backend ? `${backend}/recognize/:path*` : '/api/pizarra-unavailable' },
        { source: '/pizarra', destination: '/pizarra/index.html' },
        { source: '/study-board', destination: '/study-board/index.html' },
      ],
      afterFiles: [],
      fallback: [{ source: '/pizarra/:path*', destination: '/pizarra/index.html' }],
    }
  },
  async headers() {
    return [
      { source: '/native-web/current.json', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/native-web/releases/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/pizarra/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/pizarra/manifest.webmanifest', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/pizarra/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ]
  },
}

export default nextConfig
