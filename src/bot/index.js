const { Telegraf, Markup } = require('telegraf');
const { BOT_TOKEN, ADMIN_ID, GROUP_ID, PUBLIC_URL } = require('../config');
const { pool } = require('../db');
const { messageToHtml } = require('../utils/entities');
const { generateTestCode } = require('../utils/codeGen');
const { parseTest, parseEditMessage } = require('../parser/parseTest');

const bot = new Telegraf(BOT_TOKEN);
const creationSessions = new Map();
const editSessions = new Map();

async function generateUniqueCode() {
  let code, exists = true;
  while (exists) {
    code = generateTestCode();
    const r = await pool.query('SELECT 1 FROM tests WHERE code=$1', [code]);
    exists = r.rowCount > 0;
  }
  return code;
}

async function checkMembership(userId, telegram) {
  try {
    const member = await telegram.getChatMember(GROUP_ID, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

// Bot faqat shaxsiy chatdagi xabarlarga munosabat bildiradi, guruhga aralashmaydi
bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== 'private') {
    return;
  }
  return next();
});

async function sendMainMenu(ctx) {
  const buttons = [];
  if (ctx.from.id === ADMIN_ID) {
    buttons.push([Markup.button.callback('➕ Yangi test yaratish', 'new_test')]);
    buttons.push([Markup.button.callback('📋 Testlarim', 'my_tests')]);
  }
  const isMember = await checkMembership(ctx.from.id, ctx.telegram);
  if (isMember) {
    buttons.push([Markup.button.webApp('🧪 Test ishlash', PUBLIC_URL)]);
    await ctx.reply('Assalomu alaykum! Attestatsiya test botiga xush kelibsiz.', Markup.inlineKeyboard(buttons));
  } else {
    if (buttons.length) await ctx.reply('Assalomu alaykum!', Markup.inlineKeyboard(buttons));
    await ctx.reply("❌ Siz ushbu botdan foydalanish uchun kerakli guruh a'zosi bo'lishingiz kerak.");
  }
}

bot.start(sendMainMenu);

async function startTestCreation(ctx) {
  if (ctx.from.id !== ADMIN_ID) return;
  editSessions.delete(ctx.from.id);
  creationSessions.set(ctx.from.id, { parts: [] });
  await ctx.reply(
    "📝 50 talik testni kiriting.\n\nBir nechta xabar qilib yuborishingiz mumkin. Hammasini kiritib bo'lgach, pastdagi tugmani bosing yoki /tugatdim buyrug'ini yuboring.\n\nBekor qilish: /bekor",
    Markup.inlineKeyboard([Markup.button.callback('✅ Yakunlash', 'finish_test_creation')])
  );
}

bot.command('yangitest', startTestCreation);
bot.action('new_test', async (ctx) => { await ctx.answerCbQuery(); await startTestCreation(ctx); });

