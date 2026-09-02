/* web/sindie.js — Sindie, the ImbizoHub help widget.
 *
 * ONE FILE, FOUR PAGES. Every marketing page includes this with a single
 * <script src="/sindie.js" defer></script>. It injects its own styles and
 * markup, so adding it to a new page is one line and the answers below
 * only ever exist in one place. scripts/assemble-web.js copies the whole
 * web/ folder into dist/, so it deploys with no config change.
 *
 * WHAT SINDIE IS, AND DELIBERATELY IS NOT.
 *
 * She is a named helper who searches a fixed set of answers and passes a
 * message to a real person. She is NOT a chatbot. There is no model behind
 * her, and the copy never implies there is: she says "I'll find it" and
 * "I'll pass it on", never "ask me anything".
 *
 * That restraint is the whole design. A widget with a face and a name that
 * cannot actually converse is worse than a plain Help link — someone types
 * a real question, gets a canned link, and concludes the product is thin.
 * The same reasoning is why there is no "Messages" tab: threaded replies
 * only work if somebody is staffing an inbox, and promising a reply you
 * cannot reliably give costs more trust than never offering one.
 *
 * The message form posts to /api/contact — the SAME endpoint the /contact
 * page already uses, including its honeypot and too-fast-submission
 * checks. contact_messages had zero rows before this existed: the form was
 * never broken, it was buried on a page nobody visits. This puts the same
 * inbox on every page.
 */
