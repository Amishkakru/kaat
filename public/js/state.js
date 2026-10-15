// Single client-side store. The server snapshot is the source of truth; `ui` holds only
// things that belong to this browser (draft bid, call-sheet picks, private guesses).

export const store = {
  snap: null,
  session: null,
  clockOffset: 0,
  status: 'connecting',
  info: null, // { lan: [...], port }
  send: () => {},
  ui: {
    tab: 'play',
    cut: null,
    friends: [],
    selected: null, // touch: the card waiting for a second tap
    ledgerOpen: false,
    marks: {}, // seat -> 'friend' | 'foe' (private guesses)
    marksRound: -1,
    flyFrom: {}, // card -> DOMRect of the hand card that was just played
    sheetDismissed: null,
  },
};

export const act = (msg) => store.send(msg);
export const game = () => store.snap?.game ?? null;
export const me = () => store.snap?.you ?? 0;
export const seatInfo = (i) => store.snap?.seats[i];
export const seatName = (i) => seatInfo(i)?.name || `Seat ${i + 1}`;
export const isHost = () => store.snap && store.snap.host === store.snap.you;

/** Seat position relative to the viewer: 0 is you, then clockwise around the table. */
export const rel = (seat) => (seat - me() + 5) % 5;

export const serverNow = () => Date.now() + store.clockOffset;
