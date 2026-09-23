/* ─── MAIN.JS ───────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import Lenis from '@studio-freight/lenis';

gsap.registerPlugin(SplitText);

// ─── IDIOMA ──────────────────────────────────────────────────────────────────
// Los textos viven en idiomas.txt, en la raiz, para poder editarlos sin tocar
// codigo. EN es el idioma por defecto; la eleccion queda guardada.
import rawLang from '../idiomas.txt?raw';

const LANG_DEFAULT = 'en';
let LANG = LANG_DEFAULT;

function parseLang(txt) {
  const dict = {};
  for (const block of txt.replace(/\r/g, '').split(/^-{3,}$/m)) {
    const lines = block.split('\n').filter(l => !l.trim().startsWith('#'));
    let key = '', cur = '', buf = { en: [], es: [] };
    for (const line of lines) {
      const m = line.match(/^(KEY|EN|ES)\s*:\s*(.*)$/);
      if (m) {
        const k = m[1];
        if (k === 'KEY') { key = m[2].trim(); cur = ''; }
        else { cur = k.toLowerCase(); buf[cur] = [m[2]]; }
      } else if (cur) buf[cur].push(line);
    }
    const en = buf.en.join('\n').trim();
    const es = buf.es.join('\n').trim();
    if (key && en) dict[key] = { en, es: es || en };
  }
  return dict;
}

const DICT = parseLang(rawLang);

// t() es lo que usa todo el resto para pedir un texto
function t(key) {
  const e = DICT[key];
  return e ? (e[LANG] || e.en) : key;
}

// Elige el campo del idioma actual en los .txt de conversacion:
// TEXT_ES si existe y estamos en ES, si no TEXT_EN, si no TEXT.
function pick(obj, field) {
  return obj[`${field}_${LANG}`] || obj[`${field}_en`] || obj[field] || '';
}

function applyLang() {
  document.documentElement.lang = LANG;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // data-i18n-attr="placeholder:clave" — para atributos, no para contenido
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(',').forEach(pair => {
      const [attr, key] = pair.split(':').map(x => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });

  document.querySelectorAll('.lang-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.lang === LANG ? 'true' : 'false');
  });

  // Las secciones armadas por JS se reconstruyen con el idioma nuevo
  langListeners.forEach(fn => { try { fn(); } catch (e) { console.warn('[i18n]', e); } });
}

const langListeners = [];
function onLangChange(fn) { langListeners.push(fn); }

function setLang(next) {
  if (next === LANG) return;
  LANG = next;
  try { localStorage.setItem('mdweb-lang', next); } catch (e) { /* modo privado */ }
  applyLang();
}

