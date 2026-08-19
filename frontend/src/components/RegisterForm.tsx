import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { registerUser } from '../api/api';
import { UserPlus, Eye, EyeOff, Globe } from 'lucide-react';
import type { Lang } from '../i18n';
import { LanguageContext, useLanguage } from '../i18n';
import ForgeIcon from './ForgeIcon';

const SAND = '#e8c58a';

function RegisterFormInner() {
    const navigate = useNavigate();
    const { t } = useLanguage();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); setError('');
        if (password !== confirm) { setError(t('register.passwordMismatch')); return; }
        if (password.length < 8) { setError(t('register.passwordTooShort')); return; }
        setLoading(true);
        try { await registerUser(username, password); navigate('/login', { state: { registered: true } }); }
        catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    return (
        <div className="w-full max-w-sm">
            <div className="text-center mb-10 forge-anim">
                <ForgeIcon size="lg" />
                <h1 className="text-[26px] font-bold tracking-tight mt-4" style={{ color: SAND }}>Forge</h1>
                <p className="text-[13px] mt-1.5" style={{ color: 'rgba(242,236,226,0.45)' }}>
                    {t('register.subtitle')}
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 forge-anim forge-d1">
                {error && (
                    <div className="rounded-xl px-4 py-2.5 text-[12px]"
                        style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
                        {error}
                    </div>
                )}

                <div>
                    <label className="block text-[12px] mb-1.5" style={{ color: 'rgba(242,236,226,0.55)' }}>
                        {t('register.username')}
                    </label>
                    <input type="text" className="input-forge"
                        placeholder={t('register.usernamePlaceholder')}
                        value={username} onChange={e => setUsername(e.target.value)}
                        required minLength={3} maxLength={50} />
                </div>

                <div>
                    <label className="block text-[12px] mb-1.5" style={{ color: 'rgba(242,236,226,0.55)' }}>
                        {t('register.password')}
                    </label>
                    <div className="relative">
                        <input type={showPw ? 'text' : 'password'} className="input-forge pr-11"
                            placeholder={t('register.passwordPlaceholder')}
                            value={password} onChange={e => setPassword(e.target.value)}
                            required minLength={8} />
                        <button type="button" onClick={() => setShowPw(s => !s)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer"
                            style={{ color: 'rgba(242,236,226,0.4)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = SAND)}
                            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(242,236,226,0.4)')}>
                            {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                    </div>
                </div>

                <div>
                    <label className="block text-[12px] mb-1.5" style={{ color: 'rgba(242,236,226,0.55)' }}>
                        {t('register.confirm')}
                    </label>
                    <input type="password" className="input-forge"
                        placeholder={t('register.confirmPlaceholder')}
                        value={confirm} onChange={e => setConfirm(e.target.value)} required />
                </div>

                <button type="submit" disabled={loading}
                    className="btn-forge w-full flex items-center justify-center gap-2 mt-2">
                    <UserPlus size={17} />
                    {loading ? t('register.submitting') : t('register.submit')}
                </button>

                <p className="text-center text-[13px]" style={{ color: 'rgba(242,236,226,0.45)' }}>
                    {t('register.hasAccount')}{' '}
                    <Link to="/login" className="font-medium underline underline-offset-2" style={{ color: SAND }}>
                        {t('register.signIn')}
                    </Link>
                </p>
            </form>
        </div>
    );
}

export default function RegisterForm() {
    const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('lang') as Lang) || 'de');
    const toggle = () => { const n = lang === 'de' ? 'en' : 'de'; setLang(n); localStorage.setItem('lang', n); };

    return (
        <LanguageContext.Provider value={lang}>
            <div className="min-h-dvh flex items-center justify-center px-5 py-10 relative"
                style={{ background: '#16130f' }}>
                <button onClick={toggle}
                    className="tap absolute top-4 right-4 flex items-center gap-1.5 text-[11px] cursor-pointer rounded-xl px-3 py-1.5"
                    style={{ background: 'rgba(255,247,235,0.06)', border: '1px solid rgba(232,197,138,0.15)', color: 'rgba(242,236,226,0.45)' }}>
                    <Globe size={13} />
                    {lang === 'de' ? 'EN' : 'DE'}
                </button>
                <RegisterFormInner />
            </div>
        </LanguageContext.Provider>
    );
}

