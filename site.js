(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var b = document.getElementById('bench');
  var ask = document.getElementById('ask');
  var rec = document.getElementById('rec');
  var sw = document.getElementById('sw');

  function play(cls) {
    if (reduce) return;
    b.classList.remove('tearing', 'mending', 'printing');
    void b.offsetWidth;
    b.classList.add(cls);
  }
  b.addEventListener('animationend', function (e) {
    var n = e.animationName;
    if (n === 'tear' || n === 'tearm') b.classList.remove('tearing');
    if (n === 'mend' || n === 'mendm') b.classList.remove('mending');
    if (n === 'print') b.classList.remove('printing');
  });

  ask.addEventListener('click', function () {
    b.dataset.asked = '1';
    ask.textContent = 'Ask again';
    play('printing');
  });
  rec.addEventListener('click', function () {
    var open = b.dataset.open !== '1';
    b.dataset.open = open ? '1' : '0';
    rec.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  sw.addEventListener('click', function () {
    var off = b.dataset.off !== '1';
    b.dataset.off = off ? '1' : '0';
    sw.setAttribute('aria-checked', off ? 'false' : 'true');
    play(off ? 'tearing' : 'mending');
  });

  if (reduce || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('play'); io.unobserve(e.target); }
    });
  }, { threshold: 0.4 });
  var s = document.querySelector('.steps');
  if (s) io.observe(s);
})();