function setupLang() {
  // El idioma guardado manda; si no hay nada, EN
  try {
    const saved = localStorage.getItem('mdweb-lang');
    if (saved === 'es' || saved === 'en') LANG = saved;
  } catch (e) { /* sin storage: queda el default */ }

  document.querySelectorAll('.lang-btn').forEach(b => {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
  applyLang();
}

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
function getPanelW() {
  const el = document.getElementById('matiMenu');
  return el && el.offsetWidth
    ? el.offsetWidth
    : (isMobile() ? window.innerWidth : Math.min(540, window.innerWidth));
}

// DOM refs — must live here so tick() can access them from line 1
const cursorEl     = document.getElementById('cursor');
const headlineEl   = document.getElementById('headline');
const heroBtnsEl   = document.getElementById('heroBtns');
const scrollContentEl = document.querySelector('.scroll-content');
const chromeEl        = document.getElementById('chrome');
const clientsEl       = document.getElementById('clients');
const navContactEl    = document.getElementById('navContactWrap');
let   navContactOn    = false;
const stageEl      = document.getElementById('stage');
const matiMenuEl  = document.getElementById('matiMenu');
const heroMsgEl    = document.getElementById('heroMessage');
const heroTaglineEl= document.getElementById('heroTagline');
const headlineWrapEl = document.getElementById('headlineWrap');
const heroParaWrapEl = document.getElementById('heroParaWrap');
const heroParaEl     = document.getElementById('heroPara');

// Se lee al momento de escribir, no al cargar: asi respeta el idioma elegido
const PARA_TEXT = () => t('hero.para');

let isDark      = false;
let isPanelOpen = false;

// ─── PANEL PEEK ──────────────────────────────────────────────────────────────
// Al acercar el cursor al borde izquierdo el panel asoma. Un click lo abre.
const PEEK_ZONE = 150;   // px desde el borde donde empieza a reaccionar
const PEEK_MAX  = 22;    // cuanto asoma como maximo
let peekTarget  = 0;     // 0 lejos · 1 pegado al borde
let peekCur     = 0;
let peekLast    = -1;
let panelBusy   = false; // true mientras corre abrir/cerrar

// ─── BOOT ────────────────────────────────────────────────────────────────────
// Cursor + RAF start immediately — no dependency on fonts
setupLang();
setupCursor();
tick(0);

// Everything else after fonts are ready
document.fonts.ready.then(() => {
  setupThree();
  setupLenis();
  setupWorks();
  setupClients();
  setupManifesto();
  setupMeshGradient();
  mfDrop = setupBubbleDrop();
  buildSnapPoints();
  setupLetsTalk();
  setupMagnetic();
  setupPanel();
  setupDarkMode();
  setupClock();
  setupSectionNav();
  setupDitherReveal();
  splitAndAnimateHeadline(); // split primero para que setupIntro mida los chars reales
  setupIntro();              // mide headline → arranca animación de carga
  setupHeadlineWeightHover();

  // Lo que ya quedo escrito en el DOM no se reescribe solo
  onLangChange(() => {
    // El hero se tipea letra por letra: al cambiar idioma se repone entero
    if (heroTaglineEl && heroTaglineEl.textContent) heroTaglineEl.textContent = t('hero.msg');
    if (heroParaEl && heroParaEl.textContent)       heroParaEl.textContent   = PARA_TEXT();
    // "Manifesto" y "Manifiesto" no miden lo mismo: hay que recalcular el cuerpo
    // que hace que la palabra llegue a los bordes
    if (mfHead) measureManifesto();
  });
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
const CURSOR_1 = new URL('../img/cursor-1.png', import.meta.url).href;
const CURSOR_2 = new URL('../img/cursor-2.png', import.meta.url).href;

function setupCursor() {
  if (isTouch()) return; // touch devices use native cursor

  const faceEl = document.getElementById('cursorFace');

  document.addEventListener('mousemove', e => {
    cursorX = e.clientX;
    cursorY = e.clientY;
  });

  // Hover: scale up
  document.querySelectorAll('a, button, [data-magnetic], .work-link').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
  });

  // Click: swap face
  document.addEventListener('mousedown', () => {
    faceEl.src = CURSOR_2;
    document.body.classList.remove('cur-hover');
    document.body.classList.add('cur-down');
  });
  document.addEventListener('mouseup', () => {
    faceEl.src = CURSOR_1;
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
  heroParaEl.textContent = PARA_TEXT();
  heroParaWrapEl.style.minHeight = heroParaWrapEl.getBoundingClientRect().height + 'px';
  heroParaEl.textContent = '';

}


// ═══════════════════════════════════════════════════════════════════════════════
// WORKS
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// WORKS — hover index + dither reveal
// ═══════════════════════════════════════════════════════════════════════════════
// data-img no lo procesa Vite: sin esto las imagenes no entran al build y el
// preview queda vacio en produccion. El glob las emite y resuelve el `base`.
const WORK_IMGS = import.meta.glob('../img/*.{webp,jpg,jpeg,png}', {
  eager: true, query: '?url', import: 'default',
});
const workImgUrl = name =>
  WORK_IMGS[`../img/${name}`] ?? WORK_IMGS[`../${name}`] ?? name;
// Bayer 8×8 ordenada — la misma matriz que usa el rastro del cursor, para que la
// imagen se arme con el mismo lenguaje visual del sitio.
const BAYER = [
  [ 0,32, 8,40, 2,34,10,42],
  [48,16,56,24,50,18,58,26],
  [12,44, 4,36,14,46, 6,38],
  [60,28,52,20,62,30,54,22],
  [ 3,35,11,43, 1,33, 9,41],
  [51,19,59,27,49,17,57,25],
  [15,47, 7,39,13,45, 5,37],
  [63,31,55,23,61,29,53,21],
];

// object-fit: cover, a mano
function drawCover(c, img, w, h) {
  const ir = img.naturalWidth / img.naturalHeight;
  let dw, dh;
  if (ir > w / h) { dh = h; dw = h * ir; }
  else            { dw = w; dh = w / ir; }
  c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function setupWorks() {
  const list   = document.getElementById('worksList');
  const canvas = document.getElementById('workPreview');
  if (!list) return;

  const links = Array.from(list.querySelectorAll('.work-link'));

  // Entrada escalonada cuando la lista llega al viewport
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { list.classList.add('is-in'); io.disconnect(); }
    });
  }, { threshold: 0.12 });
  io.observe(list);

  // Marcar la fila activa (mouse y teclado) — el spotlight es CSS
  links.forEach(link => {
    const row = link.closest('.work-row');
    const on  = () => { row.classList.add('is-hover');    list.classList.add('has-hover'); };
    const off = () => { row.classList.remove('is-hover'); list.classList.remove('has-hover'); };
    link.addEventListener('mouseenter', on);
    link.addEventListener('mouseleave', off);
    link.addEventListener('focus', on);
    link.addEventListener('blur',  off);
  });

  // El preview depende del cursor: en touch no existe
  if (!canvas || isTouch()) return;

  const ctx = canvas.getContext('2d');
  const W = 300, H = 225;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width  = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(DPR, DPR);

  // Canvas chico para muestrear la imagen a baja resolución
  const off    = document.createElement('canvas');
  const offCtx = off.getContext('2d', { willReadFrequently: true });

  // Precarga: que el dither tenga píxeles desde el primer hover
  const images = new Map();
  links.forEach(l => {
    const src = l.dataset.img;
    if (!src || images.has(src)) return;
    const img = new Image();
    img.src = workImgUrl(src.replace(/^img\//, ''));
    images.set(src, img);
  });

  let active  = null;   // imagen en curso
  let reveal  = 0;      // 0 = sólo puntos · 1 = foto nítida
  let target  = 0;
  let mx = 0, my = 0;   // cursor
  let px = 0, py = 0;   // posición suavizada del panel
  let placed  = false;  // evita el deslizamiento desde (0,0) en el primer hover
  let raf     = null;
  let lastT   = 0;
  let dotColor = '#111111';

  const PITCH_COARSE = 11;   // celda inicial: bien grumoso
  const PITCH_FINE   = 3;    // celda final: casi la foto
  const REVEAL_IN    = 1.45; // seg que tarda en armarse — subilo para alargarlo
  const REVEAL_OUT   = 0.40; // al salir conviene que sea rapido
  const PHOTO_IN     = 0.55; // hasta aca es dither puro; despues entra la foto

  function render() {
    ctx.clearRect(0, 0, W, H);
    if (!active || !active.complete || !active.naturalWidth) return;

    const t = reveal;
    // La foto arranca recien pasado PHOTO_IN: antes de eso se ve sólo la trama
    const photo = smoothstep(Math.max(0, Math.min(1, (t - PHOTO_IN) / (1 - PHOTO_IN))));

    // 1 — la foto real, sólo en el tramo final
    if (photo > 0) {
      ctx.globalAlpha = photo;
      drawCover(ctx, active, W, H);
      ctx.globalAlpha = 1;
    }

    // 2 — la trama aguanta entera hasta que la foto empieza a entrar
    if (photo < 1) {
      // pitch lineal: cada tamaño de celda dura lo mismo en pantalla
      const pitch = Math.max(PITCH_FINE, Math.round(lerp(PITCH_COARSE, PITCH_FINE, t)));
      const cols  = Math.ceil(W / pitch);
      const rows  = Math.ceil(H / pitch);

      off.width  = cols;
      off.height = rows;
      drawCover(offCtx, active, cols, rows);
      const data = offCtx.getImageData(0, 0, cols, rows).data;

      ctx.globalAlpha = 1 - photo;
      ctx.fillStyle   = dotColor;
      const size = Math.max(1, pitch - 1);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i   = (y * cols + x) * 4;
          const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          // Umbral Bayer: los tonos claros se quedan sin punto
          if (lum > (BAYER[y & 7][x & 7] + 0.5) / 64) continue;
          ctx.fillRect(x * pitch, y * pitch, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function loop(now) {
    // dt real: la duracion no depende de los fps (y no salta al volver de otra pestaña)
    const dt = Math.min(0.064, (now - lastT) / 1000);
    lastT = now;

    // Posición: el panel persigue al cursor con retardo
    px = lerp(px, mx, 0.16);
    py = lerp(py, my, 0.16);

    // Avance lineal: el dither se toma su tiempo parejo, sin acelerar al principio
    const dur  = target > reveal ? REVEAL_IN : REVEAL_OUT;
    const step = dt / dur;
    const diff = target - reveal;
    reveal += Math.sign(diff) * Math.min(step, Math.abs(diff));

    canvas.style.transform = `translate3d(${(px - W / 2).toFixed(1)}px, ${(py - H / 2).toFixed(1)}px, 0)`;
    render();

    // Cortar el rAF cuando ya no hay nada que mostrar
    if (target === 0 && reveal < 0.01) {
      canvas.classList.remove('visible');
      raf = null;
      active = null;
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function start(img) {
    // Cambiar de proyecto rearma la imagen desde cero: la gracia es verla formarse
    if (img !== active) reveal = 0;
    active = img;
    target = 1;
    lastT  = performance.now();
    dotColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--text').trim() || '#111111';
    canvas.classList.add('visible');
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function stop() {
    target = 0;
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(loop); }
  }

  // El cursor se sigue en toda la lista, no fila por fila
  list.addEventListener('mousemove', e => {
    mx = e.clientX + 26;   // apartado del cursor para no taparlo
    my = e.clientY;
    if (!placed) { px = mx; py = my; placed = true; }
  });

  links.forEach(link => {
    link.addEventListener('mouseenter', () => {
      const img = images.get(link.dataset.img);
      if (img) start(img);
    });
    link.addEventListener('mouseleave', stop);
  });
  list.addEventListener('mouseleave', stop);
}

// El hero se desvanece a lo largo de esta distancia, antes de que llegue la lista
const HERO_FADE = () => window.innerHeight * 0.85;

const navbarEl    = document.querySelector('.navbar');
const sectionNavEl = document.getElementById('sectionNav');

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

  // El contacto sube al nav cuando el boton del hero ya termino de irse
  if (navContactEl) {
    const show = progress >= 0.55;
    if (show !== navContactOn) {
      navContactOn = show;
      navContactEl.classList.toggle('visible', show);
    }
  }

  // La banda de clientes se va con el hero: apenas antes que los botones
  if (clientsEl) {
    const cOt = smoothstep(Math.max(0, Math.min(1, (progress - 0.15) / 0.28)));
    clientsEl.style.opacity = 1 - cOt;
  }

  // Magnetic scroll drift — headline resiste el scroll y vuelve suave
  const vel    = scrollY - prevScrollY;
  prevScrollY  = scrollY;
  headlineDrift = lerp(headlineDrift, vel, 0.1);
  headlineEl.style.transform = `translateY(${(headlineDrift * -0.28).toFixed(2)}px)`;
}

// Para typing uses span-per-word system — scroll accel handled inside the timer

// ─── GRADIENTE DEL MANIFIESTO ────────────────────────────────────────────────
// Mesh gradient por shader. Las manchas radiales de CSS no alcanzan: se mueven
// como formas rigidas. Aca el color se pliega sobre si mismo (domain warping),
// que es lo que hace que el gradiente parezca liquido.
// Reusa el simplex/fbm que ya estaba escrito para el fondo del hero.
const MESH_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uDark;
  varying vec2  vUv;

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

  float fbm(vec2 p) {
    float v=0., a=.5, f=1.;
    for(int i=0;i<4;i++) { v+=a*snoise(p*f); a*=.5; f*=2.; }
    return v;
  }

  // Perfil del radialGradient del SVG: opaco hasta el 23.1% del radio y lineal
  // hasta 0 en el borde. La y se corrige por el aspecto del viewBox.
  float blob(vec2 uv, vec2 c, float r) {
    float d = length(vec2(uv.x - c.x, (uv.y - c.y) * 0.625));
    return 1.0 - clamp((d / r - 0.231) / 0.769, 0.0, 1.0);
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime;

    // Mesh de cuatro radiales sobre crema, igual que el SVG de referencia.
    // El perfil del SVG es lineal: solido hasta 0.231 del radio y de ahi baja
    // recto hasta 0. Los centros se mecen apenas para que el fondo respire.
    vec3 col = vec3(1.000, 0.941, 0.851);   // #FFF0D9

    // El radio del SVG es 1056 sobre 1600 de ancho, y la y va comprimida
    // (1000/1600 = 0.625) porque el preserveAspectRatio es "none".
    float R = 1056.0 / 1600.0;

    vec2 cRosa = vec2(0.3337, 0.2177) + vec2(sin(t * 0.081) * 0.045, cos(t * 0.062) * 0.035);
    vec2 cViol = vec2(0.7222, 0.3334) + vec2(cos(t * 0.069) * 0.050, sin(t * 0.094) * 0.038);
    vec2 cAmba = vec2(0.7767, 0.7500) + vec2(sin(t * 0.057) * 0.048, cos(t * 0.078) * 0.032);
    vec2 cCora = vec2(0.2622, 0.7095) + vec2(cos(t * 0.088) * 0.044, sin(t * 0.051) * 0.036);

    // Se pintan en el mismo orden que el SVG: rosa, violeta, ambar, coral
    col = mix(col, vec3(1.000, 0.365, 0.635), blob(uv, cRosa, R));
    col = mix(col, vec3(0.647, 0.294, 1.000), blob(uv, cViol, R));
    col = mix(col, vec3(1.000, 0.706, 0.227), blob(uv, cAmba, R));
    col = mix(col, vec3(1.000, 0.439, 0.302), blob(uv, cCora, R));

    // Grano por pixel, no una textura repetida encima
    float g = fract(sin(dot(gl_FragCoord.xy + uTime * 60.0,
                            vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.0341;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function setupMeshGradient() {
  const host = document.querySelector('.mf-bg');
  if (!host) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'mf-shader';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  } catch (e) {
    return;   // sin webgl queda el color plano de la seccion
  }
  renderer.setPixelRatio(1);   // el ruido no necesita densidad: ahorra mucho

  const scene    = new THREE.Scene();
  const camera   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const uniforms = { uTime: { value: 0 }, uDark: { value: 0 } };
  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: MESH_FRAG })
  ));

  // A mitad de resolucion: son 5 fbm por pixel, y a resolucion completa eso es
  // 4 veces mas trabajo para un degrade que no tiene un solo borde duro.
  // setSize(..., false) no toca el style, asi que el CSS lo estira al 100%.
  const SCALE = 0.5;
  function resize() {
    const r = host.getBoundingClientRect();
    if (r.width && r.height) {
      renderer.setSize(Math.round(r.width * SCALE), Math.round(r.height * SCALE), false);
    }
  }
  resize();
  window.addEventListener('resize', resize);

  // Solo dibuja cuando la seccion esta en pantalla
  let visible = false, raf = null, t0 = performance.now();
  new IntersectionObserver(es => es.forEach(e => {
    visible = e.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(loop);
  }), { rootMargin: '15% 0px' }).observe(host);

  function loop(now) {
    if (!visible) { raf = null; return; }
    uniforms.uTime.value = (now - t0) / 1000;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
}

// ─── LLUVIA DE CODIGO ────────────────────────────────────────────────────────
// Al pasar el mouse, la burbuja se tapa entera y queda corriendo codigo JS de
// costado. Se dibuja en canvas y lo recorta el propio border-radius del
// contenedor, asi que la mascara no cuesta nada.
// Las lineas son de este mismo proyecto: se tiene que leer como codigo real.
const RAIN_LINES = [
  "const t = gsap.timeline({ repeat: -1 });",
  "uniforms.uTime.value = clock.getElapsedTime();",
  "if (!ctx || !active.naturalWidth) return;",
  "for (let i = 0; i < cols.length; i++) {",
  "geo.setAttribute('aTone', new THREE.Float32BufferAttribute(ton, 1));",
  "p.xy += normalize(d + 1e-5) * force * 0.26;",
  "await document.fonts.ready;",
  "ctx.globalCompositeOperation = 'destination-out';",
  "const dist = edgeDistance(mask, GRID);",
  "renderer.setPixelRatio(Math.min(devicePixelRatio, 2));",
  "export default function render(scene, camera) {",
  "lenis.scrollTo(best, { duration: 1.0 });",
  "el.style.transform = `translate3d(${x}px, ${y}px, 0)`;",
  "return mix(pText, pFace, uFace);",
  "observer.observe(el, { threshold: 0.25 });",
  "const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;",
];

function setupCodeRain(host) {
  if (isTouch()) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'mf-code';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  const ctx = canvas.getContext('2d');
  const FS  = 8;     // cuerpo chico: tiene que leerse como masa de codigo
  const ROW = 10;    // alto de fila
  const GAP = 40;    // aire entre una repeticion y la siguiente

  let W = 0, H = 0, rows = [], raf = null, last = 0;

  function build() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${FS}px 'Geist Mono', monospace`;
    ctx.textBaseline = 'top';

    rows = [];
    for (let y = 0; y < H + ROW; y += ROW) {
      const text = RAIN_LINES[(Math.random() * RAIN_LINES.length) | 0];
      const w    = ctx.measureText(text).width + GAP;
      rows.push({
        y,
        text,
        w,
        x: -Math.random() * w,
        speed: 70 + Math.random() * 130,      // px/s — cada fila a su ritmo
        alpha: 0.30 + Math.random() * 0.62,   // da sensacion de profundidad
      });
    }
    return true;
  }

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;

    ctx.clearRect(0, 0, W, H);
    for (const r of rows) {
      r.x -= r.speed * dt;
      if (r.x <= -r.w) r.x += r.w;            // vuelve a entrar sin costura
      ctx.fillStyle = `rgba(244,243,238,${r.alpha})`;
      // Se repite hasta cubrir el ancho: si no, queda un hueco al dar la vuelta
      for (let x = r.x; x < W; x += r.w) ctx.fillText(r.text, x, r.y);
    }
    raf = requestAnimationFrame(frame);
  }

  host.addEventListener('mouseenter', () => {
    if (raf) return;
    if (!rows.length && !build()) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  });

  host.addEventListener('mouseleave', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    ctx.clearRect(0, 0, W, H);
  });

  let rz = null;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { rows = []; if (raf) build(); }, 200);
  });
}

// ─── MANIFIESTO ──────────────────────────────────────────────────────────────
// La charla vive en manifiesto.txt, en la raiz, para poder editarla sin tocar
// codigo. Vite lo empaqueta y en dev recarga al guardar.
import rawManifesto from '../manifiesto.txt?raw';

let mfHead = null;   // { el, title, top, len, bigFs }
let mfDrop = null;   // chequeo de la caida, se engancha al tick

function parseThread(txt) {
  const out = [];
  for (const block of txt.replace(/\r/g, '').split(/^-{3,}$/m)) {
    const lines = block.split('\n').filter(l => !l.trim().startsWith('#'));
    let who = '', time = '', draft = false, body = {}, inText = '';

    for (const line of lines) {
      const m = line.match(/^(WHO|TIME|DRAFT|TEXT(?:_[A-Z]{2})?)\s*:\s*(.*)$/i);
      if (m) {
        const k = m[1].toUpperCase(), v = m[2];
        inText = k.startsWith('TEXT') ? k.toLowerCase() : '';
        if      (k === 'WHO')   who   = v.trim().toLowerCase();
        else if (k === 'TIME')  time  = v.trim();
        else if (k === 'DRAFT') draft = /^(yes|si|true|1)$/i.test(v.trim());
        else                    body[inText] = [v];
      } else if (inText) body[inText].push(line);
    }
    const texts = {};
    for (const k in body) texts[k] = body[k].join('\n').trim();
    if (who && (texts.text || texts.text_en || texts.text_es)) {
      out.push({ who, time, draft, ...texts });
    }
  }
  return out;
}

function setupManifesto() {
  const sec = document.getElementById('manifesto');
  if (!sec) return;

  const headEl = document.getElementById('mfHead');
  const title  = document.getElementById('manifestoTitle');
  if (headEl && title) {
    mfHead = { el: headEl, title, top: 0, len: 1, bigFs: 0, lastT: -1, lastE: -1 };
    measureManifesto();
  }

  const thread   = document.getElementById('mfThread');
  const composer = document.getElementById('mfComposer');
  const draftEl  = document.getElementById('mfDraft');
  if (!thread) return;

  const msgs  = parseThread(rawManifesto);
  const draft = msgs.find(m => m.draft);
  const NAMES = { mati: 'Mati', ai: 'AI' };

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Pop con rebote, naciendo en la esquina de la cola
  function pop(el, delay) {
    if (REDUCED) { gsap.set(el, { opacity: 1, scale: 1, y: 0 }); return; }
    gsap.fromTo(el,
      { opacity: 0, scale: 0.84, y: 20 },
      { opacity: 1, scale: 1, y: 0, duration: 0.62, ease: 'back.out(1.6)', delay });
    const dot = el.querySelector('.mf-dot');
    if (dot) gsap.from(dot, { scale: 0, duration: 0.5, ease: 'back.out(2.4)', delay: delay + 0.10 });
  }

  // La burbuja CRECE desde los puntitos hasta el alto del mensaje. Reemplazar
  // el contenido sin animar el alto produce un salto y se pierde el efecto.
  function grow(el) {
    const dots = el.querySelector('.mf-typing');
    const body = el.querySelector('.mf-text');
    if (!dots || !body) return;

    const from = el.offsetHeight;
    body.hidden = false;
    gsap.set(body, { opacity: 0 });
    const to = el.offsetHeight;          // alto ya con el texto adentro

    if (REDUCED) { dots.remove(); body.style.opacity = ''; return; }

    gsap.fromTo(el, { height: from }, {
      height: to, duration: 0.46, ease: 'power3.inOut',
      onComplete: () => { el.style.height = ''; },
    });
    gsap.to(dots, { opacity: 0, scale: 0.5, duration: 0.22, ease: 'power2.in',
      onComplete: () => dots.remove() });
    // clearProps al terminar: si GSAP deja opacity inline, le gana al :hover del
    // CSS y el texto de la IA nunca se oculta bajo el codigo.
    gsap.to(body, {
      opacity: 1, duration: 0.42, delay: 0.16, ease: 'power2.out',
      onComplete: () => gsap.set(body, { clearProps: 'opacity' }),
    });
  }

  let draftText = draft ? pick(draft, 'text') : '';
  let typed = false;
  function typeDraft() {
    if (typed || !draft || !draftEl) return;
    typed = true;
    let i = 0;
    (function step() {
      if (i >= draftText.length) {
        // El cursor sigue titilando: el mensaje esta escrito pero sin enviar
        if (composer) composer.classList.add('ready');
        return;
      }
      const ch = draftText[i++];
      draftEl.textContent += ch;
      setTimeout(step, ch === ' ' ? 26 : 42);
    })();
  }

  // Un solo observer para todo: revela la burbuja, y en las de la AI espera a
  // que terminen los puntitos antes de mostrar el texto.
  const io = new IntersectionObserver(entries => {
    // Si entran varias juntas (scroll rapido o pantalla alta), se escalonan en
    // orden de lectura: de golpe todas a la vez no parece una conversacion.
    const list = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.target.compareDocumentPosition(b.target) & 2 ? 1 : -1);

    list.forEach((e, i) => {
      io.unobserve(e.target);
      const el    = e.target;
      const delay = i * 0.16;

      pop(el, delay);

      if (el === composer) { setTimeout(typeDraft, (delay + 0.5) * 1000); return; }

      const wait = Number(el.dataset.typing || 0);
      if (wait) setTimeout(() => grow(el), delay * 1000 + wait);
    });
  }, { threshold: 0.25 });

  msgs.filter(m => !m.draft).forEach(m => {
    const ai = m.who === 'ai';
    const el = document.createElement('article');
    el.className = `mf-msg mf-msg--${ai ? 'ai' : 'mati'}`;

    const row = document.createElement('div');
    row.className = 'mf-head-row';
    row.innerHTML = '<span class="mf-dot"></span><span class="mf-name"></span><span class="mf-time"></span>';
    row.querySelector('.mf-dot').textContent  = ai ? 'AI' : 'MD';
    row.querySelector('.mf-name').textContent = NAMES[m.who] || m.who;
    row.querySelector('.mf-time').textContent = m.time;

    const body = document.createElement('p');
    body.className   = 'mf-text';
    body.textContent = pick(m, 'text');

    if (ai) {
      // La AI "piensa" antes de contestar: los puntitos del chat
      body.hidden = true;
      el.dataset.typing = '700';
      const dots = document.createElement('div');
      dots.className = 'mf-typing';
      dots.innerHTML = '<span></span><span></span><span></span>';
      el.append(row, dots, body);
    } else {
      el.append(row, body);
    }

    el._msg = m;              // para poder cambiarle el idioma despues
    thread.appendChild(el);
    setupCodeRain(el);
    io.observe(el);
  });

  if (composer && draft) {
    composer.setAttribute('aria-hidden', 'false');
    io.observe(composer);
  }

  // Al cambiar de idioma se reescribe el texto, no se rearma el hilo: asi no se
  // pierden las animaciones ni se vuelven a disparar los pops.
  onLangChange(() => {
    thread.querySelectorAll('.mf-msg').forEach(el => {
      const body = el.querySelector('.mf-text');
      if (body && el._msg) body.textContent = pick(el._msg, 'text');
    });
    draftText = draft ? pick(draft, 'text') : '';
    if (draftEl && typed) {           // ya estaba escrito: se repone entero
      draftEl.textContent = draftText;
    }
  });

  let rz = null;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(measureManifesto, 200);
  });
}

function measureManifesto() {
  if (!mfHead) return;
  mfHead.top = mfHead.el.getBoundingClientRect().top + window.scrollY;
  // El encogido dura 55vh. Tiene que quedar cerca del alto del track (.mf-head
  // en el CSS) o se vuelve a abrir el hueco entre el titulo y la charla.
  mfHead.len = window.innerHeight * 0.55;
  fitManifestoTitle();
}

// Mide el ancho real del texto y despeja el cuerpo que lo hace llegar a los
// bordes. Con un divisor fijo habria que adivinar el avance de la fuente.
function fitManifestoTitle() {
  const t = mfHead.title;
  const keep = { fs: t.style.fontSize, ls: t.style.letterSpacing, fw: t.style.fontWeight };

  t.style.fontSize      = '100px';
  t.style.fontWeight    = '800';
  t.style.letterSpacing = '-4px';                  // -0.04em a 100px
  const w = t.getBoundingClientRect().width;

  t.style.fontSize      = keep.fs;
  t.style.fontWeight    = keep.fw;
  t.style.letterSpacing = keep.ls;

  mfHead.bigFs = w ? (100 * (window.innerWidth * 0.96) / w) : window.innerWidth * 0.13;
}

function updateManifesto() {
  if (!mfHead) return;

  // El titulo se achica de gigante a rotulo a lo largo del track
  const vh = window.innerHeight;

  // Dos progresos distintos:
  //  t  = el encogido, que arranca cuando la seccion llega al borde superior
  //  e  = la ENTRADA, que corre mientras la palabra sube desde abajo
  // El peso va con e: si fuera con t, la palabra se quedaria fina todo el viaje
  // y recien engordaria al empezar a achicarse.
  const p = Math.max(0, Math.min(1, (scrollY - mfHead.top) / mfHead.len));
  const t = smoothstep(p);
  // Termina cuando la seccion entro un 22%, que es cuando la palabra ya se lee
  // entera en pantalla
  const e = smoothstep(Math.max(0, Math.min(1, (scrollY - (mfHead.top - vh)) / (vh * 0.22))));

  if (Math.abs(t - mfHead.lastT) < 0.002 && Math.abs(e - mfHead.lastE) < 0.002) return;
  mfHead.lastT = t;
  mfHead.lastE = e;
  const big = mfHead.bigFs || window.innerWidth * 0.13;
  const st  = mfHead.title.style;
  st.fontSize      = lerp(big, 50, t).toFixed(2) + 'px';
  // Invertido respecto al hero: alla el titular va de 900 a 100 al scrollear;
  // aca la palabra entra fina y se va engrosando mientras se achica.
  st.fontWeight    = Math.round(lerp(200, 800, e));
  // El tracking en px, no en em: en em cambiaria solo por achicarse el cuerpo
  // Menos tracking negativo al arrancar: con peso 200 las letras son finitas
  // y el -0.04em las empastaba una contra otra.
  st.letterSpacing = lerp(big * -0.02, 2.42, t).toFixed(2) + 'px';
  st.opacity       = lerp(1, 0.40, t).toFixed(3);
}

// ─── CAIDA DE LAS BURBUJAS ───────────────────────────────────────────────────
// Al salir del manifiesto, las burbujas se sueltan y caen al piso de la
// pantalla. Fisica a mano: son 6 cuerpos, no justifica una libreria.
function setupBubbleDrop() {
  const sec      = document.getElementById('manifesto');
  const thread   = document.getElementById('mfThread');
  const composer = document.getElementById('mfComposer');
  if (!sec || !thread) return null;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  // En touch no: la fisica usa position fixed, y con la barra del navegador
  // entrando y saliendo el piso se mueve debajo de las burbujas.
  if (isTouch()) return null;

  const G    = 1850;   // gravedad px/s² — mas baja = caida mas larga
  const REST = 0.38;   // rebote
  const FRIC = 0.86;   // rozamiento al tocar el piso
  const PAD  = 10;     // margen contra los bordes

  let bodies = null, raf = null, last = 0, dropped = false, lastFade = -1;

  function drop() {
    if (dropped) return;
    const els = [...thread.children, composer].filter(Boolean);
    if (!els.length) return;

    // Medir TODO antes de sacar nada del flujo, o las medidas salen mal
    const rects = els.map(el => el.getBoundingClientRect());
    const keepH = thread.offsetHeight;
    dropped = true;

    // Reservar el alto: sin esto la seccion colapsa y el scroll pega un salto
    thread.style.height = keepH + 'px';
    if (composer) composer.style.marginTop = '0';

    bodies = els.map((el, i) => {
      const r = rects[i];
      el.classList.add('mf-falling');
      el.style.left  = r.left + 'px';
      el.style.top   = r.top + 'px';
      el.style.width = r.width + 'px';
      return {
        el, w: r.width, h: r.height,
        bx: r.left, by: r.top,            // origen fijo
        x: 0, y: 0,
        vx: (Math.random() - 0.5) * 190,
        vy: -70 - Math.random() * 140,    // mas impulso arriba: flotan antes de caer
        a: 0, va: (Math.random() - 0.5) * 2.4,
        rest: false,
      };
    });

    last = 0;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function reset() {
    if (!dropped) return;
    dropped = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    thread.style.height = '';
    if (composer) composer.style.marginTop = '';
    (bodies || []).forEach(b => {
      b.el.classList.remove('mf-falling');
      b.el.style.left = b.el.style.top = b.el.style.width = b.el.style.transform = '';
      // opacity se repone en 1, NO se limpia: en el CSS la burbuja arranca en 0
      // y lo que la hace visible es el inline que escribe GSAP al aparecer.
      // Vaciarla la devolvia al 0 del CSS, y como el observer ya no la vigila,
      // el pop no vuelve a correr y quedaba invisible para siempre.
      b.el.style.opacity = '1';
    });
    bodies = null;
    lastFade = -1;
  }

  function loop(now) {
    const dt = last ? Math.min(0.032, (now - last) / 1000) : 0.016;
    last = now;
    const vw = window.innerWidth, vh = window.innerHeight;
    let moving = false;

    for (const b of bodies) {
      if (!b.rest) {
        b.vy += G * dt;
        b.x  += b.vx * dt;
        b.y  += b.vy * dt;
        b.a  += b.va * dt;
        moving = true;
      }

      // Piso
      const bot = b.by + b.y + b.h;
      if (bot > vh - PAD) {
        b.y  = vh - PAD - b.h - b.by;
        b.vy = -b.vy * REST;
        b.vx *= FRIC;
        b.va *= 0.6;
        if (Math.abs(b.vy) < 45) {
          b.vy = 0;
          b.va *= 0.35;
          if (Math.abs(b.vx) < 10 && Math.abs(b.va) < 0.12) { b.vx = b.va = 0; b.rest = true; }
        }
      }
      // Paredes
      const lft = b.bx + b.x;
      if (lft < PAD)              { b.x = PAD - b.bx;               b.vx =  Math.abs(b.vx) * 0.55; b.rest = false; }
      if (lft + b.w > vw - PAD)   { b.x = vw - PAD - b.w - b.bx;    b.vx = -Math.abs(b.vx) * 0.55; b.rest = false; }
    }

    // Apilado simple: si dos se superponen, la de arriba se apoya en la otra.
    // Sin esto todas terminan en el mismo renglon del piso, una encima de otra.
    for (let n = 0; n < 3; n++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const A = bodies[i], B = bodies[j];
          const ax = A.bx + A.x, ay = A.by + A.y;
          const bx = B.bx + B.x, by = B.by + B.y;
          const ox = Math.min(ax + A.w, bx + B.w) - Math.max(ax, bx);
          const oy = Math.min(ay + A.h, by + B.h) - Math.max(ay, by);
          if (ox <= 0 || oy <= 0) continue;

          const up = ay < by ? A : B;          // la de mas arriba sube
          up.y -= oy;
          if (up.vy > 0) { up.vy *= -0.18; up.rest = false; }
        }
      }
    }

    for (const b of bodies) {
      b.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) rotate(${b.a.toFixed(3)}rad)`;
    }

    // Cuando ya nadie se mueve, cortar el rAF: quedan quietas en el piso
    raf = (moving || bodies.some(b => !b.rest)) ? requestAnimationFrame(loop) : null;
  }

  // Posicion de la seccion cacheada: leer el rect por frame es un reflow
  let secTop = 0, secH = 0;
  function measure() {
    secTop = sec.getBoundingClientRect().top + window.scrollY;
    secH   = sec.offsetHeight;
  }
  measure();
  let mrz = null;
  window.addEventListener('resize', () => {
    clearTimeout(mrz);
    mrz = setTimeout(measure, 200);
  });

  // Se devuelve el chequeo para engancharlo al tick que ya existe
  return function update() {
    const vh = window.innerHeight;
    const r  = { bottom: secTop + secH - scrollY };
    if (!dropped && r.bottom < vh * 0.92) drop();
    else if (dropped && r.bottom > vh * 1.02) reset();

    // Se van apenas terminan de caer: si no, quedan encimadas sobre Works
    if (dropped && bodies) {
      // Works ya las tapa al subir; esto es solo la limpieza final
      const f = Math.max(0, Math.min(1, (r.bottom + vh * 0.26) / (vh * 0.26)));
      if (f !== lastFade) {
        lastFade = f;
        bodies.forEach(b => { b.el.style.opacity = f.toFixed(2); });
      }
    }
  };
}

// ─── SNAP ENTRE PASOS ────────────────────────────────────────────────────────
// Hecho con Lenis y no con ScrollTrigger: el resto de la pagina ya calcula todo
// a mano contra scrollY, meter otro motor de scroll seria duplicar autoridad.
const SNAP_IDLE = 9;        // frames quieto antes de asentar (~150ms)
let snapPoints = [];
let snapSkip   = null;    // tramo sin snap: el manifiesto se lee, no se saltea
let snapLastY  = -1;
let snapIdle   = 0;

function buildSnapPoints() {
  const pts = [0];
  const mf = document.getElementById('manifesto');
  if (mf) {
    const top = mf.getBoundingClientRect().top + window.scrollY;
    pts.push(top);
    // Snappear mientras lee seria insoportable: solo al entrar y al salir
    snapSkip = [top + window.innerHeight * 0.06,
                top + mf.offsetHeight - window.innerHeight * 0.95];
  }

  const works = document.getElementById('works');
  if (works) {
    navWorksTop = works.getBoundingClientRect().top + window.scrollY;
    pts.push(navWorksTop);
  }

  const lt = document.getElementById('letsTalk');
  if (lt) {
    const top = lt.getBoundingClientRect().top + window.scrollY;
    const len = Math.max(1, lt.offsetHeight - window.innerHeight);
    // Mesetas de cada fase, no los bordes: el texto esta armado antes del 10%,
    // el rostro entre 40% y 60%, y el contacto ya entero pasado el 90%.
    [0.05, 0.50, 0.96].forEach(v => pts.push(top + len * v));
  }
  snapPoints = pts.map(Math.round).sort((a, b) => a - b);
}

function updateSnap() {
  // En touch el scroll es nativo con inercia propia: snappear ahi pelea con el dedo
  if (!lenis || isTouch() || isPanelOpen || lenis.isStopped || !snapPoints.length) return;

  if (snapSkip && scrollY > snapSkip[0] && scrollY < snapSkip[1]) return;
  if (scrollY !== snapLastY) { snapLastY = scrollY; snapIdle = 0; return; }
  if (++snapIdle !== SNAP_IDLE) return;   // dispara una sola vez por reposo

  let best = snapPoints[0];
  for (const p of snapPoints) {
    if (Math.abs(p - scrollY) < Math.abs(best - scrollY)) best = p;
  }
  if (Math.abs(best - scrollY) < 3) return;   // ya esta ahi

  lenis.scrollTo(best, { duration: 1.0, easing: t => 1 - Math.pow(1 - t, 4) });
}

function updateScroll() {
  const progress = Math.max(0, Math.min(1, scrollY / HERO_FADE()));

  updateHeadline(progress);
  updateSectionNavActive();
}

// ─── CLIENTES (marquee) ──────────────────────────────────────────────────────
// Duplicar el set una sola vez no alcanza: si una vuelta mide menos que la
// pantalla, queda un hueco a la derecha. Se clona segun el ancho real y se
// recalcula al redimensionar.
function setupClients() {
  const el = document.getElementById('clients');
  if (!el) return;
  const track = el.querySelector('.clients-track');
  if (!track) return;

  const SPEED = 20;                              // px por segundo
  const base  = Array.from(track.children);      // el set original del HTML
  if (!base.length) return;

  function build() {
    // Volver al set base antes de medir
    track.replaceChildren(...base);

    // Con padding-left === gap, el ancho de una vuelta es el scrollWidth
    const pass = track.scrollWidth;
    if (!pass) return;

    // Una mitad tiene que cubrir el viewport para que nunca se vea el corte
    const copies = Math.max(1, Math.ceil(window.innerWidth / pass));

    const frag = document.createDocumentFragment();
    for (let i = 1; i < copies; i++) {
      base.forEach(n => frag.appendChild(n.cloneNode(true)));
    }
    track.appendChild(frag);

    // Duplicar la mitad entera: el -50% del keyframe cae sobre la copia
    const half = Array.from(track.children);
    const dup  = document.createDocumentFragment();
    half.forEach(n => {
      const c = n.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      dup.appendChild(c);
    });
    track.appendChild(dup);

    // Velocidad constante, no duracion fija: si la cinta crece, tarda mas
    const dist = copies * pass;
    track.style.setProperty('--marquee-dur', (dist / SPEED).toFixed(1) + 's');
  }

  // Medir antes de que carguen las imagenes da scrollWidth 0: esperar a que esten
  const imgs    = base.filter(n => n.tagName === 'IMG');
  let  pending  = imgs.filter(i => !i.complete).length;
  if (pending === 0) {
    build();
  } else {
    imgs.forEach(i => {
      if (i.complete) return;
      const done = () => { if (--pending === 0) build(); };
      i.addEventListener('load',  done, { once: true });
      i.addEventListener('error', done, { once: true });
    });
  }

  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(build, 180);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// LETS TALK — secuencia de 3 pasos: texto -> rostro -> contacto
// ═══════════════════════════════════════════════════════════════════════════════
const LETSTALK_VERT = /* glsl */`
  attribute float aRand;
  attribute float aDepth;
  attribute float aTone;    // 0 = zona clara · 1 = zona con tinta
  attribute float aEye;     // 1 en las pupilas, 0 en el resto de la cara
  attribute vec3  aScatter; // posicion dispersa, aleatoria uniforme en [-1,1]
  attribute vec2  aText;    // posicion en el texto, normalizada al medio ancho
  attribute float aMouth;   // + baja (mandibula) · - sube (labio superior)
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uSize;
  uniform float uDepth;
  uniform float uFace;      // 0 = texto · 1 = rostro
  uniform float uOut;       // 0 = rostro · 1 = disperso
  uniform float uIn;        // "cuan rostro es": uFace * (1 - uOut)
  uniform vec2  uEye;
  uniform vec2  uSpread;    // medio viewport en unidades de mundo
  uniform float uTextW;     // medio ancho del texto en unidades de mundo
  uniform float uFaceScale;
  uniform vec3  uDrift;     // amplitud: x texto · y rostro · z disperso
  uniform float uFieldA;    // opacidad del campo cuando NO es rostro
  uniform float uMouth;     // 0 cerrada · 1 bien abierta
  uniform float uMouthAmp;  // escala de la apertura
  varying float vFade;

  void main() {
    // Los tres destinos
    vec3 pText    = vec3(aText * uTextW, 0.0);   // plano: sin dispersion en Z
    vec3 pFace    = vec3(position.xy, (aDepth - 0.5) * uDepth);
    vec3 pScatter = aScatter * vec3(uSpread, 1.8);

    // Dos morphs encadenados: texto -> rostro -> disperso
    vec3 p = mix(pText, pFace, uFace);
    p = mix(p, pScatter, uOut);

    // Pupilas y boca solo se mueven cuando hay rostro
    p.xy += uEye * aEye * uIn;
    p.y  -= aMouth * uMouth * uMouthAmp * uIn;

    // Deriva propia. Cada particula lleva su frecuencia, sacada de aScatter:
    // con una sola frecuencia para todas, el conjunto late en bloque.
    vec3 drift = vec3(
      sin(uTime * (0.26 + 0.30 * abs(aScatter.x)) + aRand * 6.283),
      cos(uTime * (0.22 + 0.28 * abs(aScatter.y)) + aRand * 6.283),
      sin(uTime * (0.19 + 0.26 * abs(aScatter.z)) + aRand * 12.566)
    );
    // Encadenada igual que la posicion. Atarla a uIn era el error: en el texto
    // uIn vale 0 y tomaba la amplitud de disperso.
    p += drift * mix(mix(uDrift.x, uDrift.y, uFace), uDrift.z, uOut);

    vec2  d     = p.xy - uMouse;
    float force = smoothstep(0.50, 0.0, length(d)) * uIn;
    p.xy += normalize(d + 1e-5) * force * 0.26;
    p.z  += force * 0.20;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // Con rostro manda el tono de la foto; en texto y disperso, campo parejo
    float tone = 0.30 + 0.85 * aTone;   // el piso evita puntos sub-pixel
    float dz   = 0.55 + 0.45 * smoothstep(-0.5, 0.5, p.z);

    gl_PointSize = uSize * mix(0.60, tone * uFaceScale, uIn) * (1.0 / max(0.1, -mv.z));
    vFade = mix(uFieldA, tone * dz, uIn);
  }
`;

const LETSTALK_FRAG = /* glsl */`
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(uColor, vFade);
  }
`;

// Distancia de cada celda al borde de la silueta (chamfer de 2 pasadas).
// De aca sale el bulto de la cabeza, que es la profundidad que no da la foto.
function edgeDistance(mask, G) {
  const INF = 1e6, d = new Float32Array(G * G);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const i = y * G + x; if (d[i] === 0) continue;
    let v = d[i];
    if (x > 0)                 v = Math.min(v, d[i - 1] + 1);
    if (y > 0)                 v = Math.min(v, d[i - G] + 1);
    if (x > 0     && y > 0)    v = Math.min(v, d[i - G - 1] + 1.4142);
    if (x < G - 1 && y > 0)    v = Math.min(v, d[i - G + 1] + 1.4142);
    d[i] = v;
  }
  for (let y = G - 1; y >= 0; y--) for (let x = G - 1; x >= 0; x--) {
    const i = y * G + x; if (d[i] === 0) continue;
    let v = d[i];
    if (x < G - 1)             v = Math.min(v, d[i + 1] + 1);
    if (y < G - 1)             v = Math.min(v, d[i + G] + 1);
    if (x < G - 1 && y < G - 1) v = Math.min(v, d[i + G + 1] + 1.4142);
    if (x > 0     && y < G - 1) v = Math.min(v, d[i + G - 1] + 1.4142);
    d[i] = v;
  }
  return d;
}

// Muestrea un texto y devuelve puntos normalizados al MEDIO ANCHO, para que
// conserve su proporcion sea cual sea el tamaño con que se dibuje despues.
function sampleText(txt, fontCss, step) {
  const c   = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font  = fontCss;
  const m   = ctx.measureText(txt);
  const w   = Math.ceil(m.width) + 60;
  const h   = Math.ceil(parseInt(fontCss.match(/(\d+)px/)[1], 10) * 1.6);

  c.width = w; c.height = h;          // redimensionar resetea el contexto
  ctx.font = fontCss;                 // -> hay que volver a fijar la fuente
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(txt, w / 2, h / 2);

  const data = ctx.getImageData(0, 0, w, h).data;
  const half = w / 2, pts = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] > 100) {
        pts.push([(x - half) / half, -(y - h / 2) / half]);
      }
    }
  }
  return pts;
}

// ─── INCLINACION DEL TELEFONO ────────────────────────────────────────────────
// En mobile no hay cursor, asi que la cara sigue como esta parado el telefono.
// Alimenta las mismas variables que el mouse: el suavizado, los topes y el
// desfase entre ojos y cuello no se tocan.
function setupTilt(host, apply) {
  if (!isTouch() || typeof DeviceOrientationEvent === 'undefined') return;

  let base = null;    // postura de referencia
  let idle = null;

  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;

    // Rotar la pantalla intercambia los ejes del sensor
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let x, y;
    if      (ang === 90)                 { x = -e.beta;  y =  e.gamma; }
    else if (ang === 270 || ang === -90) { x =  e.beta;  y = -e.gamma; }
    else                                 { x =  e.gamma; y =  e.beta;  }

    // Nadie sostiene el telefono en cero: la primera lectura es el punto neutro
    // y se trabaja con la diferencia.
    if (!base) base = { x, y };
    const cl = v => Math.max(-1, Math.min(1, v));
    apply(cl((x - base.x) / 26), cl((y - base.y) / 26));

    // Si queda quieto un rato, se recalibra: la postura comoda cambia sola
    clearTimeout(idle);
    idle = setTimeout(() => { base = { x, y }; }, 2500);
  }

  const start = () => window.addEventListener('deviceorientation', onOrient);

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ exige permiso, y solo lo acepta desde un gesto del usuario. Se
    // pide al primer toque DENTRO de la seccion, asi el dialogo del sistema
    // aparece mirando la cara y no suelto al entrar al sitio.
    host.addEventListener('touchend', () => {
      DeviceOrientationEvent.requestPermission()
        .then(r => { if (r === 'granted') start(); })
        .catch(() => { /* lo rechazo: queda quieta, no se rompe nada */ });
    }, { once: true });
  } else {
    start();   // Android arranca sin pedir nada
  }
}

