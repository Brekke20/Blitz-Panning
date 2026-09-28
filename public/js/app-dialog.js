// In-app bevestigingsvenster (vervangt window.confirm). Zet window.appConfirm.
// onBevestig wordt SYNCHROON in de klik-handler aangeroepen, vóór de Promise resolvet,
// zodat bv. window.open zijn user activation behoudt.

let _actief = null; // { overlay, sluit(waarde) } van het openstaande venster

export function appConfirm({ titel, tekst, bevestigLabel, annuleerLabel = 'Terug', gevaar = false, onBevestig } = {}) {
  // Nog een venster open? Dat oude resolvet met false en wordt vervangen.
  if (_actief) _actief.sluit(false);

  return new Promise(resolve => {
    const vorigeFocus = document.activeElement;
    const uid = 'appdlg-' + Date.now();

    const overlay = document.createElement('div');
    overlay.className = 'overlay open app-dialog-overlay';

    const dlg = document.createElement('div');
    dlg.className = 'modal app-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', uid + '-titel');

    const kop = document.createElement('div');
    kop.className = 'app-dialog-titel';
    kop.id = uid + '-titel';
    kop.textContent = titel || '';
    dlg.appendChild(kop);

    const regels = Array.isArray(tekst) ? tekst : (tekst ? [tekst] : []);
    if (regels.length) {
      let body;
      if (Array.isArray(tekst)) {
        body = document.createElement('ul');
        regels.forEach(r => { const li = document.createElement('li'); li.textContent = r; body.appendChild(li); });
      } else {
        body = document.createElement('p');
        body.textContent = tekst;
      }
      body.className = 'app-dialog-tekst';
      dlg.appendChild(body);
    }

    const knoppen = document.createElement('div');
    knoppen.className = 'app-dialog-knoppen';
    const btnAnnuleer = document.createElement('button');
    btnAnnuleer.type = 'button';
    btnAnnuleer.className = 'app-dialog-btn app-dialog-annuleer';
    btnAnnuleer.textContent = annuleerLabel;
    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'app-dialog-btn app-dialog-ok' + (gevaar ? ' gevaar' : '');
    btnOk.textContent = bevestigLabel || 'OK';
    knoppen.append(btnAnnuleer, btnOk);
    dlg.appendChild(knoppen);
    overlay.appendChild(dlg);

    let klaar = false;
    const sluit = waarde => {
      if (klaar) return;
      klaar = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (_actief && _actief.overlay === overlay) _actief = null;
      if (vorigeFocus && typeof vorigeFocus.focus === 'function' && document.contains(vorigeFocus)) {
        try { vorigeFocus.focus(); } catch (e) {}
      }
      resolve(waarde);
    };

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        sluit(false);
      } else if (e.key === 'Tab') {
        // Focus-lus binnen het venster
        const lijst = [btnAnnuleer, btnOk];
        const i = lijst.indexOf(document.activeElement);
        e.preventDefault();
        let n;
        if (e.shiftKey) n = i <= 0 ? lijst.length - 1 : i - 1;
        else n = i < 0 || i === lijst.length - 1 ? 0 : i + 1;
        lijst[n].focus();
      }
    }

    btnAnnuleer.addEventListener('click', () => sluit(false));
    btnOk.addEventListener('click', () => {
      if (typeof onBevestig === 'function') {
        try { onBevestig(); } catch (err) { console.error('appConfirm onBevestig:', err); }
      }
      sluit(true);
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) sluit(false); });
    document.addEventListener('keydown', onKey, true);

    _actief = { overlay, sluit };
    document.body.appendChild(overlay);
    btnAnnuleer.focus();
  });
}

window.appConfirm = appConfirm;
