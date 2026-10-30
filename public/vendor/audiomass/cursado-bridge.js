/* Cursado host bridge. Audio stays in the browser; no download dialog. */
(function () {
  'use strict';
  var app = window.PKAudioEditor;
  var dirty = false, recording = false;
  function send(type, value) { parent.postMessage(Object.assign({ source: 'cursado-audiomass', type: type }, value), location.origin); }
  function saveButton() {
    var button = document.createElement('button'); button.type = 'button'; button.className = 'pk_btn cursado-audio-save';
    button.setAttribute('aria-label', 'Guardar audio'); button.title = 'Guardar audio';
    button.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg><span>Guardar</span>';
    button.onclick = function () { send('save'); };
    return button;
  }
  var transport = document.querySelector('.pk_transport');
  if (transport) {
    transport.appendChild(saveButton());
    var close = document.createElement('button'); close.type = 'button'; close.className = 'pk_btn cursado-audio-close'; close.textContent = '×';
    close.setAttribute('aria-label', 'Cerrar editor de audio'); close.title = 'Cerrar editor de audio'; close.onclick = function () { send('close'); };
    transport.appendChild(close);
  }
  // A new recording has its own modal above the transport controls.
  var modalObserver = new MutationObserver(function () {
    var rec = document.querySelector('.pk_rec'), bottom = rec && rec.closest('.pk_modal').querySelector('.pk_modal_bottom');
    if (bottom && !bottom.querySelector('.cursado-audio-save')) bottom.appendChild(saveButton());
  });
  modalObserver.observe(document.body, { childList: true, subtree: true });
  var speech = window.CursadoLiveSpeech(function (state) { send('transcript', state); });
  ['DidLoadFile', 'DidStateChange', 'DidUpdateMultitrack', 'DidActionRecordStart', 'DidActionRecordStop'].forEach(function (event) {
    app.listenFor(event, function () { dirty = true; send('dirty'); });
  });
  app.listenFor('DidActionRecordStart', function () { recording = true; speech.start(false); });
  app.listenFor('DidActionRecordStop', function () { recording = false; speech.stop(); });
  app.listenFor('CursadoRecordingStart', function (reset) { speech.start(reset); });
  app.listenFor('CursadoRecordingStop', function () { speech.stop(); });
  // Some effects do not emit a state event. Conservatively protect all edits.
  document.addEventListener('input', function () { dirty = true; send('dirty'); });
  document.addEventListener('click', function (event) {
    if (event.target.closest('.pk_rec .pk_tbsa')) { dirty = true; send('dirty'); }
  });
  function wav(buffer) {
    if (!buffer || !buffer.length) throw new Error('Grabá o importá un audio antes de confirmar.');
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
      // The new-recording modal keeps its buffer separate until OPEN RECORDING.
      // Confirming in Cursado finishes and opens it, avoiding an extra manual step.
      var rec = document.querySelector('.pk_rec');
      if (rec) {
        var buttons = rec.querySelectorAll('.pk_tbsa');
        var active = /FINISH RECORDING/.test(buttons[0].textContent);
        if (active) buttons[0].click();
        setTimeout(function () {
          if (buttons[2].style.display === 'none') { send('error', { error: 'Grabá un audio antes de confirmar.' }); return; }
          var timeout = setTimeout(function () {
            app.stopListeningFor('DidLoadFile', loaded);
            send('error', { error: 'No se pudo preparar la grabación. Reintentá.' });
          }, 15000);
          function loaded() { clearTimeout(timeout); app.stopListeningFor('DidLoadFile', loaded); setTimeout(exportAudio, 0); }
          app.listenFor('DidLoadFile', loaded);
          buttons[2].click();
        }, active ? 320 : 0);
        return;
      }
      if (recording) { send('error', { error: 'Detené la grabación antes de confirmar.' }); return; }
      app.fireEvent('RequestStop');
      async function done(buffer) {
        try {
          var blob = wav(buffer), transcript = await speech.finish();
          send('audio', Object.assign({ blob: blob, duration: buffer.duration }, transcript));
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
    if (event.data.type === 'export') exportAudio();
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !document.querySelector('.pk_modal')) send('close');
  });
  window.addEventListener('beforeunload', function (event) { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', function () { modalObserver.disconnect(); speech.dispose(); });
  send('ready');
})();