async function finalizeTestCreation(ctx) {
  if (ctx.from.id !== ADMIN_ID) return;
  const session = creationSessions.get(ctx.from.id);
  if (!session || session.parts.length === 0) {
    return ctx.reply("❗ Avval /yangitest orqali test kiritishni boshlang.");
  }
  const fullHtml = session.parts.map(p => messageToHtml(p.text, p.entities)).join('\n');
  let parsed;
  try {
    parsed = parseTest(fullHtml);
  } catch (err) {
    return ctx.reply(`❌ Xatolik: ${err.message}\n\nFormatni tekshirib, /yangitest bilan qaytadan boshlang.`);
  }
  creationSessions.delete(ctx.from.id);

  const code = await generateUniqueCode();
  const title = `Attestatsiya testi — ${new Date().toLocaleDateString('uz-UZ')}`;
  await pool.query(
    `INSERT INTO tests (code, title, created_by, questions, text_a, text_b) VALUES ($1,$2,$3,$4,$5,$6)`,
    [code, title, ctx.from.id, JSON.stringify(parsed.questions), JSON.stringify(parsed.textA), JSON.stringify(parsed.textB)]
  );

  await ctx.reply(
    `✅ Test tuzdingiz!\n\n📌 ${title}\n🔑 Kod: <code>${code}</code>\n📊 Savollar soni: ${parsed.questions.length} ta`,
    { parse_mode: 'HTML' }
  );

  const botUsername = ctx.botInfo.username;
  const broadcastMsg =
`Assalomu alaykum! Ona tili va adabiyot fanidan Attestatsiya testing maxsus botda ishlang.

Vaqt: 105 daqiqa
Savollar soni: 50 ta
Test kodi: ${code}

Bot linki -------> https://t.me/${botUsername}`;

  await ctx.reply("📤 O'quvchilarga yuborish uchun xabar:");
  await ctx.reply('<pre>' + broadcastMsg.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>', { parse_mode: 'HTML' });
}

bot.command('tugatdim', finalizeTestCreation);
bot.action('finish_test_creation', async (ctx) => { await ctx.answerCbQuery(); await finalizeTestCreation(ctx); });

// ===== TAHRIRLASH =====
bot.command('tahrirlash', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  creationSessions.delete(ctx.from.id);
  editSessions.set(ctx.from.id, { step: 'code' });
  await ctx.reply("✏️ Tahrirlash rejimi.\n\nTest kodini yozing:\n\nBekor qilish: /bekor");
});

bot.command('stop_tahrirlash', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const s = editSessions.get(ctx.from.id);
  if (!s || s.step !== 'edit') {
    return ctx.reply("❗ Tahrirlash rejimi yoqilmagan. /tahrirlash buyrug'ini yuboring.");
  }
  if (s.changes.size === 0 && s.textChanges.size === 0) {
    editSessions.delete(ctx.from.id);
    return ctx.reply("O'zgarish kiritilmadi. Tahrirlash tugadi.");
  }
  const questions = s.questions.map(q => s.changes.get(q.number) || q);
  const textA = s.textChanges.has('A') ? { ...s.textA, html: s.textChanges.get('A') } : s.textA;
  const textB = s.textChanges.has('B') ? { ...s.textB, html: s.textChanges.get('B') } : s.textB;
  await pool.query(
    'UPDATE tests SET questions=$1, text_a=$2, text_b=$3 WHERE id=$4',
    [JSON.stringify(questions), JSON.stringify(textA), JSON.stringify(textB), s.testId]
  );
  const nums = [...s.changes.keys()].sort((a, b) => a - b);
  const texts = [...s.textChanges.keys()].map(k => (k === 'A' ? '1-matn' : '2-matn'));
  editSessions.delete(ctx.from.id);
  await ctx.reply(
    `✅ Saqlandi!\n\nO'zgargan savollar: ${nums.length ? nums.join(', ') : "yo'q"}\nO'zgargan matnlar: ${texts.length ? texts.join(', ') : "yo'q"}`
  );
});

bot.command('bekor', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const had = editSessions.has(ctx.from.id) || creationSessions.has(ctx.from.id);
  editSessions.delete(ctx.from.id);
  creationSessions.delete(ctx.from.id);
  await ctx.reply(had ? "❌ Bekor qilindi. Hech narsa saqlanmadi." : "Bekor qilinadigan jarayon yo'q.");
});

