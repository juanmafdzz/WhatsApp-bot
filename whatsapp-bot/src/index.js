/**
 * Ice Cream Shop WhatsApp Bot
 * 
 * This bot allows employees to submit daily sales reports via WhatsApp.
 * The reports are automatically saved to the Supabase database and
 * stock levels are updated accordingly.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// Store user sessions for multi-step conversations
const userSessions = new Map();

// Report steps configuration
const REPORT_STEPS = [
  { key: 'total_sales_amount', question: '💰 Enter total sales amount for today (numbers only):', type: 'number' },
  { key: 'mini_sold', question: '🍦 How many MINI cups were sold?', type: 'number' },
  { key: 'small_sold', question: '🍦 How many SMALL cups were sold?', type: 'number' },
  { key: 'medium_sold', question: '🍦 How many MEDIUM cups were sold?', type: 'number' },
  { key: 'half_liter_sold', question: '🍦 How many 1/2 LITER cups were sold?', type: 'number' },
  { key: 'one_liter_sold', question: '🍦 How many 1 LITER cups were sold?', type: 'number' },
  { key: 'cone_sold', question: '🍦 How many CONES were sold?', type: 'number' },
  { key: 'plate_sold', question: '🍦 How many PLATES were sold?', type: 'number' },
  { key: 'mini_cups_remaining', question: '📦 END-OF-DAY STOCK COUNT\n\nHow many MINI cups are remaining?', type: 'number' },
  { key: 'small_cups_remaining', question: 'How many SMALL cups are remaining?', type: 'number' },
  { key: 'medium_cups_remaining', question: 'How many MEDIUM cups are remaining?', type: 'number' },
  { key: 'half_liter_cups_remaining', question: 'How many 1/2 LITER cups are remaining?', type: 'number' },
  { key: 'one_liter_cups_remaining', question: 'How many 1 LITER cups are remaining?', type: 'number' },
  { key: 'cones_remaining', question: 'How many CONES are remaining?', type: 'number' },
  { key: 'plates_remaining', question: 'How many PLATES are remaining?', type: 'number' },
  { key: 'spoons_remaining', question: 'How many SPOONS are remaining?', type: 'number' },
];

// Generate QR code for authentication
client.on('qr', (qr) => {
  console.log('Scan this QR code with your phone:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp Bot is ready!');
  console.log('Bot is listening for messages...');
});

client.on('authenticated', () => {
  console.log('✅ Authenticated successfully');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
  console.log('❌ Client disconnected:', reason);
});

// Handle incoming messages
client.on('message_create', async (msg) => {
  // Ignore messages from the bot itself
  if (msg.fromMe) return;

  const phoneNumber = msg.from;
  const messageText = msg.body.trim().toLowerCase();
  const userSession = userSessions.get(phoneNumber);

  try {
    // Check if the phone number is registered as an employee
    const { data: employee, error: employeeError } = await supabase
      .from('users')
      .select('*')
      .eq('phone_number', phoneNumber.replace('@c.us', ''))
      .eq('role', 'employee')
      .eq('is_active', true)
      .single();

    if (employeeError || !employee) {
      // Not a registered employee
      if (messageText === 'hola' || messageText === 'hello' || messageText === 'hi') {
        await msg.reply(
          '👋 Hello! Welcome to the Ice Cream Shop Reporting System.\n\n' +
          'This number is not registered as an employee.\n' +
          'Please contact the admin to get registered.'
        );
      }
      return;
    }

    // Handle commands
    if (messageText === 'ayuda' || messageText === 'help') {
      await sendHelpMessage(msg);
      return;
    }

    if (messageText === 'estado' || messageText === 'status') {
      await sendStatusMessage(msg, employee);
      return;
    }

    if (messageText === 'reporte' || messageText === 'report' || messageText === 'nuevo') {
      // Start new report
      userSessions.set(phoneNumber, {
        employeeId: employee.id,
        step: 0,
        data: {},
      });
      await msg.reply(
        '📋 *NEW DAILY SALES REPORT*\n\n' +
        'I will guide you through entering today\'s sales data.\n\n' +
        REPORT_STEPS[0].question
      );
      return;
    }

    if (messageText === 'cancelar' || messageText === 'cancel') {
      if (userSession) {
        userSessions.delete(phoneNumber);
        await msg.reply('❌ Report cancelled. Send "Reporte" to start a new report.');
      } else {
        await msg.reply('No active report to cancel.');
      }
      return;
    }

    // Handle report data entry
    if (userSession) {
      await handleReportStep(msg, phoneNumber, userSession, messageText);
      return;
    }

    // Default response
    await msg.reply(
      '👋 Hello ' + employee.name + '!\n\n' +
      'Send *"Reporte"* to submit today\'s sales report.\n' +
      'Send *"Ayuda"* for help.\n' +
      'Send *"Estado"* to check your report status.'
    );

  } catch (error) {
    console.error('Error handling message:', error);
    await msg.reply('❌ An error occurred. Please try again later.');
  }
});

/**
 * Send help message
 */
