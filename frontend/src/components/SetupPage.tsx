import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { saveYazioCredentials } from '../api/api';
import type { UserInfo } from '../api/api';
import { UtensilsCrossed, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useLanguage } from '../i18n';
import ForgeIcon from './ForgeIcon';

const SAND = '#e8c58a';
const TEXT_DIM = 'rgba(242,236,226,0.45)';

type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };

export default function SetupPage() {
    const navigate = useNavigate();
    const { refreshUser } = useOutletContext<LayoutContext>();
    const { t } = useLanguage();
    const [yazioEmail, setYazioEmail] = useState('');
    const [yazioPassword, setYazioPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleSaveYazio = async (event: React.FormEvent) => {
        event.preventDefault();
        setMessage(null);
        setSaving(true);
        try {
            await saveYazioCredentials(yazioEmail, yazioPassword);
            await refreshUser();
            setMessage({ type: 'success', text: t('setup.yazioConnected') });
            setTimeout(() => navigate('/dashboard'), 700);
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-sm mx-auto space-y-6 pt-4">
            <div className="text-center forge-anim">
                <ForgeIcon size="lg" />
                <h1 className="text-[22px] font-semibold tracking-tight mt-4" style={{ color: '#f2ece0' }}>
                    Forge ist bereit
                </h1>
                <p className="text-[13px] mt-1.5" style={{ color: TEXT_DIM }}>
                    Training mit Forge funktioniert sofort. Verbinde Yazio nur für Ernährungsdaten und Briefings.
                </p>
            </div>

            <div className="card-forge p-5 space-y-4 forge-anim forge-d2">
                <div className="flex items-center gap-2.5">
                    <UtensilsCrossed size={15} style={{ color: SAND }} />
                    <h3 className="text-[15px] font-medium" style={{ color: '#f2ece0' }}>{t('setup.yazioTitle')}</h3>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>
                    {t('setup.yazioDesc')}
                </p>
                <form onSubmit={handleSaveYazio} className="space-y-3">
                    <input type="email" className="input-forge text-[13px]" placeholder="email@yazio.com"
                        value={yazioEmail} onChange={event => setYazioEmail(event.target.value)} required />
                    <div className="relative">
                        <input type={showPw ? 'text' : 'password'} className="input-forge text-[13px] pr-11"
                            placeholder="Passwort" value={yazioPassword}
                            onChange={event => setYazioPassword(event.target.value)} required />
                        <button type="button" onClick={() => setShowPw(value => !value)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer" style={{ color: TEXT_DIM }}>
                            {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                    </div>
                    <FeedMsg message={message} />
                    <button type="submit" disabled={saving} className="btn-forge w-full flex items-center justify-center gap-2">
                        {saving ? t('settings.saving') : <>{t('setup.connectAndStart')} <ArrowRight size={16} /></>}
                    </button>
                </form>
                <button onClick={() => navigate('/dashboard')} className="w-full text-center text-[12px] cursor-pointer underline underline-offset-2" style={{ color: TEXT_DIM }}>
                    Ohne Yazio fortfahren
                </button>
            </div>
        </div>
    );
}

function FeedMsg({ message }: { message: { type: 'success' | 'error'; text: string } | null }) {
    if (!message) return null;
    return (
        <div className="rounded-xl px-4 py-2.5 text-[12px]"
            style={{
                background: message.type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                border: `1px solid ${message.type === 'success' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
                color: message.type === 'success' ? '#34d399' : '#f87171',
            }}>
            {message.text}
        </div>
    );
}
