/* ─── MAIN.JS ───────────────────────────────────────────────────────────────── */

// ─── GLSL SHADERS ────────────────────────────────────────────────────────────

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uDark;
  varying vec2  vUv;

  // ── Simplex noise 2D ──────────────────────────────────────────────────────
  vec3 mod289v3(vec3 x) { return x - floor(x*(1./289.))*289.; }
  vec2 mod289v2(vec2 x) { return x - floor(x*(1./289.))*289.; }
  vec3 permute(vec3 x)  { return mod289v3(((x*34.)+10.)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1  = (x0.x > x0.y) ? vec2(1.,0.) : vec2(0.,1.);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289v2(i);
    vec3 p = permute(permute(i.y + vec3(0.,i1.y,1.)) + i.x + vec3(0.,i1.x,1.));
    vec3 m = max(.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.);
    m = m*m; m = m*m;
    vec3 x2 = 2.*fract(p*C.www)-1.;
    vec3 h   = abs(x2)-.5;
    vec3 ox  = floor(x2+.5);
    vec3 a0  = x2-ox;
    m *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
    vec3 g;
    g.x  = a0.x *x0.x  + h.x *x0.y;
    g.yz = a0.yz*x12.xz + h.yz*x12.yw;
    return 130.*dot(m,g);
  }

  // ── FBM (4 octaves) ───────────────────────────────────────────────────────
  float fbm(vec2 p) {
    float v=0., a=.5, f=1.;
    for(int i=0;i<4;i++) { v+=a*snoise(p*f); a*=.5; f*=2.; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    // mouse subtly warps noise space
    vec2 mOff = (uMouse - .5) * .18;
    float t   = uTime * .05;

    float n  = fbm(uv * 2.4 + vec2(t, t*.65) + mOff);
    float n2 = fbm(uv * 5.2 - vec2(t*.9, t*1.2) - mOff*.4);
    float noise = n*.72 + n2*.28;

    // light mode: subtle warm/cool variation on #F4F3EE
    vec3 lWarm = vec3(.972, .962, .930);
    vec3 lCool = vec3(.942, .941, .937);
    vec3 lColor = mix(lCool, lWarm, clamp(noise*.5+.5, 0., 1.));

    // dark mode: subtle bright/shadow on #111
    vec3 dLow  = vec3(.060, .060, .060);
    vec3 dHigh = vec3(.118, .112, .108);
    vec3 dColor = mix(dLow, dHigh, clamp(noise*.5+.5, 0., 1.));

    vec3 color = mix(lColor, dColor, uDark);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─── GLOBALS ─────────────────────────────────────────────────────────────────
let lenis;
let threeState = {};
let cursorX    = -300;   // start offscreen — no corner flash
let cursorY    = -300;
let followerX  = -300;
let followerY  = -300;
let scrollY    = 0;

const lerp        = (a, b, t) => a + (b - a) * t;
const smoothstep  = t => t * t * (3 - 2 * t);
const easeOutQuad = t => 1 - (1 - t) * (1 - t);

// Responsive helpers
const isTouch   = () => window.matchMedia('(hover: none), (pointer: coarse)').matches;
const isMobile  = () => window.innerWidth < 768;
let HW = 120; // half card width — updated on resize

function getHW()     { return isMobile() ? 80 : 120; }
function getPanelW() { return isMobile() ? window.innerWidth : Math.min(540, window.innerWidth); }

// DOM refs — must live here so tick() can access them from line 1
const cursorEl     = document.getElementById('cursor');
const headlineEl   = document.getElementById('headline');
const heroBtnsEl   = document.getElementById('heroBtns');
const overlayEl    = document.getElementById('colorOverlay');
const stageEl      = document.getElementById('stage');
const matiMenuEl  = document.getElementById('matiMenu');
const heroMsgEl    = document.getElementById('heroMessage');
const heroTaglineEl= document.getElementById('heroTagline');
const labSectionEl  = document.getElementById('labSection');
const darkOverlayEl = document.getElementById('darkOverlay');

let isDark      = false;
let isPanelOpen = false;

// ─── BOOT ────────────────────────────────────────────────────────────────────
// Cursor + RAF start immediately — no dependency on fonts
setupCursor();
tick(0);

// Everything else after fonts are ready
document.fonts.ready.then(() => {
  setupThree();
  setupLenis();
  setupCards();
  setupMagnetic();
  setupEffects();
  setupPanel();
  splitAndAnimateHeadline();
  setupDarkMode();
  setupClock();
  setupSectionNav();
  setupLabChips();
});

// ─── THREE.JS BACKGROUND ────────────────────────────────────────────────────
function setupThree() {
  const canvas   = document.getElementById('bg-canvas');
  const scene    = new THREE.Scene();
  const camera   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1); // keep it light — effect is blurry anyway
  renderer.setSize(window.innerWidth, window.innerHeight);

  const uniforms = {
    uTime:  { value: 0 },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uDark:  { value: 0.0 },
  };

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG })
  );
  scene.add(mesh);

  // Smooth mouse → shader
  document.addEventListener('mousemove', e => {
    gsap.to(uniforms.uMouse.value, {
      x: e.clientX / window.innerWidth,
      y: 1 - e.clientY / window.innerHeight,
      duration: 2.2,
      ease: 'power2.out',
    });
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    buildScatter();
    buildFanPos();
  });

  threeState = { renderer, scene, camera, uniforms, clock: new THREE.Clock() };
}

