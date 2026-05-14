const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const DATA_FILE = path.join(__dirname, 'data', 'employees.json');
const LOG_FILE = path.join(__dirname, 'data', 'wishlog.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: path.join(__dirname, 'data', 'uploads') });

// helpers
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function daysUntilBirthday(bday) {
  const today = new Date();
  const b = new Date(bday);
  const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}
function getTodaysBirthdays() {
  const employees = readJSON(DATA_FILE, []);
  return employees.filter(e => daysUntilBirthday(e.bday) === 0);
}

// mailer setup
function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendBirthdayEmail(employee, message) {
  if (!process.env.SMTP_USER) return { ok: false, reason: 'SMTP not configured' };
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Simpalm Staffing Services" <${process.env.SMTP_USER}>`,
    to: employee.email,
    subject: `Happy Birthday, ${employee.first}!`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;background:#f8f9fc;border-radius:12px;">
      <div style="background:#0d2b5c;border-radius:8px;padding:20px 24px;margin-bottom:20px;">
        <div style="font-family:Georgia,serif;font-size:20px;color:#fff;">Simpalm Staffing Services</div>
        <div style="font-size:11px;color:#e8c96a;letter-spacing:1.5px;margin-top:4px;">BIRTHDAY HUB</div>
      </div>
      <p style="font-size:15px;color:#0a1428;line-height:1.7;">${message.replace(/\n/g,'<br/>')}</p>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #dde3f0;font-size:12px;color:#6b7a99;">
        Simpalm Staffing Services &mdash; simpalmstaffing.com
      </div>
    </div>`,
  });
  return { ok: true };
}

// AI wish generation
async function generateAIWish(employee, tone) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return `Happy Birthday, ${employee.first}! Wishing you a wonderful day filled with joy. Your dedication as a ${employee.role} at ${employee.client} is truly valued. Here's to a great year ahead!\n\nWarm regards,\nThe Simpalm Staffing Team`;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: `Write a birthday wish for ${employee.first} ${employee.last}, who works as a ${employee.role} for client ${employee.client} at Simpalm Staffing Services. Tone: ${tone || 'warm and professional'}. Keep it 3 sentences. Sign off from "The Simpalm Staffing Team". No subject line.` }]
    })
  });
  const data = await res.json();
  return data?.content?.[0]?.text || `Happy Birthday, ${employee.first}! Wishing you an amazing day.\n\nThe Simpalm Staffing Team`;
}

// CRON: every day at 9AM CST (UTC-6 = 15:00 UTC)
cron.schedule('0 15 * * *', async () => {
  console.log('[CRON] Running daily birthday trigger...');
  const birthdays = getTodaysBirthdays();
  const log = readJSON(LOG_FILE, []);
  for (const emp of birthdays) {
    const message = await generateAIWish(emp, 'warm and professional');
    const emailResult = await sendBirthdayEmail(emp, message);
    log.unshift({ name: `${emp.first} ${emp.last}`, date: new Date().toLocaleDateString(), channel: 'Email', status: emailResult.ok ? 'Sent' : 'Failed', message });
    console.log(`[CRON] Wished ${emp.first} ${emp.last} — ${emailResult.ok ? 'OK' : emailResult.reason}`);
  }
  writeJSON(LOG_FILE, log.slice(0, 100));
});

// ROUTES

app.get('/api/employees', (req, res) => {
  res.json(readJSON(DATA_FILE, []));
});

app.post('/api/employees', (req, res) => {
  const employees = readJSON(DATA_FILE, []);
  const emp = { id: Date.now(), ...req.body, sent: false };
  employees.push(emp);
  writeJSON(DATA_FILE, employees);
  res.json(emp);
});

app.delete('/api/employees/:id', (req, res) => {
  let employees = readJSON(DATA_FILE, []);
  employees = employees.filter(e => String(e.id) !== req.params.id);
  writeJSON(DATA_FILE, employees);
  res.json({ ok: true });
});

app.post('/api/import', upload.single('file'), (req, res) => {
  try {
    const wb = XLSX.readFile(req.file.path);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const employees = readJSON(DATA_FILE, []);
    const added = [];
    for (const row of rows) {
      const emp = {
        id: Date.now() + Math.random(),
        first: row['First Name'] || row.first || '',
        last: row['Last Name'] || row.last || '',
        bday: row['Birthday'] || row.bday || '',
        role: row['Role'] || row.role || 'Staff',
        client: row['Client'] || row.client || 'General',
        email: row['Email'] || row.email || '',
        wa: row['WhatsApp'] || row.wa || '',
        sent: false,
      };
      if (emp.first && emp.bday) { employees.push(emp); added.push(emp); }
    }
    writeJSON(DATA_FILE, employees);
    res.json({ added: added.length, employees });
  } catch (e) {
    res.status(400).json({ error: 'Could not parse file: ' + e.message });
  }
});

app.post('/api/generate-wish', async (req, res) => {
  try {
    const { employeeId, tone } = req.body;
    const employees = readJSON(DATA_FILE, []);
    const emp = employees.find(e => String(e.id) === String(employeeId));
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const message = await generateAIWish(emp, tone);
    res.json({ message });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/send-wish', async (req, res) => {
  try {
    const { employeeId, message, channel } = req.body;
    const employees = readJSON(DATA_FILE, []);
    const emp = employees.find(e => String(e.id) === String(employeeId));
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const result = await sendBirthdayEmail(emp, message);
    const log = readJSON(LOG_FILE, []);
    log.unshift({ name: `${emp.first} ${emp.last}`, date: new Date().toLocaleDateString(), channel: channel || 'Email', status: result.ok ? 'Sent' : 'Pending (no SMTP)', message });
    writeJSON(LOG_FILE, log.slice(0, 100));
    emp.sent = true;
    writeJSON(DATA_FILE, employees);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/wishlog', (req, res) => {
  res.json(readJSON(LOG_FILE, []));
});

app.post('/api/trigger', async (req, res) => {
  const birthdays = getTodaysBirthdays();
  const log = readJSON(LOG_FILE, []);
  const results = [];
  for (const emp of birthdays) {
    const message = await generateAIWish(emp, 'warm and professional');
    const emailResult = await sendBirthdayEmail(emp, message);
    log.unshift({ name: `${emp.first} ${emp.last}`, date: new Date().toLocaleDateString(), channel: 'Email', status: emailResult.ok ? 'Sent' : 'Pending', message });
    results.push({ name: `${emp.first} ${emp.last}`, ...emailResult });
  }
  writeJSON(LOG_FILE, log.slice(0, 100));
  res.json({ triggered: birthdays.length, results });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Birthday Hub running on http://localhost:${PORT}`));
