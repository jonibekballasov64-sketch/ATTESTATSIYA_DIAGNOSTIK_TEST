const { Telegraf, Markup } = require('telegraf');
const { BOT_TOKEN, ADMIN_ID, GROUP_ID, PUBLIC_URL } = require('../config');
const { pool } = require('../db');
const { messageToHtml } = require('../utils/entities');
const { generateTestCode } = require('../utils/codeGen');
const { parseTest } = require('../parser/parseTest');

const bot = new Telegraf(BOT_TOKEN);
const creationSessions = new Map();

async function generateUniqueCode() {
  let code, exists = true;
  while (exists) {
    code = generateTestCode();
    const r = await pool.query('SELECT 1 FROM tests WHERE code=$1', [code]);
    exists = r.rowCount > 0;
  }
  return code;
}

async function checkMembership(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(GROUP_ID, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

async function sendMainMenu(ctx) {
  const buttons = [];
  if (ctx.from.id === ADMIN_ID) {
    buttons.push([Markup.button.callback('➕ Yangi test yaratish', 'new_test')]);
    buttons.push([Markup.button.callback('📋 Testlarim', 'my_tests')]);
  }
  const isMember = await checkMembership(ctx);
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
  creationSessions.set(ctx.from.id, { parts: [] });
  await ctx.reply(
    "📝 50 talik testni kiriting.\n\nBir nechta xabar qilib yuborishingiz mumkin. Hammasini kiritib bo'lgach, pastdagi tugmani bosing yoki /tugatdim buyrug'ini yuboring.",
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

bot.on('text', async (ctx, next) => {
  const session = creationSessions.get(ctx.from.id);
  if (session && ctx.from.id === ADMIN_ID && !ctx.message.text.startsWith('/')) {
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

module.exports = { bot };