(function () {
  'use strict';

  if (window.__sindieLoaded) return;
  window.__sindieLoaded = true;

  /* ---------------------------------------------------------------
   * The answers.
   *
   * Written to settle the questions that actually stop someone using a
   * marketplace they have not heard of: what does it cost, who takes the
   * money, and what stops me being robbed. `k` is extra search keywords —
   * words people type that do not appear in the question itself.
   * ------------------------------------------------------------- */
  var FAQ = [
    {
      q: 'What does ImbizoHub cost?',
      k: 'free fee fees price charge commission percent cheap',
      a: 'Listing is free. Chatting is free. Doing a deal on a listing is free — permanently, not as a promotion.\n\nWe only earn when we find you what you asked for: 5% when you accept a seller\'s response to a Wanted post (at least $1.50, never more than $15), and 7% when you accept a transport quote (never more than $15).\n\nAnd during our launch promotion, even those are free for everyone until 31 January 2027.'
    },
    {
      q: 'What is a Wanted post?',
      k: 'wanted request ask looking for want post buyers reverse',
      a: 'It is the opposite of scrolling through listings. You post what you need — a fridge, school shoes, a specific phone — and sellers come to you with their price.\n\nYou compare the offers, chat to anyone you like, and pick one. Posting and chatting cost nothing.'
    },
    {
      q: 'Who pays the fee — the buyer or the seller?',
      k: 'fee who pays seller buyer commission keep 100 percent',
      a: 'The buyer. Sellers and transport operators keep 100% of the price they quote.\n\nResponding to a Wanted post costs a seller nothing at all, whether or not they win it.'
    },
    {
      q: 'What is Meet & Pay?',
      k: 'meet pay pin safe safety scam robbed trust handover confirm',
      a: 'It is how a deal is closed in person without either side having to simply trust the other.\n\nYou agree to meet. Each side gets a PIN. The item is inspected before any money changes hands, both people confirm the deal is done, and only then does it close and the rating open.\n\nWe never hold your money — you pay the seller directly.'
    },
    {
      q: 'Is it safe to meet someone from the app?',
      k: 'safe safety scam fraud stranger meet careful police report',
      a: 'Meet in a public place during the day, and take someone with you if the item is valuable. Inspect it properly before you hand over any money — that is exactly what Meet & Pay is built around.\n\nYou can report any user from their profile, and sellers can verify their identity with a national ID to earn a badge you can see before you agree to anything.'
    },
    {
      q: 'How does hiring transport work?',
      k: 'transport van truck move moving delivery driver operator trip quote hire',
      a: 'Post your trip — where from, where to, what you are moving and when. Registered operators bid for the job with their own price.\n\nCompare the quotes, chat to whoever you like, and pick your driver. Both of you confirm once the trip is finished.\n\nOur operators drive vans, so anything up to a van load, or a group of up to eight people.'
    },
    {
      q: 'Do I need an account to look around?',
      k: 'account sign up register login browse look free anonymous',
      a: 'No. You can browse listings, read Wanted posts and see how everything works without an account.\n\nYou only need one when you want your conversations and posts kept somewhere you can come back to.'
    },
    {
      q: 'How do I delete my account?',
      k: 'delete account remove close data privacy gdpr erase',
      a: 'Open the app, go to Profile, and choose Delete my account. It is a real deletion, not a hidden deactivation.\n\nIf you cannot reach the screen for any reason, send us a message here and we will handle it for you.'
    },
    {
      q: 'Something is not working',
      k: 'bug broken error crash problem stuck help wrong fault',
      a: 'Tell us what you were doing and what happened — the screen you were on and roughly when is usually enough for us to find it.\n\nUse "Send us a message" below and it comes straight to us.'
    }
  ];

  var CSS = [
    '.sd-launch{position:fixed;right:20px;bottom:20px;z-index:9998;display:flex;align-items:center;gap:9px;',
      'background:#8A6608;color:#fff;border:0;border-radius:999px;padding:13px 19px;cursor:pointer;',
      'font:700 15px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'box-shadow:0 8px 26px -8px rgba(60,50,20,.35)}',
    '.sd-launch:hover{background:#6E5106}',
    '.sd-launch:focus-visible{outline:2px solid #1A1A18;outline-offset:3px}',
    '.sd-launch .sd-dot{width:9px;height:9px;border-radius:50%;background:#fff;opacity:.7}',
    '.sd-panel{position:fixed;right:20px;bottom:20px;z-index:9999;width:min(380px,calc(100vw - 32px));',
      'max-height:min(620px,calc(100vh - 40px));display:none;flex-direction:column;overflow:hidden;',
      'background:#FFFFFF;border:1px solid #E4DCCB;border-radius:18px;',
      'box-shadow:0 24px 60px -18px rgba(60,50,20,.28);',
      'font:400 15px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1A1A18}',
    '.sd-panel.sd-open{display:flex}',
    '.sd-head{background:#F4EFE3;padding:20px 20px 18px;border-bottom:1px solid #E4DCCB;flex:0 0 auto}',
    '.sd-head-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}',
    '.sd-who{display:flex;align-items:center;gap:10px}',
    '.sd-av{width:34px;height:34px;border-radius:50%;background:#8A6608;color:#fff;',
      'display:grid;place-items:center;font-weight:800;font-size:14px;flex:0 0 auto}',
    '.sd-name{font-weight:800;font-size:15px;line-height:1.2}',
    '.sd-role{font-size:12px;color:#7C7566;line-height:1.3}',
    '.sd-x{background:0;border:0;color:#7C7566;font-size:22px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:6px}',
    '.sd-x:hover{color:#1A1A18}',
    '.sd-x:focus-visible{outline:2px solid #8A6608;outline-offset:2px}',
    '.sd-greet{font-size:19px;font-weight:800;letter-spacing:-.01em;margin:0 0 4px}',
    '.sd-greet-sub{font-size:13.5px;color:#7C7566;margin:0}',
    '.sd-body{padding:16px 20px 20px;overflow-y:auto;flex:1 1 auto;-webkit-overflow-scrolling:touch}',
    '.sd-search{width:100%;box-sizing:border-box;background:#F4EFE3;border:1px solid #E4DCCB;border-radius:11px;',
      'padding:12px 14px;color:#1A1A18;font:inherit;font-size:14.5px;margin-bottom:6px}',
    '.sd-search::placeholder{color:#8C8474}',
    '.sd-search:focus{outline:0;border-color:#8A6608}',
    '.sd-list{list-style:none;margin:0;padding:0}',
    '.sd-item{border-bottom:1px solid #EFE8DA}',
    '.sd-q{width:100%;text-align:left;background:0;border:0;color:#1A1A18;font:inherit;font-size:14.5px;',
      'padding:13px 26px 13px 0;cursor:pointer;position:relative}',
    '.sd-q:hover{color:#8A6608}',
    '.sd-q:focus-visible{outline:2px solid #8A6608;outline-offset:-2px;border-radius:4px}',
    '.sd-q::after{content:"\\203A";position:absolute;right:6px;top:50%;transform:translateY(-50%);color:#8C8474;font-size:19px}',
    '.sd-item.sd-on .sd-q::after{content:"\\2039";transform:translateY(-50%) rotate(90deg)}',
    '.sd-a{display:none;color:#5C574B;font-size:14px;line-height:1.65;padding:0 4px 15px;white-space:pre-line}',
    '.sd-item.sd-on .sd-a{display:block}',
    '.sd-none{color:#7C7566;font-size:14px;padding:16px 0 4px}',
    '.sd-foot{flex:0 0 auto;border-top:1px solid #E4DCCB;padding:14px 20px 16px;background:#F4EFE3}',
    '.sd-cta{width:100%;box-sizing:border-box;background:#8A6608;color:#fff;border:0;border-radius:11px;',
      'padding:13px;font:800 14.5px/1 Inter,sans-serif;cursor:pointer}',
    '.sd-cta:hover{background:#6E5106}',
    '.sd-cta:focus-visible{outline:2px solid #1A1A18;outline-offset:2px}',
    '.sd-back{background:0;border:0;color:#7C7566;font:inherit;font-size:13.5px;cursor:pointer;padding:0 0 12px}',
    '.sd-back:hover{color:#1A1A18}',
    '.sd-field{display:block;font-size:12.5px;font-weight:700;color:#1A1A18;margin:12px 0 6px}',
    '.sd-in{width:100%;box-sizing:border-box;background:#FFFFFF;border:1px solid #D8CFBC;border-radius:10px;',
      'padding:11px 13px;color:#1A1A18;font:inherit;font-size:14.5px}',
    '.sd-in:focus{outline:0;border-color:#8A6608}',
    '.sd-in::placeholder{color:#8C8474}',
    'textarea.sd-in{min-height:96px;resize:vertical}',
    '.sd-msg{font-size:13.5px;margin-top:12px;line-height:1.55}',
    '.sd-msg.sd-err{color:#B03030}',
    '.sd-msg.sd-ok{color:#1F7A46}',
    '.sd-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
    '@media(max-width:480px){.sd-panel{right:8px;left:8px;bottom:8px;width:auto;max-height:calc(100vh - 16px)}',
      '.sd-launch{right:14px;bottom:14px}}',
    '@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}'
  ].join('');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build() {
    var style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // ---- launcher -------------------------------------------------
    var launch = el('button', 'sd-launch');
    launch.type = 'button';
    launch.setAttribute('aria-label', 'Open help');
    launch.appendChild(el('span', 'sd-dot'));
    launch.appendChild(el('span', null, 'Ask Sindie'));

    // ---- panel ----------------------------------------------------
    var panel = el('div', 'sd-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Help');

    var head = el('div', 'sd-head');
    var top = el('div', 'sd-head-top');
    var who = el('div', 'sd-who');
    var av = el('div', 'sd-av', 'S');
    var whoText = el('div');
    whoText.appendChild(el('div', 'sd-name', 'Sindie'));
    // Says plainly what she is. She finds answers and passes messages on
    // — no claim to be an AI, because she is not one.
    whoText.appendChild(el('div', 'sd-role', 'ImbizoHub help'));
    who.appendChild(av); who.appendChild(whoText);
    var close = el('button', 'sd-x', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close help');
    top.appendChild(who); top.appendChild(close);
    head.appendChild(top);
    head.appendChild(el('p', 'sd-greet', 'Hi 👋 I’m Sindie.'));
    head.appendChild(el('p', 'sd-greet-sub', 'Search below, or send us a message and a person will reply.'));
    panel.appendChild(head);

    var body = el('div', 'sd-body');
    panel.appendChild(body);
    var foot = el('div', 'sd-foot');
    panel.appendChild(foot);

    document.body.appendChild(launch);
    document.body.appendChild(panel);

    // ---- help view ------------------------------------------------
    function renderHelp(filter) {
      body.innerHTML = '';
      foot.innerHTML = '';

      var search = el('input', 'sd-search');
      search.type = 'search';
      search.placeholder = 'What do you need help with?';
      search.setAttribute('aria-label', 'Search help');
      search.value = filter || '';
      body.appendChild(search);

      var q = (filter || '').trim().toLowerCase();
      var hits = !q ? FAQ : FAQ.filter(function (f) {
        return (f.q + ' ' + f.k + ' ' + f.a).toLowerCase().indexOf(q) !== -1;
      });

      if (!hits.length) {
        var none = el('p', 'sd-none',
          'Nothing here matches that. Send us a message below and we’ll answer you directly.');
        body.appendChild(none);
      } else {
        var list = el('ul', 'sd-list');
        hits.forEach(function (f) {
          var li = el('li', 'sd-item');
          var btn = el('button', 'sd-q', f.q);
          btn.type = 'button';
          btn.setAttribute('aria-expanded', 'false');
          var ans = el('div', 'sd-a', f.a);
          btn.addEventListener('click', function () {
            var open = li.classList.toggle('sd-on');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          });
          li.appendChild(btn); li.appendChild(ans);
          list.appendChild(li);
        });
        body.appendChild(list);
      }

      // Debounced only by how little work this is — nine items, no network.
      search.addEventListener('input', function () {
        var v = search.value;
        var pos = search.selectionStart;
        renderHelp(v);
        var next = body.querySelector('.sd-search');
        if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (e) {} }
      });

      var cta = el('button', 'sd-cta', 'Send us a message');
      cta.type = 'button';
      cta.addEventListener('click', renderForm);
      foot.appendChild(cta);
    }

    // ---- message view ---------------------------------------------
    function renderForm() {
      body.innerHTML = '';
      foot.innerHTML = '';

      var back = el('button', 'sd-back', '‹ Back to help');
      back.type = 'button';
      back.addEventListener('click', function () { renderHelp(''); });
      body.appendChild(back);

      var form = el('form');
      form.noValidate = true;

      function field(label, name, type, placeholder, area) {
        var l = el('label', 'sd-field', label);
        l.setAttribute('for', 'sd-' + name);
        var i = el(area ? 'textarea' : 'input', 'sd-in');
        i.id = 'sd-' + name; i.name = name;
        if (!area) i.type = type;
        i.placeholder = placeholder;
        form.appendChild(l); form.appendChild(i);
        return i;
      }

      var name = field('Your name', 'name', 'text', 'So we know who we’re replying to');
      var email = field('Email', 'email', 'email', 'Where we should reply');

      // MUST match TOPICS in api/contact.js exactly. Anything not on that
      // list is silently rewritten to 'General question' server-side — so
      // an invented value like "Help widget" would look accepted here and
      // arrive mislabelled, with nothing to show it had been changed.
      var topicLabel = el('label', 'sd-field', 'What is it about?');
      topicLabel.setAttribute('for', 'sd-topic');
      var topic = el('select', 'sd-in');
      topic.id = 'sd-topic'; topic.name = 'topic';
      ['General question', 'Problem with the app', 'Seller / operator help',
       'Payments', 'Report abuse', 'Business enquiry'].forEach(function (t) {
        var o = el('option', null, t); o.value = t; topic.appendChild(o);
      });
      form.appendChild(topicLabel); form.appendChild(topic);

      var message = field('How can we help?', 'message', null, 'Tell us what happened, and which screen you were on', true);

      // Same honeypot the /contact page uses. Kept identical so the server
      // side needs no special case for messages arriving from here.
      var hpWrap = el('div', 'sd-hp');
      hpWrap.setAttribute('aria-hidden', 'true');
      var hp = el('input');
      hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off';
      hpWrap.appendChild(hp);
      form.appendChild(hpWrap);

      var out = el('div', 'sd-msg');
      out.setAttribute('role', 'status');
      out.setAttribute('aria-live', 'polite');
      form.appendChild(out);
      body.appendChild(form);

      var send = el('button', 'sd-cta', 'Send message');
      send.type = 'button';
      foot.appendChild(send);

      var started = Date.now();

      function fail(t) { out.className = 'sd-msg sd-err'; out.textContent = t; }

      send.addEventListener('click', async function () {
        out.className = 'sd-msg'; out.textContent = '';
        if (!name.value.trim()) return fail('Please tell us your name.');
        if (!email.value.trim()) return fail('Please give us an email address so we can reply.');
        if (message.value.trim().length < 10) {
          return fail('Please write a little more so we can help properly.');
        }

        send.disabled = true;
        send.textContent = 'Sending…';
        try {
          var r = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name.value,
              email: email.value,
              phone: '',
              topic: topic.value,
              message: message.value,
              website: hp.value,
              started: started
            })
          });
          var j = await r.json().catch(function () { return {}; });
          if (r.ok && j.ok) {
            body.innerHTML = '';
            foot.innerHTML = '';
            var ok = el('p', 'sd-msg sd-ok', 'Thank you — your message has reached us.');
            var sub = el('p', 'sd-none', 'We’ll reply to ' + email.value.trim() + '. A person reads every one of these.');
            body.appendChild(ok); body.appendChild(sub);
            var done = el('button', 'sd-cta', 'Back to help');
            done.type = 'button';
            done.addEventListener('click', function () { renderHelp(''); });
            foot.appendChild(done);
            return;
          }
          fail(j.error || 'Something went wrong. Please try again.');
        } catch (e) {
          fail('Could not send just now — please check your connection and try again.');
        }
        send.disabled = false;
        send.textContent = 'Send message';
      });

      name.focus();
    }

    // ---- open / close ---------------------------------------------
    function open() {
      renderHelp('');
      panel.classList.add('sd-open');
      launch.style.display = 'none';
      var s = body.querySelector('.sd-search');
      if (s) s.focus();
    }
    function shut() {
      panel.classList.remove('sd-open');
      launch.style.display = '';
      launch.focus();
    }

    launch.addEventListener('click', open);
    close.addEventListener('click', shut);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('sd-open')) shut();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
