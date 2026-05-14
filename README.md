# Simpalm Staffing Services — Birthday Hub

A simple, eye-catchy birthday management app for your employees.
Sends AI-generated birthday wishes automatically at 9:00 AM CST daily.

---

## Quick Start (Local)

### 1. Install Node.js
Download from https://nodejs.org (choose the LTS version).

### 2. Set up the project
Open a terminal, go into the folder, and run:

```
npm install
```

### 3. Configure your keys
Copy the example env file:

```
cp .env.example .env
```

Then open `.env` and fill in:

```
ANTHROPIC_API_KEY=your_key_from_anthropic.com
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=your_gmail_app_password
```

> For Gmail App Password: Go to myaccount.google.com > Security > 2-Step Verification > App passwords

### 4. Run the app

```
npm start
```

Open http://localhost:3000 in your browser. Done!

---

## Deploy to Render.com (Free Hosting)

1. Push this folder to a GitHub repo.
2. Go to https://render.com and sign up (free).
3. Click "New Web Service" and connect your GitHub repo.
4. Render will detect the `render.yaml` automatically.
5. Add your environment variables in the Render dashboard:
   - ANTHROPIC_API_KEY
   - SMTP_USER
   - SMTP_PASS
6. Deploy. Your app will be live at a public URL.

---

## Deploy to Railway.app (Alternative)

1. Go to https://railway.app
2. Click "New Project" > "Deploy from GitHub Repo"
3. Add environment variables in the Variables tab
4. Railway auto-deploys on every push

---

## WhatsApp Setup (Optional)

To enable WhatsApp wishes:
1. Sign up at https://twilio.com
2. Enable the WhatsApp sandbox or apply for a Business number
3. Add to your `.env`:
   ```
   TWILIO_SID=your_sid
   TWILIO_TOKEN=your_token
   TWILIO_WA_NUMBER=whatsapp:+14155238886
   ```
4. The server.js already has a `sendBirthdayEmail` function — add a similar `sendWhatsApp` function using the Twilio SDK.

---

## Excel Import Format

Your Excel/CSV file should have these columns:

| First Name | Last Name | Birthday   | Role             | Client     | Email              | WhatsApp      |
|------------|-----------|------------|------------------|------------|--------------------|---------------|
| Sarah      | Johnson   | 1990-05-21 | Virtual Assistant| Acme Corp  | sarah@example.com  | +13125550000  |

---

## How the Daily Trigger Works

The app uses a cron job that runs every day at 9:00 AM CST (3:00 PM UTC).
It finds all employees whose birthday matches today's date, generates a personalized
AI wish for each one, and sends it via email.

When hosted on Render or Railway, this runs automatically 24/7 with no manual action needed.
