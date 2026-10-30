/* Live browser dictation. No model or transcription worker is loaded by Cursado. */
(function () {
  'use strict';
  window.CursadoLiveSpeech = function (notify) {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var sessions = [], current = null, wanted = false, failed = false, error = '', timer;
    function text() { return sessions.map(function (session) { return session.join(' ').trim(); }).filter(Boolean).join(' '); }
    function snapshot() {
      return { transcript: text(), transcription: text() ? (failed ? 'partial' : 'completed') : (failed ? 'unavailable' : 'none'), transcriptionError: error };
    }
    function announce() { notify(Object.assign(snapshot(), { listening: wanted && !failed })); }
    function begin() {
      clearTimeout(timer);
      if (!wanted || current || failed) return;
      if (!Recognition) { failed = true; error = 'Este navegador no admite transcripción en vivo. El audio se guarda igual.'; announce(); return; }
      var recognition = new Recognition(), session = [];
      sessions.push(session); current = recognition;
      recognition.lang = 'es-AR'; recognition.continuous = true; recognition.interimResults = true;
      recognition.onresult = function (event) {
        if (current !== recognition) return;
        session.length = event.results.length;
        for (var i = event.resultIndex || 0; i < event.results.length; i++) session[i] = event.results[i][0].transcript.trim();
        announce();
      };
      recognition.onerror = function (event) {
        if (current !== recognition || event.error === 'no-speech' || event.error === 'aborted') return;
        failed = true;
        error = event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'No se autorizó el dictado. El audio se guarda igual.'
          : 'El dictado se interrumpió. El audio se guarda igual.';
        announce();
      };
      recognition.onend = function () {
        if (current !== recognition) return;
        current = null;
        if (recognition.finished) recognition.finished();
        if (wanted && !failed) timer = setTimeout(begin, 250);
      };
      try { recognition.start(); announce(); }
      catch (_) { current = null; failed = true; error = 'No se pudo iniciar el dictado. El audio se guarda igual.'; announce(); }
    }
    function stop() {
      wanted = false; clearTimeout(timer);
      var recognition = current;
      if (!recognition) { announce(); return Promise.resolve(snapshot()); }
      return new Promise(function (resolve) {
        var settled = false;
        function done() {
          if (settled) return;
          settled = true;
          if (current === recognition) current = null;
          announce(); resolve(snapshot());
        }
        recognition.finished = done;
        try { recognition.stop(); } catch (_) { done(); }
        setTimeout(done, 1000);
      });
    }
    return {
      start: function (reset) {
        if (reset) {
          if (current) { current.onend = current.onresult = current.onerror = null; try { current.abort(); } catch (_) {} current = null; }
          sessions = [];
        }
        wanted = true; failed = false; error = ''; begin();
      },
      stop: stop,
      finish: stop,
      snapshot: snapshot,
      dispose: function () { wanted = false; clearTimeout(timer); if (current) { current.onend = current.onresult = current.onerror = null; try { current.abort(); } catch (_) {} current = null; } },
    };
  };
})();
