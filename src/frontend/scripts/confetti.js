// The celebration burst, shared by every page that has something worth
// celebrating: the membership confirmation on /owner-membership and the order
// confirmation on /get.
//
// It lived inside membership.js until /get wanted it too. Copying 160 lines of
// particle physics into a second file would have meant two of them drifting
// apart on the next tuning pass, so it moved here instead. Each caller passes
// the class its own stylesheet places the canvas with — the physics is shared,
// the placement is not.

// Confetti, as a burst rather than a downpour.
//
// The first version fell straight down from the top edge, which reads as
// weather. A celebration pops: pieces leave two low corners fast, arc over as
// gravity catches them, then flutter down turning end over end. That arc is
// per-particle physics — a start velocity, gravity, drag and a spin — and CSS
// keyframes cannot express it, so this is a canvas and a step loop.
//
// Hand-written because it has to be. Both pages that celebrate are payment
// pages, and their script-src is 'self' plus checkout.razorpay.com and the two
// analytics origins; a confetti library from a CDN would be blocked and the
// celebration would silently never appear.
const CONFETTI_COLOURS = ["#FF2700", "#FFC02E", "#16A34A", "#2563EB", "#EC4899", "#03162D"];
const CONFETTI_PER_CANNON = 70;
const CONFETTI_GRAVITY = 0.34;
const CONFETTI_DRAG = 0.995;

let confettiStop = null;

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// One piece: where it is, how fast, how it spins, and how long it lives.
// `tilt` is what makes paper flutter — the piece is drawn narrower as it turns
// edge-on, so it flashes rather than sliding about as a flat rectangle.
function confettiPiece(originX, originY, angleDeg, spreadDeg, power) {
  const angle = (angleDeg + (Math.random() - 0.5) * spreadDeg) * (Math.PI / 180);
  const speed = power * (0.72 + Math.random() * 0.55);
  return {
    x: originX,
    y: originY,
    vx: Math.cos(angle) * speed,
    vy: -Math.sin(angle) * speed,
    w: 6 + Math.random() * 6,
    h: 9 + Math.random() * 7,
    colour: CONFETTI_COLOURS[(Math.random() * CONFETTI_COLOURS.length) | 0],
    round: Math.random() < 0.32,
    spin: (Math.random() - 0.5) * 0.32,
    angle: Math.random() * Math.PI * 2,
    tilt: Math.random() * Math.PI * 2,
    tiltSpeed: 0.08 + Math.random() * 0.1,
    life: 0,
    maxLife: 150 + Math.random() * 90
  };
}

export function burstConfetti(host, className) {
  // Asked for, not assumed: somebody who has told their system to stop moving
  // things gets the dialog and no paper.
  if (!host || prefersReducedMotion()) return;
  clearConfetti(host);

  const canvas = document.createElement("canvas");
  canvas.className = className;
  // Decoration. A screen reader has nothing to say about it.
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }

  let dpr = 1;
  const fit = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(host.clientWidth, 1) * dpr;
    canvas.height = Math.max(host.clientHeight, 1) * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();

  const w = () => canvas.width / dpr;
  const h = () => canvas.height / dpr;

  // Two cannons, angled inward and up from the lower corners — the shape a
  // party popper makes, and the reason this reads as a burst and not as rain.
  const pieces = [];
  const load = () => {
    const power = Math.min(Math.max(w() / 34, 11), 19); // a burst that crosses the dialog at any width
    for (let i = 0; i < CONFETTI_PER_CANNON; i += 1) {
      pieces.push(confettiPiece(w() * 0.06, h() * 0.98, 66, 46, power));
      pieces.push(confettiPiece(w() * 0.94, h() * 0.98, 114, 46, power));
    }
  };
  load();

  // A second, smaller volley just behind the first, so the burst has a tail
  // instead of ending all at once.
  const secondVolley = setTimeout(() => {
    const power = Math.min(Math.max(w() / 40, 9), 16);
    for (let i = 0; i < CONFETTI_PER_CANNON / 2; i += 1) {
      pieces.push(confettiPiece(w() * 0.5, h() * 0.98, 90, 78, power));
    }
  }, 220);

  let frame = null;
  const step = () => {
    ctx.clearRect(0, 0, w(), h());
    let alive = 0;

    for (const p of pieces) {
      if (p.life > p.maxLife) continue;
      p.life += 1;

      p.vx *= CONFETTI_DRAG;
      p.vy = p.vy * CONFETTI_DRAG + CONFETTI_GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.tilt += p.tiltSpeed;

      // Off the bottom for good — no point drawing it back. This, not the age
      // limit, is how essentially every piece ends: launched from the lower
      // edge, it is back past it within a second or so. maxLife is the bound
      // that guarantees the loop terminates, not the usual exit.
      //
      // There was a fade here, keyed to age. It never once ran — every piece
      // left the frame first — so it was decoration on a branch nothing
      // reached, and a fade that cannot be seen is worse than none.
      if (p.y - p.h > h()) { p.life = p.maxLife + 1; continue; }
      alive += 1;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.colour;
      // The flutter: width collapses as the piece turns edge-on.
      const width = p.w * Math.abs(Math.cos(p.tilt));
      if (p.round) {
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(width, 0.6) / 2, p.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-width / 2, -p.h / 2, Math.max(width, 0.6), p.h);
      }
      ctx.restore();
    }

    if (alive > 0) {
      frame = window.requestAnimationFrame(step);
    } else {
      stop();
    }
  };

  const stop = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    clearTimeout(secondVolley);
    window.removeEventListener("resize", fit);
    canvas.remove();
    confettiStop = null;
  };

  window.addEventListener("resize", fit);
  frame = window.requestAnimationFrame(step);
  // Held so closing the dialog can end it immediately rather than leaving a
  // loop running against a canvas nobody can see.
  confettiStop = stop;
}

export function clearConfetti(host, className) {
  if (confettiStop) confettiStop();
  if (host) host.querySelectorAll("." + className).forEach((el) => el.remove());
}
