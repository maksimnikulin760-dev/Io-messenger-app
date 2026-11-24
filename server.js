const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || 'ВСТАВЬ_ТОКЕН_СЮДА';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'ВСТАВЬ_ID_СЮДА';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database(path.join(__dirname, 'io-messenger.db')); 
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.use(express.json());

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tg_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

function nextUserCode() {
  const row = db.prepare(`SELECT code FROM users ORDER BY id DESC LIMIT 1`).get();
  if (!row) return 'I00001';
  const num = parseInt(row.code.slice(1), 10) + 1;
  return 'I' + String(num).padStart(5, '0');
}
const nowISO = () => new Date().toISOString();

const HTML_UI = `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { --bg: #0a0f1a; --panel: #111a28; --blue: #2f80ed; --red: #e63946; --text: #e8eef7; }
  body { margin: 0; font-family: sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; height: 100vh; }
  .header { padding: 15px; background: var(--panel); border-bottom: 1px solid #22304a; text-align: center; font-weight: bold; }
  .tabs { display: flex; background: var(--panel); }
  .tab { flex: 1; padding: 15px; text-align: center; color: #7f8fa6; cursor: pointer; border-bottom: 2px solid transparent; }
  .tab.active { color: var(--blue); border-bottom: 2px solid var(--blue); }
  .content { flex: 1; padding: 20px; overflow-y: auto; }
  .card { background: var(--panel); padding: 15px; border-radius: 10px; margin-bottom: 10px; border-left: 3px solid var(--red); }
  .input-area { display: flex; padding: 10px; background: var(--panel); }
  input, textarea { flex: 1; padding: 10px; border-radius: 10px; border: none; outline: none; }
  button { background: var(--blue); color: white; border: none; padding: 10px 15px; border-radius: 10px; margin-left: 10px; cursor: pointer; }
  .user-item { padding: 10px; border-bottom: 1px solid #22304a; }
</style>
</head>
<body>
  <div class="header" id="headerName">IO Messenger</div>
  <div class="tabs">
    <div class="tab active" onclick="switchTab('notes')">Заметки</div>
    <div class="tab" onclick="switchTab('users')">Люди</div>
    <div class="tab" onclick="switchTab('bot')">ИИ Бот</div>
  </div>
  
  <div class="content" id="content"></div>

  <div class="input-area" id="inputArea" style="display:none;">
    <textarea id="inputText" placeholder="Написать..." rows="1"></textarea>
    <button onclick="sendData()">➤</button>
  </div>

<script>
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  
  let myUser = null;
  let currentTab = 'notes';

  async function initUser() {
    const tgId = tg.initDataUnsafe?.user?.id || '123'; 
    const name = tg.initDataUnsafe?.user?.first_name || 'Гость';
    document.getElementById('headerName').textContent = name;
    
    const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ tg_id: tgId }) });
    const data = await res.json();
    if(data.ok) myUser = data.user;
    
    document.getElementById('inputArea').style.display = 'flex';
    loadTab('notes');
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    loadTab(tab);
  }

  async function loadTab(tab) {
    const content = document.getElementById('content');
    content.innerHTML = 'Загрузка...';
    
    if (tab === 'notes') {
      const res = await fetch('/api/notes/' + myUser.code);
      const notes = await res.json();
      content.innerHTML = notes.length ? '' : 'Нет заметок';
      notes.forEach(n => {
        content.innerHTML += \`<div class="card">\${n.text}</div>\`;
      });
    } 
    else if (tab === 'users') {
      const res = await fetch('/api/users');
      const users = await res.json();
      content.innerHTML = '';
      users.forEach(u => {
        if(u.code !== myUser.code) {
          content.innerHTML += \`<div class="user-item">👤 \${u.name} <br><small>\${u.code}</small></div>\`;
        }
      });
    }
    else if (tab === 'bot') {
      content.innerHTML = '<div class="card">Привет! Я ИИ-бот IO. Скоро я смогу отвечать на вопросы.</div>';
    }
  }

  function sendData() {
    const text = document.getElementById('inputText').value;
    if(!text) return;
    
    if(currentTab === 'notes') {
      fetch('/api/notes', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ user_code: myUser.code, text: text })
      }).then(() => { document.getElementById('inputText').value = ''; loadTab('notes'); });
    }
  }

  initUser();
</script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(HTML_UI));

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'Пользователь';
  
  let user = db.prepare(`SELECT * FROM users WHERE tg_id = ?`).get(String(chatId));
  
  if (!user) {
    const code = nextUserCode();
    db.prepare(`INSERT INTO users (code, name, tg_id, created_at) VALUES (?, ?, ?, ?)`)
      .run(code, name, String(chatId), nowISO());
      
    bot.sendMessage(chatId, \`Добро пожаловать в IO Messenger, \${name}!\\nТвой номер: \${code}\`);
    
    if (ADMIN_CHAT_ID) {
      bot.sendMessage(ADMIN_CHAT_ID, \`🔔 Новый пользователь!\\nИмя: \${name}\\nНомер: \${code}\`);
    }
  }

  bot.sendMessage(chatId, 'Нажми кнопку ниже, чтобы открыть IO Messenger:', {
    reply_markup: {
      inline_keyboard: [[{ text: '🚀 Открыть IO Messenger', web_app: { url: 'https://io-messenger-app.onrender.com' } }]]
    }
  });
});

app.get('/api/users', (req, res) => {
  res.json(db.prepare(`SELECT code, name FROM users`).all());
});

app.post('/api/login', (req, res) => {
  const { tg_id } = req.body;
  const user = db.prepare(`SELECT code, name FROM users WHERE tg_id = ?`).get(String(tg_id));
  if (user) res.json({ ok: true, user });
  else res.status(401).json({ error: 'Не найден' });
});

app.get('/api/notes/:code', (req, res) => {
  res.json(db.prepare(`SELECT * FROM notes WHERE user_code = ? ORDER BY id DESC`).all(req.params.code));
});

app.post('/api/notes', (req, res) => {
  const { user_code, text } = req.body;
  const info = db.prepare(`INSERT INTO notes (user_code, text, created_at) VALUES (?, ?, ?)`).run(user_code, text, nowISO());
  res.json({ id: info.lastInsertRowid, text, created_at: nowISO() });
});

server.listen(PORT, () => {
  console.log(\`IO Messenger запущен на порту \${PORT}\`);
});
