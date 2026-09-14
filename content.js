(function () {
  'use strict';

  // Защищаемся от повторной инициализации при повторной загрузке SPA-страницы.
  if (window.__avitoNotesInitialized) {
    return;
  }

  window.__avitoNotesInitialized = true;

  const STORAGE_KEY = 'avitoNotesByPage';
  const ELEMENT_IDS = {
    toolbar: 'avito-notes-toolbar',
    button: 'avito-notes-button',
    allButton: 'avito-all-notes-button',
    modal: 'avito-notes-modal',
    allModal: 'avito-all-notes-modal',
    textarea: 'avito-notes-textarea',
    info: 'avito-notes-info',
    history: 'avito-notes-history',
    save: 'avito-notes-save',
    close: 'avito-notes-close',
    allClose: 'avito-all-notes-close',
    allList: 'avito-all-notes-list',
    status: 'avito-notes-status',
  };

  let currentPageKey = getPageKey();
  let notes = {};
  let isStorageReady = false;

  createInterface();
  loadNotes();
  observeUrlChanges();

  function getPageKey() {
    // Хэш исключаем: Avito может менять его для внутренних UI-состояний,
    // которые не должны создавать отдельные копии одной заметки.
    const url = new URL(window.location.href);
    url.hash = '';
    return url.toString();
  }

  function createInterface() {
    if (document.getElementById(ELEMENT_IDS.button)) {
      return;
    }

    const button = document.createElement('button');
    button.id = ELEMENT_IDS.button;
    button.type = 'button';
    button.title = 'Открыть заметку для этой страницы';
    button.setAttribute('aria-label', 'Открыть заметку для этой страницы');
    button.textContent = 'Заметка';
    button.addEventListener('click', openModal);

    const allButton = document.createElement('button');
    allButton.id = ELEMENT_IDS.allButton;
    allButton.type = 'button';
    allButton.title = 'Открыть все заметки';
    allButton.setAttribute('aria-label', 'Открыть все заметки');
    allButton.textContent = 'Все заметки';
    allButton.addEventListener('click', openAllNotes);

    const toolbar = document.createElement('div');
    toolbar.id = ELEMENT_IDS.toolbar;
    toolbar.append(button, allButton);

    const modal = document.createElement('div');
    modal.id = ELEMENT_IDS.modal;
    modal.hidden = true;
    modal.innerHTML = `
      <div class="avito-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="avito-notes-title">
        <div class="avito-notes-header">
          <h2 id="avito-notes-title">Заметка для страницы</h2>
          <button id="${ELEMENT_IDS.close}" class="avito-notes-icon-button" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="avito-notes-page" title="Адрес страницы"></div>
        <textarea id="${ELEMENT_IDS.textarea}" placeholder="Напишите заметку..."></textarea>
        <div class="avito-notes-footer">
          <span id="${ELEMENT_IDS.status}" role="status"></span>
          <button id="${ELEMENT_IDS.save}" class="avito-notes-save" type="button">Сохранить</button>
        </div>
        <section id="${ELEMENT_IDS.info}" class="avito-notes-info" aria-label="Основная информация по объявлению"></section>
        <section id="${ELEMENT_IDS.history}" class="avito-notes-history" aria-label="История изменений заметки"></section>
      </div>
    `;

    const allModal = document.createElement('div');
    allModal.id = ELEMENT_IDS.allModal;
    allModal.hidden = true;
    allModal.innerHTML = `
      <div class="avito-notes-all-dialog" role="dialog" aria-modal="true" aria-labelledby="avito-all-notes-title">
        <div class="avito-notes-header">
          <h2 id="avito-all-notes-title">Все заметки</h2>
          <button id="${ELEMENT_IDS.allClose}" class="avito-notes-icon-button" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="${ELEMENT_IDS.allList}" class="avito-notes-all-list"></div>
      </div>
    `;

    document.body.append(toolbar, modal, allModal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });

    modal.querySelector(`#${ELEMENT_IDS.close}`).addEventListener('click', closeModal);
    allModal.addEventListener('click', (event) => {
      if (event.target === allModal) {
        closeAllNotes();
      }
    });
    allModal.querySelector(`#${ELEMENT_IDS.allClose}`).addEventListener('click', closeAllNotes);
    modal.querySelector(`#${ELEMENT_IDS.save}`).addEventListener('click', saveCurrentNote);
    modal.querySelector(`#${ELEMENT_IDS.textarea}`).addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        saveCurrentNote();
      }
    });
  }

  async function loadNotes() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      notes = result[STORAGE_KEY] || {};
      isStorageReady = true;
      updateButtonState();
    } catch (error) {
      console.error('Avito Заметки: не удалось загрузить заметки', error);
    }
  }

  async function saveCurrentNote() {
    const textarea = document.getElementById(ELEMENT_IDS.textarea);
    const status = document.getElementById(ELEMENT_IDS.status);
    const text = textarea.value;
    const currentNote = getCurrentNote();
    const changedAt = new Date().toISOString();

    if (!isStorageReady) {
      status.textContent = 'Хранилище ещё загружается';
      return;
    }

    if (text.trim() === '') {
      if (currentNote && currentNote.createdAt) {
        notes[currentPageKey] = {
          ...currentNote,
          text: '',
          history: appendHistory(currentNote, '', changedAt),
        };
      } else if (currentNote) {
        notes[currentPageKey] = createNote('', changedAt);
      } else {
        return;
      }
    } else if (currentNote && currentNote.createdAt) {
      // При редактировании сохраняем исходные цену и время создания заметки.
      notes[currentPageKey] = {
        ...currentNote,
        text,
        history: text === currentNote.text
          ? getHistory(currentNote)
          : appendHistory(currentNote, text, changedAt),
      };
    } else {
      // Снимок объявления создаётся только при первом сохранении заметки.
      notes[currentPageKey] = createNote(text, changedAt);
    }

    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: notes });
      updateButtonState();
      const savedNote = getCurrentNote();
      renderListingInfo(
        savedNote && savedNote.listing ? savedNote.listing : readListingInfo(),
        Boolean(savedNote && savedNote.createdAt),
      );
      renderHistory();
      status.textContent = text.trim() === '' ? 'Заметка удалена' : 'Сохранено';
      window.setTimeout(() => {
        if (status) {
          status.textContent = '';
        }
      }, 1800);
    } catch (error) {
      status.textContent = 'Не удалось сохранить';
      console.error('Avito Заметки: не удалось сохранить заметку', error);
    }
  }

  function openModal() {
    closeAllNotes();
    const modal = document.getElementById(ELEMENT_IDS.modal);
    const textarea = document.getElementById(ELEMENT_IDS.textarea);
    const pageLabel = modal.querySelector('.avito-notes-page');
    const currentNote = getCurrentNote();

    textarea.value = currentNote ? currentNote.text : '';
    pageLabel.textContent = currentPageKey;
    renderListingInfo(currentNote && currentNote.listing ? currentNote.listing : readListingInfo(), Boolean(currentNote && currentNote.createdAt));
    renderHistory();
    modal.hidden = false;
    textarea.focus();
  }

  function closeModal() {
    document.getElementById(ELEMENT_IDS.modal).hidden = true;
  }

  function openAllNotes() {
    closeModal();
    renderAllNotes();
    document.getElementById(ELEMENT_IDS.allModal).hidden = false;
  }

  function closeAllNotes() {
    const modal = document.getElementById(ELEMENT_IDS.allModal);
    if (modal) {
      modal.hidden = true;
    }
  }

  function updateButtonState() {
    const button = document.getElementById(ELEMENT_IDS.button);
    if (!button) {
      return;
    }

    const currentNote = getCurrentNote();
    const hasNote = Boolean(currentNote && currentNote.text && currentNote.text.trim());
    button.classList.toggle('avito-notes-button-has-note', hasNote);
    button.title = hasNote
      ? 'Открыть заметку для этой страницы (есть заметка)'
      : 'Открыть заметку для этой страницы';
  }

  function getCurrentNote() {
    return normalizeNote(notes[currentPageKey]);
  }

  function normalizeNote(value) {
    if (!value) {
      return null;
    }

    // Поддерживаем заметки, созданные предыдущей версией расширения,
    // где в хранилище лежала обычная строка.
    if (typeof value === 'string') {
      return {
        text: value,
        createdAt: null,
        listing: null,
      };
    }

    return value;
  }

  function createNote(text, createdAt) {
    return {
      text,
      createdAt,
      listing: readListingInfo(),
      history: [
        {
          changedAt: createdAt,
          text,
        },
      ],
    };
  }

  function getHistory(note) {
    return Array.isArray(note.history) ? note.history : [];
  }

  function appendHistory(note, text, changedAt) {
    return [
      ...getHistory(note),
      {
        changedAt,
        text,
      },
    ];
  }

  function readListingInfo() {
    const title = readElementText([
      '[data-marker="item-view/title"]',
      'h1[itemprop="name"]',
      'h1',
    ]);
    const price = readElementText([
      '[data-marker="item-view/item-price"]',
      '[itemprop="price"]',
    ]);
    // На странице Avito этот блок имеет id="bx_item-params".
    // data-marker оставляем запасным вариантом на случай изменения классов.
    const paramsElement = document.querySelector(
      '#bx_item-params, [data-marker="item-view/item-params"], .bx_item-params',
    );

    return {
      title: title || 'Название не найдено',
      price: price || 'Цена не найдена',
      params: readParams(paramsElement),
    };
  }

  function readElementText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }

      const text = normalizeText(element.innerText || element.textContent || '');
      if (text) {
        return text;
      }
    }

    return '';
  }

  function readParams(element) {
    if (!element) {
      return [];
    }

    const rows = Array.from(element.querySelectorAll('tr, li'))
      .map((row) => normalizeText(row.innerText || row.textContent || ''))
      .filter(Boolean);

    if (rows.length > 0) {
      return [...new Set(rows)];
    }

    return (element.innerText || element.textContent || '')
      .split(/\n+/)
      .map(normalizeText)
      .filter(Boolean);
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  function renderListingInfo(info, isCaptured) {
    const container = document.getElementById(ELEMENT_IDS.info);
    if (!container) {
      return;
    }

    container.replaceChildren();

    const heading = document.createElement('h3');
    heading.textContent = 'Основная информация';
    container.appendChild(heading);

    addInfoRow(container, 'Название объявления', info.title);
    addInfoRow(container, isCaptured ? 'Цена при создании заметки' : 'Текущая цена', info.price);

    const paramsTitle = document.createElement('div');
    paramsTitle.className = 'avito-notes-info-label';
    paramsTitle.textContent = 'Параметры';
    container.appendChild(paramsTitle);

    if (info.params && info.params.length > 0) {
      const paramsList = document.createElement('ul');
      paramsList.className = 'avito-notes-params';
      info.params.forEach((param) => {
        const item = document.createElement('li');
        item.textContent = param;
        paramsList.appendChild(item);
      });
      container.appendChild(paramsList);
    } else {
      const emptyParams = document.createElement('div');
      emptyParams.className = 'avito-notes-info-value';
      emptyParams.textContent = 'Параметры не найдены';
      container.appendChild(emptyParams);
    }

    const note = getCurrentNote();
    if (isCaptured && note && note.createdAt) {
      addInfoRow(container, 'Время создания заметки', formatDate(note.createdAt));
    } else {
      const hint = document.createElement('div');
      hint.className = 'avito-notes-info-hint';
      hint.textContent = 'Цена и данные будут зафиксированы при первом сохранении.';
      container.appendChild(hint);
    }
  }

  function renderHistory() {
    const container = document.getElementById(ELEMENT_IDS.history);
    if (!container) {
      return;
    }

    container.replaceChildren();

    const heading = document.createElement('h3');
    heading.textContent = 'История изменений';
    container.appendChild(heading);

    const note = getCurrentNote();
    const history = note ? getHistory(note) : [];

    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'avito-notes-history-empty';
      empty.textContent = 'История пока пуста';
      container.appendChild(empty);
      return;
    }

    [...history].reverse().forEach((entry) => {
      const item = document.createElement('article');
      item.className = 'avito-notes-history-item';

      const date = document.createElement('time');
      date.className = 'avito-notes-history-date';
      date.dateTime = entry.changedAt;
      date.textContent = formatDate(entry.changedAt);

      const text = document.createElement('div');
      text.className = 'avito-notes-history-text';
      text.textContent = entry.text || 'Заметка очищена';

      item.append(date, text);
      container.appendChild(item);
    });
  }

  function renderAllNotes() {
    const container = document.getElementById(ELEMENT_IDS.allList);
    if (!container) {
      return;
    }

    container.replaceChildren();

    const savedNotes = Object.entries(notes)
      .map(([url, value]) => ({ url, note: normalizeNote(value) }))
      .filter(({ note }) => note && note.text && note.text.trim())
      .sort((left, right) => getNoteDate(right.note) - getNoteDate(left.note));

    if (savedNotes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'avito-notes-all-empty';
      empty.textContent = 'Сохранённых заметок пока нет';
      container.appendChild(empty);
      return;
    }

    savedNotes.forEach(({ url, note }) => {
      const card = document.createElement('a');
      card.className = 'avito-notes-all-card';
      card.href = url;
      card.title = 'Открыть объявление';

      const link = document.createElement('div');
      link.className = 'avito-notes-all-link';
      link.textContent = url;

      const title = document.createElement('div');
      title.className = 'avito-notes-all-title';
      title.textContent = note.listing && note.listing.title
        ? note.listing.title
        : 'Название не сохранено';

      const price = document.createElement('div');
      price.className = 'avito-notes-all-price';
      price.textContent = note.listing && note.listing.price
        ? note.listing.price
        : 'Цена не сохранена';

      const preview = document.createElement('div');
      preview.className = 'avito-notes-all-preview';
      preview.textContent = shortenNote(note.text);

      card.append(link, title, price, preview);
      container.appendChild(card);
    });
  }

  function getNoteDate(note) {
    const history = getHistory(note);
    const lastEntry = history[history.length - 1];
    const value = lastEntry ? lastEntry.changedAt : note.createdAt;
    const timestamp = value ? Date.parse(value) : 0;
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function shortenNote(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized;
  }

  function addInfoRow(container, label, value) {
    const row = document.createElement('div');
    row.className = 'avito-notes-info-row';

    const labelElement = document.createElement('div');
    labelElement.className = 'avito-notes-info-label';
    labelElement.textContent = label;

    const valueElement = document.createElement('div');
    valueElement.className = 'avito-notes-info-value';
    valueElement.textContent = value || 'Не найдено';

    row.append(labelElement, valueElement);
    container.appendChild(row);
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(value));
    } catch (error) {
      return value;
    }
  }

  function observeUrlChanges() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      handleUrlChange();
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      handleUrlChange();
    };

    window.addEventListener('popstate', handleUrlChange);
  }

  function handleUrlChange() {
    const nextPageKey = getPageKey();
    if (nextPageKey === currentPageKey) {
      return;
    }

    currentPageKey = nextPageKey;
    updateButtonState();

    if (!document.getElementById(ELEMENT_IDS.modal).hidden) {
      openModal();
    }
  }
})();
