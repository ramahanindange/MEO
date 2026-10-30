/* MEO website: renders the page from /api/content and sends forms to the C++ API.
   Content lives in data/content.json, so staff update text, numbers, news and team
   without touching this file. */
(function () {
  'use strict';

  const API = '';                       // same origin as the C++ server
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- helpers ----------
  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;          // only used for trusted content.json fields
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) n.append(c);
    return n;
  }
  const money = (n, cur = 'TZS') => (cur === 'TZS' ? 'TSh ' : cur + ' ') + Number(n).toLocaleString('en-US');
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  };
  const get = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
  }

  async function postJSON(path, data) {
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* non-JSON reply */ }
    if (!res.ok || body.ok === false) {
      const err = new Error(body.error || 'Something went wrong. Please try again.');
      err.fields = body.fields || {};
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ---------- render ----------
  function render(c) {
    const org = c.organisation;

    // hero
    $('#heroTitle').append(el('span', { class: 'hl', text: c.hero.highlight }), ': ' + c.hero.text);
    Object.assign($('#heroBtn'), { textContent: c.hero.button.label, href: c.hero.button.href });

    // background images declared with data-bg="path.in.content"
    $$('[data-bg]').forEach((n) => { const src = get(c, n.dataset.bg); if (src) n.style.backgroundImage = `url("${src}")`; });

    // about
    $('#aboutTitle').textContent = c.about.title;
    c.about.paragraphs.forEach((p) => $('#aboutText').append(el('p', { html: p })));
    $('#vision').textContent = c.about.vision;
    $('#mission').textContent = c.about.mission;
    Object.assign($('#aboutImg'), { src: c.about.image, alt: c.about.imageAlt });

    // impact counters
    $('#impactTitle').textContent = c.impact.title;
    c.impact.stats.forEach((s) => $('#counts').append(el('div', {}, [
      el('b', { 'data-n': s.value, 'data-suffix': s.suffix || '', text: s.value.toLocaleString('en-US') + (s.suffix || '') }),
      el('span', { text: s.label })
    ])));

    // featured project
    $('#featTitle').textContent = c.feature.title;
    $('#featText').innerHTML = c.feature.text;
    Object.assign($('#featBtn'), { textContent: c.feature.button.label, href: c.feature.button.href });
    $('#featImg').style.backgroundImage = `url("${c.feature.image}")`;
    $('#featImg').setAttribute('aria-label', c.feature.imageAlt || '');

    // programmes (cards, nav menu, donate dropdown)
    c.programmes.forEach((p) => {
      $('#progs').append(el('article', { class: 'pcard reveal', id: 'prog-' + p.id }, [
        el('div', { class: 'ph' }, el('img', { src: p.image, alt: p.title, loading: 'lazy' })),
        el('div', { class: 'b' }, [el('h2', { text: p.title }), el('p', { text: p.text }),
          el('a', { class: 'btn up', href: '#contact', 'data-topic': p.title, text: 'Learn more' })])
      ]));
      $('#navProgrammes').append(el('li', {}, el('a', { href: '#prog-' + p.id, text: p.title })));
      $('#p_prog').append(el('option', { value: p.title, text: p.title }));
    });

    // news
    c.news.forEach((n) => $('#newsGrid').append(el('article', { class: 'ncard reveal' }, [
      el('div', { class: 'ph' }, [el('img', { src: n.image, alt: n.title, loading: 'lazy' }), el('span', { class: 'tag', text: (n.tag || 'News').toUpperCase() })]),
      el('div', { class: 'b' }, [
        el('span', { class: 'date', text: n.date ? fmtDate(n.date) : 'MEO Resources' }),
        el('h3', { text: n.title }), el('p', { text: n.text }),
        el('a', { class: 'more', href: n.url, text: 'Read more »' })
      ])
    ])));

    // team
    c.team.forEach((t) => $('#teamGrid').append(el('div', { class: 'tcard reveal' }, [
      el('img', { src: t.photo, alt: t.name, loading: 'lazy', width: 130, height: 130 }),
      el('h4', { text: t.name }), el('span', { class: 'role', text: t.role }), el('p', { text: t.bio })
    ])));

    // partners
    c.partners.forEach((p) => $('#logos').append(el('img', { src: p.logo, alt: p.name, title: p.name, loading: 'lazy' })));

    // contact + footer
    $('#cAddress').textContent = org.address.join(', ');
    $('#cPhone').append(el('a', { href: 'tel:' + org.phone.replace(/\s/g, ''), text: org.phone }));
    $('#cEmail').append(el('a', { href: 'mailto:' + org.email, text: org.email }));
    $('#cMap').append(el('a', { href: org.mapUrl, target: '_blank', rel: 'noopener', text: 'Open in Google Maps' }));
    $('#fName').textContent = org.name;
    org.address.forEach((line, i) => { if (i) $('#fAddress').append(el('br')); $('#fAddress').append(line); });
    Object.assign($('#fPhone'), { href: 'tel:' + org.phone.replace(/\s/g, ''), textContent: org.phone });
    Object.assign($('#fEmail'), { href: 'mailto:' + org.email, textContent: org.email });
    $('#year').textContent = new Date().getFullYear();
    const icons = {
      Instagram: 'M12 7a5 5 0 100 10 5 5 0 000-10zm0 8.2a3.2 3.2 0 110-6.4 3.2 3.2 0 010 6.4zM17.3 5.5a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zM12 4.2c2.5 0 2.8 0 3.8.1 2.2.1 3.7 1.6 3.8 3.8.1 1 .1 1.3.1 3.8s0 2.8-.1 3.8c-.1 2.2-1.6 3.7-3.8 3.8-1 .1-1.3.1-3.8.1s-2.8 0-3.8-.1c-2.2-.1-3.7-1.6-3.8-3.8-.1-1-.1-1.3-.1-3.8s0-2.8.1-3.8c.1-2.2 1.6-3.7 3.8-3.8 1-.1 1.3-.1 3.8-.1zM12 2.5c-2.6 0-2.9 0-3.9.1C5 2.7 2.7 5 2.6 8.1 2.5 9.1 2.5 9.4 2.5 12s0 2.9.1 3.9c.1 3.1 2.4 5.4 5.5 5.5 1 .1 1.3.1 3.9.1s2.9 0 3.9-.1c3.1-.1 5.4-2.4 5.5-5.5.1-1 .1-1.3.1-3.9s0-2.9-.1-3.9C21.3 5 19 2.7 15.9 2.6c-1-.1-1.3-.1-3.9-.1z',
      LinkedIn: 'M4.98 3.5a2.5 2.5 0 11-.02 5 2.5 2.5 0 01.02-5zM3 9h4v12H3zM9 9h3.8v1.7h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6V21h-4v-5.6c0-1.3 0-3-1.9-3s-2.2 1.5-2.2 2.9V21H9z',
      WhatsApp: 'M12 2.2A9.8 9.8 0 003.6 17l-1.4 4.9 5-1.3A9.8 9.8 0 1012 2.2zm0 17.8a8 8 0 01-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1112 20zm4.4-6c-.2-.1-1.4-.7-1.7-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.6 6.6 0 01-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 00-.7.3 2.8 2.8 0 00-.9 2.1 4.9 4.9 0 001 2.6 11.2 11.2 0 004.3 3.8c1.6.7 2.2.7 3 .6a2.6 2.6 0 001.7-1.2 2.1 2.1 0 00.1-1.2c0-.1-.2-.2-.4-.3z'
    };
    org.social.forEach((s) => {
      const a = el('a', { href: s.url, target: '_blank', rel: 'noopener', 'aria-label': s.name });
      if (icons[s.name]) a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[s.name]}"/></svg>`;
      else a.textContent = s.name[0];
      $('#social').append(a);
    });

    // donate pop-up
    $('#mt').textContent = c.donate.title;
    $('#mtext').textContent = c.donate.text;
    c.donate.amounts.forEach((a, i) => $('#amts').append(el('button', { type: 'button', class: i === 1 ? 'on' : null, 'data-amount': a, text: money(a, c.donate.currency) })));
    $('#amts').append(el('input', { type: 'number', min: 1000, step: 1000, placeholder: 'Other amount', 'aria-label': 'Other amount in shillings', name: 'other' }));
    for (const [k, v] of Object.entries(c.donate.bank)) $('#bank').append(el('div', {}, [el('span', { text: k }), el('b', { text: v })]));

    $$('section[hidden], footer[hidden]').forEach((s) => (s.hidden = false));
    $('#loading').remove();
  }

  // ---------- behaviour ----------
  function wireUp(c) {
    // mobile menu
    const nav = $('#nav'), tg = $('#toggle');
    const closeNav = () => { nav.classList.remove('open'); tg.textContent = '☰'; tg.setAttribute('aria-expanded', 'false'); };
    tg.addEventListener('click', () => { const o = nav.classList.toggle('open'); tg.textContent = o ? '✕' : '☰'; tg.setAttribute('aria-expanded', String(o)); });
    $$('.menu > li > a').forEach((a) => a.addEventListener('click', (e) => {
      if (a.hasAttribute('data-donate')) return;
      if (innerWidth <= 900 && a.nextElementSibling) { e.preventDefault(); a.parentElement.classList.toggle('open'); }
      else if (innerWidth <= 900) closeNav();
    }));
    nav.addEventListener('click', (e) => { if (e.target.closest('.sub a')) closeNav(); });

    // header shadow + back to top
    addEventListener('scroll', () => {
      $('#hdr').classList.toggle('scrolled', scrollY > 10);
      $('#toTop').classList.toggle('on', scrollY > 800);
    }, { passive: true });
    $('#toTop').addEventListener('click', () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

    // reveal + counters
    if ('IntersectionObserver' in window && !reduceMotion) {
      const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.01, rootMargin: '0px 0px -40px 0px' });
      $$('.reveal').forEach((n) => io.observe(n));
      const co = new IntersectionObserver((es) => es.forEach((en) => {
        if (!en.isIntersecting) return; co.unobserve(en.target);
        const n = +en.target.dataset.n, suf = en.target.dataset.suffix, t0 = performance.now();
        (function f(t) { const p = Math.min(1, (t - t0) / 1500); en.target.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))).toLocaleString('en-US') + suf; if (p < 1) requestAnimationFrame(f); })(t0);
      }), { threshold: 0.5 });
      $$('[data-n]').forEach((n) => co.observe(n));
    } else $$('.reveal').forEach((n) => n.classList.add('in'));

    // "Learn more" on a programme pre-fills the contact form
    $('#progs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-topic]'); if (!b) return;
      $('#c_subject').value = 'Partnership';
      const m = $('#c_message'); if (!m.value) m.value = `I would like to learn more about MEO's ${b.dataset.topic} programme.`;
    });

    // donate pop-up
    const modal = $('#modal');
    let lastFocus = null;
    const openModal = () => { lastFocus = document.activeElement; closeNav(); modal.classList.add('on'); $('#p_name').focus(); };
    const closeModal = () => { modal.classList.remove('on'); if (lastFocus) lastFocus.focus(); };
    $$('[data-donate]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openModal(); }));
    $('#mclose').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('on')) closeModal(); });
    let amount = c.donate.amounts[1] || c.donate.amounts[0];
    $('#amts').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-amount]'); if (!b) return;
      $$('#amts button').forEach((x) => x.classList.toggle('on', x === b));
      amount = +b.dataset.amount; $('#amts input').value = '';
    });
    $('#amts input').addEventListener('input', (e) => { $$('#amts button').forEach((x) => x.classList.remove('on')); amount = +e.target.value || 0; });

    // forms
    wireForm($('#contactForm'), '/api/contact', (f) => ({
      name: f.name.value, email: f.email.value, phone: f.phone.value, subject: f.subject.value, message: f.message.value, website: f.website.value
    }), (r, f) => { f.reset(); return r.message; });

    wireForm($('#newsForm'), '/api/subscribe', (f) => ({ email: f.email.value, website: f.website.value }),
      (r, f) => { f.reset(); return r.message; }, $('#newsStatus'));

    wireForm($('#pledgeForm'), '/api/pledge', (f) => ({
      name: f.name.value, phone: f.phone.value, email: f.email.value, programme: f.programme.value,
      amount, currency: c.donate.currency, website: f.website.value
    }), (r) => {
      const ref = $('#pRef');
      ref.textContent = `Your reference: ${r.reference}. ${money(amount, c.donate.currency)} by bank transfer to the account below.`;
      ref.style.display = 'block';
      return r.message;
    });
  }

  // Generic form handler: client checks, POST, field errors from the server.
  function wireForm(form, path, collect, onOk, statusEl) {
    const status = statusEl || $('.status', form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $$('.fld', form).forEach((f) => { f.classList.remove('err'); const m = $('.msg', f); if (m) m.textContent = ''; });
      status.className = 'status'; status.textContent = '';
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        const res = await postJSON(path, collect(form));
        status.className = 'status ok'; status.textContent = onOk(res, form) || 'Thank you!';
        toast(status.textContent);
      } catch (err) {
        if (err.status === undefined || err.status === 404 || err.status === 405) {
          // No server (static hosting or a single HTML file): send the same details by email instead.
          const data = collect(form); delete data.website;
          const missing = $$('[required]', form).filter((i) => !i.value.trim());
          if (missing.length) {
            missing.forEach((i) => { const f = i.closest('.fld'); if (f) { f.classList.add('err'); const m = $('.msg', f); if (m) m.textContent = 'Please fill this in.'; } });
            status.className = 'status bad'; status.textContent = 'Please fill in the required fields.';
          } else {
            const subj = { '/api/contact': 'Website message: ' + (data.subject || ''), '/api/subscribe': 'Newsletter subscription', '/api/pledge': 'Donation pledge' }[path];
            const body = Object.entries(data).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)}: ${k === 'amount' ? money(v) : v}`).join('\n');
            location.href = 'mailto:info@meo.or.tz?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
            status.className = 'status ok'; status.textContent = 'Opening your email app with your details. Just press Send.';
          }
        } else {
          status.className = 'status bad'; status.textContent = err.message;
          for (const name of Object.keys(err.fields || {})) {
            const input = form.elements[name]; const fld = input && input.closest('.fld');
            if (fld) { fld.classList.add('err'); const m = $('.msg', fld); if (m) m.textContent = 'Please check this field.'; }
          }
        }
      } finally { btn.disabled = false; }
    });
  }

  // ---------- start ----------
  async function loadContent() {
    if (window.MEO_CONTENT) return window.MEO_CONTENT;   // single-file build has the content built in
    for (const url of [API + '/api/content', 'content.json']) {
      try { const r = await fetch(url, { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch (_) { /* try next */ }
    }
    throw new Error('content unavailable');
  }

  loadContent().then((c) => { render(c); wireUp(c); })
    .catch(() => { $('#loading').textContent = 'Sorry, the site could not load. Please refresh, or email info@meo.or.tz.'; });
})();
