const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const initData = tg.initData;
const app = document.getElementById('app');
const params = new URLSearchParams(window.location.search);

let state = {
  attemptId: null,
  expiresAt: null,
  questions: [],
  textA: null,
  textB: null,
  currentIndex: 0,
  answers: {},
  timerInterval: null,
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify({ ...body, initData });
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'error');
  return data;
}

function renderRegister() {
  app.innerHTML = '';
  const wrap = el('div', 'screen register');
  wrap.appendChild(el('h2', '', "Attestatsiya testi"));

  const nameInput = el('input', 'field');
  nameInput.placeholder = 'Ism Familiya';

  const codeInput = el('input', 'field');
  codeInput.placeholder = 'Test kodi';
  codeInput.value = params.get('code') || '';

  const toifaWrap = el('div', 'toifa-select');
  let selectedToifa = null;
  ['2-toifa', '1-toifa', 'Oliy toifa'].forEach(t => {
    const btn = el('button', 'toifa-btn', t);
    btn.onclick = () => {
      [...toifaWrap.children].forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      selectedToifa = t;
    };
    toifaWrap.appendChild(btn);
  });

  const reminder = el('div', 'reminder',
    "⏰ Sizga 105 daqiqa vaqt beriladi va vaqtni to'xtatib bo'lmaydi.<br>🔁 Testni 2 marta ishlash mumkin.<br>📌 1-urinish Nargiza Ustozga ko'rinadi va sizning haqiqiy natijangiz hisoblanadi."
  );

  const startBtn = el('button', 'primary-btn', "Testni boshlash");
  startBtn.onclick = async () => {
    const fullName = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!fullName || !code || !selectedToifa) {
      tg.showAlert("Barcha maydonlarni to'ldiring va toifani tanlang.");
      return;
    }
    try {
      startBtn.disabled = true;
      const data = await api('/api/attempt/start', 'POST', { code, fullName, toifa: selectedToifa });
      state.attemptId = data.attemptId;
      state.expiresAt = data.expiresAt;
      await loadAttempt();
      renderTest();
    } catch (e) {
      startBtn.disabled = false;
      if (e.message === 'test_not_found') tg.showAlert('Bunday kodli test topilmadi.');
      else if (e.message === 'max_attempts_reached') tg.showAlert("Siz bu testni 2 marta ishlab bo'ldingiz.");
      else tg.showAlert('Xatolik yuz berdi: ' + e.message);
    }
  };

  wrap.appendChild(nameInput);
  wrap.appendChild(codeInput);
  wrap.appendChild(toifaWrap);
  wrap.appendChild(reminder);
  wrap.appendChild(startBtn);
  app.appendChild(wrap);
}

async function loadAttempt() {
  const data = await api(`/api/attempt/${state.attemptId}?initData=${encodeURIComponent(initData)}`);
  state.questions = data.questions;
  state.textA = data.textA;
  state.textB = data.textB;
  state.answers = data.answers || {};
  state.expiresAt = data.expiresAt;
  state.status = data.status;
  state.score = data.score;
}

function textForQuestion(num) {
  if (state.textA && num >= state.textA.range[0] && num <= state.textA.range[1]) return state.textA.html;
  if (state.textB && num >= state.textB.range[0] && num <= state.textB.range[1]) return state.textB.html;
  return null;
}

