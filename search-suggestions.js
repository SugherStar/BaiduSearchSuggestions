"use strict";

const CONFIG = Object.freeze({
  debounceDelay: 320,
  requestTimeout: 6000,
  maxSuggestions: 8,
});

const elements = {
  form: document.querySelector("#search-form"),
  combobox: document.querySelector("#combobox"),
  input: document.querySelector("#search-input"),
  clearButton: document.querySelector("#clear-button"),
  panel: document.querySelector("#suggestion-panel"),
  list: document.querySelector("#suggestion-list"),
  status: document.querySelector("#status-message"),
};

const state = {
  debounceTimer: null,
  requestSequence: 0,
  suggestions: [],
  activeIndex: -1,
  composing: false,
  disposeRequest: null,
};

function debounceLookup() {
  window.clearTimeout(state.debounceTimer);

  const keyword = elements.input.value.trim();
  elements.clearButton.hidden = keyword.length === 0;
  clearSelection();

  if (!keyword) {
    cancelPendingRequest();
    closePanel();
    return;
  }

  state.debounceTimer = window.setTimeout(() => requestSuggestions(keyword), CONFIG.debounceDelay);
}

function requestSuggestions(keyword) {
  cancelPendingRequest();
  const requestId = ++state.requestSequence;
  setStatus("loading", "正在获取搜索建议…");

  state.disposeRequest = createJsonpRequest(
    keyword,
    (payload) => {
      if (requestId !== state.requestSequence || keyword !== elements.input.value.trim()) return;

      const suggestions = extractSuggestions(payload);
      state.disposeRequest = null;

      if (suggestions.length === 0) {
        state.suggestions = [];
        setStatus("empty", "没有找到相关建议，按 Enter 直接搜索");
        return;
      }

      renderSuggestions(suggestions);
    },
    () => {
      if (requestId !== state.requestSequence) return;
      state.disposeRequest = null;
      state.suggestions = [];
      setStatus("error", "暂时无法获取建议，仍可按 Enter 搜索");
    },
  );
}

function createJsonpRequest(keyword, onSuccess, onError) {
  const callbackName = `__baiduSuggest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const script = document.createElement("script");
  const params = new URLSearchParams({ wd: keyword, cb: callbackName });
  let settled = false;

  script.src = `https://suggestion.baidu.com/su?${params.toString()}`;
  script.charset = "gbk";
  script.async = true;

  const cleanup = () => {
    window.clearTimeout(timeoutId);
    script.remove();
    try {
      delete window[callbackName];
    } catch {
      window[callbackName] = undefined;
    }
  };

  const finish = (handler, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    handler(value);
  };

  window[callbackName] = (payload) => finish(onSuccess, payload);
  script.addEventListener("error", () => finish(onError));

  const timeoutId = window.setTimeout(() => finish(onError), CONFIG.requestTimeout);
  document.head.append(script);

  return () => {
    if (settled) return;
    settled = true;
    cleanup();
  };
}

function extractSuggestions(payload) {
  if (!payload || !Array.isArray(payload.s)) return [];

  return [...new Set(payload.s)]
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, CONFIG.maxSuggestions);
}

function renderSuggestions(suggestions) {
  state.suggestions = suggestions;
  state.activeIndex = -1;
  elements.list.replaceChildren();
  elements.status.textContent = "";
  delete elements.status.dataset.state;

  const fragment = document.createDocumentFragment();

  suggestions.forEach((suggestion, index) => {
    const item = document.createElement("li");
    item.id = `suggestion-${index}`;
    item.className = "suggestion-item";
    item.dataset.index = String(index);
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.textContent = suggestion;
    fragment.append(item);
  });

  elements.list.append(fragment);
  openPanel();
}

function setStatus(type, message) {
  elements.list.replaceChildren();
  elements.status.dataset.state = type;
  elements.status.textContent = message;
  openPanel();
}

