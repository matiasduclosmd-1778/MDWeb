/* ─── MAIN.JS ───────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import Lenis from '@studio-freight/lenis';
import rawSkill from '../WCAG-AA-SKILL-PROMPT.md?raw';

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
let scrollY       = 0;
let prevScrollY   = 0;
let headlineDrift = 0;

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
const stageEl      = document.getElementById('stage');
const matiMenuEl  = document.getElementById('matiMenu');
const heroMsgEl    = document.getElementById('heroMessage');
const heroTaglineEl= document.getElementById('heroTagline');
const labSectionEl    = document.getElementById('labSection');
const accessSectionEl = document.getElementById('accessSection');
const darkOverlayEl = document.getElementById('darkOverlay');
const headlineWrapEl = document.getElementById('headlineWrap');
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
  setupPanel();
  setupDarkMode();
  setupClock();
  setupSectionNav();
  setupLabChips();
  setupLabParticles();
  setupAccessSection();
  setupDitherReveal();
  splitAndAnimateHeadline(); // split primero para que setupIntro mida los chars reales
  setupIntro();              // mide headline → arranca animación de carga
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
const THRESHOLD      = () => window.innerHeight * 1.8;
// LAB appears after Works, over the next 0.8 viewport heights
const LAB_DURATION   = () => window.innerHeight * 0.8;
const getLabProgress = () =>
  Math.max(0, Math.min(1, (scrollY - THRESHOLD()) / LAB_DURATION()));
// ACCESS panel scroll trigger — fires after Lab is fully visible
const ACCESS_START   = () => THRESHOLD() + LAB_DURATION() + window.innerHeight * 0.5;
const getAccessProgress = () =>
  Math.max(0, Math.min(1, (scrollY - ACCESS_START()) / (window.innerHeight * 0.25)));

const navbarEl    = document.querySelector('.navbar');
const sectionNavEl = document.getElementById('sectionNav');

// ─── LAB PARTICLES ───────────────────────────────────────────────────────────
let _labParticles      = null;
let _labParticlesOn    = false;

function setupLabParticles() {
  if (isTouch()) return;

  const titleEl = labSectionEl.querySelector('.lab-title');
  if (!titleEl) return;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;';
  labSectionEl.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  const RADIUS  = 50;
  const SPRING  = 0.042;
  const DRAG    = 0.91;
  const PUSH    = 18;
  const PERTURB = 0.6;

  // Displacement field: grilla de vectores 2D que evoluciona lentamente
  const GCOLS = 16;
  const GROWS = 16;
  let dispGrid   = [];
  let dispTarget = [];
  let dispFrame  = 0;

  function buildDispGrid() {
    dispGrid   = [];
    dispTarget = [];
    for (let r = 0; r <= GROWS; r++) {
      dispGrid[r]   = [];
      dispTarget[r] = [];
      for (let c = 0; c <= GCOLS; c++) {
        let a = Math.random() * Math.PI * 2;
        dispGrid[r][c] = { x: Math.cos(a), y: Math.sin(a) };
        a = Math.random() * Math.PI * 2;
        dispTarget[r][c] = { x: Math.cos(a), y: Math.sin(a) };
      }
    }
  }

  function evolveDisp() {
    dispFrame++;
    // Cada ~3s rota algunos vectores objetivo
    if (dispFrame % 180 === 0) {
      for (let r = 0; r <= GROWS; r++) {
        for (let c = 0; c <= GCOLS; c++) {
          if (Math.random() < 0.25) {
            const a = Math.random() * Math.PI * 2;
            dispTarget[r][c] = { x: Math.cos(a), y: Math.sin(a) };
          }
        }
      }
    }
    for (let r = 0; r <= GROWS; r++) {
      for (let c = 0; c <= GCOLS; c++) {
        const g = dispGrid[r][c];
        const t = dispTarget[r][c];
        g.x += (t.x - g.x) * 0.006;
        g.y += (t.y - g.y) * 0.006;
      }
    }
  }

  function sampleDisp(px, py, W, H) {
    const gx = Math.max(0, Math.min((px / W) * GCOLS, GCOLS - 0.001));
    const gy = Math.max(0, Math.min((py / H) * GROWS, GROWS - 0.001));
    const ic = Math.floor(gx);
    const ir = Math.floor(gy);
    const fx = gx - ic;
    const fy = gy - ir;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = dispGrid[ir][ic];
    const b = dispGrid[ir][ic + 1];
    const c = dispGrid[ir + 1][ic];
    const d = dispGrid[ir + 1][ic + 1];
    return {
      x: (a.x + (b.x - a.x) * ux) * (1 - uy) + (c.x + (d.x - c.x) * ux) * uy,
      y: (a.y + (b.y - a.y) * ux) * (1 - uy) + (c.y + (d.y - c.y) * ux) * uy,
    };
  }

  const originOffset = { y: 0 }; // animado por GSAP para desplazar suavemente los orígenes

  let particles = [];
  let mouse     = { x: -9999, y: -9999 };
  let rafId     = null;

  function build() {
    const W   = window.innerWidth;
    const H   = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = W;
    canvas.height = H;

    const rect  = titleEl.getBoundingClientRect();
    const style = getComputedStyle(titleEl);
    const fs    = parseFloat(style.fontSize);
    const lh    = fs * 0.9;
    const cx    = W / 2;
    const cy    = rect.top + rect.height / 2;

    const PW = W * dpr;
    const PH = H * dpr;
    const off  = document.createElement('canvas');
    off.width  = PW;
    off.height = PH;
    const octx = off.getContext('2d');
    octx.scale(dpr, dpr);
    octx.fillStyle    = '#fff';
    octx.font         = `900 ${fs}px 'Geist Mono', monospace`;
    octx.textAlign    = 'center';
    octx.textBaseline = 'middle';
    if ('letterSpacing' in octx) octx.letterSpacing = `${-0.025 * fs}px`;
    octx.fillText('EXPERIMENTAL', cx, cy - lh * 0.58);
    octx.fillText('SYSTEMS',      cx, cy + lh * 0.52);

    const data = octx.getImageData(0, 0, PW, PH).data;
    particles  = [];
    for (let py = 0; py < PH; py += dpr) {
      for (let px = 0; px < PW; px += dpr) {
        if (data[(py * PW + px) * 4 + 3] > 60) {
          const x = px / dpr;
          const y = py / dpr;
          particles.push({ x, y, ox: x, oy: y, vx: 0, vy: 0 });
        }
      }
    }
    buildDispGrid();
  }

  function loop() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#F4F3EE';

    evolveDisp();

    for (const p of particles) {
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const d  = Math.hypot(dx, dy);

      // Área de influencia ampliada para acomodar el blob
      if (d < RADIUS * 1.6 && d > 0) {
        const disp = sampleDisp(p.x, p.y, W, H);
        // El displacement distorsiona la distancia efectiva → blob orgánico, no círculo
        const effD = d - (disp.x + disp.y) * RADIUS * 0.38;
        const f    = effD < RADIUS ? Math.exp(-3 * (Math.max(0, effD) / RADIUS) ** 2) : 0;
        if (f > 0.008) {
          const dirX = dx / d + disp.x * PERTURB;
          const dirY = dy / d + disp.y * PERTURB;
          const len  = Math.hypot(dirX, dirY) || 1;
          p.vx += (dirX / len) * f * PUSH;
          p.vy += (dirY / len) * f * PUSH;
        }
      }

      // Spring: se suprime cuando el origen está bajo el cursor (evita la órbita)
      const dox = p.ox - mouse.x;
      const doy = (p.oy + originOffset.y) - mouse.y;
      const springScale = Math.min(1, Math.hypot(dox, doy) / RADIUS);
      p.vx += (p.ox - p.x) * SPRING * springScale;
      p.vy += ((p.oy + originOffset.y) - p.y) * SPRING * springScale;
      p.vx *= DRAG;
      p.vy *= DRAG;
      p.x  += p.vx;
      p.y  += p.vy;

      ctx.fillRect(p.x, p.y, 1, 1);
    }

    rafId = requestAnimationFrame(loop);
  }

  _labParticles = {
    activate() {
      build();
      titleEl.style.opacity = '0';
      titleEl.style.transition = 'none';
      loop();
    },
    deactivate() {
      cancelAnimationFrame(rafId);
      rafId = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      titleEl.style.opacity   = '';
      titleEl.style.transition = '';
      particles = [];
    },
    shiftOrigins(dy, duration, ease) {
      gsap.to(originOffset, { y: dy, duration, ease });
    },
  };

  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('resize',    ()  => { if (_labParticlesOn) build(); });
}

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

  // 5. Particles — activar cuando lab está completamente visible
  if (_labParticles) {
    if (lp >= 0.99 && !_labParticlesOn) {
      _labParticlesOn = true;
      _labParticles.activate();
    } else if (lp < 0.95 && _labParticlesOn) {
      _labParticlesOn = false;
      _labParticles.deactivate();
    }
  }
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

  // Magnetic scroll drift — headline resiste el scroll y vuelve suave
  const vel    = scrollY - prevScrollY;
  prevScrollY  = scrollY;
  headlineDrift = lerp(headlineDrift, vel, 0.1);
  headlineEl.style.transform = `translateY(${(headlineDrift * -0.28).toFixed(2)}px)`;
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
  if (isTouch()) return;

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

  // Headline — magnetic muy suave + contraste de cursor
  headlineWrapEl.addEventListener('mouseenter', () => document.body.classList.add('cur-headline'));
  headlineWrapEl.addEventListener('mouseleave', () => document.body.classList.remove('cur-headline'));

  headlineWrapEl.addEventListener('mousemove', e => {
    const r  = headlineWrapEl.getBoundingClientRect();
    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;
    gsap.to(headlineWrapEl, {
      x: (e.clientX - cx) * 0.07,
      y: (e.clientY - cy) * 0.07,
      duration: 0.6,
      ease: 'power2.out',
    });
  });
  headlineWrapEl.addEventListener('mouseleave', () => {
    gsap.to(headlineWrapEl, { x: 0, y: 0, duration: 1.2, ease: 'elastic.out(1, 0.35)' });
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
  gsap.to(stageEl,    { x: 0,       duration: 0.5, ease: 'expo.inOut' });
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

// ─── CLOCK ───────────────────────────────────────────────────────────────────
function setupClock() {
  function clockTick() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    const p = n => String(n).padStart(2, '0');
    document.getElementById('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  clockTick();
  setInterval(clockTick, 1000);
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
// ─── ACCESSIBILITY SECTION ───────────────────────────────────────────────────
function openAccessSection() {
  accessSectionEl.style.pointerEvents = 'auto';
  document.body.classList.add('access-open');
  gsap.to(accessSectionEl, { xPercent: 0, opacity: 1, duration: 0.75, ease: 'expo.out' });
}

function closeAccessSection() {
  accessSectionEl.style.pointerEvents = 'none';
  document.body.classList.remove('access-open');
  gsap.to(accessSectionEl, { xPercent: 100, opacity: 0, duration: 0.6, ease: 'expo.inOut' });
}

function setupAccessSection() {
  gsap.set(accessSectionEl, { xPercent: 100, opacity: 0 });

  document.getElementById('accessBack').addEventListener('click', closeAccessSection);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && accessSectionEl.style.pointerEvents === 'auto') closeAccessSection(); });

  // ── i18n ─────────────────────────────────────────────────────────────────
  const STRINGS = {
    es: {
      'nav.skip': 'Ir al contenido',
      'nav.back': 'Volver',
      'nav.sectionAriaLabel': 'Playground de accesibilidad web',
      'hero.tag': '#Lab · Accesibilidad',
      'hero.h1a': 'Accesibilidad',
      'hero.h1b': 'importante',
      'hero.lead': 'Siete estaciones interactivas para entender por qué el diseño accesible es simplemente mejor diseño.',
      'hero.stat1num': '1 de 6',
      'hero.stat1lbl': 'personas viven con alguna discapacidad',
      'hero.stat2num': '71%',
      'hero.stat2lbl': 'de usuarios con discapacidad abandona sitios inaccesibles',
      'hero.stat3num': '96%',
      'hero.stat3lbl': 'de homepages tienen al menos un error WCAG detectable',
      'hero.stat3src': 'WebAIM Million · 2024',
      'c01.num': '01',
      'c01.title': 'Contraste de color',
      'c01.desc': 'El contraste de color es la falla de accesibilidad más común. WCAG 2.1 requiere 4.5:1 para texto normal (AA) y 7:1 para nivel mejorado (AAA). El ratio 3:1 aplica a texto grande (≥18pt) y componentes UI.',
      'c01.fg': 'Color de texto',
      'c01.bg': 'Color de fondo',
      'c01.presets': 'Presets rápidos',
      'c01.preset1': 'Negro sobre crema · Pasa AAA',
      'c01.preset2': 'Gris medio · Falla AA',
      'c01.preset3': 'Amarillo sobre blanco · Falla',
      'c01.preset4': 'Azul sistema · Pasa AA',
      'c01.ratioLabel': 'ratio de contraste',
      'c01.more': 'Leer más texto',
      'c01.less': 'Menos texto',
      'c01.previewText': 'El diseño accesible beneficia a todos. Los textos con bajo contraste son difíciles de leer bajo luz solar directa, para personas con baja visión, o con ojos cansados. No es solo para usuarios con discapacidad.',
      'c01.tip': 'Tip: el gris claro sobre blanco es la falla más común. Si dudás, oscurecé el texto.',
      'c02.num': '02',
      'c02.title': 'Áreas táctiles',
      'c02.desc': 'WCAG 2.5.5 (AAA) requiere que los elementos interactivos sean de al menos 44×44 px. WCAG 2.5.8 (AA, versión 2.2) pide 24px. Objetivos pequeños causan errores, especialmente en dispositivos táctiles o con temblor.',
      'c02.sliderLabel': 'Tamaño del objetivo',
      'c02.hitsLabel': 'Aciertos',
      'c02.attemptsLabel': 'Intentos',
      'c02.accuracyLabel': 'Precisión',
      'c02.reset': 'Reiniciar',
      'c02.dotAriaLabel': 'Objetivo: toca aquí para anotar un punto',
      'c02.areaAriaLabel': 'Área de juego — haz clic en el punto para acertar, fuera para errar',
      'c02.hint': 'Verde = cumple WCAG (≥44px) · Rojo = no cumple. Probá con el tamaño más chico.',
      'c03.num': '03',
      'c03.title': 'Tipografía legible',
      'c03.desc': 'WCAG 1.4.4 requiere que el texto pueda escalarse al 200% sin pérdida de contenido. WCAG 1.4.8 establece guías de interlineado, ancho de columna y espaciado. Una tipografía accesible mejora la lectura para todos.',
      'c03.fsLabel': 'Tamaño de cuerpo',
      'c03.lhLabel': 'Interlineado',
      'c03.cwLabel': 'Ancho de columna',
      'c03.lsLabel': 'Espaciado de letras',
      'c03.reset': 'Restaurar valores',
      'c03.previewLabel': 'Vista previa del texto',
      'c03.previewText': 'El cuerpo del texto debe ser legible en condiciones reales de uso. La tipografía accesible no es una opción estética, es un requisito funcional. Un buen tamaño, interlineado generoso y columna de ancho moderado reducen la carga cognitiva y mejoran la comprensión.',
      'c04.num': '04',
      'c04.title': 'Lectores de pantalla',
      'c04.desc': 'Los lectores de pantalla anuncian elementos usando texto alternativo, labels y HTML semántico. La diferencia entre un label vago y uno descriptivo es la diferencia entre confusión y claridad.',
      'c04.rateLabel': 'Velocidad de lectura',
      'c04.voiceLabel': 'Voz del sistema',
      'c04.listenBtn': 'Escuchar',
      'c04.stopBtn': 'Detener',
      'c04.badBtn': 'Malo',
      'c04.goodBtn': 'Bueno',
      'c04.card1title': 'Botón sin descripción',
      'c04.card1sr': 'botón',
      'c04.card1explain': 'Sin aria-label, el lector anuncia solo "botón". ¿Botón de qué? El usuario no puede saber.',
      'c04.card2title': 'Botón con aria-label',
      'c04.card2sr': 'Ir al carrito de compras, 3 artículos',
      'c04.card2explain': 'aria-label describe la acción específica. El usuario entiende el propósito sin ver la pantalla.',
      'c04.card3title': 'Imagen sin alt',
      'c04.card3sr': 'imagen sin descripción',
      'c04.card3explain': 'Sin atributo alt, el lector omite la imagen o lee el nombre del archivo. Información perdida.',
      'c04.card4title': 'Imagen con alt descriptivo',
      'c04.card4sr': 'Fotografía de un escritorio minimalista con laptop, libreta y café',
      'c04.card4explain': 'alt describe el contenido, no "imagen de" (eso es redundante). Incluir la información que aporta la imagen.',
      'c04.srReads': 'El lector anuncia:',
      'c05.num': '05',
      'c05.title': 'Navegación por teclado',
      'c05.desc': 'Todos los elementos interactivos deben ser accesibles con teclado. WCAG 2.4.7 requiere un indicador de foco visible. Remover el outline sin reemplazarlo rompe la navegación para usuarios de teclado y tecnologías asistivas.',
      'c05.toggleLabel': 'Focus visible',
      'c05.on': 'ON',
      'c05.off': 'OFF',
      'c05.hint': 'Usá Tab para avanzar · Shift+Tab para retroceder · Enter/Espacio para activar. Desactivá el focus para ver el impacto.',
      'c05.formName': 'Nombre',
      'c05.formEmail': 'Email',
      'c05.formPref': 'Preferencia de contacto',
      'c05.formOpt1': 'Email',
      'c05.formOpt2': 'Teléfono',
      'c05.formOpt3': 'WhatsApp',
      'c05.formCheck': 'Acepto recibir novedades',
      'c05.formSubmit': 'Enviar',
      'c05.formCancel': 'Cancelar',
      'c06.num': '06',
      'c06.title': 'Texto alternativo',
      'c06.desc': 'El atributo alt describe el contenido o función de una imagen para usuarios que no pueden verla. Buenas reglas: imágenes informativas describen su contenido; imágenes decorativas usan alt vacío; imágenes funcionales describen su acción.',
      'c06.colCase': 'Caso',
      'c06.colBad': 'Alt incorrecto',
      'c06.colGood': 'Alt correcto',
      'c06.row1case': 'Foto de producto (e-commerce)',
      'c06.row1bad': 'alt="imagen"',
      'c06.row1good': 'alt="Zapatilla running blanca, suela azul, talle 42"',
      'c06.row2case': 'Logo (enlace al inicio)',
      'c06.row2bad': 'alt="logo.png"',
      'c06.row2good': 'alt="1778 Studio — volver al inicio"',
      'c06.row3case': 'Imagen decorativa',
      'c06.row3bad': 'alt="separador decorativo con líneas"',
      'c06.row3good': 'alt="" (vacío — el lector la omite)',
      'c06.row4case': 'Gráfico de datos',
      'c06.row4bad': 'alt="gráfico"',
      'c06.row4good': 'alt="Gráfico de barras: ventas crecieron 40% en Q4 2024 vs Q4 2023"',
      'c07.num': '07',
      'c07.title': 'Movimiento reducido',
      'c07.desc': 'El movimiento excesivo puede causar náuseas o convulsiones en personas con trastornos vestibulares, migraña, epilepsia fotosensible o autismo. WCAG 2.3.3 (AAA) requiere una forma de detener animaciones no esenciales.',
      'c07.toggleLabel': 'Reducir movimiento',
      'c07.systemLabel': 'Detección del sistema',
      'c07.systemReduced': 'Preferencia del sistema: reducir',
      'c07.systemNormal': 'Preferencia del sistema: normal',
      'c07.codeLabel': 'Media query CSS:',
      'footer.quote': 'La accesibilidad no es una función — es el fundamento del buen diseño.',
    },
    en: {
      'nav.skip': 'Skip to content',
      'nav.back': 'Back',
      'nav.sectionAriaLabel': 'Web accessibility playground',
      'hero.tag': '#Lab · Accessibility',
      'hero.h1a': 'Accessibility',
      'hero.h1b': 'matters',
      'hero.lead': 'Seven interactive stations to understand why accessible design is simply better design.',
      'hero.stat1num': '1 in 6',
      'hero.stat1lbl': 'people live with some form of disability',
      'hero.stat2num': '71%',
      'hero.stat2lbl': 'of users with disabilities leave inaccessible sites',
      'hero.stat3num': '96%',
      'hero.stat3lbl': 'of homepages have at least one detectable WCAG failure',
      'hero.stat3src': 'WebAIM Million · 2024',
      'c01.num': '01',
      'c01.title': 'Color Contrast',
      'c01.desc': 'Color contrast is the single most common WCAG failure. WCAG 2.1 requires 4.5:1 for normal text (AA) and 7:1 for enhanced (AAA). A 3:1 ratio applies to large text (≥18pt) and UI components.',
      'c01.fg': 'Text color',
      'c01.bg': 'Background color',
      'c01.presets': 'Quick presets',
      'c01.preset1': 'Black on cream · Passes AAA',
      'c01.preset2': 'Mid grey · Fails AA',
      'c01.preset3': 'Yellow on white · Fails',
      'c01.preset4': 'System blue · Passes AA',
      'c01.ratioLabel': 'contrast ratio',
      'c01.more': 'Read more',
      'c01.less': 'Read less',
      'c01.previewText': 'Accessible design benefits everyone. Low-contrast text is hard to read in direct sunlight, for people with low vision, or with tired eyes. It\'s not only for users with disabilities.',
      'c01.tip': 'Tip: light grey on white is the most common failure. When in doubt, darken your text.',
      'c02.num': '02',
      'c02.title': 'Touch targets',
      'c02.desc': 'WCAG 2.5.5 (AAA) requires interactive elements to be at least 44×44 px. WCAG 2.5.8 (AA, version 2.2) sets 24px minimum. Small targets cause errors — especially on touch or for users with tremors.',
      'c02.sliderLabel': 'Target size',
      'c02.hitsLabel': 'Hits',
      'c02.attemptsLabel': 'Attempts',
      'c02.accuracyLabel': 'Accuracy',
      'c02.reset': 'Reset',
      'c02.dotAriaLabel': 'Target: click here to score a hit',
      'c02.areaAriaLabel': 'Game area — click the dot to hit, anywhere else to miss',
      'c02.hint': 'Green = meets WCAG (≥44px) · Red = does not. Try the smallest size.',
      'c03.num': '03',
      'c03.title': 'Readable typography',
      'c03.desc': 'WCAG 1.4.4 requires text to be resizable up to 200% without loss of content. WCAG 1.4.8 provides guidelines for line height, column width, and spacing. Accessible typography benefits all readers.',
      'c03.fsLabel': 'Font size',
      'c03.lhLabel': 'Line height',
      'c03.cwLabel': 'Column width',
      'c03.lsLabel': 'Letter spacing',
      'c03.reset': 'Reset to defaults',
      'c03.previewLabel': 'Text preview',
      'c03.previewText': 'Body text must be readable in real conditions. Accessible typography is not an aesthetic choice — it is a functional requirement. Good size, generous line height, and a moderate column width reduce cognitive load and improve comprehension.',
      'c04.num': '04',
      'c04.title': 'Screen readers',
      'c04.desc': 'Screen readers announce elements using alt text, labels, and semantic HTML. The difference between a vague and a clear label is the difference between confusion and understanding.',
      'c04.rateLabel': 'Reading speed',
      'c04.voiceLabel': 'System voice',
      'c04.listenBtn': 'Listen',
      'c04.stopBtn': 'Stop',
      'c04.badBtn': 'Bad',
      'c04.goodBtn': 'Good',
      'c04.card1title': 'Button without description',
      'c04.card1sr': 'button',
      'c04.card1explain': 'Without aria-label, the reader only says "button". Button for what? The user cannot know.',
      'c04.card2title': 'Button with aria-label',
      'c04.card2sr': 'Go to shopping cart, 3 items',
      'c04.card2explain': 'aria-label describes the specific action. The user understands the purpose without seeing the screen.',
      'c04.card3title': 'Image without alt',
      'c04.card3sr': 'image without description',
      'c04.card3explain': 'Without an alt attribute, the reader skips the image or reads the filename. Information is lost.',
      'c04.card4title': 'Image with descriptive alt',
      'c04.card4sr': 'Photograph of a minimalist desk with laptop, notebook and coffee',
      'c04.card4explain': 'alt describes the content — not "image of" (that\'s redundant). Include the information the image conveys.',
      'c04.srReads': 'The reader announces:',
      'c05.num': '05',
      'c05.title': 'Keyboard navigation',
      'c05.desc': 'All interactive elements must be operable with a keyboard. WCAG 2.4.7 requires a visible focus indicator. Removing the outline without a replacement breaks navigation for keyboard users and assistive technologies.',
      'c05.toggleLabel': 'Focus visible',
      'c05.on': 'ON',
      'c05.off': 'OFF',
      'c05.hint': 'Use Tab to advance · Shift+Tab to go back · Enter/Space to activate. Disable focus to see the impact.',
      'c05.formName': 'Name',
      'c05.formEmail': 'Email',
      'c05.formPref': 'Contact preference',
      'c05.formOpt1': 'Email',
      'c05.formOpt2': 'Phone',
      'c05.formOpt3': 'WhatsApp',
      'c05.formCheck': 'I agree to receive news',
      'c05.formSubmit': 'Submit',
      'c05.formCancel': 'Cancel',
      'c06.num': '06',
      'c06.title': 'Alternative text',
      'c06.desc': 'The alt attribute describes the content or function of an image for users who cannot see it. Good rules: informative images describe their content; decorative images use empty alt; functional images describe their action.',
      'c06.colCase': 'Case',
      'c06.colBad': 'Bad alt',
      'c06.colGood': 'Good alt',
      'c06.row1case': 'Product photo (e-commerce)',
      'c06.row1bad': 'alt="image"',
      'c06.row1good': 'alt="White running shoe, blue sole, size 9"',
      'c06.row2case': 'Logo (homepage link)',
      'c06.row2bad': 'alt="logo.png"',
      'c06.row2good': 'alt="1778 Studio — go to homepage"',
      'c06.row3case': 'Decorative image',
      'c06.row3bad': 'alt="decorative lines separator"',
      'c06.row3good': 'alt="" (empty — the reader skips it)',
      'c06.row4case': 'Data chart',
      'c06.row4bad': 'alt="chart"',
      'c06.row4good': 'alt="Bar chart: sales grew 40% in Q4 2024 vs Q4 2023"',
      'c07.num': '07',
      'c07.title': 'Reduced motion',
      'c07.desc': 'Excessive motion can cause nausea or seizures for people with vestibular disorders, migraines, photosensitive epilepsy, or autism. WCAG 2.3.3 (AAA) requires a way to disable non-essential animations.',
      'c07.toggleLabel': 'Reduce motion',
      'c07.systemLabel': 'System detection',
      'c07.systemReduced': 'System preference: reduce',
      'c07.systemNormal': 'System preference: no-preference',
      'c07.codeLabel': 'CSS media query:',
      'footer.quote': 'Accessibility is not a feature — it is the foundation of great design.',
    }
  };

  let currentLang = 'es';

  function applyLang(lang) {
    currentLang = lang;

    // Update section aria-label
    const section = document.getElementById('accessSection');
    if (section && STRINGS[lang]['nav.sectionAriaLabel']) {
      section.setAttribute('aria-label', STRINGS[lang]['nav.sectionAriaLabel']);
    }

    // Update all text nodes
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (STRINGS[lang][key] !== undefined) el.textContent = STRINGS[lang][key];
    });

    // Update aria-labels
    document.querySelectorAll('[data-i18n-label]').forEach(el => {
      const key = el.dataset.i18nLabel;
      if (STRINGS[lang][key] !== undefined) el.setAttribute('aria-label', STRINGS[lang][key]);
    });

    // Update lang buttons aria-pressed
    document.querySelectorAll('.ac-lang-btn').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false');
    });

    // Update voice listen buttons speak text and aria-label
    document.querySelectorAll('.ac-listen-btn').forEach(btn => {
      const speakKey = lang === 'es' ? 'data-speak-es' : 'data-speak-en';
      const speakText = btn.getAttribute(speakKey);
      if (speakText) {
        const listenLabel = STRINGS[lang]['c04.listenBtn'] || 'Listen';
        btn.setAttribute('aria-label', listenLabel + ': ' + speakText);
      }
    });

    // Update voice card good button demo aria-label
    const goodBtnDemo = document.querySelector('.ac-voice-card[data-quality="good"] .ac-demo-element');
    if (goodBtnDemo) {
      goodBtnDemo.setAttribute('aria-label', lang === 'es'
        ? 'Ir al carrito de compras, 3 artículos'
        : 'Go to shopping cart, 3 items');
    }

    // Update focus toggle label
    const focusLabel = document.getElementById('acFocusLabel');
    const focusToggle = document.getElementById('acFocusToggle');
    if (focusLabel && focusToggle) {
      const pressed = focusToggle.getAttribute('aria-pressed') === 'true';
      focusLabel.textContent = pressed ? STRINGS[lang]['c05.on'] : STRINGS[lang]['c05.off'];
    }

    // Update motion toggle label
    const motionLabel = document.getElementById('acMotionLabel');
    const motionToggle = document.getElementById('acMotionToggle');
    if (motionLabel && motionToggle) {
      const pressed = motionToggle.getAttribute('aria-pressed') === 'true';
      motionLabel.textContent = pressed ? STRINGS[lang]['c05.on'] : STRINGS[lang]['c05.off'];
    }
  }

  // Lang button listeners
  document.querySelectorAll('.ac-lang-btn').forEach(btn => {
    btn.addEventListener('click', () => applyLang(btn.dataset.lang));
  });

  // ── Shared helpers ────────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const m = h.match(/.{1,2}/g);
    if (!m || m.length < 3) return [0, 0, 0];
    return m.slice(0, 3).map(x => parseInt(x, 16));
  }

  function relLum([r, g, b]) {
    return [r, g, b]
      .map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  }

  function contrastRatio(h1, h2) {
    const lums = [relLum(hexToRgb(h1)), relLum(hexToRgb(h2))].sort((a, b) => b - a);
    return (lums[0] + 0.05) / (lums[1] + 0.05);
  }

  function isValidHex(h) { return /^#[0-9A-Fa-f]{6}$/.test(h); }

  // ── 01 CONTRAST ──────────────────────────────────────────────────────────
  (function setupContrast() {
    const fgPicker  = document.getElementById('acFgPicker');
    const fgHex     = document.getElementById('acFgHex');
    const bgPicker  = document.getElementById('acBgPicker');
    const bgHex     = document.getElementById('acBgHex');
    const previewIn = document.getElementById('acPreviewInner');
    const previewTx = document.getElementById('acPreviewText');
    const previewBt = document.getElementById('acPreviewMore');
    const ratioEl   = document.getElementById('acRatio');
    const badgesEl  = document.getElementById('acBadges');

    let expanded = false;

    function update() {
      const fg = fgHex.value.trim();
      const bg = bgHex.value.trim();
      if (!isValidHex(fg) || !isValidHex(bg)) return;

      // Preview
      previewIn.style.background  = bg;
      previewIn.style.color       = fg;
      previewTx.style.color       = fg;
      previewBt.style.color       = fg;
      previewBt.style.borderColor = fg;

      // Ratio
      const ratio = contrastRatio(fg, bg);
      ratioEl.textContent = ratio.toFixed(2) + ':1';

      // Badges
      const aa   = ratio >= 4.5;
      const aaa  = ratio >= 7.0;
      const aaLg = ratio >= 3.0;
      badgesEl.innerHTML = `
        <span class="ac-pill ${aa   ? 'ac-pill--pass' : 'ac-pill--fail'}">AA ${aa   ? 'PASS' : 'FAIL'}</span>
        <span class="ac-pill ${aaa  ? 'ac-pill--pass' : 'ac-pill--fail'}">AAA ${aaa  ? 'PASS' : 'FAIL'}</span>
        <span class="ac-pill ${aaLg ? 'ac-pill--pass' : 'ac-pill--fail'}">AA Lg ${aaLg ? 'PASS' : 'FAIL'}</span>
      `;
    }

    // "Read more" toggle
    previewBt.addEventListener('click', () => {
      expanded = !expanded;
      const moreKey = currentLang === 'es' ? 'c01.more' : 'c01.more';
      const lessKey = currentLang === 'es' ? 'c01.less' : 'c01.less';
      const extraEs = ' Un buen diseño considera a todas las personas, independientemente de su capacidad visual. El contraste adecuado es un primer paso esencial.';
      const extraEn = ' Good design considers everyone, regardless of visual ability. Adequate contrast is an essential first step.';
      const baseTextEs = STRINGS.es['c01.previewText'];
      const baseTextEn = STRINGS.en['c01.previewText'];
      if (expanded) {
        previewTx.textContent = (currentLang === 'es' ? baseTextEs + extraEs : baseTextEn + extraEn);
        previewBt.textContent = STRINGS[currentLang]['c01.less'];
      } else {
        previewTx.textContent = STRINGS[currentLang]['c01.previewText'];
        previewBt.textContent = STRINGS[currentLang]['c01.more'];
      }
      update();
    });

    // Sync color picker → hex text
    fgPicker.addEventListener('input', () => { fgHex.value = fgPicker.value; update(); });
    bgPicker.addEventListener('input', () => { bgHex.value = bgPicker.value; update(); });

    // Sync hex text → color picker
    fgHex.addEventListener('input', () => {
      const v = fgHex.value.trim().startsWith('#') ? fgHex.value.trim() : '#' + fgHex.value.trim();
      if (isValidHex(v)) { fgPicker.value = v; fgHex.value = v; update(); }
    });
    bgHex.addEventListener('input', () => {
      const v = bgHex.value.trim().startsWith('#') ? bgHex.value.trim() : '#' + bgHex.value.trim();
      if (isValidHex(v)) { bgPicker.value = v; bgHex.value = v; update(); }
    });

    // Presets
    document.querySelectorAll('.ac-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fg = btn.dataset.fg;
        const bg = btn.dataset.bg;
        fgPicker.value = fg; fgHex.value = fg;
        bgPicker.value = bg; bgHex.value = bg;
        update();
      });
    });

    update();
  })();

  // ── 02 HIT TARGETS ───────────────────────────────────────────────────────
  (function setupTargets() {
    const slider     = document.getElementById('acTargetSize');
    const sizeVal    = document.getElementById('acTargetSizeVal');
    const dot        = document.getElementById('acTargetDot');
    const area       = document.getElementById('acTargetArea');
    const hitsEl     = document.getElementById('acHits');
    const attemptsEl = document.getElementById('acAttempts');
    const accuracyEl = document.getElementById('acAccuracy');
    const resetBtn   = document.getElementById('acTargetReset');

    let hits = 0, attempts = 0;
    let size = parseInt(slider.value, 10);

    function updateDotStyle() {
      size = parseInt(slider.value, 10);
      sizeVal.textContent = size + 'px';
      dot.style.width  = size + 'px';
      dot.style.height = size + 'px';
      dot.classList.toggle('ac-pass', size >= 44);
      dot.classList.toggle('ac-fail', size < 44);
      // Update ARIA value
      slider.setAttribute('aria-valuenow', size);
      slider.setAttribute('aria-valuetext', size + (currentLang === 'es' ? ' píxeles' : ' pixels'));
    }

    function moveDot() {
      const aRect  = area.getBoundingClientRect();
      const margin = size / 2 + 4;
      const maxX   = aRect.width  - margin;
      const maxY   = aRect.height - margin;
      const nx     = margin + Math.random() * (maxX - margin);
      const ny     = margin + Math.random() * (maxY - margin);
      dot.style.left = nx + 'px';
      dot.style.top  = ny + 'px';
    }

    function updateStats() {
      hitsEl.textContent     = hits;
      attemptsEl.textContent = attempts;
      accuracyEl.textContent = attempts > 0 ? Math.round((hits / attempts) * 100) + '%' : '—';
    }

    slider.addEventListener('input', updateDotStyle);

    dot.addEventListener('click', e => {
      e.stopPropagation();
      hits++;
      attempts++;
      updateStats();
      moveDot();
    });

    area.addEventListener('click', () => {
      attempts++;
      updateStats();
      moveDot();
    });

    resetBtn.addEventListener('click', () => {
      hits = 0; attempts = 0;
      updateStats();
      moveDot();
    });

    updateDotStyle();
    moveDot();
  })();

  // ── 03 TYPOGRAPHY ─────────────────────────────────────────────────────────
  (function setupTypography() {
    const fsSlider  = document.getElementById('acFontSize');
    const lhSlider  = document.getElementById('acLineHeight');
    const cwSlider  = document.getElementById('acColWidth');
    const lsSlider  = document.getElementById('acLetterSpacing');
    const fsVal     = document.getElementById('acFsVal');
    const lhVal     = document.getElementById('acLhVal');
    const cwVal     = document.getElementById('acCwVal');
    const lsVal     = document.getElementById('acLsVal');
    const fsPill    = document.getElementById('acFsPill');
    const lhPill    = document.getElementById('acLhPill');
    const cwPill    = document.getElementById('acCwPill');
    const preview   = document.getElementById('acTypeText');
    const resetBtn  = document.getElementById('acTypeReset');

    const DEFAULTS = { fs: 16, lh: 15, cw: 65, ls: 0 };

    function setPill(el, good, warn) {
      el.className = 'ac-pill';
      if (good)      { el.textContent = 'OK';   el.classList.add('ac-pill--pass'); }
      else if (warn) { el.textContent = 'WARN'; el.classList.add('ac-pill--warn'); }
      else           { el.textContent = 'BAD';  el.classList.add('ac-pill--fail'); }
    }

    function update() {
      const fs    = parseInt(fsSlider.value, 10);
      const lhRaw = parseInt(lhSlider.value, 10);
      const lh    = (lhRaw / 10).toFixed(1);
      const cw    = parseInt(cwSlider.value, 10);
      const lsRaw = parseInt(lsSlider.value, 10);
      const ls    = (lsRaw / 100).toFixed(2);

      fsVal.textContent = fs + 'px';
      lhVal.textContent = lh;
      cwVal.textContent = cw + 'ch';
      lsVal.textContent = ls + 'em';

      // ARIA value updates
      fsSlider.setAttribute('aria-valuenow', fs);
      fsSlider.setAttribute('aria-valuetext', fs + (currentLang === 'es' ? ' píxeles' : ' pixels'));
      lhSlider.setAttribute('aria-valuenow', lh);
      lhSlider.setAttribute('aria-valuetext', lh);
      cwSlider.setAttribute('aria-valuenow', cw);
      cwSlider.setAttribute('aria-valuetext', cw + (currentLang === 'es' ? ' caracteres' : ' characters'));
      lsSlider.setAttribute('aria-valuenow', ls);
      lsSlider.setAttribute('aria-valuetext', ls + ' em');

      preview.style.fontSize      = fs + 'px';
      preview.style.lineHeight    = lh;
      preview.style.maxWidth      = cw + 'ch';
      preview.style.letterSpacing = ls + 'em';

      setPill(fsPill, fs >= 16, fs >= 14);
      setPill(lhPill, parseFloat(lh) >= 1.4, parseFloat(lh) >= 1.2);
      setPill(cwPill, cw >= 45 && cw <= 75, (cw >= 35 && cw < 45) || (cw > 75 && cw <= 85));
    }

    fsSlider.addEventListener('input', update);
    lhSlider.addEventListener('input', update);
    cwSlider.addEventListener('input', update);
    lsSlider.addEventListener('input', update);

    resetBtn.addEventListener('click', () => {
      fsSlider.value = DEFAULTS.fs;
      lhSlider.value = DEFAULTS.lh;
      cwSlider.value = DEFAULTS.cw;
      lsSlider.value = DEFAULTS.ls;
      update();
    });

    update();
  })();

  // ── 04 VOICE / SCREEN READER ──────────────────────────────────────────────
  (function setupVoice() {
    const rateSlider  = document.getElementById('acVoiceRate');
    const rateVal     = document.getElementById('acVoiceRateVal');
    const voiceSelect = document.getElementById('acVoiceSelect');
    const voiceCards  = document.querySelectorAll('.ac-voice-card');
    const listenBtns  = document.querySelectorAll('.ac-listen-btn');

    let voices = [];

    function loadVoices() {
      voices = window.speechSynthesis.getVoices();
      voiceSelect.innerHTML = '';
      const espVoices = voices.filter(v => v.lang.startsWith('es'));
      const displayVoices = espVoices.length > 0 ? espVoices : voices;
      displayVoices.slice(0, 12).forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = voices.indexOf(v);
        opt.textContent = v.name + ' (' + v.lang + ')';
        if (i === 0) opt.selected = true;
        voiceSelect.appendChild(opt);
      });
      if (voiceSelect.options.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'Default';
        opt.value = -1;
        voiceSelect.appendChild(opt);
      }
    }

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    rateSlider.addEventListener('input', () => {
      const rate = (parseInt(rateSlider.value, 10) / 10).toFixed(1);
      rateVal.textContent = rate + '×';
      rateSlider.setAttribute('aria-valuenow', rate);
      rateSlider.setAttribute('aria-valuetext', rate + (currentLang === 'es' ? ' veces' : ' times'));
    });

    listenBtns.forEach(btn => {
      const labelSpan = btn.querySelector('.ac-listen-label');
      const icon      = btn.querySelector('i');

      btn.addEventListener('click', () => {
        const isSpeaking = btn.classList.contains('ac-speaking');

        // Stop any current speech
        window.speechSynthesis.cancel();
        listenBtns.forEach(b => {
          b.classList.remove('ac-speaking');
          const ls = b.querySelector('.ac-listen-label');
          const ic = b.querySelector('i');
          if (ls) ls.textContent = STRINGS[currentLang]['c04.listenBtn'];
          if (ic) { ic.className = 'ri-play-line'; ic.setAttribute('aria-hidden', 'true'); }
          const spkKey = currentLang === 'es' ? 'data-speak-es' : 'data-speak-en';
          const spkTxt = b.getAttribute(spkKey);
          if (spkTxt) b.setAttribute('aria-label', STRINGS[currentLang]['c04.listenBtn'] + ': ' + spkTxt);
        });
        voiceCards.forEach(c => c.classList.remove('ac-active'));

        if (isSpeaking) return; // was stopped, done

        const speakAttr = currentLang === 'es' ? 'data-speak-es' : 'data-speak-en';
        const text = btn.getAttribute(speakAttr);
        if (!text) return;

        const card = btn.closest('.ac-voice-card');

        const utter = new SpeechSynthesisUtterance(text);
        const voiceIdx = parseInt(voiceSelect.value, 10);
        if (voiceIdx >= 0 && voices[voiceIdx]) utter.voice = voices[voiceIdx];
        utter.rate  = parseInt(rateSlider.value, 10) / 10;
        utter.pitch = 1;
        utter.lang  = currentLang === 'es' ? 'es-ES' : 'en-US';

        btn.classList.add('ac-speaking');
        if (card) card.classList.add('ac-active');
        if (labelSpan) labelSpan.textContent = STRINGS[currentLang]['c04.stopBtn'];
        if (icon) icon.className = 'ri-stop-line';
        btn.setAttribute('aria-label', STRINGS[currentLang]['c04.stopBtn']);

        utter.onend = utter.onerror = () => {
          btn.classList.remove('ac-speaking');
          if (card) card.classList.remove('ac-active');
          if (labelSpan) labelSpan.textContent = STRINGS[currentLang]['c04.listenBtn'];
          if (icon) { icon.className = 'ri-play-line'; icon.setAttribute('aria-hidden', 'true'); }
          const spkTxt = btn.getAttribute(speakAttr);
          if (spkTxt) btn.setAttribute('aria-label', STRINGS[currentLang]['c04.listenBtn'] + ': ' + spkTxt);
        };

        window.speechSynthesis.speak(utter);
      });
    });
  })();

  // ── 05 KEYBOARD / FOCUS ──────────────────────────────────────────────────
  (function setupKeyboard() {
    const toggle = document.getElementById('acFocusToggle');
    const label  = document.getElementById('acFocusLabel');
    const form   = document.getElementById('acFocusForm');

    let visible = true;
    form.classList.add('ac-focus-visible');

    toggle.addEventListener('click', () => {
      visible = !visible;
      toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
      label.textContent = visible ? STRINGS[currentLang]['c05.on'] : STRINGS[currentLang]['c05.off'];
      form.classList.toggle('ac-focus-visible', visible);
      form.classList.toggle('ac-focus-hidden',  !visible);
    });
  })();

  // ── 07 MOTION ─────────────────────────────────────────────────────────────
  (function setupMotion() {
    const toggle     = document.getElementById('acMotionToggle');
    const label      = document.getElementById('acMotionLabel');
    const stage      = document.getElementById('acMotionStage');
    const systemVal  = document.getElementById('acMotionSystemVal');

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

    function updateSystemInfo() {
      const reduced = mq.matches;
      if (systemVal) {
        systemVal.dataset.i18n = reduced ? 'c07.systemReduced' : 'c07.systemNormal';
        systemVal.textContent  = STRINGS[currentLang][systemVal.dataset.i18n];
      }
      if (reduced) {
        toggle.setAttribute('aria-pressed', 'true');
        label.textContent = STRINGS[currentLang]['c05.on'];
        stage.classList.add('ac-reduced');
      }
    }

    updateSystemInfo();
    mq.addEventListener('change', updateSystemInfo);

    let reduced = mq.matches;

    toggle.addEventListener('click', () => {
      reduced = !reduced;
      toggle.setAttribute('aria-pressed', reduced ? 'true' : 'false');
      label.textContent = reduced ? STRINGS[currentLang]['c05.on'] : STRINGS[currentLang]['c05.off'];
      stage.classList.toggle('ac-reduced', reduced);
    });
  })();

  // ── Initialize language ───────────────────────────────────────────────────
  applyLang('es');
}

// ═══════════════════════════════════════════════════════════════════════════════
function setupLabChips() {
  const chips    = document.querySelectorAll('.lab-chip');
  const content  = document.getElementById('labContent');
  const labHeader = [
    labSectionEl.querySelector('.lab-tag'),
    labSectionEl.querySelector('.lab-title'),
    labSectionEl.querySelector('.lab-chips'),
  ];

  // Extraer el bloque bash del .md e inyectarlo en el terminal
  const bashMatch = rawSkill.match(/```bash\n([\s\S]*?)\n```/);
  const skillText = bashMatch ? bashMatch[1].trim() : rawSkill.trim();
  const codeEl = document.getElementById('auditCode');
  if (codeEl) codeEl.textContent = skillText;

  // Botón copy
  const copyBtn   = document.getElementById('auditCopyBtn');
  const copyLabel = document.getElementById('auditCopyLabel');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(skillText).then(() => {
        copyBtn.classList.add('copied');
        copyLabel.textContent = '✓ Copied';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyLabel.textContent = 'Copy';
        }, 2000);
      });
    });
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.lab === 'accessibility') {
        openAccessSection();
        return;
      }

      const isActive = chip.classList.contains('active');

      chips.forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.lab-panel').forEach(p => p.classList.remove('visible'));

      const EXTRA = 32; // px extra hacia arriba sobre el recentrado del flex

      if (isActive) {
        gsap.to(labHeader, { y: 0, duration: 0.35, ease: 'power3.inOut' });
        gsap.to(content, { height: 0, duration: 0.35, ease: 'power3.inOut' });
        _labParticles?.shiftOrigins(0, 0.35, 'power3.inOut');
      } else {
        chip.classList.add('active');
        const panel = document.querySelector(`.lab-panel[data-panel="${chip.dataset.lab}"]`);
        if (panel) {
          panel.classList.add('visible');
          const h = chip.dataset.lab === 'audit' ? 340 : 120;
          gsap.to(labHeader, { y: -EXTRA, duration: 0.45, ease: 'power3.out' });
          gsap.to(content, { height: h, duration: 0.45, ease: 'power3.out' });
          _labParticles?.shiftOrigins(-((h + 16) / 2 + EXTRA), 0.45, 'power3.out');
        }
      }
    });
  });
}

// ─── SECTION NAV ─────────────────────────────────────────────────────────────
function setupSectionNav() {
  gsap.set(sectionNavEl, { yPercent: -50 });
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
  gsap.set([heroMsgEl, heroParaWrapEl], { opacity: 0 });
  gsap.set('.hero-btn', { opacity: 0, scale: 0, filter: 'blur(10px)' });
  gsap.set(sectionNavEl, { yPercent: -50, x: 20, opacity: 0 });

  // Mobile: centra los intro-labels con GSAP antes de medir
  if (isMobile()) {
    gsap.set(creative, { xPercent: -50 });
    gsap.set(lab,      { xPercent: -50 });
  }

  let cDX, cDY, lDX, lDY;

  if (isMobile()) {
    // Mide los char-clips reales del headline (ya splitteado)
    // "Creative Lab." → C(0)r(1)e(2)a(3)t(4)i(5)v(6)e(7) space(8) L(9)a(10)b(11).(12)
    const charClips = headlineEl.querySelectorAll('.char-clip');

    const cFirstRect = charClips[0].getBoundingClientRect(); // 'C'
    const cLastRect  = charClips[7].getBoundingClientRect(); // 'E'
    const lFirstRect = charClips[9].getBoundingClientRect(); // 'L'
    const lLastRect  = charClips[12].getBoundingClientRect(); // '.'

    // Centro horizontal real de cada palabra en el headline
    const cHeadlineCX = (cFirstRect.left + cLastRect.right) / 2;
    const lHeadlineCX = (lFirstRect.left + lLastRect.right) / 2;

    const cRect = creative.getBoundingClientRect();
    const lRect = lab.getBoundingClientRect();

    // Centro horizontal de los intro-elements (centrados con xPercent: -50)
    const cIntroCX = cRect.left + cRect.width / 2;
    const lIntroCX = lRect.left + lRect.width / 2;

    cDX = cHeadlineCX - cIntroCX;
    cDY = cFirstRect.top - cRect.top;
    lDX = lHeadlineCX - lIntroCX;
    lDY = lFirstRect.top - lRect.top;
  } else {
    // Desktop: mide los char-clips reales del headline (ya splitteado)
    // "Creative Lab." → C(0)r(1)e(2)a(3)t(4)i(5)v(6)e(7) space(8) L(9)a(10)b(11).(12)
    const charClips = headlineEl.querySelectorAll('.char-clip');

    const cClipRect = charClips[0].getBoundingClientRect(); // 'C' — inicio de CREATIVE
    const lClipRect = charClips[9].getBoundingClientRect(); // 'L' — inicio de LAB.

    const cRect = creative.getBoundingClientRect();
    const lRect = lab.getBoundingClientRect();

    cDX = cClipRect.left - cRect.left;
    cDY = cClipRect.top  - cRect.top;
    lDX = lClipRect.left - lRect.left;
    lDY = lClipRect.top  - lRect.top;
  }

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

      // Section nav — entra desde la derecha, 0.7s después del hero
      gsap.to(sectionNavEl, { opacity: 1, x: 0, duration: 0.65, ease: 'power3.out', delay: 0.7 });

      // Hero elements — soft fade + ligero slide desde abajo
      gsap.fromTo(heroMsgEl,
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: D }
      );
      // Botones — morph líquido, 0.5s después del hero
      gsap.to('.hero-btn', {
        opacity: 0.75, scale: 1, filter: 'blur(0px)',
        stagger: 0.1, duration: 1.1, ease: 'elastic.out(1, 0.52)',
        delay: 0.5,
        onComplete: () => gsap.set('.hero-btn', { clearProps: 'opacity' }),
      });
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

  // Peso tipográfico: 200 → 900
  tl.to([creative, lab], {
    fontWeight: 900,
    duration: isMobile() ? 1.4 : 1.85,
    ease: 'power2.inOut',
  }, 0);

  if (isMobile()) {
    // Mobile: CREATIVE baja desde arriba, LAB. sube desde abajo → se encuentran en el centro
    tl.to(creative, { x: cDX, y: cDY, duration: 1.2, ease: 'power3.inOut' }, 0)
      .to(lab,      { x: lDX, y: lDY, duration: 1.2, ease: 'power3.inOut' }, 0);
  } else {
    // Desktop: Fase 1 vertical + Fase 2 horizontal
    tl.to(creative, { y: cDY, duration: 1.0, ease: 'power3.inOut' }, 0)
      .to(lab,      { y: lDY, duration: 1.0, ease: 'power3.inOut' }, 0)
      .to(creative, { x: cDX, duration: 0.85, ease: 'expo.inOut' }, 1.0)
      .to(lab,      { x: lDX, duration: 0.85, ease: 'expo.inOut' }, 1.0);
  }
}

// ─── HEADLINE WEIGHT HOVER ───────────────────────────────────────────────────
function setupHeadlineWeightHover() {
  const wrap  = headlineWrapEl;
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
  const MAX_R = 36;  // circle radius

  let mx = 0, my = 0;   // raw mouse / touch target
  let sx = 0, sy = 0;   // smoothed position
  let sr = 0, tr = 0;   // smoothed / target radius
  let snapped = false;  // avoid slide-in from (0,0) on first move
  let stillTimer = null;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Mouse tracking — colapsa el radio si el mouse lleva 400ms quieto
  document.addEventListener('mousemove', e => {
    if (!snapped) { sx = e.clientX; sy = e.clientY; snapped = true; }
    mx = e.clientX;
    my = e.clientY;
    tr = MAX_R;
    clearTimeout(stillTimer);
    stillTimer = setTimeout(() => { tr = 0; }, 400);
  });
  document.addEventListener('mouseleave', () => { clearTimeout(stillTimer); tr = 0; });

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
