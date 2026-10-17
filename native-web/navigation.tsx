import { forwardRef, lazy, Suspense, useSyncExternalStore } from 'react'
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react'

const subscribe = (callback: () => void) => { window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback) }
export function navigate(href: string, replace = false) { history[replace ? 'replaceState' : 'pushState']({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')) }
export function usePathname() { return useSyncExternalStore(subscribe, () => location.pathname) }
export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(subscribe, () => location.search)) }
export function useRouter() { return { push: (url: string) => navigate(url), replace: (url: string) => navigate(url, true), back: () => history.back(), refresh: () => location.reload(), prefetch: () => Promise.resolve() } }
export const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode; prefetch?: boolean; replace?: boolean }>(function Link({ href = '/', children, prefetch: _, replace, ...props }, ref) {
  return <a {...props} href={href} ref={ref} onClick={event => { props.onClick?.(event); if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !props.target && href.startsWith('/')) { event.preventDefault(); navigate(href, replace) } }}>{children}</a>
})
export default Link
export function dynamic(loader: () => Promise<ComponentType<any>>, _options?: unknown) { const Component = lazy(async () => ({ default: await loader() })); return function Dynamic(props: any) { return <Suspense fallback={null}><Component {...props} /></Suspense> } }
