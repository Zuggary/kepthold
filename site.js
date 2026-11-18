(function () {
  'use strict';
  var bench = document.getElementById('bench');
  if (!bench) return;
  var ask = document.getElementById('ask');
  var recordsButton = document.getElementById('rec');
  var power = document.getElementById('sw');
  var leaf = document.getElementById('leaf');
  var records = document.getElementById('records');
  var status = document.getElementById('answer-status');
  var staticExample = document.getElementById('static-example');
  var summary = bench.querySelector('.ans-big');
  var source = bench.querySelector('.ans-src');
  if (!ask || !recordsButton || !power || !leaf || !records || !status ||
      !staticExample || !summary || !source) return;
  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function setRecords(open) {
    bench.dataset.open = open ? '1' : '0';
    recordsButton.setAttribute('aria-expanded', String(open));
    records.setAttribute('aria-hidden', String(!open));
  }

  function clearAnimations() {
    bench.classList.remove('tearing', 'mending', 'printing');
  }

  function play(animation) {
    var restart = bench.classList.contains(animation);
    clearAnimations();
    if (motion.matches) return;
    if (restart) void bench.offsetWidth;
    bench.classList.add(animation);
  }

  bench.addEventListener('animationend', function (event) {
    var name = event.animationName;
    if (name === 'tear' || name === 'tearm') bench.classList.remove('tearing');
    if (name === 'mend') bench.classList.remove('mending');
    if (name === 'print') bench.classList.remove('printing');
  });
  if (motion.addEventListener) motion.addEventListener('change', clearAnimations);
  else if (motion.addListener) motion.addListener(clearAnimations);

  ask.addEventListener('click', function () {
    bench.dataset.asked = '1';
    ask.textContent = 'Ask again';
    status.textContent = summary.textContent + ' ' + source.textContent;
    play('printing');
  });

  recordsButton.addEventListener('click', function () {
    setRecords(bench.dataset.open !== '1');
  });

  power.addEventListener('click', function () {
    var off = bench.dataset.off !== '1';
    bench.dataset.off = off ? '1' : '0';
    power.setAttribute('aria-checked', String(!off));
    leaf.setAttribute('aria-hidden', String(off));
    if (off) leaf.setAttribute('inert', '');
    else leaf.removeAttribute('inert');
    play(off ? 'tearing' : 'mending');
  });

  bench.dataset.asked = '0';
  setRecords(false);
  staticExample.hidden = true;
  power.hidden = false;
  ask.hidden = false;
  recordsButton.hidden = false;
  document.documentElement.classList.add('js');
})();
