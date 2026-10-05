document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var body = document.getElementById('blog-post-content');
  if (!body) return;
  var zh = (body.getAttribute('lang') || '').indexOf('zh') === 0;

  // Plain-text URLs become links; skip code and existing links.
  var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      if (!/https?:\/\//.test(node.data)) return NodeFilter.FILTER_REJECT;
      return node.parentElement.closest('a, code, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  var textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(function (node) {
    var fragment = document.createDocumentFragment();
    var cursor = 0;
    node.data.replace(/https?:\/\/[^\s<>"'()（）\u3000-〿！-／：-＠]+/g, function (match, offset) {
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
  body.querySelectorAll('img').forEach(function (image) {
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
