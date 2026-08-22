import { useEffect, useState } from 'react';
import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { getMe, logoutUser, isAuthenticated } from '../api/api';
import type { UserInfo } from '../api/api';
import { Loader2, Home, UtensilsCrossed, Camera, Dumbbell, UserRound } from 'lucide-react';
import { LanguageContext } from '../i18n';
import type { Lang } from '../i18n';
import ForgeIcon from './ForgeIcon';

const SAND = '#e8c58a';

export default function AppLayout() {
    const navigate = useNavigate();
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
            .then(u => { setUser(u); })
            .catch(() => { logoutUser(); navigate('/login'); })
            .finally(() => setLoading(false));
    }, []); // eslint-disable-line

    if (loading) return <div className="min-h-dvh flex items-center justify-center" style={{ background: '#16130f' }}><Loader2 className="w-7 h-7 animate-spin" style={{ color: SAND }} /></div>;

    return <LanguageContext.Provider value={lang}>
        <div className="min-h-dvh flex flex-col" style={{ background: '#16130f' }}>
            <header className="sticky top-0 z-40 border-b" style={{ background: 'rgba(22,19,15,0.85)', backdropFilter: 'blur(20px)', borderColor: 'rgba(232,197,138,0.1)' }}>
                <div className="max-w-2xl mx-auto flex items-center justify-between px-5 h-14"><div className="flex items-center gap-2.5"><ForgeIcon size="sm" /><span className="text-[17px] font-bold tracking-tight" style={{ color: SAND }}>Forge</span></div><button onClick={() => navigate('/settings')} className="tap w-9 h-9 rounded-full flex items-center justify-center cursor-pointer" style={{ color: SAND, background: 'rgba(232,197,138,0.10)', border: '1px solid rgba(232,197,138,0.18)' }} aria-label="Profil und Einstellungen öffnen"><UserRound size={18} /></button></div>
            </header>
            <main className="flex-1 w-full max-w-2xl mx-auto px-4 pt-6 pb-28"><Outlet context={{ user, refreshUser }} /></main>
            <nav className="fixed bottom-0 left-0 right-0 z-40" style={{ background: 'rgba(22,19,15,0.92)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(232,197,138,0.1)' }}>
                <div className="max-w-2xl mx-auto grid grid-cols-4 h-16"><Tab to="/dashboard" icon={<Home size={22} />} label="Home" /><Tab to="/forge" icon={<Dumbbell size={22} />} label="Plan" /><Tab to="/nutrition" icon={<UtensilsCrossed size={22} />} label="Ernährung" /><Tab to="/forge/progress" icon={<Camera size={22} />} label="Progress" /></div>
            </nav>
        </div>
    </LanguageContext.Provider>;
}

function Tab({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
    return <NavLink to={to} className="relative flex flex-col items-center justify-center gap-1 tap">{({ isActive }) => <><span style={{ color: isActive ? SAND : 'rgba(255,247,235,0.35)', transition: 'color 0.2s' }}>{icon}</span><span className="text-[10px] font-medium tracking-wide" style={{ color: isActive ? SAND : 'rgba(255,247,235,0.3)', transition: 'color 0.2s' }}>{label}</span>{isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full" style={{ background: SAND }} />}</>}</NavLink>;
}
