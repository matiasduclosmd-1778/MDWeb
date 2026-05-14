/* ─── MAIN.JS ───────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import Lenis from '@studio-freight/lenis';

gsap.registerPlugin(SplitText);

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
const heroParaWrapEl = document.getElementById('heroParaWrap');
const heroParaEl     = document.getElementById('heroPara');

const PARA_TEXT =
  "UX Designer discovering the world of development. Design experiments using Figma, AI and Adobe CC.";

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
  setupDarkMode();
  setupClock();
  setupSectionNav();
  setupLabChips();
  setupDitherReveal();
  setupIntro();              // mide headline → arranca animación de carga
  splitAndAnimateHeadline(); // corre inmediatamente BAJO el overlay (invisible)
  setupHeadlineWeightHover();
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

  // Pre-reserva altura final para que el flex layout no se mueva durante el typing
  heroParaEl.textContent = PARA_TEXT;
  heroParaWrapEl.style.minHeight = heroParaWrapEl.getBoundingClientRect().height + 'px';
  heroParaEl.textContent = '';

}

// ── Split-text: each char slides up from clip ────────────────────────────────
function _addParaChar(ch) {
  if (ch === '\n') {
    heroParaEl.appendChild(document.createElement('br'));
    return;
  }
  if (ch === ' ') {
    heroParaEl.appendChild(document.createTextNode('\u00A0'));
    return;
  }
  const clip  = document.createElement('span');
  const inner = document.createElement('span');
  clip.className  = 'para-char';
  inner.className = 'para-char-inner';
  inner.textContent = ch;
  clip.appendChild(inner);
  heroParaEl.appendChild(clip);
  gsap.fromTo(inner, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: 'power3.out' });
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
  const wt      = smoothstep(Math.min(1, progress / 0.55));
  const weight  = Math.round(lerp(900, 100, wt));
  const ot      = smoothstep(Math.max(0, Math.min(1, (progress - 0.35) / 0.35)));
  const opacity = 1 - ot;

  headlineEl.style.fontWeight  = weight;
  headlineEl.style.opacity     = opacity;
  heroMsgEl.style.opacity      = opacity;
  if (heroParaWrapEl) heroParaWrapEl.style.opacity = opacity;

  const btnOt = smoothstep(Math.max(0, Math.min(1, (progress - 0.25) / 0.30)));
  heroBtnsEl.style.opacity = 1 - btnOt;

}

// Para typing uses span-per-word system — scroll accel handled inside the timer

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
  // Headline hover: show scramble mask (handled in setupScrambleMask)
  // Buttons still get the analog inversion
  const LIGHT = '#F4F3EE';
  const DARK  = '#111111';
  const fg    = () => isDark ? DARK  : LIGHT;
  const bg    = () => isDark ? LIGHT : DARK;

  headlineEl.addEventListener('mouseenter', () => {
    gsap.killTweensOf(['.hero-btn']);
    gsap.to('.hero-btn', { color: fg(), borderColor: fg(), duration: 0.05 });
  });
  headlineEl.addEventListener('mouseleave', () => {
    gsap.killTweensOf(['.hero-btn']);
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

// ─── ANIMACION DE CARGA ──────────────────────────────────────────────────────
function setupIntro() {
  const overlay  = document.getElementById('intro-overlay');
  const creative = document.getElementById('intro-creative');
  const lab      = document.getElementById('intro-lab');

  if (!overlay) { splitAndAnimateHeadline(); return; }

  // Todo oculto desde el inicio (bajo el overlay)
  gsap.set('.navbar, .site-footer', { opacity: 0 });
  gsap.set([heroMsgEl, heroBtnsEl, heroParaWrapEl], { opacity: 0 });

  // Probe element: mide dónde quedarían las palabras en la posición exacta del headline
  const hlStyle = getComputedStyle(headlineEl);
  const hlRect  = headlineEl.getBoundingClientRect();

  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed', 'visibility:hidden', 'pointer-events:none',
    `top:${hlRect.top}px`, 'left:50%', 'transform:translateX(-50%)',
    `font-family:${hlStyle.fontFamily}`,
    `font-size:${hlStyle.fontSize}`,
    'font-weight:900',
    `letter-spacing:${hlStyle.letterSpacing}`,
    'text-transform:uppercase',
    'white-space:nowrap',
    `line-height:${hlStyle.lineHeight}`,
  ].join(';');
  probe.innerHTML = '<span id="_pc">CREATIVE</span> <span id="_pl">LAB.</span>';
  document.body.appendChild(probe);

  const tC = probe.querySelector('#_pc').getBoundingClientRect();
  const tL = probe.querySelector('#_pl').getBoundingClientRect();
  document.body.removeChild(probe);

  // Posiciones iniciales (esquinas)
  const cRect = creative.getBoundingClientRect();
  const lRect = lab.getBoundingClientRect();

  // Deltas totales (inicio → destino final)
  const cDX = tC.left - cRect.left;
  const cDY = tC.top  - cRect.top;
  const lDX = tL.left - lRect.left;
  const lDY = tL.top  - lRect.top;

  const tl = gsap.timeline({
    onComplete() {
      overlay.remove();

      const D = 0.4; // delay base

      // Navbar y footer
      gsap.fromTo('.navbar',
        { y: -24, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: D }
      );
      gsap.fromTo('.site-footer',
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: D + 0.05 }
      );

      // Hero elements — soft fade + ligero slide desde abajo
      gsap.fromTo(heroMsgEl,
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: D }
      );
      gsap.fromTo(heroBtnsEl,
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: D + 0.08 }
      );
      gsap.fromTo(heroParaWrapEl,
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: D + 0.12 }
      );

      // Typing — arranca al mismo tiempo que el fade
      setTimeout(() => {
        // Tagline "Hi, this is my"
        const MSG = 'Hi, this is my';
        heroTaglineEl.classList.add('typing');
        let ti = 0;
        const tiv = setInterval(() => {
          heroTaglineEl.textContent += MSG[ti++];
          if (ti >= MSG.length) {
            clearInterval(tiv);
            setTimeout(() => heroTaglineEl.classList.remove('typing'), 650);
          }
        }, 52);

        // Párrafo
        heroParaEl.classList.add('typing');
        let pi = 0;
        const piv = setInterval(() => {
          heroParaEl.textContent += PARA_TEXT[pi++];
          if (pi >= PARA_TEXT.length) {
            clearInterval(piv);
            setTimeout(() => heroParaEl.classList.remove('typing'), 650);
          }
        }, 52);
      }, D * 1000);
    },
  });

  // Peso tipográfico: 200 → 900 a lo largo de toda la animación
  tl.to([creative, lab], {
    fontWeight: 900,
    duration: 1.85,
    ease: 'power2.inOut',
  }, 0)

  // Fase 1 — convergencia vertical (CREATIVE baja, LAB. sube)
  .to(creative, { y: cDY, duration: 1.0, ease: 'power3.inOut' }, 0)
  .to(lab,      { y: lDY, duration: 1.0, ease: 'power3.inOut' }, 0)

  // Fase 2 — convergencia horizontal al centro del headline
  .to(creative, { x: cDX, duration: 0.85, ease: 'expo.inOut' }, 1.0)
  .to(lab,      { x: lDX, duration: 0.85, ease: 'expo.inOut' }, 1.0);
}

// ─── HEADLINE WEIGHT HOVER ───────────────────────────────────────────────────
function setupHeadlineWeightHover() {
  const wrap  = document.getElementById('headlineWrap');
  const chars = Array.from(headlineEl.querySelectorAll('.char-inner'));
  if (!wrap || !chars.length) return;

  const RADIUS = 110; // px — radio de influencia por letra

  // Cachea el centro de cada letra (se actualiza en resize)
  let rects = [];
  function cacheRects() {
    rects = chars.map(c => {
      const r = c.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
  }
  cacheRects();
  window.addEventListener('resize', cacheRects);

  wrap.addEventListener('mousemove', e => {
    chars.forEach((c, i) => {
      const dist = Math.hypot(e.clientX - rects[i].cx, e.clientY - rects[i].cy);
      const t      = Math.max(0, 1 - dist / RADIUS);          // 0=lejos  1=encima
      const weight = Math.round(lerp(900, 100, t * t));        // ease cuadrático

      gsap.to(c, {
        fontWeight: weight,
        duration: 0.3,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    });
  });

  wrap.addEventListener('mouseleave', () => {
    // Vuelven al peso actual del padre (scroll-based) y limpian override
    const parentW = parseFloat(headlineEl.style.fontWeight) || 900;
    chars.forEach(c => {
      gsap.to(c, {
        fontWeight: parentW,
        duration: 0.55,
        ease: 'power2.out',
        overwrite: 'auto',
        onComplete() { gsap.set(c, { clearProps: 'fontWeight' }); },
      });
    });
  });
}

// ─── DITHER REVEAL ───────────────────────────────────────────────────────────
function setupDitherReveal() {
  const canvas = document.createElement('canvas');
  canvas.id    = 'dither-canvas';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  // 8×8 Bayer ordered-dither matrix (values 0..63)
  const B = [
    [ 0,32, 8,40, 2,34,10,42],
    [48,16,56,24,50,18,58,26],
    [12,44, 4,36,14,46, 6,38],
    [60,28,52,20,62,30,54,22],
    [ 3,35,11,43, 1,33, 9,41],
    [51,19,59,27,49,17,57,25],
    [15,47, 7,39,13,45, 5,37],
    [63,31,55,23,61,29,53,21],
  ];

  const PIXEL = 5;   // dot grid pitch (px)
  const DOT   = 4;   // rendered dot size (gap of 1px between dots)
  const MAX_R = 52;  // circle radius → ~104px diameter

  let mx = 0, my = 0;   // raw mouse / touch target
  let sx = 0, sy = 0;   // smoothed position
  let sr = 0, tr = 0;   // smoothed / target radius
  let snapped = false;  // avoid slide-in from (0,0) on first move

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Mouse tracking
  document.addEventListener('mousemove', e => {
    if (!snapped) { sx = e.clientX; sy = e.clientY; snapped = true; }
    mx = e.clientX;
    my = e.clientY;
    tr = MAX_R;
  });
  document.addEventListener('mouseleave', () => { tr = 0; });

  // Touch: tap-drag reveals the effect
  document.addEventListener('touchstart', e => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY;
    mx = t.clientX; my = t.clientY;
    tr = MAX_R; snapped = true;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    const t = e.touches[0];
    mx = t.clientX; my = t.clientY;
    tr = MAX_R;
  }, { passive: true });
  document.addEventListener('touchend',    () => { tr = 0; });
  document.addEventListener('touchcancel', () => { tr = 0; });

  let lastAlpha = -1;
  let time = 0;

  function draw() {
    time += 0.055;

    // Softer lerp → smoother, more fluid cursor feel
    sx += (mx - sx) * 0.07;
    sy += (my - sy) * 0.07;
    sr += (tr - sr) * 0.07;

    // Trail fade: destination-out erases existing dots ~10% per frame.
    // Sparse-edge dots vanish first → trail appears to "close inward" naturally.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    // Fade canvas out as hero scrolls away (mirrors updateHeadline timing)
    const THR      = window.innerHeight * 1.8;
    const progress = Math.min(1, scrollY / THR);
    const alpha    = 1 - smoothstep(Math.max(0, Math.min(1, (progress - 0.35) / 0.35)));
    if (Math.abs(alpha - lastAlpha) > 0.004) {
      canvas.style.opacity = alpha;
      lastAlpha = alpha;
    }

    if (sr > 0.5 && alpha > 0.01) {
      const r  = sr;
      const c0 = Math.floor((sx - r) / PIXEL) - 1;
      const c1 = Math.ceil ((sx + r) / PIXEL) + 1;
      const r0 = Math.floor((sy - r) / PIXEL) - 1;
      const r1 = Math.ceil ((sy + r) / PIXEL) + 1;

      ctx.fillStyle = isDark ? '#eeeeee' : '#111111';

      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const cx   = col * PIXEL + PIXEL * 0.5;
          const cy   = row * PIXEL + PIXEL * 0.5;
          const dist = Math.hypot(cx - sx, cy - sy);
          if (dist >= r) continue;

          const density = 1 - dist / r;
          const bayer   = B[((row % 8) + 8) % 8][((col % 8) + 8) % 8] / 64;
          const wave    = Math.sin(time - dist / 12) * 0.26;

          if (density > bayer + wave) ctx.fillRect(col * PIXEL, row * PIXEL, DOT, DOT);
        }
      }
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}
