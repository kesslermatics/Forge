import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Loader2, Sparkles, Wrench, X } from 'lucide-react';
import type { ForgeSession, ForgeSessionAction, ForgeSessionMessage } from '../../api/api';
import ForgeSheet from '../ForgeSheet';
import { BORDER, DIM, SAND, TEXT } from './shared';

const QUICK_PROMPTS = [
  'Maschine besetzt – was nehme ich stattdessen?',
  'Das war zu leicht, pass die restlichen Sätze an.',
  'Das war zu schwer, nimm die restlichen Sätze zurück.',
  'Ich habe Schmerzen bei dieser Übung.',
  'Leg mir für dieses Gerät ein Geräteprofil an.',
];

const proposalActions = (message: ForgeSessionMessage): ForgeSessionAction[] => {
  const proposal = message.proposed_action;
  if (!proposal) return [];
  return 'actions' in proposal ? proposal.actions : [proposal];
};

const toolsUsed = (message: ForgeSessionMessage) => {
  const proposal = message.proposed_action;
  return proposal && 'actions' in proposal ? proposal.tools_used ?? [] : [];
};

interface Props {
  session: ForgeSession;
  sending: boolean;
  applyingId: string | null;
  context: string | null;
  onSend: (message: string) => void;
  onApply: (messageId: string) => void;
  onDismiss: (messageId: string) => void;
  onClose: () => void;
}

export default function SessionCoachSheet({ session, sending, applyingId, context, onSend, onApply, onDismiss, onClose }: Props) {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const active = session.status === 'active';

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [session.messages.length, sending]);

  const submit = (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setInput('');
    onSend(message);
  };

  return <ForgeSheet label="Session-Coach" onClose={onClose}>
    <div className="flex max-h-[80dvh] flex-col">
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="forge-coach-spark"><Sparkles size={15} /></span>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: TEXT }}>Session-Coach</p>
            <p className="text-[11px]" style={{ color: DIM }}>{context ? `Gerade bei: ${context}` : 'Fragt nach, schlägt vor – du bestätigst.'}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Coach schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={18} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3">
        {session.messages.length === 0 && <p className="rounded-2xl px-4 py-3 text-[13px] leading-relaxed" style={{ color: DIM, background: 'rgba(232,197,138,0.06)' }}>Maschine besetzt, Schmerzen, Gewicht passt nicht oder ein neues Gerät? Ich schaue in deine Session, Bibliothek und Geräteprofile und mache dir einen Vorschlag.</p>}
        {session.messages.map((message) => {
          const actions = proposalActions(message);
          const tools = toolsUsed(message);
          const mine = message.role === 'user';
          return <div key={message.id} className={`forge-msg-in flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
            <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed" style={{ color: mine ? '#16130f' : TEXT, background: mine ? SAND : 'rgba(255,247,235,0.06)', borderBottomRightRadius: mine ? 6 : undefined, borderBottomLeftRadius: mine ? undefined : 6 }}>{message.content}</div>
            {!mine && tools.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{tools.map((tool) => <span key={tool} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]" style={{ color: DIM, background: 'rgba(255,247,235,0.04)' }}><Wrench size={9} />{tool}</span>)}</div>}
            {!mine && actions.length > 0 && <div className="mt-2 w-full max-w-[92%] rounded-2xl p-3" style={{ border: `1px solid ${SAND}44`, background: 'rgba(232,197,138,0.06)' }}>
              <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: SAND }}>{actions.length === 1 ? 'Vorschlag' : `${actions.length} Vorschläge`}</p>
              <ul className="mt-1.5 space-y-1.5">{actions.map((action, index) => <li key={action.id ?? index} className="flex gap-2 text-[12.5px] leading-snug" style={{ color: TEXT }}><span style={{ color: SAND }}>•</span>{action.title}</li>)}</ul>
              {message.action_status === 'pending' && active ? <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => onApply(message.id)} disabled={Boolean(applyingId)} className="tap flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold disabled:opacity-60" style={{ color: '#16130f', background: SAND }}>{applyingId === message.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Übernehmen</button>
                <button type="button" onClick={() => onDismiss(message.id)} disabled={Boolean(applyingId)} className="tap h-11 rounded-xl px-4 text-[13px] disabled:opacity-60" style={{ color: DIM, border: `1px solid ${BORDER}` }}>Ablehnen</button>
              </div> : <p className="mt-2 text-[11px]" style={{ color: DIM }}>{message.action_status === 'applied' ? 'Übernommen' : message.action_status === 'dismissed' ? 'Abgelehnt' : 'Nicht mehr verfügbar'}</p>}
            </div>}
          </div>;
        })}
        {sending && <div className="forge-msg-in flex items-center gap-2 text-[12px]" style={{ color: DIM }}><span className="forge-typing"><span /><span /><span /></span>Coach schaut nach…</div>}
        <div ref={endRef} />
      </div>

      {active && <div className="space-y-2 border-t pt-3" style={{ borderColor: 'rgba(255,247,235,0.07)' }}>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: 'none' }}>
          {QUICK_PROMPTS.map((prompt) => <button key={prompt} type="button" disabled={sending} onClick={() => submit(prompt)} className="tap shrink-0 rounded-full px-3 py-2 text-[11.5px] disabled:opacity-50" style={{ color: TEXT, background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}>{prompt}</button>)}
        </div>
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); submit(input); }}>
          <textarea
            value={input}
            rows={1}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(input); } }}
            placeholder="Frag deinen Coach…"
            aria-label="Nachricht an den Coach"
            className="input-forge max-h-28 min-h-11 flex-1 resize-none text-[14px]"
          />
          <button type="submit" disabled={sending || !input.trim()} aria-label="Senden" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40" style={{ color: '#16130f', background: SAND }}>{sending ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={18} />}</button>
        </form>
      </div>}
    </div>
  </ForgeSheet>;
}
