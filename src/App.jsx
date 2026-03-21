useEffect(() => {
  document.body.style.background = 'transparent';
  document.documentElement.style.background = 'transparent';

  return () => {
    document.body.style.background = '';
    document.documentElement.style.background = '';
  };
}, []);
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Ably from 'ably';

const CHANNEL_NAME = 'gameshow-overlays';
const GUEST_COUNT = 10;
const COLOR_PRESETS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#64748b',
];

const EMPTY_GUESTS = Array.from({ length: GUEST_COUNT }, (_, index) => ({
  id: index + 1,
  label: `Guest ${index + 1}`,
  answer: '',
  pendingAnswer: '',
  hasSubmitted: false,
  submittedAt: null,
  visible: false,
  color: COLOR_PRESETS[index % COLOR_PRESETS.length],
}));

function createClientId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createAblyClient(prefix) {
  return new Ably.Realtime({
    authUrl: `/.netlify/functions/ably-token?clientId=${createClientId(prefix)}`,
  });
}

function useAblyChannel(prefix) {
  const clientRef = useRef(null);
  const channelRef = useRef(null);
  const [connectionState, setConnectionState] = useState('connecting');

  if (!clientRef.current) {
    clientRef.current = createAblyClient(prefix);
    channelRef.current = clientRef.current.channels.get(CHANNEL_NAME);
  }

  useEffect(() => {
    const client = clientRef.current;
    const handleState = (stateChange) => setConnectionState(stateChange.current);

    setConnectionState(client.connection.state);
    client.connection.on(handleState);

    return () => {
      client.connection.off(handleState);
      client.close();
    };
  }, []);

  return {
    channel: channelRef.current,
    connectionState,
  };
}

function sanitizeGuests(data) {
  if (!Array.isArray(data)) return EMPTY_GUESTS;
  return EMPTY_GUESTS.map((fallback, index) => {
    const source = data[index] || data.find((item) => item?.id === fallback.id) || {};
    return {
      ...fallback,
      ...source,
      id: fallback.id,
      color: source.color || fallback.color,
      pendingAnswer: source.pendingAnswer || '',
      answer: source.answer || '',
      label: source.label || fallback.label,
      hasSubmitted: Boolean(source.hasSubmitted),
      submittedAt: source.submittedAt || null,
      visible: Boolean(source.visible),
    };
  });
}

function useOverlayStore(channel) {
  const [guests, setGuests] = useState(EMPTY_GUESTS);

  useEffect(() => {
    let active = true;
    let unsubscribe = null;

    async function setup() {
      try {
        const history = await channel.history({ limit: 1 });
        const latest = history.items[0]?.data;
        if (active && latest?.guests) {
          setGuests(sanitizeGuests(latest.guests));
        }
      } catch {
        // Keep defaults if no history is available yet.
      }

      const handleMessage = (message) => {
        if (message.data?.guests) {
          setGuests(sanitizeGuests(message.data.guests));
        }
      };

      channel.subscribe(handleMessage);
      unsubscribe = () => channel.unsubscribe(handleMessage);
    }

    setup();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [channel]);

  return [guests, setGuests];
}

function keyToGuestId(key) {
  if (!/^[0-9]$/.test(key)) return null;
  return key === '0' ? 10 : Number(key);
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
}

function colorVars(color) {
  const { r, g, b } = hexToRgb(color || '#2563eb');
  return {
    '--accent': color || '#2563eb',
    '--accent-rgb': `${r}, ${g}, ${b}`,
  };
}

function formatTime(timestamp) {
  if (!timestamp) return 'Waiting';
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'Ready';
  }
}

function App() {
  const path = window.location.pathname;

  if (path.startsWith('/overlay/')) return <OverlayPage />;
  if (path.startsWith('/guest/')) return <GuestPage />;
  return <ControlPage />;
}

