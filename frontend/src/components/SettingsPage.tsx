import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { saveYazioCredentials, updateLanguage } from '../api/api';
import type { UserInfo } from '../api/api';
import { UtensilsCrossed, Eye, EyeOff, CheckCircle, AlertCircle, Shield, Globe } from 'lucide-react';
import { useLanguage } from '../i18n';
import type { Lang } from '../i18n';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';

type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };

export default function SettingsPage() {
    const { user, refreshUser } = useOutletContext<LayoutContext>();
    const { t, lang } = useLanguage();


    const [yazioEmail, setYazioEmail] = useState('');
    const [yazioPassword, setYazioPassword] = useState('');
    const [showYazioPw, setShowYazioPw] = useState(false);
    const [savingYazio, setSavingYazio] = useState(false);
    const [yazioMsg, setYazioMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [langMsg, setLangMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleSaveYazio = async (e: React.FormEvent) => {
        e.preventDefault(); setYazioMsg(null); setSavingYazio(true);
        try { await saveYazioCredentials(yazioEmail, yazioPassword); setYazioMsg({ type: 'success', text: t('settings.yazioUpdated') }); await refreshUser(); setYazioEmail(''); setYazioPassword(''); }
        catch (err: any) { setYazioMsg({ type: 'error', text: err.message }); }
        finally { setSavingYazio(false); }
    };
    const handleLangChange = async (newLang: Lang) => {
        setLangMsg(null);
        try { await updateLanguage(newLang); localStorage.setItem('lang', newLang); setLangMsg({ type: 'success', text: t('settings.languageUpdated') }); await refreshUser(); }
        catch (err: any) { setLangMsg({ type: 'error', text: err.message }); }
    };

    return (
        <div className="space-y-5">
            <header className="forge-anim">
                <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: '#f2ece0' }}>
                    {t('settings.title')}
                </h1>
                <p className="text-[13px] mt-1" style={{ color: TEXT_DIM }}>{t('settings.subtitle')}</p>
            </header>

            {/* Account */}
            <Card icon={<Shield size={15} style={{ color: SAND }} />} title={t('settings.account')}>
                <div className="grid grid-cols-2 gap-4 text-[13px]">
                    <div>
                        <p style={{ color: TEXT_DIM }}>{t('settings.username')}</p>
                        <p className="mt-0.5 font-medium" style={{ color: '#f2ece0' }}>{user?.username}</p>
                    </div>
                    <div>
                        <p style={{ color: TEXT_DIM }}>{t('settings.userId')}</p>
                        <p className="mt-0.5 font-mono text-[11px]" style={{ color: '#f2ece0' }}>{user?.id}</p>
                    </div>
                </div>
            </Card>

            {/* Language */}
            <Card icon={<Globe size={15} style={{ color: SAND }} />} title={t('settings.languageTitle')}>
                <p className="text-[13px] mb-4" style={{ color: TEXT_DIM }}>{t('settings.languageDesc')}</p>
                <div className="flex gap-3">
                    {(['de', 'en'] as Lang[]).map(l => (
                        <button key={l} onClick={() => handleLangChange(l)}
                            className="tap flex-1 py-2.5 px-4 rounded-2xl text-[13px] font-medium cursor-pointer border transition-all"
                            style={{
                                background: lang === l ? `${SAND}18` : 'rgba(255,247,235,0.04)',
                                borderColor: lang === l ? `${SAND}44` : CARD_BORDER,
                                color: lang === l ? SAND : TEXT_DIM,
                            }}>
                            {l === 'de' ? '🇩🇪 Deutsch' : '🇬🇧 English'}
                        </button>
                    ))}
                </div>
                <FeedMsg msg={langMsg} />
            </Card>

            {/* Yazio */}
            <Card icon={<UtensilsCrossed size={15} style={{ color: SAND }} />} title={t('settings.yazioTitle')}
                badge={<ConnBadge connected={!!user?.has_yazio} />}>
                <p className="text-[13px] mb-4" style={{ color: TEXT_DIM }}>{t('settings.yazioDesc')}</p>
                <form onSubmit={handleSaveYazio} className="space-y-3">
                    <input type="email" className="input-forge text-[13px]"
                        placeholder={user?.has_yazio ? t('settings.yazioEmailPlaceholder') : 'email@yazio.com'}
                        value={yazioEmail} onChange={e => setYazioEmail(e.target.value)} required />
                    <div className="relative">
                        <input type={showYazioPw ? 'text' : 'password'} className="input-forge text-[13px] pr-11"
                            placeholder={user?.has_yazio ? t('settings.yazioPasswordPlaceholder') : 'Passwort'}
                            value={yazioPassword} onChange={e => setYazioPassword(e.target.value)} required />
                        <button type="button" onClick={() => setShowYazioPw(s => !s)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer"
                            style={{ color: TEXT_DIM }}>
                            {showYazioPw ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                    </div>
                    <FeedMsg msg={yazioMsg} />
                    <button type="submit" disabled={savingYazio} className="btn-forge w-full text-[14px]">
                        {savingYazio ? t('settings.saving') : user?.has_yazio ? t('settings.updateYazio') : t('settings.saveYazio')}
                    </button>
                </form>
            </Card>
        </div>
    );
}

function Card({ icon, title, badge, children }: {
    icon: React.ReactNode; title: string; badge?: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div className="forge-anim rounded-[24px] p-5 space-y-4"
            style={{ background: 'rgba(255,247,235,0.035)', border: '1px solid rgba(232,197,138,0.11)' }}>
            <div className="flex items-center gap-2.5">
                {icon}
                <span className="text-[14px] font-medium" style={{ color: '#f2ece0' }}>{title}</span>
                {badge}
            </div>
            {children}
        </div>
    );
}

function ConnBadge({ connected }: { connected: boolean }) {
    const { t } = useLanguage();
    return (
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full"
            style={{
                background: connected ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)',
                border: `1px solid ${connected ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}`,
                color: connected ? '#34d399' : '#fbbf24',
            }}>
            {connected
                ? <><CheckCircle size={11} /> {t('settings.connected')}</>
                : <><AlertCircle size={11} /> {t('settings.notSet')}</>
            }
        </span>
    );
}

function FeedMsg({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
    if (!msg) return null;
    return (
        <div className="rounded-xl px-4 py-2.5 text-[12px]"
            style={{
                background: msg.type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                border: `1px solid ${msg.type === 'success' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
                color: msg.type === 'success' ? '#34d399' : '#f87171',
            }}>
            {msg.text}
        </div>
    );
}