bot.on('text', async (ctx, next) => {
  if (ctx.from.id !== ADMIN_ID || ctx.message.text.startsWith('/')) return next();

  const edit = editSessions.get(ctx.from.id);
  if (edit) {
    if (edit.step === 'code') {
      const code = ctx.message.text.trim().toUpperCase();
      const r = await pool.query('SELECT * FROM tests WHERE code=$1', [code]);
      if (r.rowCount === 0) return ctx.reply("❌ Bunday kodli test topilmadi. Qayta yozing yoki /bekor.");
      const t = r.rows[0];
      editSessions.set(ctx.from.id, {
        step: 'edit',
        testId: t.id,
        questions: t.questions,
        textA: t.text_a,
        textB: t.text_b,
        changes: new Map(),
        textChanges: new Map(),
      });
      return ctx.reply(
        `📌 ${t.title} (${t.code})\n\nO'zgartirmoqchi bo'lgan savolni yuboring.\nMasalan: ⁉️5-savol. ... (4 ta 🔷, ✅, ⚠️ bilan)\n\nMatnni almashtirish uchun avval qatorga "1-matn" (ilmiy) yoki "2-matn" (badiiy) deb yozib, keyin ‼️ ... ‼️ yuboring.\n\nTugatgan bo'lsangiz: /stop_tahrirlash\nBekor qilish: /bekor`
      );
    }
    if (edit.step === 'edit') {
      let parsed;
      try {
        parsed = parseEditMessage(messageToHtml(ctx.message.text, ctx.message.entities || []));
      } catch (err) {
        return ctx.reply(`❌ Xatolik: ${err.message}\n\nQaytadan yuboring.`);
      }
      parsed.questions.forEach(q => edit.changes.set(q.number, q));
      parsed.texts.forEach(t => edit.textChanges.set(t.which, t.html));
      const nums = parsed.questions.map(q => q.number);
      const txt = parsed.texts.map(t => (t.which === 'A' ? '1-matn' : '2-matn'));
      return ctx.reply(
        `✅ Qabul qilindi: ${[...nums.map(n => `${n}-savol`), ...txt].join(', ')}\n\nYana yuboring, yoki saqlash uchun /stop_tahrirlash, bekor qilish uchun /bekor.`
      );
    }
  }

  const session = creationSessions.get(ctx.from.id);
  if (session) {
    session.parts.push({ text: ctx.message.text, entities: ctx.message.entities || [] });
    return ctx.reply(`✅ Qabul qilindi (${session.parts.length}-xabar).`);
  }
  return next();
});

async function showMyTests(ctx) {
  if (ctx.from.id !== ADMIN_ID) return;
  const r = await pool.query('SELECT id, code, title, created_at FROM tests WHERE created_by=$1 ORDER BY created_at DESC LIMIT 30', [ADMIN_ID]);
  if (r.rowCount === 0) return ctx.reply('Hali test yaratmagansiz.');
  const buttons = r.rows.map(t => [Markup.button.callback(`${t.title} (${t.code})`, `natijalar_${t.id}`)]);
  await ctx.reply('📋 Testlaringiz:', Markup.inlineKeyboard(buttons));
}

bot.command('testlarim', showMyTests);
bot.action('my_tests', async (ctx) => { await ctx.answerCbQuery(); await showMyTests(ctx); });

bot.action(/natijalar_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const testId = ctx.match[1];
  const testR = await pool.query('SELECT code, title FROM tests WHERE id=$1', [testId]);
  if (testR.rowCount === 0) return ctx.reply('Test topilmadi.');
  const test = testR.rows[0];
  const r = await pool.query(
    `SELECT full_name, toifa_target, attempt_number, score, status, finished_at
     FROM attempts WHERE test_id=$1 ORDER BY finished_at DESC NULLS LAST`,
    [testId]
  );
  if (r.rowCount === 0) {
    return ctx.reply(`📌 ${test.title} (${test.code})\n\nHali hech kim ishlamagan.`);
  }
  let msg = `📌 ${test.title} (${test.code})\n\n`;
  r.rows.forEach((a, i) => {
    const statusText = a.status === 'finished' ? `${a.score}/100 ball` : 'jarayonda';
    msg += `${i + 1}. ${a.full_name} — ${a.attempt_number}-urinish — ${statusText} (${a.toifa_target})\n`;
  });
  if (msg.length > 4000) msg = msg.slice(0, 4000) + '\n...';
  await ctx.reply(msg);
});

module.exports = { bot, checkMembership };
