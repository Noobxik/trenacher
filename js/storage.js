const STORAGE_KEY = "mcko-phys-trainer-v1";

function baseState() {
  return {
    theme: "light",
    stats: {
      variants: {},
      lastVariantKey: null
    }
  };
}

export function loadAppStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return baseState();
    const data = JSON.parse(raw);
    return {
      ...baseState(),
      ...data,
      stats: {
        ...baseState().stats,
        ...(data?.stats || {}),
        variants: { ...(data?.stats?.variants || {}) }
      }
    };
  } catch (_) {
    return baseState();
  }
}

export function saveAppStorage(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function getVariantStats(state, variantKey, label) {
  if (!state.stats.variants[variantKey]) {
    state.stats.variants[variantKey] = {
      label,
      attempts: 0,
      sumPercent: 0,
      bestPercent: 0,
      lastResult: null,
      wrongQuestionCounts: {},
      wrongQuestionMeta: {}
    };
  }
  return state.stats.variants[variantKey];
}

export function recordResult(state, payload) {
  const {
    variantKey,
    label,
    percent,
    correctCount,
    total,
    questions,
    answers
  } = payload;

  const stat = getVariantStats(state, variantKey, label);
  stat.attempts += 1;
  stat.sumPercent += percent;
  stat.bestPercent = Math.max(stat.bestPercent, percent);
  stat.lastResult = {
    percent,
    correctCount,
    total,
    at: new Date().toISOString()
  };

  questions.forEach((q, i) => {
    const selectedIndex = answers[i];
    const selected = selectedIndex == null ? "" : q.options[selectedIndex];
    if ((selected || "").trim() !== q.correctAnswer.trim()) {
      stat.wrongQuestionCounts[q.id] = (stat.wrongQuestionCounts[q.id] || 0) + 1;
      stat.wrongQuestionMeta[q.id] = {
        id: q.id,
        variantTitle: q.variantTitle,
        question: q.question,
        correctAnswer: q.correctAnswer
      };
    }
  });

  state.stats.lastVariantKey = variantKey;
  return state;
}

export function getDifficultIds(state, variantKey) {
  if (variantKey === "mix") {
    const all = new Set();
    Object.values(state.stats.variants).forEach((v) => {
      Object.entries(v.wrongQuestionCounts || {}).forEach(([id, count]) => {
        if (count > 0) all.add(id);
      });
    });
    return all;
  }

  const wrong = state.stats.variants[variantKey]?.wrongQuestionCounts || {};
  return new Set(
    Object.entries(wrong)
      .filter(([, count]) => count > 0)
      .map(([id]) => id)
  );
}

export function resetStats(state) {
  return {
    ...state,
    stats: {
      variants: {},
      lastVariantKey: null
    }
  };
}

