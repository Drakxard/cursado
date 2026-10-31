/* Cursado host bridge. Audio stays in the browser; no download dialog. */
(function () {
  'use strict';
  var app = window.PKAudioEditor;
  var dirty = false, recording = false;
  function send(type, value) { if (type === 'error') { saveError(value.error); return; } parent.postMessage(Object.assign({ source: 'cursado-audiomass', type: type }, value), location.origin); }
  var saveModal = null, saveName = '', exporting = false;
  function saveError(error) {
    exporting = false;
    if (saveModal) saveModal.el_body.querySelector('[role="alert"]').textContent = error;
  }
  function requestSave() {
    if (saveModal) return;
    saveModal = new PKSimpleModal({
      title: 'Guardar audio',
      body: '<form id="cursado-save-form"><label>Nombre del audio<input required aria-label="Nombre del audio"></label><p role="alert"></p><p role="status"></p><button type="submit" class="pk_modal_a_bottom pk_modal_a_accpt">Confirmar audio</button></form>',
      ondestroy: function () { saveModal = null; },
      setup: function (modal) {
        modal.el.setAttribute('role', 'dialog'); modal.el.setAttribute('aria-label', 'Guardar audio');
        var cancel = modal.el.querySelector('.pk_modal_cancel');
        cancel.textContent = 'Cancelar'; cancel.setAttribute('role', 'button'); cancel.tabIndex = 0;
        cancel.onclick = function () { if (!exporting) modal.Destroy(); };
        var submit = modal.el_body.querySelector('button'); submit.setAttribute('form', 'cursado-save-form'); modal.el.querySelector('.pk_modal_bottom').appendChild(submit);
        var input = modal.el_body.querySelector('input'); input.value = saveName;
        input.oninput = function () { saveName = input.value; };
        modal.el_body.querySelector('form').onsubmit = function (event) {
          event.preventDefault(); if (exporting || !input.value.trim()) return;
          saveName = input.value.trim(); exporting = true;
          modal.el_body.querySelector('[role="alert"]').textContent = '';
          exportAudio();
        };
        modal.el.addEventListener('keydown', function (event) {
          event.stopPropagation();
          if (event.key === 'Escape' && !exporting) modal.Destroy();
        });
      }
    });
    saveModal.Show(); saveModal.el_body.querySelector('[role="status"]').textContent = speechState; saveModal.el_body.querySelector('input').focus();
  }
  function saveButton() {
    var button = document.createElement('button'); button.type = 'button'; button.className = 'pk_btn cursado-audio-save';
    button.setAttribute('aria-label', 'Guardar audio'); button.title = 'Guardar audio';
    button.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg><span>Guardar</span>';
    button.onclick = function () { requestSave(); };
    return button;
  }
  var transport = document.querySelector('.pk_transport');
  if (transport) {
    transport.appendChild(saveButton());
    var close = document.createElement('button'); close.type = 'button'; close.className = 'pk_btn cursado-audio-close'; close.textContent = '×';
    close.setAttribute('aria-label', 'Cerrar editor de audio'); close.title = 'Cerrar editor de audio'; close.onclick = function () { send('close'); };
    transport.appendChild(close);
  }
  // Refit the waveform after toolbar wrapping, font loading or iframe resizing.
  var resizeFrame = 0;
  var layoutObserver = new ResizeObserver(function () {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(function () {
      resizeFrame = 0; app.fireEvent('RequestResize');
    });
  });
  [document.documentElement].concat(Array.from(document.querySelectorAll('.pk_hdr,.pk_tbc,.pk_ftr'))).forEach(function (element) { layoutObserver.observe(element); });
  var speechState = '';
  var speech = window.CursadoLiveSpeech(function (state) {
    speechState = state.transcriptionError || (state.listening ? 'Transcribiendo mientras grab\u00e1s\u2026' : '');
    if (saveModal) saveModal.el_body.querySelector('[role="status"]').textContent = speechState;
    send('transcript', state);
  });
  ['DidLoadFile', 'DidStateChange', 'DidUpdateMultitrack', 'DidActionRecordStart', 'DidActionRecordStop'].forEach(function (event) {
    app.listenFor(event, function () { dirty = true; send('dirty'); });
  });
  app.listenFor('DidActionRecordStart', function () { recording = true; speech.start(false); });
  app.listenFor('DidActionRecordStop', function () { recording = false; speech.stop(); });
  app.listenFor('DidActionRecordPause', function () { speech.stop(); document.querySelector('.icon-rec')?.classList.add('cursado-paused'); });
  app.listenFor('DidActionRecordResume', function () { speech.start(false); document.querySelector('.icon-rec')?.classList.remove('cursado-paused'); });
  app.listenFor('DidActionRecordStop', function () { document.querySelector('.icon-rec')?.classList.remove('cursado-paused'); });
  app.listenFor('CursadoRecordingStart', function (reset) { speech.start(reset); });
  app.listenFor('CursadoRecordingStop', function () { speech.stop(); });
  // Some effects do not emit a state event. Conservatively protect all edits.
  document.addEventListener('input', function () { dirty = true; send('dirty'); });
  document.addEventListener('click', function (event) {
    if (event.target.closest('.pk_rec .pk_tbsa')) { dirty = true; send('dirty'); }
  });
  function wav(buffer) {
    if (!buffer || buffer.length <= 1) throw new Error('Grabá o importá un audio antes de confirmar.');
    var channels = buffer.numberOfChannels, count = buffer.length;
    var bytes = new ArrayBuffer(44 + count * channels * 2), view = new DataView(bytes);
    function str(offset, text) { for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); }
    str(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
    var data = []; for (var c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
    var offset = 44;
    for (var n = 0; n < count; n++) for (var channel = 0; channel < channels; channel++) {
      var sample = Math.max(-1, Math.min(1, data[channel][n]));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }
  function exportAudio() {
      if (recording && app.rec.isPaused()) { app.fireEvent('RequestActionRecordStop', function () { exportAudio(); }); return; }
      if (recording) { send('error', { error: 'Detené la grabación antes de confirmar.' }); return; }
      app.fireEvent('RequestStop');
      async function done(buffer) {
        try {
          var blob = wav(buffer), transcript = await speech.finish();
          send('audio', Object.assign({ blob: blob, duration: buffer.duration, name: saveName }, transcript));
        }
        catch (error) { send('error', { error: error.message }); }
      }
      try {
        if (app.multitrack?.IsOn()) app.multitrack.MixdownAsync(false, done);
        else done(app.engine.wavesurfer.backend.buffer);
      } catch (error) { send('error', { error: error.message }); }
  }
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== parent || event.data?.source !== 'cursado-host') return;
    if (event.data.type === 'record-toggle' && !document.querySelector('.pk_modal') && !app.ui.InteractionHandler.on) app.fireEvent('RequestActionRecordContinue');
    if (event.data.type === 'save-error') saveError(event.data.error);
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !document.querySelector('.pk_modal')) send('close');
  });
  window.addEventListener('beforeunload', function (event) { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', function () { layoutObserver.disconnect(); cancelAnimationFrame(resizeFrame); speech.dispose(); });
  send('ready');
})();
