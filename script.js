
(function () {
  'use strict';

  const STORAGE_KEY_TODOS = 'neon_todos_data_v2';
  const STORAGE_KEY_SETTINGS = 'neon_settings_data_v2';
  const STORAGE_KEY_ACTIVE_NOTE = 'neon_active_note_id';

  const THEMES = [
    { id: 'neon-cyan', name: 'Neon Cyan', color: '#00f0ff' },
    { id: 'neon-purple', name: 'Neon Purple', color: '#b026ff' },
    { id: 'neon-pink', name: 'Neon Pink', color: '#ff007f' },
    { id: 'neon-blue', name: 'Neon Blue', color: '#38bdf8' },
    { id: 'neon-green', name: 'Neon Green', color: '#00ff88' },
    { id: 'sunset', name: 'Sunset Orange', color: '#ff7700' },
    { id: 'cyberpunk', name: 'Cyberpunk Gold', color: '#ffd600' },
    { id: 'ocean', name: 'Midnight Ocean', color: '#00e5ff' },
    { id: 'galaxy', name: 'Galaxy Nebula', color: '#c084fc' },
    { id: 'fire', name: 'Fire Matrix', color: '#ff3b30' },
    { id: 'dark-glass', name: 'Dark Glass', color: '#818cf8' },
    { id: 'minimal-white', name: 'Minimal Light', color: '#0284c7' }
  ];

  const EMOJIS = ['📝', '📚', '💡', '⭐', '❤️', '🔥', '🚀', '💻', '📅', '🎯', '📌', '🔒', '⚡', '🌌', '🛠️', '🧬', '🛡️', '👑'];

  // --------------------------------------------------------------------------
  // APPLICATION STATE
  // --------------------------------------------------------------------------
  let state = {
    notes: [],
    todos: [],
    settings: {
      theme: 'neon-cyan',
      particlesEnabled: true,
      audioEnabled: true,
      autosaveInterval: 3000,
      spellcheck: true,
      confirmDelete: true
    },
    activeNoteId: null,
    activePageIndex: 0,
    currentView: 'notes', // notes | todos | favorites | recent | trash | settings
    noteFilterSearch: '',
    noteSort: 'modified-desc',
    todoFilter: 'all',
    todoSort: 'due-asc',
    isSaving: false,
    saveTimeout: null,
    audioCtx: null
  };

  // --------------------------------------------------------------------------
  // AUDIO SYNTHESIZER (Web Audio API)
  // --------------------------------------------------------------------------
  function playSound(type) {
    if (!state.settings.audioEnabled) return;
    try {
      if (!state.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) state.audioCtx = new AudioContext();
      }
      if (!state.audioCtx) return;
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }

      const ctx = state.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'trash') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.15);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (e) {
      console.warn('Audio not available:', e);
    }
  }

  // --------------------------------------------------------------------------
  // PERSISTENCE & SEED DATA
  // --------------------------------------------------------------------------
  function generateId(prefix = 'item') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  function loadFromStorage() {
    try {
      const storedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (storedSettings) {
        state.settings = { ...state.settings, ...JSON.parse(storedSettings) };
      }

      const storedNotes = localStorage.getItem(STORAGE_KEY_NOTES);
      if (storedNotes) {
        state.notes = JSON.parse(storedNotes);
      } else {
        seedInitialNotes();
      }

      const storedTodos = localStorage.getItem(STORAGE_KEY_TODOS);
      if (storedTodos) {
        state.todos = JSON.parse(storedTodos);
      } else {
        seedInitialTodos();
      }

      const lastActiveNote = localStorage.getItem(STORAGE_KEY_ACTIVE_NOTE);
      if (lastActiveNote && state.notes.some(n => n.id === lastActiveNote && !n.isDeleted)) {
        state.activeNoteId = lastActiveNote;
      } else {
        const firstValid = state.notes.find(n => !n.isDeleted);
        state.activeNoteId = firstValid ? firstValid.id : null;
      }
    } catch (err) {
      console.error('Failed to load storage data:', err);
      showToast('Error loading saved data. Initializing defaults.', 'error');
      seedInitialNotes();
      seedInitialTodos();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(state.notes));
      localStorage.setItem(STORAGE_KEY_TODOS, JSON.stringify(state.todos));
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings));
      if (state.activeNoteId) {
        localStorage.setItem(STORAGE_KEY_ACTIVE_NOTE, state.activeNoteId);
      }
      updateSaveIndicator('Saved');
    } catch (err) {
      console.error('Save to localStorage failed:', err);
      updateSaveIndicator('Save Error', 'unsaved');
      showToast('Failed to save to browser storage. LocalStorage may be full.', 'error');
    }
  }

  function triggerAutosave() {
    updateSaveIndicator('Saving...', 'saving');
    if (state.saveTimeout) clearTimeout(state.saveTimeout);
    
    const interval = parseInt(state.settings.autosaveInterval, 10);
    if (interval <= 0) {
      updateSaveIndicator('Unsaved Changes', 'unsaved');
      return;
    }

    state.saveTimeout = setTimeout(() => {
      saveActiveNoteContent();
      saveState();
    }, interval);
  }

  function updateSaveIndicator(text, mode = 'saved') {
    const pill = document.getElementById('save-status-pill');
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('save-status-text');
    if (!pill || !dot || !label) return;

    label.textContent = text;
    dot.className = 'status-dot';
    if (mode === 'saving') dot.classList.add('saving');
    else if (mode === 'unsaved') dot.classList.add('unsaved');
  }

  function seedInitialNotes() {
    state.notes = [
      {
        id: generateId('note'),
        title: '🚀 Neon Matrix Architecture & Notes',
        icon: '🚀',
        iconType: 'emoji',
        theme: 'neon-cyan',
        isFavorite: true,
        isPinned: true,
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pages: [
          {
            id: generateId('page'),
            title: 'Overview',
            content: `<h1>NEON NOTEPAD & TO-DO SUITE</h1>
<p>Welcome to the <strong>futuristic productivity workspace</strong>. Engineered with modern HTML5, CSS3 Glassmorphism, and Vanilla JavaScript.</p>
<blockquote>"The future belongs to those who organize their thoughts with precision."</blockquote>
<h2>✨ Core Capabilities</h2>
<ul>
  <li><strong>Rich Text Editing:</strong> Bold, italic, custom typography, headings, code blocks, quote blocks, and alignment.</li>
  <li><strong>Dynamic Theming:</strong> 12 vibrant cyberpunk and minimal themes customizable per note.</li>
  <li><strong>Interactive Checklists:</strong> Click to toggle items directly in your notes.</li>
  <li><strong>Multi-Page Tab System:</strong> Add multiple pages/sub-tabs within any single note.</li>
  <li><strong>Complete To-Do Manager:</strong> Drag-and-drop tasks with priorities, due dates, and recurrence.</li>
  <li><strong>Trash & Recovery:</strong> Safely restore deleted notes and tasks at any time.</li>
  <li><strong>Export & Backup:</strong> Download as .MD, .HTML, .TXT, Print/PDF, or export full JSON backups.</li>
</ul>
<hr>
<p>⚡ <em>Try editing this text, changing the theme, or creating a new page using the top tabs!</em></p>`
          },
          {
            id: generateId('page'),
            title: 'Keyboard Shortcuts',
            content: `<h2>⚡ Rapid Keyboard Shortcuts</h2>
<p>Boost your productivity with quick matrix combinations:</p>
<ul>
  <li><code>Ctrl + N</code> : Create New Note</li>
  <li><code>Ctrl + S</code> : Instant Force Save</li>
  <li><code>Ctrl + F</code> : Find & Replace in Editor</li>
  <li><code>Ctrl + B</code> : Bold Selection</li>
  <li><code>Ctrl + I</code> : Italic Selection</li>
  <li><code>Ctrl + U</code> : Underline Selection</li>
  <li><code>Ctrl + Shift + D</code> : Download Dialog</li>
</ul>`
          }
        ]
      },
      {
        id: generateId('note'),
        title: '💡 Cyberpunk Ideas & Research',
        icon: '💡',
        iconType: 'emoji',
        theme: 'neon-purple',
        isFavorite: false,
        isPinned: false,
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        pages: [
          {
            id: generateId('page'),
            title: 'Page 1',
            content: `<h2>Neural Interface Notes</h2>
<p>Exploring high-contrast neon user interfaces for modern web application workflows.</p>
<ul class="checklist-group">
  <li class="checklist-item"><input type="checkbox" class="checklist-checkbox" checked> <span>Test custom color palettes</span></li>
  <li class="checklist-item"><input type="checkbox" class="checklist-checkbox"> <span>Implement local drag-and-drop reordering</span></li>
  <li class="checklist-item"><input type="checkbox" class="checklist-checkbox"> <span>Add audio feedback synthesizer</span></li>
</ul>`
          }
        ]
      }
    ];
  }

  function seedInitialTodos() {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    state.todos = [
      {
        id: generateId('task'),
        title: 'Review Project Nexus architecture specifications',
        description: 'Ensure memory efficiency and offline caching support.',
        priority: 'urgent',
        category: 'Work',
        dueDate: today,
        recurrence: 'none',
        isCompleted: false,
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        order: 0
      },
      {
        id: generateId('task'),
        title: 'Configure Neon Notepad custom theme accents',
        description: 'Explore glowing borders and soft neon ambient background.',
        priority: 'high',
        category: 'Project',
        dueDate: tomorrow,
        recurrence: 'weekly',
        isCompleted: true,
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        order: 1
      },
      {
        id: generateId('task'),
        title: 'Backup workspace data to JSON archive',
        description: 'Verify export and import restoration workflow.',
        priority: 'medium',
        category: 'Personal',
        dueDate: '',
        recurrence: 'monthly',
        isCompleted: false,
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        order: 2
      }
    ];
  }

  // --------------------------------------------------------------------------
  // BACKGROUND CYBER CANVAS ANIMATION
  // --------------------------------------------------------------------------
  function initCyberCanvas() {
    const canvas = document.getElementById('cyber-bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const particles = [];
    const count = 35;

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: Math.random() * 2 + 1,
        alpha: Math.random() * 0.5 + 0.2
      });
    }

    function render() {
      if (!state.settings.particlesEnabled) {
        ctx.clearRect(0, 0, width, height);
        requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, width, height);

      // Draw subtle grid lines
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.025)';
      ctx.lineWidth = 1;
      const gridSize = 60;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw particles & linking lines
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.fillStyle = `rgba(0, 240, 255, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 120) {
            ctx.strokeStyle = `rgba(0, 240, 255, ${0.15 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      requestAnimationFrame(render);
    }

    render();
  }

  // --------------------------------------------------------------------------
  // TOAST NOTIFICATIONS
  // --------------------------------------------------------------------------
  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-item ${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    } else {
      iconSvg = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // --------------------------------------------------------------------------
  // MODAL MANAGEMENT
  // --------------------------------------------------------------------------
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('open');
      playSound('click');
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('open');
    }
  }

  function showConfirmDialog(title, message, onConfirm) {
    const modal = document.getElementById('modal-confirm-dialog');
    const titleEl = document.getElementById('confirm-dialog-title');
    const msgEl = document.getElementById('confirm-dialog-message');
    const btnOk = document.getElementById('btn-confirm-ok');
    const btnCancel = document.getElementById('btn-confirm-cancel');

    if (!modal || !titleEl || !msgEl || !btnOk || !btnCancel) {
      if (confirm(message)) onConfirm();
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    const cleanup = () => {
      btnOk.replaceWith(btnOk.cloneNode(true));
      btnCancel.replaceWith(btnCancel.cloneNode(true));
      closeModal('modal-confirm-dialog');
    };

    const newBtnOk = btnOk;
    const newBtnCancel = btnCancel;

    btnOk.onclick = () => {
      cleanup();
      onConfirm();
    };

    btnCancel.onclick = () => {
      cleanup();
    };

    openModal('modal-confirm-dialog');
  }

  // --------------------------------------------------------------------------
  // VIEW SWITCHER
  // --------------------------------------------------------------------------
  function switchView(viewName) {
    state.currentView = viewName;
    playSound('click');

    // Update nav tab styling
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      if (btn.getAttribute('data-view') === viewName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update main panels
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.remove('active-view');
    });

    const targetPanel = document.getElementById(
      viewName === 'notes' || viewName === 'favorites' || viewName === 'recent'
        ? 'view-editor'
        : `view-${viewName}`
    );
    if (targetPanel) targetPanel.classList.add('active-view');

    // Update breadcrumb
    const breadcrumbCat = document.getElementById('breadcrumb-category');
    if (breadcrumbCat) {
      if (viewName === 'notes') breadcrumbCat.textContent = 'All Notes';
      else if (viewName === 'favorites') breadcrumbCat.textContent = 'Favorites';
      else if (viewName === 'recent') breadcrumbCat.textContent = 'Recently Edited';
      else if (viewName === 'todos') breadcrumbCat.textContent = 'To-Do Tasks';
      else if (viewName === 'trash') breadcrumbCat.textContent = 'Trash Bin';
      else if (viewName === 'settings') breadcrumbCat.textContent = 'Settings';
    }

    // Refresh contents
    renderSidebarNotes();
    if (viewName === 'todos') renderTodos();
    if (viewName === 'trash') renderTrashView();
    if (viewName === 'settings') renderSettings();

    // Close mobile sidebar if open
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('mobile-open');
  }

  // --------------------------------------------------------------------------
  // NOTES MANAGEMENT & SIDEBAR
  // --------------------------------------------------------------------------
  function getFilteredNotes() {
    let filtered = state.notes.filter(n => !n.isDeleted);

    if (state.currentView === 'favorites') {
      filtered = filtered.filter(n => n.isFavorite);
    }

    if (state.noteFilterSearch.trim()) {
      const q = state.noteFilterSearch.toLowerCase();
      filtered = filtered.filter(n => {
        const titleMatch = n.title.toLowerCase().includes(q);
        const contentMatch = n.pages.some(p => p.content.toLowerCase().includes(q));
        return titleMatch || contentMatch;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;

      if (state.noteSort === 'modified-desc' || state.currentView === 'recent') {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      } else if (state.noteSort === 'created-desc') {
        return new Date(b.createdAt) - new Date(a.createdAt);
      } else if (state.noteSort === 'created-asc') {
        return new Date(a.createdAt) - new Date(b.createdAt);
      } else if (state.noteSort === 'title-asc') {
        return a.title.localeCompare(b.title);
      } else if (state.noteSort === 'title-desc') {
        return b.title.localeCompare(a.title);
      }
      return 0;
    });

    return filtered;
  }

  function renderSidebarNotes() {
    const listContainer = document.getElementById('notes-list-container');
    if (!listContainer) return;

    const notes = getFilteredNotes();
    updateBadgeCounts();

    if (notes.length === 0) {
      listContainer.innerHTML = `
        <div class="sidebar-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <p>${state.noteFilterSearch ? 'No matching notes found.' : 'No notes available. Create one to get started!'}</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = '';

    notes.forEach(note => {
      const card = document.createElement('div');
      card.className = `note-card-item ${note.id === state.activeNoteId ? 'active' : ''} ${note.isPinned ? 'pinned' : ''}`;
      card.setAttribute('data-id', note.id);

      // Snippet preview (strip HTML)
      const rawText = note.pages[0]?.content
        ? note.pages[0].content.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim()
        : 'Empty note...';

      const formattedDate = formatRelativeTime(note.updatedAt);

      const iconDisplay = note.iconType === 'image'
        ? `<img src="${note.icon}" alt="icon">`
        : (note.icon || '📝');

      card.innerHTML = `
        <div class="note-card-header">
          <div class="note-card-title-group">
            <span class="note-card-icon">${iconDisplay}</span>
            <span class="note-card-title">${escapeHtml(note.title || 'Untitled Note')}</span>
          </div>
          <div class="note-card-actions">
            <button class="card-action-btn pin-btn ${note.isPinned ? 'active' : ''}" title="${note.isPinned ? 'Unpin Note' : 'Pin Note'}" data-action="pin">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${note.isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="17" x2="12" y2="22"></line>
                <path d="M5 17h14v-2l-2-2V5h1V3H6v2h1v8l-2 2v2z"></path>
              </svg>
            </button>
            <button class="card-action-btn fav-btn ${note.isFavorite ? 'active' : ''}" title="${note.isFavorite ? 'Remove Favorite' : 'Mark Favorite'}" data-action="favorite">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${note.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </button>
            <button class="card-action-btn delete-btn" title="Move to Trash" data-action="trash">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="note-card-preview">${escapeHtml(rawText)}</div>
        <div class="note-card-footer">
          <span class="note-card-date">${formattedDate}</span>
          <div class="note-theme-indicator" title="Theme: ${note.theme}"></div>
        </div>
      `;

      // Event delegation for card
      card.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('.card-action-btn');
        if (actionBtn) {
          const action = actionBtn.getAttribute('data-action');
          if (action === 'pin') togglePinNote(note.id);
          else if (action === 'favorite') toggleFavoriteNote(note.id);
          else if (action === 'trash') moveNoteToTrash(note.id);
          e.stopPropagation();
          return;
        }

        selectNote(note.id);
      });

      listContainer.appendChild(card);
    });
  }

  function updateBadgeCounts() {
    const validNotes = state.notes.filter(n => !n.isDeleted);
    const favNotes = validNotes.filter(n => n.isFavorite);
    const pendingTodos = state.todos.filter(t => !t.isDeleted && !t.isCompleted);
    const trashCount = state.notes.filter(n => n.isDeleted).length + state.todos.filter(t => t.isDeleted).length;

    const elNotes = document.getElementById('count-all-notes');
    const elTodos = document.getElementById('count-todos');
    const elFavs = document.getElementById('count-favorites');
    const elTrash = document.getElementById('count-trash');
    const elTotalNotes = document.getElementById('notes-total-label');

    if (elNotes) elNotes.textContent = validNotes.length;
    if (elTodos) elTodos.textContent = pendingTodos.length;
    if (elFavs) elFavs.textContent = favNotes.length;
    if (elTrash) elTrash.textContent = trashCount;
    if (elTotalNotes) elTotalNotes.textContent = `${validNotes.length} Notes`;
  }

  function createNewNote() {
    const newNote = {
      id: generateId('note'),
      title: 'Untitled Note',
      icon: '📝',
      iconType: 'emoji',
      theme: state.settings.theme || 'neon-cyan',
      isFavorite: false,
      isPinned: false,
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pages: [
        {
          id: generateId('page'),
          title: 'Page 1',
          content: '<p>Start typing here...</p>'
        }
      ]
    };

    state.notes.unshift(newNote);
    state.activeNoteId = newNote.id;
    state.activePageIndex = 0;

    saveState();
    switchView('notes');
    loadActiveNoteIntoEditor();
    playSound('success');
    showToast('New note created.', 'success');

    // Focus editor
    const titleInput = document.getElementById('note-title-input');
    if (titleInput) {
      titleInput.focus();
      titleInput.select();
    }
  }

  function selectNote(noteId) {
    if (state.activeNoteId === noteId && state.currentView === 'notes') return;
    saveActiveNoteContent();
    state.activeNoteId = noteId;
    state.activePageIndex = 0;
    saveState();
    switchView('notes');
    loadActiveNoteIntoEditor();
  }

  function togglePinNote(noteId) {
    const note = state.notes.find(n => n.id === noteId);
    if (!note) return;
    note.isPinned = !note.isPinned;
    note.updatedAt = new Date().toISOString();
    saveState();
    renderSidebarNotes();
    playSound('click');
    showToast(note.isPinned ? 'Note pinned to top.' : 'Note unpinned.', 'info');
  }

  function toggleFavoriteNote(noteId) {
    const note = state.notes.find(n => n.id === noteId);
    if (!note) return;
    note.isFavorite = !note.isFavorite;
    note.updatedAt = new Date().toISOString();
    saveState();
    renderSidebarNotes();
    updateEditorFavoriteButton();
    playSound('click');
    showToast(note.isFavorite ? 'Added to Favorites ⭐' : 'Removed from Favorites.', 'info');
  }

  function moveNoteToTrash(noteId) {
    const note = state.notes.find(n => n.id === noteId);
    if (!note) return;

    const performTrash = () => {
      note.isDeleted = true;
      note.deletedAt = new Date().toISOString();
      saveState();

      if (state.activeNoteId === noteId) {
        const nextValid = state.notes.find(n => !n.isDeleted);
        state.activeNoteId = nextValid ? nextValid.id : null;
        state.activePageIndex = 0;
      }

      renderSidebarNotes();
      loadActiveNoteIntoEditor();
      playSound('trash');
      showToast('Note moved to Trash.', 'info');
    };

    if (state.settings.confirmDelete) {
      showConfirmDialog('Move Note to Trash', `Are you sure you want to move "${note.title}" to the Trash?`, performTrash);
    } else {
      performTrash();
    }
  }

  function duplicateNote(noteId) {
    const note = state.notes.find(n => n.id === noteId);
    if (!note) return;

    const dup = JSON.parse(JSON.stringify(note));
    dup.id = generateId('note');
    dup.title = `${note.title} (Copy)`;
    dup.isPinned = false;
    dup.createdAt = new Date().toISOString();
    dup.updatedAt = new Date().toISOString();
    dup.pages.forEach(p => (p.id = generateId('page')));

    state.notes.unshift(dup);
    state.activeNoteId = dup.id;
    state.activePageIndex = 0;
    saveState();
    renderSidebarNotes();
    loadActiveNoteIntoEditor();
    playSound('success');
    showToast('Note duplicated successfully.', 'success');
  }

  // --------------------------------------------------------------------------
  // EDITOR VIEW & CONTENT LOGIC
  // --------------------------------------------------------------------------
  function getActiveNote() {
    return state.notes.find(n => n.id === state.activeNoteId && !n.isDeleted) || null;
  }

  function loadActiveNoteIntoEditor() {
    const note = getActiveNote();
    const titleInput = document.getElementById('note-title-input');
    const editorContent = document.getElementById('note-editor-content');
    const iconBtn = document.getElementById('note-icon-btn');
    const breadcrumbTitle = document.getElementById('breadcrumb-current-title');

    if (!note) {
      if (titleInput) titleInput.value = '';
      if (editorContent) editorContent.innerHTML = '<p style="color: var(--text-dim); text-align: center; margin-top: 40px;">No note selected. Click "+ New Note" in the sidebar to create one.</p>';
      if (breadcrumbTitle) breadcrumbTitle.textContent = 'None';
      renderPageTabs([]);
      updateStats();
      return;
    }

    if (titleInput) titleInput.value = note.title || '';
    if (breadcrumbTitle) breadcrumbTitle.textContent = note.title || 'Untitled Note';

    // Set icon
    if (iconBtn) {
      if (note.iconType === 'image') {
        iconBtn.innerHTML = `<img src="${note.icon}" alt="note icon">`;
      } else {
        iconBtn.textContent = note.icon || '📝';
      }
    }

    // Apply note specific theme to body
    applyTheme(note.theme || state.settings.theme);

    // Render pages tab
    renderPageTabs(note.pages);

    // Load active page content
    const page = note.pages[state.activePageIndex] || note.pages[0];
    if (editorContent) {
      editorContent.innerHTML = page?.content || '';
    }

    updateEditorFavoriteButton();
    updateStats();
  }

  function saveActiveNoteContent() {
    const note = getActiveNote();
    if (!note) return;

    const titleInput = document.getElementById('note-title-input');
    const editorContent = document.getElementById('note-editor-content');

    if (titleInput) note.title = titleInput.value.trim() || 'Untitled Note';
    if (editorContent && note.pages[state.activePageIndex]) {
      note.pages[state.activePageIndex].content = editorContent.innerHTML;
    }

    note.updatedAt = new Date().toISOString();
    renderSidebarNotes();
  }

  function renderPageTabs(pages) {
    const tabsBar = document.getElementById('page-tabs-bar');
    if (!tabsBar) return;

    // Keep the "New Page" button
    const btnAdd = document.getElementById('btn-add-page');
    tabsBar.innerHTML = '';

    if (!pages || pages.length === 0) {
      if (btnAdd) tabsBar.appendChild(btnAdd);
      return;
    }

    pages.forEach((page, idx) => {
      const tab = document.createElement('div');
      tab.className = `page-tab-item ${idx === state.activePageIndex ? 'active' : ''}`;
      tab.setAttribute('data-page-idx', idx);

      tab.innerHTML = `
        <span class="page-tab-title">${escapeHtml(page.title || `Page ${idx + 1}`)}</span>
        ${pages.length > 1 ? '<span class="page-tab-close" title="Close / Delete Page">✕</span>' : ''}
      `;

      tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('page-tab-close')) {
          deletePage(idx);
          e.stopPropagation();
          return;
        }

        saveActiveNoteContent();
        state.activePageIndex = idx;
        loadActiveNoteIntoEditor();
        playSound('click');
      });

      // Double click to rename page
      tab.addEventListener('dblclick', () => {
        const newName = prompt('Rename Page:', page.title);
        if (newName && newName.trim()) {
          page.title = newName.trim();
          saveState();
          renderPageTabs(pages);
        }
      });

      tabsBar.appendChild(tab);
    });

    if (btnAdd) tabsBar.appendChild(btnAdd);
  }

  function addNewPage() {
    const note = getActiveNote();
    if (!note) return;

    saveActiveNoteContent();
    const newPage = {
      id: generateId('page'),
      title: `Page ${note.pages.length + 1}`,
      content: '<p>New page content...</p>'
    };

    note.pages.push(newPage);
    state.activePageIndex = note.pages.length - 1;
    saveState();
    loadActiveNoteIntoEditor();
    playSound('success');
    showToast('New page added to note.', 'success');
  }

  function deletePage(pageIdx) {
    const note = getActiveNote();
    if (!note || note.pages.length <= 1) return;

    showConfirmDialog('Delete Page', `Are you sure you want to remove ${note.pages[pageIdx].title}?`, () => {
      note.pages.splice(pageIdx, 1);
      if (state.activePageIndex >= note.pages.length) {
        state.activePageIndex = note.pages.length - 1;
      }
      saveState();
      loadActiveNoteIntoEditor();
      playSound('trash');
      showToast('Page removed.', 'info');
    });
  }

  function updateEditorFavoriteButton() {
    const note = getActiveNote();
    const btn = document.getElementById('btn-note-favorite');
    const label = document.getElementById('fav-btn-label');
    if (!btn || !label) return;

    if (note && note.isFavorite) {
      btn.classList.add('primary');
      label.textContent = 'Starred';
    } else {
      btn.classList.remove('primary');
      label.textContent = 'Star';
    }
  }

  function updateStats() {
    const editorContent = document.getElementById('note-editor-content');
    const note = getActiveNote();
    if (!editorContent || !note) return;

    const text = editorContent.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const sentences = text.trim() ? (text.match(/[^.!?]+[.!?]+/g) || []).length : 0;
    const readingTime = Math.ceil(words / 200);

    const statWords = document.getElementById('stat-words');
    const statChars = document.getElementById('stat-chars');
    const statSentences = document.getElementById('stat-sentences');
    const statReadingTime = document.getElementById('stat-reading-time');
    const statLastMod = document.getElementById('stat-last-modified');

    if (statWords) statWords.textContent = words;
    if (statChars) statChars.textContent = chars;
    if (statSentences) statSentences.textContent = sentences;
    if (statReadingTime) statReadingTime.textContent = `~${readingTime} min`;
    if (statLastMod) statLastMod.textContent = `Last saved: ${formatRelativeTime(note.updatedAt)}`;
  }

  // --------------------------------------------------------------------------
  // RICH TEXT FORMATTING COMMANDS
  // --------------------------------------------------------------------------
  function formatDoc(command, value = null) {
    document.execCommand(command, false, value);
    const editor = document.getElementById('note-editor-content');
    if (editor) editor.focus();
    triggerAutosave();
  }

  function insertChecklist() {
    const editor = document.getElementById('note-editor-content');
    if (!editor) return;

    const checklistHtml = `
      <div class="checklist-item">
        <input type="checkbox" class="checklist-checkbox">
        <span>Task item...</span>
      </div>
    `;
    document.execCommand('insertHTML', false, checklistHtml);
    triggerAutosave();
  }

  function insertImageIntoEditor(src) {
    const editor = document.getElementById('note-editor-content');
    if (!editor || !src) return;

    const imgWrapper = `
      <div class="editor-img-wrapper" contenteditable="false">
        <img src="${src}" alt="Inserted Image">
        <button class="img-remove-btn" onclick="this.parentElement.remove()">✕ Remove</button>
      </div><p></p>
    `;
    document.execCommand('insertHTML', false, imgWrapper);
    triggerAutosave();
    showToast('Image inserted.', 'success');
  }

  // --------------------------------------------------------------------------
  // FIND & REPLACE IN NOTE
  // --------------------------------------------------------------------------
  let findIndex = 0;
  let findMatches = [];

  function performFind(direction = 1) {
    const query = document.getElementById('find-query-input')?.value;
    const editor = document.getElementById('note-editor-content');
    if (!query || !editor) return;

    if (window.find) {
      const found = window.find(query, false, direction === -1, true, false, false, false);
      if (!found) {
        showToast('No more matches found.', 'info');
      }
    }
  }

  function performReplace(all = false) {
    const findQuery = document.getElementById('find-query-input')?.value;
    const replaceQuery = document.getElementById('replace-query-input')?.value || '';
    const editor = document.getElementById('note-editor-content');
    if (!findQuery || !editor) return;

    if (all) {
      const regex = new RegExp(escapeRegex(findQuery), 'gi');
      editor.innerHTML = editor.innerHTML.replace(regex, replaceQuery);
      showToast('All occurrences replaced.', 'success');
      triggerAutosave();
    } else {
      document.execCommand('insertText', false, replaceQuery);
      performFind(1);
    }
  }

  // --------------------------------------------------------------------------
  // TO-DO TASK MANAGER
  // --------------------------------------------------------------------------
  function getFilteredTodos() {
    let filtered = state.todos.filter(t => !t.isDeleted);

    if (state.todoFilter === 'active') {
      filtered = filtered.filter(t => !t.isCompleted);
    } else if (state.todoFilter === 'completed') {
      filtered = filtered.filter(t => t.isCompleted);
    } else if (state.todoFilter === 'today') {
      const todayStr = new Date().toISOString().split('T')[0];
      filtered = filtered.filter(t => t.dueDate === todayStr);
    } else if (state.todoFilter === 'upcoming') {
      const todayStr = new Date().toISOString().split('T')[0];
      filtered = filtered.filter(t => t.dueDate && t.dueDate > todayStr);
    } else if (state.todoFilter === 'urgent') {
      filtered = filtered.filter(t => t.priority === 'urgent' || t.priority === 'high');
    }

    // Sorting
    filtered.sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;

      if (state.todoSort === 'due-asc') {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      } else if (state.todoSort === 'priority-desc') {
        const pMap = { urgent: 4, high: 3, medium: 2, low: 1 };
        return (pMap[b.priority] || 0) - (pMap[a.priority] || 0);
      } else if (state.todoSort === 'created-desc') {
        return new Date(b.createdAt) - new Date(a.createdAt);
      } else if (state.todoSort === 'title-asc') {
        return a.title.localeCompare(b.title);
      }
      return (a.order || 0) - (b.order || 0);
    });

    return filtered;
  }

  function renderTodos() {
    const listContainer = document.getElementById('tasks-list-container');
    if (!listContainer) return;

    const tasks = getFilteredTodos();
    updateTodoStats();

    if (tasks.length === 0) {
      listContainer.innerHTML = `
        <div class="sidebar-empty-state" style="padding: 60px 0;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          <p>No tasks matching the selected filter. Add one above!</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = '';
    const todayStr = new Date().toISOString().split('T')[0];

    tasks.forEach(task => {
      const isOverdue = task.dueDate && task.dueDate < todayStr && !task.isCompleted;

      const card = document.createElement('div');
      card.className = `task-card ${task.isCompleted ? 'completed' : ''}`;
      card.setAttribute('draggable', 'true');
      card.setAttribute('data-id', task.id);

      card.innerHTML = `
        <div class="task-left-content">
          <div class="task-checkbox-custom" data-action="toggle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <div class="task-info-block">
            <div class="task-title-text">${escapeHtml(task.title)}</div>
            ${task.description ? `<div class="task-description-text">${escapeHtml(task.description)}</div>` : ''}
            <div class="task-badges-row">
              <span class="priority-badge priority-${task.priority}">${task.priority}</span>
              ${task.category ? `<span class="category-tag">${escapeHtml(task.category)}</span>` : ''}
              ${task.dueDate ? `
                <span class="due-date-badge ${isOverdue ? 'overdue' : ''}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  ${isOverdue ? 'OVERDUE: ' : 'Due: '}${task.dueDate}
                </span>` : ''}
              ${task.recurrence && task.recurrence !== 'none' ? `
                <span class="recurrence-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                  ${task.recurrence}
                </span>` : ''}
            </div>
          </div>
        </div>
        <div class="task-right-actions">
          <button class="card-action-btn" title="Delete Task" data-action="delete">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path></svg>
          </button>
        </div>
      `;

      // Drag and drop event listeners
      setupDragAndDrop(card, task.id);

      card.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-action]');
        if (!actionBtn) return;
        const action = actionBtn.getAttribute('data-action');

        if (action === 'toggle') {
          toggleTaskCompleted(task.id);
        } else if (action === 'delete') {
          deleteTask(task.id);
        }
      });

      listContainer.appendChild(card);
    });
  }

  function updateTodoStats() {
    const validTasks = state.todos.filter(t => !t.isDeleted);
    const total = validTasks.length;
    const completed = validTasks.filter(t => t.isCompleted).length;
    const active = total - completed;

    const todayStr = new Date().toISOString().split('T')[0];
    const overdue = validTasks.filter(t => t.dueDate && t.dueDate < todayStr && !t.isCompleted).length;

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    const elTotal = document.getElementById('stat-todo-total');
    const elCompleted = document.getElementById('stat-todo-completed');
    const elActive = document.getElementById('stat-todo-active');
    const elOverdue = document.getElementById('stat-todo-overdue');
    const elPercent = document.getElementById('todo-progress-percent');
    const elFill = document.getElementById('todo-progress-fill');

    if (elTotal) elTotal.textContent = total;
    if (elCompleted) elCompleted.textContent = completed;
    if (elActive) elActive.textContent = active;
    if (elOverdue) elOverdue.textContent = overdue;
    if (elPercent) elPercent.textContent = `${percent}%`;
    if (elFill) elFill.style.width = `${percent}%`;
  }

  function addNewTask() {
    const titleInput = document.getElementById('new-task-title');
    const prioritySelect = document.getElementById('new-task-priority');
    const categorySelect = document.getElementById('new-task-category');
    const duedateInput = document.getElementById('new-task-duedate');
    const recurrenceSelect = document.getElementById('new-task-recurrence');
    const descInput = document.getElementById('new-task-desc');

    if (!titleInput || !titleInput.value.trim()) {
      showToast('Please enter a task title.', 'error');
      if (titleInput) titleInput.focus();
      return;
    }

    const newTask = {
      id: generateId('task'),
      title: titleInput.value.trim(),
      description: descInput ? descInput.value.trim() : '',
      priority: prioritySelect ? prioritySelect.value : 'medium',
      category: categorySelect ? categorySelect.value : 'Work',
      dueDate: duedateInput ? duedateInput.value : '',
      recurrence: recurrenceSelect ? recurrenceSelect.value : 'none',
      isCompleted: false,
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      order: state.todos.length
    };

    state.todos.unshift(newTask);
    saveState();

    // Reset inputs
    titleInput.value = '';
    if (descInput) descInput.value = '';
    if (duedateInput) duedateInput.value = '';

    renderTodos();
    updateBadgeCounts();
    playSound('success');
    showToast('Task added to matrix.', 'success');
  }

  function toggleTaskCompleted(taskId) {
    const task = state.todos.find(t => t.id === taskId);
    if (!task) return;

    task.isCompleted = !task.isCompleted;

    // Handle recurring tasks on complete
    if (task.isCompleted && task.recurrence && task.recurrence !== 'none') {
      const nextDate = calculateNextRecurrence(task.dueDate || new Date().toISOString().split('T')[0], task.recurrence);
      const nextTask = {
        ...task,
        id: generateId('task'),
        isCompleted: false,
        dueDate: nextDate,
        createdAt: new Date().toISOString(),
        order: state.todos.length
      };
      state.todos.push(nextTask);
      showToast(`Recurring task scheduled for ${nextDate}`, 'info');
    }

    saveState();
    renderTodos();
    updateBadgeCounts();
    playSound(task.isCompleted ? 'success' : 'click');
  }

  function calculateNextRecurrence(baseDateStr, recurrence) {
    const date = new Date(baseDateStr);
    if (recurrence === 'daily') date.setDate(date.getDate() + 1);
    else if (recurrence === 'weekly') date.setDate(date.getDate() + 7);
    else if (recurrence === 'monthly') date.setMonth(date.getMonth() + 1);
    return date.toISOString().split('T')[0];
  }

  function deleteTask(taskId) {
    const task = state.todos.find(t => t.id === taskId);
    if (!task) return;

    task.isDeleted = true;
    task.deletedAt = new Date().toISOString();
    saveState();
    renderTodos();
    updateBadgeCounts();
    playSound('trash');
    showToast('Task moved to trash.', 'info');
  }

  function clearCompletedTasks() {
    const completedTasks = state.todos.filter(t => !t.isDeleted && t.isCompleted);
    if (completedTasks.length === 0) {
      showToast('No completed tasks to clear.', 'info');
      return;
    }

    showConfirmDialog('Clear Completed Tasks', `Move ${completedTasks.length} completed tasks to Trash?`, () => {
      completedTasks.forEach(t => {
        t.isDeleted = true;
        t.deletedAt = new Date().toISOString();
      });
      saveState();
      renderTodos();
      updateBadgeCounts();
      playSound('trash');
      showToast('Completed tasks cleared.', 'info');
    });
  }

  // Drag and Drop ordering for tasks
  let draggedTaskId = null;

  function setupDragAndDrop(cardEl, taskId) {
    cardEl.addEventListener('dragstart', (e) => {
      draggedTaskId = taskId;
      cardEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
      draggedTaskId = null;
    });

    cardEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    cardEl.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedTaskId || draggedTaskId === taskId) return;

      const fromIndex = state.todos.findIndex(t => t.id === draggedTaskId);
      const toIndex = state.todos.findIndex(t => t.id === taskId);

      if (fromIndex !== -1 && toIndex !== -1) {
        const [movedTask] = state.todos.splice(fromIndex, 1);
        state.todos.splice(toIndex, 0, movedTask);

        state.todos.forEach((t, i) => (t.order = i));
        saveState();
        renderTodos();
        playSound('click');
      }
    });
  }

  // --------------------------------------------------------------------------
  // TRASH & RECOVERY
  // --------------------------------------------------------------------------
  function renderTrashView() {
    const notesGrid = document.getElementById('trash-notes-grid');
    const tasksGrid = document.getElementById('trash-tasks-grid');
    if (!notesGrid || !tasksGrid) return;

    const deletedNotes = state.notes.filter(n => n.isDeleted);
    const deletedTasks = state.todos.filter(t => t.isDeleted);

    // Render Deleted Notes
    if (deletedNotes.length === 0) {
      notesGrid.innerHTML = '<p style="color: var(--text-dim); font-size: 13px;">No notes in trash.</p>';
    } else {
      notesGrid.innerHTML = '';
      deletedNotes.forEach(note => {
        const card = document.createElement('div');
        card.className = 'trash-card';
        card.innerHTML = `
          <div class="trash-card-title">${escapeHtml(note.title)}</div>
          <div class="trash-card-date">Deleted: ${formatRelativeTime(note.deletedAt)}</div>
          <div class="trash-card-actions">
            <button class="btn-header-action" data-restore="note" data-id="${note.id}">Restore</button>
            <button class="btn-header-action" data-purge="note" data-id="${note.id}" style="color: var(--neon-red);">Delete Forever</button>
          </div>
        `;
        notesGrid.appendChild(card);
      });
    }

    // Render Deleted Tasks
    if (deletedTasks.length === 0) {
      tasksGrid.innerHTML = '<p style="color: var(--text-dim); font-size: 13px;">No tasks in trash.</p>';
    } else {
      tasksGrid.innerHTML = '';
      deletedTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'trash-card';
        card.innerHTML = `
          <div class="trash-card-title">${escapeHtml(task.title)}</div>
          <div class="trash-card-date">Deleted: ${formatRelativeTime(task.deletedAt)}</div>
          <div class="trash-card-actions">
            <button class="btn-header-action" data-restore="task" data-id="${task.id}">Restore</button>
            <button class="btn-header-action" data-purge="task" data-id="${task.id}" style="color: var(--neon-red);">Delete Forever</button>
          </div>
        `;
        tasksGrid.appendChild(card);
      });
    }

    // Delegate trash card buttons
    const handleTrashAction = (e) => {
      const restoreBtn = e.target.closest('[data-restore]');
      const purgeBtn = e.target.closest('[data-purge]');

      if (restoreBtn) {
        const type = restoreBtn.getAttribute('data-restore');
        const id = restoreBtn.getAttribute('data-id');
        restoreItem(type, id);
      } else if (purgeBtn) {
        const type = purgeBtn.getAttribute('data-purge');
        const id = purgeBtn.getAttribute('data-id');
        purgeItem(type, id);
      }
    };

    notesGrid.onclick = handleTrashAction;
    tasksGrid.onclick = handleTrashAction;
  }

  function restoreItem(type, id) {
    if (type === 'note') {
      const note = state.notes.find(n => n.id === id);
      if (note) {
        note.isDeleted = false;
        note.deletedAt = null;
        state.activeNoteId = note.id;
        showToast(`Restored "${note.title}".`, 'success');
      }
    } else if (type === 'task') {
      const task = state.todos.find(t => t.id === id);
      if (task) {
        task.isDeleted = false;
        task.deletedAt = null;
        showToast(`Restored task.`, 'success');
      }
    }

    saveState();
    renderTrashView();
    updateBadgeCounts();
    playSound('success');
  }

  function purgeItem(type, id) {
    showConfirmDialog('Permanent Deletion', 'This item will be permanently erased. Proceed?', () => {
      if (type === 'note') {
        state.notes = state.notes.filter(n => n.id !== id);
      } else if (type === 'task') {
        state.todos = state.todos.filter(t => t.id !== id);
      }
      saveState();
      renderTrashView();
      updateBadgeCounts();
      playSound('trash');
      showToast('Item permanently deleted.', 'info');
    });
  }

  function emptyAllTrash() {
    const trashCount = state.notes.filter(n => n.isDeleted).length + state.todos.filter(t => t.isDeleted).length;
    if (trashCount === 0) {
      showToast('Trash is already empty.', 'info');
      return;
    }

    showConfirmDialog('Empty Trash', `Permanently delete all ${trashCount} items in the trash? This cannot be undone.`, () => {
      state.notes = state.notes.filter(n => !n.isDeleted);
      state.todos = state.todos.filter(t => !t.isDeleted);
      saveState();
      renderTrashView();
      updateBadgeCounts();
      playSound('trash');
      showToast('Trash emptied permanently.', 'success');
    });
  }

  function restoreAllTrash() {
    state.notes.forEach(n => { n.isDeleted = false; n.deletedAt = null; });
    state.todos.forEach(t => { t.isDeleted = false; t.deletedAt = null; });
    saveState();
    renderTrashView();
    updateBadgeCounts();
    playSound('success');
    showToast('All items restored from trash.', 'success');
  }

  // --------------------------------------------------------------------------
  // THEMES & CUSTOMIZATION
  // --------------------------------------------------------------------------
  function applyTheme(themeId) {
    document.body.setAttribute('data-theme', themeId);
    state.settings.theme = themeId;
  }

  function renderSettings() {
    const swatchesGrid = document.getElementById('theme-swatches-grid');
    if (!swatchesGrid) return;

    swatchesGrid.innerHTML = '';
    THEMES.forEach(t => {
      const card = document.createElement('div');
      card.className = `theme-card-option ${document.body.getAttribute('data-theme') === t.id ? 'active' : ''}`;
      card.innerHTML = `
        <div class="theme-preview-bubble" style="background: ${t.color}; box-shadow: 0 0 10px ${t.color};"></div>
        <span class="theme-option-name">${t.name}</span>
      `;
      card.onclick = () => {
        applyTheme(t.id);
        const activeNote = getActiveNote();
        if (activeNote) {
          activeNote.theme = t.id;
          saveState();
        }
        renderSettings();
        playSound('click');
        showToast(`Theme changed to ${t.name}`, 'info');
      };
      swatchesGrid.appendChild(card);
    });

    const chkParticles = document.getElementById('setting-toggle-particles');
    const chkAudio = document.getElementById('setting-toggle-audio');
    const chkSpellcheck = document.getElementById('setting-toggle-spellcheck');
    const chkConfirm = document.getElementById('setting-toggle-confirm');
    const selAutosave = document.getElementById('setting-autosave-interval');

    if (chkParticles) chkParticles.checked = state.settings.particlesEnabled;
    if (chkAudio) chkAudio.checked = state.settings.audioEnabled;
    if (chkSpellcheck) chkSpellcheck.checked = state.settings.spellcheck;
    if (chkConfirm) chkConfirm.checked = state.settings.confirmDelete;
    if (selAutosave) selAutosave.value = state.settings.autosaveInterval;
  }

  // --------------------------------------------------------------------------
  // DOWNLOAD & EXPORT SYSTEM
  // --------------------------------------------------------------------------
  function downloadNoteAs(format) {
    const note = getActiveNote();
    if (!note) {
      showToast('No note selected to download.', 'error');
      return;
    }

    const title = (note.title || 'Untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const content = note.pages.map(p => `## ${p.title}\n\n${p.content}`).join('\n\n---\n\n');

    let fileContent = '';
    let mimeType = 'text/plain';
    let ext = 'txt';

    if (format === 'md') {
      // Basic HTML to Markdown converter
      fileContent = `# ${note.title}\n\n` + htmlToMarkdown(note.pages[state.activePageIndex]?.content || '');
      mimeType = 'text/markdown';
      ext = 'md';
    } else if (format === 'html') {
      fileContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(note.title)}</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; background: #0c0f1d; color: #f1f5f9; }
  h1, h2, h3 { color: #00f0ff; }
  blockquote { border-left: 4px solid #00f0ff; padding-left: 16px; color: #94a3b8; }
  code { background: rgba(0,0,0,0.5); color: #00ff88; padding: 2px 6px; border-radius: 4px; }
  hr { border: none; height: 1px; background: #00f0ff; margin: 2em 0; }
</style>
</head>
<body>
<h1>${escapeHtml(note.title)}</h1>
${note.pages.map((p, idx) => `<h2>${escapeHtml(p.title)}</h2>${p.content}`).join('<hr>')}
</body>
</html>`;
      mimeType = 'text/html';
      ext = 'html';
    } else if (format === 'txt') {
      fileContent = `${note.title}\n${'='.repeat(note.title.length)}\n\n` +
        note.pages.map(p => `[${p.title}]\n${p.content.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim()}`).join('\n\n');
      mimeType = 'text/plain';
      ext = 'txt';
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    closeModal('modal-download-dialog');
    playSound('success');
    showToast(`Downloaded note as .${ext}`, 'success');
  }

  function htmlToMarkdown(html) {
    return html
      .replace(/<h1>(.*?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2>(.*?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3>(.*?)<\/h3>/gi, '### $1\n\n')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i>(.*?)<\/i>/gi, '*$1*')
      .replace(/<blockquote>(.*?)<\/blockquote>/gi, '> $1\n\n')
      .replace(/<code>(.*?)<\/code>/gi, '`$1`')
      .replace(/<pre>(.*?)<\/pre>/gi, '```\n$1\n```\n\n')
      .replace(/<hr>/gi, '\n---\n\n')
      .replace(/<p>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<[^>]+>/gi, '');
  }

  // Full JSON Backup & Restore
  function exportFullBackup() {
    const backupData = {
      version: '2.5',
      exportDate: new Date().toISOString(),
      notes: state.notes,
      todos: state.todos,
      settings: state.settings
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neon_notepad_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    playSound('success');
    showToast('Full backup exported successfully.', 'success');
  }

  function importFullBackup(file) {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.notes || !Array.isArray(data.notes)) {
          throw new Error('Invalid backup schema: missing notes collection.');
        }

        showConfirmDialog('Restore Backup', `This will replace your current data with ${data.notes.length} notes and ${data.todos?.length || 0} tasks. Continue?`, () => {
          state.notes = data.notes;
          state.todos = Array.isArray(data.todos) ? data.todos : [];
          if (data.settings) state.settings = { ...state.settings, ...data.settings };

          const firstNote = state.notes.find(n => !n.isDeleted);
          state.activeNoteId = firstNote ? firstNote.id : null;
          state.activePageIndex = 0;

          saveState();
          applyTheme(state.settings.theme);
          renderSidebarNotes();
          loadActiveNoteIntoEditor();
          renderTodos();
          renderSettings();

          playSound('success');
          showToast('Backup restored successfully!', 'success');
        });
      } catch (err) {
        console.error('Backup import error:', err);
        showToast(`Failed to parse backup file: ${err.message}`, 'error');
      }
    };

    reader.readAsText(file);
  }

  function resetAllData() {
    showConfirmDialog('Factory Reset', 'Are you ABSOLUTELY sure? This will wipe all notes, tasks, and settings forever!', () => {
      localStorage.clear();
      seedInitialNotes();
      seedInitialTodos();
      state.settings = {
        theme: 'neon-cyan',
        particlesEnabled: true,
        audioEnabled: true,
        autosaveInterval: 3000,
        spellcheck: true,
        confirmDelete: true
      };
      state.activeNoteId = state.notes[0].id;
      state.activePageIndex = 0;

      saveState();
      applyTheme('neon-cyan');
      renderSidebarNotes();
      loadActiveNoteIntoEditor();
      renderTodos();
      renderSettings();

      playSound('trash');
      showToast('All local data has been reset to defaults.', 'info');
    });
  }

  // --------------------------------------------------------------------------
  // EVENT LISTENERS INITIALIZATION
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Mobile navigation toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
        playSound('click');
      });
    }

    // New Note Button
    document.getElementById('btn-new-note')?.addEventListener('click', createNewNote);

    // Sidebar navigation tabs
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        switchView(view);
      });
    });

    // Sidebar search
    const searchInput = document.getElementById('sidebar-search-input');
    const searchClear = document.getElementById('search-clear-btn');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.noteFilterSearch = searchInput.value;
        if (searchClear) searchClear.style.display = searchInput.value ? 'flex' : 'none';
        renderSidebarNotes();
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        state.noteFilterSearch = '';
        searchClear.style.display = 'none';
        renderSidebarNotes();
      });
    }

    // Sidebar sort dropdown
    document.getElementById('notes-sort-select')?.addEventListener('change', (e) => {
      state.noteSort = e.target.value;
      renderSidebarNotes();
    });

    // Top action buttons
    document.getElementById('btn-global-search')?.addEventListener('click', () => {
      if (searchInput) {
        if (sidebar) sidebar.classList.add('mobile-open');
        searchInput.focus();
        searchInput.select();
      }
    });

    document.getElementById('btn-quick-theme')?.addEventListener('click', () => {
      const currentTheme = document.body.getAttribute('data-theme');
      const currentIndex = THEMES.findIndex(t => t.id === currentTheme);
      const nextTheme = THEMES[(currentIndex + 1) % THEMES.length].id;
      applyTheme(nextTheme);
      const note = getActiveNote();
      if (note) {
        note.theme = nextTheme;
        saveState();
      }
      showToast(`Switched to ${nextTheme}`, 'info');
      playSound('click');
    });

    document.getElementById('btn-focus-mode')?.addEventListener('click', () => {
      document.body.classList.toggle('focus-mode-active');
      const isFocused = document.body.classList.contains('focus-mode-active');
      if (sidebar) sidebar.style.display = isFocused ? 'none' : '';
      showToast(isFocused ? 'Focus Mode Enabled (Press Esc to exit)' : 'Focus Mode Disabled', 'info');
    });

    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    document.getElementById('btn-shortcuts-help')?.addEventListener('click', () => {
      openModal('modal-shortcuts-dialog');
    });

    // Note Meta Banner Controls
    const noteTitleInput = document.getElementById('note-title-input');
    if (noteTitleInput) {
      noteTitleInput.addEventListener('input', () => {
        const note = getActiveNote();
        if (note) {
          note.title = noteTitleInput.value.trim() || 'Untitled Note';
          const breadcrumbTitle = document.getElementById('breadcrumb-current-title');
          if (breadcrumbTitle) breadcrumbTitle.textContent = note.title;
          triggerAutosave();
        }
      });
    }

    document.getElementById('note-icon-btn')?.addEventListener('click', () => {
      openModal('modal-icon-picker');
    });

    document.getElementById('btn-note-theme')?.addEventListener('click', () => {
      switchView('settings');
    });

    document.getElementById('btn-note-favorite')?.addEventListener('click', () => {
      if (state.activeNoteId) toggleFavoriteNote(state.activeNoteId);
    });

    document.getElementById('btn-note-duplicate')?.addEventListener('click', () => {
      if (state.activeNoteId) duplicateNote(state.activeNoteId);
    });

    document.getElementById('btn-manual-save')?.addEventListener('click', () => {
      saveActiveNoteContent();
      saveState();
      playSound('success');
      showToast('Note saved manually.', 'success');
    });

    document.getElementById('btn-note-download-menu')?.addEventListener('click', () => {
      openModal('modal-download-dialog');
    });

    document.getElementById('btn-note-print')?.addEventListener('click', () => {
      window.print();
    });

    // Page Tabs Button
    document.getElementById('btn-add-page')?.addEventListener('click', addNewPage);

    // Editor Content Writing Area
    const editorContent = document.getElementById('note-editor-content');
    if (editorContent) {
      editorContent.addEventListener('input', () => {
        triggerAutosave();
        updateStats();
      });

      // Handle checklist checkbox clicks inside editor
      editorContent.addEventListener('change', (e) => {
        if (e.target.classList.contains('checklist-checkbox')) {
          triggerAutosave();
          playSound('click');
        }
      });
    }

    // Formatting Toolbar Buttons
    document.getElementById('tb-undo')?.addEventListener('click', () => formatDoc('undo'));
    document.getElementById('tb-redo')?.addEventListener('click', () => formatDoc('redo'));
    document.getElementById('tb-clear-format')?.addEventListener('click', () => formatDoc('removeFormat'));

    document.getElementById('tb-heading-select')?.addEventListener('change', (e) => {
      formatDoc('formatBlock', `<${e.target.value}>`);
    });

    document.getElementById('tb-font-family-select')?.addEventListener('change', (e) => {
      formatDoc('fontName', e.target.value);
    });

    document.getElementById('tb-font-size-select')?.addEventListener('change', (e) => {
      formatDoc('fontSize', e.target.value);
    });

    document.getElementById('tb-bold')?.addEventListener('click', () => formatDoc('bold'));
    document.getElementById('tb-italic')?.addEventListener('click', () => formatDoc('italic'));
    document.getElementById('tb-underline')?.addEventListener('click', () => formatDoc('underline'));
    document.getElementById('tb-strike')?.addEventListener('click', () => formatDoc('strikeThrough'));
    document.getElementById('tb-subscript')?.addEventListener('click', () => formatDoc('subscript'));
    document.getElementById('tb-superscript')?.addEventListener('click', () => formatDoc('superscript'));

    // Color Pickers
    const btnTextColor = document.getElementById('btn-text-color');
    const inputTextColor = document.getElementById('input-text-color');
    if (btnTextColor && inputTextColor) {
      btnTextColor.addEventListener('click', () => inputTextColor.click());
      inputTextColor.addEventListener('input', (e) => formatDoc('foreColor', e.target.value));
    }

    const btnHighlightColor = document.getElementById('btn-highlight-color');
    const inputHighlightColor = document.getElementById('input-highlight-color');
    if (btnHighlightColor && inputHighlightColor) {
      btnHighlightColor.addEventListener('click', () => inputHighlightColor.click());
      inputHighlightColor.addEventListener('input', (e) => formatDoc('hiliteColor', e.target.value));
    }

    // Alignment
    document.getElementById('tb-align-left')?.addEventListener('click', () => formatDoc('justifyLeft'));
    document.getElementById('tb-align-center')?.addEventListener('click', () => formatDoc('justifyCenter'));
    document.getElementById('tb-align-right')?.addEventListener('click', () => formatDoc('justifyRight'));
    document.getElementById('tb-align-justify')?.addEventListener('click', () => formatDoc('justifyFull'));

    // Lists & Checklist
    document.getElementById('tb-ul')?.addEventListener('click', () => formatDoc('insertUnorderedList'));
    document.getElementById('tb-ol')?.addEventListener('click', () => formatDoc('insertOrderedList'));
    document.getElementById('tb-checklist')?.addEventListener('click', insertChecklist);

    // Indents & Media
    document.getElementById('tb-indent')?.addEventListener('click', () => formatDoc('indent'));
    document.getElementById('tb-outdent')?.addEventListener('click', () => formatDoc('outdent'));
    document.getElementById('tb-hr')?.addEventListener('click', () => formatDoc('insertHorizontalRule'));
    document.getElementById('tb-datetime')?.addEventListener('click', () => {
      const stamp = new Date().toLocaleString();
      formatDoc('insertText', ` [${stamp}] `);
    });

    document.getElementById('tb-link')?.addEventListener('click', () => {
      openModal('modal-link-dialog');
    });

    document.getElementById('tb-image')?.addEventListener('click', () => {
      openModal('modal-image-dialog');
    });

    // Find and Replace
    const findReplaceBar = document.getElementById('find-replace-bar');
    document.getElementById('tb-find-replace')?.addEventListener('click', () => {
      if (findReplaceBar) {
        findReplaceBar.classList.toggle('open');
        if (findReplaceBar.classList.contains('open')) {
          document.getElementById('find-query-input')?.focus();
        }
      }
    });

    document.getElementById('btn-close-find')?.addEventListener('click', () => {
      if (findReplaceBar) findReplaceBar.classList.remove('open');
    });

    document.getElementById('btn-find-next')?.addEventListener('click', () => performFind(1));
    document.getElementById('btn-find-prev')?.addEventListener('click', () => performFind(-1));
    document.getElementById('btn-replace-one')?.addEventListener('click', () => performReplace(false));
    document.getElementById('btn-replace-all')?.addEventListener('click', () => performReplace(true));

    // To-Do Form
    document.getElementById('btn-add-task-submit')?.addEventListener('click', addNewTask);
    document.getElementById('new-task-title')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addNewTask();
    });

    // To-Do Filters
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.todoFilter = pill.getAttribute('data-filter');
        renderTodos();
        playSound('click');
      });
    });

    document.getElementById('tasks-sort-select')?.addEventListener('change', (e) => {
      state.todoSort = e.target.value;
      renderTodos();
    });

    document.getElementById('btn-clear-completed-tasks')?.addEventListener('click', clearCompletedTasks);

    // Trash View Actions
    document.getElementById('btn-empty-trash')?.addEventListener('click', emptyAllTrash);
    document.getElementById('btn-restore-all-trash')?.addEventListener('click', restoreAllTrash);

    // Settings Inputs
    document.getElementById('setting-toggle-particles')?.addEventListener('change', (e) => {
      state.settings.particlesEnabled = e.target.checked;
      saveState();
    });

    document.getElementById('setting-toggle-audio')?.addEventListener('change', (e) => {
      state.settings.audioEnabled = e.target.checked;
      saveState();
    });

    document.getElementById('setting-toggle-spellcheck')?.addEventListener('change', (e) => {
      state.settings.spellcheck = e.target.checked;
      if (editorContent) editorContent.spellcheck = e.target.checked;
      saveState();
    });

    document.getElementById('setting-toggle-confirm')?.addEventListener('change', (e) => {
      state.settings.confirmDelete = e.target.checked;
      saveState();
    });

    document.getElementById('setting-autosave-interval')?.addEventListener('change', (e) => {
      state.settings.autosaveInterval = parseInt(e.target.value, 10);
      saveState();
    });

    document.getElementById('btn-export-backup')?.addEventListener('click', exportFullBackup);

    const btnImport = document.getElementById('btn-import-backup-trigger');
    const inputImport = document.getElementById('input-import-backup-file');
    if (btnImport && inputImport) {
      btnImport.addEventListener('click', () => inputImport.click());
      inputImport.addEventListener('change', (e) => {
        if (e.target.files[0]) importFullBackup(e.target.files[0]);
      });
    }

    document.getElementById('btn-reset-all-data')?.addEventListener('click', resetAllData);

    // Download Modal Buttons
    document.getElementById('btn-dl-md')?.addEventListener('click', () => downloadNoteAs('md'));
    document.getElementById('btn-dl-html')?.addEventListener('click', () => downloadNoteAs('html'));
    document.getElementById('btn-dl-txt')?.addEventListener('click', () => downloadNoteAs('txt'));
    document.getElementById('btn-dl-print')?.addEventListener('click', () => {
      closeModal('modal-download-dialog');
      window.print();
    });

    // Link Dialog Confirm
    document.getElementById('btn-insert-link-confirm')?.addEventListener('click', () => {
      const url = document.getElementById('input-link-url')?.value;
      const text = document.getElementById('input-link-text')?.value;
      if (url) {
        if (text) {
          formatDoc('insertHTML', `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);
        } else {
          formatDoc('createLink', url);
        }
        closeModal('modal-link-dialog');
        showToast('Link inserted.', 'success');
      }
    });

    // Image Dialog Confirm
    document.getElementById('btn-insert-img-confirm')?.addEventListener('click', () => {
      const urlInput = document.getElementById('input-editor-img-url');
      const fileInput = document.getElementById('input-editor-img-file');

      if (fileInput && fileInput.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
          insertImageIntoEditor(e.target.result);
          closeModal('modal-image-dialog');
        };
        reader.readAsDataURL(fileInput.files[0]);
      } else if (urlInput && urlInput.value.trim()) {
        insertImageIntoEditor(urlInput.value.trim());
        closeModal('modal-image-dialog');
      }
    });

    // Emoji Picker Populate & Logic
    const emojiGrid = document.getElementById('emoji-picker-grid');
    if (emojiGrid) {
      emojiGrid.innerHTML = '';
      EMOJIS.forEach(emo => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emo;
        btn.onclick = () => {
          const note = getActiveNote();
          if (note) {
            note.icon = emo;
            note.iconType = 'emoji';
            saveState();
            loadActiveNoteIntoEditor();
            renderSidebarNotes();
            closeModal('modal-icon-picker');
            showToast('Icon updated!', 'success');
          }
        };
        emojiGrid.appendChild(btn);
      });
    }

    const customIconFile = document.getElementById('input-custom-icon-file');
    if (customIconFile) {
      customIconFile.addEventListener('change', (e) => {
        if (e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const note = getActiveNote();
            if (note) {
              note.icon = ev.target.result;
              note.iconType = 'image';
              saveState();
              loadActiveNoteIntoEditor();
              renderSidebarNotes();
              closeModal('modal-icon-picker');
              showToast('Custom icon image applied!', 'success');
            }
          };
          reader.readAsDataURL(e.target.files[0]);
        }
      });
    }

    document.getElementById('btn-remove-note-icon')?.addEventListener('click', () => {
      const note = getActiveNote();
      if (note) {
        note.icon = '📝';
        note.iconType = 'emoji';
        saveState();
        loadActiveNoteIntoEditor();
        renderSidebarNotes();
        closeModal('modal-icon-picker');
        showToast('Icon reset to default.', 'info');
      }
    });

    // Global Modal Close Buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close-modal');
        closeModal(modalId);
      });
    });

    // Close Modals on Backdrop Click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          backdrop.classList.remove('open');
        }
      });
    });

    // Keyboard Shortcuts Global Listener
    window.addEventListener('keydown', (e) => {
      // Escape closes modals / focus mode
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
        if (document.body.classList.contains('focus-mode-active')) {
          document.body.classList.remove('focus-mode-active');
          if (sidebar) sidebar.style.display = '';
        }
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          createNewNote();
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          saveActiveNoteContent();
          saveState();
          playSound('success');
          showToast('Force saved via Ctrl+S.', 'success');
        } else if (e.shiftKey && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          openModal('modal-download-dialog');
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // UTILITY HELPERS
  // --------------------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);

    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION ON DOM READY
  // --------------------------------------------------------------------------
  function initApp() {
    loadFromStorage();
    initCyberCanvas();
    setupEventListeners();

    applyTheme(state.settings.theme || 'neon-cyan');
    renderSidebarNotes();
    loadActiveNoteIntoEditor();
    renderTodos();
    renderSettings();

    console.log('⚡ Neon Notepad & To-Do Engine Matrix v2.5 initialized.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
