require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  DATABASE_URL: process.env.DATABASE_URL,
  GROUP_ID: process.env.GROUP_ID,
  ADMIN_ID: Number(process.env.ADMIN_ID),
  PUBLIC_URL: process.env.PUBLIC_URL,
  PORT: process.env.PORT || 3000,
  TEST_DURATION_MIN: 105,
  MAX_ATTEMPTS: 2,
};
