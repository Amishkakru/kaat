// How a finished round turns into points. Pure functions: nothing here knows about cards or tricks.
//
// Every scheme starts from the same base stake, (bid - 160) / 10, so 170 is 1, 205 is 4.5 and 250 is 9.
//   classic   caller 2x, each friend 1x on the winning side; every opponent takes 1x the other way.
//             Zero-sum only when the caller has exactly one friend.
//   pairwise  every opponent settles separately with every member of the caller's side: they pay the
//             caller 2x and each friend 1x (or collect it, if the caller fell short). Always zero-sum,
//             so a caller who plays alone carries more risk and earns more.
//   margin    pairwise, but the stake grows by 1 for every full 20 points the caller's side finished
//             beyond the bid (or short of it), up to +3.

export const SCHEMES = {
  classic: {
    name: 'Classic',
    blurb: 'Caller ±2, each friend ±1, each opponent the opposite ±1, all times the stake.',
  },
  pairwise: {
    name: 'Head to head',
    blurb: 'Each opponent pays (or collects from) the caller 2 and each friend 1, times the stake. Always zero-sum.',
  },
  margin: {
    name: 'Margin',
    blurb: 'Head to head, and the stake rises by 1 for every 20 points past the bid or short of it, up to +3.',
  },
};

export const DEFAULT_SCHEME = 'pairwise';
export const MARGIN_STEP = 20;
export const MARGIN_CAP = 3;

export const isScheme = (id) => typeof id === 'string' && Object.hasOwn(SCHEMES, id);
export const baseStake = (bid) => (bid - 160) / 10;

/** Extra stake for a decisive result: 1 per full MARGIN_STEP points past the bid or short of it. */
export function marginBonus(bid, teamPoints) {
  const gap = Math.abs(teamPoints - bid);
  return Math.min(MARGIN_CAP, Math.floor(gap / MARGIN_STEP));
}

export function scoreRound({
  scheme = DEFAULT_SCHEME, seats = 5, bid, caller, friendSeats, teamPoints,
}) {
  const id = isScheme(scheme) ? scheme : DEFAULT_SCHEME;
  const success = teamPoints >= bid;
  const stake = baseStake(bid);
  const margin = id === 'margin' ? marginBonus(bid, teamPoints) : 0;
  const unit = stake + margin;
  const sign = success ? 1 : -1;
  const opponents = seats - 1 - friendSeats.length;
  const shares = 2 + friendSeats.length; // the caller counts twice
  const deltas = Array.from({ length: seats }, (_, s) => {
    if (id === 'classic') {
      if (s === caller) return sign * 2 * unit;
      return (friendSeats.includes(s) ? sign : -sign) * unit;
    }
    if (s === caller) return sign * 2 * unit * opponents;
    if (friendSeats.includes(s)) return sign * unit * opponents;
    return -sign * unit * shares;
  });
  return {
    scheme: id, success, stake, margin, unit, deltas,
  };
}
