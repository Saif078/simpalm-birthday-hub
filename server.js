require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const DATA_FILE = path.join(__dirname, 'data', 'employees.json');
const LOG_FILE = path.join(__dirname, 'data', 'wishlog.json');
const POSTER_FILE = path.join(__dirname, 'data', 'poster.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: path.join(__dirname, 'data', 'uploads') });

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getCSTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}

function isBirthdayToday(bday) {
  if (!bday) return false;
  const parts = bday.split('-');
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  const now = getCSTDate();
  return month === (now.getMonth() + 1) && day === now.getDate();
}

function daysUntil(bday) {
  if (!bday) return 999;
  const now = getCSTDate();
  const parts = bday.split('-');
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const next = new Date(now.getFullYear(), month, day);
  if (next < now) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next - now) / 86400000);
}

function fallbackWish(emp) {
  return 'Hi ' + emp.first + ',\nWishing you a wonderful birthday! Your dedication as a ' + emp.role + ' at ' + emp.client + ' is truly valued.\n— The Simpalm Staffing Team';
}

async function generateWish(emp) {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackWish(emp);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: 'Write a short warm birthday message for ' + emp.first + ' ' + emp.last + ' who works as a ' + emp.role + ' serving client ' + emp.client + ' at Simpalm Staffing Services. Format exactly like this:\n\nHi ' + emp.first + ',\n[2 sentence warm birthday wish mentioning their role and client]\n— The Simpalm Staffing Team\n\nKeep it under 40 words. No subject line. No extra text.' }]
      })
    });
    const data = await res.json();
    return (data && data.content && data.content[0] && data.content[0].text) ? data.content[0].text : fallbackWish(emp);
  } catch (e) { return fallbackWish(emp); }
}

async function sendEmail(emp, message) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[EMAIL] Skipped — RESEND_API_KEY not set');
    return { ok: false, reason: 'No API key' };
  }
  try {
    const poster = readJSON(POSTER_FILE, { bg: '#0d2b5c', color: '#e8c96a' });
    const toEmail = process.env.TEST_EMAIL ? process.env.TEST_EMAIL : emp.email;
    console.log('[EMAIL] Sending to ' + toEmail + ' via Resend...');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Simpalm Staffing Services <onboarding@resend.dev>',
        to: toEmail,
        subject: 'Happy Birthday, ' + emp.first + '!',
        html: '<div style="font-family:sans-serif;max-width:500px;margin:auto;background:#f8f9fc;padding:32px;border-radius:12px;"><div style="background:#0d2b5c;border-radius:10px;padding:18px 22px;margin-bottom:20px;"><div style="font-family:Georgia,serif;font-size:18px;color:#fff;">Simpalm Staffing Services</div><div style="font-size:10px;color:#e8c96a;letter-spacing:1.5px;margin-top:3px;">BIRTHDAY HUB</div></div><p style="font-size:15px;color:#0a1428;line-height:1.75;margin-bottom:24px;">' + message.replace(/\n/g, '<br/>') + '</p><div style="background:' + poster.bg + ';border-radius:10px;padding:28px;text-align:center;"><div style="font-size:26px;">birthday cake</div><div style="font-family:Georgia,serif;font-size:20px;color:' + poster.color + ';margin-top:8px;">Happy Birthday, ' + emp.first + '!</div><div style="font-size:12px;color:' + poster.color + ';opacity:0.7;margin-top:6px;">From the Simpalm Staffing Team</div></div><div style="margin-top:20px;font-size:11px;color:#6b7a99;text-align:center;">simpalmstaffing.com</div></div>'
      })
    });
    const data = await res.json();
    if (data.id) {
      console.log('[EMAIL] Success! ID: ' + data.id);
      return { ok: true };
    } else {
      console.error('[EMAIL] Failed: ' + JSON.stringify(data));
      return { ok: false, reason: JSON.stringify(data) };
    }
  } catch (e) {
    console.error('[EMAIL] Error: ' + e.message);
    return { ok: false, reason: e.message };
  }
}

async function sendWhatsApp(emp, message) {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN || !emp.wa) {
    return { ok: false, reason: 'WhatsApp not configured' };
  }
  try {
    const auth = Buffer.from(process.env.TWILIO_SID + ':' + process.env.TWILIO_TOKEN).toString('base64');
    const body = new URLSearchParams({
      From: 'whatsapp:' + process.env.TWILIO_WA_NUMBER,
      To: 'whatsapp:' + emp.wa,
      Body: message
    });
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_SID + '/Messages.json', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    const data = await res.json();
    return data.sid ? { ok: true } : { ok: false, reason: data.message };
  } catch (e) { return { ok: false, reason: e.message }; }
}

async function sendBirthdayWish(emp) {
  console.log('[WISH] Processing ' + emp.first + ' ' + emp.last + '...');
  const message = await generateWish(emp);
  console.log('[WISH] Message ready');
  const emailResult = await sendEmail(emp, message);
  const waResult = await sendWhatsApp(emp, message);
  const channels = [];
  if (emailResult.ok) channels.push('Email');
  if (waResult.ok) channels.push('WhatsApp');
  const log = readJSON(LOG_FILE, []);
  log.unshift({
    name: emp.first + ' ' + emp.last,
    role: emp.role,
    client: emp.client,
    date: getCSTDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    channel: channels.length ? channels.join(' + ') : 'Logged only',
    status: channels.length ? 'Sent' : 'Pending',
    message: message
  });
  writeJSON(LOG_FILE, log.slice(0, 200));
  const employees = readJSON(DATA_FILE, []);
  const idx = employees.findIndex(function(e) { return String(e.id) === String(emp.id); });
  if (idx !== -1) {
    employees[idx].lastWished = getCSTDate().getFullYear();
    writeJSON(DATA_FILE, employees);
  }
  return { emailResult: emailResult, waResult: waResult, message: message };
}

