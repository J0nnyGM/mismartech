const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const nodemailer = require("nodemailer");

// --- CONFIGURACIÓN DE TRANSPORTE ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
    }
});

// --- HELPER: Formatear Moneda ---
const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CO', { 
        style: 'currency', 
        currency: 'COP', 
        minimumFractionDigits: 0 
    }).format(amount || 0);
};

// --- HELPER: Obtener Link de Rastreo ---
const getTrackingLink = (carrier, guide) => {
    if (!carrier || !guide) return "#";
    const c = carrier.toLowerCase();
    if (c.includes('servientrega')) return "https://www.servientrega.com/wps/portal/rastreo-envio";
    if (c.includes('interrapidisimo') || c.includes('interrapidísimo')) return "https://interrapidisimo.com/sigue-tu-envio/";
    if (c.includes('envia') || c.includes('envía')) return "https://envia.co/";
    if (c.includes('coordinadora')) return "https://coordinadora.com/rastreo/rastreo-de-guia/";
    return `https://www.google.com/search?q=${carrier}+rastreo`;
};

// --- PLANTILLA HTML PROFESIONAL ---
function getBeautifulEmailTemplate(type, order, orderId) {
    const isDispatch = type === 'DISPATCH';
    const primaryColor = "#00D6D6"; // Tu Brand Cyan
    const darkColor = "#1e293b";    // Tu Slate-900
    const lightBg = "#f8fafc";      // Slate-50

    // 1. Calcular Items HTML
    const itemsHtml = (order.items || []).map(item => `
        <tr>
            <td style="padding: 15px 0; border-bottom: 1px dashed #e2e8f0;">
                <div style="display: flex; align-items: center;">
                    <img src="${item.mainImage || item.image || 'https://via.placeholder.com/60'}" 
                         style="width: 60px; height: 60px; object-fit: contain; border-radius: 8px; border: 1px solid #eee; margin-right: 15px;">
                    <div>
                        <p style="margin: 0; font-size: 14px; font-weight: bold; color: #334155; text-transform: uppercase;">
                            ${item.name}
                        </p>
                        <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">
                            ${item.color ? item.color + ' | ' : ''} Cant: ${item.quantity || 1}
                        </p>
                    </div>
                </div>
            </td>
            <td style="padding: 15px 0; border-bottom: 1px dashed #e2e8f0; text-align: right;">
                <p style="margin: 0; font-size: 14px; font-weight: 800; color: #0f172a;">
                    ${formatMoney((item.price || 0) * (item.quantity || 1))}
                </p>
            </td>
        </tr>
    `).join('');

    // 2. Datos Dinámicos
    const title = isDispatch ? "¡Tu pedido va en camino! 🚚" : "¡Gracias por tu compra! 🎉";
    const subTitle = isDispatch 
        ? "Hemos entregado tu paquete a la transportadora. Aquí tienes los detalles."
        : "Hemos recibido tu pedido correctamente. Pronto comenzaremos a prepararlo.";
    
    // --- LÓGICA WHATSAPP (NUEVO) ---
    const customerName = order.buyerInfo?.name || order.extraData?.userName || 'Cliente';
    const cleanOrderId = orderId.slice(0, 8).toUpperCase();
    // Mensaje predeterminado: "Hola PixelTech, tengo una duda sobre mi pedido #ABC12345 a nombre de Juan..."
    const waMessage = `Hola PixelTech, tengo una duda sobre mi pedido #${cleanOrderId} a nombre de ${customerName}.`;
    // Crear Link (Codificamos el texto para que funcione en URL)
    const waLink = `https://wa.me/573174534353?text=${encodeURIComponent(waMessage)}`;


    // 3. Bloque de Rastreo (Solo si hay guía)
    const trackingHtml = (isDispatch && order.trackingNumber) ? `
        <div style="background-color: #ecfeff; border: 1px solid #cfFAFE; border-radius: 16px; padding: 20px; margin-bottom: 24px; text-align: center;">
            <p style="margin: 0; font-size: 10px; font-weight: 800; color: #155e75; text-transform: uppercase; letter-spacing: 1px;">
                Número de Guía (${order.carrier || 'Transportadora'})
            </p>
            <p style="margin: 8px 0; font-size: 24px; font-family: monospace; font-weight: bold; color: #0e7490;">
                ${order.trackingNumber}
            </p>
            <a href="${getTrackingLink(order.carrier, order.trackingNumber)}" 
               style="display: inline-block; background-color: ${primaryColor}; color: #000; padding: 10px 20px; border-radius: 50px; text-decoration: none; font-size: 12px; font-weight: bold; text-transform: uppercase;">
               Rastrear Pedido
            </a>
        </div>
    ` : '';

    // 4. Estructura Completa
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: ${lightBg}; font-family: 'Inter', Arial, sans-serif;">
        
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
                <td align="center" style="padding: 40px 10px;">
                    
                    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
                        
                        <tr>
                            <td style="padding: 40px 40px 20px; text-align: center; background-color: ${darkColor};">
                                <img src="https://pixeltechcol.com/img/logo.webp" alt="PixelTech" style="height: 40px; margin-bottom: 20px;">
                                <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 900; text-transform: uppercase; letter-spacing: -1px;">
                                    ${title}
                                </h1>
                                <p style="margin: 10px 0 0; color: #94a3b8; font-size: 14px;">
                                    Orden #${cleanOrderId}
                                </p>
                            </td>
                        </tr>

                        <tr>
                            <td style="padding: 40px;">
                                <p style="margin-top: 0; color: #475569; font-size: 16px; line-height: 1.5;">
                                    Hola <strong>${customerName}</strong>,
                                </p>
                                <p style="color: #475569; font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
                                    ${subTitle}
                                </p>

                                ${trackingHtml}

                                <p style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 0;">
                                    Resumen del Pedido
                                </p>
                                <table width="100%" cellpadding="0" cellspacing="0">
                                    ${itemsHtml}
                                </table>

                                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                                    <tr>
                                        <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Envío</td>
                                        <td style="text-align: right; color: ${primaryColor}; font-weight: bold;">
                                            ${order.shippingCost ? formatMoney(order.shippingCost) : 'GRATIS'}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; color: #0f172a; font-size: 16px; font-weight: 900;">Total Pagado</td>
                                        <td style="text-align: right; color: #0f172a; font-size: 20px; font-weight: 900;">
                                            ${formatMoney(order.total)}
                                        </td>
                                    </tr>
                                </table>

                                <div style="background-color: #f8fafc; border-radius: 16px; padding: 20px; margin-top: 30px;">
                                    <table width="100%">
                                        <tr>
                                            <td valign="top" width="50%">
                                                <p style="margin: 0 0 5px; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">
                                                    Dirección de Envío
                                                </p>
                                                <p style="margin: 0; font-size: 13px; color: #334155; font-weight: bold;">
                                                    ${order.shippingData?.address || order.buyerInfo?.address}
                                                </p>
                                                <p style="margin: 2px 0 0; font-size: 12px; color: #64748b;">
                                                    ${order.shippingData?.city || order.buyerInfo?.city}
                                                </p>
                                            </td>
                                            <td valign="top" width="50%">
                                                <p style="margin: 0 0 5px; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">
                                                    Datos Contacto
                                                </p>
                                                <p style="margin: 0; font-size: 13px; color: #334155; font-weight: bold;">
                                                    ${order.buyerInfo?.name}
                                                </p>
                                                <p style="margin: 2px 0 0; font-size: 12px; color: #64748b;">
                                                    ${order.buyerInfo?.phone}
                                                </p>
                                            </td>
                                        </tr>
                                    </table>
                                </div>

                                <div style="text-align: center; margin-top: 40px;">
                                    <a href="https://pixeltechcol.com/shop/order-detail.html?id=${orderId}" 
                                       style="display: inline-block; background-color: ${darkColor}; color: #ffffff; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px;">
                                       Ver Detalles en la Web
                                    </a>
                                </div>
                            </td>
                        </tr>
                        
                        <tr>
                            <td style="padding: 20px; text-align: center; background-color: #f1f5f9; color: #94a3b8; font-size: 12px;">
                                <p style="margin: 0;">&copy; ${new Date().getFullYear()} PixelTech Colombia.</p>
                                
                                <p style="margin: 10px 0 0;">
                                    ¿Tienes dudas? 
                                    <a href="${waLink}" style="color: ${primaryColor}; text-decoration: none; font-weight: bold;">
                                        Contáctanos por WhatsApp
                                    </a>
                                </p>
                            </td>
                        </tr>
                    </table>

                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
}

