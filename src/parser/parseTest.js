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
  out = out.replace(/__([\s\S]+?)__/g, '<i>$1</i>');
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

  const letters = ['A', 'B', 'C', 'D'];

  const questions = rawChunks.map((chunk, idx) => {
    const num = idx + 1;
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
    let tail = lastRaw.slice(ansIdx + 1);
    const explainIdx = tail.indexOf('⚠');
    let answerText = explainIdx === -1 ? tail : tail.slice(0, explainIdx);
    let explanationHtml = explainIdx === -1 ? '' : tail.slice(explainIdx + 1).trim();

    const optionTexts = [optionParts[0], optionParts[1], optionParts[2], optionDText];
    const options = optionTexts.map((t, i) => ({
      letter: letters[i],
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
  });

  return {
    textA: { html: wrapParagraphs(applyMarkdown(textA)), range: [1, 5] },
    textB: { html: wrapParagraphs(applyMarkdown(textB)), range: [21, 25] },
    questions,
  };
}

module.exports = { parseTest };
