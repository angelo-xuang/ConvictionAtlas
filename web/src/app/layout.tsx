import Link from 'next/link';
import { SiteWordmark } from '../components/site-wordmark';
import { API_DOCS_URL } from '../lib/runtime-config';
import './global.css';

export const metadata = {
  title: 'Conviction Atlas',
  description: 'AI 驱动的全市场投资智能平台。',
};

const navItems = [
  { href: '/managers', label: '基金经理' },
  { href: '/opportunities', label: '投资机会' },
  { href: '/leaderboard', label: '排行榜' },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
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
                API 文档
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
                API 文档
              </a>
            </div>
          </nav>

          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