function setupLetsTalk() {
  const track   = document.getElementById('letsTalk');        // el recorrido alto
  const wrap    = document.getElementById('letsTalkSticky');  // lo que se ve
  const canvas  = document.getElementById('letsTalkCanvas');
  const contact = document.getElementById('letsTalkContact');
  const label   = document.getElementById('letsTalkLabel');
  if (!track || !wrap || !canvas) return;

  const SRC   = new URL('../img/image-face.webp', import.meta.url).href;
  // Menos densidad en mobile: 28.000 particulas con shader propio es mucho
  // para un telefono, y a ese tamaño de pantalla el detalle no se aprecia.
  const GRID   = isMobile() ? 170 : 260;
  // Mas chico en mobile: a 1.38 el rostro ocupaba casi toda la pantalla y se
  // montaba sobre los botones de pregunta.
  const SCALE  = isMobile() ? 0.88 : 1.38;
  const BASE_H = 900;   // alto de viewport de referencia para el tamaño de punto
  const PT     = 14.5;  // tamaño base del punto (fase dispersa)
  const FACE_SCALE = 0.35;  // factor al armarse la cara — 1 = igual que disperso
  const DRIFT_TEXT    = 0.0016; // casi quieto: el texto tiene que leerse plano
  const DRIFT_SCATTER = 0.105; // deriva con las particulas sueltas
  const DRIFT_FACE    = 0.014; // deriva con el rostro armado (no puede borronearlo)
  const MOUTH_AMP = 0.15;  // apertura de la boca — 1 seria la mandibula entera
  const TEXT      = "Let's Talk?";
  const TEXT_FONT = "200 220px 'Geist Mono', monospace";

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = SRC;
  img.onload = () => { try { build(); } catch (e) { console.warn('[letstalk]', e); } };

  function build() {
    const c   = document.createElement('canvas');
    c.width   = c.height = GRID;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, GRID, GRID);
    const data = ctx.getImageData(0, 0, GRID, GRID).data;

    // Silueta
    const mask = new Uint8Array(GRID * GRID);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= 80 ? 1 : 0;

    const dist = edgeDistance(mask, GRID);
    let maxD = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > maxD) maxD = dist[i];

    // Pupilas, medidas sobre la imagen (normalizado 0..1)
    const EYES   = [[0.384, 0.501], [0.632, 0.496]];
    const EYE_IN = 0.018, EYE_OUT = 0.036;   // radio pleno y caida a cero
    // Boca, medida sobre la imagen igual que las pupilas
    // rx ajustado al medio ancho real de los labios (0.103 medido sobre la foto).
    // jawW acompaña: si es muy ancho, la mandibula arrastra los cachetes.
    const MOUTH = { x: 0.517, y: 0.786, rx: 0.100, ry: 0.090, jawW: 0.150 };

    const pos = [], rnd = [], dep = [], ton = [], eye = [], sct = [], mth = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const i = y * GRID + x;
        if (!mask[i]) continue;
        const j   = i * 4;
        const lum = (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) / 255;

        // Bulto: sqrt para que suba rapido en el borde y se aplane en el centro,
        // como una cabeza. Mas un toque de luminancia para el relieve fino
        // (en luz frontal, lo iluminado esta mas cerca).
        const dome = Math.sqrt(dist[i] / maxD);
        dep.push(0.72 * dome + 0.28 * lum);
        ton.push(lum);

        // Peso de pupila: 1 en el centro, con caida suave hasta EYE_OUT
        const nx = x / GRID, ny = y / GRID;
        let w = 0;
        for (const [ex, ey] of EYES) {
          const r = Math.hypot(nx - ex, ny - ey);
          if (r < EYE_OUT) {
            const t = 1 - Math.max(0, (r - EYE_IN) / (EYE_OUT - EYE_IN));
            w = Math.max(w, Math.min(1, t) ** 2);   // cuadratico: borde mas suave
          }
        }
        eye.push(w);

        // Boca: elipse sobre los labios (medida sobre la foto). El labio de
        // arriba sube poco y la mandibula entera baja: eso es lo exagerado.
        const dm = Math.hypot((nx - MOUTH.x) / MOUTH.rx, (ny - MOUTH.y) / MOUTH.ry);
        let mw = dm < 1 ? Math.pow(1 - dm, 0.6) * (ny > MOUTH.y ? 1 : -0.40) : 0;
        if (ny > MOUTH.y) {
          const jaw  = Math.min(1, (ny - MOUTH.y) / 0.17);
          const cent = Math.max(0, 1 - Math.abs(nx - MOUTH.x) / MOUTH.jawW);
          mw += jaw * cent * 0.55;
        }
        mth.push(mw);

        pos.push( (x / GRID - 0.5) * 2 * SCALE,
                 -(y / GRID - 0.5) * 2 * SCALE, 0);
        rnd.push(Math.random());
        sct.push(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      }
    }
    if (!pos.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aRand',    new THREE.Float32BufferAttribute(rnd, 1));
    geo.setAttribute('aDepth',   new THREE.Float32BufferAttribute(dep, 1));
    geo.setAttribute('aTone',    new THREE.Float32BufferAttribute(ton, 1));
    geo.setAttribute('aEye',     new THREE.Float32BufferAttribute(eye, 1));
    geo.setAttribute('aScatter', new THREE.Float32BufferAttribute(sct, 3));
    geo.setAttribute('aMouth',   new THREE.Float32BufferAttribute(mth, 1));

    // ── Destino de texto ──
    // Hay mas particulas que puntos de texto, asi que varias comparten punto.
    // El orden se mezcla antes de repartir: si se asignara en secuencia, las
    // particulas vecinas de la cara caerian juntas y el texto saldria a parches.
    const tpts = sampleText(TEXT, TEXT_FONT, 1);   // paso fino: sin huecos
    const n    = pos.length / 3;
    const txt  = new Float32Array(n * 2);
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // Recorrido parejo: sirve haya mas puntos que particulas o al reves. Con
    // modulo, si sobraban puntos solo se llenaba el principio del texto.
    const J = 0.0008;  // jitter por debajo de la separacion entre puntos
    order.forEach((pi, k) => {
      const t = tpts.length ? tpts[Math.floor(k * tpts.length / n)] : [0, 0];
      txt[pi * 2]     = t[0] + (Math.random() - 0.5) * J;
      txt[pi * 2 + 1] = t[1] + (Math.random() - 0.5) * J;
    });
    geo.setAttribute('aText', new THREE.BufferAttribute(txt, 2));
    console.log('[letstalk]', n, 'particulas ·', tpts.length, 'puntos de texto');
    console.log('[letstalk]', pos.length / 3, 'particulas ·',
                eye.filter(v => v > 0.05).length, 'en las pupilas');
    const toneAttr = geo.getAttribute('aTone');

    const uniforms = {
      uTime:  { value: 0 },
      uMouse: { value: new THREE.Vector2(99, 99) },
      uSize:  { value: 4.2 },
      uDepth: { value: 0.95 },
      uIn:    { value: 0 },
      uEye:   { value: new THREE.Vector2(0, 0) },
      uSpread:{ value: new THREE.Vector2(3, 2) },
      uFaceScale: { value: FACE_SCALE },
      uDrift: { value: new THREE.Vector3(DRIFT_TEXT, DRIFT_FACE, DRIFT_SCATTER) },
      uFace:   { value: 0 },
      uOut:    { value: 0 },
      uTextW:  { value: 2 },
      uFieldA: { value: 0.95 },
      uMouth:  { value: 0 },
      uMouthAmp: { value: MOUTH_AMP },
      uColor: { value: new THREE.Color(0x111111) },
    };

    const points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms, vertexShader: LETSTALK_VERT, fragmentShader: LETSTALK_FRAG,
      transparent: true, depthWrite: false,
    }));

    const scene = new THREE.Scene(); scene.add(points);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 4;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearAlpha(0);

    let trackTop = 0, trackLen = 1;

    function resize() {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      uniforms.uSize.value = PT * dpr * (r.height / BASE_H);

      // En mobile sube: el chat vive en la mitad de abajo de la pantalla
      points.position.y = isMobile() ? 0.72 : 0;

      // Medio viewport en unidades de mundo: las dispersas tienen que llegar
      // a los bordes de la pantalla, no a una caja fija.
      const visH = 2 * Math.tan((45 * Math.PI / 180) / 2) * camera.position.z;
      uniforms.uSpread.value.set(visH * camera.aspect * 0.52, visH * 0.52);

      // El texto ocupa el 74% del ancho, pero sin pasarse de alto en pantallas
      // angostas (aText conserva la proporcion, asi que basta con el ancho)
      const visW = visH * camera.aspect;
      uniforms.uTextW.value = Math.min(visW * 0.37, visH * 1.30);

      // Recorrido del pinned, medido aca y no por frame
      const tr = track.getBoundingClientRect();
      trackTop = tr.top + window.scrollY;
      trackLen = Math.max(1, track.offsetHeight - window.innerHeight);
    }
    resize();
    window.addEventListener('resize', resize);

    // En claro la tinta oscura dibuja; en oscuro dibuja la luz. Hay que invertir
    // el tono o el retrato sale en negativo.
    function syncTheme() {
      const dark = document.documentElement.classList.contains('dark');
      const col  = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
      if (col) uniforms.uColor.value.set(col);
      for (let i = 0; i < ton.length; i++) toneAttr.setX(i, dark ? ton[i] : 1 - ton[i]);
      toneAttr.needsUpdate = true;
    }
    syncTheme();
    new MutationObserver(syncTheme)
      .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // ── La cara mira al cursor ──
    // Con el telefono en la mano es facil pasarse de giro, asi que los topes
    // son mas cortos que con el mouse.
    const MAX_YAW   = isTouch() ? 0.28 : 0.42;   // ~16 / ~24 grados
    const MAX_PITCH = isTouch() ? 0.17 : 0.26;   // ~10 / ~15 grados
    const EYE_X     = 0.030;  // cuanto viaja la pupila (unidades de mundo)
    const EYE_Y     = 0.020;  // vertical siempre menos que horizontal
    let tarYaw = 0, tarPitch = 0, yaw = 0, pitch = 0;
    let tarEyeX = 0, tarEyeY = 0;

    document.addEventListener('mousemove', e => {
      const r  = wrap.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const nx = (e.clientX - (r.left + r.width  / 2)) / (r.width  / 2);
      const ny = (e.clientY - (r.top  + r.height / 2)) / (r.height / 2);
      const cl = v => Math.max(-1, Math.min(1, v));
      // Signos segun la rotacion de three: +Y lleva la nariz a la derecha,
      // +X la lleva hacia abajo.
      tarYaw   = cl(nx) * MAX_YAW;
      tarPitch = cl(ny) * MAX_PITCH;
      // Y de pantalla crece hacia abajo, el de mundo hacia arriba: se invierte
      tarEyeX  =  cl(nx) * EYE_X;
      tarEyeY  = -cl(ny) * EYE_Y;
    });

    // En mobile las mismas cuatro variables las escribe el giroscopio
    setupTilt(wrap, (nx, ny) => {
      tarYaw   =  nx * MAX_YAW;
      tarPitch =  ny * MAX_PITCH;
      tarEyeX  =  nx * EYE_X;
      tarEyeY  = -ny * EYE_Y;
    });

    let mx = 99, my = 99;
    wrap.addEventListener('mousemove', e => {
      const r = wrap.getBoundingClientRect();
      const vh = 2 * Math.tan((45 * Math.PI / 180) / 2) * camera.position.z;
      const vw = vh * (r.width / r.height);
      mx =  ((e.clientX - r.left) / r.width  - 0.5) * vw;
      my = -((e.clientY - r.top)  / r.height - 0.5) * vh;
    });
    wrap.addEventListener('mouseleave', () => { mx = 99; my = 99; });

    const updateChat = setupLetsTalkChat({ wrap, uniforms });

    let visible = false, raf = null, t0 = performance.now();
    let contactOn = false;
    new IntersectionObserver(es => es.forEach(e => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(loop);
    }), { threshold: 0.05 }).observe(wrap);

    function loop(now) {
      if (!visible) { raf = null; return; }
      const time = (now - t0) / 1000;
      uniforms.uTime.value = time;
      // ── Fases, manejadas por el scroll dentro del track ──
      const cl = v => Math.max(0, Math.min(1, v));
      const p  = cl((scrollY - trackTop) / trackLen);

      // 1 · texto "Hablamos?"   2 · rostro   3 · disperso + contacto
      const toFace = smoothstep(cl((p - 0.10) / 0.30));   // 10% -> 40%
      const toOut  = smoothstep(cl((p - 0.60) / 0.30));   // 60% -> 90%
      const faceness = toFace * (1 - toOut);

      uniforms.uFace.value = toFace;
      uniforms.uOut.value  = toOut;
      uniforms.uIn.value   = faceness;
      // El campo de puntos se ve mas en el texto que de fondo del contacto
      uniforms.uFieldA.value = 0.95 - 0.67 * toOut;   // texto solido · fondo tenue

      // El contacto entra mientras las particulas se van abriendo
      const ct = smoothstep(cl((p - 0.66) / 0.22));
      if (contact) {
        contact.style.opacity = ct;
        const on = ct > 0.5;
        if (on !== contactOn) {
          contactOn = on;
          contact.classList.toggle('visible', on);
          contact.setAttribute('aria-hidden', on ? 'false' : 'true');
          contact.querySelectorAll('a').forEach(a => a.tabIndex = on ? 0 : -1);
        }
      }
      if (label) label.style.opacity = faceness * (1 - ct);
      if (updateChat) updateChat(faceness * (1 - ct));
      uniforms.uMouse.value.x += (mx - uniforms.uMouse.value.x) * 0.12;
      uniforms.uMouse.value.y += (my - uniforms.uMouse.value.y) * 0.12;

      // Sigue al cursor con retardo, mas una respiracion minima para que
      // nunca quede del todo congelada
      yaw   += (tarYaw   - yaw)   * 0.055;
      pitch += (tarPitch - pitch) * 0.055;
      // Los ojos llegan antes que la cabeza: se mueven primero y el cuello sigue
      const ue = uniforms.uEye.value;
      ue.x += (tarEyeX - ue.x) * 0.13;
      ue.y += (tarEyeY - ue.y) * 0.13;

      points.rotation.y = yaw   * faceness + Math.sin(time * 0.20) * 0.020;
      points.rotation.x = pitch * faceness + Math.sin(time * 0.15) * 0.015;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
  }
}