async function sendHelpMessage(msg) {
  const helpText =
    '📖 *HELP - ICE CREAM SHOP BOT*\n\n' +
    '*Commands:*\n' +
    '• *Reporte* - Start a new daily sales report\n' +
    '• *Estado* - Check your report status for today\n' +
    '• *Ayuda* - Show this help message\n' +
    '• *Cancelar* - Cancel current report\n\n' +
    '*How to submit a report:*\n' +
    '1. Send "Reporte" to start\n' +
    '2. Answer each question with numbers only\n' +
    '3. Review your answers at the end\n' +
    '4. Send "CONFIRM" to submit\n\n' +
    '*Tips:*\n' +
    '• Enter only numbers for quantities\n' +
    '• Be accurate with your counts\n' +
    '• The system will detect discrepancies automatically';

  await msg.reply(helpText);
}

/**
 * Send status message
 */
async function sendStatusMessage(msg, employee) {
  const today = new Date().toISOString().split('T')[0];

  const { data: reports, error } = await supabase
    .from('daily_sales')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('report_date', today);

  if (error) {
    await msg.reply('❌ Error checking status. Please try again.');
    return;
  }

  if (reports && reports.length > 0) {
    const report = reports[0];
    const status = report.has_discrepancy 
      ? '⚠️ DISCREPANCY DETECTED' 
      : report.status === 'verified' 
        ? '✅ VERIFIED' 
        : '⏳ PENDING REVIEW';
    
    await msg.reply(
      `📊 *YOUR REPORT STATUS - ${today}*\n\n` +
      `Status: ${status}\n` +
      `Total Sales: $${report.total_sales_amount}\n` +
      `Items Sold: ${report.mini_sold + report.small_sold + report.medium_sold + report.half_liter_sold + report.one_liter_sold + report.cone_sold + report.plate_sold}\n\n` +
      (report.has_discrepancy 
        ? '⚠️ There are discrepancies in your report. The admin will review it.' 
        : '✅ Your report looks good!')
    );
  } else {
    await msg.reply(
      `📊 *YOUR REPORT STATUS - ${today}*\n\n` +
      '❌ No report submitted yet today.\n\n' +
      'Send "Reporte" to submit your daily report.'
    );
  }
}

/**
 * Handle report step
 */
async function handleReportStep(msg, phoneNumber, session, messageText) {
  const currentStep = REPORT_STEPS[session.step];

  // Validate input
  if (currentStep.type === 'number') {
    const number = parseFloat(messageText);
    if (isNaN(number) || number < 0) {
      await msg.reply('❌ Please enter a valid positive number.');
      await msg.reply(currentStep.question);
      return;
    }
    session.data[currentStep.key] = number;
  } else {
    session.data[currentStep.key] = messageText;
  }

  // Move to next step
  session.step++;

  if (session.step < REPORT_STEPS.length) {
    // Ask next question
    await msg.reply(REPORT_STEPS[session.step].question);
  } else {
    // All questions answered, show summary
    await showReportSummary(msg, phoneNumber, session);
  }
}

/**
 * Show report summary and ask for confirmation
 */
