import { parseQuestionsMarkdown } from "./parser.js";
import {
  loadAppStorage,
  saveAppStorage,
  recordResult,
  getDifficultIds,
  resetStats
} from "./storage.js";

const app = document.getElementById("app");
const loaderTpl = document.getElementById("loaderTpl");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const goTrainerBtn = document.getElementById("goTrainerBtn");
const goStatsBtn = document.getElementById("goStatsBtn");
const goHomeBtn = document.getElementById("goHomeBtn");

const state = {
  dataset: null,
  storage: loadAppStorage(),
  screen: "trainer",
  difficultOnly: false,
  currentTest: null
};

function normalize(value) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
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

function sanitizeQuestion(question) {
  let text = (question.question || "").trim();
  let options = (question.options || []).map((o) => (o || "").trim()).filter(Boolean);

  while (options.length > 2 && shouldMergeQuestionAndFirstOption(text, options[0])) {
    text = `${text} ${options.shift()}`.replace(/\s+/g, " ").trim();
  }

  const mergedOptions = [];
  for (const option of options) {
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

  while (mergedOptions.length > 2 && shouldMergeQuestionAndFirstOption(text, mergedOptions[0])) {
    text = `${text} ${mergedOptions.shift()}`.replace(/\s+/g, " ").trim();
  }

  const correct = (question.correctAnswer || "").trim();
  const mergedByCorrect = mergeUsingCorrectAnswer(mergedOptions, correct);

  const deduped = [];
  const seen = new Set();
  for (const option of mergedByCorrect) {
    const key = normalize(option);
    if (!key || ARTEFACT_OPTIONS.has(key) || seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
  }

  if (correct && !deduped.some((opt) => normalize(opt) === normalize(correct))) {
    deduped.push(correct);
  }

  return {
    ...question,
    question: text,
    options: deduped
  };
}

function sanitizeDataset(dataset) {
  if (!dataset || !Array.isArray(dataset.variants)) return dataset;
  return {
    ...dataset,
    variants: dataset.variants.map((variant) => ({
      ...variant,
      questions: (variant.questions || []).map((question) => sanitizeQuestion(question))
    }))
  };
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setTheme(theme) {
  state.storage.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleBtn.textContent = theme === "dark" ? "Светлая тема" : "Тёмная тема";
  saveAppStorage(state.storage);
}

function getAllQuestions() {
  return state.dataset.variants.flatMap((v) =>
    v.questions.map((q) => ({ ...q, variantId: v.id, variantTitle: v.title, variantKey: v.key }))
  );
}

function getVariantByKey(key) {
  return state.dataset.variants.find((v) => v.key === key);
}

function getPoolByVariantKey(key) {
  if (key === "mix") return getAllQuestions();
  const variant = getVariantByKey(key);
  if (!variant) return [];
  return variant.questions.map((q) => ({
    ...q,
    variantId: variant.id,
    variantTitle: variant.title,
    variantKey: variant.key
  }));
}

async function loadDataset() {
  app.innerHTML = "";
  app.appendChild(loaderTpl.content.cloneNode(true));

  try {
    const jsonResponse = await fetch("./data/questions.json", { cache: "no-store" });
    if (jsonResponse.ok) {
      const data = await jsonResponse.json();
      if (Array.isArray(data.variants) && data.variants.length) {
        return sanitizeDataset(data);
      }
    }
  } catch (_) {}

  const mdResponse = await fetch("./phys_questions_variants.md", { cache: "no-store" });
  if (!mdResponse.ok) {
    throw new Error("Не удалось загрузить phys_questions_variants.md");
  }
  const markdown = await mdResponse.text();
  return sanitizeDataset(parseQuestionsMarkdown(markdown));
}

function startTest(variantKey) {
  let pool = getPoolByVariantKey(variantKey);
  if (!pool.length) return;

  if (state.difficultOnly) {
    const difficultIds = getDifficultIds(state.storage, variantKey);
    pool = pool.filter((q) => difficultIds.has(q.id));
  }

  if (!pool.length) {
    alert("Для этого режима пока нет вопросов: сначала сделайте попытки с ошибками.");
    return;
  }

  const questions = shuffle(pool).map((q) => {
    let options = shuffle(q.options);
    let correctIndex = options.findIndex((o) => normalize(o) === normalize(q.correctAnswer));
    if (correctIndex < 0) {
      options = shuffle([...options, q.correctAnswer]);
      correctIndex = options.findIndex((o) => normalize(o) === normalize(q.correctAnswer));
    }
    return { ...q, options, correctIndex };
  });

  state.currentTest = {
    variantKey,
    label: variantKey === "mix" ? "Случайный микс" : getVariantByKey(variantKey)?.title || variantKey,
    questions,
    answers: Array(questions.length).fill(null),
    index: 0,
    finished: false
  };
  render();
}

function renderTrainerStart() {
  const variantButtons = state.dataset.variants
    .map((v) => `<button class="primary start-variant" data-variant="${v.key}">${v.title}</button>`)
    .join("");

  const lastKey = state.storage.stats.lastVariantKey;
  const lastStat = lastKey ? state.storage.stats.variants[lastKey] : null;
  const lastText = lastStat?.lastResult
    ? `${lastStat.label}: ${lastStat.lastResult.correctCount}/${lastStat.lastResult.total} (${lastStat.lastResult.percent.toFixed(1)}%)`
    : "Нет завершённых попыток";

  app.innerHTML = `
    <section class="card">
      <h2>Выберите режим</h2>
      <p class="muted">В каждом запуске порядок вопросов и ответов перемешивается.</p>
      <div class="grid">
        ${variantButtons}
        <button class="primary start-variant" data-variant="mix">Случайный микс</button>
      </div>
      <div class="card">
        <label>
          <input id="difficultToggle" type="checkbox" ${state.difficultOnly ? "checked" : ""} />
          Только сложные вопросы (где раньше были ошибки)
        </label>
      </div>
      <p class="muted">Последний результат: ${lastText}</p>
    </section>
  `;

  app.querySelectorAll(".start-variant").forEach((btn) => {
    btn.addEventListener("click", () => startTest(btn.dataset.variant));
  });
  app.querySelector("#difficultToggle").addEventListener("change", (e) => {
    state.difficultOnly = e.target.checked;
  });
}

function renderQuestion() {
  const t = state.currentTest;
  const q = t.questions[t.index];

  const options = q.options
    .map((opt, i) => {
      const selectedClass = t.answers[t.index] === i ? "selected" : "";
      return `<button class="option ${selectedClass}" data-opt="${i}">${opt}</button>`;
    })
    .join("");

  app.innerHTML = `
    <section class="card">
      <div class="controls">
        <strong>${t.label}</strong>
        <span class="muted">Вопрос ${t.index + 1} из ${t.questions.length}</span>
      </div>
      <p class="question-title">${q.question}</p>
      <div class="options">${options}</div>
      <div class="nav">
        <button id="prevBtn" ${t.index === 0 ? "disabled" : ""}>Назад</button>
        <button id="nextBtn" ${t.index === t.questions.length - 1 ? "disabled" : ""}>Далее</button>
        <button id="finishBtn" class="primary">Завершить тест</button>
      </div>
    </section>
  `;

  app.querySelectorAll(".option").forEach((btn) => {
    btn.addEventListener("click", () => {
      t.answers[t.index] = Number(btn.dataset.opt);
      renderQuestion();
    });
  });

  app.querySelector("#prevBtn").addEventListener("click", () => {
    t.index -= 1;
    renderQuestion();
  });
  app.querySelector("#nextBtn").addEventListener("click", () => {
    t.index += 1;
    renderQuestion();
  });
  app.querySelector("#finishBtn").addEventListener("click", finishTest);
}

function finishTest() {
  const t = state.currentTest;
  let correctCount = 0;

  const review = t.questions.map((q, i) => {
    const selectedIndex = t.answers[i];
    const selectedText = selectedIndex == null ? "" : q.options[selectedIndex];
    const isCorrect = normalize(selectedText) === normalize(q.correctAnswer);
    if (isCorrect) correctCount += 1;
    return { ...q, selectedIndex, selectedText, isCorrect };
  });

  const total = t.questions.length;
  const wrongCount = total - correctCount;
  const percent = total ? (correctCount / total) * 100 : 0;

  recordResult(state.storage, {
    variantKey: t.variantKey,
    label: t.label,
    percent,
    correctCount,
    total,
    questions: t.questions,
    answers: t.answers
  });
  saveAppStorage(state.storage);

  state.currentTest = {
    ...t,
    finished: true,
    result: { correctCount, wrongCount, percent, total, review }
  };
  renderResults();
}

function renderResults() {
  const t = state.currentTest;
  const { correctCount, wrongCount, percent, review } = t.result;
  const mistakes = review.filter((r) => !r.isCorrect);

  const mistakesHtml = mistakes.length
    ? mistakes.map((m) => `
      <div class="mistake">
        <p><strong>${m.variantTitle}, вопрос ${m.number}</strong></p>
        <p>${m.question}</p>
        <p class="answer-bad">Ваш ответ: ${m.selectedText || "Не выбран"}</p>
        <p class="answer-ok">Правильный ответ: ${m.correctAnswer}</p>
      </div>
    `).join("")
    : "<p class='answer-ok'>Ошибок нет. Отличный результат.</p>";

  const reviewHtml = review.map((r) => {
    const items = r.options.map((opt, i) => {
      let cls = "option";
      if (normalize(opt) === normalize(r.correctAnswer)) cls += " correct";
      if (i === r.selectedIndex && normalize(opt) !== normalize(r.correctAnswer)) cls += " wrong";
      return `<div class="${cls}">${opt}</div>`;
    }).join("");
    return `
      <div class="mistake">
        <p><strong>${r.variantTitle}, вопрос ${r.number}</strong></p>
        <p>${r.question}</p>
        <div class="options">${items}</div>
      </div>
    `;
  }).join("");

  app.innerHTML = `
    <section class="card">
      <h2>Результат — ${t.label}</h2>
      <div class="result-grid">
        <div class="stat-badge"><strong>Правильных:</strong><br>${correctCount}</div>
        <div class="stat-badge"><strong>Ошибок:</strong><br>${wrongCount}</div>
        <div class="stat-badge"><strong>Процент:</strong><br>${percent.toFixed(1)}%</div>
      </div>
      <div class="nav">
        <button id="retryBtn" class="primary">Пройти вариант заново</button>
        <button id="chooseBtn">Выбрать другой вариант</button>
        <button id="homeBtnResult">На главную</button>
      </div>
    </section>

    <section class="card">
      <h3>Ошибки</h3>
      ${mistakesHtml}
    </section>

    <section class="card">
      <h3>Разбор</h3>
      <p class="muted">Зелёным отмечен правильный ответ, красным — ошибочно выбранный.</p>
      ${reviewHtml}
    </section>
  `;

  document.getElementById("retryBtn").addEventListener("click", () => startTest(t.variantKey));
  document.getElementById("chooseBtn").addEventListener("click", () => {
    state.currentTest = null;
    render();
  });
  document.getElementById("homeBtnResult").addEventListener("click", () => {
    state.currentTest = null;
    state.screen = "trainer";
    render();
  });
}

function renderStats() {
  const rows = state.dataset.variants.map((v) => {
    const stat = state.storage.stats.variants[v.key];
    const attempts = stat?.attempts || 0;
    const best = stat ? `${stat.bestPercent.toFixed(1)}%` : "—";
    const avg = stat && attempts ? `${(stat.sumPercent / attempts).toFixed(1)}%` : "—";
    const last = stat?.lastResult ? `${stat.lastResult.percent.toFixed(1)}%` : "—";
    return `<tr><td>${v.title}</td><td>${attempts}</td><td>${best}</td><td>${avg}</td><td>${last}</td></tr>`;
  }).join("");

  const problemItems = [];
  Object.values(state.storage.stats.variants).forEach((variantStat) => {
    Object.entries(variantStat.wrongQuestionCounts || {}).forEach(([qid, count]) => {
      if (!count) return;
      const meta = variantStat.wrongQuestionMeta?.[qid];
      if (meta) {
        problemItems.push({
          qid,
          count,
          variantTitle: meta.variantTitle,
          question: meta.question,
          correctAnswer: meta.correctAnswer
        });
      }
    });
  });

  problemItems.sort((a, b) => b.count - a.count);
  const list = problemItems.length
    ? problemItems.slice(0, 30).map((p) => `
      <div class="mistake">
        <p><strong>${p.variantTitle}</strong> — ошибок: ${p.count}</p>
        <p>${p.question}</p>
        <p class="answer-ok">Правильный ответ: ${p.correctAnswer}</p>
      </div>
    `).join("")
    : "<p class='muted'>Проблемных вопросов пока нет.</p>";

  app.innerHTML = `
    <section class="card">
      <div class="controls">
        <h2>Статистика</h2>
        <button id="resetStatsBtn" class="danger">Сбросить статистику</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Вариант</th>
              <th>Попыток</th>
              <th>Лучший результат</th>
              <th>Средний результат</th>
              <th>Последний результат</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <h3>Проблемные вопросы</h3>
      ${list}
    </section>
  `;

  document.getElementById("resetStatsBtn").addEventListener("click", () => {
    if (!confirm("Сбросить всю статистику без возможности восстановления?")) return;
    state.storage = resetStats(state.storage);
    saveAppStorage(state.storage);
    renderStats();
  });
}

function render() {
  if (state.screen === "stats") {
    renderStats();
    return;
  }
  if (!state.currentTest || state.currentTest.finished) {
    if (state.currentTest?.finished) {
      renderResults();
    } else {
      renderTrainerStart();
    }
    return;
  }
  renderQuestion();
}

async function init() {
  setTheme(state.storage.theme || "light");
  goTrainerBtn.addEventListener("click", () => {
    state.screen = "trainer";
    render();
  });
  goStatsBtn.addEventListener("click", () => {
    state.screen = "stats";
    render();
  });
  goHomeBtn.addEventListener("click", () => {
    state.currentTest = null;
    state.screen = "trainer";
    render();
  });
  themeToggleBtn.addEventListener("click", () => {
    setTheme(state.storage.theme === "dark" ? "light" : "dark");
  });

  try {
    state.dataset = await loadDataset();
    render();
  } catch (e) {
    app.innerHTML = `<section class="card"><p>Ошибка загрузки данных: ${e.message}</p></section>`;
  }
}

init();

