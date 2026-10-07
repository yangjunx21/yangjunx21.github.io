(function () {
  'use strict';

  var editor = document.getElementById('editor-body');
  if (!editor) return;

  function $(id) { return document.getElementById(id); }
  var title = $('editor-title');
  var summary = $('editor-summary');
  var tags = $('editor-tags');
  var status = $('draft-status');
  var outline = $('editor-outline');
  var picker = $('editor-image-picker');
  var checklist = $('publish-checklist');
  var dialog = $('publish-dialog');
  var transferList = $('image-transfer-list');
  var publishLink = $('github-publish-link');
  var fallback = $('markdown-fallback');
  var linkForm = $('link-form');
  var linkInput = $('link-url');
  var linkRemove = $('link-remove');
  var linkError = $('link-error');
  var figureTools = $('figure-tools');
  var tableTools = $('table-tools');
  var codeTools = $('code-tools');
  var codeLanguage = $('code-language');
  var mathPanel = $('math-panel');
  var mathSource = $('math-source');
  var mathPreview = $('math-preview');
  var publishButton = $('prepare-publish');
  var toolbarButtons = Array.prototype.slice.call(document.querySelectorAll('.blog-editor__toolbar button'));

  var ISSUE_URL = 'https://github.com/yangjunx21/yangjunx21.github.io/issues/new?';
  var CJK = /[㐀-鿿豈-﫿]/g;
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var saveTimer = null;
  var loaded = false;
  var imageSelection = null;
  var linkRange = null;
  var activeFigure = null;
  var activeTable = null;
  var activeCode = null;
  var editingMath = null;
  var editingMathIsNew = false;
  var handoffMarkdown = '';

  document.execCommand('defaultParagraphSeparator', false, 'p');

  // ---------------------------------------------------------------- helpers

  function exec(command, value) { return document.execCommand(command, false, value === undefined ? null : value); }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function el(tag) { return document.createElement(tag); }

  function emptyParagraph() {
    var p = el('p');
    p.appendChild(el('br'));
    return p;
  }

  // Formulas render as MathJax markup without text, so "empty" checks look for them too.
  function hasContent(node) {
    return Boolean(node.textContent.replace(/\u200b/g, '').trim() || (node.querySelector && node.querySelector('img, [data-tex], table, hr')));
  }

  function isMath(node) {
    return Boolean(node && node.nodeType === 1 && node.hasAttribute('data-tex'));
  }

  function isPreview(node) {
    return Boolean(node && node.nodeType === 1 && node.hasAttribute('data-preview'));
  }

  function closestInEditor(node, tag) {
    while (node && node !== editor) {
      if (node.nodeType === 1 && node.tagName === tag) return node;
      node = node.parentNode;
    }
    return null;
  }

  function topBlock(node) {
    if (!node || node === editor || !editor.contains(node)) return null;
    while (node.parentNode !== editor) node = node.parentNode;
    return node;
  }

  function selectRange(range) {
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function caretInto(node, atEnd) {
    var range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(!atEnd);
    editor.focus({ preventScroll: true });
    selectRange(range);
  }

  function selectionInBody() {
    var selection = window.getSelection();
    if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return null;
    if (closestInEditor(selection.anchorNode, 'FIGCAPTION')) return null;
    return selection;
  }

  function selectionRange() {
    var selection = selectionInBody();
    if (selection) return selection.getRangeAt(0).cloneRange();
    var range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  function autosize(field) {
    field.style.height = 'auto';
    field.style.height = field.scrollHeight + 'px';
  }

  function dateTimeLabel(time) {
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(time));
  }

  function timeLabel(date) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function setStatus(message, state) {
    status.textContent = message;
    status.setAttribute('data-state', state || 'idle');
  }

  function tagList() {
    return tags.value.split(/[,，]/).map(function (tag) { return tag.trim(); }).filter(Boolean);
  }

  // ------------------------------------------------------- draft storage

  var dbReady = new Promise(function (resolve, reject) {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    var request = indexedDB.open('junxiao-blog-editor', 1);
    request.onupgradeneeded = function () {
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });

  function getDraft() {
    return {
      title: title.value,
      summary: summary.value,
      tags: tags.value,
      html: serializeEditor(),
      updated: Date.now()
    };
  }

  // Save formulas as their TeX source and drop generated previews and selection marks.
  function serializeEditor() {
    var clone = editor.cloneNode(true);
    clone.querySelectorAll('[data-tex]').forEach(function (node) {
      node.textContent = mathFallback(node.getAttribute('data-tex'), isBlockMath(node));
      node.classList.remove('is-rendered', 'tex2jax_process');
    });
    clone.querySelectorAll('[data-preview]').forEach(function (node) { node.parentNode.removeChild(node); });
    clone.querySelectorAll('[data-selected]').forEach(function (node) { node.removeAttribute('data-selected'); });
    return clone.innerHTML;
  }

  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!loaded) return Promise.resolve();
    return dbReady.then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction('drafts', 'readwrite').objectStore('drafts').put(getDraft(), 'current');
        request.onsuccess = resolve;
        request.onerror = function () { reject(request.error); };
      });
    }).then(function () {
      setStatus('已保存 · ' + timeLabel(new Date()), 'saved');
    }, function () {
      setStatus('保存失败，请下载备份', 'error');
    });
  }

  function scheduleSave() {
    if (!loaded) return;
    setStatus('正在保存…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 600);
    refresh();
  }

  function flushSave() { if (saveTimer) saveDraft(); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', flushSave);

  // ------------------------------------------------- document structure

  var INLINE_TAG = /^(A|B|STRONG|I|EM|CODE|BR|SPAN|FONT|S|DEL|U|SUB|SUP|MARK|IMG|CARET-MARK)$/;

  function isStray(node) {
    if (node.nodeType === 3) return node.data.trim() !== '';
    return node.nodeType === 1 && INLINE_TAG.test(node.tagName) && !isBlockMath(node);
  }

  function isPlainDiv(node) {
    return node.nodeType === 1 && node.tagName === 'DIV' && !isMath(node) && !isPreview(node);
  }

  function withCaret(fn) {
    var selection = window.getSelection();
    var mark = null;
    if (selection.rangeCount && editor.contains(selection.anchorNode)) {
      var range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      mark = el('caret-mark');
      range.insertNode(mark);
    }
    fn();
    if (mark && mark.parentNode) {
      var restore = document.createRange();
      restore.setStartBefore(mark);
      restore.collapse(true);
      mark.parentNode.removeChild(mark);
      selectRange(restore);
    }
  }

  var NESTED_BLOCK = /^(P|DIV|UL|OL|BLOCKQUOTE|PRE|H[1-6]|FIGURE|HR|TABLE)$/;

  function isNestedBlock(node) {
    return node.nodeType === 1 && (NESTED_BLOCK.test(node.tagName) || isBlockMath(node)) && !(isMath(node) && !isBlockMath(node));
  }

  // Chrome nests new lists (and the paragraphs after them) inside the paragraph they started
  // from. Split such paragraphs so every block sits directly in the editor again.
  function liftBlocks() {
    var changed = false;
    Array.prototype.slice.call(editor.children).forEach(function (block) {
      if (!/^(P|H[1-6])$/.test(block.tagName)) return;
      if (!Array.prototype.some.call(block.children, isNestedBlock)) return;
      var run = null;
      Array.prototype.slice.call(block.childNodes).forEach(function (child) {
        if (isNestedBlock(child)) {
          run = null;
          editor.insertBefore(child, block);
        } else {
          if (!run) {
            run = block.cloneNode(false);
            editor.insertBefore(run, block);
          }
          run.appendChild(child);
        }
      });
      editor.removeChild(block);
      changed = true;
    });
    Array.prototype.slice.call(editor.children).forEach(function (block) {
      if (block.tagName === 'P' && !block.firstChild) block.appendChild(el('br'));
      if (block.tagName === 'P' && !hasContent(block) && !block.querySelector('br, caret-mark')) editor.removeChild(block);
    });
    return changed;
  }

  function hasNestedBlocks() {
    return Array.prototype.some.call(editor.children, function (block) {
      return /^(P|H[1-6])$/.test(block.tagName) && Array.prototype.some.call(block.children, isNestedBlock);
    });
  }

  // Keep the body as a flat list of blocks so the editor matches the published article.
  function tidy(deep) {
    for (var pass = 0; pass < 6 && liftBlocks(); pass += 1) { /* repeat until flat */ }
    if (deep) {
      editor.querySelectorAll('[style]').forEach(function (node) {
        if (!node.closest('figure, [data-tex]')) node.removeAttribute('style');
      });
      editor.querySelectorAll('span:not([data-tex]), font').forEach(function (node) {
        if (node.closest('[data-tex], [data-preview]')) return;
        while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
        node.parentNode.removeChild(node);
      });
    }
    var node = editor.firstChild;
    while (node) {
      var next = node.nextSibling;
      if (node.nodeType === 3 && !node.data.trim()) {
        editor.removeChild(node);
      } else if (isStray(node)) {
        var p = el('p');
        editor.insertBefore(p, node);
        while (node && (isStray(node) || (node.nodeType === 3))) {
          next = node.nextSibling;
          p.appendChild(node);
          node = next;
        }
        next = node;
      } else if (isPlainDiv(node)) {
        var paragraph = el('p');
        while (node.firstChild) paragraph.appendChild(node.firstChild);
        editor.replaceChild(paragraph, node);
      }
      node = next;
    }
    editor.querySelectorAll('[data-task]').forEach(function (node) {
      if (node.tagName !== 'LI') node.removeAttribute('data-task');
    });
    var last = editor.lastElementChild;
    if (last && last.tagName !== 'P') editor.appendChild(emptyParagraph());
  }

  function hasStrayNodes() {
    return hasNestedBlocks() || Array.prototype.some.call(editor.childNodes, function (node) {
      return isStray(node) || isPlainDiv(node);
    });
  }

  function listCommand(command) {
    exec(command);
    withCaret(function () { tidy(false); });
  }

  function ensureStarted() {
    if (editor.firstElementChild || editor.textContent.trim()) return;
    var p = emptyParagraph();
    editor.replaceChildren(p);
    caretInto(p, false);
  }

  // ------------------------------------------------------------ figures

  function makeFigure(src, caption, alt) {
    var figure = el('figure');
    figure.className = 'blog-editor__figure';
    figure.setAttribute('contenteditable', 'false');
    var image = el('img');
    image.src = src;
    image.alt = alt || '';
    if (/^data:/i.test(src)) image.setAttribute('data-local-image', '');
    var figcaption = el('figcaption');
    figcaption.setAttribute('contenteditable', 'true');
    figcaption.setAttribute('data-placeholder', '添加图片说明（可选）');
    figcaption.textContent = caption || '';
    figure.appendChild(image);
    figure.appendChild(figcaption);
    return figure;
  }

  // Same shape-based sizing as the published article, so the preview matches.
  function sizeImage(image) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    var ratio = image.naturalWidth / image.naturalHeight;
    var vector = /\.svg(\?|#|$)/i.test(image.currentSrc || image.src);
    image.classList.toggle('is-wide', ratio >= 1.6);
    image.classList.toggle('is-tall', ratio < 1.2);
    image.classList.toggle('is-small', !vector && image.naturalWidth < 520);
  }

  editor.addEventListener('load', function (event) {
    if (event.target.tagName === 'IMG') sizeImage(event.target);
  }, true);

  function paragraphAfter(node) {
    while (isPreview(node.nextElementSibling)) node = node.nextElementSibling;
    var next = node.nextElementSibling;
    if (next && next.tagName === 'P') return next;
    var p = emptyParagraph();
    editor.insertBefore(p, node.nextSibling);
    return p;
  }

  function wrapFragment(fragment) {
    var holder = el('div');
    holder.appendChild(fragment.cloneNode(true));
    return holder;
  }

  // Insert a block at the caret: split a paragraph in two, or go after the current block.
  function placeBlock(node, range) {
    var block = range ? topBlock(range.startContainer) : null;
    if (!block) {
      editor.appendChild(node);
    } else if (block.nodeType === 1 && block.tagName === 'P' && !hasContent(block)) {
      editor.replaceChild(node, block);
    } else if (block.nodeType === 1 && block.tagName === 'P') {
      var tail = document.createRange();
      tail.setStart(range.endContainer, range.endOffset);
      tail.setEnd(block, block.childNodes.length);
      var rest = tail.extractContents();
      editor.insertBefore(node, block.nextSibling);
      if (hasContent(rest.firstChild ? wrapFragment(rest) : el('p'))) {
        var after = el('p');
        after.appendChild(rest);
        editor.insertBefore(after, node.nextSibling);
      }
      if (!hasContent(block)) editor.removeChild(block);
    } else {
      while (isPreview(block.nextElementSibling)) block = block.nextElementSibling;
      editor.insertBefore(node, block.nextSibling);
    }
    return paragraphAfter(node);
  }

  function upgradeLegacyImages() {
    editor.querySelectorAll('img').forEach(function (image) {
      if (image.closest('figure')) return;
      var block = topBlock(image);
      var figure = makeFigure(image.getAttribute('src'), image.getAttribute('title') || '', image.getAttribute('alt'));
      var anchor = block === image ? image.nextSibling : block.nextSibling;
      while (anchor && anchor.nodeType === 1 && anchor.tagName === 'FIGURE' && anchor.getAttribute('data-upgraded') !== null) anchor = anchor.nextSibling;
      image.parentNode.removeChild(image);
      figure.setAttribute('data-upgraded', '');
      editor.insertBefore(figure, anchor);
      if (block !== image && !hasContent(block)) editor.removeChild(block);
    });
    editor.querySelectorAll('[data-upgraded]').forEach(function (figure) { figure.removeAttribute('data-upgraded'); });
  }

  function showFigureTools(figure) {
    hideFigureTools();
    activeFigure = figure;
    figure.setAttribute('data-selected', '');
    figureTools.hidden = false;
    positionFigureTools();
  }

  function positionFigureTools() {
    if (!activeFigure) return;
    var rect = activeFigure.querySelector('img').getBoundingClientRect();
    figureTools.style.top = Math.round(rect.top + window.scrollY + 8) + 'px';
    figureTools.style.left = Math.round(rect.right + window.scrollX - figureTools.offsetWidth - 8) + 'px';
  }

  function hideFigureTools() {
    activeFigure = null;
    figureTools.hidden = true;
    editor.querySelectorAll('[data-selected]').forEach(function (node) { node.removeAttribute('data-selected'); });
  }

  function removeFigure(figure) {
    var next = figure.nextElementSibling || figure.previousElementSibling;
    hideFigureTools();
    figure.parentNode.removeChild(figure);
    tidy(false);
    if (next) caretInto(next, false);
    scheduleSave();
  }

  function moveFigure(direction) {
    var figure = activeFigure;
    if (!figure) return;
    var sibling = direction < 0 ? figure.previousElementSibling : figure.nextElementSibling;
    if (!sibling) return;
    editor.insertBefore(figure, direction < 0 ? sibling : sibling.nextSibling);
    tidy(false);
    figure.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    window.setTimeout(positionFigureTools, 250);
    scheduleSave();
  }

  editor.addEventListener('mousedown', function (event) {
    var math = event.target.closest && event.target.closest('[data-tex]');
    if (math && editor.contains(math)) {
      event.preventDefault();
      openMath(math, false);
      return;
    }
    var item = event.target;
    if (item.tagName === 'LI' && item.hasAttribute('data-task') && event.clientX < item.getBoundingClientRect().left) {
      event.preventDefault();
      item.setAttribute('data-task', item.getAttribute('data-task') === 'done' ? 'todo' : 'done');
      scheduleSave();
      return;
    }
    var figure = event.target.closest && event.target.closest('figure');
    if (figure && event.target.tagName === 'IMG') {
      event.preventDefault();
      caretInto(paragraphAfter(figure), false);
      showFigureTools(figure);
    } else if (activeFigure) {
      hideFigureTools();
    }
  });
  document.addEventListener('mousedown', function (event) {
    if (activeFigure && !editor.contains(event.target) && !figureTools.contains(event.target)) hideFigureTools();
  });
  figureTools.addEventListener('mousedown', function (event) { event.preventDefault(); });
  $('figure-delete').addEventListener('click', function () { if (activeFigure) removeFigure(activeFigure); });
  $('figure-up').addEventListener('click', function () { moveFigure(-1); });
  $('figure-down').addEventListener('click', function () { moveFigure(1); });
  window.addEventListener('resize', positionFigureTools);

  // ------------------------------------------------------------ formulas

  var mathQueue = Promise.resolve();
  var mathReady = null;
  var mathPreviewTimer = 0;

  function isBlockMath(node) {
    return isMath(node) && node.classList.contains('blog-math--block');
  }

  function mathFallback(tex, display) {
    return display ? '$$' + tex + '$$' : '$' + tex + '$';
  }

  function mathElement(tex, display) {
    var node = el(display ? 'div' : 'span');
    node.className = display ? 'blog-math blog-math--block' : 'blog-math';
    node.setAttribute('contenteditable', 'false');
    node.setAttribute('data-tex', tex || '');
    node.textContent = mathFallback(tex || '', display);
    return node;
  }

  function whenMathJax() {
    if (!mathReady) {
      mathReady = new Promise(function (resolve, reject) {
        var tries = 0;
        (function check() {
          var mathJax = window.MathJax;
          if (mathJax && mathJax.typesetPromise && mathJax.startup && mathJax.startup.promise) {
            mathJax.startup.promise.then(resolve, reject);
          } else if ((tries += 1) > 200) {
            reject(new Error('MathJax unavailable'));
          } else {
            window.setTimeout(check, 100);
          }
        })();
      });
    }
    return mathReady;
  }

  // Typeset one element; MathJax calls are chained so they never overlap.
  function typeset(node, tex, display) {
    node.classList.add('tex2jax_process');
    return whenMathJax().then(function () {
      mathQueue = mathQueue.then(function () {
        if (!node.isConnected) return null;
        if (window.MathJax.typesetClear) window.MathJax.typesetClear([node]);
        node.textContent = display ? '\\[' + tex + '\\]' : '\\(' + tex + '\\)';
        return window.MathJax.typesetPromise([node]);
      }).catch(function () {
        node.textContent = mathFallback(tex, display);
      });
      return mathQueue;
    });
  }

  function renderMath(node) {
    var tex = node.getAttribute('data-tex') || '';
    var display = isBlockMath(node);
    node.classList.remove('is-rendered');
    node.classList.toggle('is-empty-math', !tex.trim());
    node.textContent = tex.trim() ? mathFallback(tex, display) : (display ? '点击输入公式' : '公式');
    if (!tex.trim()) return;
    typeset(node, tex, display).then(function () {
      if (node.getAttribute('data-tex') === tex) node.classList.add('is-rendered');
    }, function () { /* keep the TeX source visible */ });
  }

  function renderPendingMath() {
    editor.querySelectorAll('[data-tex]:not(.is-rendered)').forEach(renderMath);
  }

  // Chrome's insertHTML splits paragraphs around contenteditable=false spans and strips
  // attributes from plain spans, so inline formulas go in as <x-math> and are swapped after.
  function mathPlaceholder(tex) {
    return '<x-math data-tex="' + escapeHtml(tex) + '">' + escapeHtml(mathFallback(tex, false)) + '</x-math>';
  }

  function insertableHtml(holder) {
    holder.querySelectorAll('span[data-tex]').forEach(function (math) {
      var placeholder = el('x-math');
      placeholder.setAttribute('data-tex', math.getAttribute('data-tex'));
      placeholder.textContent = mathFallback(math.getAttribute('data-tex'), false);
      math.parentNode.replaceChild(placeholder, math);
    });
    return holder.innerHTML;
  }

  function hydrateMath() {
    editor.querySelectorAll('x-math').forEach(function (placeholder) {
      placeholder.parentNode.replaceChild(mathElement(placeholder.getAttribute('data-tex') || '', false), placeholder);
    });
    renderPendingMath();
  }

  function openMath(node, isNew) {
    if (editingMath && editingMath !== node) commitMath();
    hideFigureTools();
    hideBlockTools();
    var display = isBlockMath(node);
    editingMath = node;
    editingMathIsNew = Boolean(isNew);
    node.setAttribute('data-selected', '');
    mathSource.value = node.getAttribute('data-tex') || '';
    $('math-mode').textContent = display ? '独立公式' : '行内公式';
    $('math-toggle').textContent = display ? '改为行内' : '改为独立';
    $('math-hint').textContent = display ? (isMac ? '⌘↵' : 'Ctrl+↵') + ' 完成 · Esc 取消' : '↵ 完成 · Esc 取消';
    mathPanel.classList.toggle('is-block', display);
    mathPanel.hidden = false;
    autosize(mathSource);
    positionMathPanel();
    mathSource.focus({ preventScroll: true });
    mathSource.setSelectionRange(mathSource.value.length, mathSource.value.length);
    previewMath();
  }

  function positionMathPanel() {
    if (!editingMath) return;
    var rect = editingMath.getBoundingClientRect();
    var left = Math.min(Math.max(12, rect.left), document.documentElement.clientWidth - mathPanel.offsetWidth - 12);
    mathPanel.style.top = Math.round(rect.bottom + window.scrollY + 8) + 'px';
    mathPanel.style.left = Math.round(left + window.scrollX) + 'px';
  }

  function previewMath() {
    clearTimeout(mathPreviewTimer);
    mathPreviewTimer = setTimeout(function () {
      var tex = mathSource.value.trim();
      mathPreview.classList.toggle('is-placeholder', !tex);
      if (!tex) { mathPreview.textContent = '预览'; return; }
      typeset(mathPreview, tex, Boolean(editingMath && isBlockMath(editingMath))).then(positionMathPanel, function () {});
    }, 120);
  }

  function closeMath() {
    mathPanel.hidden = true;
    if (editingMath) editingMath.removeAttribute('data-selected');
    editingMath = null;
    editingMathIsNew = false;
  }

  function caretAfterMath(node) {
    if (!node.isConnected) return;
    if (isBlockMath(node)) { caretInto(paragraphAfter(node), false); return; }
    var range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    editor.focus({ preventScroll: true });
    selectRange(range);
  }

  function removeMath(node) {
    if (!node.isConnected) return;
    var display = isBlockMath(node);
    var next = display ? (node.nextElementSibling || node.previousElementSibling) : null;
    var range = document.createRange();
    range.setStartBefore(node);
    range.collapse(true);
    node.parentNode.removeChild(node);
    tidy(false);
    if (next && next.isConnected) caretInto(next, false);
    else if (!display) { editor.focus({ preventScroll: true }); selectRange(range); }
    scheduleSave();
  }

  function commitMath() {
    var node = editingMath;
    if (!node) return;
    var tex = mathSource.value.trim();
    closeMath();
    if (!tex) { removeMath(node); return; }
    if (tex !== node.getAttribute('data-tex')) {
      node.setAttribute('data-tex', tex);
      renderMath(node);
    }
    caretAfterMath(node);
    scheduleSave();
  }

  function cancelMath() {
    var node = editingMath;
    var isNew = editingMathIsNew;
    closeMath();
    if (!node) return;
    if (isNew || !node.getAttribute('data-tex')) removeMath(node);
    else caretAfterMath(node);
  }

  function toggleMathDisplay() {
    var node = editingMath;
    if (!node) return;
    var isNew = editingMathIsNew;
    var display = !isBlockMath(node);
    var replacement = mathElement(mathSource.value.trim(), display);
    node.removeAttribute('data-selected');
    editingMath = null;
    if (display) {
      var range = document.createRange();
      range.setStartAfter(node);
      range.collapse(true);
      node.parentNode.removeChild(node);
      placeBlock(replacement, range);
    } else {
      var paragraph = el('p');
      paragraph.appendChild(replacement);
      editor.replaceChild(paragraph, node);
    }
    tidy(false);
    renderMath(replacement);
    openMath(replacement, isNew);
    scheduleSave();
  }

  function insertMath() {
    focusBody();
    var selection = selectionInBody();
    var text = selection && !selection.isCollapsed ? selection.toString().trim() : '';
    if (text) {
      exec('insertHTML', mathPlaceholder(text) + '\u200b');
      withCaret(function () { tidy(true); });
      hydrateMath();
      scheduleSave();
      return;
    }
    var node = mathElement('', true);
    placeBlock(node, selectionRange());
    renderMath(node);
    openMath(node, true);
    scheduleSave();
  }

  mathSource.addEventListener('input', function () {
    autosize(mathSource);
    previewMath();
  });
  mathSource.addEventListener('keydown', function (event) {
    if (event.isComposing || event.keyCode === 229) return;
    var mod = isMac ? event.metaKey : event.ctrlKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelMath();
    } else if (event.key === 'Enter' && (mod || (!event.shiftKey && editingMath && !isBlockMath(editingMath)))) {
      event.preventDefault();
      commitMath();
    }
  });
  mathPanel.addEventListener('mousedown', function (event) {
    if (event.target !== mathSource) event.preventDefault();
  });
  $('math-done').addEventListener('click', commitMath);
  $('math-toggle').addEventListener('click', toggleMathDisplay);
  $('math-delete').addEventListener('click', function () {
    var node = editingMath;
    closeMath();
    if (node) removeMath(node);
  });
  document.addEventListener('mousedown', function (event) {
    if (!editingMath || mathPanel.contains(event.target)) return;
    if (event.target.closest && event.target.closest('[data-tex]') === editingMath) return;
    commitMath();
  });
  window.addEventListener('resize', positionMathPanel);

  // -------------------------------------------------------------- tables

  function makeTable(rows, columns, header) {
    var table = el('table');
    var head = el('thead');
    var body = el('tbody');
    for (var r = 0; r < rows; r += 1) {
      var row = el('tr');
      for (var c = 0; c < columns; c += 1) {
        var cell = el(r === 0 ? 'th' : 'td');
        if (r === 0 && header && header[c]) cell.textContent = header[c];
        else cell.appendChild(el('br'));
        row.appendChild(cell);
      }
      (r === 0 ? head : body).appendChild(row);
    }
    table.appendChild(head);
    table.appendChild(body);
    return table;
  }

  function insertTable(header) {
    focusBody();
    var table = makeTable(header ? 2 : 3, header ? header.length : 3, header);
    placeBlock(table, selectionRange());
    caretInto(header ? table.rows[1].cells[0] : table.rows[0].cells[0], false);
    scheduleSave();
  }

  function currentCell() {
    var selection = selectionInBody();
    return selection ? closestInEditor(selection.anchorNode, 'TD') || closestInEditor(selection.anchorNode, 'TH') : null;
  }

  function cellAt(table, rowIndex, columnIndex) {
    var row = table.rows[rowIndex];
    return row ? row.cells[Math.max(0, Math.min(columnIndex, row.cells.length - 1))] : null;
  }

  function addRow(table, afterIndex) {
    var row = el('tr');
    Array.prototype.forEach.call(table.rows[0].cells, function (headerCell) {
      var cell = el('td');
      if (headerCell.getAttribute('align')) cell.setAttribute('align', headerCell.getAttribute('align'));
      cell.appendChild(el('br'));
      row.appendChild(cell);
    });
    var body = table.tBodies[0] || table.appendChild(el('tbody'));
    var reference = table.rows[afterIndex];
    if (reference && reference.parentNode === body) body.insertBefore(row, reference.nextSibling);
    else body.insertBefore(row, body.firstChild);
    return row;
  }

  function removeTable(table) {
    var next = paragraphAfter(table);
    table.parentNode.removeChild(table);
    hideBlockTools();
    caretInto(next, false);
    scheduleSave();
  }

  function tableAction(action) {
    var cell = currentCell() || (activeTable && activeTable.isConnected ? activeTable.rows[0].cells[0] : null);
    if (!cell) return;
    var table = cell.closest('table');
    var rowIndex = cell.parentNode.rowIndex;
    var columnIndex = cell.cellIndex;
    var target = cell;
    if (action === 'delete') { removeTable(table); return; }
    if (action === 'row') {
      target = addRow(table, rowIndex).cells[columnIndex];
    } else if (action === 'column') {
      Array.prototype.forEach.call(table.rows, function (row) {
        var added = el(row.parentNode.tagName === 'THEAD' ? 'th' : 'td');
        added.appendChild(el('br'));
        row.insertBefore(added, row.cells[columnIndex] ? row.cells[columnIndex].nextSibling : null);
      });
      target = cellAt(table, rowIndex, columnIndex + 1);
    } else if (action === 'delete-row') {
      if (rowIndex === 0) { setStatus('表头行不能单独删除，可以删除整个表格', 'idle'); return; }
      if (table.rows.length <= 2) {
        Array.prototype.forEach.call(table.rows[1].cells, function (item) { item.replaceChildren(el('br')); });
      } else {
        table.rows[rowIndex].parentNode.removeChild(table.rows[rowIndex]);
        target = cellAt(table, Math.min(rowIndex, table.rows.length - 1), columnIndex);
      }
    } else if (action === 'delete-column') {
      if (table.rows[0].cells.length <= 1) { removeTable(table); return; }
      Array.prototype.forEach.call(table.rows, function (row) {
        if (row.cells[columnIndex]) row.removeChild(row.cells[columnIndex]);
      });
      target = cellAt(table, rowIndex, columnIndex - 1);
    } else if (action === 'align') {
      var order = ['', 'left', 'center', 'right'];
      var labels = { '': '默认', left: '左对齐', center: '居中', right: '右对齐' };
      var next = order[(order.indexOf(table.rows[0].cells[columnIndex].getAttribute('align') || '') + 1) % order.length];
      Array.prototype.forEach.call(table.rows, function (row) {
        var item = row.cells[columnIndex];
        if (!item) return;
        if (next) item.setAttribute('align', next);
        else item.removeAttribute('align');
      });
      setStatus('本列' + labels[next], 'idle');
    }
    caretInto(target, true);
    showTableTools(table);
    scheduleSave();
  }

  function moveInTable(cell, step) {
    var table = cell.closest('table');
    var cells = Array.prototype.slice.call(table.querySelectorAll('th, td'));
    var next = cells[cells.indexOf(cell) + step];
    if (!next && step > 0) next = addRow(table, table.rows.length - 1).cells[0];
    if (next) caretInto(next, true);
    scheduleSave();
  }

  function leaveTable(table, backward) {
    var target = backward ? table.previousElementSibling : paragraphAfter(table);
    if (target) caretInto(target, Boolean(backward));
    hideBlockTools();
  }

  // Enter moves down a row; on an empty last row it removes that row and leaves the table.
  function moveDownInTable(cell) {
    var table = cell.closest('table');
    var row = cell.parentNode;
    var rowIndex = row.rowIndex;
    if (!table.rows[rowIndex + 1]) {
      if (rowIndex > 1 && !hasContent(row)) {
        row.parentNode.removeChild(row);
        leaveTable(table, false);
        scheduleSave();
        return;
      }
      addRow(table, rowIndex);
    }
    caretInto(cellAt(table, rowIndex + 1, cell.cellIndex), true);
    scheduleSave();
  }

  function placeTool(tool, rect, inside) {
    tool.hidden = false;
    var top = inside ? rect.top + 6 : rect.top - tool.offsetHeight - 6;
    tool.style.top = Math.round(Math.max(top, 76) + window.scrollY) + 'px';
    tool.style.left = Math.round(rect.right - tool.offsetWidth - (inside ? 6 : 0) + window.scrollX) + 'px';
  }

  function showTableTools(table) {
    activeTable = table;
    placeTool(tableTools, table.getBoundingClientRect(), false);
  }

  function showCodeTools(pre) {
    if (activeCode !== pre) codeLanguage.value = pre.getAttribute('data-lang') || '';
    activeCode = pre;
    placeTool(codeTools, pre.getBoundingClientRect(), true);
  }

  function hideBlockTools() {
    activeTable = null;
    activeCode = null;
    tableTools.hidden = true;
    codeTools.hidden = true;
  }

  function updateBlockTools() {
    var selection = selectionInBody();
    var cell = selection && (closestInEditor(selection.anchorNode, 'TD') || closestInEditor(selection.anchorNode, 'TH'));
    var pre = selection && closestInEditor(selection.anchorNode, 'PRE');
    if (cell) showTableTools(cell.closest('table'));
    else if (!tableTools.contains(document.activeElement)) { activeTable = null; tableTools.hidden = true; }
    if (pre) showCodeTools(pre);
    else if (document.activeElement !== codeLanguage) { activeCode = null; codeTools.hidden = true; }
  }

  tableTools.addEventListener('mousedown', function (event) { event.preventDefault(); });
  tableTools.querySelectorAll('[data-table-action]').forEach(function (button) {
    button.addEventListener('click', function () { tableAction(button.getAttribute('data-table-action')); });
  });
  codeLanguage.addEventListener('input', function () {
    if (!activeCode) return;
    var language = codeLanguage.value.trim().toLowerCase().replace(/[^\w+#.-]/g, '');
    if (language) activeCode.setAttribute('data-lang', language);
    else activeCode.removeAttribute('data-lang');
    scheduleSave();
  });
  codeLanguage.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    if (activeCode) caretInto(activeCode, true);
  });
  codeLanguage.addEventListener('blur', function () {
    window.setTimeout(updateBlockTools, 0);
  });
  window.addEventListener('resize', updateBlockTools);

  // ------------------------------------------------- mermaid previews

  var mermaidLoader = null;
  var diagramTimer = 0;
  var diagramCount = 0;

  function loadMermaid() {
    if (!mermaidLoader) {
      mermaidLoader = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(function (module) {
        module.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
        return module.default;
      });
    }
    return mermaidLoader;
  }

  function syncDiagrams() {
    editor.querySelectorAll('[data-preview]').forEach(function (preview) {
      var pre = preview.previousElementSibling;
      if (!pre || pre.tagName !== 'PRE' || pre.getAttribute('data-lang') !== 'mermaid') preview.parentNode.removeChild(preview);
    });
    clearTimeout(diagramTimer);
    if (editor.querySelector('pre[data-lang="mermaid"]')) diagramTimer = setTimeout(renderDiagrams, 450);
  }

  function renderDiagrams() {
    var blocks = Array.prototype.filter.call(editor.querySelectorAll('pre[data-lang="mermaid"]'), function (pre) {
      return pre.parentNode === editor;
    });
    loadMermaid().then(function (mermaid) {
      blocks.forEach(function (pre) {
        if (pre.parentNode !== editor || pre.getAttribute('data-lang') !== 'mermaid') return;
        var source = (pre.innerText || pre.textContent).replace(/\u200b/g, '').trim();
        var preview = isPreview(pre.nextElementSibling) ? pre.nextElementSibling : null;
        if (!preview) {
          preview = el('figure');
          preview.className = 'blog-editor__diagram';
          preview.setAttribute('contenteditable', 'false');
          preview.setAttribute('data-preview', '');
          editor.insertBefore(preview, pre.nextSibling);
        }
        if (preview.getAttribute('data-source') === source) return;
        preview.setAttribute('data-source', source);
        if (!source) { preview.textContent = '输入 mermaid 代码后在这里预览'; return; }
        diagramCount += 1;
        var id = 'blog-diagram-' + diagramCount;
        mermaid.render(id, source).then(function (result) {
          if (preview.getAttribute('data-source') === source) preview.innerHTML = result.svg;
        }, function () {
          ['d' + id, id].forEach(function (stray) {
            var node = document.getElementById(stray);
            if (node && !editor.contains(node)) node.parentNode.removeChild(node);
          });
          if (preview.getAttribute('data-source') === source) preview.textContent = '图表语法有误，发布后会显示为代码';
        });
      });
    }, function () {
      blocks.forEach(function (pre) {
        if (isPreview(pre.nextElementSibling)) pre.nextElementSibling.textContent = '图表预览加载失败';
      });
    });
  }

  // -------------------------------------------------- tasks & highlight

  function currentItem() {
    var selection = selectionInBody();
    return selection ? closestInEditor(selection.anchorNode, 'LI') : null;
  }

  function toggleTaskList() {
    focusBody();
    var item = currentItem();
    if (!item) {
      listCommand('insertUnorderedList');
      item = currentItem();
      if (item) item.setAttribute('data-task', 'todo');
      scheduleSave();
      return;
    }
    var enable = !item.hasAttribute('data-task');
    Array.prototype.forEach.call(item.parentNode.children, function (sibling) {
      if (sibling.tagName !== 'LI') return;
      if (enable) sibling.setAttribute('data-task', sibling.getAttribute('data-task') || 'todo');
      else sibling.removeAttribute('data-task');
    });
    scheduleSave();
  }

  function toggleMark() {
    focusBody();
    var selection = window.getSelection();
    var mark = closestInEditor(selection.anchorNode, 'MARK');
    if (mark) {
      var range = document.createRange();
      range.selectNode(mark);
      selectRange(range);
      var inner = el('div');
      inner.innerHTML = mark.innerHTML;
      exec('insertHTML', insertableHtml(inner));
    } else if (selection.isCollapsed) {
      setStatus('先选中要高亮的文字，或输入 ==文字==', 'idle');
      return;
    } else {
      var holder = el('div');
      holder.appendChild(selection.getRangeAt(0).cloneContents());
      exec('insertHTML', '<mark>' + insertableHtml(holder) + '</mark>\u200b');
    }
    withCaret(function () { tidy(true); });
    hydrateMath();
    scheduleSave();
  }

  // ------------------------------------------------------------- images

  function isImage(file) { return /^image\/(png|jpeg|gif|webp)$/.test(file.type); }

  function readImage(file) {
    return new Promise(function (resolve) {
      if (!isImage(file)) { setStatus('只支持 PNG、JPEG、GIF、WebP 图片', 'error'); resolve(null); return; }
      if (file.size > 12 * 1024 * 1024) { setStatus('图片超过 12 MB，请先压缩', 'error'); resolve(null); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { setStatus('图片读取失败', 'error'); resolve(null); };
      reader.readAsDataURL(file);
    });
  }

  function insertFiles(files, range) {
    var list = Array.prototype.filter.call(files, function (file) { return file.type.indexOf('image/') === 0; });
    if (!list.length) return;
    range = range || selectionRange();
    hideFigureTools();
    list.reduce(function (pending, file) {
      return pending.then(function () {
        return readImage(file).then(function (src) {
          if (!src) return;
          var figure = makeFigure(src, '', '');
          var after = placeBlock(figure, range);
          range = document.createRange();
          range.setStart(after, 0);
          range.collapse(true);
        });
      });
    }, Promise.resolve()).then(function () {
      if (range) { editor.focus({ preventScroll: true }); selectRange(range); }
      scheduleSave();
    });
  }

  function rangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(x, y);
      if (!position) return null;
      var range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }
    return null;
  }

  editor.addEventListener('dragover', function (event) {
    if (Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') !== -1) {
      event.preventDefault();
      editor.classList.add('is-dropping');
    }
  });
  editor.addEventListener('dragleave', function () { editor.classList.remove('is-dropping'); });
  editor.addEventListener('drop', function (event) {
    editor.classList.remove('is-dropping');
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    var range = rangeFromPoint(event.clientX, event.clientY);
    insertFiles(event.dataTransfer.files, range && editor.contains(range.startContainer) ? range : null);
  });
  picker.addEventListener('change', function () {
    insertFiles(picker.files, imageSelection);
    picker.value = '';
    imageSelection = null;
  });

  // ---------------------------------------------------- paste & import

  var SKIP_TAGS = /^(SCRIPT|STYLE|META|LINK|TITLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|CANVAS|VIDEO|AUDIO|BUTTON|INPUT|SELECT|TEXTAREA|FORM|HEAD)$/;
  var BLOCK_TAGS = /^(P|DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|NAV|H[1-6]|BLOCKQUOTE|PRE|UL|OL|LI|HR|FIGURE|TABLE|DL|DT|DD|CENTER|ADDRESS|DETAILS)$/;
  var BLOCK_SELECTOR = 'p,div,section,article,main,header,footer,aside,nav,h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol,li,hr,figure,table,dl,center,address,details';

  function safeUrl(value, image) {
    value = (value || '').trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (!image && /^mailto:/i.test(value)) return value;
    if (image && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)) return value;
    return '';
  }

  // Turn arbitrary HTML into the small set of blocks the exporter understands.
  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var out = document.createDocumentFragment();
    var paragraph = null;
    var pending = [];

    // Formulas from this editor, KaTeX (ChatGPT, Claude) or MathML with a TeX annotation (Wikipedia).
    function mathFrom(node) {
      if (node.hasAttribute('data-tex') && /\bblog-math\b/.test(node.className)) {
        return { tex: node.getAttribute('data-tex'), display: /blog-math--block/.test(node.className) };
      }
      var classes = node.classList;
      if (classes.contains('katex') || classes.contains('katex-display') || classes.contains('mwe-math-element') || node.localName === 'math') {
        var annotation = node.querySelector('annotation[encoding="application/x-tex"]');
        if (!annotation) return null;
        var display = classes.contains('katex-display') || Boolean(node.closest('.katex-display')) ||
          node.getAttribute('display') === 'block' || Boolean(node.querySelector('math[display="block"]'));
        var tex = annotation.textContent.trim().replace(/^\{\\displaystyle\s*([\s\S]*)\}$/, '$1').replace(/^\\displaystyle\s*/, '');
        return { tex: tex, display: display };
      }
      return null;
    }

    function skipped(node) {
      return SKIP_TAGS.test(node.tagName) || /^MJX-/.test(node.tagName) || node.hasAttribute('data-preview') ||
        /\b(katex-html|mwe-math-fallback)/.test(typeof node.className === 'string' ? node.className : '');
    }

    function figureFrom(image, caption) {
      var src = safeUrl(image.getAttribute('src'), true);
      return src ? makeFigure(src, (caption || image.getAttribute('title') || '').trim(), image.getAttribute('alt') || '') : null;
    }

    function trimBlock(block) {
      while (block.lastChild && block.lastChild.nodeType === 1 && block.lastChild.tagName === 'BR') block.removeChild(block.lastChild);
      var first = block.firstChild;
      var last = block.lastChild;
      if (first && first.nodeType === 3) first.data = first.data.replace(/^\s+/, '');
      if (last && last.nodeType === 3) last.data = last.data.replace(/\s+$/, '');
      return block;
    }

    function flushPending() {
      pending.forEach(function (figure) { out.appendChild(figure); });
      pending = [];
    }

    function endParagraph() {
      if (paragraph) {
        trimBlock(paragraph);
        if (!paragraph.textContent.trim()) out.removeChild(paragraph);
      }
      paragraph = null;
      flushPending();
    }

    function currentParagraph() {
      if (!paragraph) {
        paragraph = el('p');
        out.appendChild(paragraph);
      }
      return paragraph;
    }

    function appendInline(target, node) {
      if (node.nodeType === 3) {
        target.appendChild(document.createTextNode(node.data.replace(/[\s\u00a0]+/g, ' ')));
        return;
      }
      if (node.nodeType !== 1 || skipped(node)) return;
      var math = mathFrom(node);
      if (math) {
        if (math.display) pending.push(mathElement(math.tex, true));
        else target.appendChild(mathElement(math.tex, false));
        return;
      }
      var tag = node.tagName;
      var style = (node.getAttribute('style') || '').toLowerCase();
      var wrapper = null;
      if (tag === 'BR') { target.appendChild(el('br')); return; }
      if (tag === 'IMG') { var figure = figureFrom(node, ''); if (figure) pending.push(figure); return; }
      if (/^(CODE|KBD|SAMP|TT)$/.test(tag)) {
        if (node.textContent.trim()) {
          var code = el('code');
          code.textContent = node.textContent;
          target.appendChild(code);
        }
        return;
      }
      if (tag === 'A') {
        var href = safeUrl(node.getAttribute('href'), false);
        if (href) { wrapper = el('a'); wrapper.setAttribute('href', href); }
      } else if (tag === 'STRONG' || (tag === 'B' && !/font-weight\s*:\s*(normal|[1-4]00)/.test(style))) {
        wrapper = el('strong');
      } else if (/^(EM|I|CITE)$/.test(tag)) {
        wrapper = el('em');
      } else if (/^(S|DEL|STRIKE)$/.test(tag)) {
        wrapper = el('s');
      } else if (tag === 'MARK') {
        wrapper = el('mark');
      } else if (tag === 'SPAN') {
        if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) wrapper = el('strong');
        else if (/font-style\s*:\s*italic/.test(style)) wrapper = el('em');
      }
      var into = wrapper || target;
      Array.prototype.forEach.call(node.childNodes, function (child) { appendInline(into, child); });
      if (!wrapper) return;
      if (wrapper.textContent.trim()) target.appendChild(wrapper);
      else while (wrapper.firstChild) target.appendChild(wrapper.firstChild);
    }

    function inlineBlock(tag, source) {
      var block = el(tag);
      Array.prototype.forEach.call(source.childNodes, function (child) {
        if (child.nodeType === 1 && BLOCK_TAGS.test(child.tagName)) {
          if (block.textContent.trim()) block.appendChild(el('br'));
          inlineChildren(block, child);
        } else {
          appendInline(block, child);
        }
      });
      return trimBlock(block);
    }

    function inlineChildren(target, source) {
      Array.prototype.forEach.call(source.childNodes, function (child) {
        if (child.nodeType === 1 && BLOCK_TAGS.test(child.tagName)) {
          if (target.textContent.trim()) target.appendChild(el('br'));
          inlineChildren(target, child);
        } else {
          appendInline(target, child);
        }
      });
    }

    function listItem(source) {
      var item = el('li');
      var checkbox = source.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
      var task = source.getAttribute('data-task') || (checkbox ? (checkbox.hasAttribute('checked') ? 'done' : 'todo') : '');
      if (task === 'todo' || task === 'done') item.setAttribute('data-task', task);
      Array.prototype.forEach.call(source.childNodes, function (child) {
        if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
          var nested = list(child);
          if (nested.children.length) item.appendChild(nested);
        } else if (child.nodeType === 1 && BLOCK_TAGS.test(child.tagName)) {
          if (item.textContent.trim()) item.appendChild(el('br'));
          inlineChildren(item, child);
        } else {
          appendInline(item, child);
        }
      });
      return trimBlock(item);
    }

    function list(source) {
      var target = el(source.tagName.toLowerCase());
      Array.prototype.forEach.call(source.children, function (child) {
        if (child.tagName === 'LI') {
          target.appendChild(listItem(child));
        } else if ((child.tagName === 'UL' || child.tagName === 'OL') && target.lastElementChild) {
          target.lastElementChild.appendChild(list(child));
        }
      });
      return target;
    }

    function walk(parent) {
      Array.prototype.forEach.call(parent.childNodes, function (node) {
        if (node.nodeType === 3) {
          if (node.data.trim() || paragraph) appendInline(currentParagraph(), node);
          return;
        }
        if (node.nodeType !== 1 || skipped(node)) return;
        var tag = node.tagName;
        var math = mathFrom(node);
        if (math) {
          if (math.display) { endParagraph(); out.appendChild(mathElement(math.tex, true)); }
          else currentParagraph().appendChild(mathElement(math.tex, false));
          return;
        }
        if (tag === 'IMG') {
          var image = figureFrom(node, '');
          if (image) { endParagraph(); out.appendChild(image); }
          return;
        }
        if (!BLOCK_TAGS.test(tag)) {
          if (node.querySelector(BLOCK_SELECTOR)) walk(node);
          else appendInline(currentParagraph(), node);
          return;
        }
        endParagraph();
        var block = null;
        if (/^H[1-6]$/.test(tag)) {
          block = inlineBlock(tag === 'H1' || tag === 'H2' ? 'h2' : 'h3', node);
        } else if (tag === 'PRE') {
          block = el('pre');
          block.textContent = node.textContent.replace(/\n+$/, '');
          var languageSource = [node.getAttribute('data-lang') || '', node.className, node.parentNode && node.parentNode.className,
            (node.querySelector('code') || node).className].join(' ');
          var language = (node.getAttribute('data-lang') || (languageSource.match(/(?:language|lang|highlight-source)-([\w+#.-]+)/) || [])[1] || '').toLowerCase();
          if (language && language !== 'plaintext') block.setAttribute('data-lang', language);
        } else if (tag === 'BLOCKQUOTE') {
          block = inlineBlock('blockquote', node);
        } else if (tag === 'UL' || tag === 'OL') {
          block = list(node);
          if (!block.children.length) block = null;
        } else if (tag === 'LI') {
          block = el('ul');
          block.appendChild(listItem(node));
        } else if (tag === 'HR') {
          out.appendChild(el('hr'));
        } else if (tag === 'FIGURE') {
          var figureImage = node.querySelector('img');
          var caption = node.querySelector('figcaption');
          block = figureImage ? figureFrom(figureImage, caption ? caption.textContent : '') : null;
          if (!block) walk(node);
        } else if (tag === 'TABLE') {
          block = tableFrom(node);
        } else if (node.querySelector(BLOCK_SELECTOR)) {
          walk(node);
        } else {
          block = inlineBlock('p', node);
        }
        if (block && (hasContent(block) || block.tagName === 'FIGURE')) out.appendChild(block);
        flushPending();
      });
    }

    function tableFrom(source) {
      var rows = Array.prototype.filter.call(source.querySelectorAll('tr'), function (row) { return row.closest('table') === source; });
      var width = rows.reduce(function (max, row) { return Math.max(max, row.cells.length); }, 0);
      if (!rows.length || !width) return null;
      var table = makeTable(rows.length, width);
      rows.forEach(function (row, rowIndex) {
        for (var c = 0; c < width; c += 1) {
          var cell = table.rows[rowIndex].cells[c];
          var original = row.cells[c];
          cell.replaceChildren();
          if (original) {
            inlineChildren(cell, original);
            trimBlock(cell);
            var align = original.getAttribute('align') || ((original.getAttribute('style') || '').match(/text-align:\s*(left|center|right)/) || [])[1];
            if (align) cell.setAttribute('align', align);
          }
          if (!cell.firstChild) cell.appendChild(el('br'));
        }
      });
      return table;
    }

    walk(doc.body);
    endParagraph();
    return out;
  }

  // Inline math in pasted Markdown: $$x$$, \(x\), and Typora/Pandoc-style $x$.
  var INLINE_MATH = /\$\$([^$]+?)\$\$|\\\((.+?)\\\)|(^|[^\\$\w])\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?!\d)/g;

  function inlineMarkdown(text) {
    return text.split(/(`+[^`]+?`+)/).map(function (part, index) {
      if (index % 2) return '<code>' + escapeHtml(part.replace(/^`+\s?|\s?`+$/g, '')) + '</code>';
      var held = [];
      function hold(html) {
        held.push(html);
        return '\u0000' + (held.length - 1) + '\u0000';
      }
      part = part
        .replace(INLINE_MATH, function (_, double, paren, lead, single) {
          return (lead || '') + hold(mathElement(double || paren || single, false).outerHTML);
        })
        .replace(/\\([\\`*_{}\[\]()#+\-.!>~|$=])/g, function (_, character) { return hold(escapeHtml(character)); });
      return escapeHtml(part)
        .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '$1')
        .replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<a href="$2">$1</a>')
        .replace(/&lt;((?:https?:|mailto:)[^&\s]+)&gt;/g, '<a href="$1">$1</a>')
        .replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, function (_, a, b) { return '<strong>' + (a || b) + '</strong>'; })
        .replace(/(^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>')
        .replace(/==([^=\s](?:[^=]*?[^=\s])?)==/g, '<mark>$1</mark>')
        .replace(/\u0000(\d+)\u0000/g, function (_, at) { return held[Number(at)]; });
    }).join('');
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(function (cell) {
      return cell.trim().replace(/\\\|/g, '|');
    });
  }

  function markdownToHtml(markdown) {
    var lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var paragraph = [];
    var match;
    function flush() {
      if (paragraph.length) html.push('<p>' + paragraph.map(function (line) {
        return /\s{2,}$|\\$/.test(line) ? inlineMarkdown(line.replace(/\s+$|\\$/, '')) + '<br>' : inlineMarkdown(line.trim()) + '\n';
      }).join('').replace(/\n$/, '') + '</p>');
      paragraph = [];
    }
    function displayMath(tex) {
      html.push(mathElement(tex.trim(), true).outerHTML);
    }
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var trimmed = line.trim();
      if ((match = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/))) {
        flush();
        var fence = match[1];
        var language = match[2].toLowerCase();
        var code = [];
        for (i += 1; i < lines.length && lines[i].trim().indexOf(fence) !== 0; i += 1) code.push(lines[i]);
        if (language === 'math') displayMath(code.join('\n'));
        else html.push('<pre' + (language ? ' data-lang="' + escapeHtml(language) + '"' : '') + '>' + escapeHtml(code.join('\n')) + '</pre>');
      } else if (!trimmed) {
        flush();
      } else if (/^<!--\s*BLOG_IMAGE_\d+/.test(trimmed)) {
        flush();
      } else if ((match = trimmed.match(/^\$\$([^$]+)\$\$$/)) || (match = trimmed.match(/^\\\[(.+)\\\]$/))) {
        flush();
        displayMath(match[1]);
      } else if (/^(\$\$|\\\[)/.test(trimmed)) {
        flush();
        var closing = trimmed.indexOf('$$') === 0 ? /\$\$\s*$/ : /\\\]\s*$/;
        var tex = [trimmed.slice(2)];
        for (i += 1; i < lines.length && !closing.test(lines[i]); i += 1) tex.push(lines[i]);
        if (i < lines.length) tex.push(lines[i].replace(closing, ''));
        displayMath(tex.join('\n'));
      } else if ((match = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        flush();
        var level = match[1].length <= 2 ? 'h2' : 'h3';
        html.push('<' + level + '>' + inlineMarkdown(match[2]) + '</' + level + '>');
      } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush();
        html.push('<hr>');
      } else if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
        flush();
        var aligns = splitRow(lines[i + 1]).map(function (cell) {
          return /^:-+:$/.test(cell) ? 'center' : /^:/.test(cell) ? 'left' : /:$/.test(cell) ? 'right' : '';
        });
        var rows = [splitRow(line)];
        for (i += 2; i < lines.length && /\|/.test(lines[i]) && lines[i].trim(); i += 1) rows.push(splitRow(lines[i]));
        i -= 1;
        var width = rows[0].length;
        html.push('<table>' + rows.map(function (cells, rowIndex) {
          var tag = rowIndex ? 'td' : 'th';
          var row = '';
          for (var c = 0; c < width; c += 1) {
            row += '<' + tag + (aligns[c] ? ' align="' + aligns[c] + '"' : '') + '>' + inlineMarkdown(cells[c] || '') + '</' + tag + '>';
          }
          return (rowIndex ? '' : '<thead>') + '<tr>' + row + '</tr>' + (rowIndex ? '' : '</thead><tbody>');
        }).join('') + '</tbody></table>');
      } else if (/^\s{0,3}>/.test(line)) {
        flush();
        var quote = [];
        for (; i < lines.length && /^\s{0,3}>/.test(lines[i]); i += 1) quote.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i -= 1;
        html.push('<blockquote>' + quote.map(function (q) { return q.trim() ? inlineMarkdown(q) : ''; }).join('<br>').replace(/^(<br>)+|(<br>)+$/g, '') + '</blockquote>');
      } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        var stack = [];
        var openItem = false;
        for (; i < lines.length; i += 1) {
          var item = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (!item) {
            if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && openItem) { html.push(' ' + inlineMarkdown(lines[i].trim())); continue; }
            break;
          }
          var depth = Math.floor(item[1].replace(/\t/g, '    ').length / 2);
          var tag = /\d/.test(item[2]) ? 'ol' : 'ul';
          if (!stack.length || depth > stack[stack.length - 1].depth) {
            html.push('<' + tag + '>');
            stack.push({ tag: tag, depth: depth });
          } else {
            while (stack.length > 1 && depth < stack[stack.length - 1].depth) {
              html.push('</li></' + stack.pop().tag + '>');
            }
            html.push('</li>');
          }
          var task = item[3].match(/^\[([ xX])\]\s+(.*)$/);
          html.push(task
            ? '<li data-task="' + (task[1] === ' ' ? 'todo' : 'done') + '">' + inlineMarkdown(task[2])
            : '<li>' + inlineMarkdown(item[3]));
          openItem = true;
        }
        while (stack.length) html.push('</li></' + stack.pop().tag + '>');
        i -= 1;
      } else if ((match = trimmed.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/))) {
        flush();
        html.push('<figure><img src="' + escapeHtml(match[2]) + '" alt="' + escapeHtml(match[1]) + '"><figcaption>' + escapeHtml((match[3] || '').replace(/&quot;/g, '"')) + '</figcaption></figure>');
      } else if (/^<img\s[^>]*>$/i.test(trimmed)) {
        flush();
        html.push(trimmed);
      } else {
        paragraph.push(line);
      }
    }
    flush();
    return html.join('');
  }

  function parseFrontMatter(text) {
    var match = text.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return null;
    var fields = {};
    match[1].split('\n').forEach(function (line) {
      var pair = line.match(/^(\w+):\s*(.*)$/);
      if (!pair) return;
      var value = pair[2].trim();
      try { if (/^["[]/.test(value)) value = JSON.parse(value); } catch (_) { /* keep raw */ }
      fields[pair[1]] = value;
    });
    return { fields: fields, body: text.slice(match[0].length) };
  }

  function looksLikeMarkdown(text) {
    return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s+\S|\d+[.)]\s+\S|>|```|~~~|!\[[^\]]*\]\(|\$\$|\\\[|\|.*\|)/.test(text) ||
      /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\((https?:|mailto:)[^)\s]+\)|`[^`\n]+`|==[^=\s][^=\n]*==|\\\(.+?\\\)|(^|[^\\$\w])\$[^\s$][^$\n]*[^\s$\\]?\$(?!\d)/.test(text);
  }

  function insertFragment(fragment) {
    var blocks = Array.prototype.filter.call(fragment.childNodes, function (node) { return node.nodeType === 1; });
    var holder = el('div');
    if (blocks.length === 1 && blocks[0].tagName === 'P') holder.innerHTML = blocks[0].innerHTML;
    else holder.appendChild(fragment);
    exec('insertHTML', insertableHtml(holder));
    withCaret(function () { tidy(true); });
  }

  editor.addEventListener('paste', function (event) {
    var data = event.clipboardData;
    if (!data) return;
    var files = Array.prototype.filter.call(data.files || [], function (file) { return file.type.indexOf('image/') === 0; });
    if (files.length) {
      event.preventDefault();
      insertFiles(files);
      return;
    }
    event.preventDefault();
    var text = data.getData('text/plain');
    var html = data.getData('text/html');
    var anchor = window.getSelection().anchorNode;
    var plainHost = closestInEditor(anchor, 'FIGCAPTION') || closestInEditor(anchor, 'PRE') || closestInEditor(anchor, 'CODE');
    if (plainHost) {
      exec('insertText', plainHost.tagName === 'FIGCAPTION' ? text.replace(/\s+/g, ' ') : text);
      return;
    }
    var selection = selectionInBody();
    if (selection && !selection.isCollapsed && /^(https?:\/\/|mailto:)\S+$/.test(text.trim())) {
      exec('createLink', text.trim());
      scheduleSave();
      return;
    }
    var front = parseFrontMatter(text.replace(/\r\n?/g, '\n'));
    if (front) {
      if (!title.value.trim() && front.fields.title) title.value = String(front.fields.title);
      if (!summary.value.trim() && front.fields.excerpt) summary.value = String(front.fields.excerpt);
      if (!tags.value.trim() && front.fields.tags) tags.value = [].concat(front.fields.tags).join(', ');
      autosize(title);
      autosize(summary);
      text = front.body;
      html = '';
    }
    var richHtml = html && /<(a|h[1-6]|li|strong|b|em|blockquote|img|table|p)\b/i.test(html);
    var strongMarkdown = /(^|\n)\s{0,3}(#{1,6}\s|```|\$\$)|\*\*[^*\n]+\*\*|\]\((https?:|mailto:)/.test(text);
    var fragment = null;
    if (looksLikeMarkdown(text) && (!richHtml || strongMarkdown)) fragment = sanitizeHtml(markdownToHtml(text));
    else if (html) fragment = sanitizeHtml(html);
    if (fragment && fragment.childNodes.length) insertFragment(fragment);
    else exec('insertText', text);
    hydrateMath();
    scheduleSave();
  });

  // ------------------------------------------------------------- export

  // Footnote references [^1] and callout markers [!NOTE] stay unescaped so Markdown sees them.
  function escapeText(value) {
    return value.split(/(\[\^[^\]\s]+\]|\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])/i).map(function (part, index) {
      if (index % 2) return part;
      return part
        .replace(/\u200b/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/([\\`*_[\]$])/g, '\\$1')
        .replace(/<(?=[A-Za-z\/!?])/g, '&lt;');
    }).join('');
  }

  function escapeLineStarts(text) {
    return text.split('\n').map(function (line) {
      return line
        .replace(/^(\s*)([#>]|[-+](?=\s|$)|([-=])\3{2,}\s*$)/, '$1\\$2')
        .replace(/^(\s*\d+)([.)])(?=\s|$)/, '$1\\$2');
    }).join('\n');
  }

  function wrapMarks(content, mark) {
    var parts = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return parts[2] ? parts[1] + mark + parts[2] + mark + parts[3] : content;
  }

  function imageMarkdown(image, caption, context) {
    var src = image.getAttribute('src') || '';
    caption = (caption || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    var titlePart = caption ? ' "' + caption.replace(/"/g, '&quot;') + '"' : '';
    if (/^data:image\//i.test(src)) {
      if (context.embed) return '![' + escapeText(caption) + '](' + src + titlePart + ')';
      context.images.push({ src: src, caption: caption });
      return '<!-- BLOG_IMAGE_' + context.images.length + (caption ? ' | ' + caption.replace(/-{2,}/g, '—') : '') + ' -->';
    }
    if (!/^https?:\/\//i.test(src)) return '';
    return '![' + escapeText(caption || image.getAttribute('alt') || '') + '](' + src + titlePart + ')';
  }

  function inlineChildrenMarkdown(node, context) {
    return Array.prototype.map.call(node.childNodes, function (child) { return inlineMarkdownFrom(child, context); }).join('');
  }

  function texOf(node) {
    return (node.getAttribute('data-tex') || '').trim();
  }

  function inlineMarkdownFrom(node, context) {
    if (node.nodeType === 3) return escapeText(node.data);
    if (node.nodeType !== 1 || isPreview(node)) return '';
    if (isMath(node)) {
      if (!texOf(node)) return '';
      return isBlockMath(node) ? '$$' + texOf(node).replace(/\s*\n\s*/g, ' ') + '$$' : '$' + texOf(node).replace(/\s*\n\s*/g, ' ') + '$';
    }
    var tag = node.tagName;
    if (tag === 'BR') return '  \n';
    if (tag === 'IMG') return imageMarkdown(node, node.getAttribute('title'), context);
    if (tag === 'CODE') {
      var code = node.textContent.replace(/\u200b/g, '');
      if (!code) return '';
      return code.indexOf('`') === -1 ? '`' + code + '`' : '`` ' + code + ' ``';
    }
    var content = inlineChildrenMarkdown(node, context);
    if (tag === 'STRONG' || tag === 'B') return wrapMarks(content, '**');
    if (tag === 'EM' || tag === 'I') return wrapMarks(content, '*');
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') return wrapMarks(content, '~~');
    if (tag === 'MARK') return wrapMarks(content, '==');
    if (tag === 'A') {
      var href = node.getAttribute('href') || '';
      if (!/^(https?:|mailto:)/i.test(href) || !content.trim()) return content;
      return '[' + content + '](' + href.replace(/[()\s]/g, encodeURIComponent) + ')';
    }
    return content;
  }

  function listMarkdown(list, context) {
    var ordered = list.tagName === 'OL';
    var index = 0;
    return Array.prototype.map.call(list.children, function (item) {
      if (item.tagName !== 'LI') return '';
      index += 1;
      var marker = ordered ? index + '. ' : '- ';
      var pad = new Array(marker.length + 1).join(' ');
      var nested = [];
      var text = Array.prototype.map.call(item.childNodes, function (child) {
        if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
          nested.push(listMarkdown(child, context));
          return '';
        }
        if (child.nodeType === 1 && /^(P|DIV)$/.test(child.tagName)) return inlineChildrenMarkdown(child, context) + '  \n';
        return inlineMarkdownFrom(child, context);
      }).join('').trim();
      var task = item.getAttribute('data-task');
      var output = marker + (task ? (task === 'done' ? '[x] ' : '[ ] ') : '') + escapeLineStarts(text).replace(/\n/g, '\n' + pad);
      nested.forEach(function (block) {
        output += '\n' + block.split('\n').map(function (line) { return line ? pad + line : line; }).join('\n');
      });
      return output;
    }).filter(Boolean).join('\n');
  }

  function tableMarkdown(table, context) {
    var rows = Array.prototype.slice.call(table.rows);
    var width = rows.reduce(function (max, row) { return Math.max(max, row.cells.length); }, 0);
    if (!width) return '';
    function cell(item) {
      if (!item) return '';
      return inlineChildrenMarkdown(item, context).replace(/^(?: {2}\n)+|(?: {2}\n)+$/g, '').replace(/ {2}\n/g, '<br>')
        .replace(/\s*\n\s*/g, ' ').trim().replace(/\|/g, '\\|');
    }
    function line(row) {
      var cells = [];
      for (var c = 0; c < width; c += 1) cells.push(cell(row.cells[c]));
      return '| ' + cells.join(' | ') + ' |';
    }
    var aligns = [];
    for (var c = 0; c < width; c += 1) {
      var align = rows[0].cells[c] ? rows[0].cells[c].getAttribute('align') : '';
      aligns.push(align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---');
    }
    return [line(rows[0]), '| ' + aligns.join(' | ') + ' |'].concat(rows.slice(1).map(line)).join('\n');
  }

  function blockMarkdown(node, context) {
    if (node.nodeType === 3) return escapeLineStarts(escapeText(node.data).trim());
    if (node.nodeType !== 1 || isPreview(node)) return '';
    if (isBlockMath(node)) return texOf(node) ? '$$\n' + texOf(node) + '\n$$' : '';
    var tag = node.tagName;
    if (tag === 'TABLE') return tableMarkdown(node, context);
    if (/^H[1-6]$/.test(tag)) {
      var heading = inlineChildrenMarkdown(node, context).replace(/\s*\n\s*/g, ' ').trim();
      return heading ? (tag === 'H1' || tag === 'H2' ? '## ' : '### ') + heading : '';
    }
    if (tag === 'UL' || tag === 'OL') return listMarkdown(node, context);
    if (tag === 'BLOCKQUOTE') {
      var hasBlocks = Array.prototype.some.call(node.children, function (child) { return /^(P|DIV)$/.test(child.tagName); });
      var quote = hasBlocks
        ? Array.prototype.map.call(node.childNodes, function (child) { return blockMarkdown(child, context); }).filter(Boolean).join('\n\n')
        : escapeLineStarts(inlineChildrenMarkdown(node, context).trim());
      return quote ? quote.split('\n').map(function (line) { return line ? '> ' + line : '>'; }).join('\n') : '';
    }
    if (tag === 'PRE') {
      var code = (node.innerText || node.textContent).replace(/\u200b/g, '').replace(/\n+$/, '');
      if (!code.trim()) return '';
      var fence = code.indexOf('```') === -1 ? '```' : '~~~';
      return fence + (node.getAttribute('data-lang') || '') + '\n' + code + '\n' + fence;
    }
    if (tag === 'HR') return '---';
    if (tag === 'FIGURE') {
      var image = node.querySelector('img');
      var caption = node.querySelector('figcaption');
      return image ? imageMarkdown(image, caption ? caption.textContent : '', context) : '';
    }
    return escapeLineStarts(inlineChildrenMarkdown(node, context).trim());
  }

  function exportArticle(embedImages) {
    var context = { images: [], embed: Boolean(embedImages) };
    var markdown = Array.prototype.map.call(editor.childNodes, function (node) { return blockMarkdown(node, context); })
      .filter(function (part) { return part && part.trim(); })
      .join('\n\n')
      .trim();
    return { markdown: markdown, images: context.images };
  }

  // ------------------------------------------------------------ refresh

  function bodyText() {
    var parts = [];
    var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.parentNode.closest('figcaption, [data-tex], [data-preview]')) parts.push(walker.currentNode.data);
    }
    return parts.join(' ').replace(/\u200b/g, '');
  }

  function countWords(text) {
    var cjk = (text.match(CJK) || []).length;
    var latin = (text.replace(CJK, ' ').match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g) || []).length;
    return { words: cjk + latin, minutes: Math.max(1, Math.round(cjk / 400 + latin / 220)) };
  }

  function updateOutline() {
    outline.replaceChildren();
    var headings = Array.prototype.filter.call(editor.querySelectorAll('h2, h3'), function (heading) {
      return heading.textContent.trim();
    });
    if (!headings.length) {
      var empty = el('li');
      empty.className = 'blog-editor__outline-empty';
      empty.textContent = '添加小标题后显示';
      outline.appendChild(empty);
      return;
    }
    headings.forEach(function (heading) {
      var item = el('li');
      if (heading.tagName === 'H3') item.className = 'is-subheading';
      var link = el('a');
      link.href = '#editor-body';
      link.textContent = heading.textContent.trim();
      link.addEventListener('click', function (event) {
        event.preventDefault();
        heading.scrollIntoView({ behavior: 'smooth', block: 'center' });
        caretInto(heading, true);
      });
      item.appendChild(link);
      outline.appendChild(item);
    });
  }

  function setCheck(name, state, value) {
    var item = checklist.querySelector('[data-check="' + name + '"]');
    item.setAttribute('data-state', state);
    item.querySelector('em').textContent = value;
  }

  function refresh() {
    var text = bodyText();
    var stats = countWords(text);
    var local = editor.querySelectorAll('img[data-local-image]').length;
    var images = editor.querySelectorAll('img').length;
    var tagValues = tagList();
    editor.classList.toggle('is-empty', !hasContent(editor));
    editor.querySelectorAll('blockquote').forEach(function (quote) {
      var callout = quote.textContent.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (callout) quote.setAttribute('data-callout', callout[1].toLowerCase());
      else quote.removeAttribute('data-callout');
    });
    updateOutline();
    syncDiagrams();
    updateBlockTools();
    $('stat-words').textContent = stats.words.toLocaleString('zh-CN');
    $('stat-minutes').textContent = stats.words ? stats.minutes + ' 分钟' : '—';
    $('stat-images').textContent = images;
    setCheck('title', title.value.trim() ? 'done' : 'todo', title.value.trim() ? '已填写' : '必填');
    setCheck('body', stats.words ? 'done' : 'todo', stats.words ? stats.words.toLocaleString('zh-CN') + ' 字' : '必填');
    setCheck('summary', summary.value.trim() ? 'done' : 'optional', summary.value.trim() ? '已填写' : '可选');
    setCheck('tags', tagValues.length ? 'done' : 'optional', tagValues.length ? tagValues.join(' · ') : '可选');
    setCheck('images', local ? 'info' : (images ? 'done' : 'optional'), local ? local + ' 张需上传' : (images ? images + ' 张' : '无'));
  }

  // ------------------------------------------------------------ toolbar

  var toolbarFrame = 0;
  function updateToolbarState() {
    toolbarFrame = 0;
    var selection = selectionInBody();
    var block = selection ? topBlock(selection.anchorNode) : null;
    var blockTag = block && block.nodeType === 1 ? block.tagName.toLowerCase() : 'p';
    toolbarButtons.forEach(function (button) {
      var pressed = false;
      if (selection) {
        if (button.hasAttribute('data-block')) pressed = button.getAttribute('data-block') === blockTag;
        else if (button.hasAttribute('data-command')) {
          try { pressed = document.queryCommandState(button.getAttribute('data-command')); } catch (_) { pressed = false; }
        } else if (button.getAttribute('data-action') === 'code') pressed = Boolean(closestInEditor(selection.anchorNode, 'CODE')) && blockTag !== 'pre';
        else if (button.getAttribute('data-action') === 'link') pressed = Boolean(closestInEditor(selection.anchorNode, 'A'));
        else if (button.getAttribute('data-action') === 'mark') pressed = Boolean(closestInEditor(selection.anchorNode, 'MARK'));
        else if (button.getAttribute('data-action') === 'task') pressed = Boolean(currentItem() && currentItem().hasAttribute('data-task'));
        else if (button.getAttribute('data-action') === 'table') pressed = blockTag === 'table';
      }
      if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(pressed));
    });
  }
  document.addEventListener('selectionchange', function () {
    if (!toolbarFrame) toolbarFrame = window.requestAnimationFrame(updateToolbarState);
  });

  function focusBody() {
    if (selectionInBody()) return;
    var last = editor.lastElementChild;
    if (!last) ensureStarted();
    else caretInto(last, true);
  }

  function applyBlock(tag) {
    focusBody();
    var selection = selectionInBody();
    var block = selection && topBlock(selection.anchorNode);
    var current = block && block.nodeType === 1 ? block.tagName.toLowerCase() : '';
    if (current === 'ul' || current === 'ol') {
      listCommand(current === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
      current = '';
      if (tag === 'p') { scheduleSave(); return; }
    }
    exec('formatBlock', current === tag && tag !== 'p' ? 'p' : tag);
    var updated = selectionInBody() && topBlock(window.getSelection().anchorNode);
    if (updated && updated.nodeType === 1 && /^(PRE|BLOCKQUOTE)$/.test(updated.tagName)) paragraphAfter(updated);
    scheduleSave();
  }

  function insertRule() {
    focusBody();
    var block = topBlock(window.getSelection().anchorNode);
    var rule = el('hr');
    var after;
    if (block && block.nodeType === 1 && block.tagName === 'P' && !hasContent(block)) {
      editor.replaceChild(rule, block);
      after = paragraphAfter(rule);
    } else {
      after = placeBlock(rule, selectionRange());
    }
    caretInto(after, false);
    scheduleSave();
  }

  function toggleCode() {
    focusBody();
    var selection = window.getSelection();
    var code = closestInEditor(selection.anchorNode, 'CODE');
    if (code && !closestInEditor(code, 'PRE')) {
      var range = document.createRange();
      range.selectNode(code);
      selectRange(range);
      exec('insertText', code.textContent.replace(/\u200b/g, ''));
      withCaret(function () { tidy(true); });
      return;
    }
    var text = selection.toString();
    if (!text.trim()) { setStatus('先选中要标为代码的文字，或输入 `代码`', 'idle'); return; }
    exec('insertHTML', '<code>' + escapeHtml(text) + '</code>\u200b');
    withCaret(function () { tidy(true); });
  }

  toolbarButtons.forEach(function (button) {
    button.addEventListener('mousedown', function (event) { event.preventDefault(); });
    button.addEventListener('click', function () {
      var action = button.getAttribute('data-action');
      if (action === 'image') { imageSelection = selectionRange(); picker.click(); return; }
      if (action === 'link') { openLinkForm(); return; }
      if (action === 'code') { toggleCode(); scheduleSave(); return; }
      if (action === 'rule') { insertRule(); return; }
      if (action === 'mark') { toggleMark(); return; }
      if (action === 'task') { toggleTaskList(); return; }
      if (action === 'table') { insertTable(); return; }
      if (action === 'math') { insertMath(); return; }
      if (button.hasAttribute('data-block')) { applyBlock(button.getAttribute('data-block')); return; }
      focusBody();
      var command = button.getAttribute('data-command');
      if (/List$/.test(command)) listCommand(command);
      else exec(command);
      scheduleSave();
    });
  });

  document.querySelectorAll('[data-mod]').forEach(function (key) { key.textContent = isMac ? '⌘' : 'Ctrl'; });
  document.querySelectorAll('[data-shift]').forEach(function (key) { key.textContent = isMac ? '⇧' : 'Shift'; });
  document.querySelectorAll('[data-alt]').forEach(function (key) { key.textContent = isMac ? '⌥' : 'Alt'; });
  toolbarButtons.forEach(function (button) {
    var shortcut = button.getAttribute('data-shortcut');
    if (shortcut) button.title += ' (' + (isMac ? '⌘' : 'Ctrl+') + (isMac ? shortcut : shortcut.replace('⇧', 'Shift+')) + ')';
  });

  // --------------------------------------------------------------- links

  function openLinkForm() {
    focusBody();
    linkRange = selectionRange();
    var anchor = closestInEditor(linkRange.startContainer, 'A') || closestInEditor(linkRange.endContainer, 'A');
    linkInput.value = anchor ? anchor.getAttribute('href') : '';
    linkRemove.hidden = !anchor;
    linkError.textContent = '';
    linkForm.hidden = false;
    linkInput.focus();
    linkInput.select();
  }

  function closeLinkForm(restore) {
    linkForm.hidden = true;
    if (restore && linkRange) { editor.focus({ preventScroll: true }); selectRange(linkRange); }
  }

  linkForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var raw = linkInput.value.trim();
    if (!raw) { closeLinkForm(true); return; }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = (/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(raw) ? 'mailto:' : 'https://') + raw;
    var url;
    try { url = new URL(raw); } catch (_) { url = null; }
    if (!url || !/^(https?|mailto):$/.test(url.protocol)) { linkError.textContent = '请输入 http(s) 链接或邮箱'; return; }
    closeLinkForm(true);
    var anchor = closestInEditor(linkRange.startContainer, 'A');
    if (anchor) anchor.setAttribute('href', url.href);
    else if (linkRange.collapsed) exec('insertHTML', '<a href="' + escapeHtml(url.href) + '">' + escapeHtml(raw.replace(/^mailto:/, '')) + '</a>\u200b');
    else exec('createLink', url.href);
    scheduleSave();
  });
  linkRemove.addEventListener('click', function () {
    var anchor = closestInEditor(linkRange.startContainer, 'A') || closestInEditor(linkRange.endContainer, 'A');
    closeLinkForm(true);
    if (!anchor) return;
    var range = document.createRange();
    range.selectNodeContents(anchor);
    selectRange(range);
    exec('unlink');
    scheduleSave();
  });
  $('link-cancel').addEventListener('click', function () { closeLinkForm(true); });
  linkInput.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); closeLinkForm(true); }
  });

  // ------------------------------------------------- typing shortcuts

  var SPACE_RULES = [
    [/^#{1,2}$/, function () { exec('formatBlock', 'h2'); }],
    [/^#{3,6}$/, function () { exec('formatBlock', 'h3'); }],
    [/^[-*+]$/, function () { listCommand('insertUnorderedList'); }],
    [/^\d+[.)]$/, function () { listCommand('insertOrderedList'); }],
    [/^>$/, function () { exec('formatBlock', 'blockquote'); }]
  ];

  function caretPrefix() {
    var selection = selectionInBody();
    if (!selection || !selection.isCollapsed) return null;
    var block = topBlock(selection.anchorNode);
    if (!block || (block.nodeType === 1 && block.tagName !== 'P')) return null;
    var range = document.createRange();
    range.selectNodeContents(block);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    var rest = document.createRange();
    rest.selectNodeContents(block);
    rest.setStart(selection.anchorNode, selection.anchorOffset);
    return { block: block, range: range, text: range.toString(), atEnd: !rest.toString().replace(/\u200b/g, '') };
  }

  function blockShortcut() {
    var prefix = caretPrefix();
    if (!prefix) return false;
    for (var i = 0; i < SPACE_RULES.length; i += 1) {
      if (SPACE_RULES[i][0].test(prefix.text)) {
        selectRange(prefix.range);
        exec('delete');
        SPACE_RULES[i][1]();
        var block = topBlock(window.getSelection().anchorNode);
        if (block && block.nodeType === 1 && block.tagName === 'BLOCKQUOTE') paragraphAfter(block);
        return true;
      }
    }
    return false;
  }

  // "[ ]" or "[x]" then space at the start of a list item (or paragraph) makes a task.
  function taskShortcut() {
    var selection = selectionInBody();
    if (!selection || !selection.isCollapsed) return false;
    var item = closestInEditor(selection.anchorNode, 'LI');
    var prefix = item ? null : caretPrefix();
    var host = item || (prefix && prefix.block);
    if (!host) return false;
    var range = document.createRange();
    range.selectNodeContents(host);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    var match = range.toString().match(/^\[( |x|X)?\]$/);
    if (!match) return false;
    selectRange(range);
    exec('delete');
    if (!item) {
      listCommand('insertUnorderedList');
      item = currentItem();
    }
    if (item) item.setAttribute('data-task', match[1] && match[1] !== ' ' ? 'done' : 'todo');
    return true;
  }

  function enterShortcut() {
    var selection = selectionInBody();
    if (!selection) return false;
    var pre = closestInEditor(selection.anchorNode, 'PRE');
    if (pre) return preEnter(pre);
    var quote = closestInEditor(selection.anchorNode, 'BLOCKQUOTE');
    if (quote && selection.isCollapsed) return quoteEnter(quote);
    var prefix = caretPrefix();
    if (!prefix || !prefix.atEnd) return false;
    var text = prefix.text.replace(/\u200b/g, '').trim();
    var fence = text.match(/^(?:```|~~~)\s*([\w+#.-]*)$/);
    if (fence || text === '$$' || /^\|.*\|$/.test(text)) {
      selectRange(prefix.range);
      exec('delete');
    }
    if (text === '$$' || (fence && fence[1].toLowerCase() === 'math')) {
      insertMath();
      return true;
    }
    if (fence) {
      exec('formatBlock', 'pre');
      var block = topBlock(window.getSelection().anchorNode);
      if (block) {
        if (fence[1]) block.setAttribute('data-lang', fence[1].toLowerCase());
        paragraphAfter(block);
      }
      return true;
    }
    if (/^\|.*\|$/.test(text)) {
      insertTable(splitRow(text));
      return true;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
      selectRange(prefix.range);
      exec('delete');
      insertRule();
      return true;
    }
    return false;
  }

  function textAround(container) {
    var selection = window.getSelection();
    var before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(selection.anchorNode, selection.anchorOffset);
    var after = document.createRange();
    after.selectNodeContents(container);
    after.setStart(selection.focusNode, selection.focusOffset);
    return { before: before.toString().replace(/\u200b/g, ''), after: after.toString().replace(/[\u200b\n]/g, '') };
  }

  function caretAfterBreak() {
    var selection = window.getSelection();
    var node = selection.anchorNode;
    var previous;
    if (node.nodeType === 3) {
      if (node.data.slice(0, selection.anchorOffset).replace(/\u200b/g, '')) return false;
      previous = node.previousSibling;
    } else {
      previous = node.childNodes[selection.anchorOffset - 1];
    }
    while (previous && previous.nodeType === 3 && !previous.data.replace(/\u200b/g, '')) previous = previous.previousSibling;
    return Boolean(previous && previous.nodeType === 1 && previous.tagName === 'BR');
  }

  // Enter adds a line inside a code block; Enter on an empty last line leaves it.
  function preEnter(pre) {
    var text = textAround(pre);
    if (!text.after.trim() && pre.textContent.trim() && (/\n$/.test(text.before) || caretAfterBreak())) {
      window.getSelection().modify('extend', 'backward', 'character');
      exec('delete');
      caretInto(paragraphAfter(pre), false);
      return true;
    }
    exec('insertLineBreak');
    return true;
  }

  // Enter on an empty line inside a quote leaves the quote.
  function quoteEnter(quote) {
    var text = textAround(quote);
    if (text.after.trim() || !(caretAfterBreak() || !text.before.trim())) {
      exec('insertLineBreak');
      return true;
    }
    while (quote.lastChild && (quote.lastChild.nodeName === 'BR' || (quote.lastChild.nodeType === 3 && !quote.lastChild.data.trim()))) {
      quote.removeChild(quote.lastChild);
    }
    var next = paragraphAfter(quote);
    if (!quote.textContent.trim()) editor.removeChild(quote);
    caretInto(next, false);
    return true;
  }

  // Closing a Markdown span while typing turns it into formatting: `code`, **bold**, ==mark==, ~~strike~~, $math$.
  function inlineShortcut(data) {
    var selection = selectionInBody();
    if (!selection || !selection.isCollapsed) return;
    var node = selection.anchorNode;
    if (!node || node.nodeType !== 3 || closestInEditor(node, 'CODE') || closestInEditor(node, 'PRE')) return;
    var before = node.data.slice(0, selection.anchorOffset);
    var match = null;
    var length = 0;
    var html = '';
    if (data === '`' && (match = before.match(/`([^`\n]+)`$/))) {
      html = '<code>' + escapeHtml(match[1]) + '</code>';
    } else if (data === '*' && (match = before.match(/\*\*([^*\n]+)\*\*$/))) {
      html = '<strong>' + escapeHtml(match[1]) + '</strong>';
    } else if (data === '=' && (match = before.match(/==([^=\s](?:[^=\n]*?[^=\s])?)==$/))) {
      html = '<mark>' + escapeHtml(match[1]) + '</mark>';
    } else if (data === '~' && (match = before.match(/~~([^~\s](?:[^~\n]*?[^~\s])?)~~$/))) {
      html = '<s>' + escapeHtml(match[1]) + '</s>';
    } else if (data === '$' && (match = before.match(/\$\$([^$\n]+?)\$\$$/))) {
      html = mathPlaceholder(match[1].trim());
    } else if (data === '$' && (match = before.match(/(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$$/))) {
      length = match[0].length - match[1].length;
      html = mathPlaceholder(match[2]);
    }
    if (!html) return;
    length = length || match[0].length;
    var range = document.createRange();
    range.setStart(node, selection.anchorOffset - length);
    range.setEnd(node, selection.anchorOffset);
    selectRange(range);
    exec('insertHTML', html + '\u200b');
    withCaret(function () { tidy(true); });
    hydrateMath();
  }

  editor.addEventListener('keydown', function (event) {
    if (event.isComposing || event.keyCode === 229) return;
    var mod = isMac ? event.metaKey : event.ctrlKey;
    var selection = window.getSelection();
    var caption = closestInEditor(selection.anchorNode, 'FIGCAPTION');
    if (activeFigure && !caption && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.preventDefault();
      removeFigure(activeFigure);
      return;
    }
    if (activeFigure && !mod) hideFigureTools();
    if (caption) {
      if (event.key === 'Enter') {
        event.preventDefault();
        caretInto(paragraphAfter(caption.parentNode), false);
      }
      return;
    }
    var cell = currentCell();
    var shortcut = mod ? (event.altKey ? 'alt+' : '') + (event.shiftKey ? 'shift+' : '') + event.code : '';
    var actions = {
      KeyK: openLinkForm,
      KeyE: function () { toggleCode(); scheduleSave(); },
      'shift+KeyM': insertMath,
      'alt+KeyM': insertMath,
      'alt+KeyT': function () { insertTable(); },
      'shift+KeyK': function () { applyBlock('pre'); },
      'shift+KeyX': function () { exec('strikeThrough'); scheduleSave(); },
      'shift+KeyH': toggleMark,
      'shift+Digit7': function () { listCommand('insertOrderedList'); scheduleSave(); },
      'shift+Digit8': function () { listCommand('insertUnorderedList'); scheduleSave(); },
      'shift+Digit9': toggleTaskList,
      'alt+Digit0': function () { applyBlock('p'); },
      'alt+Digit2': function () { applyBlock('h2'); },
      'alt+Digit3': function () { applyBlock('h3'); }
    };
    if (actions[shortcut]) {
      event.preventDefault();
      actions[shortcut]();
    } else if (cell && event.key === 'Tab') {
      event.preventDefault();
      moveInTable(cell, event.shiftKey ? -1 : 1);
    } else if (cell && event.key === 'Enter' && !event.shiftKey && !mod) {
      event.preventDefault();
      moveDownInTable(cell);
    } else if (cell && !mod && !event.shiftKey && ((event.key === 'ArrowDown' && !cell.parentNode.nextElementSibling && cell.parentNode.parentNode.tagName === 'TBODY') ||
      (event.key === 'ArrowUp' && cell.parentNode.rowIndex === 0))) {
      event.preventDefault();
      leaveTable(cell.closest('table'), event.key === 'ArrowUp');
    } else if (event.key === 'Tab' && !mod && closestInEditor(selection.anchorNode, 'PRE')) {
      event.preventDefault();
      if (!event.shiftKey) exec('insertText', '    ');
    } else if (event.key === 'Tab' && closestInEditor(selection.anchorNode, 'LI')) {
      event.preventDefault();
      listCommand(event.shiftKey ? 'outdent' : 'indent');
      scheduleSave();
    } else if (event.key === ' ' && !mod && !event.altKey && (taskShortcut() || blockShortcut())) {
      event.preventDefault();
      scheduleSave();
    } else if (event.key === 'Enter' && !event.shiftKey && !mod && enterShortcut()) {
      event.preventDefault();
      scheduleSave();
    }
  });

  editor.addEventListener('input', function (event) {
    if (event.isComposing) return;
    if (hasStrayNodes()) withCaret(function () { tidy(false); });
    if (event.inputType === 'insertText' && /^[`*=~$]$/.test(event.data || '')) inlineShortcut(event.data);
    if (event.inputType === 'insertParagraph') {
      var item = currentItem();
      var previous = item && item.previousElementSibling;
      if (item && previous && previous.hasAttribute('data-task') && (!item.hasAttribute('data-task') || !hasContent(item))) {
        item.setAttribute('data-task', 'todo');
      }
    }
    scheduleSave();
  });
  editor.addEventListener('compositionend', function () {
    if (hasStrayNodes()) withCaret(function () { tidy(false); });
  });
  editor.addEventListener('focus', ensureStarted);

  [title, summary].forEach(function (field) {
    field.addEventListener('input', function () {
      if (/\n/.test(field.value)) field.value = field.value.replace(/\s*\n+\s*/g, ' ');
      autosize(field);
      scheduleSave();
    });
    field.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (field === title) summary.focus();
      else { editor.focus({ preventScroll: true }); ensureStarted(); caretInto(editor.firstElementChild || editor, false); }
    });
  });
  tags.addEventListener('input', scheduleSave);
  window.addEventListener('resize', function () { autosize(title); autosize(summary); });

  document.addEventListener('keydown', function (event) {
    var mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod || event.altKey || event.isComposing || event.defaultPrevented) return;
    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveDraft();
    } else if (event.key === 'Enter' && !dialog.open) {
      event.preventDefault();
      preparePublish();
    }
  });

  // -------------------------------------------------------- copy & backup

  function copyText(value, onDone) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.reject(new Error('Clipboard unavailable'));
    return navigator.clipboard.writeText(value).then(onDone);
  }

  function flashButton(button, label) {
    var original = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', original);
    button.textContent = label;
    window.setTimeout(function () { button.textContent = original; }, 2200);
  }

  $('copy-markdown').addEventListener('click', function () {
    var button = this;
    var markdown = exportArticle(false).markdown;
    if (!markdown) { setStatus('先写一些正文', 'idle'); return; }
    copyText(markdown, function () { flashButton(button, '已复制 ✓'); }).catch(function () {
      setStatus('无法写入剪贴板，请改用“下载备份 .md”', 'error');
    });
  });

  $('download-markdown').addEventListener('click', function () {
    var article = exportArticle(true);
    var heading = title.value.trim();
    if (!heading && !article.markdown) { setStatus('草稿还是空的', 'idle'); return; }
    var front = ['---', 'title: ' + JSON.stringify(heading)];
    if (summary.value.trim()) front.push('excerpt: ' + JSON.stringify(summary.value.trim()));
    if (tagList().length) front.push('tags: ' + JSON.stringify(tagList()));
    front.push('date: ' + new Date().toISOString().slice(0, 10), '---', '');
    var blob = new Blob([front.join('\n') + '\n' + article.markdown + '\n'], { type: 'text/markdown;charset=utf-8' });
    var link = el('a');
    link.href = URL.createObjectURL(blob);
    link.download = (heading.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'draft') + '.md';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 4000);
    setStatus('已下载备份，图片已内嵌在 .md 中', 'saved');
  });

  // ------------------------------------------------------------ publish

  function copyImage(src, button, row) {
    fetch(src).then(function (response) { return response.blob(); }).then(function (blob) {
      if (blob.type === 'image/png') return blob;
      return createImageBitmap(blob).then(function (bitmap) {
        var canvas = el('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
      });
    }).then(function (blob) {
      if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write || !blob) throw new Error('Clipboard unavailable');
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }).then(function () {
      button.textContent = '已复制 ✓';
      row.setAttribute('data-done', '');
    }, function () {
      setStatus('复制图片失败，请下载后拖入 GitHub 图片上传区', 'error');
    });
  }

  function renderImages(images) {
    transferList.replaceChildren();
    images.forEach(function (item, index) {
      var row = el('li');
      var preview = el('img');
      preview.src = item.src;
      preview.alt = '';
      var label = el('span');
      label.textContent = '图片 ' + (index + 1) + (item.caption ? ' · ' + item.caption : '');
      var copy = el('button');
      copy.type = 'button';
      copy.textContent = '复制图片';
      copy.addEventListener('click', function () { copyImage(item.src, copy, row); });
      var download = el('a');
      download.href = item.src;
      var subtype = (item.src.match(/^data:image\/(png|jpeg|gif|webp)/) || [null, 'png'])[1];
      download.download = 'blog-image-' + (index + 1) + '.' + (subtype === 'jpeg' ? 'jpg' : subtype);
      download.textContent = '下载';
      row.append(preview, label, copy, download);
      transferList.appendChild(row);
    });
  }

  function preparePublish() {
    closeLinkForm(false);
    hideFigureTools();
    var article = exportArticle(false);
    if (!title.value.trim()) { title.focus(); setStatus('请先填写标题', 'error'); return; }
    if (!article.markdown) {
      editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editor.focus({ preventScroll: true });
      ensureStarted();
      setStatus('请先写正文', 'error');
      return;
    }
    saveDraft();
    handoffMarkdown = article.markdown;
    var params = new URLSearchParams({
      template: 'blog.yml',
      title: '[Blog] ' + title.value.trim(),
      summary: summary.value.trim(),
      tags: tagList().join(', '),
      article: article.markdown
    });
    var url = ISSUE_URL + params.toString();
    var tooLong = url.length > 7000;
    if (tooLong) {
      params.delete('article');
      url = ISSUE_URL + params.toString();
    }
    publishLink.href = url;
    $('step-copy').hidden = !tooLong;
    fallback.hidden = true;
    fallback.value = article.markdown;
    $('copy-handoff-markdown').textContent = '复制正文 Markdown';
    $('step-open-text').textContent = tooLong
      ? '标题、摘要和标签已经预填。把刚才复制的正文粘贴到“文章正文”框。'
      : '标题、摘要、标签和正文已经预填，检查一下排版。';
    renderImages(article.images);
    $('step-images').hidden = !article.images.length;
    $('image-count').textContent = article.images.length ? '（' + article.images.length + ' 张）' : '';
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  publishButton.addEventListener('click', preparePublish);
  $('publish-close').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', function () { publishButton.focus(); });
  $('copy-handoff-markdown').addEventListener('click', function () {
    var button = this;
    copyText(handoffMarkdown, function () { button.textContent = '已复制 ✓'; }).catch(function () {
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
    });
  });

  var clearButton = $('clear-draft');
  var clearArmed = false;
  var clearTimer;
  clearButton.addEventListener('click', function () {
    if (!clearArmed) {
      clearArmed = true;
      clearButton.textContent = '再次点击，确认清空';
      clearTimer = setTimeout(function () {
        clearArmed = false;
        clearButton.textContent = '清空草稿';
      }, 6000);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    clearButton.textContent = '清空草稿';
    title.value = '';
    summary.value = '';
    tags.value = '';
    hideFigureTools();
    editor.replaceChildren();
    autosize(title);
    autosize(summary);
    scheduleSave();
    title.focus();
  });

  // --------------------------------------------------------------- load

  $('draft-date').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date());

  function finishLoad(message, state) {
    tidy(true);
    upgradeLegacyImages();
    tidy(false);
    if (!hasContent(editor)) editor.replaceChildren();
    editor.querySelectorAll('img').forEach(function (image) { if (image.complete) sizeImage(image); });
    renderPendingMath();
    loaded = true;
    autosize(title);
    autosize(summary);
    refresh();
    setStatus(message, state);
  }

  dbReady.then(function (db) {
    var request = db.transaction('drafts').objectStore('drafts').get('current');
    request.onsuccess = function () {
      var draft = request.result;
      if (draft) {
        title.value = draft.title || '';
        summary.value = draft.summary || '';
        tags.value = draft.tags || '';
        editor.innerHTML = draft.html || '';
      }
      finishLoad(draft ? '已恢复 ' + dateTimeLabel(draft.updated || Date.now()) + ' 的草稿' : '新草稿 · 自动保存', draft ? 'saved' : 'idle');
    };
    request.onerror = function () { finishLoad('草稿读取失败', 'error'); };
  }, function () {
    finishLoad('此浏览器无法自动保存，请下载备份', 'error');
  });
})();