// ─── GUION DEL CHAT ──────────────────────────────────────────────────────────
// El contenido vive en lets-talk-chat.txt, en la raiz del proyecto, para poder
// editarlo sin tocar codigo. Vite lo empaqueta y en dev recarga al guardarlo.
import rawChat from '../lets-talk-chat.txt?raw';

function parseChatScript(txt) {
  const qa = [];
  let fallback = {};

  for (const block of txt.replace(/\r/g, '').split(/^-{3,}$/m)) {
    const lines = block.split('\n').filter(l => !l.trim().startsWith('#'));
    let chip = {}, keys = [], body = {}, mode = '', cur = '';

    for (const line of lines) {
      const m = line.match(/^(CHIP|KEYS|ANSWER|FALLBACK)(_[A-Z]{2})?\s*:\s*(.*)$/i);
      if (m) {
        const base = m[1].toUpperCase();
        const sfx  = (m[2] || '').toLowerCase();
        const v    = m[3];
        mode = base;
        if      (base === 'CHIP') chip['chip' + sfx] = v.trim();
        else if (base === 'KEYS') keys = v.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        else { cur = (base === 'FALLBACK' ? 'fb' : 'a') + sfx; body[cur] = [v]; }
      } else if (cur) {
        body[cur].push(line);                             // respuesta multilinea
      }
    }

    const texts = {};
    for (const k in body) texts[k] = body[k].join('\n').trim();
    const isFb = Object.keys(texts).some(k => k.startsWith('fb'));
    if (isFb) { fallback = texts; continue; }
    if (Object.keys(chip).length) qa.push({ ...chip, keys, ...texts });
  }
  return { qa, fallback };
}

