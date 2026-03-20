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
      } catch {}

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

/* =========================
   MAIN ROUTER (UPDATED)
========================= */
function App() {
  const path = window.location.pathname;

  if (path.startsWith('/overlay/')) return <OverlayPage />;
  if (path.startsWith('/guest/')) return <GuestPage />;
  if (path.startsWith('/play/')) return <PlayPage />;
  return <ControlPage />;
}

/* =========================
   PLAY PAGE (NEW)
========================= */
function PlayPage() {
  const guestId = Number(window.location.pathname.split('/').pop() || '1');
  const safeGuestId = Math.min(Math.max(guestId, 1), GUEST_COUNT);
  const { channel, connectionState } = useAblyChannel(`play-${safeGuestId}`);
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

  const room = 'testgameshow123';
  const vdoUrl = `https://vdo.ninja/?room=${room}&push=guest${safeGuestId}&webcam&autostart`;

  return (
    <div className="guest-shell" style={colorVars(guest.color)}>
      <div className="guest-card-page card">
        <p className="eyebrow">Guest play page</p>
        <h1>{guest.label}</h1>

        <iframe
          src={vdoUrl}
          allow="camera; microphone; autoplay; fullscreen"
          style={{ width: '100%', height: '320px', border: 'none', borderRadius: '16px' }}
        />

        <label>
          Your answer
          <input value={draftAnswer} onChange={(e) => setDraftAnswer(e.target.value)} />
        </label>

        <button onClick={submitAnswer}>
          Submit Answer
        </button>

        <div>{statusText}</div>
      </div>
    </div>
  );
}

/* =========================
   EXISTING PAGES (UNCHANGED)
========================= */

/* Keep your ControlPage, GuestPage, OverlayPage EXACTLY as they are below */

export default App;
