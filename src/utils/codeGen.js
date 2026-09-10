const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0,O,1,I chalkashmasin

function generateTestCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

module.exports = { generateTestCode };
