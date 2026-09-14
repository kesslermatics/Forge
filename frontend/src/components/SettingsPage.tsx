import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { createMonthlyChallengeCheckin, createPersonalApiKey, disconnectGoogleHealth, getGoogleHealthStatus, listPersonalApiKeys, revokePersonalApiKey, saveYazioCredentials, startGoogleHealthConnection, updateLanguage, updateUserProfile, logoutUser } from '../api/api';
import type { GoogleHealthStatus, PersonalApiKey, UserInfo } from '../api/api';
import { UtensilsCrossed, Eye, EyeOff, CheckCircle, AlertCircle, Shield, Globe, LogOut, UserRound, Loader2, Sparkles, Dumbbell, KeyRound, Plus, Trash2, Unplug } from 'lucide-react';
import ApiKeyCreatedDialog from './ApiKeyCreatedDialog';
import ConfirmDialog from './ConfirmDialog';
import { useLanguage } from '../i18n';
import type { Lang } from '../i18n';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';

type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };
type Feedback = { type: 'success' | 'error'; text: string } | null;

export default function SettingsPage() {
    const { user, refreshUser } = useOutletContext<LayoutContext>();
    const navigate = useNavigate();
    const { t, lang } = useLanguage();
    const [firstName, setFirstName] = useState('');
    const [heightCm, setHeightCm] = useState('');
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
    const [googleHealth, setGoogleHealth] = useState<GoogleHealthStatus | null>(null);
    const [loadingGoogleHealth, setLoadingGoogleHealth] = useState(true);
    const [changingGoogleHealth, setChangingGoogleHealth] = useState(false);
    const [googleHealthMsg, setGoogleHealthMsg] = useState<Feedback>(null);
    const [apiKeys, setApiKeys] = useState<PersonalApiKey[]>([]);
    const [apiKeyName, setApiKeyName] = useState('');
    const [loadingApiKeys, setLoadingApiKeys] = useState(true);
    const [creatingApiKey, setCreatingApiKey] = useState(false);
    const [revokingApiKeyId, setRevokingApiKeyId] = useState<string | null>(null);
    const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
    const [pendingRevoke, setPendingRevoke] = useState<PersonalApiKey | null>(null);
    const [apiKeyMsg, setApiKeyMsg] = useState<Feedback>(null);

    useEffect(() => {
        void (async () => {
            try { setGoogleHealth(await getGoogleHealthStatus()); }
            catch (caught: unknown) { setGoogleHealthMsg({ type: 'error', text: caught instanceof Error ? caught.message : 'Google Health-Status konnte nicht geladen werden.' }); }
            finally { setLoadingGoogleHealth(false); }
        })();
        const outcome = new URLSearchParams(window.location.search).get('google_health');
        if (outcome) {
            const texts: Record<string, Feedback> = {
                connected: { type: 'success', text: 'Google Health ist verbunden. Abgeschlossene Forge-Workouts werden automatisch synchronisiert.' },
                declined: { type: 'error', text: 'Die Google-Verbindung wurde nicht bestätigt.' },
                invalid_state: { type: 'error', text: 'Die Google-Verbindung ist abgelaufen. Bitte starte sie erneut.' },
                failed: { type: 'error', text: 'Google Health konnte nicht verbunden werden. Bitte versuche es erneut.' },
            };
            setGoogleHealthMsg(texts[outcome] ?? { type: 'error', text: 'Google Health konnte nicht verbunden werden.' });
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, []);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const response = await listPersonalApiKeys();
                if (active) setApiKeys(response.items);
            } catch (caught: unknown) {
                if (active) setApiKeyMsg({ type: 'error', text: caught instanceof Error ? caught.message : (lang === 'de' ? 'API-Schlüssel konnten nicht geladen werden.' : 'API keys could not be loaded.') });
            } finally {
                if (active) setLoadingApiKeys(false);
            }
        })();
        return () => { active = false; };
    }, [lang]);

    useEffect(() => {
        if (!user) return;
        setFirstName(user.first_name ?? '');
        setHeightCm(user.height_cm?.toString() ?? '');
    }, [user]);

    const handleSaveProfile = async (event: React.FormEvent) => {
        event.preventDefault();
        const parsedHeight = heightCm.trim() ? Number(heightCm) : null;
        if (parsedHeight !== null && (!Number.isFinite(parsedHeight) || parsedHeight < 80 || parsedHeight > 280)) {
            setProfileMsg({ type: 'error', text: 'Bitte gib eine gültige Größe zwischen 80 und 280 cm ein.' });
            return;
        }
        setProfileMsg(null); setSavingProfile(true);
        try {
            await updateUserProfile({ first_name: firstName.trim() || null, height_cm: parsedHeight });
            await refreshUser();
            setProfileMsg({ type: 'success', text: 'Profil gespeichert. Trainings- und Ernährungsziele kommen ausschließlich aus Yazio.' });
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

    const handleGoogleHealthConnect = async () => {
        setGoogleHealthMsg(null); setChangingGoogleHealth(true);
        try {
            const { authorization_url } = await startGoogleHealthConnection();
            window.location.assign(authorization_url);
        } catch (caught: unknown) {
            setGoogleHealthMsg({ type: 'error', text: caught instanceof Error ? caught.message : 'Google Health konnte nicht gestartet werden.' });
            setChangingGoogleHealth(false);
        }
    };

    const handleGoogleHealthDisconnect = async () => {
        setGoogleHealthMsg(null); setChangingGoogleHealth(true);
        try {
            setGoogleHealth(await disconnectGoogleHealth());
            await refreshUser();
            setGoogleHealthMsg({ type: 'success', text: 'Google Health wurde getrennt. Bereits gespeicherte Workouts bleiben erhalten.' });
        } catch (caught: unknown) {
            setGoogleHealthMsg({ type: 'error', text: caught instanceof Error ? caught.message : 'Google Health konnte nicht getrennt werden.' });
        } finally { setChangingGoogleHealth(false); }
    };

    const handleCreateApiKey = async (event: React.FormEvent) => {
        event.preventDefault();
        const name = apiKeyName.trim();
        if (!name) return;
        setApiKeyMsg(null); setCreatingApiKey(true);
        try {
            const created = await createPersonalApiKey(name);
            const { api_key, ...summary } = created;
            setApiKeys((current) => [summary, ...current]);
            setApiKeyName('');
            setCreatedApiKey(api_key);
            setApiKeyMsg({ type: 'success', text: t('settings.apiKeyCreated') });
        } catch (caught: unknown) {
            setApiKeyMsg({ type: 'error', text: caught instanceof Error ? caught.message : t('settings.apiKeyCreateFailed') });
        } finally { setCreatingApiKey(false); }
    };

    const handleRevokeApiKey = async () => {
        if (!pendingRevoke) return;
        setApiKeyMsg(null); setRevokingApiKeyId(pendingRevoke.id);
        try {
            await revokePersonalApiKey(pendingRevoke.id);
            setApiKeys((current) => current.map((item) => item.id === pendingRevoke.id ? { ...item, revoked_at: new Date().toISOString() } : item));
            setPendingRevoke(null);
            setApiKeyMsg({ type: 'success', text: t('settings.apiKeyRevokedSuccess') });
        } catch (caught: unknown) {
            setApiKeyMsg({ type: 'error', text: caught instanceof Error ? caught.message : t('settings.apiKeyRevokeFailed') });
        } finally { setRevokingApiKeyId(null); }
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
                <p className="text-[10px] leading-relaxed" style={{ color: TEXT_DIM }}>Dein Trainings- und Ernährungsziel wird ausschließlich aus deinem verbundenen Yazio-Profil übernommen.</p>
                <FeedMsg msg={profileMsg} />
                <button type="submit" disabled={savingProfile} className="btn-forge w-full text-[14px]">{savingProfile ? <><Loader2 size={15} className="animate-spin" />Speichert…</> : <><UserRound size={15} />Profil speichern</>}</button>
            </form>
        </Card>

        <Card icon={<Sparkles size={15} style={{ color: SAND }} />} title="Monats-Challenges">
            <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>Erstelle jetzt deine fünf Ziele für den aktuellen Monat und den heutigen Daily Check-in. Der Button betrifft nur deinen Account und ist pro Tag sicher wiederholbar.</p>
            <FeedMsg msg={checkinMsg} />
            <button type="button" onClick={() => void handleCreateCheckin()} disabled={creatingCheckin} className="btn-forge w-full text-[14px]">{creatingCheckin ? <><Loader2 size={15} className="animate-spin" />Erstellt…</> : <><Sparkles size={15} />Monat jetzt auswerten</>}</button>
        </Card>

        <Card icon={<Shield size={15} style={{ color: SAND }} />} title={t('settings.account')}><div className="grid grid-cols-2 gap-4 text-[13px]"><div><p style={{ color: TEXT_DIM }}>{t('settings.username')}</p><p className="mt-0.5 font-medium" style={{ color: '#f2ece0' }}>{user?.username}</p></div><div><p style={{ color: TEXT_DIM }}>Account</p><p className="mt-0.5 font-mono text-[11px] truncate" style={{ color: '#f2ece0' }}>{user?.id}</p></div></div></Card>

        <Card icon={<KeyRound size={15} style={{ color: SAND }} />} title={t('settings.apiKeysTitle')}>
            <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>{t('settings.apiKeysDesc')}</p>
            <form onSubmit={handleCreateApiKey} className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="api-key-name">{t('settings.apiKeyName')}</label><input id="api-key-name" value={apiKeyName} onChange={(event) => setApiKeyName(event.target.value)} maxLength={100} required placeholder={t('settings.apiKeyNamePlaceholder')} className="input-forge min-w-0 flex-1 text-[13px]" /><button type="submit" disabled={creatingApiKey || !apiKeyName.trim()} className="btn-forge shrink-0 text-[13px] disabled:opacity-50">{creatingApiKey ? <><Loader2 size={15} className="animate-spin" />{t('settings.apiKeyCreating')}</> : <><Plus size={15} />{t('settings.apiKeyCreate')}</>}</button></form>
            <FeedMsg msg={apiKeyMsg} />
            {loadingApiKeys ? <p className="text-[12px]" style={{ color: TEXT_DIM }}>{t('settings.apiKeysLoading')}</p> : apiKeys.length === 0 ? <p className="text-[12px]" style={{ color: TEXT_DIM }}>{t('settings.apiKeysEmpty')}</p> : <div className="space-y-2">{apiKeys.map((item) => <div key={item.id} className="rounded-2xl p-3" style={{ background: 'rgba(255,247,235,0.025)', border: `1px solid ${CARD_BORDER}`, opacity: item.revoked_at ? 0.58 : 1 }}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-[13px] font-medium" style={{ color: '#f2ece0' }}>{item.name}</p><span className="rounded-full px-2 py-0.5 text-[9px]" style={{ color: item.revoked_at ? '#fca5a5' : '#34d399', background: item.revoked_at ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)' }}>{item.revoked_at ? t('settings.apiKeyRevoked') : t('settings.apiKeyNeverExpires')}</span></div><code className="mt-1 block truncate font-mono text-[10px]" style={{ color: TEXT_DIM }}>{item.prefix}…</code><p className="mt-1 text-[10px]" style={{ color: TEXT_DIM }}>{item.last_used_at ? `${t('settings.apiKeyLastUsed')}: ${new Date(item.last_used_at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')}` : t('settings.apiKeyNeverUsed')}</p></div>{!item.revoked_at && <button type="button" onClick={() => setPendingRevoke(item)} disabled={revokingApiKeyId === item.id} className="tap rounded-xl p-2 disabled:opacity-40" aria-label={`${t('settings.apiKeyRevoke')}: ${item.name}`} style={{ color: '#fca5a5', border: '1px solid rgba(248,113,113,0.18)' }}>{revokingApiKeyId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button>}</div></div>)}</div>}
        </Card>

        <Card icon={<Globe size={15} style={{ color: SAND }} />} title={t('settings.languageTitle')}><p className="text-[13px] mb-4" style={{ color: TEXT_DIM }}>{t('settings.languageDesc')}</p><div className="flex gap-3">{(['de', 'en'] as Lang[]).map((item) => <button key={item} onClick={() => void handleLangChange(item)} className="tap flex-1 py-2.5 px-4 rounded-2xl text-[13px] font-medium cursor-pointer border transition-all" style={{ background: lang === item ? `${SAND}18` : 'rgba(255,247,235,0.04)', borderColor: lang === item ? `${SAND}44` : CARD_BORDER, color: lang === item ? SAND : TEXT_DIM }}>{item === 'de' ? '🇩🇪 Deutsch' : '🇬🇧 English'}</button>)}</div><FeedMsg msg={langMsg} /></Card>

        <Card icon={<Dumbbell size={15} style={{ color: SAND }} />} title="Google Health" badge={<ConnBadge connected={!!googleHealth?.connected} />}>
            {loadingGoogleHealth ? <p className="text-[13px]" style={{ color: TEXT_DIM }}>Verbindungsstatus wird geladen…</p> : !googleHealth?.configured ? <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>Google Health ist bereit, muss aber zuerst mit OAuth-Credentials im Backend konfiguriert werden.</p> : googleHealth?.connected ? <><p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>Abgeschlossene Forge-Workouts werden automatisch als Google-Health-Training synchronisiert.</p>{googleHealth.last_exported_at && <p className="text-[11px]" style={{ color: TEXT_DIM }}>Letzter Export: {new Date(googleHealth.last_exported_at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')}</p>}{googleHealth.failed_exports > 0 && <p className="text-[11px]" style={{ color: '#fbbf24' }}>{googleHealth.failed_exports} Export{googleHealth.failed_exports === 1 ? '' : 'e'} konnten nicht synchronisiert werden.</p>}<FeedMsg msg={googleHealthMsg} /><button type="button" onClick={() => void handleGoogleHealthDisconnect()} disabled={changingGoogleHealth} className="tap w-full rounded-2xl px-4 py-3 text-[13px] font-medium flex items-center justify-center gap-2 cursor-pointer" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)' }}>{changingGoogleHealth ? <Loader2 size={15} className="animate-spin" /> : <Unplug size={15} />}Google Health trennen</button></> : <><p className="text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>Verbinde dein Google-Konto, damit abgeschlossene Forge-Workouts automatisch zu Google Health exportiert werden.</p>{googleHealth?.status === 'reauthorization_required' && <p className="text-[11px]" style={{ color: '#fbbf24' }}>{googleHealth.last_error ?? 'Die Google-Autorisierung muss erneuert werden.'}</p>}<FeedMsg msg={googleHealthMsg} /><button type="button" onClick={() => void handleGoogleHealthConnect()} disabled={changingGoogleHealth} className="btn-forge w-full text-[14px]">{changingGoogleHealth ? <><Loader2 size={15} className="animate-spin" />Google wird geöffnet…</> : <><Dumbbell size={15} />Mit Google Health verbinden</>}</button></>}
        </Card>

        <Card icon={<UtensilsCrossed size={15} style={{ color: SAND }} />} title={t('settings.yazioTitle')} badge={<ConnBadge connected={!!user?.has_yazio} />}><p className="text-[13px] mb-4" style={{ color: TEXT_DIM }}>{t('settings.yazioDesc')}</p><form onSubmit={handleSaveYazio} className="space-y-3"><input type="email" className="input-forge text-[13px]" placeholder={user?.has_yazio ? t('settings.yazioEmailPlaceholder') : 'email@yazio.com'} value={yazioEmail} onChange={(event) => setYazioEmail(event.target.value)} required /><div className="relative"><input type={showYazioPw ? 'text' : 'password'} className="input-forge text-[13px] pr-11" placeholder={user?.has_yazio ? t('settings.yazioPasswordPlaceholder') : 'Passwort'} value={yazioPassword} onChange={(event) => setYazioPassword(event.target.value)} required /><button type="button" onClick={() => setShowYazioPw((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer" style={{ color: TEXT_DIM }}>{showYazioPw ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><FeedMsg msg={yazioMsg} /><button type="submit" disabled={savingYazio} className="btn-forge w-full text-[14px]">{savingYazio ? t('settings.saving') : user?.has_yazio ? t('settings.updateYazio') : t('settings.saveYazio')}</button></form></Card>

        <section className="pt-2 pb-3"><button onClick={logout} className="tap w-full rounded-2xl px-4 py-3.5 text-[13px] font-medium flex items-center justify-center gap-2 cursor-pointer" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)' }}><LogOut size={16} />Abmelden</button></section>
        <ApiKeyCreatedDialog apiKey={createdApiKey} onClose={() => setCreatedApiKey(null)} />
        <ConfirmDialog open={pendingRevoke !== null} title={t('settings.apiKeyRevokeTitle')} description={pendingRevoke ? t('settings.apiKeyRevokeDesc', { name: pendingRevoke.name }) : ''} confirmLabel={t('settings.apiKeyRevoke')} onConfirm={() => void handleRevokeApiKey()} onCancel={() => setPendingRevoke(null)} busy={revokingApiKeyId !== null} destructive />
    </div>;
}

function Card({ icon, title, badge, children }: { icon: React.ReactNode; title: string; badge?: React.ReactNode; children: React.ReactNode }) { return <div className="forge-anim rounded-[24px] p-5 space-y-4" style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${CARD_BORDER}` }}><div className="flex items-center gap-2.5">{icon}<span className="text-[14px] font-medium" style={{ color: '#f2ece0' }}>{title}</span>{badge}</div>{children}</div>; }

function ConnBadge({ connected }: { connected: boolean }) { const { t } = useLanguage(); return <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full" style={{ background: connected ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)', border: `1px solid ${connected ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}`, color: connected ? '#34d399' : '#fbbf24' }}>{connected ? <><CheckCircle size={11} /> {t('settings.connected')}</> : <><AlertCircle size={11} /> {t('settings.notSet')}</>}</span>; }

function FeedMsg({ msg }: { msg: Feedback }) { if (!msg) return null; return <div className="rounded-xl px-4 py-2.5 text-[12px]" style={{ background: msg.type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${msg.type === 'success' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`, color: msg.type === 'success' ? '#34d399' : '#f87171' }}>{msg.text}</div>; }
