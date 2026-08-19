import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { saveApiKey, saveYazioCredentials } from '../api/api';
import type { UserInfo } from '../api/api';
import { Key, UtensilsCrossed, Eye, EyeOff, ArrowRight, CheckCircle } from 'lucide-react';
import { useLanguage } from '../i18n';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';

type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };
type Step = 'hevy' | 'yazio';

function getStep(user: UserInfo | null): Step {
    return !user?.has_hevy_key ? 'hevy' : 'yazio';
}

export default function SetupPage() {
    const navigate = useNavigate();
    const { user, refreshUser } = useOutletContext<LayoutContext>();
    const { t } = useLanguage();

    const [step, setStep] = useState<Step>(getStep(user));

    const [apiKey, setApiKey] = useState('');
    const [savingKey, setSavingKey] = useState(false);
    const [keyMsg, setKeyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [yazioEmail, setYazioEmail] = useState('');
    const [yazioPassword, setYazioPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [savingYazio, setSavingYazio] = useState(false);
    const [yazioMsg, setYazioMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleSaveHevy = async (e: React.FormEvent) => {
        e.preventDefault(); setKeyMsg(null); setSavingKey(true);
        try {
            await saveApiKey(apiKey);
            setKeyMsg({ type: 'success', text: t('setup.hevySaved') });
            await refreshUser(); setApiKey('');
            setTimeout(() => setStep('yazio'), 700);
        } catch (err: any) { setKeyMsg({ type: 'error', text: err.message }); }
        finally { setSavingKey(false); }
    };

    const handleSaveYazio = async (e: React.FormEvent) => {
        e.preventDefault(); setYazioMsg(null); setSavingYazio(true);
        try {
            await saveYazioCredentials(yazioEmail, yazioPassword);
            setYazioMsg({ type: 'success', text: t('setup.yazioConnected') });
            await refreshUser(); setYazioEmail(''); setYazioPassword('');
            setTimeout(() => navigate('/dashboard'), 700);
        } catch (err: any) { setYazioMsg({ type: 'error', text: err.message }); }
        finally { setSavingYazio(false); }
    };

    return (
        <div className="max-w-sm mx-auto space-y-6 pt-4">
            {/* Header */}
            <div className="text-center forge-anim">
                <ForgeIcon />
                <h1 className="text-[22px] font-semibold tracking-tight mt-4" style={{ color: '#f2ece0' }}>
                    {t('setup.title')}
                </h1>
                <p className="text-[13px] mt-1.5" style={{ color: TEXT_DIM }}>{t('setup.subtitle')}</p>
            </div>

            {/* Step dots */}
            <div className="flex items-center justify-center gap-3 forge-anim forge-d1">
                <Dot active={step === 'hevy'} done={!!user?.has_hevy_key} label="1" />
                <div className="flex-1 max-w-[60px] h-px" style={{ background: CARD_BORDER }} />
                <Dot active={step === 'yazio'} done={!!user?.has_yazio} label="2" />
            </div>

            {/* Step 1 — Hevy */}
            {step === 'hevy' && (
                <div className="card-forge p-5 space-y-4 forge-anim forge-d2">
                    <div className="flex items-center gap-2.5">
                        <Key size={15} style={{ color: SAND }} />
                        <h3 className="text-[15px] font-medium" style={{ color: '#f2ece0' }}>
                            {t('setup.hevyTitle')}
                        </h3>
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>
                        {t('setup.hevyDesc')}{' '}
                        <a href="https://api.hevyapp.com/account" target="_blank" rel="noopener noreferrer"
                            className="underline underline-offset-2" style={{ color: SAND }}>
                            {t('setup.hevyLink')}
                        </a>. {t('setup.hevyEncrypted')}.
                    </p>
                    <form onSubmit={handleSaveHevy} className="space-y-3">
                        <input type="password" className="input-forge font-mono text-[13px]"
                            placeholder="hvy_xxxxxxxxxxxxxxxxxxxx"
                            value={apiKey} onChange={e => setApiKey(e.target.value)} required />
                        <FeedMsg msg={keyMsg} />
                        <button type="submit" disabled={savingKey}
                            className="btn-forge w-full flex items-center justify-center gap-2">
                            {savingKey ? t('settings.saving') : <>{t('setup.saveAndContinue')} <ArrowRight size={16} /></>}
                        </button>
                    </form>
                    {user?.has_hevy_key && (
                        <button onClick={() => setStep('yazio')}
                            className="w-full text-center text-[12px] cursor-pointer underline underline-offset-2"
                            style={{ color: TEXT_DIM }}>
                            {t('setup.skipToYazio')}
                        </button>
                    )}
                </div>
            )}

            {/* Step 2 — Yazio */}
            {step === 'yazio' && (
                <div className="card-forge p-5 space-y-4 forge-anim forge-d2">
                    <div className="flex items-center gap-2.5">
                        <UtensilsCrossed size={15} style={{ color: SAND }} />
                        <h3 className="text-[15px] font-medium" style={{ color: '#f2ece0' }}>
                            {t('setup.yazioTitle')}
                        </h3>
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>
                        {t('setup.yazioDesc')} <span style={{ color: '#f2ece0' }}>{t('setup.hevyEncrypted')}</span>.
                    </p>
                    <form onSubmit={handleSaveYazio} className="space-y-3">
                        <input type="email" className="input-forge text-[13px]"
                            placeholder="email@yazio.com"
                            value={yazioEmail} onChange={e => setYazioEmail(e.target.value)} required />
                        <div className="relative">
                            <input type={showPw ? 'text' : 'password'} className="input-forge text-[13px] pr-11"
                                placeholder="Passwort"
                                value={yazioPassword} onChange={e => setYazioPassword(e.target.value)} required />
                            <button type="button" onClick={() => setShowPw(s => !s)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer"
                                style={{ color: TEXT_DIM }}>
                                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                            </button>
                        </div>
                        <FeedMsg msg={yazioMsg} />
                        <button type="submit" disabled={savingYazio}
                            className="btn-forge w-full flex items-center justify-center gap-2">
                            {savingYazio ? t('settings.saving') : <>{t('setup.connectAndStart')} <ArrowRight size={16} /></>}
                        </button>
                    </form>
                    <button onClick={() => setStep('hevy')}
                        className="w-full text-center text-[12px] cursor-pointer"
                        style={{ color: TEXT_DIM }}>
                        {t('setup.backToHevy')}
                    </button>
                </div>
            )}
        </div>
    );
}

function Dot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
    return (
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold border-2 transition-all"
            style={{
                background: done ? 'rgba(52,211,153,0.15)' : active ? `${SAND}18` : 'rgba(255,247,235,0.05)',
                borderColor: done ? '#34d399' : active ? SAND : 'rgba(255,247,235,0.15)',
                color: done ? '#34d399' : active ? SAND : TEXT_DIM,
            }}>
            {done ? <CheckCircle size={16} /> : label}
        </div>
    );
}

function ForgeIcon() {
    return (
        <div className="inline-flex w-14 h-14 rounded-2xl items-center justify-center mx-auto"
            style={{ background: 'linear-gradient(135deg, rgba(232,197,138,0.25), rgba(200,164,100,0.15))', border: '1px solid rgba(232,197,138,0.3)' }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L10.5 6.5H13L9.5 9.5L11 14L8 11.5L5 14L6.5 9.5L3 6.5H5.5L8 2Z"
                    fill={SAND} fillOpacity="0.9" />
            </svg>
        </div>
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