function renderTest() {
  clearInterval(state.timerInterval);
  app.innerHTML = '';
  const wrap = el('div', 'screen test');

  const topBar = el('div', 'top-bar');
  const timerEl = el('div', 'timer', '');
  const finishBtn = el('button', 'finish-btn-small', 'Yakunlash');
  finishBtn.onclick = () => {
    tg.showConfirm("Testni yakunlashni tasdiqlaysizmi?", async (ok) => {
      if (ok) await doFinish();
    });
  };
  topBar.appendChild(timerEl);
  topBar.appendChild(finishBtn);
  wrap.appendChild(topBar);

  const progress = el('div', 'progress', '');
  wrap.appendChild(progress);

  const textBox = el('div', 'text-box');
  wrap.appendChild(textBox);

  const qBox = el('div', 'question-box');
  wrap.appendChild(qBox);

  const navBar = el('div', 'nav-bar');
  const prevBtn = el('button', 'nav-btn', "⬅ Oldingi");
  const nextBtn = el('button', 'nav-btn', "Keyingi ➡");
  navBar.appendChild(prevBtn);
  navBar.appendChild(nextBtn);
  wrap.appendChild(navBar);

  app.appendChild(wrap);

  function renderQuestion() {
    const q = state.questions[state.currentIndex];
    progress.textContent = `Savol ${q.number}/${state.questions.length}`;
    const t = textForQuestion(q.number);
    textBox.style.display = t ? 'block' : 'none';
    textBox.innerHTML = t || '';

    qBox.innerHTML = '';
    qBox.appendChild(el('div', 'q-text', q.html));
    const selected = state.answers[String(q.number)];
    q.options.forEach(o => {
      const optBtn = el('button', 'opt-btn' + (selected === o.letter ? ' selected' : ''), `<b>${o.letter})</b> ${o.html}`);
      optBtn.onclick = async () => {
        state.answers[String(q.number)] = o.letter;
        [...qBox.querySelectorAll('.opt-btn')].forEach(b => b.classList.remove('selected'));
        optBtn.classList.add('selected');
        try {
          await api(`/api/attempt/${state.attemptId}/answer`, 'POST', { questionNumber: q.number, selectedLetter: o.letter });
        } catch (e) {}
      };
      qBox.appendChild(optBtn);
    });

    prevBtn.disabled = state.currentIndex === 0;
    nextBtn.disabled = state.currentIndex === state.questions.length - 1;
  }

  prevBtn.onclick = () => { state.currentIndex--; renderQuestion(); };
  nextBtn.onclick = () => { state.currentIndex++; renderQuestion(); };

  renderQuestion();

  function updateTimer() {
    const remaining = new Date(state.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      timerEl.textContent = "00:00";
      clearInterval(state.timerInterval);
      doFinish();
      return;
    }
    const totalSec = Math.floor(remaining / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    timerEl.textContent = `⏱ ${mm}:${ss}`;
  }
  updateTimer();
  state.timerInterval = setInterval(updateTimer, 1000);
}

async function doFinish() {
  clearInterval(state.timerInterval);
  try {
    const res = await api(`/api/attempt/${state.attemptId}/finish`, 'POST');
    renderResult(res.score, res.tierText);
  } catch (e) {
    tg.showAlert('Xatolik: ' + e.message);
  }
}

function renderResult(score, tierText) {
  app.innerHTML = '';
  const wrap = el('div', 'screen result');
  wrap.appendChild(el('h2', '', 'Test yakunlandi'));
  wrap.appendChild(el('div', 'score', `${score}/100`));
  wrap.appendChild(el('div', 'tier-text', tierText));
  const reviewBtn = el('button', 'primary-btn', "📊 Tahlil va javoblarni ko'rish");
  reviewBtn.onclick = () => renderReview(state.attemptId);
  wrap.appendChild(reviewBtn);
  app.appendChild(wrap);
}

async function renderReview(attemptId) {
  app.innerHTML = '<div class="screen"><p>Yuklanmoqda...</p></div>';
  try {
    const data = await api(`/api/attempt/${attemptId}/review?initData=${encodeURIComponent(initData)}`);
    app.innerHTML = '';
    const wrap = el('div', 'screen review');
    wrap.appendChild(el('h2', '', `${data.title} — ${data.score}/100`));
    data.questions.forEach(q => {
      const qWrap = el('div', 'review-q');
      const t = (data.textA && q.number >= data.textA.range[0] && q.number <= data.textA.range[1]) ? data.textA.html
              : (data.textB && q.number >= data.textB.range[0] && q.number <= data.textB.range[1]) ? data.textB.html
              : null;
      if (t) qWrap.appendChild(el('div', 'text-box', t));
      qWrap.appendChild(el('div', 'q-text', `<b>${q.number}.</b> ${q.html}`));
      q.options.forEach(o => {
        let cls = 'opt-btn review';
        if (o.letter === q.correctLetter) cls += ' correct';
        else if (o.letter === q.selectedLetter) cls += ' wrong';
        qWrap.appendChild(el('div', cls, `<b>${o.letter})</b> ${o.html}`));
      });
      qWrap.appendChild(el('div', 'answer-line', `✅ Javob: <b>${q.correctLetter}</b>`));
      if (q.explanationHtml) {
        qWrap.appendChild(el('div', 'explain-line', `⚠️ Izoh: ${q.explanationHtml}`));
      }
      wrap.appendChild(qWrap);
    });
    app.appendChild(wrap);
  } catch (e) {
    app.innerHTML = `<div class="screen"><p>Xatolik: ${e.message}</p></div>`;
  }
}

(async function init() {
  const screen = params.get('screen');
  const attemptParam = params.get('attempt');
  if (screen === 'review' && attemptParam) {
    renderReview(attemptParam);
  } else {
    renderRegister();
  }
})();
