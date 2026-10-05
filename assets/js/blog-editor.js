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
      html: editor.innerHTML.replace(/ data-selected=""/g, ''),
      updated: Date.now()
    };
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
    return node.nodeType === 1 && INLINE_TAG.test(node.tagName);
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

  // Chrome nests new lists (and the paragraphs after them) inside the paragraph they started
  // from. Split such paragraphs so every block sits directly in the editor again.
  function liftBlocks() {
    var changed = false;
    Array.prototype.slice.call(editor.children).forEach(function (block) {
      if (!/^(P|H[1-6])$/.test(block.tagName)) return;
      if (!Array.prototype.some.call(block.children, function (child) { return NESTED_BLOCK.test(child.tagName); })) return;
      var run = null;
      Array.prototype.slice.call(block.childNodes).forEach(function (child) {
        if (child.nodeType === 1 && NESTED_BLOCK.test(child.tagName)) {
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
      if (block.tagName === 'P' && !block.textContent.trim() && !block.querySelector('br, img, caret-mark')) editor.removeChild(block);
    });
    return changed;
  }

  function hasNestedBlocks() {
    return Array.prototype.some.call(editor.children, function (block) {
      return /^(P|H[1-6])$/.test(block.tagName) && Array.prototype.some.call(block.children, function (child) { return NESTED_BLOCK.test(child.tagName); });
    });
  }

  // Keep the body as a flat list of blocks so the editor matches the published article.
  function tidy(deep) {
    for (var pass = 0; pass < 6 && liftBlocks(); pass += 1) { /* repeat until flat */ }
    if (deep) {
      editor.querySelectorAll('[style]').forEach(function (node) {
        if (!node.closest('figure')) node.removeAttribute('style');
      });
      editor.querySelectorAll('span, font').forEach(function (node) {
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
      } else if (node.nodeType === 1 && node.tagName === 'DIV') {
        var paragraph = el('p');
        while (node.firstChild) paragraph.appendChild(node.firstChild);
        editor.replaceChild(paragraph, node);
      }
      node = next;
    }
    var last = editor.lastElementChild;
    if (last && last.tagName !== 'P') editor.appendChild(emptyParagraph());
  }

  function hasStrayNodes() {
    return hasNestedBlocks() || Array.prototype.some.call(editor.childNodes, function (node) {
      return isStray(node) || (node.nodeType === 1 && node.tagName === 'DIV');
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

  function paragraphAfter(node) {
    var next = node.nextElementSibling;
    if (next && next.tagName === 'P') return next;
    var p = emptyParagraph();
    editor.insertBefore(p, node.nextSibling);
    return p;
  }

  // Insert a block at the caret: split a paragraph in two, or go after the current block.
  function placeBlock(node, range) {
    var block = range ? topBlock(range.startContainer) : null;
    if (!block) {
      editor.appendChild(node);
    } else if (block.nodeType === 1 && block.tagName === 'P' && !block.textContent.trim() && !block.querySelector('img')) {
      editor.replaceChild(node, block);
    } else if (block.nodeType === 1 && block.tagName === 'P') {
      var tail = document.createRange();
      tail.setStart(range.endContainer, range.endOffset);
      tail.setEnd(block, block.childNodes.length);
      var rest = tail.extractContents();
      editor.insertBefore(node, block.nextSibling);
      if (rest.textContent.trim()) {
        var after = el('p');
        after.appendChild(rest);
        editor.insertBefore(after, node.nextSibling);
      }
      if (!block.textContent.trim()) editor.removeChild(block);
    } else {
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
      if (block !== image && !block.textContent.trim() && !block.querySelector('img')) editor.removeChild(block);
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
      if (node.nodeType !== 1 || SKIP_TAGS.test(node.tagName)) return;
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
        if (node.nodeType !== 1 || SKIP_TAGS.test(node.tagName)) return;
        var tag = node.tagName;
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
          node.querySelectorAll('tr').forEach(function (row) {
            var cells = Array.prototype.map.call(row.children, function (cell) { return cell.textContent.trim(); }).filter(Boolean);
            if (!cells.length) return;
            var line = el('p');
            line.textContent = cells.join(' · ');
            out.appendChild(line);
          });
        } else if (node.querySelector(BLOCK_SELECTOR)) {
          walk(node);
        } else {
          block = inlineBlock('p', node);
        }
        if (block && (block.textContent.trim() || block.tagName === 'FIGURE')) out.appendChild(block);
        flushPending();
      });
    }

    walk(doc.body);
    endParagraph();
    return out;
  }

  function inlineMarkdown(text) {
    var escapes = [];
    text = text.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, function (_, character) {
      escapes.push(character);
      return '\u0000' + (escapes.length - 1) + '\u0000';
    });
    var html = text.split(/(`+[^`]+?`+)/).map(function (part, index) {
      if (index % 2) return '<code>' + escapeHtml(part.replace(/^`+\s?|\s?`+$/g, '')) + '</code>';
      return escapeHtml(part)
        .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '$1')
        .replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<a href="$2">$1</a>')
        .replace(/&lt;((?:https?:|mailto:)[^&\s]+)&gt;/g, '<a href="$1">$1</a>')
        .replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, function (_, a, b) { return '<strong>' + (a || b) + '</strong>'; })
        .replace(/(^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>');
    }).join('');
    return html.replace(/\u0000(\d+)\u0000/g, function (_, index) { return escapeHtml(escapes[Number(index)]); });
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
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if ((match = line.match(/^\s*(```+|~~~+)/))) {
        flush();
        var fence = match[1];
        var code = [];
        for (i += 1; i < lines.length && lines[i].trim().indexOf(fence) !== 0; i += 1) code.push(lines[i]);
        html.push('<pre>' + escapeHtml(code.join('\n')) + '</pre>');
      } else if (!line.trim()) {
        flush();
      } else if (/^<!--\s*BLOG_IMAGE_\d+/.test(line.trim())) {
        flush();
      } else if ((match = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        flush();
        var level = match[1].length <= 2 ? 'h2' : 'h3';
        html.push('<' + level + '>' + inlineMarkdown(match[2]) + '</' + level + '>');
      } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush();
        html.push('<hr>');
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
          html.push('<li>' + inlineMarkdown(item[3]));
          openItem = true;
        }
        while (stack.length) html.push('</li></' + stack.pop().tag + '>');
        i -= 1;
      } else if ((match = line.trim().match(/^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/))) {
        flush();
        html.push('<figure><img src="' + escapeHtml(match[2]) + '" alt="' + escapeHtml(match[1]) + '"><figcaption>' + escapeHtml((match[3] || '').replace(/&quot;/g, '"')) + '</figcaption></figure>');
      } else if (/^<img\s[^>]*>$/i.test(line.trim())) {
        flush();
        html.push(line.trim());
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
    return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s+\S|\d+[.)]\s+\S|>|```|~~~|!\[[^\]]*\]\()/.test(text) ||
      /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\((https?:|mailto:)[^)\s]+\)|`[^`\n]+`/.test(text);
  }

  function insertFragment(fragment) {
    var blocks = Array.prototype.filter.call(fragment.childNodes, function (node) { return node.nodeType === 1; });
    var holder = el('div');
    if (blocks.length === 1 && blocks[0].tagName === 'P') holder.innerHTML = blocks[0].innerHTML;
    else holder.appendChild(fragment);
    exec('insertHTML', holder.innerHTML);
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
    var strongMarkdown = /(^|\n)\s{0,3}(#{1,6}\s|```)|\*\*[^*\n]+\*\*|\]\((https?:|mailto:)/.test(text);
    var fragment = null;
    if (looksLikeMarkdown(text) && (!richHtml || strongMarkdown)) fragment = sanitizeHtml(markdownToHtml(text));
    else if (html) fragment = sanitizeHtml(html);
    if (fragment && fragment.childNodes.length) insertFragment(fragment);
    else exec('insertText', text);
    scheduleSave();
  });

  // ------------------------------------------------------------- export

  function escapeText(value) {
    return value
      .replace(/\u200b/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/([\\`*_[\]])/g, '\\$1')
      .replace(/<(?=[A-Za-z\/!?])/g, '&lt;');
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

  function inlineMarkdownFrom(node, context) {
    if (node.nodeType === 3) return escapeText(node.data);
    if (node.nodeType !== 1) return '';
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
      var output = marker + escapeLineStarts(text).replace(/\n/g, '\n' + pad);
      nested.forEach(function (block) {
        output += '\n' + block.split('\n').map(function (line) { return line ? pad + line : line; }).join('\n');
      });
      return output;
    }).filter(Boolean).join('\n');
  }

  function blockMarkdown(node, context) {
    if (node.nodeType === 3) return escapeLineStarts(escapeText(node.data).trim());
    if (node.nodeType !== 1) return '';
    var tag = node.tagName;
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
      return fence + '\n' + code + '\n' + fence;
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
      if (!walker.currentNode.parentNode.closest('figcaption')) parts.push(walker.currentNode.data);
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
    editor.classList.toggle('is-empty', !text.trim() && !images);
    updateOutline();
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
    if (block && block.nodeType === 1 && block.tagName === 'P' && !block.textContent.trim()) {
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
      if (button.hasAttribute('data-block')) { applyBlock(button.getAttribute('data-block')); return; }
      focusBody();
      var command = button.getAttribute('data-command');
      if (/List$/.test(command)) listCommand(command);
      else exec(command);
      scheduleSave();
    });
  });

  document.querySelectorAll('[data-mod]').forEach(function (key) { key.textContent = isMac ? '⌘' : 'Ctrl'; });
  toolbarButtons.forEach(function (button) {
    var shortcut = button.getAttribute('data-shortcut');
    if (shortcut) button.title += ' (' + (isMac ? '⌘' : 'Ctrl+') + shortcut + ')';
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

  function enterShortcut() {
    var selection = selectionInBody();
    if (!selection) return false;
    var pre = closestInEditor(selection.anchorNode, 'PRE');
    if (pre) return preEnter(pre);
    var quote = closestInEditor(selection.anchorNode, 'BLOCKQUOTE');
    if (quote && selection.isCollapsed) return quoteEnter(quote);
    var prefix = caretPrefix();
    if (!prefix || !prefix.atEnd) return false;
    var text = prefix.text.trim();
    if (/^(```|~~~)[\w+-]*$/.test(text)) {
      selectRange(prefix.range);
      exec('delete');
      exec('formatBlock', 'pre');
      var block = topBlock(window.getSelection().anchorNode);
      if (block) paragraphAfter(block);
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

  function inlineShortcut(data) {
    var selection = selectionInBody();
    if (!selection || !selection.isCollapsed) return;
    var node = selection.anchorNode;
    if (!node || node.nodeType !== 3 || closestInEditor(node, 'CODE') || closestInEditor(node, 'PRE')) return;
    var before = node.data.slice(0, selection.anchorOffset);
    var match = null;
    var html = '';
    if (data === '`' && (match = before.match(/`([^`\n]+)`$/))) html = '<code>' + escapeHtml(match[1]) + '</code>\u200b';
    else if (data === '*' && (match = before.match(/\*\*([^*\n]+)\*\*$/))) html = '<strong>' + escapeHtml(match[1]) + '</strong>\u200b';
    if (!html) return;
    var range = document.createRange();
    range.setStart(node, selection.anchorOffset - match[0].length);
    range.setEnd(node, selection.anchorOffset);
    selectRange(range);
    exec('insertHTML', html);
    withCaret(function () { tidy(true); });
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
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openLinkForm();
    } else if (mod && event.altKey && /^Digit[023]$/.test(event.code)) {
      event.preventDefault();
      applyBlock({ Digit0: 'p', Digit2: 'h2', Digit3: 'h3' }[event.code]);
    } else if (event.key === 'Tab' && closestInEditor(selection.anchorNode, 'LI')) {
      event.preventDefault();
      listCommand(event.shiftKey ? 'outdent' : 'indent');
      scheduleSave();
    } else if (event.key === ' ' && !mod && !event.altKey && blockShortcut()) {
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
    if (event.inputType === 'insertText' && (event.data === '`' || event.data === '*')) inlineShortcut(event.data);
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
    if (!mod || event.altKey || event.isComposing) return;
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
    if (!editor.textContent.trim() && !editor.querySelector('img')) editor.replaceChildren();
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
