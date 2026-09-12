function computeResult(test, answersMap) {
  let correct = 0;
  test.questions.forEach(q => {
    const given = answersMap[String(q.number)];
    if (given && given === q.correctLetter) correct++;
  });
  const total = test.questions.length;
  const score = correct * 2;
  return { correct, total, score };
}

function tierMessage(score) {
  if (score < 60) {
    return { tier: null, text: "Afsuski, siz ushbu urinishda toifa ololmadingiz. 😔\nYana harakat qiling, albatta uddalaysiz!" };
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

module.exports = { computeResult, tierMessage };
