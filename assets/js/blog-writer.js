(function () {
  'use strict';

  var root = document.querySelector('.blog-writer');
  if (!root) return;

  var storageKey = 'junxiao-blog-writer-draft-v1';
  var form = document.getElementById('blog-writer-form');
  var title = document.getElementById('post-title');
  var date = document.getElementById('post-date');
  var slug = document.getElementById('post-slug');
  var excerpt = document.getElementById('post-excerpt');
  var tags = document.getElementById('post-tags');
  var body = document.getElementById('post-body');
  var published = document.getElementById('post-published');
  var filename = document.getElementById('post-filename');
  var output = document.getElementById('post-output');
  var message = document.getElementById('post-message');
  var saveStatus = document.getElementById('post-draft-status');
  var wordCount = document.getElementById('post-word-count');
  var manualSlug = false;
  var draftId = makeDraftId();

  function makeDraftId() {
    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint8Array(3);
      window.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }
    return Math.random().toString(36).slice(2, 8);
  }

  function localToday() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function suggestedSlug(value) {
    var normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    var latin = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return latin || ('post-' + date.value.replace(/-/g, '') + '-' + draftId);
  }

  function quoteYaml(value) {
    return JSON.stringify(value);
  }

  function postFilename() {
    return date.value + '-' + slug.value.trim() + '.md';
  }

  function postMarkdown() {
    var lines = [
      '---',
      'title: ' + quoteYaml(title.value.trim()),
      'date: ' + date.value,
      'published: ' + (published.checked ? 'true' : 'false')
    ];
    if (excerpt.value.trim()) lines.push('excerpt: ' + quoteYaml(excerpt.value.trim()));
    var uniqueTags = [];
    tags.value.split(/[,，]/).forEach(function (value) {
      var tag = value.trim();
      if (tag && uniqueTags.indexOf(tag) === -1) uniqueTags.push(tag);
    });
    if (uniqueTags.length) {
      lines.push('tags:');
      uniqueTags.forEach(function (tag) { lines.push('  - ' + quoteYaml(tag)); });
    }
    lines.push('---', '', body.value.trimEnd(), '');
    return lines.join('\n');
  }

  function checkPost() {
    if (!title.value.trim()) return '请先填写标题。';
    if (!date.value || !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return '请选择日期。';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.value.trim())) return '网址名称只能使用小写英文、数字和连字符。';
    if (!body.value.trim()) return '请先填写正文。';
    return '';
  }

  function announce(text, ok) {
    message.textContent = text;
    message.dataset.ok = ok ? 'true' : 'false';
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        title: title.value,
        date: date.value,
        slug: slug.value,
        excerpt: excerpt.value,
        tags: tags.value,
        body: body.value,
        published: published.checked,
        manualSlug: manualSlug,
        draftId: draftId
      }));
      saveStatus.textContent = '草稿已自动保存在此浏览器';
    } catch (error) {
      saveStatus.textContent = '浏览器未能保存草稿，请下载 Markdown 备份';
    }
  }

  function update() {
    filename.textContent = date.value && slug.value.trim() ? postFilename() : 'YYYY-MM-DD-slug.md';
    output.textContent = postMarkdown();
    var count = body.value.replace(/\s/g, '').length;
    wordCount.textContent = count + ' 字';
    saveDraft();
  }

  function restoreDraft() {
    date.value = localToday();
    try {
      var saved = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
      if (saved && typeof saved === 'object') {
        title.value = saved.title || '';
        date.value = saved.date || localToday();
        slug.value = saved.slug || '';
        excerpt.value = saved.excerpt || '';
        tags.value = saved.tags || '';
        body.value = saved.body || '';
        published.checked = saved.published === true;
        manualSlug = saved.manualSlug === true;
        draftId = saved.draftId || draftId;
      }
    } catch (error) {
      saveStatus.textContent = '保存的草稿无法读取，请重新填写';
    }
    update();
  }

  async function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    var temporary = document.createElement('textarea');
    temporary.value = value;
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.appendChild(temporary);
    temporary.select();
    var success = document.execCommand('copy');
    temporary.remove();
    if (!success) throw new Error('Copy failed');
  }

  function insertFormat(kind) {
    var start = body.selectionStart;
    var end = body.selectionEnd;
    var selected = body.value.slice(start, end);
    var before = '';
    var after = '';
    var placeholder = selected;
    if (kind === 'heading') { before = '## '; placeholder = selected || '小标题'; }
    if (kind === 'bold') { before = '**'; after = '**'; placeholder = selected || '加粗文字'; }
    if (kind === 'link') { before = '['; after = '](https://example.com)'; placeholder = selected || '链接文字'; }
    if (kind === 'image') { before = '!['; after = '](https://example.com/image.jpg)'; placeholder = selected || '图片描述'; }
    if (kind === 'list') { before = '- '; placeholder = selected || '列表项'; }
    if (kind === 'quote') { before = '> '; placeholder = selected || '引用文字'; }
    if (kind === 'code') { before = '```\n'; after = '\n```'; placeholder = selected || '代码'; }
    if (!before) return;
    var insertion = before + placeholder + after;
    body.setRangeText(insertion, start, end, 'end');
    body.focus();
    body.setSelectionRange(start + before.length, start + before.length + placeholder.length);
    update();
  }

  form.addEventListener('submit', function (event) { event.preventDefault(); });
  title.addEventListener('input', function () {
    if (!manualSlug) slug.value = suggestedSlug(title.value);
    update();
  });
  date.addEventListener('input', function () {
    if (!manualSlug && title.value.trim()) slug.value = suggestedSlug(title.value);
    update();
  });
  slug.addEventListener('input', function () {
    manualSlug = slug.value.trim().length > 0;
    update();
  });
  [excerpt, tags, body].forEach(function (field) { field.addEventListener('input', update); });
  published.addEventListener('change', update);

  document.querySelectorAll('.blog-writer__toolbar button[data-format]').forEach(function (button) {
    button.addEventListener('click', function () { insertFormat(button.dataset.format); });
  });

  document.getElementById('post-copy').addEventListener('click', async function () {
    var error = checkPost();
    if (error) { announce(error, false); return; }
    try {
      await copyText(postMarkdown());
      announce('文章内容已复制。现在打开 GitHub，填写文件名并粘贴。', true);
    } catch (error) {
      announce('复制失败，请下载 Markdown 备份。', false);
    }
  });

  document.getElementById('post-copy-filename').addEventListener('click', async function () {
    var error = checkPost();
    if (error) { announce(error, false); return; }
    try {
      await copyText(postFilename());
      announce('文件名已复制。', true);
    } catch (error) {
      announce('复制失败，请手动输入上方文件名。', false);
    }
  });

  document.getElementById('post-download').addEventListener('click', function () {
    var error = checkPost();
    if (error) { announce(error, false); return; }
    var blob = new Blob([postMarkdown()], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = postFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    announce('Markdown 文件已下载。', true);
  });

  restoreDraft();
}());
