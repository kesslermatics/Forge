import { useEffect, useState } from 'react';
import { Outlet, useNavigate, NavLink, useLocation } from 'react-router-dom';
import { getMe, logoutUser, isAuthenticated } from '../api/api';
import type { UserInfo } from '../api/api';
import { Loader2, Home, UtensilsCrossed, Trophy, Settings } from 'lucide-react';
import { LanguageContext } from '../i18n';
import type { Lang } from '../i18n';

const SAND = '#e8c58a';

export default function AppLayout() {
    const navigate = useNavigate();
    const location = useLocation();
    const [user, setUser] = useState<UserInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [lang, setLang] = useState<Lang>('de');

    const refreshUser = async () => {
        const u = await getMe();
        setUser(u);
        setLang(u.language || 'de');
        return u;
    };

    useEffect(() => {
        if (!isAuthenticated()) { navigate('/login'); return; }
        refreshUser()
            .then(u => {
                const needsSetup = !u.has_hevy_key || !u.has_yazio;
                if (needsSetup && location.pathname !== '/setup') navigate('/setup');
            })
            .catch(() => { logoutUser(); navigate('/login'); })
            .finally(() => setLoading(false));
    }, []); // eslint-disable-line

    if (loading) {
        return (
            <div className="min-h-dvh flex items-center justify-center" style={{ background: '#16130f' }}>
                <Loader2 className="w-7 h-7 animate-spin" style={{ color: SAND }} />
            </div>
        );
    }

    return (
        <LanguageContext.Provider value={lang}>
            <div className="min-h-dvh flex flex-col" style={{ background: '#16130f' }}>
                {/* ── Sticky top bar ── */}
                <header className="sticky top-0 z-40 border-b"
                    style={{ background: 'rgba(22,19,15,0.85)', backdropFilter: 'blur(20px)', borderColor: 'rgba(232,197,138,0.1)' }}>
                    <div className="max-w-2xl mx-auto flex items-center justify-between px-5 h-14">
                        {/* Logo */}
                        <div className="flex items-center gap-2.5">
                            <ForgeIcon />
                            <span className="text-[17px] font-bold tracking-tight" style={{ color: SAND }}>Forge</span>
                        </div>

                        {/* Logout — subtle, top right */}
                        <button
                            onClick={() => { logoutUser(); navigate('/login'); }}
                            className="text-[12px] tracking-wide cursor-pointer transition-colors"
                            style={{ color: 'rgba(232,197,138,0.4)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(232,197,138,0.8)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(232,197,138,0.4)')}
                        >
                            Abmelden
                        </button>
                    </div>
                </header>

                {/* ── Page content ── */}
                <main className="flex-1 w-full max-w-2xl mx-auto px-4 pt-6 pb-28">
                    <Outlet context={{ user, refreshUser }} />
                </main>

                {/* ── Bottom tab bar ── */}
                <nav className="fixed bottom-0 left-0 right-0 z-40 safe-area-bottom"
                    style={{ background: 'rgba(22,19,15,0.92)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(232,197,138,0.1)' }}>
                    <div className="max-w-2xl mx-auto grid grid-cols-4 h-16">
                        <Tab to="/dashboard" icon={<Home size={22} />} label="Home" />
                        <Tab to="/nutrition" icon={<UtensilsCrossed size={22} />} label="Ernährung" />
                        <Tab to="/achievements" icon={<Trophy size={22} />} label="Erfolge" />
                        <Tab to="/settings" icon={<Settings size={22} />} label="Einstellungen" />
                    </div>
                </nav>
            </div>
        </LanguageContext.Provider>
    );
}

function Tab({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
    return (
        <NavLink to={to} className="flex flex-col items-center justify-center gap-1 transition-all tap">
            {({ isActive }) => (
                <>
                    <span style={{ color: isActive ? SAND : 'rgba(255,247,235,0.35)', transition: 'color 0.2s' }}>
                        {icon}
                    </span>
                    <span className="text-[10px] font-medium tracking-wide"
                        style={{ color: isActive ? SAND : 'rgba(255,247,235,0.3)', transition: 'color 0.2s' }}>
                        {label}
                    </span>
                    {isActive && (
                        <span className="absolute bottom-0 w-6 h-0.5 rounded-full"
                            style={{ background: SAND }} />
                    )}
                </>
            )}
        </NavLink>
    );
}

function ForgeIcon() {
    return (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(232,197,138,0.25), rgba(200,164,100,0.15))', border: '1px solid rgba(232,197,138,0.3)' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 4H9C8.45 4 8 4.45 8 5V10C8 10.55 8.45 11 9 11H15C15.55 11 16 10.55 16 10V5C16 4.45 15.55 4 15 4Z" fill="#e8c58a" />
                <path d="M13.5 10.5L8 19.5C7.72 19.97 8.05 20.5 8.58 20.5H15.42C15.95 20.5 16.28 19.97 16 19.5L13.5 10.5Z" fill="#c8a870" />
                <path d="M9 4H15V6.5H9V4Z" fill="#f2d9a8" opacity="0.55" />
            </svg>
        </div>
    );
}
