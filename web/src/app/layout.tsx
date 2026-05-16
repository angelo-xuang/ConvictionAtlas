import Link from 'next/link';
import { SiteWordmark } from '../components/site-wordmark';
import { API_DOCS_URL } from '../lib/runtime-config';
import './global.css';

export const metadata = {
  title: 'Conviction Atlas',
  description: 'AI-powered investment intelligence for crypto markets.',
};

const navItems = [
  { href: '/managers', label: 'Managers' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/leaderboard', label: 'Leaderboard' },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              <SiteWordmark />
            </Link>
            <nav className="nav-links">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="nav-pill">
                  {item.label}
                </Link>
              ))}
              <a
                href={API_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="nav-pill"
              >
                API Docs
              </a>
            </nav>
          </header>

          <nav className="site-mobile-nav" aria-label="Primary mobile">
            <div className="site-mobile-scroller">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="nav-pill">
                  {item.label}
                </Link>
              ))}
              <a
                href={API_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="nav-pill"
              >
                API Docs
              </a>
            </div>
          </nav>

          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
