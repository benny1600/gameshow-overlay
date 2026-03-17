import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Ably from 'ably';

const CHANNEL_NAME = 'gameshow-overlays';
const GUEST_COUNT = 10;
const EMPTY_GUESTS = Array.from({ length: GUEST_COUNT }, (_, index) => ({
  id: index + 1,
  label: `Guest ${index + 1}`,
  answer: '',
  visible: false,
  theme: 'default',
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
    client: clientRef.current,
    channel: channelRef.current,
    connectionState,
  };
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
          setGuests(latest.guests);
        }
      } catch {
        // Keep defaults if no history is available yet.
      }

      const handleMessage = (message) => {
        if (message.name === 'overlay-state' && message.data?.guests) {
          setGuests(message.data.guests);
        }
      };

      channel.subscribe('overlay-state', handleMessage);
      unsubscribe = () => channel.unsubscribe('overlay-state', handleMessage);
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

function App() {
  const path = window.location.pathname;

  if (path.startsWith('/overlay/')) {
    return <OverlayPage />;
  }

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
    setGuests(nextGuests);
    guestsRef.current = nextGuests;
    await channel.publish('overlay-state', { guests: nextGuests, updatedAt: Date.now() });
    setStatusText(message);
  }, [channel, setGuests]);

  const updateGuest = useCallback((guestId, patch) => {
    setGuests((current) =>
      current.map((guest) => (guest.id === guestId ? { ...guest, ...patch } : guest))
    );
  }, [setGuests]);

  const patchAndPublishGuest = useCallback(async (guestId, patch, message) => {
    const nextGuests = guestsRef.current.map((guest) =>
      guest.id === guestId ? { ...guest, ...patch } : guest
    );
    await publishState(nextGuests, message);
  }, [publishState]);

  const currentOverlayBase = useMemo(() => window.location.origin, []);
  const selectedGuest = guests.find((guest) => guest.id === selectedGuestId) || guests[0];

  useEffect(() => {
    const handleKeyDown = async (event) => {
      if (!hotkeysEnabled) return;

      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target?.isContentEditable;

      if (isEditable) return;

      const guestId = keyToGuestId(event.key);
      if (guestId) {
        event.preventDefault();
        const guest = guestsRef.current.find((item) => item.id === guestId);
        if (!guest) return;

        if (event.shiftKey) {
          setSelectedGuestId(guestId);
          await patchAndPublishGuest(
            guestId,
            { answer: 'THIS', theme: 'this', visible: true },
            `${guest.label} set to THIS.`
          );
          return;
        }

        if (event.altKey) {
          setSelectedGuestId(guestId);
          await patchAndPublishGuest(
            guestId,
            { answer: 'THAT', theme: 'that', visible: true },
            `${guest.label} set to THAT.`
          );
          return;
        }

        setSelectedGuestId(guestId);
        await patchAndPublishGuest(
          guestId,
          { visible: !guest.visible },
          `${guest.label} ${guest.visible ? 'hidden' : 'shown'}.`
        );
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'r' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        await publishState(
          guestsRef.current.map((guest) => ({ ...guest, visible: true })),
          'All lower-thirds shown.'
        );
        return;
      }

      if (key === 'h' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        await publishState(
          guestsRef.current.map((guest) => ({ ...guest, visible: false })),
          'All lower-thirds hidden.'
        );
        return;
      }

      if (key === 'c' && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        await publishState(
          guestsRef.current.map((guest) => ({ ...guest, answer: '', visible: false })),
          'All lower-thirds cleared.'
        );
        return;
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
          <h1>This or That lower-thirds v2</h1>
          <p className="hero-copy">
            Run 10 guest overlays from one control page. Type in answers ahead of time, reveal them
            live, or use hotkeys for fast game-show timing.
          </p>
        </div>
        <div className="hero-panel">
          <div className={`pill ${connectionState}`}>Ably: {connectionState}</div>
          <div className="pill">Channel: {CHANNEL_NAME}</div>
          <div className="status-line">{statusText}</div>
        </div>
      </header>

      <section className="top-grid">
        <div className="card stage-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow compact">Selected guest</p>
              <h2>{selectedGuest?.label}</h2>
            </div>
            <span className={`visibility ${selectedGuest?.visible ? 'live' : 'hidden'}`}>
              {selectedGuest?.visible ? 'LIVE' : 'HIDDEN'}
            </span>
          </div>

          <div className="stage-actions">
            <button onClick={() => patchAndPublishGuest(selectedGuestId, { visible: true }, `${selectedGuest.label} shown.`)}>
              Show selected
            </button>
            <button className="secondary" onClick={() => patchAndPublishGuest(selectedGuestId, { visible: false }, `${selectedGuest.label} hidden.`)}>
              Hide selected
            </button>
            <button className="secondary" onClick={() => patchAndPublishGuest(selectedGuestId, { answer: '', visible: false }, `${selectedGuest.label} cleared.`)}>
              Clear selected
            </button>
          </div>

          <div className="quick-answer-row">
            <button className="quick this" onClick={() => patchAndPublishGuest(selectedGuestId, { answer: 'THIS', theme: 'this', visible: true }, `${selectedGuest.label} set to THIS.`)}>
              THIS
            </button>
            <button className="quick that" onClick={() => patchAndPublishGuest(selectedGuestId, { answer: 'THAT', theme: 'that', visible: true }, `${selectedGuest.label} set to THAT.`)}>
              THAT
            </button>
            <button className="quick yes" onClick={() => patchAndPublishGuest(selectedGuestId, { answer: 'YES', theme: 'yes', visible: true }, `${selectedGuest.label} set to YES.`)}>
              YES
            </button>
            <button className="quick no" onClick={() => patchAndPublishGuest(selectedGuestId, { answer: 'NO', theme: 'no', visible: true }, `${selectedGuest.label} set to NO.`)}>
              NO
            </button>
          </div>

          <div className={`preview-box theme-${selectedGuest?.theme || 'default'}`}>
            <div className={`overlay-card preview-card ${selectedGuest?.visible ? 'visible' : 'hidden'}`}>
              <div className="overlay-topline">{selectedGuest?.label}</div>
              <div className="overlay-answer">{selectedGuest?.answer || 'Awaiting answer'}</div>
            </div>
          </div>
        </div>

        <div className="card hotkey-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow compact">Operator hotkeys</p>
              <h2>Live shortcuts</h2>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={hotkeysEnabled}
                onChange={(event) => setHotkeysEnabled(event.target.checked)}
              />
              <span>Enable hotkeys</span>
            </label>
          </div>

          <div className="hotkey-list">
            <div><kbd>1-9</kbd> <kbd>0</kbd><span>Toggle guest visibility</span></div>
            <div><kbd>Shift</kbd> + <kbd>1-9</kbd> / <kbd>0</kbd><span>Set that guest to THIS and show it</span></div>
            <div><kbd>Alt</kbd> + <kbd>1-9</kbd> / <kbd>0</kbd><span>Set that guest to THAT and show it</span></div>
            <div><kbd>R</kbd><span>Reveal all</span></div>
            <div><kbd>H</kbd><span>Hide all</span></div>
            <div><kbd>Shift</kbd> + <kbd>C</kbd><span>Clear all</span></div>
          </div>

          <div className="note-box">
            Hotkeys only fire when you are <strong>not typing in an input box</strong>. That keeps
            you from accidentally triggering overlays while editing names or answers.
          </div>
        </div>
      </section>

      <section className="toolbar card">
        <button
          onClick={() =>
            publishState(
              guests.map((guest) => ({ ...guest, visible: true })),
              'All lower-thirds shown.'
            )
          }
        >
          Show all
        </button>
        <button
          onClick={() =>
            publishState(
              guests.map((guest) => ({ ...guest, visible: false })),
              'All lower-thirds hidden.'
            )
          }
        >
          Hide all
        </button>
        <button
          onClick={() =>
            publishState(
              guests.map((guest) => ({ ...guest, answer: '', visible: false })),
              'All lower-thirds cleared.'
            )
          }
        >
          Clear all
        </button>
      </section>

      <section className="grid-list">
        {guests.map((guest) => (
          <article
            className={`card guest-card ${selectedGuestId === guest.id ? 'selected' : ''}`}
            key={guest.id}
          >
            <div className="guest-card-header">
              <div>
                <h2>{guest.label}</h2>
                <p className="slot-label">Hotkey: {guest.id === 10 ? '0' : guest.id}</p>
              </div>
              <span className={`visibility ${guest.visible ? 'live' : 'hidden'}`}>
                {guest.visible ? 'LIVE' : 'HIDDEN'}
              </span>
            </div>

            <button className="select-button secondary" onClick={() => setSelectedGuestId(guest.id)}>
              {selectedGuestId === guest.id ? 'Selected' : 'Select'}
            </button>

            <label>
              Display label
              <input
                type="text"
                value={guest.label}
                onChange={(event) => updateGuest(guest.id, { label: event.target.value })}
              />
            </label>

            <label>
              Answer text
              <input
                type="text"
                value={guest.answer}
                onChange={(event) => updateGuest(guest.id, { answer: event.target.value })}
                placeholder="THIS, THAT, YES, NO..."
              />
            </label>

            <label>
              Theme
              <select
                value={guest.theme}
                onChange={(event) => updateGuest(guest.id, { theme: event.target.value })}
              >
                <option value="default">Default</option>
                <option value="this">This</option>
                <option value="that">That</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>

            <div className="button-row">
              <button
                onClick={() =>
                  publishState(
                    guests.map((item) =>
                      item.id === guest.id ? { ...guest, visible: true } : item
                    ),
                    `${guest.label} shown.`
                  )
                }
              >
                Show / Update
              </button>
              <button
                className="secondary"
                onClick={() =>
                  publishState(
                    guests.map((item) =>
                      item.id === guest.id ? { ...guest, visible: false } : item
                    ),
                    `${guest.label} hidden.`
                  )
                }
              >
                Hide
              </button>
              <button
                className="secondary"
                onClick={() =>
                  publishState(
                    guests.map((item) =>
                      item.id === guest.id
                        ? { ...guest, answer: '', visible: false }
                        : item
                    ),
                    `${guest.label} cleared.`
                  )
                }
              >
                Clear
              </button>
            </div>

            <div className="overlay-url">
              <span>Overlay URL:</span>
              <code>{`${currentOverlayBase}/overlay/${guest.id}`}</code>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function OverlayPage() {
  const guestId = Number(window.location.pathname.split('/').pop() || '1');
  const { channel, connectionState } = useAblyChannel(`overlay-${guestId}`);
  const [guests] = useOverlayStore(channel);
  const guest = guests.find((item) => item.id === guestId) || EMPTY_GUESTS[guestId - 1];

  return (
    <div className={`overlay-frame theme-${guest.theme}`}>
      <div className={`overlay-card ${guest.visible ? 'visible' : 'hidden'}`}>
        <div className="overlay-topline">{guest.label}</div>
        <div className="overlay-answer">{guest.answer || ' '}</div>
      </div>
      <div className="overlay-meta">Guest {guestId} • {connectionState}</div>
    </div>
  );
}

export default App;
