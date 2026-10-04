document.addEventListener('DOMContentLoaded', function () {
  var body = document.getElementById('blog-post-content');
  var toc = document.getElementById('blog-toc');
  var list = document.getElementById('blog-toc-list');
  if (!body || !toc || !list) return;

  var headings = Array.prototype.slice.call(body.querySelectorAll('h2, h3'));
  if (!headings.length) return;

  headings.forEach(function (heading, index) {
    if (!heading.id) heading.id = 'section-' + (index + 1);
    var item = document.createElement('li');
    if (heading.tagName === 'H3') item.className = 'is-subheading';
    var link = document.createElement('a');
    link.href = '#' + heading.id;
    link.textContent = heading.textContent.trim();
    item.appendChild(link);
    list.appendChild(item);
  });

  toc.hidden = false;
});
