function computeScore(test, answersMap) {
  let correct = 0;
  test.questions.forEach(q => {
    const given = answersMap[String(q.number)];
    if (given && given === q.correctLetter) correct++;
  });
  return correct * 2; // 50 savol x 2 ball = 100
}

function tierMessage(score) {
  if (score < 60) {
    return { tier: null, text: "Afsuski, siz ushbu urinishda toifa ololmadingiz. 😔" };
  }
  if (score < 70) {
    return { tier: '2-toifa', text: "Tabriklaymiz! Siz 2-toifaga o'tishingiz mumkin. 🎉" };
  }
  if (score < 80) {
    return { tier: '1-toifa', text: "Tabriklaymiz! Siz 1-toifaga o'tishingiz mumkin. 🎉" };
  }
  if (score < 86) {
    return { tier: 'Oliy toifa', text: "Tabriklaymiz! Siz OLIY toifadagi natijaga erishdingiz! 🏆" };
  }
  return { tier: 'Oliy toifa', text: "Tabriklaymiz! Siz OLIY toifadagi natijaga erishdingiz va 70% ustama olish huquqiga ega bo'ldingiz! 🏆🔥" };
}

module.exports = { computeScore, tierMessage };
