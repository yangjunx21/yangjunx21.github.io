(function () {
  'use strict';

  var editor = document.getElementById('editor-body');
  if (!editor) return;

  var title = document.getElementById('editor-title');
  var summary = document.getElementById('editor-summary');
  var tags = document.getElementById('editor-tags');
  var status = document.getElementById('draft-status');
  var outline = document.getElementById('editor-outline');
  var picker = document.getElementById('editor-image-picker');
  var handoff = document.getElementById('publish-handoff');
  var transfer = document.getElementById('image-transfer');
  var transferList = document.getElementById('image-transfer-list');
  var publishLink = document.getElementById('github-publish-link');
  var fallback = document.getElementById('markdown-fallback');
  var handoffNote = document.getElementById('handoff-note');
  var saveTimer;
  var imageSelection;
  var draftDb;
  var dbReady = new Promise(function (resolve, reject) {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    var request = indexedDB.open('junxiao-blog-editor', 1);
    request.onupgradeneeded = function () {
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
    };
    request.onsuccess = function () { draftDb = request.result; resolve(draftDb); };
    request.onerror = function () { reject(request.error); };
  });

  function setStatus(message) { status.textContent = message; }

  function getDraft() {
    return { title: title.value, summary: summary.value, tags: tags.value, html: editor.innerHTML, updated: Date.now() };
  }

  function saveDraft() {
    dbReady.then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction('drafts', 'readwrite').objectStore('drafts').put(getDraft(), 'current');
        request.onsuccess = resolve;
        request.onerror = function () { reject(request.error); };
      });
    }).then(function () { setStatus('草稿已保存在此浏览器'); }, function () { setStatus('草稿保存失败，请先复制 Markdown'); });
  }

  function scheduleSave() {
    setStatus('正在保存…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 550);
    handoff.hidden = true;
    updateOutline();
  }

  function updateOutline() {
    outline.replaceChildren();
    var headings = Array.prototype.filter.call(editor.querySelectorAll('h2, h3'), function (heading) {
      return heading.textContent.trim();
    });
    if (!headings.length) {
      var empty = document.createElement('li');
      empty.className = 'blog-editor__outline-empty';
      empty.textContent = '添加小标题后显示';
      outline.appendChild(empty);
      return;
    }
    headings.forEach(function (heading, index) {
      if (!heading.id) heading.id = 'draft-heading-' + index;
      var item = document.createElement('li');
      if (heading.tagName === 'H3') item.className = 'is-subheading';
      var link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = heading.textContent.trim() || '未命名小标题';
      item.appendChild(link);
      outline.appendChild(item);
    });
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
      updateOutline();
      setStatus(draft ? '已恢复本机草稿' : '新草稿 · 自动保存');
    };
    request.onerror = function () { setStatus('草稿读取失败'); };
  }, function () { setStatus('此浏览器无法自动保存，请定期复制 Markdown'); });

  [title, summary, tags, editor].forEach(function (field) { field.addEventListener('input', scheduleSave); });
  document.getElementById('draft-date').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date());

  function selectionRange() {
    var selection = window.getSelection();
    if (selection.rangeCount && editor.contains(selection.anchorNode)) return selection.getRangeAt(0).cloneRange();
    var range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  function insertImage(file, range) {
    return new Promise(function (resolve) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { setStatus('只支持 PNG、JPEG、GIF、WebP 图片'); resolve(); return; }
      if (file.size > 12 * 1024 * 1024) { setStatus('图片超过 12 MB，请先压缩'); resolve(); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var image = document.createElement('img');
        image.src = reader.result;
        image.alt = file.name.replace(/\.[^.]+$/, '') || '配图';
        image.setAttribute('data-local-image', '');
        range.deleteContents();
        range.insertNode(image);
        range.setStartAfter(image);
        range.collapse(true);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        editor.focus();
        scheduleSave();
        resolve();
      };
      reader.onerror = function () { setStatus('图片读取失败'); resolve(); };
      reader.readAsDataURL(file);
    });
  }

  function insertFiles(files, range) {
    range = range || selectionRange();
    Array.prototype.slice.call(files).filter(function (file) { return file.type.indexOf('image/') === 0; }).reduce(function (pending, file) {
      return pending.then(function () { return insertImage(file, range); });
    }, Promise.resolve());
  }

  editor.addEventListener('paste', function (event) {
    var files = Array.prototype.slice.call(event.clipboardData.files || []);
    if (files.some(function (file) { return file.type.indexOf('image/') === 0; })) {
      event.preventDefault();
      insertFiles(files);
      return;
    }
    event.preventDefault();
    var value = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, value);
  });
  editor.addEventListener('dragover', function (event) { if (event.dataTransfer.types.indexOf('Files') !== -1) event.preventDefault(); });
  editor.addEventListener('drop', function (event) {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    editor.focus();
    insertFiles(event.dataTransfer.files);
  });
  picker.addEventListener('change', function () { insertFiles(picker.files, imageSelection); picker.value = ''; imageSelection = null; });

  document.querySelectorAll('.blog-editor__toolbar button').forEach(function (button) {
    button.addEventListener('mousedown', function (event) { event.preventDefault(); });
    button.addEventListener('click', function () {
      var action = button.getAttribute('data-action');
      if (action === 'image') { imageSelection = selectionRange(); picker.click(); return; }
      editor.focus();
      if (action === 'link') {
        var raw = window.prompt('输入链接地址（https://…）');
        if (raw === null) return;
        try {
          var url = new URL(raw.trim());
          if (!/^https?:$/.test(url.protocol)) throw new Error('Invalid protocol');
          document.execCommand('createLink', false, url.href);
        } catch (_) { setStatus('链接必须以 http:// 或 https:// 开头'); return; }
      } else if (button.hasAttribute('data-format')) {
        document.execCommand('formatBlock', false, button.getAttribute('data-format'));
      } else {
        document.execCommand(button.getAttribute('data-command'), false, null);
      }
      scheduleSave();
    });
  });

  function escapeText(value) { return value.replace(/([\\*_[\]`])/g, '\\$1'); }
  function inline(node, images) {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    var tag = node.tagName.toLowerCase();
    var content = Array.prototype.map.call(node.childNodes, function (child) { return inline(child, images); }).join('');
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return '**' + content + '**';
    if (tag === 'em' || tag === 'i') return '*' + content + '*';
    if (tag === 'code') return '`' + node.textContent.replace(/`/g, '\\`') + '`';
    if (tag === 'a') {
      var href = node.getAttribute('href') || '';
      return /^https?:\/\//i.test(href) ? '[' + content + '](' + href + ')' : content;
    }
    if (tag === 'img') {
      var src = node.getAttribute('src') || '';
      if (/^data:image\//i.test(src)) {
        images.push({ src: src, alt: node.getAttribute('alt') || '配图' });
        return '<!-- BLOG_IMAGE_' + images.length + ' -->';
      }
      return /^https?:\/\//i.test(src) ? '![' + escapeText(node.getAttribute('alt') || '配图') + '](' + src + ')' : '';
    }
    return content;
  }

  function block(node, images) {
    if (node.nodeType === Node.TEXT_NODE) return inline(node, images).trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    var tag = node.tagName.toLowerCase();
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') return (tag === 'h3' ? '### ' : '## ') + inline(node, images).trim();
    if (tag === 'ul' || tag === 'ol') return Array.prototype.map.call(node.children, function (item, index) {
      return (tag === 'ol' ? (index + 1) + '. ' : '- ') + inline(item, images).trim();
    }).join('\n');
    if (tag === 'blockquote') return inline(node, images).trim().split('\n').map(function (line) { return '> ' + line; }).join('\n');
    if (tag === 'pre') return '```\n' + node.textContent.trim() + '\n```';
    if (tag === 'hr') return '---';
    return inline(node, images).trim();
  }

  function exportArticle() {
    var images = [];
    var markdown = Array.prototype.map.call(editor.childNodes, function (node) { return block(node, images); }).filter(Boolean).join('\n\n').trim();
    return { markdown: markdown, images: images };
  }

  function showMarkdown(markdown) {
    fallback.hidden = false;
    fallback.value = markdown;
    fallback.focus();
    fallback.select();
    fallback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function copyMarkdown() {
    var markdown = exportArticle().markdown;
    if (!markdown) { setStatus('先写一些正文'); return; }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      handoff.hidden = false;
      showMarkdown(markdown);
      setStatus('请从下方手动复制 Markdown');
      return;
    }
    navigator.clipboard.writeText(markdown).then(function () { setStatus('Markdown 已复制'); }, function () {
      handoff.hidden = false;
      showMarkdown(markdown);
      setStatus('请从下方手动复制 Markdown');
    });
  }

  document.getElementById('copy-markdown').addEventListener('click', copyMarkdown);
  document.getElementById('copy-handoff-markdown').addEventListener('click', copyMarkdown);

  function copyImage(src, button) {
    fetch(src).then(function (response) { return response.blob(); }).then(function (blob) {
      if (blob.type === 'image/png') return blob;
      return createImageBitmap(blob).then(function (bitmap) {
        var canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
      });
    }).then(function (blob) {
      if (!window.ClipboardItem || !navigator.clipboard.write || !blob) throw new Error('Clipboard unavailable');
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }).then(function () { button.textContent = '已复制'; }, function () { setStatus('复制图片失败，请下载后拖入 GitHub 图片上传区'); });
  }

  function renderImages(images) {
    transferList.replaceChildren();
    transfer.hidden = images.length === 0;
    images.forEach(function (item, index) {
      var row = document.createElement('li');
      var preview = document.createElement('img');
      preview.src = item.src;
      preview.alt = '';
      var label = document.createElement('span');
      label.textContent = '图片 ' + (index + 1) + ' · ' + item.alt;
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = '复制图片';
      copy.addEventListener('click', function () { copyImage(item.src, copy); });
      var download = document.createElement('a');
      download.href = item.src;
      var subtype = (item.src.match(/^data:image\/(png|jpeg|gif|webp)/) || [null, 'png'])[1];
      download.download = 'blog-image-' + (index + 1) + '.' + (subtype === 'jpeg' ? 'jpg' : subtype);
      download.textContent = '下载';
      row.append(preview, label, copy, download);
      transferList.appendChild(row);
    });
  }

  function preparePublish() {
    var article = exportArticle();
    if (!title.value.trim()) { title.focus(); setStatus('请先填写标题'); return; }
    if (!article.markdown) { editor.focus(); setStatus('请先写正文'); return; }
    clearTimeout(saveTimer);
    saveDraft();
    renderImages(article.images);
    var params = new URLSearchParams({ template: 'blog.yml', title: '[Blog] ' + title.value.trim(), summary: summary.value.trim(), tags: tags.value.trim(), article: article.markdown });
    var url = 'https://github.com/yangjunx21/yangjunx21.github.io/issues/new?' + params.toString();
    var tooLong = url.length > 7000;
    handoff.hidden = false;
    if (tooLong) {
      params.delete('article');
      url = 'https://github.com/yangjunx21/yangjunx21.github.io/issues/new?' + params.toString();
      showMarkdown(article.markdown);
    } else {
      fallback.hidden = true;
    }
    publishLink.href = url;
    handoffNote.textContent = tooLong ? '文章较长，请先复制上方 Markdown，再粘贴到 GitHub 的“文章正文”框。' : 'GitHub 表单里请检查预填内容，勾选“同步到个人博客”后提交。';
    document.getElementById('handoff-description').textContent = article.images.length ? '正文已经准备好。图片需要在 GitHub 表单的“图片上传区”逐张上传，然后勾选发布。' : '标题和正文会带到 GitHub 表单。检查后勾选“同步到个人博客”并提交。';
    handoff.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.getElementById('prepare-publish').addEventListener('click', preparePublish);
  document.getElementById('prepare-publish-bottom').addEventListener('click', preparePublish);
  var clearButton = document.getElementById('clear-draft');
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
    editor.replaceChildren();
    handoff.hidden = true;
    scheduleSave();
    title.focus();
  });
})();
