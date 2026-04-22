const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "..", "all.json");
const TARGET_PATH = path.join(__dirname, "..", "data", "questions.json");

function hashText(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function normalize(value) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/[«»"]/g, "")
    .trim()
    .toLowerCase();
}

function sanitizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function convertQuestion(rawQuestion, variantKey, number) {
  const question = sanitizeText(rawQuestion.question);
  const correctAnswer = sanitizeText(rawQuestion.correct_answer);

  if (!question) {
    throw new Error(`Пустой текст вопроса: ${variantKey}, №${number}`);
  }
  if (!correctAnswer) {
    throw new Error(`Пустой правильный ответ: ${variantKey}, №${number}`);
  }

  const options = [];
  const seen = new Set();
  for (const rawOption of rawQuestion.options || []) {
    const option = sanitizeText(rawOption);
    const key = normalize(option);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push(option);
  }

  const normalizedCorrect = normalize(correctAnswer);
  if (!options.some((option) => normalize(option) === normalizedCorrect)) {
    options.push(correctAnswer);
  }

  if (options.length < 2) {
    throw new Error(`Недостаточно вариантов ответа: ${variantKey}, №${number}`);
  }

  return {
    id: `${variantKey}-q${number}-${hashText(question)}`,
    number,
    question,
    options,
    correctAnswer,
    explanation: ""
  };
}

function convertAllJson(source) {
  if (!source || !Array.isArray(source.variants) || !source.variants.length) {
    throw new Error("all.json не содержит корректный массив variants");
  }

  const variants = source.variants.map((variantRaw, idx) => {
    const variantId = Number(variantRaw.variant ?? (idx + 1));
    const key = `variant-${variantId}`;
    const title = `Вариант ${variantId}`;
    const questionsRaw = Array.isArray(variantRaw.questions) ? variantRaw.questions : [];

    const questions = questionsRaw.map((questionRaw, qIdx) =>
      convertQuestion(questionRaw, key, qIdx + 1)
    );

    return {
      id: variantId,
      key,
      title,
      questions
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    source: "all.json",
    variants
  };
}

function main() {
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
  const converted = convertAllJson(source);

  fs.mkdirSync(path.dirname(TARGET_PATH), { recursive: true });
  fs.writeFileSync(TARGET_PATH, `${JSON.stringify(converted, null, 2)}\n`, "utf8");

  const countQuestions = converted.variants.reduce((sum, variant) => sum + variant.questions.length, 0);
  console.log(`Создано: ${TARGET_PATH}`);
  console.log(`Источник: ${SOURCE_PATH}`);
  console.log(`Вариантов: ${converted.variants.length}, вопросов: ${countQuestions}`);
}

main();
