import axios from 'axios';
import nodemailer from 'nodemailer';

// Memoria en instancia de Serverless (para detectar cambios)
let previousStatuses = {};

export default async function handler(req, res) {
  try {
    const dashboardSlug = "2H53W3TzUR6v7rJb7JK8HahX8JR5GyTh8RPKppnM";
    const nowVzla = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    
    let currentBanks = [];
    let changes = [];

    // 1. Obtener la configuración del Dashboard público de Redash
    const dashResponse = await axios.get(`https://redashairtm.xyz/api/dashboards/public/share/${dashboardSlug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const widgets = dashResponse.data.widgets || [];
    
    // Buscar el widget que contiene la visualización de la tabla de bancos
    const tableWidget = widgets.find(w => w.visualization && w.visualization.query);

    if (tableWidget) {
      const queryId = tableWidget.visualization.query.id;
      const queryResultId = tableWidget.visualization.query.latest_query_data_id;

      // 2. Consultar el resultado en JSON directamente desde la API de Redash
      const dataResponse = await axios.get(`https://redashairtm.xyz/api/queries/${queryId}/results/${queryResultId}.json`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });

      const rows = dataResponse.data.query_result.data.rows || [];

      rows.forEach(row => {
        // Mapeo flexible de columnas comunes en Redash
        const bankName = row["Payment Method"] || row["payment_method"] || row["method"] || row["banco"] || Object.values(row)[0];
        const status = row["Market Status"] || row["market_status"] || row["status"] || row["estatus"] || Object.values(row)[1];
        const minTx = row["Min Transactions Required"] || row["min_tx"] || row["minimo"] || Object.values(row)[2] || 'N/A';

        if (bankName && status) {
          const bankStr = String(bankName).trim();
          const statusStr = String(status).trim();

          currentBanks.push({
            bankName: bankStr,
            status: statusStr,
            minTx: String(minTx).trim(),
            time: nowVzla
          });

          // Detectar cambio respecto al estado anterior almacenado
          if (previousStatuses[bankStr] && previousStatuses[bankStr] !== statusStr) {
            changes.push({
              bankName: bankStr,
              oldStatus: previousStatuses[bankStr],
              newStatus: statusStr,
              timestamp: nowVzla
            });
          }
          previousStatuses[bankStr] = statusStr;
        }
      });
    }

    // 3. Enviar correo si se detectan cambios de estado
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
            <p><b>Banco / Método:</b> ${change.bankName}</p>
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
    console.error("Error fetching Redash API:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
