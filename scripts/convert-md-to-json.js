const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "..", "phys_questions_variants.md");
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

function parseQuestionLine(line) {
  const m = line.match(/^\*\*(\d+)\.\s*(.*?)\*\*$/);
  if (!m) return null;
  return { number: Number(m[1]), text: m[2].trim() };
}

function parseVariantLine(line) {
  const m = line.match(/^#\s*Вариант\s*(\d+)\s*$/i);
  if (!m) return null;
  return Number(m[1]);
}

function parseOptionLine(line) {
  const m = line.match(/^\d+\)\s*(.+)$/);
  return m ? m[1].trim() : null;
}

function parseCorrectLine(line) {
  const m = line.match(/^Правильный ответ:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

const ARTEFACT_OPTIONS = new Set([
  "выберите верное утверждение.",
  "выберите правильный ответ.",
  "(см. табл. 1).",
  "следующие данные (см. табл. 1).",
  "(в том числе животные)",
  "себя"
]);

function shouldMergeQuestionAndFirstOption(question, firstOption) {
  if (!firstOption) return false;
  const q = question.trim();
  const first = firstOption.trim();
  if (!q || !first) return false;
  if (/,\s*$/.test(q)) return true;
  if (!/[.?!]$/.test(q) && /[?]$/.test(first)) return true;
  if (!/[.?!]$/.test(q) && /\b(называется|является)\b/i.test(first)) return true;
  if (!/[.?!]$/.test(q) && ARTEFACT_OPTIONS.has(normalize(first))) return true;
  return false;
}

function shouldMergeOptions(prev, next) {
  if (!prev || !next) return false;
  const p = prev.trim();
  const n = next.trim();
  if (!p || !n) return false;
  if (/[.?!:;%)]$/.test(p)) return false;
  if (/[-–]\s*$/.test(p)) return true;
  if (/\b(и|или|а|но|в|во|на|по|к|ко|от|до|для|из|с|со|при|о|об|под|над|между)\s*$/i.test(p)) return true;
  if (!/\d/.test(n) && /^[а-яёa-z]/i.test(n) && n.split(/\s+/).length <= 2 && p.split(/\s+/).length >= 8) return true;
  return false;
}

function mergeUsingCorrectAnswer(options, correctAnswer) {
  const merged = [...options];
  const normalizedCorrect = normalize(correctAnswer);
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length - 1; i += 1) {
      const mergedCandidate = `${merged[i]} ${merged[i + 1]}`.replace(/\s+/g, " ").trim();
      const mergedNorm = normalize(mergedCandidate);
      if (normalizedCorrect === mergedNorm || normalizedCorrect.startsWith(`${mergedNorm} `)) {
        merged.splice(i, 2, mergedCandidate);
        changed = true;
        break;
      }
    }
  }

  return merged;
}

function sanitizeQuestion(questionText, options, correctAnswer) {
  let question = (questionText || "").trim();
  let cleanedOptions = (options || []).map((o) => (o || "").trim()).filter(Boolean);

  while (cleanedOptions.length > 2 && shouldMergeQuestionAndFirstOption(question, cleanedOptions[0])) {
    question = `${question} ${cleanedOptions.shift()}`.replace(/\s+/g, " ").trim();
  }

  const mergedOptions = [];
  for (const option of cleanedOptions) {
    if (!mergedOptions.length) {
      mergedOptions.push(option);
      continue;
    }
    const prevIndex = mergedOptions.length - 1;
    if (shouldMergeOptions(mergedOptions[prevIndex], option)) {
      mergedOptions[prevIndex] = `${mergedOptions[prevIndex]} ${option}`.replace(/\s+/g, " ").trim();
    } else {
      mergedOptions.push(option);
    }
  }

  while (mergedOptions.length > 2 && shouldMergeQuestionAndFirstOption(question, mergedOptions[0])) {
    question = `${question} ${mergedOptions.shift()}`.replace(/\s+/g, " ").trim();
  }

  const mergedByCorrect = mergeUsingCorrectAnswer(mergedOptions, correctAnswer);

  const deduped = [];
  const seen = new Set();
  for (const option of mergedByCorrect) {
    const key = normalize(option);
    if (!key || ARTEFACT_OPTIONS.has(key) || seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
  }

  const normalizedCorrect = normalize(correctAnswer);
  if (normalizedCorrect && !deduped.some((o) => normalize(o) === normalizedCorrect)) {
    deduped.push(correctAnswer.trim());
  }

  return { question, options: deduped };
}

function finalizeQuestion(currentQuestion, variantKey) {
  if (!currentQuestion || !currentQuestion.text || !currentQuestion.correctAnswer) {
    return null;
  }

  const sanitized = sanitizeQuestion(
    currentQuestion.text,
    currentQuestion.options,
    currentQuestion.correctAnswer
  );
  const options = sanitized.options;

  if (!sanitized.question || !options.length) return null;

  return {
    id: `${variantKey}-q${currentQuestion.number}-${hashText(sanitized.question)}`,
    number: currentQuestion.number,
    question: sanitized.question,
    options,
    correctAnswer: currentQuestion.correctAnswer,
    explanation: ""
  };
}

function parseMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const variants = [];

  let currentVariant = null;
  let currentQuestion = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const variantNumber = parseVariantLine(line);
    if (variantNumber !== null) {
      if (currentVariant && currentQuestion) {
        const finalized = finalizeQuestion(currentQuestion, currentVariant.key);
        if (finalized) currentVariant.questions.push(finalized);
      }
      currentQuestion = null;
      currentVariant = {
        id: variantNumber,
        key: `variant-${variantNumber}`,
        title: `Вариант ${variantNumber}`,
        questions: []
      };
      variants.push(currentVariant);
      continue;
    }

    if (!currentVariant) continue;

    const questionData = parseQuestionLine(line);
    if (questionData) {
      if (currentQuestion) {
        const finalized = finalizeQuestion(currentQuestion, currentVariant.key);
        if (finalized) currentVariant.questions.push(finalized);
      }
      currentQuestion = {
        number: questionData.number,
        text: questionData.text,
        options: [],
        correctAnswer: ""
      };
      continue;
    }

    if (!currentQuestion) continue;

    const correct = parseCorrectLine(line);
    if (correct) {
      currentQuestion.correctAnswer = correct;
      continue;
    }

    const option = parseOptionLine(line);
    if (option) {
      currentQuestion.options.push(option);
    }
  }

  if (currentVariant && currentQuestion) {
    const finalized = finalizeQuestion(currentQuestion, currentVariant.key);
    if (finalized) currentVariant.questions.push(finalized);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: "phys_questions_variants.md",
    variants
  };
}

function main() {
  const md = fs.readFileSync(SOURCE_PATH, "utf8");
  const json = parseMarkdown(md);

  fs.mkdirSync(path.dirname(TARGET_PATH), { recursive: true });
  fs.writeFileSync(TARGET_PATH, `${JSON.stringify(json, null, 2)}\n`, "utf8");

  const countQuestions = json.variants.reduce((sum, v) => sum + v.questions.length, 0);
  console.log(`Создано: ${TARGET_PATH}`);
  console.log(`Вариантов: ${json.variants.length}, вопросов: ${countQuestions}`);
}

main();

