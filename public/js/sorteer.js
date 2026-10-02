// Sorteren door slepen: muis/pen na 4 px, vinger na 450 ms vasthouden (Pointer Events).
// maakSorteerbaar(lijstEl, { itemSelector, isVersleepbaar(el), opVolgorde(van, naar) })
// -> { vernietig() }. Indices = posities onder de elementen die aan itemSelector voldoen,
// in DOM-volgorde bij de start; naar = positie waar het item komt te staan.
const HOUD_MS = 450;        // aanraken: vasthouden voor het slepen begint
const HOUD_TOLERANTIE = 8;  // aanraken: meer beweging dan dit = scrollen, geen slepen
const MUIS_DREMPEL = 4;     // muis/pen: slepen begint na zoveel px
const RAND = 40;            // auto-scroll binnen zoveel px van de rand

export function maakSorteerbaar(lijstEl, opts) {
  const { itemSelector, isVersleepbaar, opVolgorde } = opts;
  let s = null; // actieve pointer-toestand

  const items = () => Array.from(lijstEl.querySelectorAll(itemSelector));

  function scrollbareOuder(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null; // venster
  }

  function stopAlles() {
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    if (s.raf) cancelAnimationFrame(s.raf);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey);
    if (s.actief) {
      const el = s.el;
      try { el.releasePointerCapture(s.id); } catch (_) {}
      el.classList.remove('sorteer-actief');
      el.style.position = el.style.left = el.style.top = el.style.width = '';
      el.style.transform = el.style.zIndex = el.style.touchAction = '';
      s.placeholder?.remove();
    }
    s = null;
  }

  function begin() {
    const el = s.el;
    const r = el.getBoundingClientRect();
    s.actief = true;
    s.ouder = scrollbareOuder(el);
    s.van = items().indexOf(el);
    s.startTop = r.top;
    const ph = document.createElement('div');
    ph.className = 'sorteer-placeholder';
    ph.style.height = r.height + 'px';
    el.parentNode.insertBefore(ph, el);
    s.placeholder = ph;
    el.classList.add('sorteer-actief');
    el.style.position = 'fixed';
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    el.style.width = r.width + 'px';
    el.style.zIndex = '50';
    el.style.touchAction = 'none';
    try { el.setPointerCapture(s.id); } catch (_) {}
    navigator.vibrate?.(15);
    volg();
    lus();
  }

  function volg() {
    s.el.style.transform = `translateY(${s.y - s.startY}px)`;
    // Placeholder verplaatsen: vóór het eerste andere item waarvan het midden onder de vinger ligt.
    const anderen = items().filter(x => x !== s.el);
    const ph = s.placeholder;
    let doel = null;
    for (const x of anderen) {
      const b = x.getBoundingClientRect();
      if (s.y < b.top + b.height / 2) { doel = x; break; }
    }
    if (doel) {
      // vóór de eventuele rit-regel (stop-leg) van dat doel, zodat de rit bij het doel blijft
      let anker = doel;
      const vorige = doel.previousElementSibling;
      if (vorige && vorige !== ph && vorige.classList.contains('stop-leg')) anker = vorige;
      if (ph.nextElementSibling !== anker) anker.parentNode.insertBefore(ph, anker);
    } else if (anderen.length) {
      const laatste = anderen[anderen.length - 1];
      if (ph.previousElementSibling !== laatste) laatste.after(ph);
    }
  }

  function lus() {
    if (!s || !s.actief) return;
    const kader = s.ouder ? s.ouder.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    let dy = 0;
    if (s.y < kader.top + RAND) dy = -Math.ceil((kader.top + RAND - s.y) / 4);
    else if (s.y > kader.bottom - RAND) dy = Math.ceil((s.y - (kader.bottom - RAND)) / 4);
    if (dy) {
      if (s.ouder) s.ouder.scrollTop += dy; else window.scrollBy(0, dy);
      volg();
    }
    s.raf = requestAnimationFrame(lus);
  }

  function onDown(e) {
    if (s) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target.closest?.(itemSelector);
    if (!el || !lijstEl.contains(el) || !isVersleepbaar(el)) return;
    if (e.target.closest('button, a, input, select, textarea, label')) return;
    s = { el, id: e.pointerId, type: e.pointerType, startX: e.clientX, startY: e.clientY,
          x: e.clientX, y: e.clientY, actief: false, timer: null, raf: 0 };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey);
    if (e.pointerType === 'touch') s.timer = setTimeout(() => { s.timer = null; begin(); }, HOUD_MS);
  }

  function onMove(e) {
    if (!s || e.pointerId !== s.id) return;
    s.x = e.clientX; s.y = e.clientY;
    if (!s.actief) {
      const afstand = Math.hypot(s.x - s.startX, s.y - s.startY);
      if (s.type === 'touch') { if (afstand > HOUD_TOLERANTIE) stopAlles(); }
      else if (afstand > MUIS_DREMPEL) { s.startX = s.x; s.startY = s.y; begin(); }
      return;
    }
    e.preventDefault();
    volg();
  }

  // Na een sleepbeweging mag de daaropvolgende klik het kaartje niet openen.
  function slokKlik() {
    const slok = ev => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', slok, true);
    setTimeout(() => document.removeEventListener('click', slok, true), 350);
  }

  function onUp(e) {
    if (!s || e.pointerId !== s.id) return;
    if (!s.actief) { stopAlles(); return; }
    const el = s.el;
    const ph = s.placeholder;
    // Eindindex = aantal andere items vóór de placeholder.
    let naar = 0;
    for (const x of items()) {
      if (x === el) continue;
      if (ph.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_PRECEDING) naar++;
    }
    const van = s.van;
    stopAlles();
    slokKlik();
    if (van !== naar) opVolgorde(van, naar);
  }

  function annuleer() {
    const was = s.actief;
    stopAlles();
    if (was) slokKlik();
  }
  function onCancel(e) { if (s && e.pointerId === s.id) annuleer(); }
  function onKey(e) { if (s && e.key === 'Escape') annuleer(); }

  // Tijdens het slepen met de vinger mag de pagina niet meescrollen. touch-action wordt pas
  // bij touchstart geëvalueerd, dus daarnaast een niet-passieve touchmove.
  function onTouchMove(e) { if (s?.actief) e.preventDefault(); }
  function onContext(e) { if (s && s.type === 'touch') e.preventDefault(); }

  lijstEl.addEventListener('pointerdown', onDown);
  lijstEl.addEventListener('touchmove', onTouchMove, { passive: false });
  lijstEl.addEventListener('contextmenu', onContext);

  return {
    vernietig() {
      stopAlles();
      lijstEl.removeEventListener('pointerdown', onDown);
      lijstEl.removeEventListener('touchmove', onTouchMove);
      lijstEl.removeEventListener('contextmenu', onContext);
    },
  };
}

