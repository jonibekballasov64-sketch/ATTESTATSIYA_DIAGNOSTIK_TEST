const path = require('path');
const express = require('express');
const { pool } = require('../db');
const { validateInitData } = require('../utils/validateInitData');
const { computeScore, tierMessage } = require('../utils/scoring');
const { BOT_TOKEN, ADMIN_ID, TEST_DURATION_MIN, MAX_ATTEMPTS, PUBLIC_URL } = require('../config');

function createApp(bot) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  function auth(req, res, next) {
    const initData = req.body.initData || req.query.initData;
    const user = initData ? validateInitData(initData, BOT_TOKEN) : null;
    if (!user) return res.status(401).json({ error: 'auth_failed' });
    req.tgUser = user;
    next();
  }

  app.post('/api/attempt/start', auth, async (req, res) => {
    const { code, fullName, toifa } = req.body;
    if (!code || !fullName || !toifa) return res.status(400).json({ error: 'missing_fields' });
    const testR = await pool.query('SELECT * FROM tests WHERE code=$1', [code.toUpperCase().trim()]);
    if (testR.rowCount === 0) return res.status(404).json({ error: 'test_not_found' });
    const test = testR.rows[0];

    const countR = await pool.query(
      'SELECT COUNT(*)::int AS c FROM attempts WHERE test_id=$1 AND telegram_user_id=$2',
      [test.id, req.tgUser.id]
    );
    if (countR.rows[0].c >= MAX_ATTEMPTS) {
      return res.status(403).json({ error: 'max_attempts_reached' });
    }
    const attemptNumber = countR.rows[0].c + 1;
    const expiresAt = new Date(Date.now() + TEST_DURATION_MIN * 60 * 1000);

    const insR = await pool.query(
      `INSERT INTO attempts (test_id, telegram_user_id, full_name, toifa_target, attempt_number, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, expires_at`,
      [test.id, req.tgUser.id, fullName.trim(), toifa, attemptNumber, expiresAt]
    );
    res.json({
      attemptId: insR.rows[0].id,
      expiresAt: insR.rows[0].expires_at,
      attemptNumber,
      totalQuestions: test.questions.length,
    });
  });

  app.get('/api/attempt/:id', async (req, res) => {
    const initData = req.query.initData;
    const user = initData ? validateInitData(initData, BOT_TOKEN) : null;
    if (!user) return res.status(401).json({ error: 'auth_failed' });

    const r = await pool.query(
      `SELECT a.*, t.questions, t.text_a, t.text_b, t.title
       FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id=$1`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    const a = r.rows[0];
    if (a.telegram_user_id !== user.id && user.id !== ADMIN_ID) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const publicQuestions = a.questions.map(q => ({
      number: q.number,
      html: q.html,
      options: q.options.map(o => ({ letter: o.letter, html: o.html })),
    }));
    res.json({
      id: a.id,
      title: a.title,
      status: a.status,
      expiresAt: a.expires_at,
      score: a.score,
      answers: a.answers,
      textA: a.text_a,
      textB: a.text_b,
      questions: publicQuestions,
    });
  });

  app.post('/api/attempt/:id/answer', auth, async (req, res) => {
    const { questionNumber, selectedLetter } = req.body;
    const r = await pool.query('SELECT * FROM attempts WHERE id=$1', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    const a = r.rows[0];
    if (a.telegram_user_id !== req.tgUser.id) return res.status(403).json({ error: 'forbidden' });
    if (a.status !== 'in_progress') return res.status(400).json({ error: 'already_finished' });
    if (new Date(a.expires_at) < new Date()) return res.status(400).json({ error: 'expired' });

    await pool.query(
      `UPDATE attempts SET answers = jsonb_set(answers, ARRAY[$1::text], to_jsonb($2::text)) WHERE id=$3`,
      [String(questionNumber), selectedLetter, req.params.id]
    );
    res.json({ ok: true });
  });

  async function finishAttempt(attemptId, botTelegram) {
    const r = await pool.query(
      `SELECT a.*, t.questions, t.title FROM attempts a JOIN tests t ON t.id=a.test_id WHERE a.id=$1`,
      [attemptId]
    );
    if (r.rowCount === 0) return null;
    const a = r.rows[0];
    if (a.status === 'finished') return a;
    const score = computeScore({ questions: a.questions }, a.answers);
    await pool.query(
      `UPDATE attempts SET status='finished', finished_at=NOW(), score=$1 WHERE id=$2`,
      [score, attemptId]
    );
    const tier = tierMessage(score);
    if (botTelegram) {
      const officialTag = a.attempt_number === 1 ? "Rasmiy natija (1-urinish)" : `${a.attempt_number}-urinish (qo'shimcha)`;
      botTelegram.sendMessage(
        ADMIN_ID,
        `📊 Yangi natija!\n\n👤 ${a.full_name}\n📌 ${a.title}\n🎯 Toifa: ${a.toifa_target}\n🏅 Ball: ${score}/100\n${officialTag}`,
        { reply_markup: { inline_keyboard: [[{ text: "📊 Tahlil va javoblarni ko'rish", web_app: { url: `${PUBLIC_URL}/?screen=review&attempt=${attemptId}` } }]] } }
      ).catch(() => {});
      botTelegram.sendMessage(
        a.telegram_user_id,
        `✅ Test yakunlandi!\n\n🏅 Natija: ${score}/100 ball\n${tier.text}`,
        { reply_markup: { inline_keyboard: [[{ text: "📊 Tahlil va javoblarni ko'rish", web_app: { url: `${PUBLIC_URL}/?screen=review&attempt=${attemptId}` } }]] } }
      ).catch(() => {});
    }
    return { ...a, status: 'finished', score };
  }

  app.post('/api/attempt/:id/finish', auth, async (req, res) => {
    const r = await pool.query('SELECT * FROM attempts WHERE id=$1', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    if (r.rows[0].telegram_user_id !== req.tgUser.id) return res.status(403).json({ error: 'forbidden' });
    const a = await finishAttempt(req.params.id, bot.telegram);
    const tier = tierMessage(a.score);
    res.json({ score: a.score, tierText: tier.text });
  });

  app.get('/api/attempt/:id/review', async (req, res) => {
    const initData = req.query.initData;
    const user = initData ? validateInitData(initData, BOT_TOKEN) : null;
    if (!user) return res.status(401).json({ error: 'auth_failed' });
    const r = await pool.query(
      `SELECT a.*, t.questions, t.text_a, t.text_b, t.title FROM attempts a JOIN tests t ON t.id=a.test_id WHERE a.id=$1`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    const a = r.rows[0];
    if (a.telegram_user_id !== user.id && user.id !== ADMIN_ID) return res.status(403).json({ error: 'forbidden' });
    if (a.status !== 'finished') return res.status(400).json({ error: 'not_finished' });
    res.json({
      title: a.title,
      score: a.score,
      fullName: a.full_name,
      textA: a.text_a,
      textB: a.text_b,
      questions: a.questions.map(q => ({
        number: q.number,
        html: q.html,
        options: q.options,
        correctLetter: q.correctLetter,
        explanationHtml: q.explanationHtml,
        selectedLetter: a.answers[String(q.number)] || null,
      })),
    });
  });

  setInterval(async () => {
    try {
      const r = await pool.query(`SELECT id FROM attempts WHERE status='in_progress' AND expires_at < NOW()`);
      for (const row of r.rows) {
        await finishAttempt(row.id, bot.telegram);
      }
    } catch (e) {
      console.error('auto-finish error', e);
    }
  }, 60 * 1000);

  return app;
}

module.exports = { createApp };