function moveSelection(direction) {
  if (state.suggestions.length === 0) return;

  if (elements.panel.hidden) {
    openPanel();
  }

  const total = state.suggestions.length;
  const nextIndex = (state.activeIndex + direction + total) % total;
  setActiveIndex(nextIndex);
}

function setActiveIndex(index) {
  const options = [...elements.list.querySelectorAll('[role="option"]')];

  options.forEach((option, optionIndex) => {
    const isActive = optionIndex === index;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });

  state.activeIndex = index;

  if (index >= 0 && options[index]) {
    elements.input.setAttribute("aria-activedescendant", options[index].id);
    options[index].scrollIntoView({ block: "nearest" });
  } else {
    elements.input.removeAttribute("aria-activedescendant");
  }
}

function clearSelection() {
  setActiveIndex(-1);
}

function chooseSuggestion(index, shouldSearch = false) {
  const suggestion = state.suggestions[index];
  if (!suggestion) return;

  elements.input.value = suggestion;
  elements.clearButton.hidden = false;
  closePanel();

  if (shouldSearch) {
    submitSearch(suggestion);
  } else {
    elements.input.focus();
  }
}

function submitSearch(rawKeyword) {
  const keyword = rawKeyword.trim();
  if (!keyword) {
    elements.input.focus();
    return;
  }

  cancelPendingRequest();
  closePanel();
  window.location.assign(buildSearchUrl(keyword));
}

function buildSearchUrl(keyword) {
  const url = new URL("https://www.baidu.com/s");
  url.searchParams.set("wd", keyword);
  return url.toString();
}

function openPanel() {
  elements.panel.hidden = false;
  elements.input.setAttribute("aria-expanded", "true");
}

function closePanel() {
  elements.panel.hidden = true;
  elements.input.setAttribute("aria-expanded", "false");
  clearSelection();
}

function cancelPendingRequest() {
  window.clearTimeout(state.debounceTimer);
  state.requestSequence += 1;

  if (state.disposeRequest) {
    state.disposeRequest();
    state.disposeRequest = null;
  }
}

elements.input.addEventListener("input", () => {
  if (!state.composing) debounceLookup();
});

elements.input.addEventListener("compositionstart", () => {
  state.composing = true;
});

elements.input.addEventListener("compositionend", () => {
  state.composing = false;
  debounceLookup();
});

elements.input.addEventListener("focus", () => {
  if (state.suggestions.length > 0 && elements.input.value.trim()) openPanel();
});

elements.input.addEventListener("keydown", (event) => {
  if (state.composing || event.isComposing) return;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      moveSelection(1);
      break;
    case "ArrowUp":
      event.preventDefault();
      moveSelection(-1);
      break;
    case "Enter":
      if (state.activeIndex >= 0) {
        event.preventDefault();
        chooseSuggestion(state.activeIndex, true);
      }
      break;
    case "Escape":
      if (!elements.panel.hidden) {
        event.preventDefault();
        closePanel();
      }
      break;
    default:
      break;
  }
});

elements.list.addEventListener("pointerdown", (event) => {
  const option = event.target.closest('[role="option"]');
  if (!option) return;
  event.preventDefault();
  chooseSuggestion(Number(option.dataset.index), true);
});

elements.list.addEventListener("mousemove", (event) => {
  const option = event.target.closest('[role="option"]');
  if (option) setActiveIndex(Number(option.dataset.index));
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const selected = state.suggestions[state.activeIndex];
  submitSearch(selected ?? elements.input.value);
});

elements.clearButton.addEventListener("click", () => {
  elements.input.value = "";
  elements.clearButton.hidden = true;
  cancelPendingRequest();
  closePanel();
  elements.input.focus();
});

document.addEventListener("pointerdown", (event) => {
  if (!elements.combobox.contains(event.target)) closePanel();
});

window.addEventListener("pagehide", cancelPendingRequest);
