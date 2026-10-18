/* Explanations use real PDF.js FreeText editors and a local HTML/position manifest. */
window.initPdfExplanations = function ({ app, query, ensureWorkspaceRootHandle, inscreenApiFetch, showToast }) {
  const servicesFetch = async (input, init) => {
    try { return await inscreenApiFetch(input, init); }
    catch (error) {
      if (error?.name !== "InscreenConfigurationUnavailable") throw error;
      return fetch(input, init);
    }
  };
  const toolbar = document.getElementById("toolbarViewerRight");
  if (!toolbar) return;
  const instructionKey = "pdf-explanation-instructions.v1";
  const defaultInstructions = "Explicaci\u00f3n visual e interactiva paso a paso. Us\u00e1 texto, f\u00f3rmulas, tablas y diagramas cuando ayuden a entender; conserv\u00e1 las etiquetas del apunte y aclar\u00e1 las incertidumbres.";
  const getInstructions = () => { try { return localStorage.getItem(instructionKey)?.trim() || defaultInstructions; } catch { return defaultInstructions; } };
  const systemKey = provider => `pdf-explanation-system.v1.${provider}`;
  const getSystemPrompt = provider => { try { const text = localStorage.getItem(systemKey(provider)); return text?.trim() ? text : undefined; } catch { return undefined; } };
  let documentState = null, loading = null, modal = null, restoring = false;
  let saving = Promise.resolve();
  const editors = new Map();
  const preparedPages = new WeakMap();
  const star = document.createElement("button");
  star.id = "pdfExplanationButton";
  star.className = "toolbarButton pdf-explanation-star";
  star.type = "button";
  star.title = "Explicaciones";
  star.setAttribute("aria-label", "Explicaciones");
  star.setAttribute("aria-haspopup", "dialog");
  star.setAttribute("aria-expanded", "false");
  toolbar.prepend(star);
  const menu = document.createElement("div");
  menu.className = "pdf-explanation-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = '<button type="button" role="menuitem">Verlo</button><button type="button" role="menuitem" disabled title="Próximamente">Procedimiento</button>';
  document.body.append(menu);
  const report = error => showToast(error instanceof Error ? error.message : "No se pudo guardar la explicación.", "error", 6000);
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  async function fileHandle(root, path, create = false) {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return dir.getFileHandle(parts.at(-1), { create });
  }
  async function read(root, path) {
    try {
      const text = await (await (await fileHandle(root, path)).getFile()).text();
      try { return JSON.parse(text); }
      catch {
        // A failed older write can leave an empty credential file. Preserve it
        // and request a new key; OCR caches can be regenerated from the PDF.
        if (path === "User.Datalab" || path.startsWith("manifests/subject-voice/pdf/")) return null;
        throw new Error(`No se pudo leer ${path}: contiene JSON incompleto o dañado. Se conserva el archivo original.`);
      }
    }
    catch (error) { if (error.name === "NotFoundError") return null; throw error; }
  }
  async function write(root, path, text) {
    const writer = await (await fileHandle(root, path, true)).createWritable();
    try { await writer.write(text); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
    const channel = new BroadcastChannel('cursado-library-changes'); channel.postMessage('saved'); channel.close();
  }
  async function load() {
    if (!app.pdfDocument) throw new Error("Esperá a que termine de cargar el PDF.");
    if (documentState?.pdf === app.pdfDocument) return documentState;
    if (loading) return loading;
    const pdf = app.pdfDocument;
    loading = (async () => {
      const bytes = await pdf.getData();
      const sourceHash = await hash(bytes);
      const identity = query.workspaceFileId || query.key || `${query.resourceType}:${query.materialId || sourceHash}`;
      const key = await hash(new TextEncoder().encode(identity));
      const root = query.localWorkspace ? await ensureWorkspaceRootHandle() : null;
      const path = `manifests/pdf-explanations/${key}/explanations.json`;
      const local = JSON.parse(localStorage.getItem(`pdf-explanations:${key}`) || "null");
      const stored = root ? await read(root, path) : null;
      const saved = stored && (!local || (stored.updatedAt || 0) >= (local.updatedAt || 0)) ? stored : local;
      if (saved && (saved.version !== 1 || !Array.isArray(saved.entries) || !saved.transcriptions)) {
        throw new Error("El archivo de explicaciones guardadas no es válido.");
      }
      if (app.pdfDocument !== pdf) throw new Error("El PDF cambió. Volvé a abrir la explicación.");
      editors.clear();
      let fingerprint = pdf.fingerprints[0];
      const data = saved || { version: 1, entries: [], transcriptions: {} };
      // Some PDFs have no document ID until PDF.js saves the first annotation, so their
      // fingerprint changes on that save. A persisted note links that revision to its source.
      if (saved && data.fingerprint !== fingerprint) {
        for (const entry of data.entries) {
          const page = entry.annotation?.pageIndex + 1;
          if (!(page > 0 && page <= pdf.numPages)) continue;
          const annotations = await (await pdf.getPage(page)).getAnnotations();
          if (annotations.some(a => a.subtype === "FreeText" && (a.textContent?.join("\n") || "").trim() === entry.annotation.value.trim())) {
            fingerprint = data.fingerprint;
            break;
          }
        }
      }
      const extractionHash = data.fingerprint === fingerprint ? data.extractionHash || sourceHash : sourceHash;
      data.fingerprint = fingerprint;
      data.extractionHash = extractionHash;
      documentState = { pdf, bytes, sourceHash: extractionHash, fingerprint, key, root, path, data };
      return documentState;
    })();
    try { return await loading; } finally { loading = null; }
  }
  function persist(state) {
    // Keep the latest action immediately, including a reload while a queued
    // workspace write is still pending. The manifest remains available to sync.
    state.data.updatedAt = Math.max(Date.now(), (state.data.updatedAt || 0) + 1);
    try { localStorage.setItem(`pdf-explanations:${state.key}`, JSON.stringify(state.data)); }
    catch (error) { if (!state.root) return Promise.reject(error); }
    const next = saving.catch(() => {}).then(async () => {
      const json = JSON.stringify(state.data);
      if (!state.root) { localStorage.setItem(`pdf-explanations:${state.key}`, json); return; }
      const previous = await read(state.root, state.path);
      if (previous) await write(state.root, state.path + ".backup", JSON.stringify(previous));
      await write(state.root, state.path, json);
    });
    saving = next;
    return next;
  }
  async function transcription(state, page) {
    const key = `${state.fingerprint}:${page}`;
    if (state.data.transcriptions[key]) return state.data.transcriptions[key];
    // Conjuntos stores Datalab blocks with original (one-based) page numbers.
    if (state.root) {
      const extraction = await read(state.root, `manifests/subject-voice/pdf/datalab-balanced-json-v1/${state.sourceHash}/extraction.json`);
      const blocks = (extraction?.batches || []).flatMap(batch => {
        if (batch.extraction?.failedPages?.includes(page)) return [];
        return (batch.extraction?.blocks || []).filter(block => block.page === page && typeof block.text === "string");
      });
      const text = blocks.map(block => block.text).join("\n\n").trim();
      if (text) {
        state.data.transcriptions[key] = text;
        await persist(state);
        return text;
      }
    }
    const source = await window.PDFLib.PDFDocument.load(state.bytes);
    const single = await window.PDFLib.PDFDocument.create();
    const [copied] = await single.copyPages(source, [page - 1]);
    single.addPage(copied);
    const form = new FormData();
    form.set("file", new File([await single.save()], `pagina-${page}.pdf`, { type: "application/pdf" }));
    let payload;
    for (;;) {
      const saved = state.root ? await read(state.root, "User.Datalab") : null;
      const init = { method: "POST", body: form, signal: AbortSignal.timeout(65_000),
        headers: saved?.token ? { "x-datalab-config-token": saved.token } : {} };
      const response = await servicesFetch("/api/inscreen/datalab-transcribe", init);
      const responseText = await response.text();
      try { payload = JSON.parse(responseText); }
      catch { throw new Error(`No se pudo transcribir la página: Datalab respondió HTTP ${response.status} con ${responseText.trim() ? "un formato inesperado" : "una respuesta vacía"}. Reintentá la transcripción.`); }
      if (!payload || typeof payload !== "object") throw new Error(`No se pudo transcribir la página: respuesta inválida (HTTP ${response.status}).`);
      if (!response.ok && /Clave de Datalab|semilla|INSCREEN_CONFIG_SEED/i.test(payload.error || "")) {
        await configureDatalab(state);
        continue;
      }
      if (!response.ok || !payload.markdown?.trim()) throw new Error(payload.error || "Datalab devolvió una página vacía.");
      break;
    }
    state.data.transcriptions[key] = payload.markdown;
    await persist(state); // Keep the transcription even if generation fails.
    return payload.markdown;
  }
  let datalabConfiguration = null;
  function configureDatalab(state) {
    if (datalabConfiguration) return datalabConfiguration;
    datalabConfiguration = new Promise((resolve, reject) => {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Agregar API de Datalab");
      dialog.style.cssText = "width:min(320px,calc(100vw - 48px));padding:20px;border:1px solid #8886;border-radius:14px;background:Canvas;color:CanvasText;box-shadow:0 12px 48px #0004";
      dialog.innerHTML = `<form style="display:grid;gap:12px;font:14px system-ui"><strong>Agregar API de Datalab</strong><label>API key<input aria-label="API key" type="password" autocomplete="off" required style="display:block;box-sizing:border-box;width:100%;margin-top:6px;padding:8px;border:1px solid #888;border-radius:6px"></label><small>Copiala de <a href="https://www.datalab.to/app/keys" target="_blank" rel="noopener noreferrer">Datalab</a>. Se guarda cifrada.</small><span role="alert"></span><div style="display:flex;justify-content:flex-end;gap:8px"><button type="button">Ahora no</button><button type="submit">Guardar y reintentar</button></div></form>`;
      const finish = error => { dialog.close(); dialog.remove(); error ? reject(error) : resolve(); };
      dialog.addEventListener("cancel", event => { event.preventDefault(); finish(new Error("Agregá la clave de Datalab para continuar.")); });
      dialog.querySelector('[type="button"]').onclick = () => finish(new Error("Agregá la clave de Datalab para continuar."));
      dialog.querySelector("form").onsubmit = async event => {
        event.preventDefault();
        const submit = dialog.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          if (!state.root) throw new Error("Seleccioná tu carpeta de trabajo para guardar la clave.");
          const response = await fetch("/api/subject-voice/pdf-extraction/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: dialog.querySelector("input").value.trim() }) });
          const result = await response.json();
          if (!response.ok || !result.token) throw new Error(result.error || "No se pudo guardar la clave.");
          await write(state.root, "User.Datalab", JSON.stringify({ version: 1, token: result.token }));
          const saved = await read(state.root, "User.Datalab");
          if (saved?.token !== result.token) throw new Error("No se pudo verificar el guardado de la clave.");
          dialog.querySelector("input").value = "";
          finish();
        } catch (error) { dialog.querySelector('[role="alert"]').textContent = error.message; }
        finally { submit.disabled = false; }
      };
      document.body.append(dialog); dialog.showModal();
    }).finally(() => { datalabConfiguration = null; });
    return datalabConfiguration;
  }
  function preparePage(pdf, page) {
    if (!pdf) return Promise.reject(new Error("Esperá a que termine de cargar el PDF."));
    let pages = preparedPages.get(pdf);
    if (!pages) { pages = new Map(); preparedPages.set(pdf, pages); }
    if (pages.has(page)) return pages.get(page);
    const pending = (async () => {
      const state = await load();
      if (state.pdf !== pdf) throw new Error("El PDF cambió. Volvé a abrir Verlo.");
      return { state, text: await transcription(state, page) };
    })();
    pages.set(page, pending);
    pending.catch(() => { if (pages.get(page) === pending) pages.delete(page); });
    return pending;
  }
  function close() {
    if (!modal) return;
    const previousFocus = modal.previousFocus;
    modal.cleanup?.();
    modal.node.remove();
    modal = null;
    previousFocus?.focus();
  }
  function overlay(title) {
    close();
    menu.hidden = true;
    star.setAttribute("aria-expanded", "false");
    const previousFocus = document.activeElement;
    const node = document.createElement("div");
    node.className = "pdf-explanation-overlay";
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-modal", "true");
    node.setAttribute("aria-label", title);
    const panel = document.createElement("section");
    panel.className = "pdf-explanation-panel";
    const header = document.createElement("header");
    const heading = document.createElement("strong");
    heading.textContent = title;
    heading.hidden = true;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "\u00d7";
    dismiss.className = "pdf-explanation-icon";
    dismiss.title = "Salir (Esc)";
    dismiss.setAttribute("aria-label", "Salir de la explicaci\u00f3n");
    dismiss.addEventListener("click", close);
    header.append(heading, dismiss);
    panel.append(header);
    node.append(panel);
    document.body.append(node);
    modal = { node, panel, previousFocus };
    dismiss.focus();
    return modal;
  }
  function openHtml(entry) {
    const view = overlay(entry.question);
    view.node.classList.add("pdf-explanation-fullpage");
    view.panel.classList.add("pdf-explanation-result");
    const iframe = document.createElement("iframe");
    iframe.title = entry.question;
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    // CSP is inserted before all generated content, including malformed/missing <head>.
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">';
    const escapeBridge = `<script>addEventListener('keydown',e=>{if(e.ctrlKey&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='q'){e.preventDefault();parent.postMessage({type:'cursado-return-home'},'*')}if(e.key==='Escape')parent.postMessage({type:'pdf-explanation-escape'},'*')});<\/script>`;
    const loadHtml = async () => {
      let html = entry.html;
      if (/cdn\.tailwindcss\.com|data-pdf-slide-deck/.test(html)) {
        const { preparePdfExplanationHtml } = await import("./viewer-explanation-import.js");
        html = await preparePdfExplanationHtml(html);
      }
      if (modal === view) iframe.srcdoc = csp + escapeBridge + html;
    };
    loadHtml().catch(report);
    view.panel.append(iframe);
    const header = view.panel.querySelector("header");
    const icon = (symbol, label, action) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "pdf-explanation-icon";
      button.textContent = symbol; button.title = label; button.setAttribute("aria-label", label);
      button.addEventListener("click", action);
      return button;
    };
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = ".html,.htm,text/html"; picker.hidden = true;
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if (!file) return;
      const state = documentState;
      try {
        const { preparePdfExplanationHtml } = await import("./viewer-explanation-import.js");
        const html = await preparePdfExplanationHtml(await file.text());
        if (documentState !== state || modal !== view) return;
        const previous = entry.html;
        entry.html = html;
        try {
          if (state.root) await write(state.root, `manifests/pdf-explanations/${state.key}/${entry.id}.html`, html);
          await persist(state);
        } catch (error) { entry.html = previous; throw error; }
        openHtml(entry);
      } catch (error) { report(error); }
      finally { picker.value = ""; }
    });
    const reload = icon("\u21bb", "Recargar HTML", () => { loadHtml().catch(report); });
    const upload = icon("\u2191", "Importar HTML", () => picker.click());
    const download = icon("\u2193", "Exportar HTML", () => {
      const url = URL.createObjectURL(new Blob([entry.html], { type: "text/html;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = `verlo-pagina-${entry.annotation.pageIndex + 1}.html`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
    header.prepend(reload, upload, download);
    view.panel.append(picker);
    iframe.focus();
  }
  function bindEditor(entry, editor) {
    editors.set(entry.id, editor);
    const div = editor.div;
    if (!div || div.dataset.explanationId) return;
    div.dataset.explanationId = entry.id;
    // Keep existing notes in PDF.js' modified annotation set even when their
    // text/position is unchanged. Otherwise the canvas paints the saved note
    // underneath this interactive FreeText editor after reopening the PDF.
    const serialize = editor.serialize.bind(editor);
    editor.serialize = (isForCopying = false) => {
      const value = serialize(isForCopying);
      if (value || isForCopying || !editor.annotationElementId) return value;
      const copy = serialize(true);
      if (!copy) return null;
      const { isCopy, ...annotation } = copy;
      return { ...annotation, id: editor.annotationElementId };
    };
    const state = documentState;
    const remove = editor.remove.bind(editor), rebuild = editor.rebuild.bind(editor);
    editor.remove = () => {
      if (!entry.deleted) { entry.deleted = true; persist(state).catch(report); }
      remove();
      state.pdf.annotationStorage.resetModifiedIds();
    };
    editor.rebuild = () => {
      // PDF.js restores the same editor when undoing a deletion.
      if (entry.deleted) { entry.deleted = false; persist(state).catch(report); }
      rebuild();
    };
    div.classList.add("pdf-explanation-text");
    div.title = "Clic para ver la explicación; arrastrá para ubicarla";
    let drag = null, holdTimer = null, editing = false;
    const commit = editor.commit.bind(editor);
    editor.commit = () => {
      commit();
      if (!editing) return;
      editing = false;
      delete div.dataset.explanationEditing;
      entry.annotation = editor.serialize() || entry.annotation;
      entry.position = { x: editor.x, y: editor.y };
      persist(state).catch(report);
    };
    editor.editorDiv.addEventListener("blur", () => {
      setTimeout(() => { if (editing && !editor.editorDiv.contains(document.activeElement)) editor.commit(); }, 0);
    });
    div.title = "Clic para ver; mantener presionado para editar; arrastrar para mover";
    div.addEventListener("pointerdown", event => {
      if (editing || event.button !== 0 || event.target.closest(".editToolbar, .resizers")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: editor.x, startY: editor.y, moved: false };
      div.setPointerCapture(event.pointerId);
      holdTimer = setTimeout(() => {
        if (!drag || drag.moved) return;
        drag.held = true;
        editing = true;
        div.dataset.explanationEditing = "true";
        editor.enableEditMode();
        editor.editorDiv.focus({ preventScroll: true });
      }, 550);
    }, true);
    div.addEventListener("pointermove", event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (drag.held) return;
      if (Math.hypot(dx, dy) > 5) { drag.moved = true; clearTimeout(holdTimer); }
      if (!drag.moved) return;
      const [tx, ty] = editor.screenToPageTranslation(dx, dy);
      const [width, height] = editor.parentDimensions;
      editor.x = drag.startX + tx / width;
      editor.y = drag.startY + ty / height;
      editor.fixAndSetPosition();
    });
    const finish = event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      clearTimeout(holdTimer);
      const held = drag.held;
      const moved = drag.moved;
      drag = null;
      if (div.hasPointerCapture(event.pointerId)) div.releasePointerCapture(event.pointerId);
      if (held) return;
      if (moved) {
        editor.commit();
        entry.annotation = editor.serialize() || entry.annotation;
        entry.position = { x: editor.x, y: editor.y };
        persist(state).catch(report);
        editor.parent?.setSelected(editor);
        div.focus({ preventScroll: true });
      } else if (event.type !== "pointercancel") openHtml(entry);
    };
    div.addEventListener("pointerup", finish);
    div.addEventListener("pointercancel", finish);
    div.addEventListener("click", event => {
      if (editing || event.target.closest(".editToolbar, .resizers")) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    div.addEventListener("dblclick", event => { if (editing) return; event.preventDefault(); event.stopImmediatePropagation(); }, true);
    div.addEventListener("keydown", event => {
      if (editing || event.target.closest(".editToolbar, .resizers")) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopImmediatePropagation(); openHtml(entry); }
    }, true);
  }
  async function restore() {
    if (!documentState || restoring || documentState.pdf !== app.pdfDocument) return;
    restoring = true;
    try {
      const redraw = new Set();
      const usedAnnotations = new Set([...editors.values()].map(editor => editor.annotationElementId).filter(Boolean));
      for (const entry of documentState.data.entries) {
        const layer = app.pdfViewer.getPageView(entry.annotation.pageIndex)?.annotationEditorLayer?.annotationEditorLayer;
        if (!layer) continue;
        const bound = editors.get(entry.id);
        if (bound) {
          if (entry.deleted) {
            if (bound.annotationElementId) layer.getEditableAnnotation(bound.annotationElementId)?.hide();
            continue;
          }
          if (bound.parent !== layer || !bound.isAttachedToDOM) layer.addOrRebuild(bound);
          layer.div.hidden = false;
          bound.show();
          if (bound.annotationElementId) layer.getEditableAnnotation(bound.annotationElementId)?.hide();
          continue;
        }
        // PDF autosave may already contain the note: bind that annotation rather than duplicating it.
        const annotations = await (await app.pdfDocument.getPage(entry.annotation.pageIndex + 1)).getAnnotations();
        const existing = annotations.find(a => !usedAnnotations.has(a.id) && a.subtype === "FreeText" && (a.textContent?.join("\n") || a.contentsObj?.str || "").trim() === entry.annotation.value.trim());
        const native = existing && layer.getEditableAnnotation(existing.id);
        if (entry.deleted && !native) continue;
        const editor = (native && documentState.pdf.annotationStorage.getEditor(existing.id))
          || await layer.deserialize(native || { ...entry.annotation, isCopy: true });
        if (!editor) continue;
        const position = entry.position || { x: editor.x, y: editor.y };
        layer.addOrRebuild(editor);
        editor.x = position.x;
        editor.y = position.y;
        editor.fixAndSetPosition();
        native?.hide();
        if (native) usedAnnotations.add(existing.id);
        layer.div.hidden = false;
        bindEditor(entry, editor);
        if (entry.deleted) editor.remove();
        if (native) redraw.add(app.pdfViewer.getPageView(entry.annotation.pageIndex));
      }
      if (redraw.size) {
        documentState.pdf.annotationStorage.resetModifiedIds();
        for (const page of redraw) page.reset({ keepAnnotationLayer: true, keepAnnotationEditorLayer: true,
          keepXfaLayer: true, keepTextLayer: true, keepCanvasWrapper: true });
        app.pdfViewer.update();
      }
    } catch (error) { report(error); } finally { restoring = false; }
  }
  async function ask() {
    menu.hidden = true;
    star.setAttribute("aria-expanded", "false");
    const page = app.pdfViewer.currentPageNumber;
    const pdf = app.pdfDocument;
    const view = overlay(`Verlo · página ${page}`);
    view.node.classList.add("pdf-explanation-composer");
    view.node.setAttribute("aria-modal", "false");
    star.setAttribute("aria-expanded", "true");
    const form = document.createElement("form");
    form.innerHTML = '<label hidden for="pdf-explanation-model">Modelo gratuito de AI Gateway</label><div class="pdf-explanation-model-row" hidden><select id="pdf-explanation-model" disabled><option value="">Cargando modelos…</option></select><button type="button" class="pdf-explanation-refresh" title="Actualizar modelos gratuitos" aria-label="Actualizar modelos gratuitos">↻</button></div><p class="pdf-explanation-model-status" role="status"></p><textarea aria-label="?Qu? quer?s entender?" id="pdf-explanation-question" maxlength="2000" rows="4" placeholder="Explicalo · Enter para generar; Shift+Enter para otra línea"></textarea><div class="pdf-explanation-loading" hidden><span class="pdf-explanation-spinner" aria-hidden="true"></span><span class="pdf-explanation-elapsed">Cargando…</span></div><p class="pdf-explanation-progress" role="status" aria-live="polite"></p><button type="submit">Generar explicación</button>';
    view.panel.append(form);
    const settings = document.createElement("button");
    settings.type = "button"; settings.className = "pdf-explanation-icon";
    settings.textContent = "⚙"; settings.title = "Prompt de sistema y preferencias"; settings.setAttribute("aria-label", settings.title);
    const header = view.panel.querySelector("header");
    header.insertBefore(settings, header.lastElementChild);
    const preferences = document.createElement("div"); preferences.className = "pdf-explanation-preferences"; preferences.hidden = true;
    preferences.innerHTML = '<label>Instrucción final<textarea maxlength="4000" rows="5" aria-label="Instrucción final"></textarea></label><p>Estas preferencias se incorporan al prompt predeterminado. Si editás el system prompt completo, se envía exactamente ese texto. La pregunta y el PDF se envían como mensaje de usuario.</p><label>System prompt enviado al modelo<textarea class="pdf-explanation-system-preview" maxlength="100000" rows="14" aria-label="System prompt enviado al modelo" placeholder="Cargando prompt de sistema…" disabled></textarea></label><button type="button" class="pdf-explanation-restore-system">Restaurar prompt predeterminado</button><details class="pdf-explanation-output-schema" hidden><summary>Esquema JSON enviado como salida estructurada</summary><textarea rows="10" readonly aria-label="Esquema de salida estructurada"></textarea></details><button type="button" class="pdf-explanation-save-system">Guardar</button><p role="alert"></p>';
    const instructionInput = preferences.querySelector("textarea");
    instructionInput.value = getInstructions();
    const systemPreview = preferences.querySelector('.pdf-explanation-system-preview');
    const schemaDetails = preferences.querySelector('.pdf-explanation-output-schema');
    let systemPromptBase = "", currentProvider = null, customSystemPrompt, systemEdited = false;
    const updateSystemPreview = () => {
      systemPreview.disabled = !systemPromptBase;
      if (!systemEdited) systemPreview.value = customSystemPrompt ?? (systemPromptBase ? window.composeExplanationSystem(systemPromptBase, instructionInput.value) : "");
    };
    const loadSavedSystem = () => { customSystemPrompt = currentProvider ? getSystemPrompt(currentProvider) : undefined; systemEdited = false; updateSystemPreview(); };
    systemPreview.addEventListener('input', () => { systemEdited = true; });
    instructionInput.addEventListener('input', updateSystemPreview);
    preferences.querySelector('.pdf-explanation-restore-system').addEventListener('click', () => {
      customSystemPrompt = undefined; systemEdited = false; updateSystemPreview(); systemPreview.focus();
    });
    view.panel.append(preferences);
    settings.addEventListener("click", () => {
      preferences.hidden = !preferences.hidden; form.hidden = !preferences.hidden;
      if (!preferences.hidden) { instructionInput.value = getInstructions(); loadSavedSystem(); instructionInput.focus(); }
    });
    preferences.querySelector('.pdf-explanation-save-system').addEventListener("click", () => {
      const alert = preferences.querySelector('[role="alert"]'); alert.textContent = "";
      if (!instructionInput.value.trim() || !systemPreview.value.trim()) { alert.textContent = "Completá la instrucción y el prompt de sistema."; return; }
      if (!systemPromptBase || !currentProvider) { alert.textContent = "Esperá a que se cargue el prompt de sistema."; return; }
      try {
        localStorage.setItem(instructionKey, instructionInput.value.trim());
        if (systemEdited || customSystemPrompt !== undefined) localStorage.setItem(systemKey(currentProvider), systemPreview.value);
        else localStorage.removeItem(systemKey(currentProvider));
        preferences.hidden = true; form.hidden = false; input.focus();
      }
      catch { preferences.querySelector('[role="alert"]').textContent = "No se pudo guardar la instrucción."; }
    });
    const input = form.querySelector("textarea"), status = form.querySelector(".pdf-explanation-progress"), submit = form.querySelector('button[type="submit"]');
    const modelSelect = form.querySelector("select"), modelStatus = form.querySelector(".pdf-explanation-model-status"), refresh = form.querySelector(".pdf-explanation-refresh");
    const loadingIndicator = form.querySelector(".pdf-explanation-loading"), elapsed = form.querySelector(".pdf-explanation-elapsed");
    input.focus();
    let generating = false;
    let region = null, drag = null;
    const attachment = document.createElement("div");
    attachment.className = "pdf-explanation-attachment";
    const attachmentStatus = document.createElement("span");
    attachmentStatus.hidden = true;
    attachmentStatus.textContent = "Arrastrá sobre la página para adjuntar una región (opcional).";
    const removeRegion = document.createElement("button");
    removeRegion.type = "button"; removeRegion.textContent = "Quitar región"; removeRegion.hidden = true;
    attachment.append(attachmentStatus, removeRegion);
    input.before(attachment);
    const rectangle = document.createElement("div");
    rectangle.className = "pdf-explanation-region"; rectangle.hidden = true;
    document.body.append(rectangle);
    const canvasForPage = () => app.pdfViewer.getPageView(page - 1)?.div.querySelector(".canvasWrapper canvas");
    const point = event => {
      const bounds = canvasForPage()?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return null;
      return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
    };
    const paint = () => {
      const bounds = canvasForPage()?.getBoundingClientRect();
      rectangle.hidden = !region || !bounds;
      if (!region || !bounds) return;
      Object.assign(rectangle.style, { left: `${bounds.left + region.x * bounds.width}px`,
        top: `${bounds.top + region.y * bounds.height}px`, width: `${region.width * bounds.width}px`,
        height: `${region.height * bounds.height}px` });
    };
    removeRegion.addEventListener("click", () => {
      region = null; paint(); removeRegion.hidden = true;
      attachmentStatus.textContent = "Sin región adjunta · se enviará la transcripción.";
      input.focus();
    });
    const down = event => {
      if (generating || event.button !== 0 || view.node.contains(event.target)) return;
      const canvas = canvasForPage();
      const bounds = canvas?.getBoundingClientRect();
      if (!bounds || !event.target.closest(".page") || event.target.closest(".page") !== canvas.closest(".page") ||
        event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      event.preventDefault(); event.stopImmediatePropagation();
      drag = { ...point(event), pointer: event.pointerId };
      region = null; paint();
    };
    const move = event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const end = point(event);
      if (!end) return;
      region = { x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y),
        width: Math.abs(drag.x - end.x), height: Math.abs(drag.y - end.y) };
      paint();
    };
    const up = event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      move(event); drag = null;
      const bounds = canvasForPage()?.getBoundingClientRect();
      if (event.type === "pointercancel" || !bounds || !region || region.width * bounds.width < 5 || region.height * bounds.height < 5) region = null;
      paint(); removeRegion.hidden = !region;
      attachmentStatus.textContent = region ? "Región adjunta · podés seleccionar otra o escribir tu prompt." : "Sin región adjunta · se enviará la transcripción.";
      input.focus({ preventScroll: true });
    };
    const keyboard = event => {
      if (modal !== view || generating || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
        view.node.contains(event.target) || event.key === "Escape" || event.key === "Tab") return;
      if (event.key === "Enter") { event.preventDefault(); event.stopImmediatePropagation(); form.requestSubmit(); }
      else if (event.key.length === 1) {
        event.preventDefault(); event.stopImmediatePropagation(); input.focus({ preventScroll: true });
        input.setRangeText(event.key, input.selectionStart, input.selectionEnd, "end");
      }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("keydown", keyboard, true);
    window.addEventListener("scroll", paint, true); window.addEventListener("resize", paint);
    const pageChanged = () => { if (modal === view && app.pdfViewer.currentPageNumber !== page) close(); };
    app.eventBus.on("pagechanging", pageChanged);
    view.cleanup = () => {
      rectangle.remove(); star.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("scroll", paint, true); window.removeEventListener("resize", paint);
      app.eventBus.off("pagechanging", pageChanged);
    };
    async function captureRegion() {
      if (!region) return undefined;
      const selected = { ...region };
      const pdfPage = await pdf.getPage(page);
      const rotation = app.pdfViewer.getPageView(page - 1).viewport.rotation;
      const base = pdfPage.getViewport({ scale: 1, rotation });
      const viewport = pdfPage.getViewport({ scale: Math.min(3, 1800 / Math.max(base.width, base.height)), rotation });
      const source = document.createElement("canvas"); source.width = Math.ceil(viewport.width); source.height = Math.ceil(viewport.height);
      await pdfPage.render({ canvasContext: source.getContext("2d"), viewport, background: "rgb(255,255,255)" }).promise;
      const crop = document.createElement("canvas");
      crop.width = Math.max(1, Math.round(selected.width * source.width)); crop.height = Math.max(1, Math.round(selected.height * source.height));
      crop.getContext("2d").drawImage(source, selected.x * source.width, selected.y * source.height,
        selected.width * source.width, selected.height * source.height, 0, 0, crop.width, crop.height);
      return crop.toDataURL("image/jpeg", 0.9);
    }
    let modelsRevision = 0;
    async function loadModels() {
      const revision = ++modelsRevision;
      systemPromptBase = ""; updateSystemPreview(); schemaDetails.hidden = true;
      systemPreview.placeholder = "Cargando prompt de sistema…";
      modelSelect.disabled = true; refresh.disabled = true;
      modelStatus.hidden = true;
      modelStatus.textContent = "Consultando el modelo de explicación…";
      try {
        const response = await servicesFetch("/api/pdf-explanation", { cache: "no-store" });
        const payload = await response.json();
        if (revision !== modelsRevision || modal !== view) return;
        if (!response.ok) throw new Error(payload.error || "No se pudo cargar la lista de modelos.");
        if (!Array.isArray(payload.models) || !payload.models.length) throw new Error("No hay modelos disponibles.");
        systemPromptBase = typeof payload.systemPromptBase === 'string' ? payload.systemPromptBase : "";
        const provider = payload.provider === 'azure' ? 'azure' : 'gateway';
        if (provider !== currentProvider) { currentProvider = provider; loadSavedSystem(); }
        systemPreview.placeholder = systemPromptBase ? "" : "El servidor no envió el prompt de sistema. Actualizá la aplicación.";
        updateSystemPreview();
        schemaDetails.hidden = !payload.outputSchema;
        schemaDetails.querySelector('textarea').value = payload.outputSchema ? JSON.stringify(payload.outputSchema, null, 2) : "";
        const fixedAzure = payload.provider === "azure";
        form.querySelector('label[for="pdf-explanation-model"]').textContent = fixedAzure ? "Modelo de explicación" : "Modelo gratuito de AI Gateway";
        form.querySelector(".pdf-explanation-model-row").hidden = fixedAzure;
        let remembered = modelSelect.value;
        if (!remembered) { try { remembered = localStorage.getItem("pdf-explanation-model") || ""; } catch {} }
        modelSelect.replaceChildren();
        for (const model of payload.models) {
          const option = document.createElement("option");
          option.value = model.id; option.textContent = model.name || model.id;
          modelSelect.append(option);
        }
        if (payload.models.some(model => model.id === remembered)) modelSelect.value = remembered;
        modelStatus.textContent = "";
        modelStatus.hidden = true;
      } catch (error) {
        if (revision !== modelsRevision || modal !== view) return;
        modelSelect.replaceChildren(new Option("No se pudo cargar la lista", ""));
        modelStatus.hidden = false;
        modelStatus.textContent = error.message;
        systemPreview.placeholder = "No se pudo cargar el prompt de sistema: " + error.message;
        throw error;
      } finally { if (revision === modelsRevision) { modelSelect.disabled = generating || !modelSelect.value; refresh.disabled = generating; } }
    }
    let modelsReady = loadModels();
    modelsReady.catch(() => {});
    refresh.addEventListener("click", () => { modelsReady = loadModels(); modelsReady.catch(() => {}); });
    const servicesChanged = () => {
      if (modal !== view) return;
      modelsReady = loadModels();
      modelsReady.catch(() => {});
      preparePage(pdf, page).then(() => {
        if (modal === view && !generating) status.textContent = "Página lista · Enter para explicar";
      }, error => { if (modal === view && !generating) status.textContent = error.message; });
    };
    window.addEventListener("cursado-services-changed", servicesChanged);
    const cleanupView = view.cleanup;
    view.cleanup = () => {
      window.removeEventListener("cursado-services-changed", servicesChanged);
      cleanupView?.();
    };
    modelSelect.addEventListener("change", () => { try { localStorage.setItem("pdf-explanation-model", modelSelect.value); } catch {} });
    status.textContent = "Preparando la transcripción de la página…";
    preparePage(pdf, page).then(() => {
      if (modal === view && !generating) status.textContent = "Página lista · Enter para explicar";
    }, error => {
      if (modal === view && !generating) status.textContent = error.message;
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        if (!submit.disabled) form.requestSubmit();
      }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const question = input.value.trim() || "Explicalo";
      if (submit.disabled) return;
      generating = true;
      submit.disabled = true;
      input.disabled = true; removeRegion.disabled = true;
      modelSelect.disabled = true; refresh.disabled = true;
      form.setAttribute("aria-busy", "true"); loadingIndicator.hidden = false;
      const started = Date.now();
      const updateElapsed = () => { elapsed.textContent = `Cargando… ${Math.floor((Date.now() - started) / 1000)} s`; };
      updateElapsed();
      const ticker = setInterval(updateElapsed, 1000);
      const debug = { question, page, stage: "transcripcion", startedAt: new Date().toISOString(), outcome: "fallo" };
      try {
        await modelsReady;
        const selectedModel = modelSelect.value;
        if (!selectedModel) throw new Error("Esperá a que se cargue el modelo antes de generar.");
        debug.model = selectedModel;
        status.textContent = "Preparando la transcripción de la página…";
        const { state, text } = await preparePage(pdf, page);
        status.textContent = "Generando la explicación visual…";
        debug.transcription = text;
        const image = await captureRegion();
        if (image) debug.region = { ...region };
        const html = await window.requestPdfExplanation(question, text, message => { status.textContent = `${selectedModel} · ${message}`; }, debug, selectedModel, image, servicesFetch, getInstructions(), getSystemPrompt(currentProvider));
        debug.html = html;
        debug.stage = "guardar-html-y-nota";
        const pdfPage = await state.pdf.getPage(page);
        const [x1, y1, x2, y2] = pdfPage.view;
        const annotation = { annotationType: 3, pageIndex: page - 1, rect: [x1 + 24, y2 - 80, Math.min(x2 - 24, x1 + 320), y2 - 40], rotation: 0, color: [126, 70, 190], fontSize: 12, value: `★ ${question}` };
        const entry = { id: crypto.randomUUID(), question, html, annotation };
        if (state.root) await write(state.root, `manifests/pdf-explanations/${state.key}/${entry.id}.html`, entry.html);
        state.data.entries.push(entry);
        await persist(state);
        await restore();
        debug.stage = "mostrar-explicacion";
        if (modal === view) openHtml(entry);
        else showToast("Explicación guardada. Tocá la duda en el PDF para abrirla.", "success", 5000);
        debug.outcome = "exito";
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "No se pudo generar la explicación.";
        debug.error = status.textContent;
        if (modal !== view) report(error);
      } finally {
        clearInterval(ticker); loadingIndicator.hidden = true; form.removeAttribute("aria-busy");
        debug.finishedAt = new Date().toISOString();
        try { window.downloadPdfExplanationAttempt(debug); } catch (error) { console.error("[Verlo] Descarga de diagnóstico", error); }
        generating = false; submit.disabled = false; input.disabled = false; removeRegion.disabled = false;
        modelSelect.disabled = !modelSelect.value; refresh.disabled = false;
        if (modal === view) input.focus();
      }
    });
  }
  star.addEventListener("click", () => {
    if (modal?.node.classList.contains("pdf-explanation-composer")) close();
    else ask().catch(report);
  });
  menu.querySelector("button").addEventListener("click", ask);
  document.addEventListener("pointerdown", event => {
    if (!menu.contains(event.target) && !star.contains(event.target)) { menu.hidden = true; star.setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("keydown", event => {
    if (document.querySelector('dialog[open][aria-label="Agregar API de Datalab"]')) return;
    if (event.key === "Escape" && (modal || !menu.hidden)) {
      event.preventDefault(); event.stopImmediatePropagation(); close(); menu.hidden = true; star.setAttribute("aria-expanded", "false");
    }
    if (event.key === "Tab" && modal && !modal.node.classList.contains("pdf-explanation-composer")) {
      const items = [...modal.node.querySelectorAll("button:not(:disabled),textarea:not(:disabled),iframe")];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  window.addEventListener("message", event => {
    if (event.data?.type === "cursado-return-home" && event.source === modal?.node.querySelector("iframe")?.contentWindow) {
      if (window.parent !== window) window.parent.postMessage({ type: "cursado-return-home" }, window.location.origin);
      else void window.__cursadoReturnHome?.();
    }
    if (event.data?.type === "pdf-explanation-escape" && event.source === modal?.node.querySelector("iframe")?.contentWindow) close();
  });
  app.eventBus.on("documentloaded", () => { close(); load().then(restore).catch(report); });
  app.eventBus.on("pagerendered", restore);
  app.eventBus.on("annotationeditorlayerrendered", restore);
  app.eventBus.on("annotationeditormodechanged", restore);
  if (app.pdfDocument) load().then(restore).catch(report);
};
