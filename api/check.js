import axios from 'axios';
import * as cheerio from 'cheerio';
import nodemailer from 'nodemailer';

// Memoria temporal en la función (para detectar cambios)
let previousStatuses = {};

export default async function handler(req, res) {
  try {
    const url = 'https://redashairtm.xyz/public/dashboards/2H53W3TzUR6v7rJb7JK8HahX8JR5GyTh8RPKppnM?org_slug=default';
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const $ = cheerio.load(html);
    const currentBanks = [];
    const changes = [];
    const nowVzla = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

    // Parsear la tabla de Ant Design
    $('.ant-table-tbody > tr').each((_, el) => {
      const cells = $(el).find('td');
      if (cells.length >= 2) {
        const bankName = $(cells[0]).text().trim();
        const status = $(cells[1]).text().trim();
        const minTx = cells[2] ? $(cells[2]).text().trim() : 'N/A';

        if (bankName) {
          currentBanks.push({ bankName, status, minTx, time: nowVzla });

          // Detectar cambio
          if (previousStatuses[bankName] && previousStatuses[bankName] !== status) {
            changes.push({
              bankName,
              oldStatus: previousStatuses[bankName],
              newStatus: status,
              timestamp: nowVzla
            });
          }
          previousStatuses[bankName] = status;
        }
      }
    });

    // Si hubo cambios y las credenciales de correo están configuradas, enviar email
    if (changes.length > 0 && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });

      for (const change of changes) {
        const isOpening = change.newStatus.toLowerCase().includes('open');
        const subject = `${isOpening ? '🟢 APERTURA' : '🔴 CIERRE'}: ${change.bankName} [${change.timestamp}]`;

        await transporter.sendMail({
          from: `"Monitor Airtm" <${process.env.EMAIL_USER}>`,
          to: process.env.NOTIFICATION_EMAIL || process.env.EMAIL_USER,
          subject: subject,
          html: `
            <h3>Cambio de Estatus Detectado</h3>
            <p><b>Banco:</b> ${change.bankName}</p>
            <p><b>Estado Anterior:</b> ${change.oldStatus}</p>
            <p><b>Nuevo Estado:</b> <b style="color:${isOpening ? 'green' : 'red'}">${change.newStatus}</b></p>
            <p><b>Hora Oficial (Venezuela):</b> ${change.timestamp}</p>
          `
        });
      }
    }

    return res.status(200).json({
      success: true,
      lastChecked: nowVzla,
      banks: currentBanks,
      changesDetected: changes
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