function ControlPage() {
  const { channel, connectionState } = useAblyChannel('control');
  const [guests, setGuests] = useOverlayStore(channel);
  const [statusText, setStatusText] = useState('Ready.');
  const [selectedGuestId, setSelectedGuestId] = useState(1);
  const [hotkeysEnabled, setHotkeysEnabled] = useState(true);
  const guestsRef = useRef(guests);

  useEffect(() => {
    guestsRef.current = guests;
  }, [guests]);

  const publishState = useCallback(async (nextGuests, message = 'Updated.') => {
    const safeGuests = sanitizeGuests(nextGuests);
    setGuests(safeGuests);
    guestsRef.current = safeGuests;
    await channel.publish('overlay-state', { guests: safeGuests, updatedAt: Date.now() });
    setStatusText(message);
  }, [channel, setGuests]);

  const updateGuestLocal = useCallback((guestId, patch) => {
    setGuests((current) => current.map((guest) => (
      guest.id === guestId ? { ...guest, ...patch } : guest
    )));
  }, [setGuests]);

  const patchAndPublishGuest = useCallback(async (guestId, patch, message) => {
    const nextGuests = guestsRef.current.map((guest) => (
      guest.id === guestId ? { ...guest, ...patch } : guest
    ));
    await publishState(nextGuests, message);
  }, [publishState]);

  const selectedGuest = guests.find((guest) => guest.id === selectedGuestId) || guests[0];
  const currentOrigin = useMemo(() => window.location.origin, []);
  const submittedCount = guests.filter((guest) => guest.hasSubmitted).length;

  useEffect(() => {
    const handleKeyDown = async (event) => {
      if (!hotkeysEnabled) return;
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable = ['input', 'textarea', 'select'].includes(tagName) || target?.isContentEditable;
      if (isEditable) return;

      const guestId = keyToGuestId(event.key);
      if (guestId) {
        event.preventDefault();
        const guest = guestsRef.current.find((item) => item.id === guestId);
        if (!guest) return;
        setSelectedGuestId(guestId);

        if (event.shiftKey) {
          await patchAndPublishGuest(
            guestId,
            {
              answer: guest.pendingAnswer || guest.answer,
              visible: true,
              hasSubmitted: false,
            },
            `${guest.label} revealed.`
          );
          return;
        }

        await patchAndPublishGuest(
          guestId,
          { visible: !guest.visible },
          `${guest.label} ${guest.visible ? 'hidden' : 'shown'}.`
        );
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        await publishState(
          guestsRef.current.map((guest) => ({
            ...guest,
            answer: guest.pendingAnswer || guest.answer,
            visible: true,
            hasSubmitted: false,
          })),
          'All lower-thirds shown.'
        );
        return;
      }

      if (key === 'h' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        await publishState(
          guestsRef.current.map((guest) => ({ ...guest, visible: false })),
          'All lower-thirds hidden.'
        );
        return;
      }

      if (key === 'c' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        await publishState(
          guestsRef.current.map((guest) => ({
            ...guest,
            answer: '',
            pendingAnswer: '',
            visible: false,
            hasSubmitted: false,
            submittedAt: null,
          })),
          'All guests cleared.'
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkeysEnabled, patchAndPublishGuest, publishState]);

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Game Show Overlay Control</p>
          <h1>Guest answers + host reveal</h1>
          <p className="hero-copy">
            Guests submit their own answers from private guest links. You control the display label,
            see who has answered, and decide when each answer goes live on stream.
          </p>
        </div>
        <div className="hero-panel">
          <div className={`pill ${connectionState}`}>Ably: {connectionState}</div>
          <div className="pill">Answers in: {submittedCount}/{GUEST_COUNT}</div>
          <div className="status-line">{statusText}</div>
        </div>
      </header>

      <section className="top-grid control-grid">
        <div className="card stage-panel" style={colorVars(selectedGuest?.color)}>
          <div className="panel-header">
            <div>
              <p className="eyebrow compact">Selected guest</p>
              <h2>{selectedGuest?.label}</h2>
              <p className="subtle-copy">Guest page shows this label before they submit.</p>
            </div>
            <span className={`visibility ${selectedGuest?.visible ? 'live' : 'hidden'}`}>
              {selectedGuest?.visible ? 'LIVE' : 'HIDDEN'}
            </span>
          </div>

          <div className="preview-box accent-box">
            <div className={`overlay-card preview-card ${selectedGuest?.visible ? 'visible' : 'hidden'}`} style={colorVars(selectedGuest?.color)}>
              <div className="overlay-topline">{selectedGuest?.label}</div>
              <div className="overlay-answer">{selectedGuest?.answer || 'Awaiting reveal'}</div>
            </div>
          </div>

          <div className="stage-actions split-actions">
            <button onClick={() => patchAndPublishGuest(selectedGuestId, { answer: selectedGuest.pendingAnswer || selectedGuest.answer, visible: true, hasSubmitted: false }, `${selectedGuest.label} shown.`)}>
              Show / Update selected
            </button>
            <button className="secondary" onClick={() => patchAndPublishGuest(selectedGuestId, { visible: false }, `${selectedGuest.label} hidden.`)}>
              Hide
            </button>
            <button className="secondary" onClick={() => patchAndPublishGuest(selectedGuestId, { answer: '', pendingAnswer: '', visible: false, hasSubmitted: false, submittedAt: null }, `${selectedGuest.label} cleared.`)}>
              Clear
            </button>
          </div>

          <div className="mini-status-grid">
            <div className="mini-card">
              <span>Pending answer</span>
              <strong>{selectedGuest?.pendingAnswer || 'No answer yet'}</strong>
            </div>
            <div className="mini-card">
              <span>Submitted</span>
              <strong>{selectedGuest?.hasSubmitted ? `Yes • ${formatTime(selectedGuest?.submittedAt)}` : 'No'}</strong>
            </div>
            <div className="mini-card">
              <span>Guest link</span>
              <strong>{`${currentOrigin}/guest/${selectedGuestId}`}</strong>
            </div>
          </div>
        </div>

        <div className="card hotkey-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow compact">Operator tools</p>
              <h2>Fast reveal controls</h2>
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={hotkeysEnabled} onChange={(event) => setHotkeysEnabled(event.target.checked)} />
              <span>Enable hotkeys</span>
            </label>
          </div>

          <div className="hotkey-list compact-list">
            <div><kbd>1-9</kbd> <kbd>0</kbd><span>Select + toggle that guest</span></div>
            <div><kbd>Shift</kbd> + <kbd>1-9</kbd> / <kbd>0</kbd><span>Reveal that guest’s latest submitted answer</span></div>
            <div><kbd>R</kbd><span>Reveal all latest submitted answers</span></div>
            <div><kbd>H</kbd><span>Hide all overlays</span></div>
            <div><kbd>Shift</kbd> + <kbd>C</kbd><span>Clear all submitted + shown answers</span></div>
          </div>

          <div className="quick-answer-row">
            <button className="quick yes" onClick={() => patchAndPublishGuest(selectedGuestId, { pendingAnswer: 'YES', hasSubmitted: true, submittedAt: Date.now() }, `${selectedGuest.label} marked YES.`)}>YES</button>
            <button className="quick no" onClick={() => patchAndPublishGuest(selectedGuestId, { pendingAnswer: 'NO', hasSubmitted: true, submittedAt: Date.now() }, `${selectedGuest.label} marked NO.`)}>NO</button>
          </div>

          <div className="note-box">
            Guests only edit their own answer field on <strong>/guest/1</strong> through <strong>/guest/10</strong>.
            Your control page handles labels, color, reveal timing, and on-air visibility.
          </div>
        </div>
      </section>

      <section className="toolbar card">
        <button onClick={() => publishState(guests.map((guest) => ({ ...guest, answer: guest.pendingAnswer || guest.answer, visible: true, hasSubmitted: false })), 'All lower-thirds shown.')}>Show all latest answers</button>
        <button onClick={() => publishState(guests.map((guest) => ({ ...guest, visible: false })), 'All lower-thirds hidden.')}>Hide all</button>
        <button onClick={() => publishState(guests.map((guest) => ({ ...guest, answer: '', pendingAnswer: '', visible: false, hasSubmitted: false, submittedAt: null })), 'All guests cleared.')}>Clear all</button>
      </section>

      <section className="grid-list">
        {guests.map((guest) => (
          <article className={`card guest-card ${selectedGuestId === guest.id ? 'selected' : ''}`} key={guest.id} style={colorVars(guest.color)}>
            <div className="guest-card-header">
              <div>
                <h2>{guest.label}</h2>
                <p className="slot-label">Guest {guest.id} • Hotkey {guest.id === 10 ? '0' : guest.id}</p>
              </div>
              <span className={`answer-indicator ${guest.hasSubmitted ? 'ready' : 'waiting'}`}>
                {guest.hasSubmitted ? 'Answered' : 'Waiting'}
              </span>
            </div>

            <button className="select-button secondary" onClick={() => setSelectedGuestId(guest.id)}>
              {selectedGuestId === guest.id ? 'Selected' : 'Select'}
            </button>

            <label>
              Display label
              <input type="text" value={guest.label} onChange={(event) => updateGuestLocal(guest.id, { label: event.target.value })} onBlur={() => patchAndPublishGuest(guest.id, { label: guestsRef.current.find((item) => item.id === guest.id)?.label || guest.label }, `${guest.label} label updated.`)} />
            </label>

            <div className="field-group">
              <label>
                Accent color
                <input type="color" value={guest.color} onChange={(event) => updateGuestLocal(guest.id, { color: event.target.value })} onBlur={() => patchAndPublishGuest(guest.id, { color: guestsRef.current.find((item) => item.id === guest.id)?.color || guest.color }, `${guest.label} color updated.`)} className="color-input" />
              </label>
              <div className="color-palette">
                {COLOR_PRESETS.map((color) => (
                  <button key={color} className={`swatch ${guest.color === color ? 'active' : ''}`} style={{ background: color }} onClick={() => patchAndPublishGuest(guest.id, { color }, `${guest.label} color updated.`)} aria-label={`Set color ${color}`} />
                ))}
              </div>
            </div>

            <div className="status-stack">
              <div className="status-pill"><span>Submitted</span><strong>{guest.hasSubmitted ? formatTime(guest.submittedAt) : 'No'}</strong></div>
              <div className="status-pill"><span>Pending</span><strong>{guest.pendingAnswer || '—'}</strong></div>
              <div className="status-pill"><span>On air</span><strong>{guest.answer || '—'}</strong></div>
            </div>

            <div className="button-row">
              <button onClick={() => patchAndPublishGuest(guest.id, { answer: guest.pendingAnswer || guest.answer, visible: true, hasSubmitted: false }, `${guest.label} shown.`)}>Show / Update</button>
              <button className="secondary" onClick={() => patchAndPublishGuest(guest.id, { visible: false }, `${guest.label} hidden.`)}>Hide</button>
              <button className="secondary" onClick={() => patchAndPublishGuest(guest.id, { pendingAnswer: '', answer: '', visible: false, hasSubmitted: false, submittedAt: null }, `${guest.label} cleared.`)}>Clear</button>
            </div>

            <div className="link-stack">
              <div className="overlay-url"><span>Overlay:</span><code>{`${currentOrigin}/overlay/${guest.id}`}</code></div>
              <div className="overlay-url"><span>Guest page:</span><code>{`${currentOrigin}/guest/${guest.id}`}</code></div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function GuestPage() {
  const guestId = Number(window.location.pathname.split('/').pop() || '1');
  const safeGuestId = Math.min(Math.max(guestId, 1), GUEST_COUNT);
  const { channel, connectionState } = useAblyChannel(`guest-${safeGuestId}`);
  const [guests, setGuests] = useOverlayStore(channel);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [statusText, setStatusText] = useState('Enter your answer and submit when ready.');
  const guest = guests.find((item) => item.id === safeGuestId) || EMPTY_GUESTS[safeGuestId - 1];

  useEffect(() => {
    setDraftAnswer(guest.pendingAnswer || '');
  }, [guest.pendingAnswer, guest.id]);

  const submitAnswer = async () => {
    const trimmed = draftAnswer.trim();
    const nextGuests = guests.map((item) => (
      item.id === safeGuestId
        ? {
            ...item,
            pendingAnswer: trimmed,
            hasSubmitted: trimmed.length > 0,
            submittedAt: trimmed.length > 0 ? Date.now() : null,
          }
        : item
    ));

    setGuests(nextGuests);
    await channel.publish('guest-answer', { guests: nextGuests, updatedAt: Date.now() });
    setStatusText(trimmed ? 'Answer submitted. Waiting for host reveal.' : 'Answer cleared.');
  };

  return (
    <div className="guest-shell" style={colorVars(guest.color)}>
      <div className="guest-card-page card">
        <p className="eyebrow">Guest answer page</p>
        <h1>{guest.label}</h1>
        <p className="hero-copy narrow-copy">
          Enter your answer below, then hit submit. The host will see your answer and decide when it appears on stream.
        </p>

        <div className="guest-status-row">
          <span className={`answer-indicator ${guest.hasSubmitted ? 'ready' : 'waiting'}`}>
            {guest.hasSubmitted ? 'Submitted' : 'Not submitted'}
          </span>
          <span className={`pill ${connectionState}`}>Ably: {connectionState}</span>
        </div>

        <label>
          Your answer
          <input type="text" value={draftAnswer} onChange={(event) => setDraftAnswer(event.target.value)} placeholder="Type your answer here" maxLength={120} />
        </label>

        <div className="button-row">
          <button onClick={submitAnswer}>Submit answer</button>
          <button className="secondary" onClick={() => setDraftAnswer('')}>Clear field</button>
        </div>

        <div className="note-box guest-note">
          <strong>Current display label:</strong> {guest.label}
          <br />
          <strong>Last submitted answer:</strong> {guest.pendingAnswer || 'None yet'}
        </div>
      </div>
    </div>
  );
}

function OverlayPage() {
  const guestId = Number(window.location.pathname.split('/').pop() || '1');
  const safeGuestId = Math.min(Math.max(guestId, 1), GUEST_COUNT);
  const { channel, connectionState } = useAblyChannel(`overlay-${safeGuestId}`);
  const [guests] = useOverlayStore(channel);
  const guest = guests.find((item) => item.id === safeGuestId) || EMPTY_GUESTS[safeGuestId - 1];

  return (
    <div className="overlay-frame" style={colorVars(guest.color)}>
      <div className={`overlay-card ${guest.visible ? 'visible' : 'hidden'}`}>
        <div className="overlay-topline">{guest.label}</div>
        <div className="overlay-answer">{guest.answer || ' '}</div>
      </div>
      <div className="overlay-meta">Guest {safeGuestId} • {connectionState}</div>
    </div>
  );
}

export default App;