// --- TRIGGER 1: Confirmación de Pedido ---
exports.sendOrderConfirmation = onDocumentCreated("orders/{orderId}", async (event) => {
    const snap = event.data;
    if (!snap) return;

    const orderData = snap.data();
    const orderId = event.params.orderId;
    const email = orderData.buyerInfo?.email || orderData.extraData?.billingData?.email;

    if (!email) {
        console.log(`Orden ${orderId} sin email. Omisión.`);
        return;
    }

    const htmlContent = getBeautifulEmailTemplate('CONFIRMATION', orderData, orderId);

    const mailOptions = {
        from: `"PixelTech Pedidos" <${process.env.SMTP_EMAIL}>`,
        to: email,
        subject: `¡Recibimos tu pedido! #${orderId.slice(0,8).toUpperCase()} 🎉`,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email CONFIRMACION enviado a ${email}`);
        return event.data.ref.update({ confirmationEmailSent: true });
    } catch (error) {
        console.error('Error enviando email:', error);
        return;
    }
});

// --- TRIGGER 2: Notificación de Despacho ---
exports.sendDispatchNotification = onDocumentUpdated("orders/{orderId}", async (event) => {
    const newData = event.data.after.data();
    const previousData = event.data.before.data();
    const orderId = event.params.orderId;

    // Detectar despacho
    const isDispatched = (newData.status === 'dispatched' || newData.status === 'enviado' || newData.status === 'DESPACHADO' || newData.status === 'EN_RUTA') && 
                         previousData.status !== newData.status;
    const trackingAdded = newData.trackingNumber && !previousData.trackingNumber;

    if (isDispatched || trackingAdded) {
        const email = newData.buyerInfo?.email;
        if (!email) return;

        const htmlContent = getBeautifulEmailTemplate('DISPATCH', newData, orderId);

        const mailOptions = {
            from: `"PixelTech Envíos" <${process.env.SMTP_EMAIL}>`,
            to: email,
            subject: `¡Tu pedido va en camino! 🚚 #${orderId.slice(0,8).toUpperCase()}`,
            html: htmlContent
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log(`Email DESPACHO enviado a ${email}`);
            return event.data.after.ref.update({ dispatchEmailSent: true });
        } catch (error) {
            console.error('Error enviando email despacho:', error);
            return;
        }
    }
    return;
});