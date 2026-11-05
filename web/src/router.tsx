import { createContext, type MouseEvent, type ReactNode, useContext, useEffect, useState } from 'react';

// A tiny history router: the app has a handful of screens and no nested layouts, so a dependency
// would add more than it saves.

type Location = { path: string; query: URLSearchParams };

const read = (): Location => ({ path: window.location.pathname, query: new URLSearchParams(window.location.search) });

const RouterContext = createContext<Location>(read());

export const navigate = (to: string, options: { replace?: boolean } = {}) => {
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (!options.replace) window.scrollTo(0, 0);
};

export const RouterProvider = ({ children }: { children: ReactNode }) => {
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const update = () => setLocation(read());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return <RouterContext.Provider value={location}>{children}</RouterContext.Provider>;
};

export const useLocation = () => useContext(RouterContext);

export const match = (pattern: string, path: string): Record<string, string> | null => {
  const parts = pattern.split('/');
  const actual = path.replace(/\/+$/, '').split('/');
  if (path === '/' && pattern === '/') return {};
  if (parts.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const value = actual[index]!;
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value);
    else if (part !== value) return null;
  }
  return params;
};

type LinkProps = { to: string; className?: string; children: ReactNode; title?: string; style?: React.CSSProperties; 'aria-label'?: string };

export const Link = ({ to, children, ...rest }: LinkProps) => {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
};