// ─── LENIS SMOOTH SCROLL ─────────────────────────────────────────────────────
function setupLenis() {
  lenis = new Lenis({
    duration: 1.4,
    easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    smoothTouch: false,   // native momentum on touch devices
    touchMultiplier: 1.5,
  });
  // scroll value is read directly in tick() — no event needed
}

// ─── CUSTOM CURSOR ───────────────────────────────────────────────────────────
function setupCursor() {
  if (isTouch()) return; // touch devices use native cursor

  const faceEl = document.getElementById('cursorFace');

  document.addEventListener('mousemove', e => {
    cursorX = e.clientX;
    cursorY = e.clientY;
  });

  // Hover: scale up
  document.querySelectorAll('a, button, [data-magnetic], .project-card').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
  });

  // Click: swap face
  document.addEventListener('mousedown', () => {
    faceEl.src = 'img/cursor-2.png';
    document.body.classList.remove('cur-hover');
    document.body.classList.add('cur-down');
  });
  document.addEventListener('mouseup', () => {
    faceEl.src = 'img/cursor-1.png';
    document.body.classList.remove('cur-down');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// HERO
// ═══════════════════════════════════════════════════════════════════════════════
function splitAndAnimateHeadline() {
  const el   = headlineEl;
  const text = el.getAttribute('aria-label') || el.textContent;
  el.innerHTML = '';
  el.style.opacity = '1';

  // Split chars for font-weight scroll — overflow visible so liquid isn't clipped
  text.split('').forEach(ch => {
    const clip  = document.createElement('span');
    const inner = document.createElement('span');
    clip.className    = 'char-clip';
    inner.className   = 'char-inner';
    inner.textContent = ch === ' ' ? ' ' : ch;
    clip.style.overflow = 'visible';
    clip.appendChild(inner);
    el.appendChild(clip);
  });

  // Nav + footer
  gsap.from('.navbar > *',      { y: -18, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out', delay: 0.1 });
  gsap.from('.site-footer > *', { y: 14,  opacity: 0, duration: 0.6, stagger: 0.1,  ease: 'power3.out', delay: 0.2 });

  // 1. Avatar appears
  gsap.to(heroMsgEl, { opacity: 1, duration: 0.45, ease: 'power2.out', delay: 0.35 });

  // 2. Type "Hi, this is my"
  const MSG   = 'Hi, this is my';
  const SPEED = 52;
  setTimeout(() => {
    heroTaglineEl.classList.add('typing');
    let i = 0;
    const iv = setInterval(() => {
      heroTaglineEl.textContent += MSG[i++];
      if (i >= MSG.length) {
        clearInterval(iv);
        setTimeout(() => heroTaglineEl.classList.remove('typing'), 650);
      }
    }, SPEED);
  }, 480);

  // 3. Liquid reveal after typing finishes
  const headlineDelay = 0.0;
  liquidReveal(el, headlineDelay);

  // 4. Buttons after liquid settles
  gsap.from('#heroBtns', { opacity: 0, y: 18, duration: 0.8, ease: 'power3.out', delay: headlineDelay + 1.6 });
}

// ─── LIQUID REVEAL ───────────────────────────────────────────────────────────
function liquidReveal(el, delaySeconds) {
  const ftDisp = document.getElementById('ft-disp');
  const ftTurb = document.getElementById('ft-turb');

  setTimeout(() => {
    // Start: fully liquid
    el.style.opacity = '0.0';
    el.style.filter  = 'url(#liquid-reveal) blur(6px)';

    const p = { scale: 110, blur: 6, opacity: 0, freq: 0.048 };

    gsap.to(p, {
      scale:   0,
      blur:    0,
      opacity: 1,
      freq:    0.012,
      duration: 2.4,
      ease:    'power2.inOut',
      onUpdate() {
        ftTurb.setAttribute('baseFrequency', p.freq.toFixed(4) + ' ' + (p.freq * 0.88).toFixed(4));
        ftDisp.setAttribute('scale', Math.max(0, p.scale).toFixed(1));
        el.style.opacity = p.opacity;
        el.style.filter  = p.scale > 0.8
          ? 'url(#liquid-reveal) blur(' + p.blur.toFixed(2) + 'px)'
          : 'none';
      },
      onComplete() {
        el.style.filter  = 'none';
        el.style.opacity = '1';
      }
    });
  }, delaySeconds * 1000);
}


// ═══════════════════════════════════════════════════════════════════════════════
// WORKS
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1 target: tight fan — rebuilt on resize
let fanPos = [];
function buildFanPos() {
  const s = isMobile() ? 0.55 : 1.0;
  fanPos = [
    { x: -155 * s, y: -15, rot: -12 },
    { x:  -60 * s, y:  12, rot:  -5 },
    { x:   28 * s, y:   0, rot:   2 },
    { x:  118 * s, y:  10, rot:   8 },
    { x:  208 * s, y: -12, rot:  14 },
  ];
  HW = getHW();
}

// Phase 2 target: scattered full-screen (built from vw/vh)
let scatterPos = [];
function buildScatter() {
  const vw = window.innerWidth, vh = window.innerHeight;
  scatterPos = [
    { x: -vw*.34, y: -vh*.23, rot: -20 },
    { x:  vw*.29, y: -vh*.27, rot:  16 },
    { x:  vw*.35, y:  vh*.16, rot:   7 },
    { x: -vw*.25, y:  vh*.21, rot: -13 },
    { x:  vw*.06, y: -vh*.19, rot:  -3 },
  ];
}
buildScatter();
buildFanPos();

const cardEls = ['pc0','pc1','pc2','pc3','pc4'].map(id => document.getElementById(id));

function setupCards() {
  // Click → open project URL
  cardEls.forEach(card => {
    const url = card.dataset.url;
    if (url) {
      card.addEventListener('click', () => window.open(url, '_blank'));
    }
  });

  // 3D tilt on hover
  cardEls.forEach(card => {
    const thumb = card.querySelector('.card-thumb');
    const shine = card.querySelector('.card-shine');

    card.addEventListener('mousemove', e => {
      const r = thumb.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width  - 0.5;
      const y = (e.clientY - r.top)  / r.height - 0.5;
      gsap.to(thumb, {
        rotateX: -y * 18,
        rotateY:  x * 18,
        transformPerspective: 900,
        duration: 0.35,
        ease: 'power2.out',
      });
      const px = ((e.clientX - r.left) / r.width  * 100).toFixed(1);
      const py = ((e.clientY - r.top)  / r.height * 100).toFixed(1);
      shine.style.background = `radial-gradient(circle at ${px}% ${py}%, rgba(255,255,255,0.11) 0%, transparent 62%)`;
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(thumb, {
        rotateX: 0, rotateY: 0,
        duration: 0.7,
        ease: 'elastic.out(1, 0.5)',
      });
    });
  });
}

// THRESHOLD: Works animation completes after scrolling this many px
const THRESHOLD     = () => window.innerHeight * 1.8;
// LAB appears after Works, over the next 0.8 viewport heights
const LAB_DURATION  = () => window.innerHeight * 0.8;
const getLabProgress = () =>
  Math.max(0, Math.min(1, (scrollY - THRESHOLD()) / LAB_DURATION()));

const navbarEl    = document.querySelector('.navbar');
const sectionNavEl = document.getElementById('sectionNav');

function updateLab(lp) {
  const t = smoothstep(lp);

  // 1. WebGL canvas darkens
  if (threeState.uniforms) {
    threeState.uniforms.uDark.value = Math.min(1, (isDark ? 1 : 0) + t);
  }

  // 2. Full-page dark overlay
  darkOverlayEl.style.opacity = lerp(0, 0.94, t);

  // 3. Nav + section indicator invert when background is dark enough
  navbarEl.classList.toggle('on-dark', lp > 0.45);
  sectionNavEl.classList.toggle('on-dark', lp > 0.45);

  // 4. LAB section — starts fading in at 20% progress
  labSectionEl.style.opacity      = smoothstep(Math.max(0, (lp - 0.2) / 0.8));
  labSectionEl.style.transform    = `translateY(${lerp(50, 0, easeOutQuad(lp))}px)`;
  labSectionEl.style.pointerEvents = lp >= 0.95 ? 'auto' : 'none';
}

function updateHeadline(progress) {
  const wt     = smoothstep(Math.min(1, progress / 0.55));
  const weight = Math.round(lerp(900, 100, wt));
  const ot     = smoothstep(Math.max(0, Math.min(1, (progress - 0.35) / 0.35)));
  const opacity = 1 - ot;

  headlineEl.style.fontWeight = weight;
  headlineEl.style.opacity    = opacity;
  heroMsgEl.style.opacity     = opacity;
  const btnOt = smoothstep(Math.max(0, Math.min(1, (progress - 0.25) / 0.30)));
  heroBtnsEl.style.opacity = 1 - btnOt;
}

function updateCards() {
  const progress    = Math.max(0, Math.min(1, scrollY / THRESHOLD()));
  const labProgress = getLabProgress();

  updateHeadline(progress);
  updateLab(labProgress);
  updateSectionNavActive(progress, labProgress);

  const P1 = 0.42;

  cardEls.forEach((el, i) => {
    const delay = Math.abs(i - 2) * 0.018;
    const p     = Math.max(0, Math.min(1, (progress - delay) / (1 - delay * 2)));

    const fan     = fanPos[i];
    const scatter = scatterPos[i];
    let x, y, rot, scale, opacity;

    if (p <= P1) {
      const t = smoothstep(p / P1);
      x       = lerp(-HW,        fan.x - HW, t);
      y       = lerp(420,        fan.y,       t);
      rot     = lerp(0,          fan.rot,     t);
      scale   = lerp(0.78,       1,           t);
      opacity = smoothstep(Math.min(1, (p / P1) * 1.6));
    } else {
      const t = easeOutQuad((p - P1) / (1 - P1));
      x       = lerp(fan.x - HW,  scatter.x - HW, t);
      y       = lerp(fan.y,        scatter.y,       t);
      rot     = lerp(fan.rot,      scatter.rot,     t);
      scale   = 1;
      opacity = 1;
    }

    // LAB transition: Works cards fly off upward
    if (labProgress > 0) {
      const lp = smoothstep(labProgress);
      y       += lerp(0, -window.innerHeight * 1.4, lp);
      opacity  = lerp(opacity, 0, smoothstep(Math.min(1, labProgress * 1.8)));
    }

    el.style.transform = `translateX(${x}px) translateY(${y}px) rotate(${rot}deg) scale(${scale})`;
    el.style.opacity   = opacity;
  });
}

// ─── MAGNETIC EFFECT ─────────────────────────────────────────────────────────
function setupMagnetic() {
  if (isTouch()) return; // no magnetic on touch
  document.querySelectorAll('[data-magnetic]').forEach(el => {
    el.addEventListener('mousemove', e => {
      const r  = el.getBoundingClientRect();
      const cx = r.left + r.width  / 2;
      const cy = r.top  + r.height / 2;
      gsap.to(el, {
        x: (e.clientX - cx) * 0.32,
        y: (e.clientY - cy) * 0.32,
        duration: 0.4,
        ease: 'power2.out',
      });
    });
    el.addEventListener('mouseleave', () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)' });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATIMENU
// ═══════════════════════════════════════════════════════════════════════════════
const PANEL_W = 540;

function openPanel() {
  isPanelOpen = true;

  // Panel + stage slide together — expo.out: arranca rápido, frena suave
  const pw = getPanelW();
  gsap.to(matiMenuEl, { x: 0,  duration: 0.72, ease: 'expo.out' });
  gsap.to(stageEl,    { x: pw, duration: 0.72, ease: 'expo.out' });

  // Contenido entra junto con el panel, sin delays grandes
  gsap.from('.panel-name span', { x: -16, opacity: 0, duration: 0.55, stagger: 0.06, delay: 0.05, ease: 'power3.out' });
  gsap.from('.panel-tag',       { opacity: 0, duration: 0.35, stagger: 0.03, delay: 0.12, ease: 'power2.out' });
  gsap.from('.panel-section',   { x: -12, opacity: 0, duration: 0.45, stagger: 0.05, delay: 0.1, ease: 'power3.out' });
}

function closePanel() {
  isPanelOpen = false;
  gsap.to(matiMenuEl, { x: '-100%', duration: 0.5, ease: 'expo.inOut' });
  gsap.to(stageEl,     { x: 0,       duration: 0.5, ease: 'expo.inOut' });
}

function setupPanel() {
  // GSAP owns the transform from the start — no CSS/GSAP conflict
  gsap.set(matiMenuEl, { x: '-100%' });
  gsap.set(stageEl,    { x: 0 });

  document.getElementById('navBrand').addEventListener('click', (e) => {
    e.stopPropagation();
    isPanelOpen ? closePanel() : openPanel();
  });
  document.getElementById('panelClose').addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });

  stageEl.addEventListener('click', () => { if (isPanelOpen) closePanel(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isPanelOpen) closePanel(); });
}

// ─── EFFECTS ─────────────────────────────────────────────────────────────────
function setupEffects() {
  const LIGHT = '#F4F3EE';
  const DARK  = '#111111';
  const fg    = () => isDark ? DARK  : LIGHT;  // contrasting foreground
  const bg    = () => isDark ? LIGHT : DARK;   // contrasting background

  const targets = [overlayEl, headlineEl, '.hero-btn'];

  headlineEl.addEventListener('mouseenter', () => {
    gsap.killTweensOf(targets);

    // Snap in — fast like a photographic negative flip
    gsap.to(overlayEl,   { opacity: 1,    duration: 0.07, ease: 'none' });
    gsap.to(headlineEl,  { color: fg(),   duration: 0.05 });
    gsap.to('.hero-btn', { color: fg(), borderColor: fg(), duration: 0.05 });
  });

  headlineEl.addEventListener('mouseleave', () => {
    gsap.killTweensOf(targets);

    // Release slightly slower — like film re-exposing
    gsap.to(overlayEl,   { opacity: 0, duration: 0.22, ease: 'power1.in' });
    gsap.to(headlineEl,  { color: bg(), duration: 0.18,
      onComplete: () => gsap.set(headlineEl, { clearProps: 'color' }) });
    gsap.to('.hero-btn', { color: bg(), borderColor: bg(), duration: 0.18,
      onComplete: () => gsap.set('.hero-btn', { clearProps: 'color,borderColor' }) });
  });
}

// ─── DARK MODE ───────────────────────────────────────────────────────────────
function setupDarkMode() {
  document.getElementById('darkToggle').addEventListener('click', () => {
    isDark = document.documentElement.classList.toggle('dark');
    gsap.to(threeState.uniforms.uDark, {
      value: isDark ? 1 : 0,
      duration: 0.9,
      ease: 'power2.inOut',
    });
  });
}

// ─── MENU ────────────────────────────────────────────────────────────────────

// ─── CLOCK ───────────────────────────────────────────────────────────────────
function setupClock() {
  function tick() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    const p = n => String(n).padStart(2, '0');
    document.getElementById('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ─── MAIN LOOP ───────────────────────────────────────────────────────────────
function tick(time) {
  requestAnimationFrame(tick);

  // Cursor — always runs, no dependencies
  followerX = lerp(followerX, cursorX, 0.12);
  followerY = lerp(followerY, cursorY, 0.12);
  cursorEl.style.transform = `translate(${followerX}px, ${followerY}px)`;

  // Lenis + cards (ready after fonts)
  if (lenis) {
    lenis.raf(time);
    scrollY = window.scrollY;
    updateCards();
  }

  // Three.js (ready after fonts)
  if (threeState.renderer) {
    const { renderer, scene, camera, uniforms, clock } = threeState;
    uniforms.uTime.value = clock.getElapsedTime();
    renderer.render(scene, camera);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// LAB CHIPS
// ═══════════════════════════════════════════════════════════════════════════════
function setupLabChips() {
  const chips   = document.querySelectorAll('.lab-chip');
  const content = document.getElementById('labContent');

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const isActive = chip.classList.contains('active');

      // Deactivate all chips + hide all panels
      chips.forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.lab-panel').forEach(p => p.classList.remove('visible'));

      if (isActive) {
        // Toggle off — collapse
        gsap.to(content, { height: 0, duration: 0.35, ease: 'power3.inOut' });
      } else {
        // Activate chip + show panel
        chip.classList.add('active');
        const panel = document.querySelector(`.lab-panel[data-panel="${chip.dataset.lab}"]`);
        if (panel) {
          panel.classList.add('visible');
          gsap.to(content, { height: 120, duration: 0.45, ease: 'power3.out' });
        }
      }
    });
  });
}

// ─── SECTION NAV ─────────────────────────────────────────────────────────────
function setupSectionNav() {
  document.querySelectorAll('.section-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      let target = 0;
      if (section === 'works') target = THRESHOLD() * 0.55;
      if (section === 'lab')   target = THRESHOLD() + LAB_DURATION() * 0.65;
      lenis.scrollTo(target, { duration: 1.6, easing: t => 1 - Math.pow(1 - t, 4) });
    });
  });
}

function updateSectionNavActive(progress, labProgress) {
  if (!sectionNavEl) return;
  const items = sectionNavEl.querySelectorAll('.section-nav-item');
  let active = 'home';
  if (labProgress >= 0.3)      active = 'lab';
  else if (progress >= 0.12)   active = 'works';
  items.forEach(item => {
    item.classList.toggle('active', item.dataset.section === active);
  });
}