async function showReportSummary(msg, phoneNumber, session) {
  const data = session.data;
  
  const summary =
    '📋 *REPORT SUMMARY*\n\n' +
    `💰 Total Sales: $${data.total_sales_amount}\n\n` +
    '*Items Sold:*\n' +
    `• Mini cups: ${data.mini_sold}\n` +
    `• Small cups: ${data.small_sold}\n` +
    `• Medium cups: ${data.medium_sold}\n` +
    `• 1/2 Liter: ${data.half_liter_sold}\n` +
    `• 1 Liter: ${data.one_liter_sold}\n` +
    `• Cones: ${data.cone_sold}\n` +
    `• Plates: ${data.plate_sold}\n\n` +
    '*Remaining Stock:*\n' +
    `• Mini cups: ${data.mini_cups_remaining}\n` +
    `• Small cups: ${data.small_cups_remaining}\n` +
    `• Medium cups: ${data.medium_cups_remaining}\n` +
    `• 1/2 Liter: ${data.half_liter_cups_remaining}\n` +
    `• 1 Liter: ${data.one_liter_cups_remaining}\n` +
    `• Cones: ${data.cones_remaining}\n` +
    `• Plates: ${data.plates_remaining}\n` +
    `• Spoons: ${data.spoons_remaining}\n\n` +
    '⚠️ *IMPORTANT:* This will update stock levels.\n\n' +
    'Reply *CONFIRM* to submit or *CANCELAR* to discard.';

  await msg.reply(summary);
  
  // Update session to wait for confirmation
  session.waitingForConfirmation = true;
}

/**
 * Handle confirmation and save report
 */
async function handleConfirmation(msg, phoneNumber, session) {
  const messageText = msg.body.trim().toUpperCase();

  if (messageText === 'CONFIRMAR' || messageText === 'CONFIRM') {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = session.data;

      // Check if a report already exists for today
      const { data: existingReport } = await supabase
        .from('daily_sales')
        .select('id')
        .eq('employee_id', session.employeeId)
        .eq('report_date', today)
        .single();

      if (existingReport) {
        await msg.reply(
          '⚠️ You have already submitted a report for today.\n' +
          'Contact the admin if you need to make changes.'
        );
        userSessions.delete(phoneNumber);
        return;
      }

      // Save the report
      const { data: newReport, error } = await supabase
        .from('daily_sales')
        .insert({
          report_date: today,
          employee_id: session.employeeId,
          total_sales_amount: data.total_sales_amount,
          mini_sold: data.mini_sold,
          small_sold: data.small_sold,
          medium_sold: data.medium_sold,
          half_liter_sold: data.half_liter_sold,
          one_liter_sold: data.one_liter_sold,
          cone_sold: data.cone_sold,
          plate_sold: data.plate_sold,
          mini_cups_remaining: data.mini_cups_remaining,
          small_cups_remaining: data.small_cups_remaining,
          medium_cups_remaining: data.medium_cups_remaining,
          half_liter_cups_remaining: data.half_liter_cups_remaining,
          one_liter_cups_remaining: data.one_liter_cups_remaining,
          cones_remaining: data.cones_remaining,
          plates_remaining: data.plates_remaining,
          spoons_remaining: data.spoons_remaining,
        })
        .select()
        .single();

      if (error) throw error;

      // Clear session
      userSessions.delete(phoneNumber);

      // Send confirmation
      if (newReport.has_discrepancy) {
        await msg.reply(
          '⚠️ *REPORT SUBMITTED WITH DISCREPANCY*\n\n' +
          `Report ID: ${newReport.id.slice(0, 8)}\n` +
          'Your report has been submitted but discrepancies were detected.\n' +
          'The admin will review and contact you if needed.\n\n' +
          'Send "Estado" to check your report status.'
        );
      } else {
        await msg.reply(
          '✅ *REPORT SUBMITTED SUCCESSFULLY!*\n\n' +
          `Report ID: ${newReport.id.slice(0, 8)}\n` +
          'Stock levels have been updated automatically.\n\n' +
          'Thank you for your report!'
        );
      }

    } catch (error) {
      console.error('Error saving report:', error);
      await msg.reply(
        '❌ Error saving your report. Please try again or contact the admin.'
      );
      userSessions.delete(phoneNumber);
    }
  } else if (messageText === 'CANCELAR' || messageText === 'CANCEL') {
    userSessions.delete(phoneNumber);
    await msg.reply('❌ Report cancelled. Send "Reporte" to start a new report.');
  } else {
    await msg.reply('Please reply *CONFIRM* to submit or *CANCELAR* to discard.');
  }
}

// Override the message handler to check for confirmation
client.on('message_create', async (msg) => {
  // Skip if already handled
  if (msg.fromMe) return;

  const phoneNumber = msg.from;
  const session = userSessions.get(phoneNumber);

  if (session && session.waitingForConfirmation) {
    await handleConfirmation(msg, phoneNumber, session);
    return;
  }
});

// Start the client
client.initialize();

console.log('🚀 Starting Ice Cream Shop WhatsApp Bot...');
console.log('Waiting for QR code scan...');
