document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var body = document.getElementById('blog-post-content');
  if (!body) return;
  var zh = (body.getAttribute('lang') || '').indexOf('zh') === 0;

  // Plain-text URLs become links; skip code and existing links.
  var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      if (!/https?:\/\//.test(node.data) || /\\[([]|\$\$/.test(node.data)) return NodeFilter.FILTER_REJECT;
      return node.parentElement.closest('a, code, pre, mjx-container') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  var textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(function (node) {
    var fragment = document.createDocumentFragment();
    var cursor = 0;
    node.data.replace(/https?:\/\/[^\s<>"'()\uff08\uff09\u3000-\u303f\uff01-\uff0f\uff1a-\uff20]+/g, function (match, offset) {
      var url = match.replace(/[.,;:!?]+$/, '');
      fragment.appendChild(document.createTextNode(node.data.slice(cursor, offset)));
      var link = document.createElement('a');
      link.href = url;
      link.textContent = url;
      fragment.appendChild(link);
      cursor = offset + url.length;
      return match;
    });
    fragment.appendChild(document.createTextNode(node.data.slice(cursor)));
    node.parentNode.replaceChild(fragment, node);
  });

  // Images: give standalone images a figure, show titles as captions, open a zoomed view on click.
  var lightbox = document.getElementById('blog-lightbox');
  var lightboxImage = lightbox && lightbox.querySelector('img');
  var lightboxCaption = lightbox && lightbox.querySelector('.blog-lightbox__caption');
  body.querySelectorAll('img:not(.emoji)').forEach(function (image) {
    var parent = image.parentElement;
    var caption = (image.getAttribute('title') || '').trim();
    if (parent.tagName === 'P' && parent.textContent.trim() === '' && parent.querySelectorAll('img').length === 1) {
      var figure = document.createElement('figure');
      parent.parentNode.replaceChild(figure, parent);
      figure.appendChild(image);
      if (caption) {
        var figcaption = document.createElement('figcaption');
        figcaption.textContent = caption;
        figure.appendChild(figcaption);
      }
    }
    image.loading = 'lazy';
    image.decoding = 'async';
    if (!lightbox || !lightbox.showModal || image.closest('a')) return;
    image.classList.add('is-zoomable');
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', (zh ? '放大查看：' : 'Enlarge image: ') + (caption || image.alt || ''));
    function open() {
      lightboxImage.src = image.currentSrc || image.src;
      lightboxImage.alt = image.alt;
      lightboxCaption.textContent = caption;
      lightboxCaption.hidden = !caption;
      lightbox.showModal();
    }
    image.addEventListener('click', open);
    image.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
  });
  if (lightbox) {
    lightbox.addEventListener('click', function (event) {
      if (event.target === lightbox || event.target === lightboxImage) lightbox.close();
    });
  }

  // GitHub/Typora callouts: > [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION].
  var CALLOUTS = {
    NOTE: ['Note', '说明'],
    TIP: ['Tip', '提示'],
    IMPORTANT: ['Important', '重要'],
    WARNING: ['Warning', '注意'],
    CAUTION: ['Caution', '警告']
  };
  body.querySelectorAll('blockquote').forEach(function (quote) {
    var first = quote.firstElementChild;
    var text = first && first.tagName === 'P' ? first.firstChild : null;
    var match = text && text.nodeType === 3 && text.data.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i);
    if (!match) return;
    var type = match[1].toUpperCase();
    text.data = text.data.slice(match[0].length);
    while (first.firstChild && (first.firstChild.nodeName === 'BR' || (first.firstChild.nodeType === 3 && !first.firstChild.data.trim()))) {
      first.removeChild(first.firstChild);
    }
    if (!first.firstChild) quote.removeChild(first);
    var title = document.createElement('p');
    title.className = 'blog-callout__title';
    title.textContent = CALLOUTS[type][zh ? 1 : 0];
    quote.insertBefore(title, quote.firstChild);
    quote.classList.add('blog-callout', 'blog-callout--' + type.toLowerCase());
  });

  // Code blocks get a language label and a copy button; mermaid blocks become diagrams.
  var diagrams = [];
  body.querySelectorAll('pre').forEach(function (pre) {
    var holder = pre.closest('div.highlighter-rouge, figure.highlight') || pre;
    if (holder.parentNode.classList.contains('blog-code')) return;
    var code = pre.querySelector('code') || pre;
    var language = ((holder.className + ' ' + code.className).match(/language-([\w+#.-]+)/) || [])[1] || '';
    if (language === 'mermaid') { diagrams.push({ holder: holder, source: code.textContent }); return; }
    var wrapper = document.createElement('div');
    wrapper.className = 'blog-code';
    holder.parentNode.insertBefore(wrapper, holder);
    wrapper.appendChild(holder);
    var bar = document.createElement('div');
    bar.className = 'blog-code__bar';
    if (language && !/^(plaintext|text|txt)$/.test(language)) {
      var label = document.createElement('span');
      label.textContent = language;
      bar.appendChild(label);
    }
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = zh ? '复制' : 'Copy';
    copy.addEventListener('click', function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(code.textContent.replace(/\n$/, '')).then(function () {
        copy.textContent = zh ? '已复制' : 'Copied';
        window.setTimeout(function () { copy.textContent = zh ? '复制' : 'Copy'; }, 1800);
      });
    });
    bar.appendChild(copy);
    wrapper.appendChild(bar);
  });
  if (diagrams.length) {
    import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(function (module) {
      var mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: {
          fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif',
          fontSize: '14px',
          primaryColor: '#fbfaf6',
          primaryBorderColor: '#87534e',
          primaryTextColor: '#25221f',
          lineColor: '#6e6861',
          secondaryColor: '#eee9e0',
          tertiaryColor: '#f7f5f0'
        }
      });
      var nodes = diagrams.map(function (diagram) {
        var figure = document.createElement('figure');
        figure.className = 'blog-mermaid';
        var graph = document.createElement('div');
        graph.className = 'mermaid';
        graph.textContent = diagram.source;
        figure.appendChild(graph);
        diagram.holder.parentNode.replaceChild(figure, diagram.holder);
        return graph;
      });
      return mermaid.run({ nodes: nodes, suppressErrors: true });
    }).catch(function () { /* leave the source visible */ });
  }

  // Table of contents, heading links, and the active section.
  var toc = document.getElementById('blog-toc');
  var list = document.getElementById('blog-toc-list');
  var headings = Array.prototype.slice.call(body.querySelectorAll('h2, h3'));
  var tocLinks = [];
  headings.forEach(function (heading, index) {
    if (!heading.id) heading.id = 'section-' + (index + 1);
    var anchor = document.createElement('a');
    anchor.className = 'blog-heading-link';
    anchor.href = '#' + heading.id;
    anchor.setAttribute('aria-label', (zh ? '本节链接：' : 'Link to section: ') + heading.textContent.trim());
    anchor.textContent = '#';
    heading.appendChild(anchor);
    if (!toc) return;
    var item = document.createElement('li');
    if (heading.tagName === 'H3') item.className = 'is-subheading';
    var link = document.createElement('a');
    link.href = '#' + heading.id;
    link.textContent = heading.textContent.replace(/#$/, '').trim();
    item.appendChild(link);
    list.appendChild(item);
    tocLinks.push(link);
  });
  if (toc && headings.length) {
    toc.hidden = false;
    var compact = window.matchMedia('(max-width: 1100px)');
    var syncToc = function () { toc.open = !compact.matches; };
    syncToc();
    if (compact.addEventListener) compact.addEventListener('change', syncToc);
    list.addEventListener('click', function () { if (compact.matches) toc.open = false; });
  }

  var progress = document.getElementById('blog-progress-bar');
  var ticking = false;
  function update() {
    ticking = false;
    var rect = body.getBoundingClientRect();
    var total = rect.height - window.innerHeight * 0.6;
    var ratio = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
    if (progress) progress.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
    if (!tocLinks.length) return;
    var active = -1;
    headings.forEach(function (heading, index) {
      if (heading.getBoundingClientRect().top < 140) active = index;
    });
    tocLinks.forEach(function (link, index) {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  update();

  var copyLink = document.getElementById('blog-copy-link');
  if (copyLink) {
    var label = copyLink.textContent;
    copyLink.addEventListener('click', function () {
      var url = window.location.href.split('#')[0];
      var done = function () {
        copyLink.textContent = copyLink.getAttribute('data-done');
        window.setTimeout(function () { copyLink.textContent = label; }, 2200);
      };
      var fallback = function () {
        var field = document.createElement('textarea');
        field.value = url;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
        document.body.removeChild(field);
        if (copied) done();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
      else fallback();
    });
  }
});