const _chat      = parseChatScript(rawChat);
// Si el archivo quedara mal escrito, el chat no se rompe: solo no ofrece chips
const LT_QA       = _chat.qa;
const LT_FALLBACK = _chat.fallback;

// Vocal -> boca bien abierta. Es lo que hace que se lea como que habla.
function mouthForChar(ch) {
  const c = ch.toLowerCase();
  if ('aáeéoó'.includes(c)) return 1.00;
  if ('iíuúy'.includes(c))  return 0.55;
  if (' \n\t.,;:!?'.includes(c)) return 0.00;
  return 0.34;
}

function setupLetsTalkChat({ wrap, uniforms, faceness }) {
  const chat  = document.getElementById('ltChat');
  const log   = document.getElementById('ltLog');
  const chips = document.getElementById('ltChips');
  const form  = document.getElementById('ltForm');
  const input = document.getElementById('ltInput');
  const send  = form && form.querySelector('.lt-send');
  if (!chat || !log || !form) return null;

  let open = false, speaking = false;
  let mouthTarget = 0;

  // Congelar el scroll mientras se usa el chat: si no, la cara se deshace
  // en mitad de la conversacion (el rostro solo se sostiene ~56vh).
  function lock(on) {
    if (on === open) return;
    open = on;
    if (!lenis) return;
    on ? lenis.stop() : lenis.start();
  }

  function bubble(text, who) {
    const el = document.createElement('div');
    el.className = `lt-bubble lt-bubble--${who}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  // Escribe la respuesta letra por letra y mueve la boca con el mismo reloj
  function speak(text) {
    speaking = true;
    if (send) send.disabled = true;
    const el = bubble('', 'face');
    let i = 0;
    const MS = 42;

    (function step() {
      if (i >= text.length) {
        mouthTarget = 0;
        speaking = false;
        if (send) send.disabled = false;
        return;
      }
      const ch = text[i++];
      el.textContent += ch;
      mouthTarget = mouthForChar(ch);
      log.scrollTop = log.scrollHeight;
      setTimeout(step, ch === ' ' ? MS * 0.6 : MS);
    })();
  }

  function answerFor(q) {
    const n = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let best = null, score = 0;
    for (const item of LT_QA) {
      const s = item.keys.reduce((acc, k) => acc + (n.includes(k) ? 1 : 0), 0);
      if (s > score) { score = s; best = item; }
    }
    return best ? pick(best, 'a') : (pick(LT_FALLBACK, 'fb') || 'matiasduclosmd@gmail.com');
  }

  function ask(q) {
    if (speaking || !q.trim()) return;
    bubble(q.trim(), 'me');
    input.value = '';
    // Pausa corta: el rostro "piensa" antes de contestar
    setTimeout(() => speak(answerFor(q)), 420);
  }

  LT_QA.forEach(item => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lt-chip';
    b.tabIndex = -1;
    b.textContent = pick(item, 'chip');
    b.addEventListener('click', () => ask(pick(item, 'chip')));
    chips.appendChild(b);
  });

  form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });

  // Los chips se reescriben al cambiar de idioma
  onLangChange(() => {
    [...chips.children].forEach((b, i) => { if (LT_QA[i]) b.textContent = pick(LT_QA[i], 'chip'); });
  });
  chat.addEventListener('mouseenter', () => lock(true));
  chat.addEventListener('mouseleave', () => { if (document.activeElement !== input) lock(false); });
  input.addEventListener('focus', () => lock(true));
  input.addEventListener('blur',  () => lock(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) { input.blur(); lock(false); }
  });

  let wasOn = false;
  return function update(f) {
    // Solo existe con el rostro armado
    chat.style.opacity = f;
    const on = f > 0.6;
    if (on !== wasOn) {
      wasOn = on;
      chat.classList.toggle('visible', on);
      chat.setAttribute('aria-hidden', on ? 'false' : 'true');
      chat.querySelectorAll('input, button').forEach(el => { el.tabIndex = on ? 0 : -1; });
      if (!on) lock(false);
    }
    // Suavizado: sin esto la boca saltaria de golpe en cada letra
    const u = uniforms.uMouth;
    u.value += (mouthTarget - u.value) * (mouthTarget > u.value ? 0.45 : 0.22);
  };
}

let _snapRz = null;
window.addEventListener('resize', () => {
  clearTimeout(_snapRz);
  _snapRz = setTimeout(buildSnapPoints, 200);
});

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

function resetPeek() { peekTarget = 0; peekCur = 0; peekLast = -1; }

function updatePanelPeek() {
  // Mientras el panel esta abierto o animandose, la x la maneja GSAP
  if (isPanelOpen || panelBusy) return;
  peekCur = lerp(peekCur, peekTarget, 0.14);
  if (Math.abs(peekCur - peekLast) < 0.0015) return;
  peekLast = peekCur;
  // offsetWidth y no getPanelW(): el ancho real lo define el CSS por breakpoint
  gsap.set(matiMenuEl, { x: -matiMenuEl.offsetWidth + PEEK_MAX * peekCur });
}

function openPanel() {
  isPanelOpen = true;
  panelBusy   = true;
  resetPeek();

  // Panel + stage slide together — expo.out: arranca rápido, frena suave
  const pw = getPanelW();
  gsap.to(matiMenuEl, { x: 0, duration: 0.72, ease: 'expo.out',
    onComplete: () => { panelBusy = false; } });
  // stage (hero fijo) y scroll-content (la lista) se mueven juntos: si no, la
  // lista se queda quieta mientras el hero se corre.
  gsap.to([stageEl, scrollContentEl, chromeEl], { x: pw, duration: 0.72, ease: 'expo.out' });

  // Contenido entra junto con el panel, sin delays grandes
  gsap.from('.panel-name span', { x: -16, opacity: 0, duration: 0.55, stagger: 0.06, delay: 0.05, ease: 'power3.out' });
  gsap.from('.panel-tag',       { opacity: 0, duration: 0.35, stagger: 0.03, delay: 0.12, ease: 'power2.out' });
  gsap.from('.panel-section',   { x: -12, opacity: 0, duration: 0.45, stagger: 0.05, delay: 0.1, ease: 'power3.out' });
}

function closePanel() {
  isPanelOpen = false;
  panelBusy   = true;
  resetPeek();
  gsap.to(matiMenuEl, { x: '-100%', duration: 0.5, ease: 'expo.inOut',
    onComplete: () => { panelBusy = false; } });
  gsap.to([stageEl, scrollContentEl, chromeEl], { x: 0, duration: 0.5, ease: 'expo.inOut' });
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

  // Peek por cercania al borde — solo con mouse
  if (!isTouch()) {
    document.addEventListener('mousemove', e => {
      peekTarget = isPanelOpen ? 0 : Math.max(0, 1 - e.clientX / PEEK_ZONE);
    });
    document.addEventListener('mouseleave', () => { peekTarget = 0; });
    // Un click en la porcion asomada lo abre del todo
    matiMenuEl.addEventListener('click', () => { if (!isPanelOpen) openPanel(); });
  }

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

  updatePanelPeek();

  // Lenis + cards (ready after fonts)
  if (lenis) {
    lenis.raf(time);
    scrollY = window.scrollY;
    updateScroll();
    updateManifesto();
    if (mfDrop) mfDrop();
    updateSnap();
  }

  // Three.js del hero. Es un fragment shader a pantalla completa con fbm de 4
  // octavas: el gasto mas grande del sitio. Pasado el spacer queda tapado por
  // el manifiesto, asi que no tiene sentido seguir dibujandolo.
  if (threeState.renderer && scrollY < window.innerHeight * 1.05) {
    const { renderer, scene, camera, uniforms, clock } = threeState;
    uniforms.uTime.value = clock.getElapsedTime();
    renderer.render(scene, camera);
  }
}


// ─── SECTION NAV ─────────────────────────────────────────────────────────────
function setupSectionNav() {
  gsap.set(sectionNavEl, { yPercent: -50 });
  document.querySelectorAll('.section-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      let target = 0;
      if (section === 'works') {
        const el = document.getElementById('works');
        target = el ? el.offsetTop : 0;
      }
      lenis.scrollTo(target, { duration: 1.6, easing: t => 1 - Math.pow(1 - t, 4) });
    });
  });
}

// Cacheados: antes esto hacia getElementById + querySelectorAll + una lectura
// de offsetTop (reflow forzado) en cada frame.
let navItems = null, navWorksTop = 0, navLast = '';

function updateSectionNavActive() {
  if (!sectionNavEl) return;
  if (!navItems) navItems = [...sectionNavEl.querySelectorAll('.section-nav-item')];
  const active = navWorksTop && scrollY >= navWorksTop - window.innerHeight * 0.5
    ? 'works' : 'home';
  if (active === navLast) return;        // solo tocar el DOM cuando cambia
  navLast = active;
  navItems.forEach(i => i.classList.toggle('active', i.dataset.section === active));
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
        const MSG  = t('hero.msg');
        const para = PARA_TEXT();
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
          heroParaEl.textContent += para[pi++];
          if (pi >= para.length) {
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
    const progress = Math.min(1, scrollY / HERO_FADE());
    const alpha    = 1 - smoothstep(Math.max(0, Math.min(1, (progress - 0.35) / 0.35)));
    if (Math.abs(alpha - lastAlpha) > 0.004) {
      canvas.style.opacity = alpha;
      lastAlpha = alpha;
    }

    // Invisible y sin rastro: no hay por que seguir pintando el canvas entero
    if (alpha < 0.01 && sr < 0.5) return;

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
