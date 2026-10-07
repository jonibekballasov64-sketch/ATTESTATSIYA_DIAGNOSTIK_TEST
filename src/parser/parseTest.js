function stripVS(str) {
  return str.replace(/\uFE0F/g, '');
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

function cleanHeader(headerRaw) {
  return headerRaw
    .replace(/^\s*\d+\s*-\s*savol\.?\s*/i, '')
    .replace(/^\s*\d+\s*[-.)]\s*/i, '')
    .trim();
}

function applyMarkdown(html) {
  if (!html) return html;
  let out = html.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/__([\s\S]+?)__/g, '<span class="hl">$1</span>');
  return out;
}

function wrapParagraphs(html) {
  if (!html) return html;
  const parts = html.split(/(?:<br>\s*){2,}/i).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return html;
  return parts.map(p => `<p>${p}</p>`).join('');
}

function extractCorrectLetter(answerHtml, options) {
  const plain = stripTags(answerHtml).trim();
  const cleaned = plain.replace(/^\s*(to'g'ri\s*javob|javobi|javob)\s*[:\-]?\s*/i, '').trim();
  const letterMatch = cleaned.match(/^([A-D])\b/i);
  if (letterMatch) return letterMatch[1].toUpperCase();
  const found = options.find(o => stripTags(o.html).toLowerCase() === cleaned.toLowerCase());
  return found ? found.letter : null;
}

const LETTERS = ['A', 'B', 'C', 'D'];

function parseQuestionChunk(chunk, num) {
  const optIdx = chunk.indexOf('🔷');
  if (optIdx === -1) throw new Error(`${num}-savolda variantlar (🔷) topilmadi`);
  const headerRaw = chunk.slice(0, optIdx).trim();
  const header = applyMarkdown(cleanHeader(headerRaw));
  const rest = chunk.slice(optIdx);
  const optionParts = rest.split('🔷').filter(s => s.trim().length > 0);
  if (optionParts.length < 4) throw new Error(`${num}-savolda 4 ta variant bo'lishi kerak, topildi: ${optionParts.length}`);

  const lastRaw = optionParts[3];
  const ansIdx = lastRaw.indexOf('✅');
  if (ansIdx === -1) throw new Error(`${num}-savolda javob (✅) topilmadi`);
  const optionDText = lastRaw.slice(0, ansIdx);
  const tail = lastRaw.slice(ansIdx + 1);
  const explainIdx = tail.indexOf('⚠');
  const answerText = explainIdx === -1 ? tail : tail.slice(0, explainIdx);
  const explanationHtml = explainIdx === -1 ? '' : tail.slice(explainIdx + 1).trim();

  const optionTexts = [optionParts[0], optionParts[1], optionParts[2], optionDText];
  const options = optionTexts.map((t, i) => ({
    letter: LETTERS[i],
    html: applyMarkdown(t.replace(/^\s*[A-D][).]?\s*/, '').trim()),
  }));

  const correctLetter = extractCorrectLetter(answerText, options);
  if (!correctLetter) throw new Error(`${num}-savolda to'g'ri javobni aniqlab bo'lmadi: "${stripTags(answerText).slice(0, 50)}"`);

  return {
    number: num,
    html: header,
    options,
    correctLetter,
    explanationHtml: explanationHtml ? applyMarkdown(explanationHtml) : null,
  };
}

function parseTest(rawHtml) {
  const text = stripVS(rawHtml);

  const blockRegex = /‼([\s\S]*?)‼/g;
  const blocks = [];
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    blocks.push(m[1].trim());
  }
  if (blocks.length < 2) {
    throw new Error(`Matn bloklari topilmadi (‼️...‼️). Kerak: 2 ta, topildi: ${blocks.length}`);
  }
  const [textA, textB] = blocks;
  const stream = text.replace(blockRegex, '\n');

  const rawChunks = stream.split('⁉').slice(1);
  if (rawChunks.length !== 50) {
    throw new Error(`Savollar soni 50 bo'lishi kerak, topildi: ${rawChunks.length}`);
  }

  const questions = rawChunks.map((chunk, idx) => parseQuestionChunk(chunk, idx + 1));

  return {
    textA: { html: wrapParagraphs(applyMarkdown(textA)), range: [1, 5] },
    textB: { html: wrapParagraphs(applyMarkdown(textB)), range: [21, 25] },
    questions,
  };
}

// Tahrirlash uchun: bitta yoki bir nechta savol va/yoki matn bloki
function parseEditMessage(rawHtml) {
  const text = stripVS(rawHtml);
  const result = { questions: [], texts: [] };

  const blockRegex = /([^\n‼]*)‼([\s\S]*?)‼/g;
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    const label = (m[1] || '').toLowerCase();
    let which = null;
    if (/\b1\b|ilmiy/.test(label)) which = 'A';
    else if (/\b2\b|badiiy/.test(label)) which = 'B';
    if (!which) {
      throw new Error("Matn bloki oldiga qatorga '1-matn' (ilmiy) yoki '2-matn' (badiiy) deb yozing");
    }
    result.texts.push({ which, html: wrapParagraphs(applyMarkdown(m[2].trim())) });
  }

  const stream = text.replace(/([^\n‼]*)‼([\s\S]*?)‼/g, '\n');
  const chunks = stream.split('⁉').slice(1);
  for (const chunk of chunks) {
    const numMatch = chunk.match(/^\s*(\d+)/);
    if (!numMatch) throw new Error("Savol raqami topilmadi. Masalan: ⁉️5-savol. ...");
    const num = Number(numMatch[1]);
    if (num < 1 || num > 50) throw new Error(`Savol raqami 1 dan 50 gacha bo'lishi kerak (kiritildi: ${num})`);
    result.questions.push(parseQuestionChunk(chunk, num));
  }

  if (result.questions.length === 0 && result.texts.length === 0) {
    throw new Error("Savol (⁉️) ham, matn (‼️) ham topilmadi");
  }
  return result;
}

module.exports = { parseTest, parseEditMessage };
