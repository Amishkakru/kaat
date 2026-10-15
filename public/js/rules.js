// Rules sheet (native <dialog>).

import { $ } from './util.js';

const HTML = `
  <form method="dialog" class="rules-inner">
    <header><h2>How Kaat works</h2><button class="btn quiet small" value="close" aria-label="Close rules">Close</button></header>
    <div class="rules-body">
      <section>
        <h3>The cards</h3>
        <p>Forty cards: the 2, 3 and 4 of every suit are removed, so each player ends up with eight. Two hundred and fifty points are in play.</p>
        <p class="points"><span><b>60</b> Q♠</span><span><b>20</b> each ace</span><span><b>15</b> each king</span><span><b>10</b> other queens</span><span><b>5</b> each jack</span></p>
      </section>
      <section>
        <h3>Dealing</h3>
        <p>Everyone gets four cards first. If anyone holds no ace, king, queen or jack, the whole table is dealt again until every hand has at least one.</p>
      </section>
      <section>
        <h3>The auction</h3>
        <p>Bidding is an open auction with no turns. Anyone can bid at any moment, from 170 to 250 in steps of 10, and you can jump straight to a higher number. If two bids arrive at the same price, the first one stands and the second must go higher.</p>
        <p>The auction ends when everyone else has passed, when someone bids 250, or when the clock runs out after the last bid. The high bidder becomes the caller. A pass is final, and the high bidder cannot pass. If nobody bids, the last seat in order from the round’s opening seat takes the call at 170.</p>
      </section>
      <section>
        <h3>Friends and the cut</h3>
        <p>The caller names two friend cards and a cut suit before the other four cards are dealt. The A♠ and cards in the caller’s own first four cannot be named. Whoever holds a friend card is on the caller’s team, and nobody knows who until that card is played. The caller may end up holding a friend card, or both.</p>
      </section>
      <section>
        <h3>Tricks</h3>
        <p>Eight tricks. The caller leads the first and each winner leads the next. You must follow the led suit if you can. If you cannot, play anything. The highest cut card wins the trick, and if nobody cuts, the highest card of the led suit wins.</p>
      </section>
      <section>
        <h3>Ending a round early</h3>
        <p>Once both friend cards have been played, an opponent can claim the round if the caller’s side can no longer reach its bid, even by taking every point still in play. Every player votes, and three yes votes end the round. A vote nobody answers counts as no. If it fails, play continues and another claim must wait for the next trick. A round ended this way is scored as a loss for the caller, crediting the caller’s side with every unplayed point.</p>
      </section>
      <section>
        <h3>Scoring</h3>
        <p>The caller’s team counts the points in the tricks it won. Reach the bid and the team wins. The stake is (bid − 160) ÷ 10, so a 170 bid is worth 1 and a 250 bid is worth 9. The host picks how the stake is paid out:</p>
        <p><b>Classic.</b> The caller scores 2 stakes, each friend 1, and each opponent takes the opposite of 1 stake. It balances only when the caller has exactly one friend.</p>
        <p><b>Head to head.</b> Each opponent settles with each member of the caller’s side: 2 stakes to the caller and 1 to each friend, paid by the opponent if the caller wins and collected if the caller falls short. Scores always add up to zero, so a caller who plays alone risks more and wins more.</p>
        <p><b>Margin.</b> Head to head, and the stake goes up by 1 for every 20 points the caller’s side finished past the bid or short of it, up to 3 extra.</p>
      </section>
      <section>
        <h3>Reading the table</h3>
        <p>Tap another player’s seat to mark your guess about their team. Guesses are private and shown as a dashed thread from the caller. Confirmed friends get a solid thread.</p>
      </section>
    </div>
  </form>`;

export function mountRules() {
  const dlg = $('#rules');
  dlg.innerHTML = HTML;
  $('#btnRules').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}
