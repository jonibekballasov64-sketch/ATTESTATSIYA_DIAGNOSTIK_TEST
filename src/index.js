const { bot, checkMembership } = require('./bot');
const { createApp } = require('./api/server');
const { initDb } = require('./db');
const { PORT } = require('./config');

(async () => {
  await initDb();
  const app = createApp(bot, checkMembership);
  app.listen(PORT, () => console.log(`Server ${PORT}-portda ishga tushdi`));
  await bot.launch();
  console.log('Bot ishga tushdi');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
