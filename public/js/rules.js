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
        <h3>Bidding</h3>
        <p>Everyone gets four cards. Bidding starts with one seat further round each round: open at 170 or pass, then raise in tens up to 250. A pass is final. A bid of 250 ends the bidding. If everyone passes, the last seat takes the call at 170.</p>
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
        <h3>Scoring</h3>
        <p>The caller’s team counts the points in the tricks it won. Reach the bid and the team wins. The stake is (bid − 160) ÷ 10, so a 170 bid is worth 1 and a 250 bid is worth 9. The caller scores twice the stake, every other player once, winners gaining and losers losing.</p>
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
