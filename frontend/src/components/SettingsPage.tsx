import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { createMonthlyChallengeCheckin, saveGoal, saveYazioCredentials, updateLanguage, updateUserProfile, logoutUser } from '../api/api';
import type { UserInfo } from '../api/api';
import { UtensilsCrossed, Eye, EyeOff, CheckCircle, AlertCircle, Shield, Globe, LogOut, Ruler, Target, UserRound, Loader2, Sparkles } from 'lucide-react';
import { useLanguage } from '../i18n';
import type { Lang } from '../i18n';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';
const GOALS = ['Muskelaufbau', 'Cut', 'Erhalt', 'Recomp'];

type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };
type Feedback = { type: 'success' | 'error'; text: string } | null;

export default function SettingsPage() {
    const { user, refreshUser } = useOutletContext<LayoutContext>();
    const navigate = useNavigate();
    const { t, lang } = useLanguage();
    const [firstName, setFirstName] = useState('');
    const [heightCm, setHeightCm] = useState('');
    const [goal, setGoal] = useState('Muskelaufbau');
    const [targetWeight, setTargetWeight] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileMsg, setProfileMsg] = useState<Feedback>(null);
    const [creatingCheckin, setCreatingCheckin] = useState(false);
    const [checkinMsg, setCheckinMsg] = useState<Feedback>(null);
    const [yazioEmail, setYazioEmail] = useState('');
    const [yazioPassword, setYazioPassword] = useState('');
    const [showYazioPw, setShowYazioPw] = useState(false);
    const [savingYazio, setSavingYazio] = useState(false);
    const [yazioMsg, setYazioMsg] = useState<Feedback>(null);
    const [langMsg, setLangMsg] = useState<Feedback>(null);

    useEffect(() => {
        if (!user) return;
        setFirstName(user.first_name ?? '');
        setHeightCm(user.height_cm?.toString() ?? '');
        setGoal(user.current_goal ?? 'Muskelaufbau');
        setTargetWeight(user.target_weight?.toString() ?? '');
    }, [user]);

    const goalOptions = Array.from(new Set([...GOALS, goal])).filter(Boolean);

    const handleSaveProfile = async (event: React.FormEvent) => {
        event.preventDefault();
        const parsedHeight = heightCm.trim() ? Number(heightCm) : null;
        const parsedTarget = targetWeight.trim() ? Number(targetWeight) : null;
        if ((parsedHeight !== null && (!Number.isFinite(parsedHeight) || parsedHeight < 80 || parsedHeight > 280)) ||
            (parsedTarget !== null && (!Number.isFinite(parsedTarget) || parsedTarget <= 0 || parsedTarget > 500))) {
            setProfileMsg({ type: 'error', text: 'Bitte gib gültige Werte ein (Größe: 80–280 cm, Zielgewicht: 0–500 kg).' });
            return;
        }
        setProfileMsg(null); setSavingProfile(true);
        try {
            await Promise.all([
                updateUserProfile({ first_name: firstName.trim() || null, height_cm: parsedHeight }),
                saveGoal(goal, parsedTarget),
            ]);
            await refreshUser();
            setProfileMsg({ type: 'success', text: 'Profil und Ziele gespeichert.' });
        } catch (caught: unknown) {
            setProfileMsg({ type: 'error', text: caught instanceof Error ? caught.message : 'Profil konnte nicht gespeichert werden.' });
        } finally { setSavingProfile(false); }
    };

    const handleCreateCheckin = async () => {
        setCheckinMsg(null); setCreatingCheckin(true);
        try {
            await createMonthlyChallengeCheckin();
            setCheckinMsg({ type: 'success', text: 'Monats-Challenges und der heutige Daily Check-in sind bereit.' });
        } catch (caught: unknown) {
            setCheckinMsg({ type: 'error', text: caught instanceof Error ? caught.message : 'Daily Check-in konnte nicht erstellt werden.' });
        } finally { setCreatingCheckin(false); }
    };

    const handleSaveYazio = async (event: React.FormEvent) => {
        event.preventDefault(); setYazioMsg(null); setSavingYazio(true);
        try { await saveYazioCredentials(yazioEmail, yazioPassword); setYazioMsg({ type: 'success', text: t('settings.yazioUpdated') }); await refreshUser(); setYazioEmail(''); setYazioPassword(''); }
        catch (caught: unknown) { setYazioMsg({ type: 'error', text: caught instanceof Error ? caught.message : 'Yazio konnte nicht gespeichert werden.' }); }
        finally { setSavingYazio(false); }
    };

    const handleLangChange = async (newLang: Lang) => {
        setLangMsg(null);
        try { await updateLanguage(newLang); localStorage.setItem('lang', newLang); await refreshUser(); setLangMsg({ type: 'success', text: t('settings.languageUpdated') }); }
        catch (caught: unknown) { setLangMsg({ type: 'error', text: caught instanceof Error ? caught.message : 'Sprache konnte nicht geändert werden.' }); }
    };

    const logout = () => { logoutUser(); navigate('/login'); };

    return <div className="space-y-5">
        <header className="forge-anim flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,197,138,0.12)', color: SAND }}><UserRound size={21} /></div>
            <div><h1 className="text-[24px] font-semibold tracking-tight" style={{ color: '#f2ece0' }}>{t('settings.title')}</h1><p className="text-[13px] mt-1" style={{ color: TEXT_DIM }}>{t('settings.subtitle')}</p></div>
        </header>

        <Card icon={<UserRound size={15} style={{ color: SAND }} />} title="Dein Profil">
            <form onSubmit={handleSaveProfile} className="space-y-3">
                <div className="grid grid-cols-2 gap-3"><label className="text-[11px]" style={{ color: TEXT_DIM }}>Vorname<input value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={100} placeholder="Wie sollen wir dich nennen?" className="input-forge mt-1 !px-3 !py-2.5 text-[13px]" /></label><label className="text-[11px]" style={{ color: TEXT_DIM }}>Größe (cm)<input type="number" inputMode="decimal" min="80" max="280" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} placeholder="z. B. 182" className="input-forge mt-1 !px-3 !py-2.5 text-[13px]" /></label></div>
                <div className="grid grid-cols-2 gap-3"><label className="text-[11px]" style={{ color: TEXT_DIM }}>Dein Ziel<select value={goal} onChange={(event) => setGoal(event.target.value)} className="input-forge mt-1 !px-3 !py-2.5 text-[13px]">{goalOptions.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-[11px]" style={{ color: TEXT_DIM }}>Zielgewicht (kg)<input type="number" inputMode="decimal" min="1" max="500" step="0.1" value={targetWeight} onChange={(event) => setTargetWeight(event.target.value)} placeholder="Optional" className="input-forge mt-1 !px-3 !py-2.5 text-[13px]" /></label></div>
                <p className="flex gap-1.5 text-[10px] leading-relaxed" style={{ color: TEXT_DIM }}><Ruler size={12} className="shrink-0 mt-0.5" />Größe und Ziel helfen dir, deinen Forge-Verlauf sauber einzuordnen. Dein Tagesgewicht bleibt weiterhin in der Gewichtshistorie.</p>
                <FeedMsg msg={profileMsg} />
                <button type="submit" disabled={savingProfile} className="btn-forge w-full text-[14px]">{savingProfile ? <><Loader2 size={15} className="animate-spin" />Speichert…</> : <><Target size={15} />Profil speichern</>}</button>
            </form>
        </Card>

        <Card icon={<Sparkles size={15} style={{ color: SAND }} />} title="Monats-Challenges">
            <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>Erstelle jetzt deine fünf Ziele für den aktuellen Monat und den heutigen Daily Check-in. Der Button betrifft nur deinen Account und ist pro Tag sicher wiederholbar.</p>
            <FeedMsg msg={checkinMsg} />
            <button type="button" onClick={() => void handleCreateCheckin()} disabled={creatingCheckin} className="btn-forge w-full text-[14px]">{creatingCheckin ? <><Loader2 size={15} className="animate-spin" />Erstellt…</> : <><Sparkles size={15} />Monat jetzt auswerten</>}</button>
        </Card>

        <Card icon={<Shield size={15} style={{ color: SAND }} />} title={t('settings.account')}><div className="grid grid-cols-2 gap-4 text-[13px]"><div><p style={{ color: TEXT_DIM }}>{t('settings.username')}</p><p className="mt-0.5 font-medium" style={{ color: '#f2ece0' }}>{user?.username}</p></div><div><p style={{ color: TEXT_DIM }}>Account</p><p className="mt-0.5 font-mono text-[11px] truncate" style={{ color: '#f2ece0' }}>{user?.id}</p></div></div></Card>

        <Card icon={<Globe size={15} style={{ color: SAND }} />} title={t('settings.languageTitle')}><p className="text-[13px] mb-4" style={{ color: TEXT_DIM }}>{t('settings.languageDesc')}</p><div className="flex gap-3">{(['de', 'en'] as Lang[]).map((item) => <button key={item} onClick={() => void handleLangChange(item)} className="tap flex-1 py-2.5 px-4 rounded-2xl text-[13px] font-medium cursor-pointer border transition-all" style={{ background: lang === item ? `${SAND}18` : 'rgba(255,247,235,0.04)', borderColor: lang === item ? `${SAND}44` : CARD_BORDER, color: lang === item ? SAND : TEXT_DIM }}>{item === 'de' ? '🇩🇪 Deutsch' : '🇬🇧 English'}</button>)}</div><FeedMsg msg={langMsg} /></Card>

        <Card icon={<UtensilsCrossed size={15} style={{ color: SAND }} />} title={t('settings.yazioTitle')} badge={<ConnBadge connected={!!user?.has_yazio} />}><p className="text-[13px] mb-4" style={{ color: TEXT_DIM }}>{t('settings.yazioDesc')}</p><form onSubmit={handleSaveYazio} className="space-y-3"><input type="email" className="input-forge text-[13px]" placeholder={user?.has_yazio ? t('settings.yazioEmailPlaceholder') : 'email@yazio.com'} value={yazioEmail} onChange={(event) => setYazioEmail(event.target.value)} required /><div className="relative"><input type={showYazioPw ? 'text' : 'password'} className="input-forge text-[13px] pr-11" placeholder={user?.has_yazio ? t('settings.yazioPasswordPlaceholder') : 'Passwort'} value={yazioPassword} onChange={(event) => setYazioPassword(event.target.value)} required /><button type="button" onClick={() => setShowYazioPw((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer" style={{ color: TEXT_DIM }}>{showYazioPw ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><FeedMsg msg={yazioMsg} /><button type="submit" disabled={savingYazio} className="btn-forge w-full text-[14px]">{savingYazio ? t('settings.saving') : user?.has_yazio ? t('settings.updateYazio') : t('settings.saveYazio')}</button></form></Card>

        <section className="pt-2 pb-3"><button onClick={logout} className="tap w-full rounded-2xl px-4 py-3.5 text-[13px] font-medium flex items-center justify-center gap-2 cursor-pointer" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)' }}><LogOut size={16} />Abmelden</button></section>
    </div>;
}

function Card({ icon, title, badge, children }: { icon: React.ReactNode; title: string; badge?: React.ReactNode; children: React.ReactNode }) { return <div className="forge-anim rounded-[24px] p-5 space-y-4" style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${CARD_BORDER}` }}><div className="flex items-center gap-2.5">{icon}<span className="text-[14px] font-medium" style={{ color: '#f2ece0' }}>{title}</span>{badge}</div>{children}</div>; }

function ConnBadge({ connected }: { connected: boolean }) { const { t } = useLanguage(); return <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full" style={{ background: connected ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)', border: `1px solid ${connected ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}`, color: connected ? '#34d399' : '#fbbf24' }}>{connected ? <><CheckCircle size={11} /> {t('settings.connected')}</> : <><AlertCircle size={11} /> {t('settings.notSet')}</>}</span>; }

function FeedMsg({ msg }: { msg: Feedback }) { if (!msg) return null; return <div className="rounded-xl px-4 py-2.5 text-[12px]" style={{ background: msg.type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${msg.type === 'success' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`, color: msg.type === 'success' ? '#34d399' : '#f87171' }}>{msg.text}</div>; }
