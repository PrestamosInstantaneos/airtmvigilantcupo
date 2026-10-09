import axios from 'axios';
import nodemailer from 'nodemailer';

// Memoria persistente en la instancia serverless para cambios de estado
let previousStatuses = {};

export default async function handler(req, res) {
  try {
    const nowVzla = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    let currentBanks = [];
    let changes = [];

    // Redash comparte los resultados públicos del dashboard a través de su endpoint de queries o embeds.
    // Usamos la URL pública con headers de navegador estándar.
    const targetUrl = 'https://redashairtm.xyz/public/dashboards/2H53W3TzUR6v7rJb7JK8HahX8JR5GyTh8RPKppnM?org_slug=default';
    
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      timeout: 8000
    });

    const htmlContent = response.data;

    // Redash inyecta el estado inicial del dashboard en un tag <script id="redash-data"> o similar en el HTML
    const jsonMatch = htmlContent.match(/<script id="redash-data"[^>]*>([\s\S]*?)<\/script>/) ||
                      htmlContent.match(/window\.REDASH_HAS_USER_DATA\s*=\s*([\s\S]*?);/);

    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsedData = JSON.parse(jsonMatch[1]);
        // Si encontramos la estructura de rows en el JSON embebido
        const rows = parsedData?.dashboard?.widgets?.[0]?.visualization?.query?.query_result?.data?.rows || [];

        rows.forEach(row => {
          const bankName = row["Payment Method"] || Object.values(row)[0];
          const status = row["Market Status"] || Object.values(row)[1];
          const minTx = row["Min Transactions Required"] || Object.values(row)[2] || 'N/A';

          if (bankName) {
            currentBanks.push({
              bankName: String(bankName).trim(),
              status: String(status).trim(),
              minTx: String(minTx).trim(),
              time: nowVzla
            });
          }
        });
      } catch (e) {
        console.warn("No se pudo parsear el JSON interno de Redash:", e.message);
      }
    }

    // Fallback: Si no se logró extraer del JSON del HTML, consultar directamente el endpoint de la API pública de datos
    if (currentBanks.length === 0) {
      // ID de la query de Payment Method Status en Redash Airtm
      const queryApiUrl = 'https://redashairtm.xyz/api/queries/1/results.json'; 
      try {
        const apiRes = await axios.get(queryApiUrl, { timeout: 5000 });
        const rows = apiRes.data?.query_result?.data?.rows || [];

        rows.forEach(row => {
          const bankName = row["Payment Method"] || Object.values(row)[0];
          const status = row["Market Status"] || Object.values(row)[1];
          const minTx = row["Min Transactions Required"] || Object.values(row)[2] || 'N/A';

          if (bankName) {
            currentBanks.push({
              bankName: String(bankName).trim(),
              status: String(status).trim(),
              minTx: String(minTx).trim(),
              time: nowVzla
            });
          }
        });
      } catch (err) {
        console.warn("Fallback de API directa no disponible:", err.message);
      }
    }

    // Evaluar cambios de estado para notificaciones por correo
    currentBanks.forEach(item => {
      const { bankName, status } = item;
      if (previousStatuses[bankName] && previousStatuses[bankName] !== status) {
        changes.push({
          bankName,
          oldStatus: previousStatuses[bankName],
          newStatus: status,
          timestamp: nowVzla
        });
      }
      previousStatuses[bankName] = status;
    });

    // Enviar emails con Nodemailer si existen cambios y variables de entorno configuradas
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

    // Responder siempre con 200 OK para evitar que el frontend caiga en estado de error
    return res.status(200).json({
      success: true,
      lastChecked: nowVzla,
      banks: currentBanks,
      changesDetected: changes
    });

  } catch (error) {
    console.error("Error en la ejecución de Vercel Function:", error.message);
    
    // Devolver JSON seguro en lugar de crash 500
    return res.status(200).json({
      success: false,
      lastChecked: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
      banks: [],
      error: error.message
    });
  }
}