cron.schedule('0 15 * * *', async function() {
  console.log('[CRON] Running daily birthday check...');
  const employees = readJSON(DATA_FILE, []);
  const todayBirthdays = employees.filter(function(e) { return isBirthdayToday(e.bday); });
  console.log('[CRON] Found ' + todayBirthdays.length + ' birthday(s) today.');
  for (let i = 0; i < todayBirthdays.length; i++) {
    const result = await sendBirthdayWish(todayBirthdays[i]);
    console.log('[CRON] ' + todayBirthdays[i].first + ' — Email: ' + result.emailResult.ok);
  }
});

app.get('/health', function(req, res) { res.send('OK'); });

app.get('/api/debug-time', function(req, res) {
  const cst = getCSTDate();
  res.json({ cstMonth: cst.getMonth() + 1, cstDay: cst.getDate(), cst: cst.toString() });
});

app.get('/api/employees', function(req, res) { res.json(readJSON(DATA_FILE, [])); });

app.get('/api/employees/:id', function(req, res) {
  const emp = readJSON(DATA_FILE, []).find(function(e) { return String(e.id) === req.params.id; });
  if (!emp) return res.status(404).json({ error: 'Not found' });
  res.json(emp);
});

app.post('/api/employees', function(req, res) {
  const employees = readJSON(DATA_FILE, []);
  const emp = Object.assign({ id: Date.now(), lastWished: null, addedOn: new Date().toISOString() }, req.body);
  employees.push(emp);
  writeJSON(DATA_FILE, employees);
  res.json(emp);
});

app.put('/api/employees/:id', function(req, res) {
  const employees = readJSON(DATA_FILE, []);
  const idx = employees.findIndex(function(e) { return String(e.id) === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  employees[idx] = Object.assign(employees[idx], req.body);
  writeJSON(DATA_FILE, employees);
  res.json(employees[idx]);
});

app.delete('/api/employees/:id', function(req, res) {
  const employees = readJSON(DATA_FILE, []).filter(function(e) { return String(e.id) !== req.params.id; });
  writeJSON(DATA_FILE, employees);
  res.json({ ok: true });
});

app.post('/api/import', upload.single('file'), function(req, res) {
  try {
    const wb = XLSX.readFile(req.file.path);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const employees = readJSON(DATA_FILE, []);
    const added = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const emp = {
        id: Date.now() + Math.random(),
        first: row['First Name'] || row.first || '',
        last: row['Last Name'] || row.last || '',
        bday: row['Birthday'] || row.bday || '',
        role: row['Role'] || row.role || 'Staff',
        client: row['Client'] || row.client || 'General',
        email: row['Email'] || row.email || '',
        wa: row['WhatsApp'] || row.wa || '',
        lastWished: null,
        addedOn: new Date().toISOString()
      };
      if (emp.first && emp.bday) { employees.push(emp); added.push(emp); }
    }
    writeJSON(DATA_FILE, employees);
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json({ added: added.length, employees: employees });
  } catch (e) { res.status(400).json({ error: 'Could not parse file: ' + e.message }); }
});

app.get('/api/wishlog', function(req, res) { res.json(readJSON(LOG_FILE, [])); });

app.post('/api/trigger', async function(req, res) {
  console.log('[TRIGGER] Manual trigger fired');
  const employees = readJSON(DATA_FILE, []);
  const birthdays = employees.filter(function(e) { return isBirthdayToday(e.bday); });
  console.log('[TRIGGER] Found ' + birthdays.length + ' birthday(s) today');
  const results = [];
  for (let i = 0; i < birthdays.length; i++) {
    const result = await sendBirthdayWish(birthdays[i]);
    results.push({ name: birthdays[i].first + ' ' + birthdays[i].last, email: result.emailResult.ok, wa: result.waResult.ok });
  }
  res.json({ triggered: birthdays.length, results: results });
});

app.post('/api/poster', function(req, res) { writeJSON(POSTER_FILE, req.body); res.json({ ok: true }); });
app.get('/api/poster', function(req, res) { res.json(readJSON(POSTER_FILE, { name: 'Navy Classic', bg: '#0d2b5c', color: '#e8c96a' })); });

app.get('/api/stats', function(req, res) {
  const employees = readJSON(DATA_FILE, []);
  const log = readJSON(LOG_FILE, []);
  const today = employees.filter(function(e) { return isBirthdayToday(e.bday); });
  const upcoming = employees
    .filter(function(e) { return !isBirthdayToday(e.bday); })
    .sort(function(a, b) { return daysUntil(a.bday) - daysUntil(b.bday); })
    .slice(0, 10);
  res.json({
    total: employees.length,
    todayCount: today.length,
    weekCount: employees.filter(function(e) { const d = daysUntil(e.bday); return d >= 0 && d <= 7; }).length,
    sentCount: log.filter(function(l) { return l.status === 'Sent'; }).length,
    today: today,
    upcoming: upcoming
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('Birthday Hub running on http://localhost:' + PORT); });
